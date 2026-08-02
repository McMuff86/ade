/**
 * Bounded, identity-checked reads and writes for paths owned by the ADE profile.
 *
 * The semantics here are the ones the descriptor-anchored Linux implementation
 * has always had — same signatures, same throw-vs-null behaviour, same
 * ownership-marker protocol — expressed once against the ManagedHost seam so a
 * second platform cannot drift away from them. Which guarantee each host can
 * actually deliver is documented in ManagedHost.ts and reported to the user by
 * `managedProfileSupport`.
 */

import {
  closeSync, fstatSync, linkSync, lstatSync, readSync, renameSync, rmdirSync, rmSync, unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import type { ManagedAnchor, ManagedHost } from './ManagedHost';
import { createManagedHost } from './createManagedHost';
import {
  IMPORT_OWNER_MARKER, assertManagedComponents, importOwnerSidecar, sameManagedPath,
} from './ManagedPathNames';

export interface ProfileRootAnchor {
  /** Logical path, for messages and the audit hook. Never used for I/O. */
  path: string;
  anchor: ManagedAnchor;
}

export interface ManagedProfileReader {
  read(relativeParts: string[], maxBytes: number): Buffer | null;
  readStrict(relativeParts: string[], maxBytes: number): Buffer | null;
  close(): void;
}

export function createProfileRootAnchor(path: string, host: ManagedHost = createManagedHost()): ProfileRootAnchor {
  const absolute = resolve(path);
  return { path: absolute, anchor: host.anchorRoot(absolute) };
}

function openChildDirectory(
  parent: ProfileRootAnchor, name: string, host: ManagedHost,
): ProfileRootAnchor | null {
  try {
    return { path: join(parent.path, name), anchor: host.openDir(parent.anchor, name) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof Error && error.message.startsWith('workspace profile:')) throw error;
    throw new Error('workspace profile: nested ADE data directory could not be anchored safely');
  }
}

function hasConfigJson(anchor: ProfileRootAnchor, host: ManagedHost): boolean {
  let fd: number | undefined;
  try {
    fd = host.openFile(anchor.anchor, 'config.json');
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

/** Accepts either `<dir>` (with `config.json` or `ade/config.json`) or the file itself. */
export function resolveProfileRootAnchor(
  source: string, host: ManagedHost = createManagedHost(),
): ProfileRootAnchor {
  const absolute = resolve(source);
  const leaf = absolute.slice(absolute.lastIndexOf(sep) + 1);
  if (leaf.toLowerCase() === 'config.json') {
    const anchor = createProfileRootAnchor(absolute.slice(0, absolute.lastIndexOf(sep)), host);
    try {
      if (hasConfigJson(anchor, host)) return anchor;
      throw new Error('workspace profile: selected config.json does not exist');
    } catch (error) {
      anchor.anchor.close();
      throw error;
    }
  }

  const selected = createProfileRootAnchor(absolute, host);
  let returnSelected = false;
  try {
    const nested = openChildDirectory(selected, 'ade', host);
    if (nested) {
      let returnNested = false;
      try {
        if (hasConfigJson(nested, host)) {
          returnNested = true;
          return nested;
        }
      } finally {
        if (!returnNested) nested.anchor.close();
      }
    }
    if (hasConfigJson(selected, host)) {
      returnSelected = true;
      return selected;
    }
    throw new Error('workspace profile: config.json was not found in the selected profile');
  } finally {
    if (!returnSelected) selected.anchor.close();
  }
}

export function readBoundedRelativeFile(
  anchor: ProfileRootAnchor,
  relativeParts: string[],
  maxBytes: number,
  label: string,
  host: ManagedHost = createManagedHost(),
  auditFileOpen?: (path: string) => void,
): Buffer {
  try {
    assertManagedComponents(relativeParts, host.platform);
  } catch {
    throw new Error(`workspace profile: ${label} has an invalid managed path`);
  }
  const opened: ManagedAnchor[] = [];
  let parent = anchor.anchor;
  let fd: number | undefined;
  try {
    for (const part of relativeParts.slice(0, -1)) {
      const directory = host.openDir(parent, part);
      opened.push(directory);
      parent = directory;
    }
    auditFileOpen?.(join(anchor.path, ...relativeParts));
    fd = host.openFile(parent, relativeParts.at(-1)!);
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== BigInt(1) || before.size > BigInt(maxBytes)) {
      throw new Error(`workspace profile: ${label} exceeds its migration limit`);
    }
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    const after = fstatSync(fd, { bigint: true });
    if (offset !== bytes.length || before.dev !== after.dev || before.ino !== after.ino
        || before.size !== after.size || before.mtimeNs !== after.mtimeNs
        || before.ctimeNs !== after.ctimeNs) {
      throw new Error(`workspace profile: ${label} changed while it was read`);
    }
    return bytes;
  } finally {
    if (fd !== undefined) closeSync(fd);
    for (const directory of opened.reverse()) directory.close();
  }
}

export function safelyReadManagedFile(
  anchor: ProfileRootAnchor,
  relativeParts: string[],
  maxBytes: number,
  host: ManagedHost,
  auditFileOpen?: (path: string) => void,
): Buffer | null {
  try {
    return readBoundedRelativeFile(anchor, relativeParts, maxBytes, 'managed resource', host, auditFileOpen);
  } catch {
    return null;
  }
}

/** Open an ADE profile root and keep every managed read bounded and verified. */
export function openManagedProfileReader(
  profileDir: string, host: ManagedHost = createManagedHost(),
): ManagedProfileReader {
  const anchor = createProfileRootAnchor(profileDir, host);
  let closed = false;
  return {
    read(relativeParts, maxBytes) {
      if (closed) throw new Error('workspace profile: managed reader is closed');
      return safelyReadManagedFile(anchor, relativeParts, maxBytes, host);
    },
    readStrict(relativeParts, maxBytes) {
      if (closed) throw new Error('workspace profile: managed reader is closed');
      try {
        return readBoundedRelativeFile(anchor, relativeParts, maxBytes, 'managed resource', host);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    close() {
      if (!closed) anchor.anchor.close();
      closed = true;
    },
  };
}

/** Writer for paths owned by the ADE profile. Every leaf is created exclusively. */
export class ManagedProfileWriter {
  private readonly root: ProfileRootAnchor;
  private readonly host: ManagedHost;
  /** The caller's spelling of the root — what `relative()` measures against. */
  private readonly declaredRoot: string;

  constructor(rootPath: string, host: ManagedHost = createManagedHost()) {
    this.host = host;
    this.declaredRoot = resolve(rootPath);
    this.root = createProfileRootAnchor(rootPath, host);
  }

  close(): void { this.root.anchor.close(); }

  mkdir(parts: string[]): void {
    this.withParent(parts, true, (parent, leaf) => {
      this.host.makeDir(parent, leaf);
      const directory = this.host.openDir(parent, leaf);
      directory.close();
      this.host.syncDir(parent);
    });
  }

  write(parts: string[], content: string | Buffer): void {
    this.withParent(parts, false, (parent, leaf) => {
      const fd = this.host.createFile(parent, leaf, 0o600);
      try {
        writeFileSync(fd, content);
        this.host.syncFile(fd);
      } finally { closeSync(fd); }
      this.host.syncDir(parent);
    });
  }

  rename(fromParts: string[], toParts: string[]): void {
    this.withParent(fromParts, false, (fromParent, fromLeaf) => {
      this.withParent(toParts, false, (toParent, toLeaf) => {
        renameSync(`${fromParent.addr}/${fromLeaf}`, `${toParent.addr}/${toLeaf}`);
        this.host.syncDir(toParent);
        if (fromParent.addr !== toParent.addr) this.host.syncDir(fromParent);
      });
    });
  }

  link(fromParts: string[], toParts: string[]): void {
    this.withParent(fromParts, false, (fromParent, fromLeaf) => {
      this.withParent(toParts, false, (toParent, toLeaf) => {
        linkSync(`${fromParent.addr}/${fromLeaf}`, `${toParent.addr}/${toLeaf}`);
        this.host.syncDir(toParent);
      });
    });
  }

  remove(parts: string[]): void {
    this.withParent(parts, false, (parent, leaf) => {
      rmSync(`${parent.addr}/${leaf}`, { recursive: true, force: true });
      this.host.syncDir(parent);
    });
  }

  removeOwnedFile(parts: string[], expectedSha256: string): void {
    try {
      this.withParent(parts, false, (parent, leaf) => {
        const path = `${parent.addr}/${leaf}`;
        let fd: number;
        try { fd = this.host.openFile(parent, leaf); } catch (error) {
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
          for (;;) {
            const count = readSync(fd, buffer, 0, buffer.length, offset);
            if (count === 0) break;
            hash.update(buffer.subarray(0, count));
            offset += count;
          }
          if (hash.digest('hex') !== expectedSha256) {
            throw new Error('Managed profile file ownership mismatch.');
          }
          const final = lstatSync(path, { bigint: true });
          if (final.dev !== opened.dev || final.ino !== opened.ino) {
            throw new Error('Managed profile file changed before removal.');
          }
          unlinkSync(path);
          this.host.syncDir(parent);
        } finally { closeSync(fd); }
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  assertOwnedDirectory(parts: string[], expectedToken: string): boolean {
    try {
      this.withParent(parts, false, (parent, leaf) => {
        const directory = this.host.openDir(parent, leaf);
        try {
          let markerFd: number;
          try { markerFd = this.host.openFile(directory, IMPORT_OWNER_MARKER); } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              throw new Error('Managed profile directory ownership marker is missing.');
            }
            throw error;
          }
          try {
            if (!markerHolds(markerFd, expectedToken)) {
              throw new Error('Managed profile directory ownership mismatch.');
            }
          } finally { closeSync(markerFd); }
        } finally { directory.close(); }
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    return true;
  }

  removeOwnedDirectory(parts: string[], expectedToken: string): void {
    try {
      this.withParent(parts, false, (parent, leaf) => {
        const path = `${parent.addr}/${leaf}`;
        const sidecarLeaf = importOwnerSidecar(leaf, expectedToken);
        const sidecarPath = `${parent.addr}/${sidecarLeaf}`;
        const sidecarHolds = (): boolean => {
          const fd = this.host.openFile(parent, sidecarLeaf);
          try { return markerHolds(fd, expectedToken); } finally { closeSync(fd); }
        };

        let directory: ManagedAnchor;
        try {
          directory = this.host.openDir(parent, leaf);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            // The directory is already gone; only the sidecar remains to retire.
            try {
              if (!sidecarHolds()) throw new Error('Managed profile directory sidecar ownership mismatch.');
              unlinkSync(sidecarPath);
              this.host.syncDir(parent);
            } catch (sidecarError) {
              if ((sidecarError as NodeJS.ErrnoException).code !== 'ENOENT') throw sidecarError;
            }
            return;
          }
          throw error;
        }

        try {
          const entries = this.host.entries(directory);
          let sidecarPresent = false;
          try {
            sidecarPresent = sidecarHolds();
            if (!sidecarPresent) throw new Error('Managed profile directory sidecar ownership mismatch.');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
          if (sidecarPresent) {
            if (entries.length !== 0) throw new Error('Managed profile directory contains unowned content.');
          } else {
            if (entries.length !== 1 || entries[0] !== IMPORT_OWNER_MARKER) {
              throw new Error('Managed profile directory ownership mismatch.');
            }
            const markerFd = this.host.openFile(directory, IMPORT_OWNER_MARKER);
            try {
              if (!markerHolds(markerFd, expectedToken)) {
                throw new Error('Managed profile directory ownership mismatch.');
              }
            } finally { closeSync(markerFd); }
            renameSync(`${directory.addr}/${IMPORT_OWNER_MARKER}`, sidecarPath);
            this.host.syncDir(directory);
            this.host.syncDir(parent);
          }
        } finally { directory.close(); }

        // Never recursive: later or unowned content makes rmdir fail closed
        // while the sidecar survives to prove the removal was interrupted.
        rmdirSync(path);
        this.host.syncDir(parent);
        unlinkSync(sidecarPath);
        this.host.syncDir(parent);
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  /**
   * Split an absolute managed path into components.
   *
   * Measured against the caller's spelling, not the host's canonical root:
   * every path reaching here is built with `join(profileDir, …)` by the import
   * transaction, and on Windows `os.tmpdir()` yields an 8.3 short name that
   * `realpathSync.native` expands — so comparing against the real root would
   * reject the app's own profile paths under the E2E harness.
   */
  relative(absolutePath: string): string[] {
    const absolute = resolve(absolutePath);
    const platform = this.host.platform;
    const prefix = this.declaredRoot.endsWith(sep) ? this.declaredRoot : `${this.declaredRoot}${sep}`;
    if (!sameManagedPath(absolute.slice(0, prefix.length), prefix, platform)
        || absolute.length <= prefix.length) {
      throw new Error('Managed path escapes the profile root.');
    }
    const parts = absolute.slice(prefix.length).split(/[\\/]+/).filter(Boolean);
    assertManagedComponents(parts, platform);
    return parts;
  }

  private withParent<T>(
    parts: string[],
    createParents: boolean,
    callback: (parent: ManagedAnchor, leaf: string) => T,
  ): T {
    try {
      assertManagedComponents(parts, this.host.platform);
    } catch {
      throw new Error('Invalid managed profile path.');
    }
    const opened: ManagedAnchor[] = [];
    let parent = this.root.anchor;
    try {
      for (const part of parts.slice(0, -1)) {
        if (createParents) this.host.makeDir(parent, part);
        const directory = this.host.openDir(parent, part);
        opened.push(directory);
        parent = directory;
      }
      return callback(parent, parts.at(-1)!);
    } finally {
      for (const directory of opened.reverse()) directory.close();
    }
  }
}

/** A marker file that is a singly-linked regular file holding exactly `token`. */
function markerHolds(fd: number, token: string): boolean {
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size !== token.length) return false;
  const bytes = Buffer.alloc(token.length);
  const count = readSync(fd, bytes, 0, bytes.length, 0);
  return count === bytes.length && bytes.toString('utf8') === token;
}
