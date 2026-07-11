import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_WORKER_COMMITS = 50;

export interface WorkspaceInspection {
  workspaceDir: string;
  isRepo: boolean;
  clean: boolean;
  branch: string;
  headSha: string;
  commonGitDir: string;
}

export interface WorkspacePort {
  inspect(workspaceDir: string): Promise<WorkspaceInspection>;
  validateCommit(workspaceDir: string, baseSha: string, commitSha: string): Promise<string[]>;
  integrateCommits(workspaceDir: string, commits: string[]): Promise<number>;
}

export class WorkspaceService implements WorkspacePort {
  async inspect(workspaceDir: string): Promise<WorkspaceInspection> {
    if (!workspaceDir || !existsSync(workspaceDir)) {
      return { workspaceDir, isRepo: false, clean: true, branch: '', headSha: '', commonGitDir: '' };
    }
    workspaceDir = realpathSync.native(workspaceDir);
    let inside = false;
    try {
      inside = (await git(workspaceDir, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true';
    } catch {
      return { workspaceDir, isRepo: false, clean: true, branch: '', headSha: '', commonGitDir: '' };
    }
    if (!inside) return { workspaceDir, isRepo: false, clean: true, branch: '', headSha: '', commonGitDir: '' };
    try {
      const [status, branch, headSha, commonRaw] = await Promise.all([
        git(workspaceDir, ['status', '--porcelain=v1', '--untracked-files=all']),
        git(workspaceDir, ['branch', '--show-current']),
        git(workspaceDir, ['rev-parse', 'HEAD']),
        git(workspaceDir, ['rev-parse', '--git-common-dir']),
      ]);
      const common = commonRaw.trim();
      return {
        workspaceDir,
        isRepo: true,
        clean: status.trim().length === 0,
        branch: branch.trim(),
        headSha: headSha.trim(),
        commonGitDir: canonicalPath(isAbsolute(common) ? common : resolve(workspaceDir, common)),
      };
    } catch (error) {
      throw new Error(`ade: failed to inspect git worktree ${workspaceDir}: ${errorMessage(error)}`);
    }
  }

  async validateCommit(workspaceDir: string, baseSha: string, commitSha: string): Promise<string[]> {
    await git(workspaceDir, ['cat-file', '-e', `${commitSha}^{commit}`]);
    try {
      await git(workspaceDir, ['merge-base', '--is-ancestor', baseSha, commitSha]);
    } catch {
      throw new Error(`ade: commit ${commitSha} is not based on the leased workspace HEAD`);
    }
    const raw = await git(workspaceDir, ['rev-list', '--reverse', '--topo-order', `${baseSha}..${commitSha}`]);
    const commits = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (commits.length === 0) throw new Error(`ade: commit ${commitSha} contains no work after the leased base`);
    if (commits.length > MAX_WORKER_COMMITS) {
      throw new Error(`ade: worker commit range exceeds ${MAX_WORKER_COMMITS} commits`);
    }
    const parents = await git(workspaceDir, ['rev-list', '--parents', `${baseSha}..${commitSha}`]);
    if (parents.split(/\r?\n/).some((line) => line.trim().split(/\s+/).filter(Boolean).length > 2)) {
      throw new Error('ade: worker commit range contains a merge commit; managed integration requires a linear range');
    }
    return commits;
  }

  async integrateCommits(workspaceDir: string, commits: string[]): Promise<number> {
    const inspection = await this.inspect(workspaceDir);
    if (!inspection.isRepo) throw new Error('ade: integration workspace is not a git worktree');
    if (!inspection.clean) throw new Error('ade: integration workspace changed after its lease was acquired');
    const pending: string[] = [];
    for (const commit of [...new Set(commits)]) {
      if (!(await isAncestor(workspaceDir, commit, 'HEAD'))) pending.push(commit);
    }
    if (pending.length === 0) return 0;
    try {
      // One sequencer transaction means --abort restores the exact pre-run
      // integration HEAD even when a later commit conflicts.
      await git(workspaceDir, ['cherry-pick', '--no-edit', ...pending]);
      return pending.length;
    } catch (error) {
      try {
        await git(workspaceDir, ['cherry-pick', '--abort']);
      } catch {
        // A failure before cherry-pick starts has no sequence to abort.
      }
      throw new Error(`ade: integration cherry-pick failed: ${errorMessage(error)}`);
    }
  }
}

async function isAncestor(workspaceDir: string, ancestor: string, descendant: string): Promise<boolean> {
  try {
    await git(workspaceDir, ['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

async function git(workspaceDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', workspaceDir, ...args], {
    timeout: 120_000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

function canonicalPath(path: string): string {
  const absolute = resolve(path);
  return existsSync(absolute) ? realpathSync.native(absolute) : absolute;
}

function errorMessage(error: unknown): string {
  const detail = error as { stderr?: string; message?: string };
  return (detail.stderr?.trim() || detail.message || String(error)).slice(0, 2_000);
}
