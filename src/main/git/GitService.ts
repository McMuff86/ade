/**
 * GitService (Phase C) — status/diff for an agent workspace, plus the worktree
 * lifecycle used when a category is backed by a git repo.
 *
 * Patterns ported (not imported) from Superset's changes/status + workspaces
 * worktree utils: porcelain status → per-file state, numstat for +/- counts,
 * and post-checkout hook tolerance on `git worktree add`.
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import simpleGit, { type SimpleGit } from 'simple-git';
import type { GitFileChange, GitFileState, GitStatus } from '../../shared/types';

const execFileAsync = promisify(execFile);

/** Diff text is capped so a huge file can't flood the IPC channel / renderer. */
const DIFF_CAP_BYTES = 1024 * 1024; // ~1 MB
/** Untracked files are read to count added lines; cap the read for safety. */
const UNTRACKED_READ_CAP = 512 * 1024;

function git(dir: string): SimpleGit {
  return simpleGit({ baseDir: dir, maxConcurrentProcesses: 1 });
}

/** True when `dir` exists and sits inside a git working tree/worktree. */
export async function isGitRepo(dir: string): Promise<boolean> {
  if (!dir || !existsSync(dir)) return false;
  try {
    const out = await git(dir).raw(['rev-parse', '--is-inside-work-tree']);
    return out.trim() === 'true';
  } catch {
    return false;
  }
}

/** Map a porcelain XY status pair to our coarse file state. */
function toState(index: string, working: string): GitFileState {
  if (index === '?' || working === '?') return 'untracked';
  if (index === 'R' || working === 'R') return 'renamed';
  if (index === 'A') return 'added';
  if (index === 'D' || working === 'D') return 'deleted';
  return 'modified';
}

/** Parse `git diff --numstat` output into a path → {additions,deletions} map. */
function parseNumstat(raw: string): Map<string, { additions: number; deletions: number }> {
  const map = new Map<string, { additions: number; deletions: number }>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [addStr, delStr, ...rest] = parts;
    let path = rest.join('\t');
    // Renames render as "old => new" or "dir/{old => new}/x" — keep the new path.
    const arrow = path.indexOf(' => ');
    if (arrow !== -1) {
      path = path
        .replace(/\{[^}]*=>\s*([^}]*)\}/g, '$1')
        .replace(/^.*\s=>\s/, '')
        .replace(/\/\//g, '/');
    }
    const additions = addStr === '-' ? 0 : Number.parseInt(addStr, 10) || 0;
    const deletions = delStr === '-' ? 0 : Number.parseInt(delStr, 10) || 0;
    map.set(path, { additions, deletions });
  }
  return map;
}

/** Count lines in an untracked file (added lines), read-capped and honest. */
function untrackedAdditions(absPath: string): number {
  try {
    const buf = readFileSync(absPath);
    const slice = buf.length > UNTRACKED_READ_CAP ? buf.subarray(0, UNTRACKED_READ_CAP) : buf;
    if (slice.includes(0)) return 0; // binary — don't pretend to count lines
    const text = slice.toString('utf8');
    if (text.length === 0) return 0;
    const lines = text.split('\n').length;
    // trailing newline shouldn't add a phantom line
    return text.endsWith('\n') ? lines - 1 : lines;
  } catch {
    return 0;
  }
}

/**
 * git:status for an agent workspace. Never throws for a non-repo dir — returns
 * { isRepo:false, ... }. Counts cover staged + unstaged (vs HEAD) plus untracked
 * (as added lines).
 */
export async function gitStatus(workspaceDir: string): Promise<GitStatus> {
  const empty: GitStatus = { isRepo: false, branch: '', ahead: 0, behind: 0, files: [] };
  if (!(await isGitRepo(workspaceDir))) return empty;

  const g = git(workspaceDir);
  try {
    const status = await g.status();
    const branch = status.current ?? '';

    // numstat vs HEAD covers all tracked staged+unstaged changes. If HEAD is
    // unborn (no commits yet), fall back to numstat vs the empty tree.
    let numstat = new Map<string, { additions: number; deletions: number }>();
    try {
      numstat = parseNumstat(await g.raw(['diff', '--numstat', 'HEAD']));
    } catch {
      try {
        numstat = parseNumstat(await g.raw(['diff', '--numstat']));
      } catch {
        /* leave empty */
      }
    }

    const files: GitFileChange[] = status.files.map((f) => {
      const state = toState(f.index, f.working_dir);
      const counts = numstat.get(f.path);
      let additions = counts?.additions ?? 0;
      let deletions = counts?.deletions ?? 0;
      if (state === 'untracked' && !counts) {
        additions = untrackedAdditions(join(workspaceDir, f.path));
        deletions = 0;
      }
      return { path: f.path, additions, deletions, state };
    });

    return {
      isRepo: true,
      branch,
      ahead: status.ahead ?? 0,
      behind: status.behind ?? 0,
      files,
    };
  } catch {
    return empty;
  }
}

