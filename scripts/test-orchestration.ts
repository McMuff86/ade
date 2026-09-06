/** Pure tests for Goal 2 run persistence, migration and event reconstruction. */

import {
  OrchestrationService,
  type OrchestrationConfigPort,
  type RunArchive,
} from '../src/main/orchestration/OrchestrationService';
import { normalizeConfig } from '../src/main/orchestration/migrate';
import {
  DEFAULT_CONFIG,
  MAX_RUN_REPORT_TEXT_CHARS,
  type AdeConfig,
  type Agent,
  type SessionMeta,
  type StructuredTaskResult,
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

  const preTimeBudget = structuredClone(secondPass.config);
  delete (preTimeBudget.runs[0]!.budget as Partial<AdeConfig['runs'][number]['budget']>).maxTaskMinutes;
  const withTimeBudget = normalizeConfig(preTimeBudget, 2_500);
  check('budgets written before the task time limit gain an explicit null once and stay canonical',
    withTimeBudget.migrated
      && withTimeBudget.config.runs[0]?.budget.maxTaskMinutes === null
      && withTimeBudget.config.runs[0]?.budget.maxApprovals === secondPass.config.runs[0]?.budget.maxApprovals
      && !normalizeConfig(withTimeBudget.config, 2_600).migrated);

  const partialAttestation = structuredClone(migrated.config);
  partialAttestation.runs[0]!.verificationTaskId = 'orphaned-verify-task';
  partialAttestation.runTasks.push({
    id: 'invalid-verify-task',
    runId: partialAttestation.runs[0]!.id,
    participantId: 'missing-participant',
    prompt: 'legacy fixture',
    title: 'legacy fixture',
    phase: 'verify',
    managed: true,
    dependsOn: [],
    attempt: 1,
    status: 'completed',
    expectedHeadSha: '--malformed-head',
    createdAt: 1,
    updatedAt: 1,
  });
  const cleanedAttestation = normalizeConfig(partialAttestation, 3_000);
  check('migration removes and persists an incomplete verification attestation',
    cleanedAttestation.migrated
      && cleanedAttestation.config.runs[0]?.verifiedHeadSha === undefined
      && cleanedAttestation.config.runs[0]?.verificationTaskId === undefined
      && cleanedAttestation.config.runs[0]?.verifiedAt === undefined
      && cleanedAttestation.config.runTasks.at(-1)?.expectedHeadSha === undefined
      && !normalizeConfig(cleanedAttestation.config, 3_500).migrated);
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
  // onChange carries nothing (Thema 5): the owner reads view() or snapshot().
  const service = new OrchestrationService(store, () => snapshots.push(store.read().runEvents.length));
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

function testDomainFoundations(): void {
  const category = { id: 'foundation-cat', name: 'Foundation', agents: ['agent-a', 'agent-b', 'agent-c'] };
  const config: AdeConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    categories: [category],
    agents: [
      testAgent('agent-a', category.id, 'Orchestrator'),
      testAgent('agent-b', category.id, 'Lead'),
      testAgent('agent-c', category.id, 'Worker'),
    ],
  };
  const store = memoryStore(config);
  let saves = 0;
  const countingStore: OrchestrationConfigPort & { read(): AdeConfig } = {
    get: () => store.get(),
    save: (partial) => {
      saves += 1;
      return store.save(partial);
    },
    read: () => store.read(),
  };
  const service = new OrchestrationService(countingStore);

  const run = service.createRun({
    name: 'Foundations',
    goal: 'Exercise seq, summaries, idempotency and pause',
    participants: [
      { agentId: 'agent-a', role: 'orchestrator' },
      { agentId: 'agent-b', role: 'lead', teamId: 'team-1', teamName: 'Alpha' },
      { agentId: 'agent-c', role: 'worker', teamId: 'team-1', teamName: 'Alpha' },
    ],
    commandId: 'create-run-1',
  });
  const replayed = service.createRun({
    name: 'Duplicate submit',
    goal: 'must not exist',
    participants: [{ agentId: 'agent-b', role: 'orchestrator' }],
    commandId: 'create-run-1',
  });
  check('run:create replays the original run for a reused commandId',
    replayed.id === run.id && store.read().runs.length === 1);

  const participants = store.read().runParticipants;
  const orchestrator = participants.find((participant) => participant.role === 'orchestrator')!;
  const lead = participants.find((participant) => participant.role === 'lead')!;
  service.sendMessage({
    runId: run.id,
    toParticipantId: lead.id,
    kind: 'assignment',
    text: 'Confidential mailbox body',
  });
  const seqs = [
    ...store.read().runEvents.map((event) => event.seq),
    ...store.read().runMessages.map((message) => message.seq),
  ];
  check('journal seq is unique and strictly positive across events and messages',
    new Set(seqs).size === seqs.length && Math.min(...seqs) >= 1);
  const message = store.read().runMessages[0]!;
  const messageEvent = store.read().runEvents.find((event) => event.type === 'message.sent')!;
  check('a message precedes its own message.sent event on the shared cursor',
    message.seq < messageEvent.seq);

  const total = store.read().runEvents.length + store.read().runMessages.length;
  const firstPage = service.eventsSince(0, 3);
  const rest = service.eventsSince(firstPage.nextCursor, 500);
  check('run:events pages the merged journal without overlap or loss',
    firstPage.events.length + firstPage.messages.length === 3 &&
    firstPage.events.length + firstPage.messages.length +
      rest.events.length + rest.messages.length === total);
  const drained = service.eventsSince(rest.nextCursor, 10);
  check('a drained cursor returns an empty page with a stable nextCursor',
    drained.events.length === 0 && drained.messages.length === 0 &&
    drained.nextCursor === rest.nextCursor);

  const legacyRaw = structuredClone(store.read()) as unknown as Record<string, unknown>;
  for (const event of legacyRaw.runEvents as Array<Record<string, unknown>>) delete event.seq;
  for (const item of legacyRaw.runMessages as Array<Record<string, unknown>>) delete item.seq;
  delete legacyRaw.commandLog;
  const renormalized = normalizeConfig(legacyRaw as unknown as Partial<AdeConfig>, 9_000);
  const backfilled = [
    ...renormalized.config.runEvents.map((event) => event.seq),
    ...renormalized.config.runMessages.map((item) => item.seq),
  ].sort((a, b) => a - b);
  check('seq backfill assigns a dense monotonic cursor to pre-cursor journals',
    renormalized.migrated && backfilled.length === total &&
    backfilled[0] === 1 && backfilled[backfilled.length - 1] === total);
  check('seq backfill is idempotent once persisted',
    !normalizeConfig(renormalized.config, 9_500).migrated);

  const savesBeforePause = saves;
  const paused = service.setTeamPaused(run.id, 'team-1', true);
  check('team pause persists on the run and journals team.paused in one save',
    paused.pausedTeamIds?.includes('team-1') === true &&
    store.read().runEvents.some((event) => event.type === 'team.paused' && event.data?.teamId === 'team-1') &&
    saves === savesBeforePause + 1);
  service.setTeamPaused(run.id, 'team-1', true);
  check('repeating the current pause state is a silent no-op', saves === savesBeforePause + 1);
  service.setTeamPaused(run.id, 'team-1', false);
  check('team resume clears the run state and journals team.resumed',
    store.read().runs[0]?.pausedTeamIds?.length === 0 &&
    store.read().runEvents.some((event) => event.type === 'team.resumed'));

  service.acquireWorkspaceLeases(run.id, [{
    participantId: orchestrator.id,
    agentId: orchestrator.agentId,
    workspaceDir: 'C:\\hidden-host-path\\worktree-orch',
    isRepo: true,
    branch: 'ade/foundation-branch',
    baseSha: 'abc123',
    commonGitDir: 'C:\\hidden-host-path\\repo\\.git',
  }]);
  // Manual task titles are the first 80 prompt chars by design (a visible
  // label); the sanitization contract is that the prompt BODY never leaks.
  const task = service.createTask({
    runId: run.id,
    participantId: lead.id,
    prompt: `${'Routine heading for the task list. '.repeat(3)}SECRET-BODY C:\\hidden-host-path\\payload.txt`,
  });
  const summaries = service.summarize();
  const summaryJson = JSON.stringify(summaries);
  check('run summaries project teams, tasks, branch and cursor',
    summaries.length === 1 &&
    summaries[0]!.teams.some((team) => team.id === 'team-1' && team.name === 'Alpha') &&
    summaries[0]!.tasks.some((item) => item.id === task.id) &&
    summaries[0]!.branch === 'ade/foundation-branch' &&
    summaries[0]!.seqCursor > 0);
  check('run summaries never leak paths, prompt bodies or mailbox texts',
    !summaryJson.includes('hidden-host-path') &&
    !summaryJson.includes('SECRET-BODY') &&
    !summaryJson.includes('Confidential mailbox body') &&
    !summaryJson.toLowerCase().includes('workspacedir'));

  const atomicRun = service.createRun({
    name: 'Atomic transitions',
    goal: 'Prove one-save logical transitions',
    participants: [
      { agentId: 'agent-a', role: 'orchestrator' },
      { agentId: 'agent-b', role: 'lead', teamId: 'team-2', teamName: 'Beta' },
      { agentId: 'agent-c', role: 'worker', teamId: 'team-2', teamName: 'Beta' },
    ],
  });
  const atomicParticipants = store.read().runParticipants.filter(
    (participant) => participant.runId === atomicRun.id,
  );
  const atomicOrchestrator = atomicParticipants.find((participant) => participant.role === 'orchestrator')!;
  const atomicLead = atomicParticipants.find((participant) => participant.role === 'lead')!;
  const atomicWorker = atomicParticipants.find((participant) => participant.role === 'worker')!;

  let atomicSaves = saves;
  const planning = service.beginPlanningPhase({
    runId: atomicRun.id,
    participantId: atomicOrchestrator.id,
    title: 'Plan the atomic run',
    phase: 'plan',
    prompt: 'Plan only.',
  });
  check('planning transition and its plan task commit in one save',
    saves === atomicSaves + 1 &&
    planning.run.phase === 'planning' &&
    store.read().runTasks.some((item) => item.id === planning.task.id));

  atomicSaves = saves;
  const working = service.beginWorkingPhase(atomicRun.id, [
    { runId: atomicRun.id, participantId: atomicLead.id, title: 'Lead work', phase: 'work', prompt: 'Do lead work.' },
    { runId: atomicRun.id, participantId: atomicWorker.id, title: 'Worker work', phase: 'work', prompt: 'Do worker work.' },
  ]);
  check('working transition and every work task commit in one save',
    saves === atomicSaves + 1 &&
    working.run.phase === 'working' &&
    working.tasks.length === 2 &&
    store.read().runTasks.filter((item) => item.runId === atomicRun.id && item.phase === 'work').length === 2);

  atomicSaves = saves;
  const approval = service.beginApprovalPhase(atomicRun.id, 'Approve the integration batch');
  check('approval creation and phase change commit in one save',
    saves === atomicSaves + 1 &&
    store.read().runs.find((item) => item.id === atomicRun.id)?.phase === 'approval' &&
    store.read().runApprovals.some((item) => item.id === approval.id && item.status === 'pending'));

  service.setManagedRunPhase(atomicRun.id, 'integrating');
  service.setManagedRunPhase(atomicRun.id, 'verifying');
  service.acquireWorkspaceLeases(atomicRun.id, [{
    participantId: atomicOrchestrator.id,
    agentId: atomicOrchestrator.agentId,
    workspaceDir: 'C:\\hidden-host-path\\worktree-atomic',
    isRepo: true,
    branch: 'ade/atomic-branch',
    baseSha: 'def456',
    commonGitDir: 'C:\\hidden-host-path\\repo\\.git',
  }]);
  atomicSaves = saves;
  const completed = service.completeRun(atomicRun.id, 'All checks passed');
  check('completion and lease release commit in one save',
    saves === atomicSaves + 1 &&
    completed.phase === 'completed' &&
    store.read().runWorkspaceLeases
      .filter((lease) => lease.runId === atomicRun.id)
      .every((lease) => lease.status === 'released') &&
    store.read().runApprovals
      .filter((item) => item.runId === atomicRun.id)
      .every((item) => item.status !== 'pending'));

  for (let index = 0; index < 205; index += 1) {
    service.recordCommand('run:cancel', `bulk-${index}`, null);
  }
  check('the command log stays a bounded FIFO of 200 entries',
    store.read().commandLog.length === 200 &&
    store.read().commandLog.some((entry) => entry.commandId === 'bulk-204') &&
    !store.read().commandLog.some((entry) => entry.commandId === 'bulk-0'));
  let crossChannel = '';
  try {
    service.recallCommand('run:start', 'bulk-204');
  } catch (error) {
    crossChannel = error instanceof Error ? error.message : String(error);
  }
  check('a commandId cannot be replayed through another channel',
    crossChannel.includes('already used'));
}

