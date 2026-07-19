import { posix } from 'node:path';
import type { ExecutionBackendId } from '../../shared/executionBackends';
import { NATIVE_EXECUTION_BACKEND, normalizeExecutionBackendId } from '../../shared/executionBackends';
import type { GitFileChange, GitFileState, GitStatus } from '../../shared/types';
import {
  createAgentWorktree,
  gitDiff,
  gitShowCommit,
  gitStatus,
  isGitRepo,
  removeAgentWorktree,
  repositoryIdentity,
  type CreateWorktreeResult,
  type RepositoryIdentity,
} from '../git/GitService';
import { ExecutionBackendService, decodeOutput } from './ExecutionBackendService';

const DIFF_CAP_BYTES = 1024 * 1024;
const UNTRACKED_READ_CAP = 512 * 1024;

export interface CommitView {
  title: string;
  files: { path: string; additions: number; deletions: number }[];
  diff: string;
}

/** Backend-aware Git facade. Native calls retain their proven implementation. */
export class BackendGitService {
  constructor(private readonly execution = new ExecutionBackendService()) {}

  async isRepository(backendValue: ExecutionBackendId | undefined, path: string): Promise<boolean> {
    const backend = normalizeExecutionBackendId(backendValue);
    if (backend === NATIVE_EXECUTION_BACKEND) return isGitRepo(path);
    const result = await this.execution.run(backend, 'git', ['-C', path, 'rev-parse', '--is-inside-work-tree'], {
      timeoutMs: 10_000,
    });
    if (result.code === 0) return decodeOutput(result.stdout).trim() === 'true';
    // A missing path is a normal "not a repository" result. A backend that
    // disappeared after configuration is not: surface that boundary failure
    // instead of silently presenting the repository as empty.
    await this.execution.checked(backend, 'true', [], { timeoutMs: 10_000, maxBuffer: 64 * 1024 });
    return false;
  }