/**
 * git:diff for one file — combined staged+unstaged vs HEAD. Untracked files are
 * rendered as an all-additions synthetic diff. Output is capped at ~1 MB.
 */
export async function gitDiff(workspaceDir: string, relPath: string): Promise<string> {
  if (!(await isGitRepo(workspaceDir))) return '';
  const g = git(workspaceDir);

  try {
    const status = await g.status();
    const isUntracked = status.not_added.includes(relPath) || status.created.includes(relPath);

    if (isUntracked) {
      const abs = join(workspaceDir, relPath);
      let text = '';
      try {
        const buf = readFileSync(abs);
        const slice = buf.length > DIFF_CAP_BYTES ? buf.subarray(0, DIFF_CAP_BYTES) : buf;
        if (slice.includes(0)) return `diff --git a/${relPath} b/${relPath}\n(binary file)`;
        text = slice.toString('utf8');
      } catch {
        return '';
      }
      const lines = text.length ? text.replace(/\n$/, '').split('\n') : [];
      const body = lines.map((l) => `+${l}`).join('\n');
      const header = `diff --git a/${relPath} b/${relPath}\nnew file\n@@ -0,0 +1,${lines.length} @@`;
      return cap(`${header}\n${body}`);
    }

    const diff = await g.raw(['diff', 'HEAD', '--', relPath]);
    return cap(diff);
  } catch {
    return '';
  }
}

function cap(text: string): string {
  if (text.length <= DIFF_CAP_BYTES) return text;
  return `${text.slice(0, DIFF_CAP_BYTES)}\n… (diff truncated at ${DIFF_CAP_BYTES} bytes)`;
}

/* --------------------------------------------------------------- worktrees */

const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';

/** Local branch names in a repo (best-effort; [] on failure). */
async function localBranches(repoPath: string): Promise<Set<string>> {
  try {
    const out = await git(repoPath).raw(['branch', '--format=%(refname:short)']);
    return new Set(out.split('\n').map((l) => l.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

/** True when a worktree at `worktreePath` is registered in the repo. */
async function worktreeRegistered(repoPath: string, worktreePath: string): Promise<boolean> {
  try {
    const out = await git(repoPath).raw(['worktree', 'list', '--porcelain']);
    const want = worktreePath.replace(/\\/g, '/').toLowerCase();
    return out
      .split('\n')
      .filter((l) => l.startsWith('worktree '))
      .some((l) => l.slice('worktree '.length).trim().replace(/\\/g, '/').toLowerCase() === want);
  } catch {
    return false;
  }
}

function looksLikeHookFailure(err: unknown): boolean {
  const e = err as { message?: string; stderr?: string; stdout?: string };
  const text = `${e?.message ?? ''}\n${e?.stderr ?? ''}\n${e?.stdout ?? ''}`.toLowerCase();
  return (
    text.includes('post-checkout') ||
    text.includes('hook') ||
    text.includes('husky') ||
    text.includes('command not found')
  );
}

export interface CreateWorktreeResult {
  worktreePath: string;
  branch: string;
}

/**
 * Create a git worktree for an agent: a fresh branch `ade/<slug>` (unique-
 * suffixed on collision) checked out from the repo's HEAD, at `worktreePath`.
 *
 * Tolerant of failing post-checkout hooks: if `git worktree add` errors but the
 * worktree is registered anyway, we keep it; otherwise we retry once with hooks
 * disabled (core.hooksPath = null device). Throws only if no worktree results.
 */
export async function createAgentWorktree(params: {
  repoPath: string;
  agentSlug: string;
  worktreePath: string;
}): Promise<CreateWorktreeResult> {
  const { repoPath, agentSlug, worktreePath } = params;

  const taken = await localBranches(repoPath);
  let branch = `ade/${agentSlug}`;
  if (taken.has(branch)) {
    let n = 2;
    while (taken.has(`ade/${agentSlug}-${n}`)) n += 1;
    branch = `ade/${agentSlug}-${n}`;
  }

  mkdirSync(dirname(worktreePath), { recursive: true });

  const addArgs = (hooksOff: boolean): string[] => [
    '-C',
    repoPath,
    ...(hooksOff ? ['-c', `core.hooksPath=${NULL_DEVICE}`] : []),
    'worktree',
    'add',
    '-b',
    branch,
    worktreePath,
    'HEAD',
  ];

  const run = async (hooksOff: boolean): Promise<void> => {
    await execFileAsync('git', addArgs(hooksOff), { timeout: 120_000 });
  };

  try {
    await run(false);
  } catch (err) {
    // Hook-tolerance: worktree may exist despite a hook's non-zero exit.
    if (await worktreeRegistered(repoPath, worktreePath)) {
      console.warn(
        `[ade/git] worktree add reported an error but the worktree exists (hook non-fatal): ${worktreePath}`,
      );
    } else if (looksLikeHookFailure(err)) {
      // Retry once with hooks disabled.
      await run(true);
      if (!(await worktreeRegistered(repoPath, worktreePath))) {
        throw err;
      }
    } else {
      throw err;
    }
  }

  return { worktreePath, branch };
}