function testRunDeletionAndScopeSnapshots(): void {
  const category = { id: 'del-cat', name: 'Deletion', agents: ['del-a', 'del-b'] };
  const config: AdeConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    categories: [category],
    agents: [testAgent('del-a', category.id, 'Del Lead'), testAgent('del-b', category.id, 'Del Worker')],
    repositories: [{
      id: 'repo-del',
      name: 'Deletion Repo',
      rootPath: 'C:\\repos\\deletion',
      commonGitDir: 'C:\\repos\\deletion\\.git',
      executionBackend: 'native',
      verified: true,
      createdAt: 1_000,
    }],
  };
  const store = memoryStore(config);
  const service = new OrchestrationService(store);

  const scopedRun = service.createRun({
    name: 'Scoped run',
    goal: 'Scope snapshots',
    repositoryId: 'repo-del',
    participants: [
      { agentId: 'del-a', role: 'lead', teamId: 'del-team', teamName: 'Deletion' },
      { agentId: 'del-b', role: 'worker', teamId: 'del-team', teamName: 'Deletion' },
    ],
  });
  const scopedLead = store.read().runParticipants.find(
    (participant) => participant.runId === scopedRun.id && participant.role === 'lead',
  )!;
  const scopedTask = service.createTask({
    runId: scopedRun.id,
    participantId: scopedLead.id,
    prompt: 'Work in the run repository',
  });
  check('run and participants snapshot the selected repository',
    scopedRun.repositoryId === 'repo-del'
      && store.read().runParticipants
        .filter((participant) => participant.runId === scopedRun.id)
        .every((participant) => participant.repositoryId === 'repo-del'));
  check('a manual task freezes the run repository scope at creation',
    scopedTask.repositoryId === 'repo-del');

  const plainRun = service.createRun({
    name: 'Plain run',
    repositoryId: null,
    participants: [{ agentId: 'del-a', role: 'lead', teamId: 'plain-team', teamName: 'Plain' }],
  });
  const plainLead = store.read().runParticipants.find(
    (participant) => participant.runId === plainRun.id,
  )!;
  const plainTask = service.createTask({
    runId: plainRun.id,
    participantId: plainLead.id,
    prompt: 'Work in the plain home workspace',
  });
  check('an explicit no-repository run snapshots null (not agent default) onto tasks',
    plainRun.repositoryId === null && plainTask.repositoryId === null);

  let unknownRepoError = '';
  try {
    service.createRun({
      name: 'Broken scope',
      repositoryId: 'repo-missing',
      participants: [{ agentId: 'del-a', role: 'lead', teamId: 'x', teamName: 'X' }],
    });
  } catch (error) {
    unknownRepoError = error instanceof Error ? error.message : String(error);
  }
  check('a run cannot reference an unknown repository', unknownRepoError.includes('repository not found'));

  service.acquireWorkspaceLeases(scopedRun.id, [{
    participantId: scopedLead.id,
    agentId: scopedLead.agentId,
    workspaceDir: 'C:\\worktrees\\deletion\\del-lead',
    isRepo: true,
    branch: 'ade/del-lead',
    baseSha: 'abc123',
    commonGitDir: 'C:\\repos\\deletion\\.git',
    repositoryId: 'repo-del',
  }]);
  let leaseError = '';
  try {
    service.deleteRun(scopedRun.id);
  } catch (error) {
    leaseError = error instanceof Error ? error.message : String(error);
  }
  check('an active workspace lease blocks run deletion',
    leaseError.includes('cancel the active run')
      && store.read().runs.some((candidate) => candidate.id === scopedRun.id));

  service.releaseWorkspaceLeases(scopedRun.id);
  service.deleteRun(scopedRun.id);
  const after = store.read();
  check('run deletion purges every run-scoped record set',
    !after.runs.some((candidate) => candidate.id === scopedRun.id)
      && !after.runParticipants.some((participant) => participant.runId === scopedRun.id)
      && !after.runTasks.some((task) => task.runId === scopedRun.id)
      && !after.runEvents.some((event) => event.runId === scopedRun.id)
      && !after.runWorkspaceLeases.some((lease) => lease.runId === scopedRun.id)
      && !after.runArtifacts.some((artifact) => artifact.runId === scopedRun.id));
  check('deleting one run leaves other runs untouched',
    after.runs.some((candidate) => candidate.id === plainRun.id)
      && after.runTasks.some((task) => task.runId === plainRun.id)
      && after.repositories.length === 1);

  let repeatedDeleteError = '';
  try {
    service.deleteRun(scopedRun.id);
  } catch (error) {
    repeatedDeleteError = error instanceof Error ? error.message : String(error);
  }
  check('deleting an already-deleted run stays a safe no-op', repeatedDeleteError === '');
}

