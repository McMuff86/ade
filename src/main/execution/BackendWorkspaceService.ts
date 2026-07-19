import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, posix } from 'node:path';
import type { ExecutionBackendId } from '../../shared/executionBackends';
import { NATIVE_EXECUTION_BACKEND, normalizeExecutionBackendId } from '../../shared/executionBackends';
import type { AdeConfig } from '../../shared/types';
import {
  WorkspaceService,
  type WorkspaceInspection,
  type WorkspacePort,
} from '../orchestration/WorkspaceService';
import { ExecutionBackendService } from './ExecutionBackendService';

const MAX_WORKER_COMMITS = 50;

interface ConfigPort {
  get(): AdeConfig;
}

/** Routes orchestration Git mutations through the persisted workspace backend. */
export class BackendWorkspaceService implements WorkspacePort {
  private readonly native = new WorkspaceService();
  private readonly wsl = new Map<ExecutionBackendId, WorkspacePort>();

  constructor(
    private readonly store: ConfigPort,
    private readonly execution = new ExecutionBackendService(),
  ) {}

  forBackend(backendValue: ExecutionBackendId | undefined): WorkspacePort {
    const backend = normalizeExecutionBackendId(backendValue);
    if (backend === NATIVE_EXECUTION_BACKEND) return this.native;
    let service = this.wsl.get(backend);
    if (!service) {
      service = new WslWorkspaceService(backend, this.execution);
      this.wsl.set(backend, service);
    }
    return service;
  }

  inspect(workspaceDir: string): Promise<WorkspaceInspection> {
    return this.serviceFor(workspaceDir).inspect(workspaceDir);
  }

  commitChanges(
    workspaceDir: string,
    expectedHeadSha: string,
    reportedFiles: string[],
    message: string,
  ): Promise<string | null> {
    return this.serviceFor(workspaceDir).commitChanges(
      workspaceDir,
      expectedHeadSha,
      reportedFiles,
      message,
    );
  }

  validateCommit(workspaceDir: string, baseSha: string, commitSha: string): Promise<string[]> {
    return this.serviceFor(workspaceDir).validateCommit(workspaceDir, baseSha, commitSha);
  }

  integrateCommits(workspaceDir: string, commits: string[]): Promise<number> {
    return this.serviceFor(workspaceDir).integrateCommits(workspaceDir, commits);
  }

  backendFor(workspaceDir: string): ExecutionBackendId {
    const config = this.store.get();
    for (const binding of config.workspaceBindings) {
      const backend = normalizeExecutionBackendId(binding.executionBackend);
      if (this.execution.samePath(backend, binding.workspaceDir, workspaceDir)) return backend;
    }
    for (const repository of config.repositories) {
      const backend = normalizeExecutionBackendId(repository.executionBackend);
      if (this.execution.samePath(backend, repository.rootPath, workspaceDir)) return backend;
    }
    return NATIVE_EXECUTION_BACKEND;
  }

  private serviceFor(workspaceDir: string): WorkspacePort {
    return this.forBackend(this.backendFor(workspaceDir));
  }
}

class WslWorkspaceService implements WorkspacePort {
  constructor(
    private readonly backend: ExecutionBackendId,
    private readonly execution: ExecutionBackendService,
  ) {}

