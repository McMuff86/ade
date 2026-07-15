/**
 * Workspace filesystem helpers (Phase C): depth-limited lazy tree, capped text
 * read, and the pinned "agent files" lookup (MEMORY.md / USER.md / CLAUDE.md /
 * AGENTS.md across workspaceDir + memoryDir).
 *
 * Every path from the renderer is treated as relative to workspaceDir and
 * validated to stay inside it — no traversal. The four pinned filenames are the
 * one exception: fs:read resolves them workspace-first, then memoryDir.
 */

import {
  existsSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import type { Stats } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import type { FsPathInfoResult, FsReadResult, FsRenameResult } from '../../shared/ipc';
import type { AgentFile, FsTreeNode } from '../../shared/types';

const SKIP_DIRS = new Set(['.git', 'node_modules']);
/** Text read cap (~256 KB) per task. */
const READ_CAP = 256 * 1024;

/** The pinned agent-file basenames, in display order. */
export const PINNED_AGENT_FILES = ['MEMORY.md', 'USER.md', 'CLAUDE.md', 'AGENTS.md'] as const;

/** Resolve a renderer-supplied relative path safely inside `root`. Null if it escapes. */
function safeResolve(root: string, rel: string): string | null {
  const cleaned = (rel ?? '').replace(/^[/\\]+/, '');
  if (isAbsolute(cleaned)) return null;
  const abs = normalize(join(root, cleaned));
  const rp = relative(root, abs);
  if (rp.startsWith('..') || isAbsolute(rp)) return null;
  return abs;
}

/** Read one directory level: dirs first, then files, both alphabetical. */
function readLevel(root: string, relDir: string): FsTreeNode[] {
  const abs = safeResolve(root, relDir);
  if (!abs || !existsSync(abs)) return [];
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return [];
  }

  const dirs: FsTreeNode[] = [];
  const files: FsTreeNode[] = [];
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    let isDir = false;
    try {
      isDir = statSync(join(abs, name)).isDirectory();
    } catch {
      continue;
    }
    const childRel = relDir ? `${relDir}/${name}` : name;
    if (isDir) {
      // children left undefined = lazily loaded on expand
      dirs.push({ name, path: childRel, kind: 'dir' });
    } else {
      files.push({ name, path: childRel, kind: 'file' });
    }
  }

  const byName = (a: FsTreeNode, b: FsTreeNode): number =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  dirs.sort(byName);
  files.sort(byName);
  return [...dirs, ...files];
}

/**
 * fs:tree — returns a node whose `children` hold exactly one level. `relPath`
 * empty => the workspace root; otherwise the requested subdirectory (lazy).
 */
export function fsTree(workspaceDir: string, relPath = ''): FsTreeNode {
  const rel = relPath ?? '';
  const name = rel === '' ? '' : rel.split('/').pop() ?? rel;
  if (!existsSync(workspaceDir)) {
    return { name, path: rel, kind: 'dir', children: [] };
  }
  return { name, path: rel, kind: 'dir', children: readLevel(workspaceDir, rel) };
}

/** fs:read — capped text read. Resolves pinned agent files across memoryDir. */
export function fsRead(workspaceDir: string, memoryDir: string, relPath: string): FsReadResult {
  let abs = safeResolve(workspaceDir, relPath);

  // Pinned agent files may live in memoryDir instead of the workspace.
  const base = relPath.split('/').pop() ?? relPath;
  if ((!abs || !existsSync(abs)) && (PINNED_AGENT_FILES as readonly string[]).includes(base)) {
    const memAbs = join(memoryDir, base);
    if (existsSync(memAbs)) abs = memAbs;
  }

  if (!abs || !existsSync(abs)) return { text: '', truncated: false };
  try {
    if (statSync(abs).isDirectory()) return { text: '', truncated: false };
    const buf = readFileSync(abs);
    const truncated = buf.length > READ_CAP;
    const slice = truncated ? buf.subarray(0, READ_CAP) : buf;
    return { text: slice.toString('utf8'), truncated };
  } catch {
    return { text: '', truncated: false };
  }
}

/**
 * fs:pathInfo — resolve a workspace-relative path to its absolute location
 * (pinned agent files fall back to memoryDir, mirroring fs:read).
 */
