import { randomUUID } from 'node:crypto';
import {
  DEFAULT_RUN_BUDGET,
  type AdeConfig,
  type CommandLogEntry,
  type OrchestrationSnapshot,
  type Run,
  type RunApproval,
  type RunArtifact,
  type RunCreateInput,
  type RunEvent,
  type RunMessage,
  type RunPhase,
  type RunPublication,
  type RunStatus,
  type RunSummary,
  type RunTask,
  type RunTaskCreateInput,
  type RunTaskPhase,
  type RunTaskResult,
  type RunTaskStatus,
  type RunUsage,
  type RunWorkspaceLease,
  type SessionMeta,
  type StructuredTaskResult,
} from '../../shared/types';
import { MANAGED_HARNESS_OVERRIDES } from '../../shared/runtimes';
import { RUN_CONTEXT_MANIFEST_PATH, sha256 } from './contextManifest';
import { hostPathKey } from '../platform';

export interface OrchestrationConfigPort {
  get(): AdeConfig;
  save(partial: Partial<AdeConfig>): AdeConfig;
}

export interface ManagedTaskInput extends RunTaskCreateInput {
  title: string;
  phase: Exclude<RunTaskPhase, 'manual'>;
  dependsOn?: string[];
  attempt?: number;
  expectedHeadSha?: string;
}

const MAX_TASK_PROMPT_CHARS = 32_000;
const MAX_RUN_NAME_CHARS = 80;
const MAX_RUN_GOAL_CHARS = 1_000;
const MAX_RUN_PARTICIPANTS = 128;
const MAX_ARTIFACT_CONTENT_CHARS = 256 * 1_024;
const MAX_ARTIFACT_PATH_CHARS = 1_024;
const MAX_MESSAGE_CHARS = 32_000;
const MAX_COMMAND_ID_CHARS = 128;
const MAX_COMMAND_RESULT_CHARS = 16_384;
const GIT_OBJECT_ID = /^[0-9a-f]{40,64}$/;
const COMMAND_LOG_LIMIT = 200;
const EVENTS_QUERY_DEFAULT_LIMIT = 200;
const EVENTS_QUERY_MAX_LIMIT = 500;
const PARTICIPANT_ROLES = new Set(['orchestrator', 'lead', 'worker']);
const ARTIFACT_KINDS = new Set(['file', 'patch', 'message', 'result']);

const EVENT_STATUS: Partial<Record<RunEvent['type'], RunTaskStatus>> = {
  'task.queued': 'queued',
  'task.started': 'running',
  'task.completed': 'completed',
  'task.failed': 'failed',
  'task.cancelled': 'cancelled',
};

export class OrchestrationService {
  /** Cached top of the journal cursor; lazily derived from persisted records. */
  private seqCounter: number | null = null;

  constructor(
    private readonly store: OrchestrationConfigPort,
    private readonly onChange: (snapshot: OrchestrationSnapshot) => void = () => undefined,
  ) {}

  /**
   * Next globally monotonic journal seq. Gaps are fine (a built event may
   * never be saved); the cursor only promises strict monotonic growth, so
   * run:events consumers never see a record twice for the same cursor.
   */
  private nextSeq(): number {
    if (this.seqCounter === null) {
      const config = this.store.get();
      let max = 0;
      for (const record of [...config.runEvents, ...config.runMessages]) {
        if (typeof record.seq === 'number' && Number.isFinite(record.seq) && record.seq > max) {
          max = record.seq;
        }
      }
      this.seqCounter = max;
    }
    this.seqCounter += 1;
    return this.seqCounter;
  }

  snapshot(): OrchestrationSnapshot {
    const config = this.store.get();
    const tasks = deriveTasks(config.runTasks, config.runEvents);
    const runs = config.runs.map((run) => ({
      ...run,
      budget: { ...run.budget },
      status: run.mode === 'managed' ? run.status : deriveRunStatus(run.id, tasks),
    }));
    return {
      runs,
      participants: config.runParticipants.map((participant) => ({ ...participant })),
      tasks: tasks.map((task) => ({ ...task, dependsOn: [...task.dependsOn] })),
      events: config.runEvents.map((event) => ({ ...event, data: event.data ? { ...event.data } : undefined })),
      artifacts: config.runArtifacts.map((artifact) => ({ ...artifact })),
      results: config.runTaskResults.map(cloneResult),
      approvals: config.runApprovals.map((approval) => ({ ...approval })),
      workspaceLeases: config.runWorkspaceLeases.map((lease) => ({ ...lease })),
      publications: config.runPublications.map((publication) => ({ ...publication })),
      messages: config.runMessages.map((message) => ({ ...message })),
      usageByRun: usageByRun(config),
    };
  }