function testHarnessOverride(): void {
  const category = { id: 'harness-team', name: 'Harness', agents: ['harness-a', 'harness-b'] };
  const agentA = testAgent('harness-a', category.id, 'Ada');
  const agentB = testAgent('harness-b', category.id, 'Linus');
  const config: AdeConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    categories: [category],
    agents: [agentA, agentB],
  };
  const store = memoryStore(config);
  const service = new OrchestrationService(store);

  const run = service.createRun({
    name: 'Harness override run',
    participants: [
      { agentId: agentA.id, role: 'orchestrator', runtime: 'codex' },
      { agentId: agentB.id, role: 'lead', teamId: 'harness-run-team', teamName: 'Harness', runtime: 'claude' },
    ],
  });
  const participants = store.read().runParticipants.filter((item) => item.runId === run.id);
  check('a per-run harness override is snapshotted on the participant, not the agent',
    participants.find((item) => item.agentId === agentA.id)?.runtime === 'codex'
      && participants.find((item) => item.agentId === agentB.id)?.runtime === 'claude'
      && store.read().agents.find((agent) => agent.id === agentA.id)?.runtime === 'claude');

  let unsupportedRejected = false;
  try {
    service.createRun({
      name: 'Unsupported harness',
      participants: [{ agentId: agentA.id, role: 'orchestrator', runtime: 'custom' }],
    });
  } catch {
    unsupportedRejected = true;
  }
  check('overriding to a harness without a managed launch profile fails closed',
    unsupportedRejected
      && !store.read().runs.some((candidate) => candidate.name === 'Unsupported harness'));
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function structuredResult(overrides: Partial<StructuredTaskResult> = {}): StructuredTaskResult {
  return {
    version: 1,
    outcome: 'succeeded',
    summary: 'Implemented the feature.',
    assignments: [],
    filesChanged: ['src/a.ts', 'src/b.ts'],
    tests: [{ command: 'pnpm test:unit', status: 'passed', output: 'ok' }],
    commitSha: SHA_A,
    risks: [],
    usage: { inputTokens: 10, outputTokens: 5, costUsd: null },
    ...overrides,
  };
}

