import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { normalizeConfig } from '../orchestration/migrate';
import { isExecutionBackendId } from '../../shared/executionBackends';
import type { AdeConfig, Repository } from '../../shared/types';
import {
  WORKSPACE_BUNDLE_MAX_ASSET_BYTES,
  WORKSPACE_BUNDLE_MAX_MEMORY_CHARS,
  type WorkspaceBundleSourcePlatform,
} from '../../shared/workspaceBundle';
import {
  exportWorkspaceBundle,
  type WorkspaceBundleExportResult,
  type WorkspaceBundlePhotoResource,
} from './WorkspaceBundleExporter';

const MAX_SOURCE_CONFIG_BYTES = 8 * 1024 * 1024;
const PHOTO_MIME: Record<string, WorkspaceBundlePhotoResource['mime']> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export interface ProfileWorkspaceBundleOptions {
  sourcePlatform: WorkspaceBundleSourcePlatform;
  exportedAt?: string;
  includeMemory?: boolean;
  includePhotos?: boolean;
  repositoryRemote?(repository: Repository): string | null;
  /** Test/diagnostic hook; receives only paths intentionally opened by the migration reader. */
  auditFileOpen?(path: string): void;
}

function sameCanonicalPath(left: string, right: string): boolean {
  const normalize = (value: string): string => process.platform === 'win32' ? value.toLowerCase() : value;
  return normalize(resolve(left)) === normalize(resolve(right));
}

function assertCanonicalDirectory(path: string, label: string): void {
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink() || !sameCanonicalPath(path, realpathSync.native(path))) {
    throw new Error(`workspace profile: ${label} must be a canonical non-symlink directory`);
  }
}

interface ProfileRootAnchor {
  path: string;
  fd: number;
}

export interface ManagedProfileReader {
  read(relativeParts: string[], maxBytes: number): Buffer | null;
  readStrict(relativeParts: string[], maxBytes: number): Buffer | null;
  close(): void;
}