  async inspect(workspaceDir: string): Promise<WorkspaceInspection> {
    const empty = { workspaceDir, isRepo: false, clean: true, branch: '', headSha: '', commonGitDir: '' };
    const directory = await this.execution.run(this.backend, 'test', ['-d', workspaceDir], { timeoutMs: 10_000 });
    if (directory.code !== 0) {
      await this.execution.checked(this.backend, 'true', [], { timeoutMs: 10_000, maxBuffer: 64 * 1024 });
      return empty;
    }
    const canonical = await this.execution.canonicalPath(this.backend, workspaceDir);
    const inside = await this.execution.run(this.backend, 'git', [
      '-C', canonical, 'rev-parse', '--is-inside-work-tree',
    ], { timeoutMs: 10_000 });
    if (inside.code !== 0 || inside.stdout.toString('utf8').trim() !== 'true') {
      await this.execution.checked(this.backend, 'true', [], { timeoutMs: 10_000, maxBuffer: 64 * 1024 });
      return { ...empty, workspaceDir: canonical };
    }
    try {
      const [status, branch, headSha, commonRaw] = await Promise.all([
        this.git(canonical, ['status', '--porcelain=v1', '--untracked-files=all']),
        this.git(canonical, ['branch', '--show-current']),
        this.git(canonical, ['rev-parse', 'HEAD']),
        this.git(canonical, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
      ]);
      return {
        workspaceDir: canonical,
        isRepo: true,
        clean: status.trim().length === 0,
        branch: branch.trim(),
        headSha: headSha.trim(),
        commonGitDir: await this.execution.canonicalPath(this.backend, commonRaw.trim()),
      };
    } catch (error) {
      throw new Error(`ade: failed to inspect WSL git worktree ${workspaceDir}: ${errorMessage(error)}`);
    }
  }

  async commitChanges(
    workspaceDir: string,
    expectedHeadSha: string,
    reportedFiles: string[],
    message: string,
  ): Promise<string | null> {
    const inspection = await this.inspect(workspaceDir);
    if (!inspection.isRepo) throw new Error('ade: managed commit workspace is not a WSL git worktree');
    if (inspection.headSha !== expectedHeadSha) {
      throw new Error('ade: managed runtime changed Git history; ADE must own task commits');
    }
    const reported = normalizeReportedPaths(reportedFiles);
    const actual = await this.changedPaths(workspaceDir);
    if (!samePaths(actual, reported)) {
      throw new Error(`ade: reported files do not match the workspace diff ` +
        `(reported: ${pathSummary(reported)}; actual: ${pathSummary(actual)})`);
    }
    if (actual.length === 0) return null;

    const scratch = mkdtempSync(join(tmpdir(), 'ade-wsl-git-'));
    const pathspecHost = join(scratch, 'paths.nul');
    const hooksHost = join(scratch, 'hooks');
    mkdirSync(hooksHost, { recursive: true });
    writeFileSync(pathspecHost, Buffer.from(`${reported.join('\0')}\0`, 'utf8'));
    let pathspec = '';
    let hooks = '';
    let committed = false;
    try {
      [pathspec, hooks] = await Promise.all([
        this.execution.toBackendPath(this.backend, pathspecHost),
        this.execution.toBackendPath(this.backend, hooksHost),
      ]);
      await this.git(workspaceDir, [
        'add', '-A', `--pathspec-from-file=${pathspec}`, '--pathspec-file-nul',
      ]);
      const staged = nullPaths(await this.git(workspaceDir, [
        'diff', '--cached', '--name-only', '-z', '--no-renames', 'HEAD', '--',
      ]));
      if (!samePaths(staged, reported)) {
        throw new Error(`ade: staged files differ from the validated task diff ` +
          `(expected: ${pathSummary(reported)}; staged: ${pathSummary(staged)})`);
      }
      const remaining = await this.unstagedPaths(workspaceDir);
      if (remaining.length > 0) {
        throw new Error(`ade: workspace changed while ADE staged the task diff: ${pathSummary(remaining)}`);
      }
      const safeMessage = message.replace(/[\r\n]+/g, ' ').trim().slice(0, 200) || 'ADE managed task';
      await this.git(workspaceDir, [
        '-c', `core.hooksPath=${hooks}`,
        '-c', 'commit.gpgsign=false',
        '-c', 'user.name=ADE Managed Run',
        '-c', 'user.email=ade@local.invalid',
        'commit', '--no-gpg-sign', '-m', safeMessage,
      ]);
      committed = true;
      const completed = await this.inspect(workspaceDir);
      if (!completed.clean || completed.headSha === expectedHeadSha) {
        throw new Error('ade: managed WSL commit did not produce one clean descendant commit');
      }
      return completed.headSha;
    } catch (error) {
      if (!committed && pathspec) {
        try {
          await this.git(workspaceDir, [
            'restore', '--staged', `--pathspec-from-file=${pathspec}`, '--pathspec-file-nul',
          ]);
        } catch {
          // Preserve the working-tree diff for inspection.
        }
      }
      throw new Error(`ade: failed to create managed WSL task commit: ${errorMessage(error)}`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  async validateCommit(workspaceDir: string, baseSha: string, commitSha: string): Promise<string[]> {
    await this.git(workspaceDir, ['cat-file', '-e', `${commitSha}^{commit}`]);
    const ancestor = await this.execution.run(this.backend, 'git', [
      '-C', workspaceDir, 'merge-base', '--is-ancestor', baseSha, commitSha,
    ]);
    if (ancestor.code !== 0) {
      throw new Error(`ade: commit ${commitSha} is not based on the leased WSL workspace HEAD`);
    }
    const commits = (await this.git(workspaceDir, [
      'rev-list', '--reverse', '--topo-order', `${baseSha}..${commitSha}`,
    ])).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (commits.length === 0) throw new Error(`ade: commit ${commitSha} contains no work after the leased base`);
    if (commits.length > MAX_WORKER_COMMITS) {
      throw new Error(`ade: worker commit range exceeds ${MAX_WORKER_COMMITS} commits`);
    }
    const parents = await this.git(workspaceDir, ['rev-list', '--parents', `${baseSha}..${commitSha}`]);
    if (parents.split(/\r?\n/).some((line) => line.trim().split(/\s+/).filter(Boolean).length > 2)) {
      throw new Error('ade: worker commit range contains a merge commit; managed integration requires a linear range');
    }
    return commits;
  }

  async integrateCommits(workspaceDir: string, commits: string[]): Promise<number> {
    const inspection = await this.inspect(workspaceDir);
    if (!inspection.isRepo) throw new Error('ade: integration workspace is not a WSL git worktree');
    if (!inspection.clean) throw new Error('ade: integration workspace changed after its lease was acquired');
    const pending: string[] = [];
    for (const commit of [...new Set(commits)]) {
      const result = await this.execution.run(this.backend, 'git', [
        '-C', workspaceDir, 'merge-base', '--is-ancestor', commit, 'HEAD',
      ]);
      if (result.code !== 0) pending.push(commit);
    }
    if (pending.length === 0) return 0;
    try {
      await this.git(workspaceDir, ['cherry-pick', '--no-edit', ...pending]);
      return pending.length;
    } catch (error) {
      try {
        await this.git(workspaceDir, ['cherry-pick', '--abort']);
      } catch {
        // A failure before cherry-pick starts has no sequence to abort.
      }
      throw new Error(`ade: WSL integration cherry-pick failed: ${errorMessage(error)}`);
    }
  }

  private async changedPaths(workspaceDir: string): Promise<string[]> {
    const conflicts = nullPaths(await this.git(workspaceDir, [
      'diff', '--name-only', '-z', '--diff-filter=U', '--',
    ]));
    if (conflicts.length > 0) {
      throw new Error(`ade: managed task left unresolved Git conflicts: ${pathSummary(conflicts)}`);
    }
    const tracked = nullPaths(await this.git(workspaceDir, [
      'diff', '--name-only', '-z', '--no-renames', 'HEAD', '--',
    ]));
    const untracked = nullPaths(await this.git(workspaceDir, [
      'ls-files', '--others', '--exclude-standard', '-z', '--',
    ]));
    return uniqueSorted([...tracked, ...untracked]);
  }

  private async unstagedPaths(workspaceDir: string): Promise<string[]> {
    const tracked = nullPaths(await this.git(workspaceDir, [
      'diff', '--name-only', '-z', '--no-renames', '--',
    ]));
    const untracked = nullPaths(await this.git(workspaceDir, [
      'ls-files', '--others', '--exclude-standard', '-z', '--',
    ]));
    return uniqueSorted([...tracked, ...untracked]);
  }

  private git(workspaceDir: string, args: string[]): Promise<string> {
    return this.execution.text(this.backend, 'git', ['-C', workspaceDir, ...args], {
      timeoutMs: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  }
}

function normalizeReportedPaths(paths: string[]): string[] {
  const normalized = paths.map((path) => {
    const value = path.replace(/\\/g, '/');
    if (!value || value.includes('\0') || isAbsolute(value) || posix.isAbsolute(value)
        || value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
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