/** Thema 5: the renderer view carries no prompts, bodies or texts. */
function testRendererView(): void {
  const category = { id: 'view-cat', name: 'View', agents: ['view-a', 'view-b'] };
  const config: AdeConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    categories: [category],
    agents: [testAgent('view-a', category.id, 'Ada'), testAgent('view-b', category.id, 'Linus')],
  };
  const store = memoryStore(config);
  let changes = 0;
  const service = new OrchestrationService(store, () => { changes += 1; });
  const run = service.createRun({
    name: 'View run',
    goal: 'Slim projection',
    participants: [
      { agentId: 'view-a', role: 'orchestrator' },
      { agentId: 'view-b', role: 'lead', teamId: 'view-team', teamName: 'View' },
    ],
  });
  service.setManagedRunPhase(run.id, 'planning');
  const lead = store.read().runParticipants.find((participant) => participant.role === 'lead')!;
  const secretPrompt = 'SECRET-PROMPT-BODY do the work';
  // A manual task without a title derives one from its prompt; the title is a
  // deliberate, bounded projection and not what this check is about.
  const task = service.createManagedTask({
    runId: run.id, participantId: lead.id, prompt: secretPrompt, title: 'Do the work', phase: 'work',
  });
  service.createArtifact({ runId: run.id, taskId: task.id, kind: 'file', path: 'notes.md', content: 'ARTIFACT-BODY' });
  service.createArtifact({
    runId: run.id,
    taskId: task.id,
    kind: 'file',
    path: `context/task-${task.id}.json`,
    content: JSON.stringify({ provenance: { promptVersion: 3, resultSchemaVersion: 1, adapterId: 'codex', modelId: 'gpt-5' } }),
  });
  service.sendMessage({ runId: run.id, taskId: task.id, toParticipantId: lead.id, kind: 'assignment', text: 'MAILBOX-TEXT' });

  const view = service.view();
  const serialized = JSON.stringify(view);
  check('view carries no prompt, artifact body or mailbox text',
    !serialized.includes('SECRET-PROMPT-BODY') && !serialized.includes('ARTIFACT-BODY') && !serialized.includes('MAILBOX-TEXT'));
  check('view tasks expose digest and length instead of the prompt',
    view.tasks[0]?.promptChars === secretPrompt.length
      && /^[0-9a-f]{64}$/.test(view.tasks[0]?.promptDigest ?? '')
      && !('prompt' in (view.tasks[0] ?? {})));
  check('view artifacts and messages keep their sizes',
    view.artifacts.find((artifact) => artifact.path === 'notes.md')?.contentChars === 'ARTIFACT-BODY'.length
      && view.messages[0]?.textChars === 'MAILBOX-TEXT'.length);
  check('view parses provenance in main from the context packet',
    view.tasks[0]?.provenance?.modelId === 'gpt-5' && view.tasks[0]?.provenance?.promptVersion === 3);
  check('view seqCursor equals the journal cursor', view.seqCursor === service.journalCursor() && view.seqCursor > 0);
  check('view keeps the same record counts as the snapshot',
    view.events.length === service.snapshot().events.length && view.runs.length === 1 && view.tasks.length === 1);
  const digestBefore = view.tasks[0]?.promptDigest;
  check('prompt digests are stable across views', service.view().tasks[0]?.promptDigest === digestBefore);
  check('snapshot still carries the full prompt for main-internal callers',
    service.snapshot().tasks[0]?.prompt === secretPrompt);
  check('onChange fired once per persisted mutation', changes === 6, changes);
}

