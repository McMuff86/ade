import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync,
  readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, posix, resolve } from 'node:path';
import type { ExecutionBackendService } from '../execution/ExecutionBackendService';
import type { WorkspaceAgentHomeProvisioner } from './WorkspaceImportService';
import type { WorkspaceTargetMapping } from './WorkspaceImportPlanner';

const ENSURE_SCRIPT = String.raw`
import json, os, sys
path = sys.argv[1]
token = sys.argv[2]
if not os.path.isabs(path) or os.path.normpath(path) != path:
    raise SystemExit('non-canonical target')
if os.path.lexists(path):
    raise SystemExit('target already exists')
parent = os.path.dirname(path)
leaf = os.path.basename(path)
parent_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    os.mkdir(leaf, 0o700, dir_fd=parent_fd)
    child_fd = os.open(leaf, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
    try:
        if os.path.realpath('/proc/self/fd/%d' % child_fd) != path:
            raise RuntimeError('target changed during creation')
        marker_fd = os.open('.ade-workspace-import-owner', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=child_fd)
        try:
            os.write(marker_fd, token.encode('ascii'))
            os.fsync(marker_fd)
        finally: os.close(marker_fd)
        os.fsync(child_fd)
        os.fsync(parent_fd)
    finally:
        os.close(child_fd)
except BaseException:
    try: os.rmdir(leaf, dir_fd=parent_fd)
    except OSError: pass
    raise
finally:
    os.close(parent_fd)
print(json.dumps([path], separators=(',', ':')))
`;

const ROLLBACK_SCRIPT = String.raw`
import json, os, sys
payload = json.load(sys.stdin)
paths = payload['paths']
token = payload['token']
for item in reversed(paths):
    parent = os.path.dirname(item)
    leaf = os.path.basename(item)
    sidecar = '.' + leaf + '.ade-import-owner-' + token[:16]
    parent_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        try: child_fd = os.open(leaf, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
        except FileNotFoundError:
            try:
                sidecar_fd = os.open(sidecar, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
                try: sidecar_token = os.read(sidecar_fd, 65).decode('ascii')
                finally: os.close(sidecar_fd)
                if sidecar_token != token: raise RuntimeError('agent-home sidecar ownership mismatch')
                os.unlink(sidecar, dir_fd=parent_fd)
                os.fsync(parent_fd)
            except FileNotFoundError: pass
            continue
        try:
            try:
                sidecar_fd = os.open(sidecar, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
                try: sidecar_token = os.read(sidecar_fd, 65).decode('ascii')
                finally: os.close(sidecar_fd)
                if sidecar_token != token: raise RuntimeError('agent-home sidecar ownership mismatch')
                if os.listdir(child_fd): raise RuntimeError('agent-home contains unowned content')
            except FileNotFoundError:
                marker_fd = os.open('.ade-workspace-import-owner', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=child_fd)
                try: marker = os.read(marker_fd, 65).decode('ascii')
                finally: os.close(marker_fd)
                if marker != token or os.listdir(child_fd) != ['.ade-workspace-import-owner']:
                    raise RuntimeError('agent-home ownership marker mismatch')
                os.rename('.ade-workspace-import-owner', sidecar, src_dir_fd=child_fd, dst_dir_fd=parent_fd)
                os.fsync(child_fd)
                os.fsync(parent_fd)
        finally: os.close(child_fd)
        os.rmdir(leaf, dir_fd=parent_fd)
        os.fsync(parent_fd)
        os.unlink(sidecar, dir_fd=parent_fd)
        os.fsync(parent_fd)
    finally: os.close(parent_fd)
`;

