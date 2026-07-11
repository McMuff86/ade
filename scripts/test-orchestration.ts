/** Pure tests for Goal 2 run persistence, migration and event reconstruction. */

import {
  OrchestrationService,
  type OrchestrationConfigPort,
} from '../src/main/orchestration/OrchestrationService';
import { normalizeConfig } from '../src/main/orchestration/migrate';
import {
  DEFAULT_CONFIG,
  type AdeConfig,
  type Agent,
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

function testAgent(id: string, categoryId: string, name: string): Agent {
  return {
    id,
    categoryId,
    name,
    runtime: 'claude',
    permissionMode: 'default',
    workspaceDir: `C:\\workspace\\${id}`,
    memoryDir: `C:\\memory\\${id}`,
  };
}

function memoryStore(initial: AdeConfig): OrchestrationConfigPort & { read(): AdeConfig } {
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

function testLegacyMigration(): void {
  const orchestrator = { ...testAgent('legacy-orch', 'legacy-orchestrator', 'Legacy Orchestrator'), teamRole: 'orchestrator' as const };
  const lead = { ...testAgent('legacy-lead', 'legacy-team', 'Legacy Lead'), teamRole: 'lead' as const };
  const worker = { ...testAgent('legacy-worker', 'legacy-team', 'Legacy Worker'), teamRole: 'worker' as const };
  const legacy = {
    categories: [
      { id: 'legacy-orchestrator', name: 'Orchestrator', kind: 'orchestrator' as const, agents: [orchestrator.id] },
      { id: 'legacy-team', name: 'Platform', kind: 'team' as const, agents: [lead.id, worker.id] },
    ],
    agents: [orchestrator, lead, worker],
    settings: DEFAULT_CONFIG.settings,
  };

  const migrated = normalizeConfig(legacy, 1_000);
  check('legacy Graph config is detected', migrated.migrated);
  check('legacy topology becomes one run', migrated.config.runs.length === 1, migrated.config.runs);
  check('all legacy graph members become participants', migrated.config.runParticipants.length === 3);
  check(
    'catalog categories and agents are retained byte-for-byte by migration',
    migrated.config.categories === legacy.categories && migrated.config.agents === legacy.agents,
  );
  check(
    'legacy lead and worker keep their team grouping',
    migrated.config.runParticipants
      .filter((participant) => participant.teamId === 'legacy-team')
      .map((participant) => participant.role)
      .sort()
      .join(',') === 'lead,worker',
  );

  const secondPass = normalizeConfig(migrated.config, 2_000);
  check('migration is idempotent after the run schema is persisted', !secondPass.migrated);
  check('second normalization does not duplicate the imported run', secondPass.config.runs.length === 1);
}

function testRunJournal(): void {
  const category = { id: 'catalog-team', name: 'Catalog', agents: ['agent-a', 'agent-b'] };
  const agentA = testAgent('agent-a', category.id, 'Ada');
  const agentB = testAgent('agent-b', category.id, 'Linus');
  const config: AdeConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    categories: [category],
    agents: [agentA, agentB],
  };
  const store = memoryStore(config);
  const snapshots: number[] = [];
  const service = new OrchestrationService(store, (snapshot) => snapshots.push(snapshot.events.length));
  const catalogCounts = [store.read().categories.length, store.read().agents.length];

  const run = service.createRun({
    name: 'Release readiness',
    goal: 'Verify the release candidate',
    participants: [
      { agentId: agentA.id, role: 'lead', teamId: 'run-team', teamName: 'Release' },
      { agentId: agentB.id, role: 'worker', teamId: 'run-team', teamName: 'Release' },
    ],
  });
  check('creating a run does not create catalog identities',
    store.read().categories.length === catalogCounts[0] && store.read().agents.length === catalogCounts[1]);
  check('roles live on run participants, not catalog agents',
    store.read().runParticipants.every((participant) => participant.runId === run.id)
      && store.read().agents.every((agent) => agent.teamRole === undefined));
  check('participant names and runtimes are snapshotted',
    store.read().runParticipants[0]?.agentName === 'Ada'
      && store.read().runParticipants[0]?.runtime === 'claude');

  const lead = store.read().runParticipants.find((participant) => participant.role === 'lead')!;
  const task = service.createTask({ runId: run.id, participantId: lead.id, prompt: 'Run all checks' });
  check('new task is durably queued with an event',
    service.snapshot().tasks[0]?.status === 'queued'
      && store.read().runEvents.some((event) => event.taskId === task.id && event.type === 'task.queued'));

  const session: SessionMeta = {
    id: 'session-1',
    agentId: lead.agentId,
    title: 'release check',
    kind: 'task',
    status: 'running',
    createdAt: 3_000,
    runTaskId: task.id,
  };
  service.onTaskStarted(task.id, session);
  check('PTY start transitions the task through the journal',
    service.snapshot().tasks[0]?.status === 'running'
      && service.snapshot().tasks[0]?.sessionId === session.id);
  service.onTaskFinished(task.id, 'completed', 0);
  check('successful PTY exit completes task and run',
    service.snapshot().tasks[0]?.status === 'completed'
      && service.snapshot().runs[0]?.status === 'completed');

  store.read().runTasks[0]!.status = 'failed';
  store.read().runs[0]!.status = 'failed';
  const reconstructed = new OrchestrationService(store).snapshot();
  check('event journal repairs stale cached task status after reload',
    reconstructed.tasks[0]?.status === 'completed');
  check('run status is reconstructed from journal-derived tasks',
    reconstructed.runs[0]?.status === 'completed');

  const artifact = service.createArtifact({
    runId: run.id,
    taskId: task.id,
    kind: 'result',
    content: 'All checks passed',
  });
  check('artifacts are persisted and journaled',
    store.read().runArtifacts[0]?.id === artifact.id
      && store.read().runEvents.some((event) => event.type === 'artifact.created'));

  const failedTask = service.createTask({ runId: run.id, participantId: lead.id, prompt: 'Publish build' });
  service.onTaskLaunchFailed(failedTask.id, false, 'runtime unavailable');
  const finalSnapshot = service.snapshot();
  check('a launch failure is durable and fails the run',
    finalSnapshot.tasks.find((candidate) => candidate.id === failedTask.id)?.status === 'failed'
      && finalSnapshot.runs[0]?.status === 'failed');

  const interruptedTask = service.createTask({
    runId: run.id,
    participantId: lead.id,
    prompt: 'Task active during crash',
  });
  service.onTaskStarted(interruptedTask.id, { ...session, id: 'session-2', runTaskId: interruptedTask.id });
  const recovered = new OrchestrationService(store).recoverInterruptedTasks('simulated restart');
  check('restart recovery closes every orphaned queued/running task',
    recovered === 1
      && new OrchestrationService(store).snapshot().tasks
        .find((candidate) => candidate.id === interruptedTask.id)?.status === 'failed');
  check('every mutation emitted a fresh renderer snapshot', snapshots.length >= 6, snapshots);
}

testLegacyMigration();
testRunJournal();

console.log(`\n${failed ? 'FAILED' : 'PASSED'} - ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
