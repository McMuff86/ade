/**
 * Workspace filesystem helpers (Phase C): depth-limited lazy tree, capped text
 * read, and the pinned "agent files" lookup (MEMORY.md / USER.md / CLAUDE.md /
 * AGENTS.md across workspaceDir + memoryDir).
 *
 * Every path from the renderer is treated as relative to workspaceDir and
 * validated to stay inside it — no traversal. The four pinned filenames are the
 * one exception: fs:read resolves them workspace-first, then memoryDir.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, relative } from 'node:path';
import type { FsReadResult } from '../../shared/ipc';
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