function openNativeParent(canonicalPath: string): { fd: number; leaf: string } {
  const parent = dirname(canonicalPath);
  if (resolve(canonicalPath) !== canonicalPath || lstatSync(parent).isSymbolicLink()
      || !lstatSync(parent).isDirectory() || realpathSync.native(parent) !== parent) {
    throw new Error('workspace import: agent-home target must be absent below an existing parent');
  }
  const before = lstatSync(parent, { bigint: true });
  const directoryFlag = (constants as unknown as Record<string, number>).O_DIRECTORY ?? 0;
  const fd = openSync(parent, constants.O_RDONLY | directoryFlag | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isDirectory() || opened.dev !== before.dev || opened.ino !== before.ino
        || realpathSync.native(`/proc/self/fd/${fd}`) !== parent) {
      throw new Error('workspace import: agent-home parent changed during authorization');
    }
    return { fd, leaf: basename(canonicalPath) };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function ensureNative(canonicalPath: string, ownershipToken: string): string[] {
  const parent = openNativeParent(canonicalPath);
  try {
    const anchored = `/proc/self/fd/${parent.fd}/${parent.leaf}`;
    mkdirSync(anchored, { recursive: false, mode: 0o700 });
    const directoryFlag = (constants as unknown as Record<string, number>).O_DIRECTORY ?? 0;
    const createdFd = openSync(anchored, constants.O_RDONLY | directoryFlag | constants.O_NOFOLLOW);
    try {
      if (!fstatSync(createdFd).isDirectory() || realpathSync.native(`/proc/self/fd/${createdFd}`) !== canonicalPath) {
        throw new Error('workspace import: agent-home identity changed during creation');
      }
      const markerFd = openSync(`/proc/self/fd/${createdFd}/.ade-workspace-import-owner`,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(markerFd, ownershipToken); fsyncSync(markerFd); } finally { closeSync(markerFd); }
      fsyncSync(createdFd);
      fsyncSync(parent.fd);
    } finally { closeSync(createdFd); }
    return [canonicalPath];
  } catch (error) {
    try { rmdirSync(`/proc/self/fd/${parent.fd}/${parent.leaf}`); } catch { /* preserve non-empty paths */ }
    throw error;
  } finally { closeSync(parent.fd); }
}

function rollbackNative(canonicalPath: string, ownershipToken: string): void {
  const parent = openNativeParent(canonicalPath);
  try {
    const sidecarLeaf = `.${parent.leaf}.ade-import-owner-${ownershipToken.slice(0, 16)}`;
    const sidecarPath = `/proc/self/fd/${parent.fd}/${sidecarLeaf}`;
    const markerMatches = (path: string): boolean => {
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = fstatSync(fd);
        return stat.isFile() && stat.nlink === 1 && stat.size === ownershipToken.length
          && readFileSync(fd, 'utf8') === ownershipToken;
      } finally { closeSync(fd); }
    };
    const directoryFlag = (constants as unknown as Record<string, number>).O_DIRECTORY ?? 0;
    let childFd: number;
    try {
      childFd = openSync(`/proc/self/fd/${parent.fd}/${parent.leaf}`,
        constants.O_RDONLY | directoryFlag | constants.O_NOFOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        try {
          if (!markerMatches(sidecarPath)) {
            throw new Error('workspace import: agent-home sidecar ownership mismatch');
          }
          unlinkSync(sidecarPath);
          fsyncSync(parent.fd);
        } catch (sidecarError) {
          if ((sidecarError as NodeJS.ErrnoException).code !== 'ENOENT') throw sidecarError;
        }
        return;
      }
      throw error;
    }
    try {
      const markerPath = `/proc/self/fd/${childFd}/.ade-workspace-import-owner`;
      let sidecarPresent = false;
      try {
        sidecarPresent = markerMatches(sidecarPath);
        if (!sidecarPresent) throw new Error('workspace import: agent-home sidecar ownership mismatch');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (!sidecarPresent) {
        if (!markerMatches(markerPath)
            || readdirSync(`/proc/self/fd/${childFd}`).some((entry) => entry !== '.ade-workspace-import-owner')) {
          throw new Error('workspace import: agent-home ownership marker mismatch');
        }
        renameSync(markerPath, sidecarPath);
        fsyncSync(childFd);
        fsyncSync(parent.fd);
      } else if (readdirSync(`/proc/self/fd/${childFd}`).length !== 0) {
        throw new Error('workspace import: agent-home contains unowned content');
      }
    } finally { closeSync(childFd); }
    rmdirSync(`/proc/self/fd/${parent.fd}/${parent.leaf}`);
    fsyncSync(parent.fd);
    unlinkSync(sidecarPath);
    fsyncSync(parent.fd);
  } finally { closeSync(parent.fd); }
}

function validateCreatedPaths(canonicalPath: string, value: unknown): string[] {
  if (!Array.isArray(value) || value.length !== 1 || value[0] !== canonicalPath) {
    throw new Error('workspace import: backend returned an invalid created-path list');
  }
  const paths = value.map((item) => {
    if (typeof item !== 'string' || !posix.isAbsolute(item) || posix.normalize(item) !== item
        || item.length > 4_096
        || !(canonicalPath === item || canonicalPath.startsWith(`${item}/`))) {
      throw new Error('workspace import: backend returned an unsafe created path');
    }
    return item;
  });
  if (new Set(paths).size !== paths.length) {
    throw new Error('workspace import: backend returned duplicate created paths');
  }
  return paths;
}

export class ExecutionBackendHomeProvisioner implements WorkspaceAgentHomeProvisioner {
  constructor(private readonly execution: ExecutionBackendService) {}

  async ensure(target: WorkspaceTargetMapping, canonicalPath: string, ownershipToken: string): Promise<string[]> {
    if (!/^[a-f0-9]{64}$/.test(ownershipToken)) throw new Error('workspace import: invalid ownership token');
    if (target.backend === 'native') return ensureNative(canonicalPath, ownershipToken);
    const result = await this.execution.text(target.backend, 'python3',
      ['-c', ENSURE_SCRIPT, canonicalPath, ownershipToken], {
      timeoutMs: 15_000,
      maxBuffer: 64 * 1024,
    });
    let parsed: unknown;
    try { parsed = JSON.parse(result); } catch {
      throw new Error('workspace import: backend returned malformed provisioning output');
    }
    return validateCreatedPaths(canonicalPath, parsed);
  }

  async rollback(target: WorkspaceTargetMapping, createdPaths: readonly string[], ownershipToken: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(ownershipToken)) throw new Error('workspace import: invalid ownership token');
    if (createdPaths.length === 0) return;
    if (target.backend === 'native') {
      for (const path of Array.from(createdPaths).reverse()) rollbackNative(path, ownershipToken);
      return;
    }
    await this.execution.checked(target.backend, 'python3', ['-c', ROLLBACK_SCRIPT], {
      input: JSON.stringify({ paths: createdPaths, token: ownershipToken }),
      timeoutMs: 15_000,
      maxBuffer: 64 * 1024,
    });
  }
}
