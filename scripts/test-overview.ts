/** Focused projection checks for the read-only Overview home. */

import { DEFAULT_CONFIG, type AdeConfig, type Agent, type Run, type SessionBookend } from '../src/shared/types';
import { formatRelativeTime } from '../src/shared/overviewFormat';
import {
  addTaskUsage,
  backendLabel,
  emptyUsageRollup,
  heroTokens,
  OVERVIEW_WORK_LIMIT,
  projectOverview,
} from '../src/main/overview/projectOverview';
import {
  closeInteractiveBookend,
  interruptOrphanBookends,
  SESSION_BOOKEND_LIMIT,
  startInteractiveBookend,
} from '../src/main/overview/sessionBookends';

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

function agent(partial: Partial<Agent> & Pick<Agent, 'id' | 'name'>): Agent {
  return {
    categoryId: 'cat',
    runtime: 'shell',
    permissionMode: 'default',
    workspaceDir: '/tmp/ws',
    memoryDir: '/tmp/mem',
    ...partial,
  };
}

function run(partial: Partial<Run> & Pick<Run, 'id' | 'name'>): Run {
  return {
    goal: '',
    status: 'completed',
    mode: 'managed',
    phase: 'completed',
    budget: {
      maxConcurrentTasks: 1, maxInputTokens: null, maxOutputTokens: null,
      maxCostUsd: null, maxApprovals: 1, maxTaskMinutes: null,
    },
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

function config(overrides: Partial<AdeConfig> = {}): AdeConfig {
  return { ...structuredClone(DEFAULT_CONFIG), ...overrides };
}

function bookend(partial: Partial<SessionBookend> & Pick<SessionBookend, 'id' | 'agentName'>): SessionBookend {
  return {
    agentId: 'worker',
    runtime: 'shell',
    repositoryId: null,
    repositoryName: null,
    startedAt: 1,
    endedAt: null,
    ...partial,
  };
}

const now = Date.parse('2026-08-19T12:00:00.000Z');

check('null token fields do not increase the reported sum', (() => {
  const rollup = emptyUsageRollup();
  addTaskUsage(rollup, { inputTokens: null, outputTokens: null, costUsd: null });
  addTaskUsage(rollup, { inputTokens: 10, outputTokens: 2, costUsd: 0.5 });
  return rollup.reportedInputTokens === 10
    && rollup.reportedOutputTokens === 2
    && rollup.reportedCostUsd === 0.5
    && rollup.tasksWithTokens === 1
    && rollup.tasksWithoutTokens === 1
    && rollup.tasksWithCost === 1
    && rollup.tasksWithoutCost === 1
    && heroTokens(rollup) === 12;
})());

check('hero tokens stay null when every task omitted telemetry',
  heroTokens((() => {
    const rollup = emptyUsageRollup();
    addTaskUsage(rollup, { inputTokens: null, outputTokens: null, costUsd: null });
    return rollup;
  })()) === null);

check('native and WSL backends keep distinct labels',
  backendLabel('native') === 'native' && backendLabel('wsl:Ubuntu-24.04') === 'WSL · Ubuntu-24.04');

check('relative time uses bounded buckets',
  formatRelativeTime(now, now - 10_000) === 'just now'
    && formatRelativeTime(now, now - 120_000) === '2m'
    && formatRelativeTime(now, now - 2 * 3_600_000) === '2h'
    && formatRelativeTime(now, now - 3 * 86_400_000) === '3d');

const empty = projectOverview(config(), [], now);
check('an empty catalog has zero live/open and unknown tokens',
  empty.hero.liveSessions === 0
    && empty.hero.openRuns === 0
    && empty.hero.tokens === null
    && empty.agents.length === 0
    && empty.projects.length === 0
    && empty.work.length === 0);

const fixture = projectOverview(config({
  categories: [{ id: 'cat', name: 'Builders', agents: ['worker', 'chef'] }],
  agents: [
    agent({ id: 'worker', name: 'Worker A', runtime: 'grok', defaultRepositoryId: 'repo' }),
    agent({ id: 'chef', name: 'Main Chef', runtime: 'codex' }),
    agent({ id: 'orphan', name: 'Orphan', categoryId: 'gone' }),
  ],
  repositories: [{
    id: 'repo', name: 'RhinoClaw', rootPath: '/hidden', commonGitDir: '/hidden/.git',
    executionBackend: 'wsl:Ubuntu-24.04', verified: true, createdAt: 1,
  }],
  workspaceBindings: [{
    id: 'bind', agentId: 'worker', repositoryId: 'repo',
    workspaceDir: '/hidden/worktree', branch: 'ade/worker',
    executionBackend: 'wsl:Ubuntu-24.04', status: 'ready',
    createdAt: 1, lastUsedAt: 1_000,
  }],
  runs: [
    run({ id: 'old', name: 'Old work', repositoryId: 'repo', updatedAt: 500 }),
    run({
      id: 'open', name: 'Needs approval', status: 'running', phase: 'approval',
      repositoryId: 'repo', updatedAt: 2_000,
    }),
  ],
  runParticipants: [
    {
      id: 'p1', runId: 'old', agentId: 'worker', agentName: 'Worker A',
      runtime: 'grok', role: 'worker', createdAt: 1,
    },
    {
      id: 'p2', runId: 'open', agentId: 'deleted-later', agentName: 'Former Lead',
      runtime: 'codex', role: 'lead', createdAt: 1,
    },
    {
      id: 'p3', runId: 'open', agentId: 'chef', agentName: 'Main Chef',
      runtime: 'codex', role: 'orchestrator', createdAt: 1,
    },
  ],
  runTaskResults: [
    {
      id: 'r1', runId: 'old', taskId: 't1', participantId: 'p1', adapterId: 'grok-json-v1',
      resultPath: 'hidden', createdAt: 1, version: 1, outcome: 'succeeded',
      summary: 'done', assignments: [], filesChanged: [], tests: [], commitSha: null,
      risks: [], usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.2 },
    },
    {
      id: 'r2', runId: 'open', taskId: 't2', participantId: 'p3', adapterId: 'codex-jsonl-v1',
      resultPath: 'hidden', createdAt: 2, version: 1, outcome: 'succeeded',
      summary: 'plan', assignments: [], filesChanged: [], tests: [], commitSha: null,
      risks: [], usage: { inputTokens: 50, outputTokens: null, costUsd: null },
    },
  ],
}), [
  { id: 's1', agentId: 'worker', title: 'Grok', kind: 'interactive', status: 'running', createdAt: 1 },
  { id: 's2', agentId: 'worker', title: 'old', kind: 'interactive', status: 'exited', createdAt: 1 },
], now);

check('live counts only running sessions', fixture.hero.liveSessions === 1);
check('open runs include an approval-phase run', fixture.hero.openRuns === 1);
check('hero tokens sum only reported token fields', fixture.hero.tokens === 170);
check('cost unknown tasks are counted instead of treated as zero',
  fixture.hero.usage.reportedCostUsd === 0.2
    && fixture.hero.usage.tasksWithoutCost === 1
    && fixture.hero.usage.tasksWithTokens === 2);
check('agents follow category membership then leftovers',
  fixture.agents.map((row) => row.id).join(',') === 'worker,chef,orphan');
check('a live agent row carries session count and default repo name',
  fixture.agents[0]?.liveSessions === 1
    && fixture.agents[0]?.defaultRepositoryName === 'RhinoClaw'
    && fixture.agents[0]?.runtimeLabel === 'Grok Build'
    && fixture.agents[0]?.lastRunName === 'Old work');
check('a portable agent without runs or bindings has no activity',
  fixture.agents[2]?.defaultRepositoryName === null
    && fixture.agents[2]?.lastRunName === undefined
    && fixture.agents[2]?.lastActivityAt === null
    && fixture.agents[2]?.liveSessions === 0);
check('agent last activity is the max of binding lastUsedAt and last run',
  fixture.agents[0]?.lastActivityAt === 1_000
    && fixture.agents[1]?.lastActivityAt === 2_000
    && fixture.agents[2]?.lastActivityAt === null);
check('a binding-only agent shows activity without inventing a run', (() => {
  const snapshot = projectOverview(config({
    agents: [agent({ id: 'solo', name: 'Solo' })],
    repositories: [{
      id: 'repo', name: 'SoloRepo', rootPath: '/hidden', commonGitDir: '/hidden/.git',
      executionBackend: 'native', verified: true, createdAt: 1,
    }],
    workspaceBindings: [{
      id: 'bind', agentId: 'solo', repositoryId: 'repo',
      workspaceDir: '/hidden/worktree', branch: 'ade/solo',
      executionBackend: 'native', status: 'ready',
      createdAt: 1, lastUsedAt: 9_000,
    }],
  }), [], now);
  return snapshot.agents[0]?.lastActivityAt === 9_000
    && snapshot.agents[0]?.lastRunName === undefined;
})());
check('last project activity is the max of binding lastUsedAt and run updatedAt',
  fixture.projects[0]?.lastActivityAt === 2_000
    && fixture.projects[0]?.backendLabel === 'WSL · Ubuntu-24.04'
    && fixture.projects[0]?.boundAgentCount === 1
    && fixture.projects[0]?.boundAgentNames[0] === 'Worker A'
    && fixture.projects[0]?.lastRunName === 'Needs approval');
check('work lists newest runs first and keeps deleted-agent names',
  fixture.work[0]?.kind === 'run'
    && fixture.work[0]?.id === 'open'
    && fixture.work[0]?.repositoryName === 'RhinoClaw'
    && fixture.work[0]?.participantNames.includes('Former Lead') === true
    && fixture.work[0]?.usage.tasksWithoutCost === 1);
check('a plain-workspace run is listed without a repository name', (() => {
  const snapshot = projectOverview(config({
    runs: [run({ id: 'plain', name: 'No repo', repositoryId: null, updatedAt: 9 })],
    runParticipants: [{
      id: 'p', runId: 'plain', agentId: 'x', agentName: 'Shell',
      runtime: 'shell', role: 'worker', createdAt: 1,
    }],
  }), [], now);
  return snapshot.work[0]?.repositoryName === null;
})());
check('overview snapshots never include host paths or prompts',
  !JSON.stringify(fixture).includes('/hidden')
    && !JSON.stringify(fixture).includes('done')
    && !JSON.stringify(fixture).includes('plan'));
check('work keeps only the newest 20 runs', (() => {
  const snapshot = projectOverview(config({
    runs: Array.from({ length: OVERVIEW_WORK_LIMIT + 1 }, (_, index) => run({
      id: `r${index}`,
      name: `Run ${index}`,
      updatedAt: index,
    })),
  }), [], now);
  return snapshot.work.length === OVERVIEW_WORK_LIMIT
    && snapshot.work[0]?.id === `r${OVERVIEW_WORK_LIMIT}`
    && snapshot.work[OVERVIEW_WORK_LIMIT - 1]?.id === 'r1';
})());

const started = startInteractiveBookend([], bookend({
  id: 's-live', agentName: 'Worker A', agentId: 'worker',
  repositoryId: 'repo', repositoryName: 'RhinoClaw', startedAt: 8_000,
}));
check('an interactive start is recorded without a host path',
  started.length === 1
    && started[0]?.endedAt === null
    && !JSON.stringify(started).includes('/hidden')
    && !('workspaceDir' in (started[0] ?? {})));
check('task-like records are not implied — only the caller decides what to append',
  startInteractiveBookend(started, bookend({ id: 's-live', agentName: 'Worker A' })).length === 1);
const closed = closeInteractiveBookend(started, 's-live', 9_000, 'exit');
check('closing a bookend fills endedAt and keeps the start identity',
  closed[0]?.endedAt === 9_000
    && closed[0]?.exitReason === 'exit'
    && closed[0]?.agentName === 'Worker A'
    && closed[0]?.repositoryName === 'RhinoClaw');
check('closing an already ended bookend does not rewrite it',
  closeInteractiveBookend(closed, 's-live', 99_000, 'cancelled')[0]?.endedAt === 9_000
    && closeInteractiveBookend(closed, 's-live', 99_000, 'cancelled')[0]?.exitReason === 'exit');
const capped = Array.from({ length: SESSION_BOOKEND_LIMIT }, (_, index) => bookend({
  id: `old-${index}`, agentName: 'N', startedAt: index,
}));
const overflow = startInteractiveBookend(capped, bookend({ id: 'newest', agentName: 'N', startedAt: 10_000 }));
check('the session journal keeps only the newest 100 bookends',
  overflow.length === SESSION_BOOKEND_LIMIT
    && overflow[0]?.id === 'old-1'
    && overflow[SESSION_BOOKEND_LIMIT - 1]?.id === 'newest');
const orphans = interruptOrphanBookends([
  bookend({ id: 'live', agentName: 'A', startedAt: 1 }),
  bookend({ id: 'dead', agentName: 'B', startedAt: 2 }),
  bookend({ id: 'done', agentName: 'C', startedAt: 3, endedAt: 4, exitReason: 'exit' }),
], new Set(['live']), 50);
check('restart closes orphaned open bookends as interrupted and leaves live ones',
  orphans.find((item) => item.id === 'live')?.endedAt === null
    && orphans.find((item) => item.id === 'dead')?.endedAt === 50
    && orphans.find((item) => item.id === 'dead')?.exitReason === 'interrupted'
    && orphans.find((item) => item.id === 'done')?.exitReason === 'exit');

const mixed = projectOverview(config({
  agents: [agent({ id: 'worker', name: 'Worker A' })],
  repositories: [{
    id: 'repo', name: 'RhinoClaw', rootPath: '/hidden', commonGitDir: '/hidden/.git',
    executionBackend: 'native', verified: true, createdAt: 1,
  }],
  runs: [run({ id: 'run-mid', name: 'Graph work', repositoryId: 'repo', updatedAt: 5_000 })],
  sessionBookends: [
    bookend({
      id: 's-open', agentName: 'Worker A', repositoryId: 'repo', repositoryName: 'RhinoClaw',
      startedAt: 20_000,
    }),
    bookend({
      id: 's-closed', agentName: 'Worker A', agentId: 'worker',
      repositoryId: 'repo', repositoryName: 'RhinoClaw',
      startedAt: 6_000, endedAt: 7_000, exitReason: 'exit',
    }),
  ],
}), [], now);
check('work omits open bookends and mixes closed sessions with runs',
  mixed.work.length === 2
    && mixed.work[0]?.kind === 'session'
    && mixed.work[0]?.id === 's-closed'
    && mixed.work[1]?.kind === 'run'
    && mixed.work[1]?.id === 'run-mid');
check('a session work row carries no token rollup',
  mixed.work[0]?.kind === 'session'
    && mixed.work[0].usage.tasksWithTokens === 0
    && mixed.work[0].usage.tasksWithoutTokens === 0
    && mixed.hero.tokens === null);
check('agent last activity includes a live bookend start',
  mixed.agents[0]?.lastActivityAt === 20_000);
check('project last activity includes closed session bookends',
  mixed.projects[0]?.lastActivityAt === 20_000);
check('session work snapshots stay path-free',
  !JSON.stringify(mixed).includes('/hidden'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