/** Open a canonical ADE profile root and keep every managed read descriptor-relative. */
export function openManagedProfileReader(profileDir: string): ManagedProfileReader {
  const anchor = createProfileRootAnchor(resolve(profileDir));
  let closed = false;
  return {
    read(relativeParts, maxBytes) {
      if (closed) throw new Error('workspace profile: managed reader is closed');
      return safelyReadManagedFile(anchor, relativeParts, maxBytes);
    },
    readStrict(relativeParts, maxBytes) {
      if (closed) throw new Error('workspace profile: managed reader is closed');
      try {
        return readBoundedRelativeFile(anchor, relativeParts, maxBytes, 'managed resource');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    close() {
      if (!closed) closeSync(anchor.fd);
      closed = true;
    },
  };
}

/** Linux-only descriptor-anchored writer for paths owned by the ADE profile. */
export class ManagedProfileWriter {
  private readonly rootFd: number;

  constructor(private readonly rootPath: string) {
    const anchor = createProfileRootAnchor(resolve(rootPath));
    this.rootFd = anchor.fd;
  }

  close(): void { closeSync(this.rootFd); }

  mkdir(parts: string[]): void {
    this.withParent(parts, true, (parent, leaf, parentFd) => {
      const candidate = `${parent}/${leaf}`;
      try { mkdirSync(candidate, { recursive: false, mode: 0o700 }); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      const directoryFlag = (constants as unknown as Record<string, number>).O_DIRECTORY ?? 0;
      const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
      const fd = openSync(candidate, constants.O_RDONLY | directoryFlag | noFollow);
      try {
        if (!fstatSync(fd).isDirectory()) throw new Error('Managed profile path is not a directory.');
      } finally { closeSync(fd); }
      fsyncSync(parentFd);
    });
  }

  write(parts: string[], content: string | Buffer): void {
    this.withParent(parts, false, (parent, leaf, parentFd) => {
      const fd = openSync(
        `${parent}/${leaf}`,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        writeFileSync(fd, content);
        fsyncSync(fd);
      } finally { closeSync(fd); }
      fsyncSync(parentFd);
    });
  }

  rename(fromParts: string[], toParts: string[]): void {
    this.withParent(fromParts, false, (fromParent, fromLeaf, fromFd) => {
      this.withParent(toParts, false, (toParent, toLeaf, toFd) => {
        renameSync(`${fromParent}/${fromLeaf}`, `${toParent}/${toLeaf}`);
        fsyncSync(toFd);
        if (fromFd !== toFd) fsyncSync(fromFd);
      });
    });
  }

  link(fromParts: string[], toParts: string[]): void {
    this.withParent(fromParts, false, (fromParent, fromLeaf) => {
      this.withParent(toParts, false, (toParent, toLeaf, toFd) => {
        linkSync(`${fromParent}/${fromLeaf}`, `${toParent}/${toLeaf}`);
        fsyncSync(toFd);
      });
    });
  }

  remove(parts: string[]): void {
    this.withParent(parts, false, (parent, leaf, parentFd) => {
      rmSync(`${parent}/${leaf}`, { recursive: true, force: true });
      fsyncSync(parentFd);
    });
  }

  removeOwnedFile(parts: string[], expectedSha256: string): void {
    try { this.withParent(parts, false, (parent, leaf, parentFd) => {
      const path = `${parent}/${leaf}`;
      let fd: number;
      try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      try {
        const opened = fstatSync(fd, { bigint: true });
        const current = lstatSync(path, { bigint: true });
        if (!opened.isFile() || current.dev !== opened.dev || current.ino !== opened.ino) {
          throw new Error('Managed profile file identity changed before removal.');
        }
        const hash = createHash('sha256');
        const buffer = Buffer.allocUnsafe(64 * 1024);
        let offset = 0;
        while (true) {
          const count = readSync(fd, buffer, 0, buffer.length, offset);
          if (count === 0) break;
          hash.update(buffer.subarray(0, count));
          offset += count;
        }
        if (hash.digest('hex') !== expectedSha256) throw new Error('Managed profile file ownership mismatch.');
        const final = lstatSync(path, { bigint: true });
        if (final.dev !== opened.dev || final.ino !== opened.ino) throw new Error('Managed profile file changed before removal.');
        unlinkSync(path);
        fsyncSync(parentFd);
      } finally { closeSync(fd); }
    }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  assertOwnedDirectory(parts: string[], expectedToken: string): boolean {
    try { this.withParent(parts, false, (parent, leaf) => {
      const path = `${parent}/${leaf}`;
      const directoryFlag = (constants as typeof constants & { O_DIRECTORY?: number }).O_DIRECTORY ?? 0;
      const dirFd = openSync(path, constants.O_RDONLY | directoryFlag | constants.O_NOFOLLOW);
      try {
        const stat = fstatSync(dirFd);
        if (!stat.isDirectory() || stat.nlink < 1) {
          throw new Error('Managed profile directory ownership target is invalid.');
        }
        const markerPath = `/proc/self/fd/${dirFd}/.ade-workspace-import-owner`;
        let markerFd: number;
        try { markerFd = openSync(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error('Managed profile directory ownership marker is missing.');
          }
          throw error;
        }
        try {
          const markerStat = fstatSync(markerFd);
          const markerBytes = Buffer.alloc(expectedToken.length);
          const count = readSync(markerFd, markerBytes, 0, markerBytes.length, 0);
          if (!markerStat.isFile() || markerStat.nlink !== 1 || markerStat.size !== expectedToken.length
              || count !== markerBytes.length || markerBytes.toString('utf8') !== expectedToken) {
            throw new Error('Managed profile directory ownership mismatch.');
          }
        } finally { closeSync(markerFd); }
      } finally { closeSync(dirFd); }
    }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    return true;
  }

  removeOwnedDirectory(parts: string[], expectedToken: string): void {
    try { this.withParent(parts, false, (parent, leaf, parentFd) => {
      const path = `${parent}/${leaf}`;
      const sidecar = `${parent}/.${leaf}.ade-import-owner-${expectedToken.slice(0, 16)}`;
      const markerMatches = (markerPath: string): boolean => {
        const markerFd = openSync(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const marker = Buffer.alloc(128);
          const count = readSync(markerFd, marker, 0, marker.length, 0);
          const markerStat = fstatSync(markerFd);
          return markerStat.isFile() && markerStat.nlink === 1 && markerStat.size === count
            && marker.subarray(0, count).toString('utf8') === expectedToken;
        } finally { closeSync(markerFd); }
      };
      let dirFd: number;
      try {
        const directoryFlag = (constants as unknown as Record<string, number>).O_DIRECTORY ?? 0;
        dirFd = openSync(path, constants.O_RDONLY | directoryFlag | constants.O_NOFOLLOW);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          try {
            if (!markerMatches(sidecar)) throw new Error('Managed profile directory sidecar ownership mismatch.');
            unlinkSync(sidecar);
            fsyncSync(parentFd);
          } catch (sidecarError) {
            if ((sidecarError as NodeJS.ErrnoException).code !== 'ENOENT') throw sidecarError;
          }
          return;
        }
        throw error;
      }
      try {
        const opened = fstatSync(dirFd, { bigint: true });
        const current = lstatSync(path, { bigint: true });
        if (!opened.isDirectory() || current.dev !== opened.dev || current.ino !== opened.ino) {
          throw new Error('Managed profile directory identity changed before removal.');
        }
        const entries = readdirSync(`/proc/self/fd/${dirFd}`);
        let sidecarPresent = false;
        try {
          sidecarPresent = markerMatches(sidecar);
          if (!sidecarPresent) throw new Error('Managed profile directory sidecar ownership mismatch.');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (sidecarPresent) {
          if (entries.length !== 0) throw new Error('Managed profile directory contains unowned content.');
        } else {
          if (entries.length !== 1 || entries[0] !== '.ade-workspace-import-owner'
              || !markerMatches(`/proc/self/fd/${dirFd}/.ade-workspace-import-owner`)) {
            throw new Error('Managed profile directory ownership mismatch.');
          }
          renameSync(`/proc/self/fd/${dirFd}/.ade-workspace-import-owner`, sidecar);
          fsyncSync(dirFd);
          fsyncSync(parentFd);
        }
      } finally { closeSync(dirFd); }
      // Never recursively delete: later/unowned content makes rmdir fail closed while the sidecar survives.
      rmdirSync(path);
      fsyncSync(parentFd);
      unlinkSync(sidecar);
      fsyncSync(parentFd);
    }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  relative(absolutePath: string): string[] {
    const root = resolve(this.rootPath);
    const absolute = resolve(absolutePath);
    if (!absolute.startsWith(`${root}/`)) throw new Error('Managed path escapes the profile root.');
    return absolute.slice(root.length + 1).split('/').filter(Boolean);
  }

  private withParent<T>(
    parts: string[],
    createParents: boolean,
    callback: (parent: string, leaf: string, parentFd: number) => T,
  ): T {
    if (parts.length === 0 || parts.some((part) => !part || part === '.' || part === '..' || /[/\\\0]/.test(part))) {
      throw new Error('Invalid managed profile path.');
    }
    let fd = this.rootFd;
    const opened: number[] = [];
    const directoryFlag = (constants as unknown as Record<string, number>).O_DIRECTORY ?? 0;
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    try {
      for (const part of parts.slice(0, -1)) {
        const candidate = `/proc/self/fd/${fd}/${part}`;
        if (createParents) {
          try { mkdirSync(candidate, { recursive: false, mode: 0o700 }); } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          }
        }
        const next = openSync(candidate, constants.O_RDONLY | directoryFlag | noFollow);
        if (!fstatSync(next).isDirectory()) {
          closeSync(next);
          throw new Error('Managed profile ancestor is not a directory.');
        }
        opened.push(next);
        fd = next;
      }
      return callback(`/proc/self/fd/${fd}`, parts.at(-1)!, fd);
    } finally {
      for (const openedFd of opened.reverse()) closeSync(openedFd);
    }
  }
}

function createProfileRootAnchor(path: string): ProfileRootAnchor {
  if (process.platform !== 'linux') {
    throw new Error('workspace profile: safe descriptor-relative profile reads are not supported on this platform');
  }
  assertCanonicalDirectory(path, 'ADE data directory');
  const info = lstatSync(path, { bigint: true });
  const real = realpathSync.native(path);
  const directoryFlag = (constants as unknown as Record<string, number>).O_DIRECTORY ?? 0;
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const fd = openSync(path, constants.O_RDONLY | directoryFlag | noFollow);
  const opened = fstatSync(fd, { bigint: true });
  const descriptorReal = realpathSync.native(`/proc/self/fd/${fd}`);
  if (!opened.isDirectory() || opened.dev !== info.dev || opened.ino !== info.ino
      || descriptorReal !== real) {
    closeSync(fd);
    throw new Error('workspace profile: ADE data directory could not be anchored safely');
  }
  return { path, fd };
}

function openAnchoredChildDirectory(parent: ProfileRootAnchor, name: string): ProfileRootAnchor | null {
  const directoryFlag = (constants as unknown as Record<string, number>).O_DIRECTORY ?? 0;
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  try {
    const fd = openSync(
      `/proc/self/fd/${parent.fd}/${name}`,
      constants.O_RDONLY | directoryFlag | noFollow,
    );
    const info = fstatSync(fd, { bigint: true });
    if (!info.isDirectory()) {
      closeSync(fd);
      throw new Error('workspace profile: nested ADE data path is not a directory');
    }
    return { path: join(parent.path, name), fd };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('workspace profile: nested ADE data directory could not be anchored safely');
  }
}

function hasAnchoredConfig(anchor: ProfileRootAnchor): boolean {
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  let fd: number | undefined;
  try {
    fd = openSync(`/proc/self/fd/${anchor.fd}/config.json`, constants.O_RDONLY | noFollow);
    const info = fstatSync(fd, { bigint: true });
    if (!info.isFile() || info.nlink !== BigInt(1)) {
      throw new Error('workspace profile: config.json must be a singly-linked regular file');
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function resolveProfileRootAnchor(source: string): ProfileRootAnchor {
  const absolute = resolve(source);
  if (basename(absolute).toLowerCase() === 'config.json') {
    const anchor = createProfileRootAnchor(dirname(absolute));
    try {
      if (hasAnchoredConfig(anchor)) return anchor;
      throw new Error('workspace profile: selected config.json does not exist');
    } catch (error) {
      closeSync(anchor.fd);
      throw error;
    }
  }

  const selected = createProfileRootAnchor(absolute);
  let returnSelected = false;
  try {
    const nested = openAnchoredChildDirectory(selected, 'ade');
    if (nested) {
      let returnNested = false;
      try {
        if (hasAnchoredConfig(nested)) {
          returnNested = true;
          return nested;
        }
      } finally {
        if (!returnNested) closeSync(nested.fd);
      }
    }
    if (hasAnchoredConfig(selected)) {
      returnSelected = true;
      return selected;
    }
    throw new Error('workspace profile: config.json was not found in the selected profile');
  } finally {
    if (!returnSelected) closeSync(selected.fd);
  }
}

function validRelativeParts(parts: string[]): boolean {
  return parts.length > 0 && parts.every((part) => part !== '' && part !== '.' && part !== '..'
    && !part.includes('/') && !part.includes('\\') && !part.includes('\0'));
}

function readBoundedRelativeFile(
  anchor: ProfileRootAnchor,
  relativeParts: string[],
  maxBytes: number,
  label: string,
  auditFileOpen?: (path: string) => void,
): Buffer {
  if (!validRelativeParts(relativeParts)) {
    throw new Error(`workspace profile: ${label} has an invalid managed path`);
  }
  const openedDirectories: number[] = [];
  let parentFd = anchor.fd;
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const directoryFlag = (constants as unknown as Record<string, number>).O_DIRECTORY ?? 0;
  let fd: number | undefined;
  try {
    for (const part of relativeParts.slice(0, -1)) {
      const directoryFd = openSync(
        `/proc/self/fd/${parentFd}/${part}`,
        constants.O_RDONLY | directoryFlag | noFollow,
      );
      const directoryInfo = fstatSync(directoryFd, { bigint: true });
      if (!directoryInfo.isDirectory()) {
        closeSync(directoryFd);
        throw new Error(`workspace profile: ${label} traversed a non-directory component`);
      }
      openedDirectories.push(directoryFd);
      parentFd = directoryFd;
    }
    const logicalPath = join(anchor.path, ...relativeParts);
    auditFileOpen?.(logicalPath);
    fd = openSync(
      `/proc/self/fd/${parentFd}/${relativeParts.at(-1)!}`,
      constants.O_RDONLY | noFollow,
    );
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== BigInt(1) || before.size > BigInt(maxBytes)) {
      throw new Error(`workspace profile: ${label} exceeds its migration limit`);
    }
    const allocation = Number(before.size);
    const bytes = Buffer.alloc(allocation);
    let offset = 0;
    while (offset < bytes.length) {
      const read = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    const after = fstatSync(fd, { bigint: true });
    if (offset !== bytes.length || before.dev !== after.dev || before.ino !== after.ino
        || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      throw new Error(`workspace profile: ${label} changed while it was read`);
    }
    return bytes;
  } finally {
    if (fd !== undefined) closeSync(fd);
    for (const directoryFd of openedDirectories.reverse()) closeSync(directoryFd);
  }
}

function safelyReadManagedFile(
  anchor: ProfileRootAnchor,
  relativeParts: string[],
  maxBytes: number,
  auditFileOpen?: (path: string) => void,
): Buffer | null {
  try {
    return readBoundedRelativeFile(anchor, relativeParts, maxBytes, 'managed resource', auditFileOpen);
  } catch {
    return null;
  }
}

function assertPortableLegacyBackends(parsed: Record<string, unknown>): void {
  const checkEntries = (value: unknown, field: string, label: string): void => {
    if (!Array.isArray(value)) return;
    for (let index = 0; index < value.length; index += 1) {
      const entry = value[index];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const raw = entry as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(raw, field)
          && raw[field] !== undefined && !isExecutionBackendId(raw[field])) {
        throw new Error(`workspace profile: ${label}[${index}].${field} is an invalid execution backend`);
      }
    }
  };
  checkEntries(parsed.repositories, 'executionBackend', 'repositories');
  checkEntries(parsed.agents, 'homeExecutionBackend', 'agents');
}

function assertPortableLegacyContainers(parsed: Record<string, unknown>): void {
  const containers: Array<[string, number]> = [
    ['repositories', 500], ['categories', 500], ['agents', 1_000], ['agentTemplates', 1_000],
  ];
  for (const [field, limit] of containers) {
    if (!Object.prototype.hasOwnProperty.call(parsed, field)) continue;
    const value = parsed[field];
    if (!Array.isArray(value) || value.length > limit
        || value.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) {
      throw new Error(`workspace profile: ${field} must be a bounded array of objects`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(parsed, 'settings')) {
    const settings = parsed.settings;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new Error('workspace profile: settings must be an object');
    }
    const settingsRecord = settings as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(settingsRecord, 'theme')
        && settingsRecord.theme !== 'dark' && settingsRecord.theme !== 'light') {
      throw new Error('workspace profile: settings.theme is invalid');
    }
    if (Object.prototype.hasOwnProperty.call(settingsRecord, 'memory')) {
      const memory = settingsRecord.memory;
      if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
        throw new Error('workspace profile: settings.memory must be an object');
      }
      const memoryRecord = memory as Record<string, unknown>;
      for (const field of ['enabled', 'userProfileEnabled']) {
        if (Object.prototype.hasOwnProperty.call(memoryRecord, field)
            && typeof memoryRecord[field] !== 'boolean') {
          throw new Error(`workspace profile: settings.memory.${field} must be a boolean`);
        }
      }
      for (const field of ['memoryCharLimit', 'userCharLimit']) {
        if (!Object.prototype.hasOwnProperty.call(memoryRecord, field)) continue;
        const value = memoryRecord[field];
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1_000_000) {
          throw new Error(`workspace profile: settings.memory.${field} is invalid`);
        }
      }
    }
  }
}

function assertPortableResourceReferences(config: AdeConfig): void {
  const collections: Array<{ label: string; values: Array<{ photo?: unknown }> }> = [
    { label: 'categories', values: config.categories },
    { label: 'agents', values: config.agents },
    { label: 'agentTemplates', values: config.agentTemplates },
  ];
  for (const { label, values } of collections) {
    for (let index = 0; index < values.length; index += 1) {
      const photo = values[index]?.photo;
      if (photo === undefined) continue;
      if (typeof photo !== 'string' || photo.length === 0 || photo.length > 255
          || !validRelativeParts([photo])) {
        throw new Error(`workspace profile: ${label}[${index}].photo is not a valid managed filename`);
      }
    }
  }
}

export function exportProfileWorkspaceBundle(
  source: string,
  options: ProfileWorkspaceBundleOptions,
): WorkspaceBundleExportResult {
  const anchor = resolveProfileRootAnchor(source);
  try {
    return exportAnchoredProfileWorkspaceBundle(anchor, options);
  } finally {
    closeSync(anchor.fd);
  }
}

function exportAnchoredProfileWorkspaceBundle(
  anchor: ProfileRootAnchor,
  options: ProfileWorkspaceBundleOptions,
): WorkspaceBundleExportResult {
  const configBytes = readBoundedRelativeFile(
    anchor,
    ['config.json'],
    MAX_SOURCE_CONFIG_BYTES,
    'config.json',
    options.auditFileOpen,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(configBytes.toString('utf8'));
  } catch {
    throw new Error('workspace profile: config.json is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('workspace profile: config.json root must be an object');
  }
  assertPortableLegacyContainers(parsed as Record<string, unknown>);
  assertPortableLegacyBackends(parsed as Record<string, unknown>);
  const normalized = normalizeConfig(parsed as Parameters<typeof normalizeConfig>[0]).config;
  assertPortableResourceReferences(normalized);

  // Validate every portable identity and relationship before invoking any external or file reader.
  exportWorkspaceBundle(normalized, {
    sourcePlatform: options.sourcePlatform,
    exportedAt: options.exportedAt,
    includeMemory: false,
    includePhotos: false,
  });

  const result = exportWorkspaceBundle(normalized, {
    sourcePlatform: options.sourcePlatform,
    exportedAt: options.exportedAt,
    includeMemory: options.includeMemory,
    includePhotos: options.includePhotos,
    resources: {
      repositoryRemote: options.repositoryRemote,
      photo: (file, maxBytes) => {
        const mime = PHOTO_MIME[extname(file).toLowerCase()];
        if (!mime) return null;
        const bytes = safelyReadManagedFile(
          anchor,
          ['photos', file],
          Math.min(maxBytes, WORKSPACE_BUNDLE_MAX_ASSET_BYTES),
          options.auditFileOpen,
        );
        return bytes ? { bytes, mime } : null;
      },
      memory: (agentId, target, maxBytes) => {
        const file = target === 'memory' ? 'MEMORY.md' : 'USER.md';
        return safelyReadManagedFile(
          anchor,
          ['agents', agentId, 'memory', file],
          Math.min(maxBytes, WORKSPACE_BUNDLE_MAX_MEMORY_CHARS * 4),
          options.auditFileOpen,
        );
      },
    },
  });

  return result;
}