export function fsPathInfo(
  workspaceDir: string,
  memoryDir: string,
  relPath: string,
): FsPathInfoResult {
  let abs = safeResolve(workspaceDir, relPath);
  let location: FsPathInfoResult['location'] = 'workspace';
  const base = relPath.split('/').pop() ?? relPath;
  if ((!abs || !existsSync(abs)) && (PINNED_AGENT_FILES as readonly string[]).includes(base)) {
    const memAbs = join(memoryDir, base);
    if (existsSync(memAbs)) {
      abs = memAbs;
      location = 'memory';
    }
  }
  if (!abs) throw new Error('ade: path escapes the selected workspace');
  let kind: FsPathInfoResult['kind'] = 'missing';
  try {
    kind = statSync(abs).isDirectory() ? 'dir' : 'file';
  } catch {
    kind = 'missing';
  }
  return { absolutePath: abs, kind, location };
}

/** True when `candidate` is a child of `root` under the host path semantics. */
function isChildPath(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Resolve links/junctions before allowing a mutation. For a missing rename
 * destination, resolve its existing parent and then append the bare basename.
 */
function assertRealPathInsideWorkspace(
  workspaceDir: string,
  candidate: string,
  candidateExists: boolean,
): void {
  const realRoot = realpathSync.native(workspaceDir);
  const realCandidate = candidateExists
    ? realpathSync.native(candidate)
    : join(realpathSync.native(dirname(candidate)), basename(candidate));
  if (!isChildPath(realRoot, realCandidate)) {
    throw new Error('ade: path escapes the selected workspace through a link');
  }
}

/**
 * Reject symlinks/junctions in every workspace-relative path component. This
 * includes the workspace root and the leaf when it exists. Node does not expose
 * directory-handle-relative mutations, so callers repeat this at the mutation.
 */
function assertNoLinkComponents(workspaceDir: string, candidate: string): void {
  const rel = relative(workspaceDir, candidate);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('ade: path escapes the selected workspace');
  }

  const components = rel.split(sep).filter(Boolean);
  let current = workspaceDir;
  const paths = [current];
  for (const component of components) {
    current = join(current, component);
    paths.push(current);
  }

  for (const path of paths) {
    try {
      if (lstatSync(path).isSymbolicLink()) {
        throw new Error('ade: workspace mutation refuses symlink or junction components');
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' && path === paths.at(-1)) return;
      throw error;
    }
  }
}

/** Validate an existing source immediately beside its filesystem mutation. */
function assertMutationBoundary(workspaceDir: string, source: string): void {
  assertNoLinkComponents(workspaceDir, source);
  assertRealPathInsideWorkspace(workspaceDir, source, true);
}

function sameEntry(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

/**
 * Validate and move as one tightly-scoped operation. Node lacks directory-fd
 * relative mutation APIs, so checks cannot eliminate every component-swap race;
 * repeating identity/component checks is the strongest portable fail-closed
 * boundary available without native code.
 */
function moveEntryNoClobber(
  workspaceDir: string,
  source: string,
  target: string,
  privateDirectoryMove: boolean,
): void {
  assertMutationBoundary(workspaceDir, source);
  assertNoLinkComponents(workspaceDir, target);
  const sourceStat = lstatSync(source);
  if (sourceStat.isSymbolicLink()) {
    throw new Error('ade: workspace mutation refuses symlinks or junctions');
  }
  if (sourceStat.isFile()) {
    linkSync(source, target);
    try {
      const linkedStat = lstatSync(target);
      assertMutationBoundary(workspaceDir, source);
      if (!sameEntry(sourceStat, linkedStat) || !sameEntry(sourceStat, lstatSync(source))) {
        throw new Error('ade: workspace entry changed during rename');
      }
      unlinkSync(source);
    } catch (error) {
      try {
        if (sameEntry(sourceStat, lstatSync(target))) unlinkSync(target);
      } catch {
        // Preserve the original error. Two hard links are safer than deleting an
        // uncertain name when rollback itself cannot be completed.
      }
      throw error;
    }
    return;
  }
  if (!sourceStat.isDirectory()) {
    throw new Error('ade: workspace mutation supports only regular files and directories');
  }

  if (privateDirectoryMove || process.platform === 'win32') {
    // Windows rename is natively no-clobber. Delete quarantine instead targets
    // a just-created private random directory on every platform.
    assertMutationBoundary(workspaceDir, source);
    assertNoLinkComponents(workspaceDir, target);
    renameSync(source, target);
    return;
  }
  throw new Error('ade: directory rename is unavailable without atomic no-clobber support');
}

/**
 * Absolute path for a mutating action (rename/delete). Strictly inside the
 * workspace — never the memoryDir scaffold — and must exist.
 */
export function fsMutablePath(workspaceDir: string, relPath: string): string {
  const abs = safeResolve(workspaceDir, relPath);
  if (!abs || relPath.replace(/[/\\]+/g, '') === '') {
    throw new Error('ade: path escapes the selected workspace');
  }
  if (normalize(abs) === normalize(workspaceDir)) {
    throw new Error('ade: refusing to act on the workspace root');
  }
  if (!existsSync(abs)) throw new Error(`ade: not found in the workspace: "${relPath}"`);
  assertMutationBoundary(workspaceDir, abs);
  return abs;
}

/** fs:rename — rename within the entry's directory; never overwrites. */
export function fsRename(
  workspaceDir: string,
  relPath: string,
  newName: string,
): FsRenameResult {
  if (/[/\\]/.test(newName) || newName === '.' || newName === '..' || !newName.trim()) {
    throw new Error('ade: newName must be a bare file or folder name');
  }
  const abs = fsMutablePath(workspaceDir, relPath);
  const target = join(dirname(abs), newName);
  assertNoLinkComponents(workspaceDir, target);
  if (existsSync(target)) throw new Error(`ade: "${newName}" already exists here`);

  // Repeat component checks directly beside the operation. Regular files use
  // link(2), whose destination creation is itself atomic no-clobber.
  assertMutationBoundary(workspaceDir, abs);
  assertNoLinkComponents(workspaceDir, target);
  try {
    moveEntryNoClobber(workspaceDir, abs, target, false);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`ade: "${newName}" already exists here`);
    }
    throw error;
  }
  const relDir = relPath.split('/').slice(0, -1).join('/');
  return { path: relDir ? `${relDir}/${newName}` : newName };
}