/** Thema 3: the report names files, tests, risks, SHAs and the failed test. */
function testRunReport(): void {
  const category = { id: 'report-cat', name: 'Report', agents: ['rep-a', 'rep-b'] };
  const config: AdeConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    categories: [category],
    agents: [testAgent('rep-a', category.id, 'Orchestrator'), testAgent('rep-b', category.id, 'Worker')],
  };
  const store = memoryStore(config);
  const service = new OrchestrationService(store);
  const run = service.createRun({
    name: 'Report run',
    goal: 'Ship it',
    participants: [
      { agentId: 'rep-a', role: 'orchestrator' },
      { agentId: 'rep-b', role: 'worker', teamId: 'rep-team', teamName: 'Report' },
    ],
  });
  service.setManagedRunPhase(run.id, 'planning');
  const orchestrator = store.read().runParticipants.find((participant) => participant.role === 'orchestrator')!;
  const worker = store.read().runParticipants.find((participant) => participant.role === 'worker')!;
  const work = service.createManagedTask({
    runId: run.id, participantId: worker.id, prompt: 'work', title: 'Implement feature', phase: 'work',
  });
  service.onTaskStarted(work.id, {
    id: 's-work', agentId: worker.agentId, title: 'work', kind: 'task', status: 'running', createdAt: 1, runTaskId: work.id,
  });
  const longSummary = 'x'.repeat(MAX_RUN_REPORT_TEXT_CHARS + 500);
  service.recordResult({
    runId: run.id, taskId: work.id, participantId: worker.id, adapterId: 'codex', resultPath: 'r.json',
    result: structuredResult({ summary: longSummary, risks: ['touches auth'] }),
  });
  service.onTaskFinished(work.id, 'completed', 0);
  service.markIntegrationApplied(run.id, { commitCount: 1, fromSha: SHA_A, toSha: SHA_B });
  const verify = service.createManagedTask({
    runId: run.id, participantId: orchestrator.id, prompt: 'verify', title: 'Verify integrated work', phase: 'verify',
  });
  service.onTaskStarted(verify.id, {
    id: 's-verify', agentId: orchestrator.agentId, title: 'verify', kind: 'task', status: 'running', createdAt: 2, runTaskId: verify.id,
  });
  service.recordResult({
    runId: run.id, taskId: verify.id, participantId: orchestrator.id, adapterId: 'codex', resultPath: 'v.json',
    result: structuredResult({
      filesChanged: [],
      commitSha: null,
      tests: [
        { command: 'pnpm lint', status: 'passed', output: '' },
        { command: 'pnpm test:integration', status: 'failed', output: 'AssertionError: expected 1 to equal 2' },
      ],
    }),
  });
  service.onTaskFinished(verify.id, 'completed', 0);
  service.setManagedRunPhase(run.id, 'failed', 'verification reported one or more failed tests');

  const report = service.report(run.id);
  check('report names the failed test command behind a verification failure',
    report.status === 'failed'
      && report.failure?.failedTests.join(',') === 'pnpm test:integration'
      && report.failure.detail === 'verification reported one or more failed tests'
      && report.failure.context === 'Verify integrated work');
  check('report carries the complete changed-file set and risks',
    report.tasks[0]?.result?.filesChanged.join(',') === 'src/a.ts,src/b.ts'
      && report.tasks[0]?.result?.risks[0] === 'touches auth'
      && report.totals.filesChanged === 2);
  check('report bounds long text without cutting it to a teaser',
    (report.tasks[0]?.result?.summary.length ?? 0) === MAX_RUN_REPORT_TEXT_CHARS
      && report.tasks[0]!.result!.summary.startsWith('xxxx'));
  check('report keeps every test with status and output',
    report.tasks[1]?.result?.tests.length === 2
      && report.tasks[1]?.result?.tests[1]?.output.includes('AssertionError')
      && report.totals.testsPassed === 2 && report.totals.testsFailed === 1);
  check('report carries the integration range and commit SHAs',
    report.integration?.fromSha === SHA_A && report.integration?.toSha === SHA_B
      && report.integration.commitCount === 1 && report.tasks[0]?.result?.commitSha === SHA_A);
  check('report resolves participant names and roles',
    report.tasks[0]?.participantName === 'Worker' && report.tasks[0]?.role === 'worker'
      && report.tasks[0]?.teamName === 'Report' && report.tasks[1]?.role === 'orchestrator');
  check('report has an endedAt for a terminal run and a seq cursor',
    typeof report.endedAt === 'number' && report.seqCursor === service.journalCursor());
  check('report usage is summed from the results',
    report.usage.inputTokens === 20 && report.usage.outputTokens === 10 && report.usage.unreportedCostTasks === 2);
  let missing = '';
  try {
    service.report('no-such-run');
  } catch (error) {
    missing = error instanceof Error ? error.message : String(error);
  }
  check('report of an unknown run fails closed', missing.includes('run not found'));

  let badSha = '';
  try {
    service.markIntegrationApplied(run.id, { commitCount: 1, fromSha: 'not-a-sha', toSha: null });
  } catch (error) {
    badSha = error instanceof Error ? error.message : String(error);
  }
  check('integration SHAs are validated as git object ids', badSha.includes('git object id'));
}