  /**
   * Cursor-paged journal window over events AND messages, ordered by the
   * shared monotonic seq. This is the resumable delta feed the Goal 7 SSE
   * stream will serve; deleted runs drop out of the journal by design.
   */
  eventsSince(sinceSeq = 0, limit = EVENTS_QUERY_DEFAULT_LIMIT): {
    events: RunEvent[];
    messages: RunMessage[];
    nextCursor: number;
  } {
    if (!Number.isFinite(sinceSeq) || sinceSeq < 0) {
      throw new Error('ade: sinceSeq must be a non-negative number');
    }
    const bounded = Math.max(1, Math.min(EVENTS_QUERY_MAX_LIMIT, Math.floor(limit)));
    const config = this.store.get();
    const window = [
      ...config.runEvents.map((record) => ({ seq: record.seq, kind: 'event' as const, record })),
      ...config.runMessages.map((record) => ({ seq: record.seq, kind: 'message' as const, record })),
    ]
      .filter((item) => item.seq > sinceSeq)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, bounded);
    const events: RunEvent[] = [];
    const messages: RunMessage[] = [];
    for (const item of window) {
      if (item.kind === 'event') {
        const event = item.record as RunEvent;
        events.push({ ...event, data: event.data ? { ...event.data } : undefined });
      } else {
        messages.push({ ...(item.record as RunMessage) });
      }
    }
    return {
      events,
      messages,
      nextCursor: window.length > 0 ? window[window.length - 1]!.seq : sinceSeq,
    };
  }

  /**
   * Sanitized projection for the Graph canvas and the future mobile DTO.
   * Never emits absolute paths, prompts, mailbox texts, artifact contents,
   * lease paths or task error strings (which may embed host paths).
   */
  summarize(runId?: string): RunSummary[] {
    const config = this.store.get();
    if (runId && !config.runs.some((run) => run.id === runId)) {
      throw new Error(`ade: run not found "${runId}"`);
    }
    const derivedTasks = deriveTasks(config.runTasks, config.runEvents);
    const usage = usageByRun(config);
    const repositories = new Map(config.repositories.map((repository) => [repository.id, repository]));
    let seqCursor = 0;
    for (const record of [...config.runEvents, ...config.runMessages]) {
      if (record.seq > seqCursor) seqCursor = record.seq;
    }
    const runs = runId ? config.runs.filter((run) => run.id === runId) : config.runs;
    return runs.map((run): RunSummary => {
      const participants = config.runParticipants.filter((participant) => participant.runId === run.id);
      const pausedTeamIds = [...(run.pausedTeamIds ?? [])];
      const pausedSet = new Set(pausedTeamIds);
      const teams = new Map<string, { id: string; name: string; paused: boolean }>();
      for (const participant of participants) {
        if (participant.teamId && !teams.has(participant.teamId)) {
          teams.set(participant.teamId, {
            id: participant.teamId,
            name: participant.teamName ?? participant.teamId,
            paused: pausedSet.has(participant.teamId),
          });
        }
      }
      const status = run.mode === 'managed'
        ? run.status
        : deriveRunStatus(run.id, derivedTasks);
      const activeLease = config.runWorkspaceLeases.find(
        (lease) => lease.runId === run.id && lease.status === 'active',
      );
      const pendingApproval = config.runApprovals.find(
        (approval) => approval.runId === run.id && approval.status === 'pending',
      );
      return {
        id: run.id,
        name: run.name,
        goal: run.goal.slice(0, MAX_RUN_GOAL_CHARS),
        status,
        mode: run.mode,
        phase: run.phase,
        repositoryId: run.repositoryId,
        repositoryName: typeof run.repositoryId === 'string'
          ? repositories.get(run.repositoryId)?.name
          : undefined,
        branch: activeLease?.branch || undefined,
        teams: [...teams.values()],
        participants: participants.map((participant) => ({
          id: participant.id,
          agentName: participant.agentName,
          role: participant.role,
          teamId: participant.teamId,
          teamName: participant.teamName,
        })),
        tasks: derivedTasks
          .filter((task) => task.runId === run.id)
          .map((task) => ({
            id: task.id,
            participantId: task.participantId,
            title: task.title,
            phase: task.phase,
            status: task.status,
            attempt: task.attempt,
            managed: task.managed,
            createdAt: task.createdAt,
            startedAt: task.startedAt,
            endedAt: task.endedAt,
          })),
        budget: { ...run.budget },
        usage: usage[run.id] ?? {
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          approvals: 0,
          unreportedCostTasks: 0,
        },
        pendingApprovalId: pendingApproval?.id ?? null,
        pausedTeamIds,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        seqCursor,
      };
    });
  }

  createRun(input: RunCreateInput): Run {
    const commandId = normalizeCommandId(input.commandId);
    const recalled = this.recallCommand<Run>('run:create', commandId);
    if (recalled) return recalled.result;
    const name = input.name.trim();
    if (!name) throw new Error('ade: run name is required');
    if (name.length > MAX_RUN_NAME_CHARS) {
      throw new Error(`ade: run name exceeds ${MAX_RUN_NAME_CHARS} characters`);
    }
    if (input.participants.length === 0) throw new Error('ade: a run needs at least one participant');
    if (input.participants.length > MAX_RUN_PARTICIPANTS) {
      throw new Error(`ade: run exceeds ${MAX_RUN_PARTICIPANTS} participants`);
    }

    const goal = input.goal?.trim() ?? '';
    if (goal.length > MAX_RUN_GOAL_CHARS) {
      throw new Error(`ade: run goal exceeds ${MAX_RUN_GOAL_CHARS} characters`);
    }

    const config = this.store.get();
    if (typeof input.repositoryId === 'string' && !config.repositories.some(
      (repository) => repository.id === input.repositoryId,
    )) {
      throw new Error(`ade: run repository not found "${input.repositoryId}"`);
    }
    const agents = new Map(config.agents.map((agent) => [agent.id, agent]));
    const seen = new Set<string>();
    const now = Date.now();
    const run: Run = {
      id: randomUUID(),
      name,
      goal,
      status: 'draft',
      mode: 'manual',
      phase: 'draft',
      budget: normalizeBudget(input.budget),
      source: 'native',
      repositoryId: input.repositoryId,
      createdAt: now,
      updatedAt: now,
    };
    const participants = input.participants.map((item, index) => {
      if (!PARTICIPANT_ROLES.has(item.role)) {
        throw new Error(`ade: invalid participant role "${String(item.role)}"`);
      }
      const agent = agents.get(item.agentId);
      if (!agent) throw new Error(`ade: run participant agent not found "${item.agentId}"`);
      if (seen.has(agent.id)) throw new Error(`ade: agent "${agent.name}" appears twice in the run`);
      seen.add(agent.id);
      const teamId = item.teamId?.trim();
      const teamName = item.teamName?.trim();
      if (item.role !== 'orchestrator' && (!teamId || !teamName)) {
        throw new Error(`ade: ${item.role} participant requires a team`);
      }
      if (item.runtime !== undefined && item.runtime !== agent.runtime
          && !MANAGED_HARNESS_OVERRIDES.includes(item.runtime)) {
        throw new Error(
          `ade: harness override "${item.runtime}" is not supported for "${agent.name}"`,
        );
      }
      return {
        id: randomUUID(),
        runId: run.id,
        agentId: agent.id,
        agentName: agent.name,
        runtime: item.runtime ?? agent.runtime,
        role: item.role,
        teamId: item.role === 'orchestrator' ? undefined : teamId,
        teamName: item.role === 'orchestrator' ? undefined : teamName,
        repositoryId: input.repositoryId,
        createdAt: now + index,
      };
    });
    const events: RunEvent[] = [
      this.event(run.id, 'run.created', {
        data: {
          source: 'native',
          repositoryId: input.repositoryId ?? null,
        },
        at: now,
      }),
      ...participants.map((participant) => this.event(run.id, 'participant.added', {
        participantId: participant.id,
        at: participant.createdAt,
      })),
    ];

    const created: Run = { ...run, budget: { ...run.budget } };
    this.store.save({
      runs: [...config.runs, run],
      runParticipants: [...config.runParticipants, ...participants],
      runEvents: [...config.runEvents, ...events],
      // The idempotency record commits atomically with the run it describes.
      ...(commandId ? {
        commandLog: appendCommandLog(config.commandLog, {
          commandId,
          channel: 'run:create',
          createdAt: now,
          resultJson: serializeCommandResult(created),
        }),
      } : {}),
    });
    this.emit();
    return created;
  }

  /**
   * Replay lookup for an idempotent command. Returns the recorded result for
   * a commandId that already succeeded, null when the command must execute.
   * Only successful commands are recorded, so a failed attempt may retry
   * with the same commandId.
   */
  recallCommand<T>(channel: string, commandId: string | undefined): { result: T } | null {
    const normalized = normalizeCommandId(commandId);
    if (!normalized) return null;
    const entry = this.store.get().commandLog.find(
      (candidate) => candidate.commandId === normalized,
    );
    if (!entry) return null;
    if (entry.channel !== channel) {
      throw new Error(`ade: commandId "${normalized}" was already used by ${entry.channel}`);
    }
    return { result: JSON.parse(entry.resultJson) as T };
  }

  /** Persist a successful command outcome for later replay (bounded FIFO). */
  recordCommand(channel: string, commandId: string | undefined, result: unknown): void {
    const normalized = normalizeCommandId(commandId);
    if (!normalized) return;
    const config = this.store.get();
    if (config.commandLog.some((entry) => entry.commandId === normalized)) return;
    this.store.save({
      commandLog: appendCommandLog(config.commandLog, {
        commandId: normalized,
        channel,
        createdAt: Date.now(),
        resultJson: serializeCommandResult(result),
      }),
    });
  }

  beginPublication(
    input: Omit<RunPublication, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'prNumber' | 'prUrl' | 'error'>,
  ): RunPublication {
    const config = this.store.get();
    const run = config.runs.find((candidate) => candidate.id === input.runId);
    if (!run || run.mode !== 'managed' || run.status !== 'completed' || run.phase !== 'completed') {
      throw new Error('ade: only a completed managed run can be published');
    }
    if (run.verifiedHeadSha !== input.headSha || !run.verificationTaskId || !run.verifiedAt) {
      throw new Error('ade: publication head does not match the run verification attestation');
    }
    const previous = config.runPublications.find((candidate) => candidate.runId === input.runId);
    if (previous && previous.status !== 'failed') {
      throw new Error('ade: run publication is already active or completed');
    }
    if (previous && !samePublicationTarget(previous, input)) {
      throw new Error('ade: failed publication cannot be retargeted');
    }
    const now = Date.now();
    const publication: RunPublication = previous
      ? { ...previous, status: 'publishing', updatedAt: now, error: undefined }
      : {
          ...input,
          id: randomUUID(),
          status: 'publishing',
          createdAt: now,
          updatedAt: now,
        };
    this.store.save({
      runPublications: previous
        ? config.runPublications.map((candidate) => candidate.id === publication.id ? publication : candidate)
        : [...config.runPublications, publication],
      runEvents: [...config.runEvents, this.event(input.runId, 'publication.requested', {
        at: now,
        data: {
          publicationId: publication.id,
          provider: publication.provider,
          headBranch: publication.headBranch,
        },
      })],
    });
    this.emit();
    return { ...publication };
  }

  completePublication(publicationId: string, prNumber: number, prUrl: string): RunPublication {
    const config = this.store.get();
    const current = config.runPublications.find((candidate) => candidate.id === publicationId);
    if (!current) throw new Error(`ade: publication not found "${publicationId}"`);
    if (current.status !== 'publishing') throw new Error('ade: publication is not active');
    const now = Date.now();
    const completed: RunPublication = {
      ...current,
      status: 'draft',
      prNumber,
      prUrl,
      error: undefined,
      updatedAt: now,
    };
    this.store.save({
      runPublications: config.runPublications.map((candidate) =>
        candidate.id === publicationId ? completed : candidate),
      runEvents: [...config.runEvents, this.event(current.runId, 'publication.completed', {
        at: now,
        data: { publicationId, prNumber },
      })],
    });
    this.emit();
    return { ...completed };
  }

  failPublication(publicationId: string, error: string): RunPublication {
    const config = this.store.get();
    const current = config.runPublications.find((candidate) => candidate.id === publicationId);
    if (!current) throw new Error(`ade: publication not found "${publicationId}"`);
    if (current.status === 'draft') throw new Error('ade: completed publication cannot be failed');
    const now = Date.now();
    const failed: RunPublication = {
      ...current,
      status: 'failed',
      error: error.slice(0, 2_000),
      updatedAt: now,
    };
    this.store.save({
      runPublications: config.runPublications.map((candidate) =>
        candidate.id === publicationId ? failed : candidate),
      runEvents: [...config.runEvents, this.event(current.runId, 'publication.failed', {
        at: now,
        data: { publicationId, reason: failed.error?.slice(0, 500) ?? 'unknown' },
      })],
    });
    this.emit();
    return { ...failed };
  }

  /** A process died while performing external I/O; retry must re-prove state. */
  recoverInterruptedPublications(): number {
    const active = this.store.get().runPublications.filter(
      (publication) => publication.status === 'publishing',
    );
    for (const publication of active) {
      this.failPublication(publication.id, 'Publication was interrupted before Draft PR confirmation');
    }
    return active.length;
  }

  deleteRun(runId: string): void {
    const config = this.store.get();
    const run = config.runs.find((candidate) => candidate.id === runId);
    if (run && ((run.mode === 'managed' && run.status === 'running') || config.runWorkspaceLeases.some(
      (lease) => lease.runId === runId && lease.status === 'active',
    ))) {
      throw new Error('ade: cancel the active run before deleting it');
    }
    if (config.runPublications.some((publication) => publication.runId === runId)) {
      throw new Error('ade: a run with an external publication audit cannot be deleted');
    }
    this.store.save({
      runs: config.runs.filter((candidate) => candidate.id !== runId),
      runParticipants: config.runParticipants.filter((participant) => participant.runId !== runId),
      runTasks: config.runTasks.filter((task) => task.runId !== runId),
      runEvents: config.runEvents.filter((event) => event.runId !== runId),
      runArtifacts: config.runArtifacts.filter((artifact) => artifact.runId !== runId),
      runTaskResults: config.runTaskResults.filter((result) => result.runId !== runId),
      runApprovals: config.runApprovals.filter((approval) => approval.runId !== runId),
      runWorkspaceLeases: config.runWorkspaceLeases.filter((lease) => lease.runId !== runId),
      runPublications: config.runPublications.filter((publication) => publication.runId !== runId),
      runMessages: config.runMessages.filter((message) => message.runId !== runId),
    });
    this.emit();
  }

  createTask(input: RunTaskCreateInput): RunTask {
    return this.createTaskRecord({
      ...input,
      title: input.prompt.trim().slice(0, 80),
      phase: 'manual',
      managed: false,
      dependsOn: [],
      attempt: 1,
    });
  }

  createManagedTask(input: ManagedTaskInput): RunTask {
    return this.createTaskRecord({
      ...input,
      managed: true,
      dependsOn: input.dependsOn ?? [],
      attempt: input.attempt ?? 1,
    });
  }

  /** Mark work left active by a previous main-process crash as failed. */
  recoverInterruptedTasks(reason = 'ADE restarted before task completion'): number {
    const activeTasks = this.snapshot().tasks.filter(
      (task) => task.status === 'queued' || task.status === 'running',
    );
    const managedRunIds = new Set(activeTasks.filter((task) => task.managed).map((task) => task.runId));
    for (const task of activeTasks) this.transitionTask(task.id, 'failed', { error: reason });
    for (const runId of managedRunIds) this.setManagedRunPhase(runId, 'failed', reason);

    const config = this.store.get();
    const orphanedRunIds = new Set(config.runWorkspaceLeases
      .filter((lease) => lease.status === 'active')
      .map((lease) => lease.runId));
    for (const runId of orphanedRunIds) {
      const current = this.store.get();
      const run = current.runs.find((candidate) => candidate.id === runId);
      const resumableApproval = run?.mode === 'managed' && run.phase === 'approval' &&
        current.runApprovals.some((approval) => approval.runId === runId && approval.status === 'pending');
      if (resumableApproval) continue;
      this.releaseWorkspaceLeases(runId);
      if (run?.status === 'running') this.setManagedRunPhase(runId, 'failed', reason);
    }
    return activeTasks.length;
  }

  failTask(taskId: string, error: string): void {
    this.transitionTask(taskId, 'failed', { error: error.slice(0, 1_000) });
  }

  cancelQueuedTasks(runId: string, reason = 'Run cancelled'): number {
    // One atomic save for the whole batch: a crash can never leave half the
    // queue cancelled with the rest still schedulable.
    const config = this.store.get();
    const derived = deriveTasks(config.runTasks, config.runEvents);
    const queued = derived.filter((task) => task.runId === runId && task.status === 'queued');
    if (queued.length === 0) return 0;
    const queuedIds = new Set(queued.map((task) => task.id));
    const now = Date.now();
    const error = reason.slice(0, 1_000);
    const events = [
      ...config.runEvents,
      ...queued.map((task) => this.event(runId, 'task.cancelled', {
        taskId: task.id,
        participantId: task.participantId,
        at: now,
        data: { error },
      })),
    ];
    const tasks = config.runTasks.map((task) => queuedIds.has(task.id)
      ? { ...task, status: 'cancelled' as const, updatedAt: now, endedAt: now, error }
      : task);
    const run = config.runs.find((candidate) => candidate.id === runId);
    this.store.save({
      runTasks: tasks,
      runEvents: events,
      runs: run?.mode === 'managed'
        ? touchRun(config.runs, runId, now)
        : updateRunStatus(config.runs, runId, tasks, events, now),
    });
    this.emit();
    return queued.length;
  }

  /**
   * Persist the Main-built run manifest and its trusted expected hash in the
   * same config transaction. Any legacy/untrusted artifacts at the reserved
   * path are replaced rather than adopted.
   */
  persistRunContextManifest(input: { runId: string; content: string; hash: string }): RunArtifact {
    const config = this.store.get();
    const run = config.runs.find((candidate) => candidate.id === input.runId);
    if (!run) throw new Error(`ade: run not found "${input.runId}"`);
    if (!/^[0-9a-f]{64}$/.test(input.hash)) {
      throw new Error('ade: run context manifest hash must be a SHA-256 digest');
    }
    if (sha256(input.content) !== input.hash) {
      throw new Error('ade: run context manifest content does not match its SHA-256 digest');
    }
    if (input.content.length > MAX_ARTIFACT_CONTENT_CHARS) {
      throw new Error(`ade: artifact content exceeds ${MAX_ARTIFACT_CONTENT_CHARS} characters`);
    }
    const artifact: RunArtifact = {
      id: randomUUID(),
      runId: input.runId,
      kind: 'file',
      path: RUN_CONTEXT_MANIFEST_PATH,
      content: input.content,
      repositoryId: run.repositoryId,
      createdAt: Date.now(),
    };
    const event = this.event(input.runId, 'artifact.created', {
      data: {
        artifactId: artifact.id,
        kind: artifact.kind,
        repositoryId: artifact.repositoryId ?? null,
        workspaceBindingId: null,
      },
    });
    this.store.save({
      runs: config.runs.map((candidate) => candidate.id === input.runId
        ? { ...candidate, contextManifestHash: input.hash }
        : candidate),
      runArtifacts: [
        ...config.runArtifacts.filter((candidate) => !(
          candidate.runId === input.runId && candidate.path === RUN_CONTEXT_MANIFEST_PATH
        )),
        artifact,
      ],
      runEvents: [...config.runEvents, event],
    });
    this.emit();
    return { ...artifact };
  }

  createArtifact(input: Omit<RunArtifact, 'id' | 'createdAt'>): RunArtifact {
    const config = this.store.get();
    const run = config.runs.find((candidate) => candidate.id === input.runId);
    if (!run) {
      throw new Error(`ade: run not found "${input.runId}"`);
    }
    const task = input.taskId
      ? config.runTasks.find((candidate) => candidate.id === input.taskId && candidate.runId === input.runId)
      : undefined;
    if (input.taskId && !task) {
      throw new Error(`ade: run task not found "${input.taskId}"`);
    }
    if (!ARTIFACT_KINDS.has(input.kind)) {
      throw new Error(`ade: invalid artifact kind "${String(input.kind)}"`);
    }
    const path = input.path?.trim() || undefined;
    if (path === RUN_CONTEXT_MANIFEST_PATH) {
      throw new Error(`ade: artifact path "${RUN_CONTEXT_MANIFEST_PATH}" is reserved for Main`);
    }
    if (path && path.length > MAX_ARTIFACT_PATH_CHARS) {
      throw new Error(`ade: artifact path exceeds ${MAX_ARTIFACT_PATH_CHARS} characters`);
    }
    if (input.content && input.content.length > MAX_ARTIFACT_CONTENT_CHARS) {
      throw new Error(`ade: artifact content exceeds ${MAX_ARTIFACT_CONTENT_CHARS} characters`);
    }
    const artifact: RunArtifact = {
      ...input,
      path,
      repositoryId: task?.repositoryId !== undefined ? task.repositoryId : run.repositoryId,
      workspaceBindingId: task?.workspaceBindingId,
      workspaceDir: task?.workspaceDir,
      id: randomUUID(),
      createdAt: Date.now(),
    };
    const event = this.event(input.runId, 'artifact.created', {
      taskId: input.taskId,
      data: {
        artifactId: artifact.id,
        kind: artifact.kind,
        repositoryId: artifact.repositoryId ?? null,
        workspaceBindingId: artifact.workspaceBindingId ?? null,
      },
    });
    this.store.save({
      runArtifacts: [...config.runArtifacts, artifact],
      runEvents: [...config.runEvents, event],
    });
    this.emit();
    return { ...artifact };
  }

  setManagedRunPhase(runId: string, phase: RunPhase, detail?: string): Run {
    const config = this.store.get();
    const transition = this.buildPhaseTransition(config, runId, phase, detail);
    this.store.save({
      runs: transition.runs,
      runApprovals: transition.runApprovals,
      runEvents: [...config.runEvents, ...transition.events],
    });
    this.emit();
    return { ...transition.run, budget: { ...transition.run.budget } };
  }

  /**
   * Validated phase transition as pure record updates, so compound logical
   * transitions (phase + approval/task/lease mutation) can commit in ONE
   * atomic save instead of leaving a crash window between writes (Gap 11).
   */
  private buildPhaseTransition(
    config: AdeConfig,
    runId: string,
    phase: RunPhase,
    detail?: string,
  ): { run: Run; runs: Run[]; runApprovals: RunApproval[]; events: RunEvent[] } {
    const existing = config.runs.find((run) => run.id === runId);
    if (!existing) throw new Error(`ade: run not found "${runId}"`);
    const terminal = phase === 'completed' || phase === 'failed' || phase === 'cancelled';
    if ((existing.status === 'completed' || existing.status === 'failed' || existing.status === 'cancelled') &&
        phase !== existing.phase) {
      throw new Error(`ade: terminal run cannot transition from ${existing.phase} to ${phase}`);
    }
    const allowedNext: Partial<Record<RunPhase, RunPhase[]>> = {
      draft: ['planning'],
      planning: ['working'],
      working: ['approval'],
      approval: ['integrating'],
      integrating: ['verifying'],
      verifying: ['completed'],
    };
    if (!terminal && phase !== existing.phase && !allowedNext[existing.phase]?.includes(phase)) {
      throw new Error(`ade: invalid managed run phase transition ${existing.phase} -> ${phase}`);
    }
    const now = Date.now();
    const status = statusForPhase(phase);
    const type: RunEvent['type'] = phase === 'completed'
      ? 'run.completed'
      : phase === 'failed'
        ? 'run.failed'
        : phase === 'cancelled'
          ? 'run.cancelled'
          : existing.mode !== 'managed' && phase === 'planning'
            ? 'run.started'
            : 'run.phase_changed';
    const run: Run = {
      ...existing,
      mode: 'managed',
      phase,
      status,
      updatedAt: now,
    };
    const event = this.event(runId, type, {
      at: now,
      data: { phase, ...(detail ? { detail: detail.slice(0, 1_000) } : {}) },
    });
    const closesApprovals = status === 'completed' || status === 'failed' || status === 'cancelled';
    const pendingApprovals = closesApprovals
      ? config.runApprovals.filter((approval) => approval.runId === runId && approval.status === 'pending')
      : [];
    return {
      run,
      runs: config.runs.map((candidate) => candidate.id === runId ? run : candidate),
      runApprovals: pendingApprovals.length
        ? config.runApprovals.map((approval) => pendingApprovals.some((item) => item.id === approval.id)
          ? { ...approval, status: 'rejected', resolvedAt: now }
          : approval)
        : config.runApprovals,
      events: [
        event,
        ...pendingApprovals.map((approval, index) => this.event(runId, 'approval.resolved', {
          at: now + index + 1,
          data: { approvalId: approval.id, decision: 'reject', automatic: true },
        })),
      ],
    };
  }

  /** draft -> planning plus the planning task, committed as one save. */
  beginPlanningPhase(input: ManagedTaskInput): { run: Run; task: RunTask } {
    const config = this.store.get();
    const transition = this.buildPhaseTransition(config, input.runId, 'planning');
    const record = this.buildTaskRecord(config, {
      ...input,
      managed: true,
      dependsOn: input.dependsOn ?? [],
      attempt: input.attempt ?? 1,
    }, transition.run);
    this.store.save({
      runs: transition.runs,
      runApprovals: transition.runApprovals,
      runTasks: [...config.runTasks, record.task],
      runEvents: [...config.runEvents, ...transition.events, record.event],
    });
    this.emit();
    return {
      run: { ...transition.run, budget: { ...transition.run.budget } },
      task: { ...record.task, dependsOn: [...record.task.dependsOn] },
    };
  }

  /** planning -> working plus every work task, committed as one save. */
  beginWorkingPhase(runId: string, inputs: ManagedTaskInput[]): { run: Run; tasks: RunTask[] } {
    if (inputs.length === 0) throw new Error('ade: working phase needs at least one task');
    if (inputs.some((input) => input.runId !== runId)) {
      throw new Error('ade: working-phase tasks must belong to the transitioning run');
    }
    const config = this.store.get();
    const transition = this.buildPhaseTransition(config, runId, 'working');
    const records = inputs.map((input) => this.buildTaskRecord(config, {
      ...input,
      managed: true,
      dependsOn: input.dependsOn ?? [],
      attempt: input.attempt ?? 1,
    }, transition.run));
    this.store.save({
      runs: transition.runs,
      runApprovals: transition.runApprovals,
      runTasks: [...config.runTasks, ...records.map((record) => record.task)],
      runEvents: [...config.runEvents, ...transition.events, ...records.map((record) => record.event)],
    });
    this.emit();
    return {
      run: { ...transition.run, budget: { ...transition.run.budget } },
      tasks: records.map((record) => ({ ...record.task, dependsOn: [...record.task.dependsOn] })),
    };
  }

  /** working -> approval plus the pending integration approval, one save. */
  beginApprovalPhase(runId: string, reason: string): RunApproval {
    const config = this.store.get();
    const request = this.buildApprovalRequest(config, runId, reason);
    const transition = this.buildPhaseTransition(config, runId, 'approval');
    this.store.save({
      runs: transition.runs,
      runApprovals: [...transition.runApprovals, request.approval],
      runEvents: [...config.runEvents, request.event, ...transition.events],
    });
    this.emit();
    return { ...request.approval };
  }

  /** verifying -> completed plus the lease release, committed as one save. */
  completeRun(
    runId: string,
    detail?: string,
    verification?: { headSha: string; taskId: string; verifiedAt?: number },
  ): Run {
    const config = this.store.get();
    if (verification) {
      const task = config.runTasks.find((candidate) =>
        candidate.id === verification.taskId && candidate.runId === runId);
      const results = config.runTaskResults.filter((candidate) =>
        candidate.taskId === verification.taskId && candidate.runId === runId);
      const result = results[0];
      if (!GIT_OBJECT_ID.test(verification.headSha)
          || !task || task.phase !== 'verify' || task.status !== 'completed'
          || task.expectedHeadSha !== verification.headSha
          || results.length !== 1 || result?.outcome !== 'succeeded'
          || result.tests.length === 0 || result.tests.some((test) => test.status === 'failed')) {
        throw new Error('ade: run completion requires one exact successful verification attestation');
      }
    }
    const transition = this.buildPhaseTransition(config, runId, 'completed', detail);
    const now = Date.now();
    const active = config.runWorkspaceLeases.filter(
      (lease) => lease.runId === runId && lease.status === 'active',
    );
    const activeIds = new Set(active.map((lease) => lease.id));
    const verifiedAt = verification?.verifiedAt ?? now;
    const completedRun: Run = verification
      ? {
          ...transition.run,
          verifiedHeadSha: verification.headSha,
          verificationTaskId: verification.taskId,
          verifiedAt,
        }
      : transition.run;
    this.store.save({
      runs: transition.runs.map((run) => run.id === runId ? completedRun : run),
      runApprovals: transition.runApprovals,
      runWorkspaceLeases: active.length
        ? config.runWorkspaceLeases.map((lease) => activeIds.has(lease.id)
          ? { ...lease, status: 'released' as const, releasedAt: now }
          : lease)
        : config.runWorkspaceLeases,
      runEvents: [
        ...config.runEvents,
        ...transition.events,
        ...active.map((lease, index) => this.event(runId, 'workspace.released', {
          participantId: lease.participantId,
          at: now + index,
          data: { leaseId: lease.id },
        })),
      ],
    });
    this.emit();
    return { ...completedRun, budget: { ...completedRun.budget } };
  }

  /**
   * Pause or resume one team's queued managed work. Persisted on the run and
   * journaled (team.paused / team.resumed) in the same save; repeating the
   * current state is a no-op so command retries stay silent.
   */
  setTeamPaused(runId: string, teamId: string, paused: boolean): Run {
    const config = this.store.get();
    const run = config.runs.find((candidate) => candidate.id === runId);
    if (!run) throw new Error(`ade: run not found "${runId}"`);
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      throw new Error('ade: a terminal run has no pausable teams');
    }
    if (!config.runParticipants.some(
      (participant) => participant.runId === runId && participant.teamId === teamId,
    )) {
      throw new Error(`ade: run team not found "${teamId}"`);
    }
    const current = new Set(run.pausedTeamIds ?? []);
    if (current.has(teamId) === paused) return { ...run, budget: { ...run.budget } };
    if (paused) current.add(teamId);
    else current.delete(teamId);
    const now = Date.now();
    const updated: Run = { ...run, pausedTeamIds: [...current], updatedAt: now };
    this.store.save({
      runs: config.runs.map((candidate) => candidate.id === runId ? updated : candidate),
      runEvents: [...config.runEvents, this.event(runId, paused ? 'team.paused' : 'team.resumed', {
        at: now,
        data: { teamId },
      })],
    });
    this.emit();
    return { ...updated, budget: { ...updated.budget } };
  }

  acquireWorkspaceLeases(
    runId: string,
    leases: Array<Omit<RunWorkspaceLease, 'id' | 'runId' | 'status' | 'acquiredAt'>>,
  ): RunWorkspaceLease[] {
    const config = this.store.get();
    if (!config.runs.some((run) => run.id === runId)) throw new Error(`ade: run not found "${runId}"`);
    const paths = new Set<string>();
    for (const input of leases) {
      const participant = config.runParticipants.find(
        (candidate) => candidate.id === input.participantId && candidate.runId === runId,
      );
      if (!participant || participant.agentId !== input.agentId) {
        throw new Error(`ade: workspace lease participant is invalid "${input.participantId}"`);
      }
      const key = hostPathKey(input.workspaceDir);
      if (paths.has(key)) throw new Error(`ade: workspace appears twice in run: ${input.workspaceDir}`);
      paths.add(key);
      const conflict = config.runWorkspaceLeases.find(
        (lease) => lease.status === 'active' && hostPathKey(lease.workspaceDir) === key,
      );
      if (conflict) throw new Error(`ade: workspace is already owned by active run ${conflict.runId}`);
    }
    const now = Date.now();
    const created = leases.map((lease, index): RunWorkspaceLease => ({
      ...lease,
      id: randomUUID(),
      runId,
      status: 'active',
      acquiredAt: now + index,
    }));
    this.store.save({
      runWorkspaceLeases: [...config.runWorkspaceLeases, ...created],
      runEvents: [
        ...config.runEvents,
        ...created.map((lease) => this.event(runId, 'workspace.acquired', {
          participantId: lease.participantId,
          at: lease.acquiredAt,
          data: {
            leaseId: lease.id,
            workspaceDir: lease.workspaceDir,
            branch: lease.branch,
            repositoryId: lease.repositoryId ?? null,
            workspaceBindingId: lease.workspaceBindingId ?? null,
          },
        })),
      ],
    });
    this.emit();
    return created.map((lease) => ({ ...lease }));
  }

  releaseWorkspaceLeases(runId: string): number {
    const config = this.store.get();
    const active = config.runWorkspaceLeases.filter(
      (lease) => lease.runId === runId && lease.status === 'active',
    );
    if (!active.length) return 0;
    const ids = new Set(active.map((lease) => lease.id));
    const now = Date.now();
    this.store.save({
      runWorkspaceLeases: config.runWorkspaceLeases.map((lease) => ids.has(lease.id)
        ? { ...lease, status: 'released', releasedAt: now }
        : lease),
      runEvents: [
        ...config.runEvents,
        ...active.map((lease, index) => this.event(runId, 'workspace.released', {
          participantId: lease.participantId,
          at: now + index,
          data: { leaseId: lease.id },
        })),
      ],
    });
    this.emit();
    return active.length;
  }

  recordResult(input: {
    runId: string;
    taskId: string;
    participantId: string;
    adapterId: string;
    resultPath: string;
    result: StructuredTaskResult;
  }): RunTaskResult {
    const config = this.store.get();
    const task = config.runTasks.find(
      (candidate) => candidate.id === input.taskId && candidate.runId === input.runId,
    );
    if (!task || task.participantId !== input.participantId) {
      throw new Error(`ade: run task not found "${input.taskId}"`);
    }
    if (config.runTaskResults.some((result) => result.taskId === input.taskId)) {
      throw new Error(`ade: task already has a structured result "${input.taskId}"`);
    }
    const result: RunTaskResult = {
      ...cloneStructuredResult(input.result),
      id: randomUUID(),
      runId: input.runId,
      taskId: input.taskId,
      participantId: input.participantId,
      adapterId: input.adapterId,
      resultPath: input.resultPath,
      createdAt: Date.now(),
    };
    const artifact: RunArtifact = {
      id: randomUUID(),
      runId: input.runId,
      taskId: input.taskId,
      kind: 'result',
      path: input.resultPath,
      content: result.summary.slice(0, MAX_ARTIFACT_CONTENT_CHARS),
      repositoryId: task.repositoryId,
      workspaceBindingId: task.workspaceBindingId,
      workspaceDir: task.workspaceDir,
      createdAt: result.createdAt,
    };
    this.store.save({
      runTaskResults: [...config.runTaskResults, result],
      runArtifacts: [...config.runArtifacts, artifact],
      runEvents: [
        ...config.runEvents,
        this.event(input.runId, 'task.result_recorded', {
          taskId: input.taskId,
          participantId: input.participantId,
          at: result.createdAt,
          data: { resultId: result.id, adapterId: result.adapterId, outcome: result.outcome },
        }),
        this.event(input.runId, 'artifact.created', {
          taskId: input.taskId,
          at: result.createdAt,
          data: {
            artifactId: artifact.id,
            kind: artifact.kind,
            repositoryId: artifact.repositoryId ?? null,
            workspaceBindingId: artifact.workspaceBindingId ?? null,
          },
        }),
      ],
    });
    this.emit();
    return cloneResult(result);
  }

  requestIntegrationApproval(runId: string, reason: string): RunApproval {
    const config = this.store.get();
    const request = this.buildApprovalRequest(config, runId, reason);
    this.store.save({
      runApprovals: [...config.runApprovals, request.approval],
      runEvents: [...config.runEvents, request.event],
    });
    this.emit();
    return { ...request.approval };
  }

  private buildApprovalRequest(
    config: AdeConfig,
    runId: string,
    reason: string,
  ): { approval: RunApproval; event: RunEvent } {
    const run = config.runs.find((candidate) => candidate.id === runId);
    if (!run) throw new Error(`ade: run not found "${runId}"`);
    if (config.runApprovals.some((approval) => approval.runId === runId && approval.status === 'pending')) {
      throw new Error('ade: run already has a pending approval');
    }
    const requested = config.runApprovals.filter((approval) => approval.runId === runId).length;
    if (requested >= run.budget.maxApprovals) {
      this.recordBudgetExhausted(runId, 'approval', requested, run.budget.maxApprovals);
      throw new Error(`ade: approval budget exhausted (${requested}/${run.budget.maxApprovals})`);
    }
    const approval: RunApproval = {
      id: randomUUID(),
      runId,
      type: 'integration',
      status: 'pending',
      reason: reason.trim().slice(0, 4_000),
      requestedAt: Date.now(),
    };
    return {
      approval,
      event: this.event(runId, 'approval.requested', {
        at: approval.requestedAt,
        data: { approvalId: approval.id, type: approval.type },
      }),
    };
  }

  resolveApproval(approvalId: string, decision: 'approve' | 'reject'): RunApproval {
    const config = this.store.get();
    const approval = config.runApprovals.find((candidate) => candidate.id === approvalId);
    if (!approval) throw new Error(`ade: approval not found "${approvalId}"`);
    if (approval.status !== 'pending') throw new Error('ade: approval is already resolved');
    const resolved: RunApproval = {
      ...approval,
      status: decision === 'approve' ? 'approved' : 'rejected',
      resolvedAt: Date.now(),
    };
    this.store.save({
      runApprovals: config.runApprovals.map((candidate) => candidate.id === approvalId ? resolved : candidate),
      runEvents: [...config.runEvents, this.event(approval.runId, 'approval.resolved', {
        at: resolved.resolvedAt,
        data: { approvalId, decision },
      })],
    });
    this.emit();
    return { ...resolved };
  }

  sendMessage(input: Omit<RunMessage, 'id' | 'createdAt' | 'seq'>): RunMessage {
    const config = this.store.get();
    if (!config.runParticipants.some(
      (participant) => participant.id === input.toParticipantId && participant.runId === input.runId,
    )) throw new Error(`ade: message recipient not found "${input.toParticipantId}"`);
    if (input.fromParticipantId && !config.runParticipants.some(
      (participant) => participant.id === input.fromParticipantId && participant.runId === input.runId,
    )) throw new Error(`ade: message sender not found "${input.fromParticipantId}"`);
    if (input.taskId && !config.runTasks.some(
      (task) => task.id === input.taskId && task.runId === input.runId,
    )) throw new Error(`ade: message task not found "${input.taskId}"`);
    const text = input.text.trim();
    if (!text) throw new Error('ade: mailbox message is empty');
    if (text.length > MAX_MESSAGE_CHARS) throw new Error(`ade: mailbox message exceeds ${MAX_MESSAGE_CHARS} characters`);
    const message: RunMessage = {
      ...input,
      text,
      id: randomUUID(),
      createdAt: Date.now(),
      seq: this.nextSeq(),
    };
    this.store.save({
      runMessages: [...config.runMessages, message],
      runEvents: [...config.runEvents, this.event(input.runId, 'message.sent', {
        taskId: input.taskId,
        participantId: input.toParticipantId,
        at: message.createdAt,
        data: { messageId: message.id, kind: message.kind },
      })],
    });
    this.emit();
    return { ...message };
  }

  /**
   * Persist the dependency-aware base ADE prepared for one work task, in the
   * same save as its journal event. The owned delta of that task is validated
   * from this SHA instead of the run base; setting it twice with a different
   * value is a contract violation and fails closed.
   */
  setTaskPreparedBase(runId: string, taskId: string, preparedBaseSha: string): RunTask {
    const config = this.store.get();
    const task = config.runTasks.find((candidate) => candidate.id === taskId && candidate.runId === runId);
    if (!task) throw new Error(`ade: run task not found "${taskId}"`);
    if (!GIT_OBJECT_ID.test(preparedBaseSha)) {
      throw new Error('ade: prepared dependency base must be a full Git object id');
    }
    if (task.preparedBaseSha && task.preparedBaseSha !== preparedBaseSha) {
      throw new Error('ade: a task dependency base cannot be re-prepared to a different commit');
    }
    const now = Date.now();
    const updated: RunTask = { ...task, preparedBaseSha, updatedAt: now };
    this.store.save({
      runTasks: config.runTasks.map((candidate) => candidate.id === taskId ? updated : candidate),
      runEvents: [...config.runEvents, this.event(runId, 'workspace.prepared', {
        taskId,
        participantId: task.participantId,
        at: now,
        data: { preparedBaseSha },
      })],
    });
    this.emit();
    return { ...updated, dependsOn: [...updated.dependsOn] };
  }

  markIntegrationApplied(runId: string, commitCount: number): void {
    const config = this.store.get();
    this.store.save({
      runEvents: [...config.runEvents, this.event(runId, 'integration.applied', {
        data: { commitCount },
      })],
    });
    this.emit();
  }

  recordBudgetExhausted(runId: string, kind: string, used: number, limit: number): void {
    const config = this.store.get();
    this.store.save({
      runEvents: [...config.runEvents, this.event(runId, 'budget.exhausted', {
        data: { kind, used, limit },
      })],
    });
    this.emit();
  }

  onTaskStarted(taskId: string, session: SessionMeta): void {
    this.transitionTask(taskId, 'running', {
      sessionId: session.id,
      repositoryId: session.scopeSource === 'plain-home' ? null : session.repositoryId,
      workspaceBindingId: session.workspaceBindingId,
      workspaceDir: session.workspaceDir,
    });
  }

  onTaskLaunchFailed(taskId: string, cancelled: boolean, error?: string): void {
    this.transitionTask(taskId, cancelled ? 'cancelled' : 'failed', { error });
  }

  onTaskFinished(
    taskId: string,
    status: 'completed' | 'failed' | 'cancelled',
    exitCode: number,
    error?: string,
  ): void {
    this.transitionTask(taskId, status, { exitCode, error });
  }

  private createTaskRecord(input: RunTaskCreateInput & {
    title: string;
    phase: RunTaskPhase;
    managed: boolean;
    dependsOn: string[];
    attempt: number;
    expectedHeadSha?: string;
  }): RunTask {
    const config = this.store.get();
    const { task, event } = this.buildTaskRecord(config, input);
    const run = config.runs.find((candidate) => candidate.id === input.runId)!;
    const tasks = [...config.runTasks, task];
    const events = [...config.runEvents, event];
    this.store.save({
      runTasks: tasks,
      runEvents: events,
      runs: run.mode === 'managed'
        ? touchRun(config.runs, run.id, task.createdAt)
        : updateRunStatus(config.runs, run.id, tasks, events, task.createdAt),
    });
    this.emit();
    return { ...task, dependsOn: [...task.dependsOn] };
  }

  /**
   * Validated task construction without persistence, so phase transitions can
   * commit run + task records in one save. `runOverride` validates against
   * the post-transition run when both change together.
   */
  private buildTaskRecord(
    config: AdeConfig,
    input: RunTaskCreateInput & {
      title: string;
      phase: RunTaskPhase;
      managed: boolean;
      dependsOn: string[];
      attempt: number;
      expectedHeadSha?: string;
    },
    runOverride?: Run,
  ): { task: RunTask; event: RunEvent } {
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error('ade: task prompt is required');
    if (prompt.length > MAX_TASK_PROMPT_CHARS) {
      throw new Error(`ade: task exceeds ${MAX_TASK_PROMPT_CHARS} characters`);
    }
    const title = input.title.trim();
    if (!title) throw new Error('ade: task title is required');
    if (title.length > 160) throw new Error('ade: task title exceeds 160 characters');
    const run = runOverride ?? config.runs.find((candidate) => candidate.id === input.runId);
    const participant = config.runParticipants.find(
      (candidate) => candidate.id === input.participantId && candidate.runId === input.runId,
    );
    if (!run || run.id !== input.runId) throw new Error(`ade: run not found "${input.runId}"`);
    if (!participant) throw new Error(`ade: run participant not found "${input.participantId}"`);
    if (input.managed && run.mode !== 'managed') throw new Error('ade: managed run has not started');
    if (!input.managed && run.mode === 'managed' && run.status === 'running') {
      throw new Error('ade: direct tasks are disabled while orchestration is active');
    }
    const dependencySet = new Set(input.dependsOn);
    if (dependencySet.size !== input.dependsOn.length || dependencySet.has(participant.id)) {
      throw new Error('ade: task dependencies must be unique and cannot reference its own participant');
    }

    const now = Date.now();
    const lease = config.runWorkspaceLeases.find(
      (candidate) => candidate.runId === run.id &&
        candidate.participantId === participant.id && candidate.status === 'active',
    );
    const task: RunTask = {
      id: randomUUID(),
      runId: run.id,
      participantId: participant.id,
      prompt,
      title,
      phase: input.phase,
      managed: input.managed,
      dependsOn: [...input.dependsOn],
      attempt: input.attempt,
      status: 'queued',
      repositoryId: lease?.repositoryId ?? run.repositoryId,
      workspaceBindingId: lease?.workspaceBindingId,
      workspaceDir: lease?.workspaceDir,
      expectedHeadSha: input.expectedHeadSha,
      createdAt: now,
      updatedAt: now,
    };
    const event = this.event(run.id, 'task.queued', {
      taskId: task.id,
      participantId: participant.id,
      at: now,
      data: {
        phase: task.phase,
        managed: task.managed,
        repositoryId: task.repositoryId ?? null,
        workspaceBindingId: task.workspaceBindingId ?? null,
      },
    });
    return { task, event };
  }

  private transitionTask(
    taskId: string,
    status: Exclude<RunTaskStatus, 'queued'>,
    detail: {
      sessionId?: string;
      repositoryId?: string | null;
      workspaceBindingId?: string;
      workspaceDir?: string;
      exitCode?: number;
      error?: string;
    } = {},
  ): void {
    const config = this.store.get();
    const task = config.runTasks.find((candidate) => candidate.id === taskId);
    if (!task || isTerminal(deriveTaskStatus(task, config.runEvents))) return;

    const now = Date.now();
    const type = `task.${status === 'running' ? 'started' : status}` as RunEvent['type'];
    const event = this.event(task.runId, type, {
      taskId,
      participantId: task.participantId,
      at: now,
      data: {
        ...(detail.sessionId ? { sessionId: detail.sessionId } : {}),
        ...(detail.repositoryId !== undefined ? { repositoryId: detail.repositoryId } : {}),
        ...(detail.workspaceBindingId ? { workspaceBindingId: detail.workspaceBindingId } : {}),
        ...(detail.workspaceDir ? { workspaceDir: detail.workspaceDir } : {}),
        ...(detail.exitCode !== undefined ? { exitCode: detail.exitCode } : {}),
        ...(detail.error ? { error: detail.error.slice(0, 1_000) } : {}),
      },
    });
    const tasks = config.runTasks.map((candidate) => candidate.id === taskId
      ? {
          ...candidate,
          status,
          sessionId: detail.sessionId ?? candidate.sessionId,
          repositoryId: detail.repositoryId !== undefined
            ? detail.repositoryId
            : candidate.repositoryId,
          workspaceBindingId: detail.workspaceBindingId ?? candidate.workspaceBindingId,
          workspaceDir: detail.workspaceDir ?? candidate.workspaceDir,
          updatedAt: now,
          startedAt: status === 'running' ? now : candidate.startedAt,
          endedAt: isTerminal(status) ? now : candidate.endedAt,
          exitCode: detail.exitCode ?? candidate.exitCode,
          error: detail.error ?? candidate.error,
        }
      : candidate);
    const events = [...config.runEvents, event];
    const run = config.runs.find((candidate) => candidate.id === task.runId);
    this.store.save({
      runTasks: tasks,
      runEvents: events,
      runs: run?.mode === 'managed'
        ? touchRun(config.runs, task.runId, now)
        : updateRunStatus(config.runs, task.runId, tasks, events, now),
    });
    this.emit();
  }

  private event(
    runId: string,
    type: RunEvent['type'],
    opts: {
      taskId?: string;
      participantId?: string;
      data?: RunEvent['data'];
      at?: number;
    } = {},
  ): RunEvent {
    return {
      id: randomUUID(),
      runId,
      type,
      createdAt: opts.at ?? Date.now(),
      taskId: opts.taskId,
      participantId: opts.participantId,
      data: opts.data,
      seq: this.nextSeq(),
    };
  }

  private emit(): void {
    this.onChange(this.snapshot());
  }
}