  async identity(backendValue: ExecutionBackendId | undefined, path: string): Promise<RepositoryIdentity> {
    const backend = normalizeExecutionBackendId(backendValue);
    if (backend === NATIVE_EXECUTION_BACKEND) return repositoryIdentity(path);
    const canonical = await this.execution.canonicalPath(backend, path);
    if (!(await this.isRepository(backend, canonical))) {
      throw new Error(`ade: not a git repository in ${backend}: ${path}`);
    }
    const [commonRaw, worktreesRaw] = await Promise.all([
      this.gitText(backend, canonical, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
      this.gitText(backend, canonical, ['worktree', 'list', '--porcelain']),
    ]);
    const firstWorktree = worktreesRaw
      .split(/\r?\n/)
      .find((line) => line.startsWith('worktree '))
      ?.slice('worktree '.length)
      .trim();
    return {
      rootPath: await this.execution.canonicalPath(backend, firstWorktree || canonical),
      commonGitDir: await this.execution.canonicalPath(backend, commonRaw.trim()),
    };
  }

  async status(backendValue: ExecutionBackendId | undefined, workspaceDir: string): Promise<GitStatus> {
    const backend = normalizeExecutionBackendId(backendValue);
    if (backend === NATIVE_EXECUTION_BACKEND) return gitStatus(workspaceDir);
    const empty: GitStatus = { isRepo: false, branch: '', ahead: 0, behind: 0, files: [] };
    if (!(await this.isRepository(backend, workspaceDir))) return empty;
    try {
      const raw = await this.gitText(backend, workspaceDir, [
        'status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all',
      ]);
      const records = raw.split('\0');
      const branchRecord = records[0]?.startsWith('## ') ? records.shift()! : '';
      const branchInfo = parseBranch(branchRecord);
      const entries: Array<{ path: string; state: GitFileState }> = [];
      for (let index = 0; index < records.length; index += 1) {
        const record = records[index]!;
        if (!record) continue;
        const xy = record.slice(0, 2);
        const path = record.slice(3);
        const state = toState(xy[0] ?? ' ', xy[1] ?? ' ');
        entries.push({ path, state });
        if (state === 'renamed') index += 1; // porcelain -z emits the original path next
      }
      let counts = new Map<string, { additions: number; deletions: number }>();
      try {
        counts = parseNumstat(await this.gitText(backend, workspaceDir, [
          'diff', '--numstat', '-z', '--no-renames', 'HEAD', '--',
        ]));
      } catch {
        // Unborn repositories legitimately have no HEAD.
      }
      const files: GitFileChange[] = [];
      for (const entry of entries) {
        const count = counts.get(entry.path);
        let additions = count?.additions ?? 0;
        const deletions = count?.deletions ?? 0;
        if (entry.state === 'untracked' && !count) {
          additions = await this.untrackedAdditions(backend, posix.join(workspaceDir, entry.path));
        }
        files.push({ path: entry.path, state: entry.state, additions, deletions });
      }
      return { isRepo: true, ...branchInfo, files };
    } catch {
      await this.execution.checked(backend, 'true', [], { timeoutMs: 10_000, maxBuffer: 64 * 1024 });
      return empty;
    }
  }

  async diff(
    backendValue: ExecutionBackendId | undefined,
    workspaceDir: string,
    relPath: string,
  ): Promise<string> {
    const backend = normalizeExecutionBackendId(backendValue);
    if (backend === NATIVE_EXECUTION_BACKEND) return gitDiff(workspaceDir, relPath);
    if (!(await this.isRepository(backend, workspaceDir))) return '';
    try {
      const status = await this.status(backend, workspaceDir);
      const entry = status.files.find((file) => file.path === relPath);
      if (entry?.state === 'untracked') {
        const result = await this.execution.checked(backend, 'head', [
          '-c', String(DIFF_CAP_BYTES + 1), '--', posix.join(workspaceDir, relPath),
        ], { maxBuffer: DIFF_CAP_BYTES + 2 });
        const bytes = result.stdout.subarray(0, DIFF_CAP_BYTES);
        if (bytes.includes(0)) return `diff --git a/${relPath} b/${relPath}\n(binary file)`;
        const text = bytes.toString('utf8');
        const lines = text.length ? text.replace(/\n$/, '').split('\n') : [];
        const body = lines.map((line) => `+${line}`).join('\n');
        return cap(`diff --git a/${relPath} b/${relPath}\nnew file\n@@ -0,0 +1,${lines.length} @@\n${body}`);
      }
      return cap(await this.gitText(backend, workspaceDir, ['diff', 'HEAD', '--', relPath], DIFF_CAP_BYTES + 1));
    } catch {
      return '';
    }
  }

  async showCommit(
    backendValue: ExecutionBackendId | undefined,
    workspaceDir: string,
    sha: string,
  ): Promise<CommitView> {
    const backend = normalizeExecutionBackendId(backendValue);
    if (backend === NATIVE_EXECUTION_BACKEND) return gitShowCommit(workspaceDir, sha);
    if (!(await this.isRepository(backend, workspaceDir))) return { title: '', files: [], diff: '' };
    try {
      const [title, numstat, diff] = await Promise.all([
        this.gitText(backend, workspaceDir, ['log', '-1', '--format=%s', sha]),
        this.gitText(backend, workspaceDir, ['show', '--numstat', '-z', '--no-renames', '--format=', sha]),
        this.gitText(backend, workspaceDir, ['show', '--format=', sha], DIFF_CAP_BYTES + 1),
      ]);
      const files = [...parseNumstat(numstat)].map(([path, counts]) => ({ path, ...counts }));
      return { title: title.trim(), files, diff: cap(diff) };
    } catch {
      return { title: '', files: [], diff: '' };
    }
  }

  async createWorktree(
    backendValue: ExecutionBackendId | undefined,
    params: { repoPath: string; agentSlug: string; worktreePath: string },
  ): Promise<CreateWorktreeResult> {
    const backend = normalizeExecutionBackendId(backendValue);
    if (backend === NATIVE_EXECUTION_BACKEND) return createAgentWorktree(params);
    const branches = new Set((await this.gitText(backend, params.repoPath, [
      'branch', '--format=%(refname:short)',
    ])).split('\n').map((line) => line.trim()).filter(Boolean));
    let branch = `ade/${params.agentSlug}`;
    if (branches.has(branch)) {
      let suffix = 2;
      while (branches.has(`ade/${params.agentSlug}-${suffix}`)) suffix += 1;
      branch = `ade/${params.agentSlug}-${suffix}`;
    }
    await this.execution.mkdir(backend, posix.dirname(params.worktreePath));
    const add = async (hooksOff: boolean): Promise<void> => {
      const result = await this.execution.run(backend, 'git', [
        '-C', params.repoPath,
        ...(hooksOff ? ['-c', 'core.hooksPath=/dev/null'] : []),
        'worktree', 'add', '-b', branch, params.worktreePath, 'HEAD',
      ], { timeoutMs: 120_000 });
      if (result.code !== 0) {
        const error = new Error(decodeOutput(result.stderr) || `git worktree add exited ${result.code}`);
        (error as Error & { stderr?: string }).stderr = decodeOutput(result.stderr);
        throw error;
      }
    };
    try {
      await add(false);
    } catch (error) {
      if (await this.worktreeRegistered(backend, params.repoPath, params.worktreePath)) {
        console.warn(`[ade/git] WSL worktree add reported an error after registration: ${params.worktreePath}`);
      } else if (looksLikeHookFailure(error)) {
        await add(true);
      } else {
        throw error;
      }
    }
    if (!(await this.worktreeRegistered(backend, params.repoPath, params.worktreePath))) {
      throw new Error('ade: WSL Git did not register the requested worktree');
    }
    return { worktreePath: params.worktreePath, branch };
  }

  async removeWorktree(
    backendValue: ExecutionBackendId | undefined,
    repoPath: string,
    worktreePath: string,
    branch: string,
    options: { branchDelete?: 'force' | 'if-merged' } = {},
  ): Promise<{ branchDeleted: boolean }> {
    const backend = normalizeExecutionBackendId(backendValue);
    if (backend === NATIVE_EXECUTION_BACKEND) {
      return removeAgentWorktree(repoPath, worktreePath, branch, options);
    }
    await this.execution.checked(backend, 'git', [
      '-C', repoPath, 'worktree', 'remove', '--force', worktreePath,
    ], { timeoutMs: 120_000 });
    if (!branch.startsWith('ade/')) return { branchDeleted: false };
    const mode = options.branchDelete ?? 'force';
    const result = await this.execution.run(backend, 'git', [
      '-C', repoPath, 'branch', mode === 'force' ? '-D' : '-d', branch,
    ], { timeoutMs: 120_000 });
    if (result.code === 0) return { branchDeleted: true };
    if (mode === 'if-merged') return { branchDeleted: false };
    throw new Error(`ade: failed to remove WSL worktree branch: ${decodeOutput(result.stderr).trim()}`);
  }

  private async gitText(
    backend: ExecutionBackendId,
    workspaceDir: string,
    args: string[],
    maxBuffer = 4 * 1024 * 1024,
  ): Promise<string> {
    return this.execution.text(backend, 'git', ['-C', workspaceDir, ...args], {
      timeoutMs: 120_000,
      maxBuffer,
    });
  }

  private async untrackedAdditions(backend: ExecutionBackendId, path: string): Promise<number> {
    try {
      const result = await this.execution.checked(backend, 'head', [
        '-c', String(UNTRACKED_READ_CAP), '--', path,
      ], { maxBuffer: UNTRACKED_READ_CAP + 1 });
      if (result.stdout.includes(0) || result.stdout.length === 0) return 0;
      const text = result.stdout.toString('utf8');
      const lines = text.split('\n').length;
      return text.endsWith('\n') ? lines - 1 : lines;
    } catch {
      return 0;
    }
  }

  private async worktreeRegistered(
    backend: ExecutionBackendId,
    repoPath: string,
    worktreePath: string,
  ): Promise<boolean> {
    try {
      const output = await this.gitText(backend, repoPath, ['worktree', 'list', '--porcelain']);
      const wanted = this.execution.pathKey(backend, worktreePath);
      return output.split('\n')
        .filter((line) => line.startsWith('worktree '))
        .some((line) => this.execution.pathKey(backend, line.slice('worktree '.length).trim()) === wanted);
    } catch {
      return false;
    }
  }
}

export function parseBranch(record: string): Pick<GitStatus, 'branch' | 'ahead' | 'behind'> {
  const text = record.replace(/^##\s*/, '');
  const tracking = /\[ahead (\d+)(?:, behind (\d+))?\]|\[behind (\d+)\]/.exec(text);
  const ahead = Number.parseInt(tracking?.[1] ?? '0', 10) || 0;
  const behind = Number.parseInt(tracking?.[2] ?? tracking?.[3] ?? '0', 10) || 0;
  const branchText = text.replace(/^No commits yet on /, '');
  const branch = branchText.split('...')[0]!.split(' ')[0]!.trim();
  return { branch: branch === 'HEAD' ? '' : branch, ahead, behind };
}

function toState(index: string, working: string): GitFileState {
  if (index === '?' || working === '?') return 'untracked';
  if (index === 'R' || working === 'R') return 'renamed';
  if (index === 'A') return 'added';
  if (index === 'D' || working === 'D') return 'deleted';
  return 'modified';
}

function parseNumstat(raw: string): Map<string, { additions: number; deletions: number }> {
  const map = new Map<string, { additions: number; deletions: number }>();
  for (const record of raw.split('\0')) {
    if (!record) continue;
    const first = record.indexOf('\t');
    const second = first < 0 ? -1 : record.indexOf('\t', first + 1);
    if (first < 0 || second < 0) continue;
    const added = record.slice(0, first);
    const deleted = record.slice(first + 1, second);
    const path = record.slice(second + 1);
    if (!path) continue;
    map.set(path, {
      additions: added === '-' ? 0 : Number.parseInt(added, 10) || 0,
      deletions: deleted === '-' ? 0 : Number.parseInt(deleted, 10) || 0,
    });
  }
  return map;
}

function cap(text: string): string {
  if (Buffer.byteLength(text) <= DIFF_CAP_BYTES) return text;
  const prefix = Buffer.from(text).subarray(0, DIFF_CAP_BYTES).toString('utf8');
  return `${prefix}\n… (diff truncated at ${DIFF_CAP_BYTES} bytes)`;
}

function looksLikeHookFailure(error: unknown): boolean {
  const detail = error as { message?: string; stderr?: string };
  const text = `${detail.message ?? ''}\n${detail.stderr ?? ''}`.toLowerCase();
  return text.includes('post-checkout')
    || text.includes('hook')
    || text.includes('husky')
    || text.includes('command not found');
}
