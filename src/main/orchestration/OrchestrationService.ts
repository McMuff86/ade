import { randomUUID } from 'node:crypto';
import type {
  OrchestrationSnapshot,
  AdeConfig,
  Run,
  RunArtifact,
  RunCreateInput,
  RunEvent,
  RunStatus,
  RunTask,
  RunTaskCreateInput,
  RunTaskStatus,
  SessionMeta,
} from '../../shared/types';

export interface OrchestrationConfigPort {
  get(): AdeConfig;
  save(partial: Partial<AdeConfig>): AdeConfig;
}

const MAX_TASK_PROMPT_CHARS = 8_000;
const MAX_RUN_NAME_CHARS = 80;
const MAX_RUN_GOAL_CHARS = 1_000;
const MAX_RUN_PARTICIPANTS = 128;
const MAX_ARTIFACT_CONTENT_CHARS = 256 * 1_024;
const MAX_ARTIFACT_PATH_CHARS = 1_024;
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
  constructor(
    private readonly store: OrchestrationConfigPort,
    private readonly onChange: (snapshot: OrchestrationSnapshot) => void = () => undefined,
  ) {}

  snapshot(): OrchestrationSnapshot {
    const config = this.store.get();
    const tasks = deriveTasks(config.runTasks, config.runEvents);
    const runs = config.runs.map((run) => ({
      ...run,
      status: deriveRunStatus(run.id, tasks),
    }));
    return {
      runs,
      participants: config.runParticipants.map((participant) => ({ ...participant })),
      tasks,
      events: config.runEvents.map((event) => ({ ...event, data: event.data ? { ...event.data } : undefined })),
      artifacts: config.runArtifacts.map((artifact) => ({ ...artifact })),
    };
  }

  createRun(input: RunCreateInput): Run {
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
    const agents = new Map(config.agents.map((agent) => [agent.id, agent]));
    const seen = new Set<string>();
    const now = Date.now();
    const run: Run = {
      id: randomUUID(),
      name,
      goal,
      status: 'draft',
      source: 'native',
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
      return {
        id: randomUUID(),
        runId: run.id,
        agentId: agent.id,
        agentName: agent.name,
        runtime: agent.runtime,
        role: item.role,
        teamId: item.role === 'orchestrator' ? undefined : teamId,
        teamName: item.role === 'orchestrator' ? undefined : teamName,
        createdAt: now + index,
      };
    });
    const events: RunEvent[] = [
      this.event(run.id, 'run.created', { data: { source: 'native' }, at: now }),
      ...participants.map((participant) => this.event(run.id, 'participant.added', {
        participantId: participant.id,
        at: participant.createdAt,
      })),
    ];

    this.store.save({
      runs: [...config.runs, run],
      runParticipants: [...config.runParticipants, ...participants],
      runEvents: [...config.runEvents, ...events],
    });
    this.emit();
    return { ...run };
  }

  deleteRun(runId: string): void {
    const config = this.store.get();
    this.store.save({
      runs: config.runs.filter((run) => run.id !== runId),
      runParticipants: config.runParticipants.filter((participant) => participant.runId !== runId),
      runTasks: config.runTasks.filter((task) => task.runId !== runId),
      runEvents: config.runEvents.filter((event) => event.runId !== runId),
      runArtifacts: config.runArtifacts.filter((artifact) => artifact.runId !== runId),
    });
    this.emit();
  }

  createTask(input: RunTaskCreateInput): RunTask {
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error('ade: task prompt is required');
    if (prompt.length > MAX_TASK_PROMPT_CHARS) {
      throw new Error(`ade: task exceeds ${MAX_TASK_PROMPT_CHARS} characters`);
    }
    const config = this.store.get();
    const run = config.runs.find((candidate) => candidate.id === input.runId);
    const participant = config.runParticipants.find(
      (candidate) => candidate.id === input.participantId && candidate.runId === input.runId,
    );
    if (!run) throw new Error(`ade: run not found "${input.runId}"`);
    if (!participant) throw new Error(`ade: run participant not found "${input.participantId}"`);

    const now = Date.now();
    const task: RunTask = {
      id: randomUUID(),
      runId: run.id,
      participantId: participant.id,
      prompt,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    };
    const event = this.event(run.id, 'task.queued', {
      taskId: task.id,
      participantId: participant.id,
      at: now,
    });
    const tasks = [...config.runTasks, task];
    const events = [...config.runEvents, event];
    this.store.save({
      runTasks: tasks,
      runEvents: events,
      runs: updateRunStatus(config.runs, run.id, tasks, events, now),
    });
    this.emit();
    return { ...task };
  }

  /** Mark work left active by a previous main-process crash as failed. */
  recoverInterruptedTasks(reason = 'ADE restarted before task completion'): number {
    const activeTasks = this.snapshot().tasks.filter(
      (task) => task.status === 'queued' || task.status === 'running',
    );
    for (const task of activeTasks) this.transitionTask(task.id, 'failed', { error: reason });
    return activeTasks.length;
  }

  failTask(taskId: string, error: string): void {
    this.transitionTask(taskId, 'failed', { error: error.slice(0, 1_000) });
  }

  createArtifact(input: Omit<RunArtifact, 'id' | 'createdAt'>): RunArtifact {
    const config = this.store.get();
    if (!config.runs.some((run) => run.id === input.runId)) {
      throw new Error(`ade: run not found "${input.runId}"`);
    }
    if (input.taskId && !config.runTasks.some(
      (task) => task.id === input.taskId && task.runId === input.runId,
    )) {
      throw new Error(`ade: run task not found "${input.taskId}"`);
    }
    if (!ARTIFACT_KINDS.has(input.kind)) {
      throw new Error(`ade: invalid artifact kind "${String(input.kind)}"`);
    }
    const path = input.path?.trim() || undefined;
    if (path && path.length > MAX_ARTIFACT_PATH_CHARS) {
      throw new Error(`ade: artifact path exceeds ${MAX_ARTIFACT_PATH_CHARS} characters`);
    }
    if (input.content && input.content.length > MAX_ARTIFACT_CONTENT_CHARS) {
      throw new Error(`ade: artifact content exceeds ${MAX_ARTIFACT_CONTENT_CHARS} characters`);
    }
    const artifact: RunArtifact = {
      ...input,
      path,
      id: randomUUID(),
      createdAt: Date.now(),
    };
    const event = this.event(input.runId, 'artifact.created', {
      taskId: input.taskId,
      data: { artifactId: artifact.id, kind: artifact.kind },
    });
    this.store.save({
      runArtifacts: [...config.runArtifacts, artifact],
      runEvents: [...config.runEvents, event],
    });
    this.emit();
    return { ...artifact };
  }

  onTaskStarted(taskId: string, session: SessionMeta): void {
    this.transitionTask(taskId, 'running', { sessionId: session.id });
  }

  onTaskLaunchFailed(taskId: string, cancelled: boolean, error?: string): void {
    this.transitionTask(taskId, cancelled ? 'cancelled' : 'failed', { error });
  }

  onTaskFinished(taskId: string, status: 'completed' | 'failed' | 'cancelled', exitCode: number): void {
    this.transitionTask(taskId, status, { exitCode });
  }

  private transitionTask(
    taskId: string,
    status: Exclude<RunTaskStatus, 'queued'>,
    detail: { sessionId?: string; exitCode?: number; error?: string } = {},
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
        ...(detail.exitCode !== undefined ? { exitCode: detail.exitCode } : {}),
        ...(detail.error ? { error: detail.error.slice(0, 1_000) } : {}),
      },
    });
    const tasks = config.runTasks.map((candidate) => candidate.id === taskId
      ? {
          ...candidate,
          status,
          sessionId: detail.sessionId ?? candidate.sessionId,
          updatedAt: now,
          startedAt: status === 'running' ? now : candidate.startedAt,
          endedAt: isTerminal(status) ? now : candidate.endedAt,
          exitCode: detail.exitCode ?? candidate.exitCode,
          error: detail.error ?? candidate.error,
        }
      : candidate);
    const events = [...config.runEvents, event];
    this.store.save({
      runTasks: tasks,
      runEvents: events,
      runs: updateRunStatus(config.runs, task.runId, tasks, events, now),
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
    ? { ...run, status: deriveRunStatus(runId, derivedTasks), updatedAt: now }
    : run);
}

function isTerminal(status: RunTaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