export function deriveTaskStatus(task: RunTask, events: RunEvent[]): RunTaskStatus {
  let status = task.status;
  for (const event of events) {
    if (event.taskId !== task.id) continue;
    status = EVENT_STATUS[event.type] ?? status;
  }
  return status;
}

function deriveTasks(tasks: RunTask[], events: RunEvent[]): RunTask[] {
  const statuses = new Map<string, RunTaskStatus>();
  for (const event of events) {
    if (!event.taskId) continue;
    const status = EVENT_STATUS[event.type];
    if (status) statuses.set(event.taskId, status);
  }
  return tasks.map((task) => ({ ...task, status: statuses.get(task.id) ?? task.status }));
}

export function deriveRunStatus(runId: string, tasks: RunTask[]): RunStatus {
  const statuses = tasks.filter((task) => task.runId === runId).map((task) => task.status);
  if (statuses.length === 0) return 'draft';
  if (statuses.some((status) => status === 'queued' || status === 'running')) return 'running';
  if (statuses.some((status) => status === 'failed')) return 'failed';
  if (statuses.every((status) => status === 'cancelled')) return 'cancelled';
  return 'completed';
}

function updateRunStatus(
  runs: Run[],
  runId: string,
  tasks: RunTask[],
  events: RunEvent[],
  now: number,
): Run[] {
  const derivedTasks = deriveTasks(tasks, events);
  return runs.map((run) => run.id === runId
    ? {
        ...run,
        status: deriveRunStatus(runId, derivedTasks),
        phase: phaseForManualStatus(deriveRunStatus(runId, derivedTasks)),
        updatedAt: now,
      }
    : run);
}

