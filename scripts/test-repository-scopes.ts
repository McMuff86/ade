/** Goal 5 repository, binding, task-snapshot and agent-template checks. */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import {
  createAgentTemplate,
  spawnAgentTemplate,
  type IdentityConfigPort,
} from '../src/main/identity';
import {
  OrchestrationService,
  type OrchestrationConfigPort,
} from '../src/main/orchestration/OrchestrationService';
import { normalizeConfig } from '../src/main/orchestration/migrate';
import {
  RepositoryScopeService,
  type RepositoryConfigPort,
} from '../src/main/repositories/RepositoryScopeService';
import {
  DEFAULT_CONFIG,
  type AdeConfig,
  type Agent,
  type Category,
  type SessionMeta,
} from '../src/shared/types';

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

type MemoryStore = IdentityConfigPort & RepositoryConfigPort & OrchestrationConfigPort & {
  read(): AdeConfig;
};

function memoryStore(initial: AdeConfig): MemoryStore {
  let config = structuredClone(initial);
  return {
    get: () => config,
    save: (partial) => {
      config = {
        ...config,
        ...partial,
        settings: { ...config.settings, ...(partial.settings ?? {}) },
      };
      return config;
    },
    read: () => config,
  };
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

function createRepository(path: string, marker: string): void {
  mkdirSync(path, { recursive: true });
  git(path, ['init', '--initial-branch=main']);
  git(path, ['config', 'user.email', 'ade-repository-test@example.invalid']);
  git(path, ['config', 'user.name', 'ADE Repository Test']);
  writeFileSync(join(path, 'README.md'), `${marker}\n`, 'utf8');
  git(path, ['add', 'README.md']);
  git(path, ['commit', '-m', `Initialize ${marker}`]);
}

function testMigration(repoPath: string, workspaceDir: string, memoryDir: string): void {
  const legacy = {
    categories: [{
      id: 'legacy-category',
      name: 'Legacy repo category',
      kind: 'plain' as const,
      repoPath,
      agents: ['legacy-agent'],
    }],
    agents: [{
      id: 'legacy-agent',
      categoryId: 'legacy-category',
      name: 'Legacy Agent',
      runtime: 'codex' as const,
      permissionMode: 'default' as const,
      workspaceDir,
      memoryDir,
    }],
    settings: DEFAULT_CONFIG.settings,
  };

  const first = normalizeConfig(legacy, 1_000);
  const repository = first.config.repositories[0];
  const binding = first.config.workspaceBindings[0];
  const agent = first.config.agents[0];
  check('legacy category repo becomes one first-class repository',
    first.migrated && first.config.repositories.length === 1 && Boolean(repository));
  check('legacy category and agent receive the same default repository',
    first.config.categories[0]?.defaultRepositoryId === repository?.id
      && agent?.defaultRepositoryId === repository?.id);
  check('legacy worktree is retained as an unverified binding',
    binding?.workspaceDir === workspaceDir && binding.status === 'legacy-unverified');
  check('migration assigns a separate portable agent home',
    agent?.homeWorkspaceDir === join(dirname(memoryDir), 'workspace'));

  const second = normalizeConfig(first.config, 2_000);
  check('repository migration is idempotent',
    !second.migrated
      && second.config.repositories.length === 1
      && second.config.workspaceBindings.length === 1);

  const portableAfterMigration = structuredClone(first.config);
  portableAfterMigration.agents[0]!.defaultRepositoryId = undefined;
  portableAfterMigration.agents[0]!.workspaceDir = portableAfterMigration.agents[0]!.homeWorkspaceDir!;
  const portableRestart = normalizeConfig(portableAfterMigration, 3_000);
  check('restart never reapplies a category default to an intentionally portable agent',
    portableRestart.config.agents[0]?.defaultRepositoryId === undefined
      && portableRestart.config.agents[0]?.workspaceDir === portableAfterMigration.agents[0]?.workspaceDir);
}

async function run(): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'ade-repository-scopes-'));
  try {
    const repoAPath = join(scratch, 'repo-a');
    const repoBPath = join(scratch, 'repo-b');
    createRepository(repoAPath, 'Repository A');
    createRepository(repoBPath, 'Repository B');

    const legacyWorkspace = join(scratch, 'legacy-worktree');
    git(repoAPath, ['worktree', 'add', '-b', 'legacy/agent', legacyWorkspace, 'HEAD']);
    testMigration(repoAPath, legacyWorkspace, join(scratch, 'legacy-agent', 'memory'));

    const category: Category = {
      id: 'category',
      name: 'Portable agents',
      kind: 'plain',
      agents: ['source-agent', 'concurrent-agent'],
    };
    const sourceHome = join(scratch, 'source-agent', 'workspace');
    const sourceMemory = join(scratch, 'source-agent', 'memory');
    const concurrentHome = join(scratch, 'concurrent-agent', 'workspace');
    const concurrentMemory = join(scratch, 'concurrent-agent', 'memory');
    for (const path of [sourceHome, sourceMemory, concurrentHome, concurrentMemory]) {
      mkdirSync(path, { recursive: true });
    }
    writeFileSync(
      join(sourceMemory, 'MEMORY.md'),
      'template memory seed\nAPI_KEY=super-secret-template-value\n',
      'utf8',
    );
    writeFileSync(join(sourceMemory, 'USER.md'), 'template user seed\n', 'utf8');

    const sourceAgent: Agent = {
      id: 'source-agent',
      categoryId: category.id,
      name: 'Source Writer',
      runtime: 'codex',
      permissionMode: 'default',
      workspaceDir: sourceHome,
      homeWorkspaceDir: sourceHome,
      memoryDir: sourceMemory,
    };
    const concurrentAgent: Agent = {
      id: 'concurrent-agent',
      categoryId: category.id,
      name: 'Concurrent Writer',
      runtime: 'claude',
      permissionMode: 'accept-edits',
      workspaceDir: concurrentHome,
      homeWorkspaceDir: concurrentHome,
      memoryDir: concurrentMemory,
    };
    const store = memoryStore({
      ...structuredClone(DEFAULT_CONFIG),
      categories: [category],
      agents: [sourceAgent, concurrentAgent],
    });
    const scopes = new RepositoryScopeService(store, {
      baseDir: join(scratch, 'ade-scope-data'),
    });

    const repoA = await scopes.importRepository(repoAPath);
    const linkedAPath = join(scratch, 'repo-a-linked');
    git(repoAPath, ['worktree', 'add', '-b', 'fixture/linked', linkedAPath, 'HEAD']);
    const linkedImport = await scopes.importRepository(linkedAPath);
    const repoB = await scopes.importRepository(repoBPath);
    check('linked worktrees deduplicate to one repository identity',
      linkedImport.id === repoA.id && store.read().repositories.length === 2);

    const scopeA = await scopes.resolve(sourceAgent.id, { repositoryId: repoA.id });
    const scopeB = await scopes.resolve(sourceAgent.id, { repositoryId: repoB.id });
    check('one portable agent can bind independently to two repositories',
      scopeA.workspaceBindingId !== scopeB.workspaceBindingId
        && scopeA.workspaceDir !== scopeB.workspaceDir
        && store.read().workspaceBindings.filter((binding) => binding.agentId === sourceAgent.id).length === 2);
    check('repository bindings use isolated ADE branches',
      scopeA.branch.startsWith('ade/') && scopeB.branch.startsWith('ade/'));

    const concurrentScopes = await Promise.all([
      scopes.resolve(concurrentAgent.id, { repositoryId: repoA.id }),
      scopes.resolve(concurrentAgent.id, { repositoryId: repoA.id }),
    ]);
    check('concurrent binding resolution creates exactly one worktree record',
      concurrentScopes[0]?.workspaceBindingId === concurrentScopes[1]?.workspaceBindingId
        && store.read().workspaceBindings.filter((binding) => (
          binding.agentId === concurrentAgent.id && binding.repositoryId === repoA.id
        )).length === 1);

    const rollbackAgent: Agent = {
      id: 'rollback-agent',
      categoryId: 'rollback-category',
      name: 'Rollback Writer',
      runtime: 'codex',
      permissionMode: 'default',
      workspaceDir: join(scratch, 'rollback-agent', 'workspace'),
      homeWorkspaceDir: join(scratch, 'rollback-agent', 'workspace'),
      memoryDir: join(scratch, 'rollback-agent', 'memory'),
    };
    let rollbackConfig: AdeConfig = {
      ...structuredClone(DEFAULT_CONFIG),
      categories: [{
        id: 'rollback-category',
        name: 'Rollback',
        agents: [rollbackAgent.id],
      }],
      agents: [rollbackAgent],
    };
    let failBindingPersistence = false;
    const rollbackStore: RepositoryConfigPort = {
      get: () => rollbackConfig,
      save: (partial) => {
        rollbackConfig = {
          ...rollbackConfig,
          ...partial,
          settings: { ...rollbackConfig.settings, ...(partial.settings ?? {}) },
        };
        if (failBindingPersistence && partial.workspaceBindings) {
          failBindingPersistence = false;
          throw new Error('simulated binding persistence failure');
        }
        return rollbackConfig;
      },
    };
    const rollbackBase = join(scratch, 'rollback-scope-data');
    const rollbackScopes = new RepositoryScopeService(rollbackStore, { baseDir: rollbackBase });
    const rollbackRepo = await rollbackScopes.importRepository(repoAPath);
    failBindingPersistence = true;
    let persistenceRejected = false;
    try {
      await rollbackScopes.resolve(rollbackAgent.id, { repositoryId: rollbackRepo.id });
    } catch {
      persistenceRejected = true;
    }
    const registeredWorktrees = git(repoAPath, ['worktree', 'list', '--porcelain'])
      .replace(/\\/g, '/').toLowerCase();
    const rollbackBranches = git(repoAPath, ['branch', '--list', 'ade/rollback-writer-*']).trim();
    check('failed binding persistence rolls back its worktree, branch and config record',
      persistenceRejected
        && rollbackConfig.workspaceBindings.length === 0
        && !registeredWorktrees.includes(rollbackBase.replace(/\\/g, '/').toLowerCase())
        && rollbackBranches === '');

    let mismatchRejected = false;
    try {
      await scopes.resolve(sourceAgent.id, {
        repositoryId: repoB.id,
        workspaceBindingId: scopeA.workspaceBindingId,
      });
    } catch {
      mismatchRejected = true;
    }
    check('an exact binding cannot be replayed under another repository id', mismatchRejected);

    const defaulted = await scopes.setAgentDefault(sourceAgent.id, repoA.id);
    const described = scopes.describe(sourceAgent.id);
    check('agent defaults affect future unscoped executions',
      defaulted.defaultRepositoryId === repoA.id
        && described.repositoryId === repoA.id
        && described.workspaceBindingId === scopeA.workspaceBindingId);
    const cleared = await scopes.setAgentDefault(sourceAgent.id, null);
    const plain = await scopes.resolve(sourceAgent.id, { repositoryId: null });
    check('clearing the default restores the portable home without deleting bindings',
      cleared.defaultRepositoryId === undefined
        && plain.source === 'plain-home'
        && plain.workspaceDir === sourceHome
        && store.read().workspaceBindings.length === 3);

    const template = createAgentTemplate(store, {
      sourceAgentId: sourceAgent.id,
      name: 'Reusable Writer',
    });
    writeFileSync(join(sourceMemory, 'MEMORY.md'), 'source changed after template\n', 'utf8');
    const spawned = await spawnAgentTemplate(store, {
      templateId: template.id,
      categoryId: category.id,
      name: 'Repo B Writer',
      defaultRepositoryId: repoB.id,
    }, scopes, { baseDir: join(scratch, 'spawned-identities') });
    check('template spawn creates an independent agent identity and memory directory',
      spawned.id !== sourceAgent.id
        && spawned.memoryDir !== sourceAgent.memoryDir
        && spawned.defaultRepositoryId === repoB.id);
    check('template memory is copied as an independent snapshot',
      readFileSync(join(spawned.memoryDir, 'MEMORY.md'), 'utf8').includes('template memory seed\n')
        && readFileSync(join(spawned.memoryDir, 'MEMORY.md'), 'utf8').includes('[redacted by ADE template]')
        && !readFileSync(join(spawned.memoryDir, 'MEMORY.md'), 'utf8').includes('super-secret-template-value')
        && readFileSync(join(sourceMemory, 'MEMORY.md'), 'utf8') === 'source changed after template\n');
    check('template spawn creates the selected repository binding',
      store.read().workspaceBindings.some((binding) => (
        binding.agentId === spawned.id && binding.repositoryId === repoB.id
      )));

    const orchestration = new OrchestrationService(store);
    const run = orchestration.createRun({
      name: 'Scoped manual run',
      repositoryId: repoA.id,
      participants: [{ agentId: sourceAgent.id, role: 'orchestrator' }],
    });
    const participant = orchestration.snapshot().participants.find((item) => item.runId === run.id)!;
    const task = orchestration.createTask({
      runId: run.id,
      participantId: participant.id,
      prompt: 'Inspect the selected repository',
    });
    check('run repository id is snapshotted onto queued tasks', task.repositoryId === repoA.id);
    const session: SessionMeta = {
      id: 'scoped-session',
      agentId: sourceAgent.id,
      title: 'Scoped task',
      kind: 'task',
      status: 'running',
      createdAt: Date.now(),
      runTaskId: task.id,
      repositoryId: repoA.id,
      workspaceBindingId: scopeA.workspaceBindingId,
      workspaceDir: scopeA.workspaceDir,
      scopeSource: 'explicit',
    };
    orchestration.onTaskStarted(task.id, session);
    const runningTask = orchestration.snapshot().tasks.find((item) => item.id === task.id);
    check('task start persists the exact binding and workspace snapshot',
      runningTask?.repositoryId === repoA.id
        && runningTask.workspaceBindingId === scopeA.workspaceBindingId
        && runningTask.workspaceDir === scopeA.workspaceDir);
    const artifact = orchestration.createArtifact({
      runId: run.id,
      taskId: task.id,
      kind: 'result',
      content: 'Scoped result',
    });
    check('task artifacts inherit the immutable execution scope',
      artifact.repositoryId === repoA.id
        && artifact.workspaceBindingId === scopeA.workspaceBindingId
        && artifact.workspaceDir === scopeA.workspaceDir);

    const beforeConflict = store.read();
    store.save({
      workspaceBindings: [...beforeConflict.workspaceBindings, {
        id: 'conflicting-binding',
        agentId: concurrentAgent.id,
        repositoryId: repoA.id,
        workspaceDir: scopeA.workspaceDir,
        branch: scopeA.branch,
        status: 'legacy-unverified',
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      }],
    });
    let duplicateWorkspaceRejected = false;
    try {
      await scopes.resolve(sourceAgent.id, {
        repositoryId: repoA.id,
        workspaceBindingId: scopeA.workspaceBindingId,
      });
    } catch {
      duplicateWorkspaceRejected = true;
    }
    check('one physical worktree cannot resolve through two binding records',
      duplicateWorkspaceRejected
        && store.read().workspaceBindings.find((binding) => (
          binding.id === scopeA.workspaceBindingId
        ))?.status === 'invalid');
  } finally {
    const safeRoot = resolve(tmpdir());
    const safeScratch = resolve(scratch);
    if (dirname(safeScratch) === safeRoot && basename(safeScratch).startsWith('ade-repository-scopes-')
        && safeScratch.startsWith(`${safeRoot}${sep}`)) {
      rmSync(safeScratch, { recursive: true, force: true });
    }
  }

  console.log(`\n${failed ? 'FAILED' : 'PASSED'} - ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
