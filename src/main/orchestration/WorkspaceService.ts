import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
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
  commitChanges(
    workspaceDir: string,
    expectedHeadSha: string,
    reportedFiles: string[],
    message: string,
  ): Promise<string | null>;
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

  /**
   * Turn one runtime-authored working-tree diff into an ADE-authored commit.
   * The runtime never receives Git-metadata write access: ADE verifies that
   * HEAD is unchanged and that the exact reported path set matches Git before
   * staging anything. Hooks and signing are disabled for this trusted control
   * plane operation so repository configuration cannot execute extra code.
   */
  async commitChanges(
    workspaceDir: string,
    expectedHeadSha: string,
    reportedFiles: string[],
    message: string,
  ): Promise<string | null> {
    const inspection = await this.inspect(workspaceDir);
    if (!inspection.isRepo) throw new Error('ade: managed commit workspace is not a git worktree');
    if (inspection.headSha !== expectedHeadSha) {
      throw new Error('ade: managed runtime changed Git history; ADE must own task commits');
    }

    const reported = normalizeReportedPaths(reportedFiles);
    const actual = await changedPaths(workspaceDir);
    if (!samePaths(actual, reported)) {
      throw new Error(`ade: reported files do not match the workspace diff ` +
        `(reported: ${pathSummary(reported)}; actual: ${pathSummary(actual)})`);
    }
    if (actual.length === 0) return null;

    const scratch = mkdtempSync(join(tmpdir(), 'ade-git-'));
    const pathspec = join(scratch, 'paths.nul');
    const hooks = join(scratch, 'hooks');
    mkdirSync(hooks, { recursive: true });
    writeFileSync(pathspec, Buffer.from(`${reported.join('\0')}\0`, 'utf8'));
    let committed = false;
    try {
      await git(workspaceDir, [
        'add', '-A',
        `--pathspec-from-file=${pathspec}`,
        '--pathspec-file-nul',
      ]);
      const staged = nullPaths(await git(workspaceDir, [
        'diff', '--cached', '--name-only', '-z', '--no-renames', 'HEAD', '--',
      ]));
      if (!samePaths(staged, reported)) {
        throw new Error(`ade: staged files differ from the validated task diff ` +
          `(expected: ${pathSummary(reported)}; staged: ${pathSummary(staged)})`);
      }
      const remaining = await unstagedPaths(workspaceDir);
      if (remaining.length > 0) {
        throw new Error(`ade: workspace changed while ADE staged the task diff: ${pathSummary(remaining)}`);
      }

      const safeMessage = message.replace(/[\r\n]+/g, ' ').trim().slice(0, 200) || 'ADE managed task';
      await git(workspaceDir, [
        '-c', `core.hooksPath=${hooks}`,
        '-c', 'commit.gpgsign=false',
        '-c', 'user.name=ADE Managed Run',
        '-c', 'user.email=ade@local.invalid',
        'commit', '--no-gpg-sign', '-m', safeMessage,
      ]);
      committed = true;
      const completed = await this.inspect(workspaceDir);
      if (!completed.clean || completed.headSha === expectedHeadSha) {
        throw new Error('ade: managed commit did not produce one clean descendant commit');
      }
      return completed.headSha;
    } catch (error) {
      if (!committed) {
        try {
          await git(workspaceDir, [
            'restore', '--staged',
            `--pathspec-from-file=${pathspec}`,
            '--pathspec-file-nul',
          ]);
        } catch {
          // Preserve the working-tree diff for inspection even if unstaging fails.
        }
      }
      throw new Error(`ade: failed to create managed task commit: ${errorMessage(error)}`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
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

async function changedPaths(workspaceDir: string): Promise<string[]> {
  const conflicts = nullPaths(await git(workspaceDir, [
    'diff', '--name-only', '-z', '--diff-filter=U', '--',
  ]));
  if (conflicts.length > 0) {
    throw new Error(`ade: managed task left unresolved Git conflicts: ${pathSummary(conflicts)}`);
  }
  const tracked = nullPaths(await git(workspaceDir, [
    'diff', '--name-only', '-z', '--no-renames', 'HEAD', '--',
  ]));
  const untracked = nullPaths(await git(workspaceDir, [
    'ls-files', '--others', '--exclude-standard', '-z', '--',
  ]));
  return uniqueSorted([...tracked, ...untracked]);
}

async function unstagedPaths(workspaceDir: string): Promise<string[]> {
  const tracked = nullPaths(await git(workspaceDir, [
    'diff', '--name-only', '-z', '--no-renames', '--',
  ]));
  const untracked = nullPaths(await git(workspaceDir, [
    'ls-files', '--others', '--exclude-standard', '-z', '--',
  ]));
  return uniqueSorted([...tracked, ...untracked]);
}

function normalizeReportedPaths(paths: string[]): string[] {
  const normalized = paths.map((path) => {
    const value = path.replace(/\\/g, '/');
    if (!value || value.includes('\0') || isAbsolute(value) ||
        value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw new Error(`ade: invalid reported workspace path "${path.slice(0, 300)}"`);
    }
    return value;
  });
  const unique = uniqueSorted(normalized);
  if (unique.length !== normalized.length) throw new Error('ade: reported files contain duplicates');
  return unique;
}

function nullPaths(output: string): string[] {
  return uniqueSorted(output.split('\0').filter(Boolean));
}

function uniqueSorted(paths: string[]): string[] {
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right, 'en'));
}

function samePaths(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((path, index) => path === right[index]);
}

function pathSummary(paths: string[]): string {
  if (paths.length === 0) return 'none';
  const summary = paths.slice(0, 20).join(', ');
  return paths.length > 20 ? `${summary}, … (+${paths.length - 20})` : summary;
}

function errorMessage(error: unknown): string {
  const detail = error as { stderr?: string; message?: string };
  return (detail.stderr?.trim() || detail.message || String(error)).slice(0, 2_000);
}