function touchRun(runs: Run[], runId: string, now: number): Run[] {
  return runs.map((run) => run.id === runId ? { ...run, updatedAt: now } : run);
}

function statusForPhase(phase: RunPhase): RunStatus {
  if (phase === 'draft') return 'draft';
  if (phase === 'completed' || phase === 'failed' || phase === 'cancelled') return phase;
  return 'running';
}

function phaseForManualStatus(status: RunStatus): RunPhase {
  return status === 'running' ? 'working' : status;
}

function normalizeBudget(input: Partial<Run['budget']> | undefined): Run['budget'] {
  const budget = { ...DEFAULT_RUN_BUDGET };
  if (input) {
    for (const [key, value] of Object.entries(input) as Array<
      [keyof Run['budget'], Run['budget'][keyof Run['budget']]]
    >) {
      if (value !== undefined) (budget as Record<keyof Run['budget'], number | null>)[key] = value;
    }
  }
  if (!Number.isInteger(budget.maxConcurrentTasks) || budget.maxConcurrentTasks < 1 || budget.maxConcurrentTasks > 4) {
    throw new Error('ade: maxConcurrentTasks must be an integer from 1 to 4');
  }
  if (!Number.isInteger(budget.maxApprovals) || budget.maxApprovals < 0 || budget.maxApprovals > 20) {
    throw new Error('ade: maxApprovals must be an integer from 0 to 20');
  }
  for (const [name, value] of [
    ['maxInputTokens', budget.maxInputTokens],
    ['maxOutputTokens', budget.maxOutputTokens],
  ] as const) {
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > 2_000_000_000)) {
      throw new Error(`ade: ${name} must be null or a positive integer`);
    }
  }
  if (budget.maxCostUsd !== null && (
    !Number.isFinite(budget.maxCostUsd) || budget.maxCostUsd <= 0 || budget.maxCostUsd > 1_000_000
  )) throw new Error('ade: maxCostUsd must be null or a positive number');
  return budget;
}