/** Thema 5: history retention archives before pruning and keeps seq monotonic. */
function testHistoryRetention(): void {
  const category = { id: 'ret-cat', name: 'Retention', agents: ['ret-a'] };
  const config: AdeConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    categories: [category],
    agents: [testAgent('ret-a', category.id, 'Ada')],
  };
  const store = memoryStore(config);
  const archives: RunArchive[] = [];
  const service = new OrchestrationService(store, () => undefined, { write: (archive) => archives.push(archive) });
  const now = 100 * DAY_MS;
  const finished = (name: string, ageDays: number): string => {
    const run = service.createRun({ name, participants: [{ agentId: 'ret-a', role: 'lead', teamId: 't', teamName: 'T' }] });
    const lead = store.read().runParticipants.find((participant) => participant.runId === run.id)!;
    const task = service.createTask({ runId: run.id, participantId: lead.id, prompt: `prompt for ${name}` });
    service.onTaskFinished(task.id, 'completed', 0);
    store.read().runs = store.read().runs.map((candidate) =>
      candidate.id === run.id ? { ...candidate, updatedAt: now - ageDays * DAY_MS } : candidate);
    return run.id;
  };
  const oldRun = finished('old', 45);
  const oldPublished = finished('old published', 50);
  const recentRun = finished('recent', 2);
  const openRun = service.createRun({ name: 'open', participants: [{ agentId: 'ret-a', role: 'lead', teamId: 't', teamName: 'T' }] });
  // A publication audit pins the run; seeded directly because beginPublication
  // demands a completed managed run, and this fixture is manual.
  store.read().runPublications.push({
    id: 'pub-1', runId: oldPublished, repositoryId: 'repo', provider: 'github', providerRepository: 'o/r',
    remoteName: 'origin', baseBranch: 'main', headBranch: 'ade/x', baseSha: SHA_A, headSha: SHA_B,
    status: 'draft', prNumber: 1, prUrl: 'https://github.com/o/r/pull/1', createdAt: now, updatedAt: now,
  });
  const cursorBefore = service.journalCursor();
  const policy = { keepTerminalRuns: 1, keepTerminalDays: 30, maxConfigBytes: 100 * 1024 * 1024 };

  const noArchiveService = new OrchestrationService(memoryStore(store.read()));
  const skipped = noArchiveService.applyRetention(now, policy);
  check('without an archive port retention prunes nothing and says why',
    skipped.skipped === 'no-archive' && skipped.archivedRunIds.length === 0);

  const outcome = service.applyRetention(now, policy);
  check('retention archives exactly the old, unpublished terminal run',
    outcome.archivedRunIds.join(',') === oldRun && archives.length === 1 && archives[0]?.run.id === oldRun);
  check('archive carries the complete record set including the prompt',
    archives[0]?.tasks[0]?.prompt === 'prompt for old' && archives[0]?.events.length > 0 && archives[0]?.format === 'ade-run-archive');
  const after = store.read();
  check('pruned run leaves no record behind',
    !after.runs.some((run) => run.id === oldRun) && !after.runTasks.some((task) => task.runId === oldRun)
      && !after.runEvents.some((event) => event.runId === oldRun));
  check('recent, open and published runs survive',
    after.runs.some((run) => run.id === recentRun) && after.runs.some((run) => run.id === openRun.id)
      && after.runs.some((run) => run.id === oldPublished));
  check('retention bookkeeping is persisted',
    after.journalRetention.archivedRuns === 1 && after.journalRetention.lastPrunedAt === now
      && after.journalRetention.prunedSeq > 0);
  check('journal cursor never moves backwards after pruning', service.journalCursor() >= cursorBefore);
  const nextRun = service.createRun({ name: 'after prune', participants: [{ agentId: 'ret-a', role: 'lead', teamId: 't', teamName: 'T' }] });
  const nextSeq = store.read().runEvents.find((event) => event.runId === nextRun.id)?.seq ?? 0;
  check('new events continue above every seq ever issued', nextSeq > cursorBefore);
  check('retention reports byte sizes', outcome.bytesBefore > outcome.bytesAfter && outcome.bytesAfter > 0);

  const idle = service.applyRetention(now, policy);
  check('a second pass with nothing to prune is a no-op', idle.archivedRunIds.length === 0 && archives.length === 1);

  // Byte pressure prunes the oldest terminal runs even inside the age window.
  const pressure = service.applyRetention(now, { keepTerminalRuns: 40, keepTerminalDays: 30, maxConfigBytes: 1 });
  check('byte pressure prunes recent terminal runs but never open or published ones',
    pressure.archivedRunIds.join(',') === recentRun
      && store.read().runs.some((run) => run.id === openRun.id)
      && store.read().runs.some((run) => run.id === oldPublished));

  // deleteRun advances the same floor so a restart cannot re-issue a seq.
  const deleteStore = memoryStore({ ...structuredClone(DEFAULT_CONFIG), categories: [category], agents: config.agents });
  const deleteService = new OrchestrationService(deleteStore);
  const doomed = deleteService.createRun({ name: 'doomed', participants: [{ agentId: 'ret-a', role: 'lead', teamId: 't', teamName: 'T' }] });
  const doomedSeq = deleteService.journalCursor();
  deleteService.deleteRun(doomed.id);
  const restarted = new OrchestrationService(deleteStore);
  const fresh = restarted.createRun({ name: 'fresh', participants: [{ agentId: 'ret-a', role: 'lead', teamId: 't', teamName: 'T' }] });
  check('after deleting the newest run a restarted service still issues higher seqs',
    (deleteStore.read().runEvents.find((event) => event.runId === fresh.id)?.seq ?? 0) > doomedSeq
      && deleteStore.read().journalRetention.prunedSeq === doomedSeq);

  const migratedRetention = normalizeConfig(
    { ...structuredClone(DEFAULT_CONFIG), journalRetention: { prunedSeq: 7 } } as unknown as AdeConfig,
    1,
  );
  check('a damaged retention record is repaired field by field and keeps its seq floor',
    migratedRetention.migrated && migratedRetention.config.journalRetention.prunedSeq === 7
      && migratedRetention.config.journalRetention.archivedRuns === 0
      && !normalizeConfig(migratedRetention.config, 2).migrated);
}

testLegacyMigration();
testRunJournal();
testDomainFoundations();
testHarnessOverride();
testRunDeletionAndScopeSnapshots();
testRendererView();
testRunReport();
testHistoryRetention();

console.log(`\n${failed ? 'FAILED' : 'PASSED'} - ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
