import {
  closeSync, fstatSync, mkdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, posix, resolve } from 'node:path';
import type { ExecutionBackendService } from '../execution/ExecutionBackendService';
import type { WorkspaceAgentHomeProvisioner } from './WorkspaceImportService';
import type { WorkspaceTargetMapping } from './WorkspaceImportPlanner';
import type { ManagedAnchor } from './managed/ManagedHost';
import { createManagedHost } from './managed/createManagedHost';
import {
  IMPORT_OWNER_MARKER, assertManagedComponent, importOwnerSidecar,
} from './managed/ManagedPathNames';

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

/**
 * Anchor the directory the agent home will be created in.
 *
 * The parent is anchored through the managed host, which gives each platform
 * its best available guarantee and — importantly on Windows — does NOT require
 * the caller's spelling to equal the canonical one. `os.tmpdir()` yields an 8.3
 * short name on Windows that `realpathSync.native` expands, and the probe hands
 * back whichever form the user's mapping used.
 */
function openNativeParent(canonicalPath: string): { anchor: ManagedAnchor; leaf: string } {
  const host = createManagedHost();
  const parent = dirname(canonicalPath);
  const leaf = basename(canonicalPath);
  if (resolve(canonicalPath) !== canonicalPath) {
    throw new Error('workspace import: agent-home target must be absent below an existing parent');
  }
  try {
    assertManagedComponent(leaf, host.platform);
  } catch {
    throw new Error('workspace import: agent-home target must be absent below an existing parent');
  }
  let anchor: ManagedAnchor;
  try {
    anchor = host.anchorRoot(parent);
  } catch {
    throw new Error('workspace import: agent-home target must be absent below an existing parent');
  }
  return { anchor, leaf };
}

function ensureNative(canonicalPath: string, ownershipToken: string): string[] {
  const host = createManagedHost();
  const parent = openNativeParent(canonicalPath);
  try {
    // Exclusive on purpose: the contract is that the target is absent, so an
    // existing entry must fail rather than be adopted.
    mkdirSync(`${parent.anchor.addr}/${parent.leaf}`, { recursive: false, mode: 0o700 });
    // openDir re-checks that this resolves to exactly one component below the
    // anchored parent and is not a link, on either host.
    const created = host.openDir(parent.anchor, parent.leaf);
    try {
      const markerFd = host.createFile(created, IMPORT_OWNER_MARKER, 0o600);
      try { writeFileSync(markerFd, ownershipToken); host.syncFile(markerFd); } finally { closeSync(markerFd); }
      host.syncDir(created);
      host.syncDir(parent.anchor);
    } finally { created.close(); }
    return [canonicalPath];
  } catch (error) {
    try { rmdirSync(`${parent.anchor.addr}/${parent.leaf}`); } catch { /* preserve non-empty paths */ }
    throw error;
  } finally { parent.anchor.close(); }
}

function rollbackNative(canonicalPath: string, ownershipToken: string): void {
  const host = createManagedHost();
  const parent = openNativeParent(canonicalPath);
  try {
    const sidecarLeaf = importOwnerSidecar(parent.leaf, ownershipToken);
    const sidecarPath = `${parent.anchor.addr}/${sidecarLeaf}`;
    const holdsToken = (fd: number): boolean => {
      const stat = fstatSync(fd);
      return stat.isFile() && stat.nlink === 1 && stat.size === ownershipToken.length
        && readFileSync(fd, 'utf8') === ownershipToken;
    };
    const sidecarMatches = (): boolean => {
      const fd = host.openFile(parent.anchor, sidecarLeaf);
      try { return holdsToken(fd); } finally { closeSync(fd); }
    };

    let child: ManagedAnchor;
    try {
      child = host.openDir(parent.anchor, parent.leaf);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        try {
          if (!sidecarMatches()) {
            throw new Error('workspace import: agent-home sidecar ownership mismatch');
          }
          unlinkSync(sidecarPath);
          host.syncDir(parent.anchor);
        } catch (sidecarError) {
          if ((sidecarError as NodeJS.ErrnoException).code !== 'ENOENT') throw sidecarError;
        }
        return;
      }
      throw error;
    }
    try {
      let sidecarPresent = false;
      try {
        sidecarPresent = sidecarMatches();
        if (!sidecarPresent) throw new Error('workspace import: agent-home sidecar ownership mismatch');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (!sidecarPresent) {
        const markerFd = host.openFile(child, IMPORT_OWNER_MARKER);
        let markerHeld: boolean;
        try { markerHeld = holdsToken(markerFd); } finally { closeSync(markerFd); }
        if (!markerHeld || host.entries(child).some((entry) => entry !== IMPORT_OWNER_MARKER)) {
          throw new Error('workspace import: agent-home ownership marker mismatch');
        }
        renameSync(`${child.addr}/${IMPORT_OWNER_MARKER}`, sidecarPath);
        host.syncDir(child);
        host.syncDir(parent.anchor);
      } else if (host.entries(child).length !== 0) {
        throw new Error('workspace import: agent-home contains unowned content');
      }
    } finally { child.close(); }
    rmdirSync(`${parent.anchor.addr}/${parent.leaf}`);
    host.syncDir(parent.anchor);
    unlinkSync(sidecarPath);
    host.syncDir(parent.anchor);
  } finally { parent.anchor.close(); }
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
