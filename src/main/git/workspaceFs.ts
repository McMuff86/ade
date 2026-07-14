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
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
} from 'node:fs';
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
  assertRealPathInsideWorkspace(workspaceDir, abs, true);
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
  assertRealPathInsideWorkspace(workspaceDir, target, existsSync(target));
  if (existsSync(target)) throw new Error(`ade: "${newName}" already exists here`);
  renameSync(abs, target);
  const relDir = relPath.split('/').slice(0, -1).join('/');
  return { path: relDir ? `${relDir}/${newName}` : newName };
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
