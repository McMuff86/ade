/** Pure backend contracts plus an opt-in real Windows GUI→WSL integration. */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import * as pty from 'node-pty';
import { BackendGitService, parseBranch } from '../src/main/execution/BackendGitService';
import { BackendWorkspaceFs } from '../src/main/execution/BackendWorkspaceFs';
import { BackendWorkspaceService } from '../src/main/execution/BackendWorkspaceService';
import {
  ExecutionBackendService,
  decodeWslOutput,
} from '../src/main/execution/ExecutionBackendService';
import { assertIpcPayload } from '../src/main/ipcValidation';
import { normalizeConfig } from '../src/main/orchestration/migrate';
import { RepositoryScopeService, type RepositoryConfigPort } from '../src/main/repositories/RepositoryScopeService';
import { diagnoseRuntimes } from '../src/main/diagnostics/RuntimeDiagnostics';
import {
  NATIVE_EXECUTION_BACKEND,
  isExecutionBackendId,
  wslExecutionBackend,
} from '../src/shared/executionBackends';
import { DEFAULT_CONFIG, type AdeConfig, type Agent } from '../src/shared/types';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}`, detail ?? '');
  }
}

async function rejects(label: string, operation: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await operation();
    check(label, false, 'operation unexpectedly succeeded');
  } catch {
    check(label, true);
  }
}

class MemoryStore implements RepositoryConfigPort {
  constructor(private config: AdeConfig) {}
  get(): AdeConfig { return this.config; }
  save(partial: Partial<AdeConfig>): AdeConfig {
    this.config = {
      ...this.config,
      ...partial,
      settings: { ...this.config.settings, ...(partial.settings ?? {}) },
    };
    return this.config;
  }
}

async function pureContracts(): Promise<void> {
  const execution = new ExecutionBackendService('win32');
  check('native backend id is stable', isExecutionBackendId(NATIVE_EXECUTION_BACKEND));
  check('bounded WSL backend id round-trips', wslExecutionBackend('Ubuntu-24.04') === 'wsl:Ubuntu-24.04');
  check('WSL backend ids reject shell/path delimiters',
    !isExecutionBackendId('wsl:Ubuntu;rm') && !isExecutionBackendId('wsl:../Ubuntu'));
  check('WSL path identity preserves Linux case',
    execution.pathKey('wsl:Ubuntu', '/repo/A') !== execution.pathKey('wsl:Ubuntu', '/repo/a'));
  check('native Windows path identity folds case',
    execution.pathKey('native', 'C:\\Repo\\A') === execution.pathKey('native', 'c:\\repo\\a\\'));

  const ptyCommand = execution.ptyCommand(
    'wsl:Ubuntu',
    '/bin/bash',
    ['-lc', 'printf ok'],
    '/home/test/project with spaces',
    { TERM: 'xterm-256color' },
  );
  check('WSL PTY uses argv-only distro and cwd selection',
    ptyCommand.file === 'wsl.exe'
      && ptyCommand.args.includes('--distribution')
      && ptyCommand.args.includes('Ubuntu')
      && ptyCommand.args.includes('/home/test/project with spaces')
      && ptyCommand.args.includes('/usr/bin/env'),
    ptyCommand);
  check('WSL PTY does not interpolate the distro or cwd into a shell fragment',
    !ptyCommand.args.some((arg) => arg.includes('wsl.exe ') || arg.includes('--cd /home')),
    ptyCommand.args);

  const utf16 = Buffer.from('\uFEFFUbuntu\r\ndocker-desktop\r\n', 'utf16le');
  check('WSL distro output accepts UTF-16LE Windows output',
    decodeWslOutput(utf16).includes('docker-desktop'));
  check('unborn Git branches retain their complete branch name',
    parseBranch('## No commits yet on feature/unborn').branch === 'feature/unborn');

  assertIpcPayload('repository:import', {
    path: '/home/test/repo',
    executionBackend: 'wsl:Ubuntu',
  });
  check('repository IPC accepts an explicit WSL backend', true);
  await rejects('repository IPC rejects an injected WSL backend', () =>
    assertIpcPayload('repository:import', {
      path: '/home/test/repo',
      executionBackend: 'wsl:Ubuntu;touch-pwned',
    }));
  await rejects('diagnostic IPC requires an agent for a session scope', () =>
    assertIpcPayload('runtime:diagnose', { sessionId: 'session-1' }));

  const legacy = structuredClone(DEFAULT_CONFIG) as AdeConfig;
  legacy.repositories = [{
    id: 'legacy', name: 'Legacy', rootPath: 'C:\\repo', commonGitDir: 'C:\\repo\\.git',
    verified: true, createdAt: 1,
  } as AdeConfig['repositories'][number]];
  legacy.workspaceBindings = [{
    id: 'binding', agentId: 'agent', repositoryId: 'legacy', workspaceDir: 'C:\\worktree',
    branch: 'ade/agent', status: 'ready', createdAt: 1, lastUsedAt: 1,
  } as AdeConfig['workspaceBindings'][number]];
  const migrated = normalizeConfig(legacy, 2);
  check('legacy repository migration persists native backend',
    migrated.config.repositories[0]?.executionBackend === 'native');
  check('legacy binding migration inherits repository backend',
    migrated.config.workspaceBindings[0]?.executionBackend === 'native');
  check('backend migration is reported and idempotent',
    migrated.migrated && !normalizeConfig(migrated.config, 3).migrated);

  const collision = structuredClone(DEFAULT_CONFIG) as AdeConfig;
  const collisionPath = resolve('backend-collision').replace(/\\/g, '/').toLowerCase();
  collision.categories = [{
    id: 'collision-category', name: 'Collision', kind: 'plain',
    repoPath: collisionPath, agents: [],
  }];
  collision.repositories = [{
    id: 'wsl-collision', name: 'WSL collision', rootPath: collisionPath,
    commonGitDir: collisionPath, executionBackend: 'wsl:Ubuntu', verified: false, createdAt: 1,
  }];
  const separated = normalizeConfig(collision, 4).config;
  check('migration never merges identical path text across execution backends',
    separated.repositories.length === 2
      && separated.repositories.some((repository) => repository.executionBackend === 'native')
      && separated.repositories.some((repository) => repository.executionBackend === 'wsl:Ubuntu'),
    separated.repositories);
}

async function realWslIntegration(): Promise<void> {
  if (process.platform !== 'win32') {
    console.log('  skip real WSL integration (Windows host required)');
    return;
  }
  const distribution = process.env['ADE_WSL_DISTRO']?.trim() || 'Ubuntu';
  const backend = wslExecutionBackend(distribution);
  const execution = new ExecutionBackendService();
  const available = await execution.listWslDistributions();
  const distro = available.distributions.find((item) => item.backend === backend);
  if (!distro?.available) throw new Error(`ade: WSL test distro is unavailable: ${distribution}`);
  await rejects('missing WSL distributions fail closed at the backend boundary', () =>
    execution.checked(wslExecutionBackend('ADE-Definitely-Missing'), 'true', [], {
      timeoutMs: 5_000,
      maxBuffer: 64 * 1024,
    }));
  const missingBackend = wslExecutionBackend('ADE-Definitely-Missing');
  const missingStore = new MemoryStore(structuredClone(DEFAULT_CONFIG));
  const missingWorkspaces = new BackendWorkspaceService(missingStore, execution);
  await rejects('workspace inspection does not downgrade an unavailable distro to a missing directory', () =>
    missingWorkspaces.forBackend(missingBackend).inspect('/tmp/missing'));

  const root = (await execution.text(backend, 'mktemp', ['-d', '/tmp/ade-wsl-backend.XXXXXX'])).trim();
  if (!/^\/tmp\/ade-wsl-backend\.[A-Za-z0-9]+$/.test(root)) {
    throw new Error(`ade: refusing unsafe WSL test root ${root}`);
  }
  const hostScratch = mkdtempSync(join(tmpdir(), 'ade-wsl-backend-host-'));
  try {
    await execution.checked(backend, 'git', ['init', '--initial-branch=main', root]);
    await execution.checked(backend, 'git', ['-C', root, 'config', 'user.name', 'ADE WSL Test']);
    await execution.checked(backend, 'git', ['-C', root, 'config', 'user.email', 'ade-wsl@test.invalid']);
    await execution.checked(backend, 'tee', ['--', `${root}/README.md`], { input: 'WSL backend fixture\n' });
    await execution.checked(backend, 'git', ['-C', root, 'add', 'README.md']);
    await execution.checked(backend, 'git', ['-C', root, 'commit', '-m', 'fixture']);

    const agent: Agent = {
      id: 'wsl-agent', categoryId: 'category', name: 'WSL Worker', runtime: 'shell',
      permissionMode: 'default', workspaceDir: hostScratch, homeWorkspaceDir: hostScratch,
      memoryDir: hostScratch, defaultRepositoryId: undefined,
    };
    const unavailableDiagnostics = await diagnoseRuntimes(
      [agent],
      agent.id,
      () => missingBackend,
      execution,
    );
    check('runtime diagnostics report an unavailable WSL backend as an error',
      unavailableDiagnostics.items[0]?.status === 'error'
        && unavailableDiagnostics.items[0]?.executionBackend === missingBackend,
      unavailableDiagnostics.items[0]);
    const config = structuredClone(DEFAULT_CONFIG);
    config.agents = [agent];
    const store = new MemoryStore(config);
    const workspaces = new BackendWorkspaceService(store, execution);
    const git = new BackendGitService(execution);
    const scopes = new RepositoryScopeService(store, { execution, git, backendWorkspaces: workspaces });
    const repository = await scopes.importRepository(root, 'WSL integration', backend);
    check('WSL repository import stores a canonical Linux path and backend',
      repository.rootPath === root && repository.executionBackend === backend, repository);
    const scope = await scopes.resolve(agent.id, { repositoryId: repository.id });
    check('WSL scope creates a Linux Git worktree through Linux Git',
      scope.executionBackend === backend && scope.workspaceDir.startsWith('/tmp/.ade-worktrees/'), scope);
    const inspection = await workspaces.inspect(scope.workspaceDir);
    check('WSL worktree inspection is clean and identity-exact',
      inspection.isRepo && inspection.clean && inspection.commonGitDir === repository.commonGitDir,
      inspection);

    const workspaceFs = new BackendWorkspaceFs(execution);
    const unicodePath = 'managed ü space.txt';
    await execution.checked(backend, 'tee', ['--', `${scope.workspaceDir}/${unicodePath}`], {
      input: 'first line\nsecond line\n',
    });
    const status = await git.status(backend, scope.workspaceDir);
    check('WSL Git status preserves Unicode and spaces',
      status.files.some((file) => file.path === unicodePath && file.state === 'untracked'), status);
    check('WSL diff reads the untracked file inside the distro',
      (await git.diff(backend, scope.workspaceDir, unicodePath)).includes('+second line'));
    check('WSL filesystem read uses the Linux backend',
      (await workspaceFs.read(backend, scope.workspaceDir, hostScratch, unicodePath)).text.includes('second line'));
    const renamed = await workspaceFs.rename(backend, scope.workspaceDir, unicodePath, 'renamed ü.txt');
    check('WSL atomic rename preserves Unicode', renamed.path === 'renamed ü.txt', renamed);
    await rejects('WSL atomic rename refuses replacement', () =>
      workspaceFs.rename(backend, scope.workspaceDir, 'renamed ü.txt', 'README.md'));

    await execution.checked(backend, 'ln', ['-s', '/etc/passwd', `${scope.workspaceDir}/escape-link`]);
    await rejects('WSL filesystem read refuses symlink escape', () =>
      workspaceFs.read(backend, scope.workspaceDir, hostScratch, 'escape-link'));
    await execution.checked(backend, 'rm', ['--', `${scope.workspaceDir}/escape-link`]);

    await execution.checked(backend, 'git', ['-C', scope.workspaceDir, 'restore', '--', '.']);
    await execution.checked(backend, 'git', ['-C', scope.workspaceDir, 'clean', '-fd']);
    const before = await workspaces.inspect(scope.workspaceDir);
    await execution.checked(backend, 'tee', ['--', `${scope.workspaceDir}/${unicodePath}`], {
      input: 'ADE owns this commit\n',
    });
    const commit = await workspaces.commitChanges(
      scope.workspaceDir,
      before.headSha,
      [unicodePath],
      'ADE WSL managed commit',
    );
    check('ADE creates and validates a managed commit through WSL Git',
      Boolean(commit) && (await workspaces.inspect(scope.workspaceDir)).clean, commit);

    const command = execution.ptyCommand(
      backend,
      '/bin/bash',
      ['-l'],
      scope.workspaceDir,
      { TERM: 'xterm-256color' },
    );
    const output = await new Promise<string>((resolveOutput, rejectOutput) => {
      const terminal = pty.spawn(command.file, command.args, {
        name: 'xterm-256color', cols: 80, rows: 24, cwd: hostScratch,
        env: process.env as Record<string, string>, useConpty: true,
      });
      let text = '';
      terminal.onData((chunk) => { text += chunk; });
      setTimeout(() => terminal.write("printf 'ADE_WSL_PTY_OK\\n'; pwd; exit\n"), 250);
      const timer = setTimeout(() => {
        try { terminal.kill(); } catch { /* already gone */ }
        rejectOutput(new Error(`WSL PTY timed out: ${text}`));
      }, 15_000);
      terminal.onExit(({ exitCode }) => {
        clearTimeout(timer);
        if (exitCode === 0) resolveOutput(text);
        else rejectOutput(new Error(`WSL PTY exited ${exitCode}: ${text}`));
      });
    });
    check('Windows node-pty executes the terminal inside the selected WSL worktree',
      output.includes('ADE_WSL_PTY_OK') && output.replace(/\r/g, '').includes(scope.workspaceDir), output);

    const removal = await scopes.removeBinding(scope.workspaceBindingId!);
    check('WSL worktree cleanup keeps the unmerged ADE branch reachable', !removal.branchDeleted, removal);
    await execution.checked(backend, 'rmdir', ['--', posix.dirname(scope.workspaceDir)]);
  } finally {
    if (/^\/tmp\/ade-wsl-backend\.[A-Za-z0-9]+$/.test(root)) {
      await execution.checked(backend, 'rm', ['-rf', '--', root]);
    }
    rmSync(hostScratch, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await pureContracts();
  const real = process.argv.includes('--wsl') || process.env['ADE_WSL_BACKEND_E2E'] === '1';
  if (real) await realWslIntegration();
  else console.log('  skip real WSL integration (run pnpm test:wsl-backend)');
  console.log(`\nExecution backend checks: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

void main().then(() => {
  if (process.argv.includes('--wsl')) process.exit(failed > 0 ? 1 : 0);
}).catch((error) => {
  console.error(error);
  if (process.argv.includes('--wsl')) process.exit(1);
  process.exitCode = 1;
});