function usageByRun(config: AdeConfig): Record<string, RunUsage> {
  const usage: Record<string, RunUsage> = {};
  for (const run of config.runs) {
    usage[run.id] = {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      approvals: config.runApprovals.filter((approval) => approval.runId === run.id).length,
      unreportedCostTasks: 0,
    };
  }
  for (const result of config.runTaskResults) {
    const item = usage[result.runId];
    if (!item) continue;
    item.inputTokens += result.usage.inputTokens ?? 0;
    item.outputTokens += result.usage.outputTokens ?? 0;
    if (result.usage.costUsd === null) item.unreportedCostTasks += 1;
    else item.costUsd += result.usage.costUsd;
  }
  return usage;
}

function cloneStructuredResult(result: StructuredTaskResult): StructuredTaskResult {
  return {
    ...result,
    assignments: result.assignments.map((assignment) => ({
      ...assignment,
      acceptanceCriteria: [...assignment.acceptanceCriteria],
      dependsOn: [...assignment.dependsOn],
    })),
    filesChanged: [...result.filesChanged],
    tests: result.tests.map((test) => ({ ...test })),
    risks: [...result.risks],
    usage: { ...result.usage },
  };
}

function cloneResult(result: RunTaskResult): RunTaskResult {
  return { ...cloneStructuredResult(result), id: result.id, runId: result.runId, taskId: result.taskId,
    participantId: result.participantId, adapterId: result.adapterId, resultPath: result.resultPath,
    createdAt: result.createdAt };
}

