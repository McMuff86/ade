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

testLegacyMigration();
testRunJournal();
testDomainFoundations();
testRunDeletionAndScopeSnapshots();

console.log(`\n${failed ? 'FAILED' : 'PASSED'} - ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