/**
 * Move an entry out of its visible name before awaiting the OS trash. The
 * private random directory makes destination interference impractical and lets
 * directory deletion work without claiming general POSIX no-clobber rename.
 */
function quarantineForDelete(workspaceDir: string, relPath: string): {
  quarantineDir: string;
  quarantinedPath: string;
} {
  const source = fsMutablePath(workspaceDir, relPath);
  const quarantineDir = mkdtempSync(join(workspaceDir, '.ade-trash-'));
  const quarantinedPath = join(quarantineDir, basename(source));
  try {
    assertMutationBoundary(workspaceDir, source);
    assertNoLinkComponents(workspaceDir, quarantineDir);
    moveEntryNoClobber(workspaceDir, source, quarantinedPath, true);
    return { quarantineDir, quarantinedPath };
  } catch (error) {
    try {
      rmdirSync(quarantineDir);
    } catch {
      // Keep any non-empty quarantine intact rather than risk data loss.
    }
    throw error;
  }
}

/** Delete via synchronous in-workspace quarantine followed by asynchronous trash. */
export async function fsDelete(
  workspaceDir: string,
  relPath: string,
  trashItem: (path: string) => Promise<void>,
): Promise<void> {
  const { quarantineDir, quarantinedPath } = quarantineForDelete(workspaceDir, relPath);
  await trashItem(quarantinedPath);
  try {
    rmdirSync(quarantineDir);
  } catch {
    // Leave an unexpectedly non-empty quarantine for inspection. Never recurse
    // after trash reports success, because another process could have added it.
  }
}

/** Which pinned agent files exist, in workspaceDir (preferred) or memoryDir. */
export function agentFiles(workspaceDir: string, memoryDir: string): AgentFile[] {
  const out: AgentFile[] = [];
  for (const name of PINNED_AGENT_FILES) {
    if (existsSync(join(workspaceDir, name))) {
      out.push({ name, path: name, location: 'workspace' });
    } else if (existsSync(join(memoryDir, name))) {
      out.push({ name, path: name, location: 'memory' });
    }
  }
  return out;
}