function samePublicationTarget(
  existing: RunPublication,
  input: Omit<RunPublication, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'prNumber' | 'prUrl' | 'error'>,
): boolean {
  return existing.runId === input.runId
    && existing.repositoryId === input.repositoryId
    && existing.provider === input.provider
    && existing.providerRepository === input.providerRepository
    && existing.remoteName === input.remoteName
    && existing.baseBranch === input.baseBranch
    && existing.headBranch === input.headBranch
    && existing.baseSha === input.baseSha
    && existing.headSha === input.headSha;
}

function normalizeCommandId(commandId: string | undefined): string | undefined {
  if (commandId === undefined) return undefined;
  const trimmed = commandId.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_COMMAND_ID_CHARS) {
    throw new Error(`ade: commandId exceeds ${MAX_COMMAND_ID_CHARS} characters`);
  }
  return trimmed;
}

function appendCommandLog(log: CommandLogEntry[], entry: CommandLogEntry): CommandLogEntry[] {
  return [...log, entry].slice(-COMMAND_LOG_LIMIT);
}

function serializeCommandResult(result: unknown): string {
  const json = JSON.stringify(result ?? null) ?? 'null';
  // Known command results (Run records, null) are tiny; anything oversized is
  // journaled as null instead of bloating the atomic config file.
  return json.length > MAX_COMMAND_RESULT_CHARS ? 'null' : json;
}

function isTerminal(status: RunTaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
