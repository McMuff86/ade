/**
 * Main-process PTY supervisor.
 *
 * Interactive sessions keep a shell alive around the selected CLI. Graph tasks
 * are separate, bounded one-shot sessions: a FIFO lease caps active task CLIs,
 * the prompt is delivered through a runtime-specific non-interactive command,
 * and the slot is released only when the process exits or is cancelled.
 */

import { BrowserWindow } from 'electron';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import * as pty from 'node-pty';
import {
  IPC_EVENTS,
  type PtyAttachResult,
  type PtyCancelTasksRequest,
  type PtyCancelTasksResult,
} from '../../shared/ipc';
import {
  LAUNCH_PROFILES,
  resolveLaunchCommand,
  resolveTaskLaunchCommand,
} from '../../shared/runtimes';
import type { Agent, SessionMeta, TaskQueueStatus } from '../../shared/types';
import {
  NATIVE_EXECUTION_BACKEND,
  executionBackendPlatform,
} from '../../shared/executionBackends';
import type { ConfigStore } from '../config/store';
import { ClaudeActivityParser, type ActivityLine } from '../orchestration/claudeStream';
import { CodexActivityParser } from '../orchestration/codexStream';
import { injectMemoryBlock } from '../memory/inject';
import { showSessionExitNotification } from '../notifications';
import { resolveHostShell } from '../platform';
import {
  homeWorkspace,
  type RepositoryScopePort,
  type ResolvedExecutionScope,
} from '../repositories/RepositoryScopeService';
import {
  TaskQueueCancelledError,
  TaskSlotQueue,
  type TaskLease,
  type TaskQueueKey,
} from './TaskQueue';
import { ExecutionBackendService } from '../execution/ExecutionBackendService';

const RING_BUFFER_CAP = 256 * 1024;
const ACTIVITY_LINE_CAP = 2_000;
/** Persisted feed cap per task (JSONL lines in the task dir). */
const ACTIVITY_FILE_CAP = 20_000;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;
const MAX_TASK_PROMPT_CHARS = 32_000;
const EXITED_SESSION_RETENTION_MS = 30 * 60 * 1000;
const FORCE_STOP_MS = 5_000;
const CANCELLED_DISPATCH_TTL_MS = 10 * 60 * 1000;
const WSL_MANAGED_PATH_ENV = new Set([
  'ADE_TASK_DIR',
  'ADE_TASK_RESULT_PATH',
  'ADE_TASK_SCHEMA_PATH',
  'ADE_MAILBOX_INBOX',
  'ADE_MAILBOX_OUTBOX',
]);

export const MAX_ACTIVE_TASK_SESSIONS = 4;

export interface TaskLifecycleSink {
  getTaskLaunch?: (taskId: string) => {
    prompt: string;
    env: Record<string, string>;
    command?: string;
    transport?: 'argument' | 'stdin';
    activityFormat?: 'claude-stream-json' | 'codex-jsonl';
  } | undefined;
  handlesTaskNotification?: (taskId: string) => boolean;
  onTaskStarted: (taskId: string, session: SessionMeta) => void;
  onTaskLaunchFailed: (taskId: string, cancelled: boolean, error?: string) => void;
  onTaskFinished: (
    taskId: string,
    status: 'completed' | 'failed' | 'cancelled',
    exitCode: number,
    terminalOutput: string,
  ) => void;
}

interface Session {
  meta: SessionMeta;
  proc: pty.IPty;
  buffer: Buffer[];
  bufferBytes: number;
  sequence: number;
  taskLease?: TaskLease;
  cancelled: boolean;
  stopping: boolean;
  removeOnExit: boolean;
  reapTimer?: ReturnType<typeof setTimeout>;
  forceStopTimer?: ReturnType<typeof setTimeout>;
  /** Host-side prompt transport scratch used only by WSL task sessions. */
  promptScratchDir?: string;
  /** Live activity rendered from a machine-readable runtime stream. */
  activity?: {
    parser: ClaudeActivityParser | CodexActivityParser;
    lines: ActivityLine[];
    /** Task-dir JSONL so the feed survives session end; best effort. */
    filePath?: string;
    persisted: number;
  };
}

interface SpawnSpec {
  file: string;
  args: string[];
  lineEnding: string;
  initialCommand?: string;
  taskPrompt?: string;
  taskTransport?: 'argument' | 'stdin';
  env?: Record<string, string>;
}

let sessionSeq = 0;

export class PtyManager {
  private readonly sessions = new Map<string, Session>();
  private readonly taskQueue: TaskSlotQueue;
  private readonly cancelledDispatches = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly scopes: RepositoryScopePort;

  constructor(
    private readonly store: ConfigStore,
    private readonly taskLifecycle?: TaskLifecycleSink,
    scopes?: RepositoryScopePort,
    private readonly execution = new ExecutionBackendService(),
  ) {
    this.scopes = scopes ?? {
      resolve: async (agentId) => {
        const agent = this.requireAgent(agentId);
        return {
          source: agent.defaultRepositoryId ? 'agent-default' : 'plain-home',
          repositoryId: agent.defaultRepositoryId,
          workspaceDir: agent.workspaceDir?.trim() || homeWorkspace(agent),
          branch: '',
          executionBackend: NATIVE_EXECUTION_BACKEND,
        };
      },
    };
    this.taskQueue = new TaskSlotQueue(MAX_ACTIVE_TASK_SESSIONS, (status) => {
      this.broadcast(IPC_EVENTS.PtyTaskQueue, status);
    });
  }

  async create(
    agentId: string,
    task?: string,
    dispatchId?: string,
    runTaskId?: string,
    repositoryId?: string | null,
    workspaceBindingId?: string,
  ): Promise<SessionMeta> {
    const text = task?.trim() ?? '';
    if (text.length > MAX_TASK_PROMPT_CHARS) {
      const error = new Error(`ade: task exceeds ${MAX_TASK_PROMPT_CHARS} characters`);
      this.notifyLaunchFailed(runTaskId, false, error);
      throw error;
    }
    if (!text) {
      const scope = await this.scopes.resolve(agentId, { repositoryId, workspaceBindingId });
      this.assertScopeAvailable(scope);
      return await this.spawn(agentId, scope);
    }
    if (text.includes('\0')) {
      const error = new Error('ade: task contains a null character');
      this.notifyLaunchFailed(runTaskId, false, error);
      throw error;
    }
    if (dispatchId && this.cancelledDispatches.has(dispatchId)) {
      const error = new Error('ade: task dispatch was cancelled');
      this.notifyLaunchFailed(runTaskId, true, error);
      throw error;
    }
    let scope: ResolvedExecutionScope;
    try {
      this.assertTaskTarget(agentId, runTaskId, repositoryId, workspaceBindingId);
      scope = await this.scopes.resolve(agentId, { repositoryId, workspaceBindingId });
      this.assertScopeAvailable(scope, runTaskId);
    } catch (error) {
      this.notifyLaunchFailed(runTaskId, false, error);
      throw error;
    }

    const key: TaskQueueKey = { agentId, dispatchId, runTaskId };
    let lease: TaskLease | undefined;
    try {
      lease = await this.taskQueue.acquire(key);
      if (dispatchId && this.cancelledDispatches.has(dispatchId)) {
        throw new Error('ade: task dispatch was cancelled');
      }
      return await this.spawn(agentId, scope, { task: text, dispatchId, runTaskId, lease });
    } catch (error) {
      lease?.release();
      const cancelled = error instanceof TaskQueueCancelledError ||
        Boolean(dispatchId && this.cancelledDispatches.has(dispatchId));
      this.notifyLaunchFailed(runTaskId, cancelled, error);
      throw error;
    }
  }

  list(): SessionMeta[] {
    return [...this.sessions.values()]
      .map((session) => ({ ...session.meta }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  getSessionMeta(sessionId: string): SessionMeta | undefined {
    const meta = this.sessions.get(sessionId)?.meta;
    return meta ? { ...meta } : undefined;
  }

  queueStatus(): TaskQueueStatus {
    return this.taskQueue.status();
  }

  write(sessionId: string, data: Buffer): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.meta.status === 'exited') return;
    session.proc.write(data.toString('utf8'));
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.meta.status === 'exited' || cols < 1 || rows < 1) return;
    try {
      session.proc.resize(cols, rows);
    } catch (error) {
      console.warn(`[ade] pty:resize ${sessionId} failed:`, error);
    }
  }

  /** Explicit tab close: stop the process and remove its replay state. */
  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) this.stopSession(session, true);
  }

  /** Agent/category deletion: cancel queued work and remove every owned PTY. */
  killByAgent(agentId: string): void {
    this.cancelTasks({ agentIds: [agentId] });
    for (const session of this.sessions.values()) {
      if (session.meta.agentId === agentId) this.stopSession(session, true);
    }
  }

  cancelTasks(request: PtyCancelTasksRequest): PtyCancelTasksResult {
    const selectedAgents = request.agentIds ? new Set(request.agentIds) : null;
    const selectedTasks = request.runTaskIds ? new Set(request.runTaskIds) : null;
    const hasScope = selectedAgents !== null || selectedTasks !== null;
    const directlyMatches = (agentId: string, runTaskId?: string): boolean =>
      !hasScope
      || Boolean(selectedAgents?.has(agentId))
      || Boolean(runTaskId && selectedTasks?.has(runTaskId));

    const dispatchIds = new Set<string>();
    for (const session of this.sessions.values()) {
      if (
        session.meta.kind === 'task' &&
        directlyMatches(session.meta.agentId, session.meta.runTaskId) &&
        session.meta.dispatchId
      ) {
        dispatchIds.add(session.meta.dispatchId);
      }
    }
    for (const key of this.taskQueue.pendingKeys()) {
      if (directlyMatches(key.agentId, key.runTaskId) && key.dispatchId) dispatchIds.add(key.dispatchId);
    }
    for (const id of dispatchIds) this.markDispatchCancelled(id);

    const matchesKey = (key: TaskQueueKey): boolean =>
      directlyMatches(key.agentId, key.runTaskId)
      || Boolean(key.dispatchId && dispatchIds.has(key.dispatchId));
    const queuedCancelled = this.taskQueue.cancelPending(matchesKey).length;

    let activeCancelled = 0;
    for (const session of this.sessions.values()) {
      if (session.meta.kind !== 'task' || session.meta.status !== 'running') continue;
      if (
        directlyMatches(session.meta.agentId, session.meta.runTaskId) ||
        Boolean(session.meta.dispatchId && dispatchIds.has(session.meta.dispatchId))
      ) {
        activeCancelled += 1;
        this.stopSession(session, false);
      }
    }
    return { activeCancelled, queuedCancelled };
  }

  attach(sessionId: string): PtyAttachResult {
    const session = this.sessions.get(sessionId);
    if (!session) return { replayBase64: '', sequence: 0 };
    return {
      replayBase64: Buffer.concat(session.buffer, session.bufferBytes).toString('base64'),
      sequence: session.sequence,
    };
  }

  /** Replay of a task's rendered activity; empty for sessions without a stream. */
  activitySnapshot(sessionId: string): { lines: ActivityLine[] } {
    return { lines: [...(this.sessions.get(sessionId)?.activity?.lines ?? [])] };
  }

  disposeAll(): void {
    const shutdownError = new Error('ADE shut down before task completion');
    for (const key of this.taskQueue.pendingKeys()) {
      this.notifyLaunchFailed(key.runTaskId, true, shutdownError);
    }
    this.taskQueue.cancelPending(() => true);
    for (const timer of this.cancelledDispatches.values()) clearTimeout(timer);
    this.cancelledDispatches.clear();

    for (const session of this.sessions.values()) {
      if (session.reapTimer) clearTimeout(session.reapTimer);
      if (session.forceStopTimer) clearTimeout(session.forceStopTimer);
      if (session.meta.kind === 'task' && session.meta.status === 'running') {
        session.cancelled = true;
        this.notifyFinished(session, -1);
      }
      this.releaseTaskLease(session);
      try {
        session.proc.kill();
      } catch {
        // already dead
      }
    }
    this.sessions.clear();
  }

  private async spawn(
    agentId: string,
    scope: ResolvedExecutionScope,
    task?: { task: string; dispatchId?: string; runTaskId?: string; lease: TaskLease },
  ): Promise<SessionMeta> {
    const agent = this.requireAgent(agentId);
    const managedLaunch = task?.runTaskId
      ? this.taskLifecycle?.getTaskLaunch?.(task.runTaskId)
      : undefined;
    // Managed tasks already receive their complete task/result/mailbox
    // contract in the prompt. Mutating CLAUDE.md/AGENTS.md after a clean
    // workspace lease would contaminate (or alter) the repository itself.
    if (!managedLaunch && scope.executionBackend === NATIVE_EXECUTION_BACKEND) {
      try {
        injectMemoryBlock(agent, this.store.get().settings.memory, scope.workspaceDir);
      } catch (error) {
        console.warn(`[ade] memory inject failed for agent=${agentId}:`, error);
      }
    }

    const cwd = await this.resolveCwd(scope);
    const backendPlatform = executionBackendPlatform(scope.executionBackend);
    const baseSpec = task
      ? this.resolveTaskSpawn(agent, task.task, managedLaunch, backendPlatform)
      : this.resolveInteractiveSpawn(agent, backendPlatform);
    let spec = baseSpec;
    let promptScratchDir: string | undefined;
    let backendEnv: Record<string, string> | undefined;
    if (scope.executionBackend !== NATIVE_EXECUTION_BACKEND && task) {
      const prepared = await this.prepareWslTask(baseSpec, scope.executionBackend);
      spec = prepared.spec;
      backendEnv = prepared.env;
      promptScratchDir = prepared.promptScratchDir;
    }
    const command = this.execution.ptyCommand(
      scope.executionBackend,
      spec.file,
      spec.args,
      scope.workspaceDir,
      scope.executionBackend === NATIVE_EXECUTION_BACKEND ? undefined : {
        TERM: 'xterm-256color',
        ...(backendEnv ?? spec.env ?? {}),
      },
    );
    const env = scope.executionBackend === NATIVE_EXECUTION_BACKEND
      ? {
          ...process.env,
          TERM: 'xterm-256color',
          ...(spec.env ?? {}),
          ...(spec.taskPrompt ? { ADE_TASK_PROMPT: spec.taskPrompt } : {}),
        } as Record<string, string>
      : process.env as Record<string, string>;
    let proc: pty.IPty;
    try {
      proc = pty.spawn(command.file, command.args, {
      name: 'xterm-256color',
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd: command.hostCwd ?? (scope.executionBackend === NATIVE_EXECUTION_BACKEND ? cwd : os.homedir()),
      env,
      useConpty: true,
      });
    } catch (error) {
      if (promptScratchDir) rmSync(promptScratchDir, { recursive: true, force: true });
      throw error;
    }

    const id = `s${Date.now().toString(36)}${(sessionSeq++).toString(36)}`;
    const label = LAUNCH_PROFILES[agent.runtime]?.label ?? 'Shell';
    const meta: SessionMeta = {
      id,
      agentId,
      title: task ? `${label} task` : label,
      kind: task ? 'task' : 'interactive',
      status: 'running',
      createdAt: Date.now(),
      dispatchId: task?.dispatchId,
      runTaskId: task?.runTaskId,
      repositoryId: scope.repositoryId,
      workspaceBindingId: scope.workspaceBindingId,
      workspaceDir: scope.workspaceDir,
      executionBackend: scope.executionBackend,
      scopeSource: scope.source,
    };
    const session: Session = {
      meta,
      proc,
      buffer: [],
      bufferBytes: 0,
      sequence: 0,
      taskLease: task?.lease,
      cancelled: false,
      stopping: false,
      removeOnExit: false,
      promptScratchDir,
      activity: managedLaunch?.activityFormat
        ? {
            parser: managedLaunch.activityFormat === 'codex-jsonl'
              ? new CodexActivityParser()
              : new ClaudeActivityParser(),
            lines: [],
            filePath: managedLaunch.env['ADE_TASK_DIR']
              ? join(managedLaunch.env['ADE_TASK_DIR'], 'ACTIVITY.jsonl')
              : undefined,
            persisted: 0,
          }
        : undefined,
    };
    this.sessions.set(id, session);
    if (task?.runTaskId) {
      try {
        this.taskLifecycle?.onTaskStarted(task.runTaskId, { ...meta });
      } catch (error) {
        console.error(`[ade] run task start persistence failed for ${task.runTaskId}:`, error);
      }
    }

    proc.onData((data) => {
      const chunk = Buffer.from(data, 'utf8');
      session.sequence += 1;
      this.appendToRing(session, chunk);
      this.broadcast(IPC_EVENTS.PtyData, {
        sessionId: id,
        dataBase64: chunk.toString('base64'),
        sequence: session.sequence,
      });
      if (session.activity) {
        // The raw stream stays byte-exact in the ring buffer (telemetry parses
        // it at completion); activity is a derived, human-readable view.
        const rendered = session.activity.parser.push(data);
        if (rendered.length === 0) return;
        session.activity.lines.push(...rendered);
        if (session.activity.lines.length > ACTIVITY_LINE_CAP) {
          session.activity.lines.splice(0, session.activity.lines.length - ACTIVITY_LINE_CAP);
        }
        this.broadcast(IPC_EVENTS.PtyActivity, { sessionId: id, lines: rendered });
        // Feed survives session end: append to the task dir, best effort.
        const feed = session.activity;
        if (feed.filePath && feed.persisted < ACTIVITY_FILE_CAP) {
          const slice = rendered.slice(0, ACTIVITY_FILE_CAP - feed.persisted);
          try {
            appendFileSync(
              feed.filePath,
              `${slice.map((line) => JSON.stringify(line)).join('\n')}\n`,
              'utf8',
            );
            feed.persisted += slice.length;
            if (feed.persisted >= ACTIVITY_FILE_CAP) {
              appendFileSync(
                feed.filePath,
                `${JSON.stringify({ kind: 'error', text: '[ADE: Aktivitätslimit erreicht — weitere Zeilen werden nicht aufgezeichnet]' })}\n`,
                'utf8',
              );
            }
          } catch {
            // Recording must never disturb the running task.
          }
        }
      }
    });

    proc.onExit(({ exitCode }) => this.handleExit(session, exitCode));

    if (spec.initialCommand) proc.write(`${spec.initialCommand}${spec.lineEnding}`);

    console.log(
      `[ade] pty:create ${id} agent=${agentId} kind=${meta.kind} runtime=${agent.runtime} ` +
        `backend=${scope.executionBackend} file=${command.file} args=${JSON.stringify(command.args)} ` +
        `transport=${spec.taskTransport ?? 'interactive'} cwd=${cwd}`,
    );
    return { ...meta };
  }

  private handleExit(session: Session, exitCode: number): void {
    const tracked = this.sessions.get(session.meta.id) === session;
    this.releaseTaskLease(session);
    if (!tracked) return;
    if (session.meta.status === 'exited') return;

    if (session.forceStopTimer) {
      clearTimeout(session.forceStopTimer);
      session.forceStopTimer = undefined;
    }
    session.meta.status = 'exited';
    session.meta.exitCode = exitCode;
    session.meta.endedAt = Date.now();
    session.meta.exitReason = session.cancelled ? 'cancelled' : 'exit';
    this.broadcast(IPC_EVENTS.PtyExit, {
      sessionId: session.meta.id,
      exitCode,
      reason: session.cancelled ? 'cancelled' : 'exit',
    });
    const managedNotification = session.meta.runTaskId
      ? this.taskLifecycle?.handlesTaskNotification?.(session.meta.runTaskId) === true
      : false;
    this.notifyFinished(session, exitCode);
    const agentName = this.store.get().agents.find((agent) => agent.id === session.meta.agentId)?.name
      ?? 'Agent';
    if (!managedNotification) showSessionExitNotification({ ...session.meta }, agentName);

    if (session.removeOnExit) this.removeSession(session.meta.id);
    else this.scheduleReap(session);
  }

  private stopSession(session: Session, removeOnExit: boolean): void {
    session.cancelled = true;
    if (removeOnExit) session.removeOnExit = true;
    if (session.meta.status === 'exited') {
      if (session.removeOnExit) this.removeSession(session.meta.id);
      return;
    }
    if (!session.stopping) {
      session.stopping = true;
      try {
        session.proc.kill();
      } catch {
        // force-stop timer below releases any retained queue slot
      }
    }
    if (!session.forceStopTimer) {
      session.forceStopTimer = setTimeout(() => this.forceStop(session), FORCE_STOP_MS);
      session.forceStopTimer.unref?.();
    }
  }

  private forceStop(session: Session): void {
    session.forceStopTimer = undefined;
    if (this.sessions.get(session.meta.id) !== session || session.meta.status === 'exited') return;
    this.releaseTaskLease(session);
    session.meta.status = 'exited';
    session.meta.exitCode = -1;
    session.meta.endedAt = Date.now();
    session.meta.exitReason = 'cancelled';
    this.broadcast(IPC_EVENTS.PtyExit, {
      sessionId: session.meta.id,
      exitCode: -1,
      reason: 'cancelled',
    });
    this.notifyFinished(session, -1);
    if (session.removeOnExit) this.removeSession(session.meta.id);
    else this.scheduleReap(session);
  }

  private scheduleReap(session: Session): void {
    if (session.reapTimer) clearTimeout(session.reapTimer);
    session.reapTimer = setTimeout(
      () => this.removeSession(session.meta.id),
      EXITED_SESSION_RETENTION_MS,
    );
    session.reapTimer.unref?.();
  }

  private removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.reapTimer) clearTimeout(session.reapTimer);
    if (session.forceStopTimer) clearTimeout(session.forceStopTimer);
    this.releaseTaskLease(session);
    this.sessions.delete(sessionId);
    this.broadcast(IPC_EVENTS.PtyRemoved, { sessionId });
  }

  private releaseTaskLease(session: Session): void {
    session.taskLease?.release();
    session.taskLease = undefined;
    if (session.promptScratchDir) {
      rmSync(session.promptScratchDir, { recursive: true, force: true });
      session.promptScratchDir = undefined;
    }
  }

  private markDispatchCancelled(dispatchId: string): void {
    const previous = this.cancelledDispatches.get(dispatchId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => this.cancelledDispatches.delete(dispatchId), CANCELLED_DISPATCH_TTL_MS);
    timer.unref?.();
    this.cancelledDispatches.set(dispatchId, timer);
  }

  private notifyLaunchFailed(runTaskId: string | undefined, cancelled: boolean, error: unknown): void {
    if (!runTaskId) return;
    const message = error instanceof Error ? error.message : String(error);
    try {
      this.taskLifecycle?.onTaskLaunchFailed(runTaskId, cancelled, message);
    } catch (persistError) {
      console.error(`[ade] run task launch failure persistence failed for ${runTaskId}:`, persistError);
    }
  }

  private notifyFinished(session: Session, exitCode: number): void {
    const runTaskId = session.meta.runTaskId;
    if (!runTaskId) return;
    const status = session.cancelled ? 'cancelled' : (exitCode === 0 ? 'completed' : 'failed');
    try {
      const terminalOutput = Buffer.concat(session.buffer, session.bufferBytes).toString('utf8');
      this.taskLifecycle?.onTaskFinished(runTaskId, status, exitCode, terminalOutput);
    } catch (error) {
      console.error(`[ade] run task completion persistence failed for ${runTaskId}:`, error);
    }
  }

  private requireAgent(agentId: string): Agent {
    const agent = this.store.get().agents.find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(`pty:create - unknown agent "${agentId}"`);
    return agent;
  }

  private assertScopeAvailable(scope: ResolvedExecutionScope, runTaskId?: string): void {
    const config = this.store.get();
    const active = config.runWorkspaceLeases.find((lease) => (
      lease.status === 'active' && (
        (scope.workspaceBindingId && lease.workspaceBindingId === scope.workspaceBindingId) ||
        this.execution.samePath(scope.executionBackend, lease.workspaceDir, scope.workspaceDir)
      )
    ));
    if (!active) return;
    const task = runTaskId ? config.runTasks.find((candidate) => candidate.id === runTaskId) : undefined;
    if (!task || task.runId !== active.runId || task.participantId !== active.participantId) {
      throw new Error(`ade: workspace binding is owned by active run ${active.runId}`);
    }
  }

  private assertTaskTarget(
    agentId: string,
    runTaskId: string | undefined,
    repositoryId: string | null | undefined,
    workspaceBindingId: string | undefined,
  ): void {
    if (!runTaskId) return;
    const config = this.store.get();
    const task = config.runTasks.find((candidate) => candidate.id === runTaskId);
    if (!task) throw new Error(`ade: run task not found "${runTaskId}"`);
    const participant = config.runParticipants.find((candidate) => (
      candidate.id === task.participantId && candidate.runId === task.runId
    ));
    if (!participant || participant.agentId !== agentId) {
      throw new Error('ade: run task does not belong to the requested agent');
    }
    if (task.repositoryId !== undefined && task.repositoryId !== repositoryId) {
      throw new Error('ade: run task repository scope does not match the launch request');
    }
    if (task.workspaceBindingId && task.workspaceBindingId !== workspaceBindingId) {
      throw new Error('ade: run task binding does not match the launch request');
    }
  }

  private appendToRing(session: Session, chunk: Buffer): void {
    session.buffer.push(chunk);
    session.bufferBytes += chunk.byteLength;
    while (session.bufferBytes > RING_BUFFER_CAP && session.buffer.length > 0) {
      const head = session.buffer.shift();
      if (head) session.bufferBytes -= head.byteLength;
    }
  }

  private async resolveCwd(scope: ResolvedExecutionScope): Promise<string> {
    const dir = scope.workspaceDir?.trim() || os.homedir();
    try {
      if (scope.executionBackend === NATIVE_EXECUTION_BACKEND) mkdirSync(dir, { recursive: true });
      else await this.execution.mkdir(scope.executionBackend, dir);
    } catch (error) {
      console.warn(`[ade] pty:create - could not create workspaceDir ${dir}:`, error);
    }
    return dir;
  }

  private resolveInteractiveSpawn(agent: Agent, platform: 'win32' | 'posix'): SpawnSpec {
    const command = resolveLaunchCommand(agent);
    const isWin = platform === 'win32';
    const shell = isWin ? resolveHostShell() : '/bin/bash';
    const args = isWin ? ['-NoLogo'] : ['-l'];
    const lineEnding = isWin ? '\r' : '\n';
    return command.trim()
      ? { file: shell, args, initialCommand: command.trim(), lineEnding }
      : { file: shell, args, lineEnding };
  }

  private resolveTaskSpawn(
    agent: Agent,
    prompt: string,
    managed?: {
      prompt: string;
      env: Record<string, string>;
      command?: string;
      transport?: 'argument' | 'stdin';
    },
    platform: 'win32' | 'posix' = process.platform === 'win32' ? 'win32' : 'posix',
  ): SpawnSpec {
    const isWin = platform === 'win32';
    const task = managed?.command
      ? { command: managed.command, transport: managed.transport ?? 'argument' as const }
      : resolveTaskLaunchCommand(agent, isWin ? 'win32' : 'posix');
    if (!task) {
      throw new Error(`ade: runtime "${agent.runtime}" has no non-interactive task transport`);
    }
    const shell = isWin ? resolveHostShell() : '/bin/bash';
    return {
      file: shell,
      args: isWin ? ['-NoLogo', '-NoProfile', '-Command', task.command] : ['-lc', task.command],
      lineEnding: isWin ? '\r' : '\n',
      taskPrompt: managed?.prompt ?? prompt,
      taskTransport: task.transport,
      env: managed?.env,
    };
  }

  private async prepareWslTask(
    spec: SpawnSpec,
    backend: ResolvedExecutionScope['executionBackend'],
  ): Promise<{ spec: SpawnSpec; env: Record<string, string>; promptScratchDir: string }> {
    if (!spec.taskPrompt || spec.args[0] !== '-lc' || !spec.args[1]) {
      throw new Error('ade: WSL task launch requires the POSIX stdin transport');
    }
    const mappings: Array<[string, string]> = [];
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(spec.env ?? {})) {
      if (WSL_MANAGED_PATH_ENV.has(name)) {
        const translated = await this.execution.toBackendPath(backend, value);
        env[name] = translated;
        mappings.push([value, translated]);
      } else {
        env[name] = value;
      }
    }
    let prompt = spec.taskPrompt;
    for (const [hostPath, backendPath] of mappings.sort((left, right) => right[0].length - left[0].length)) {
      prompt = prompt.split(hostPath).join(backendPath);
    }
    const promptScratchDir = mkdtempSync(join(os.tmpdir(), 'ade-wsl-prompt-'));
    const promptHostPath = join(promptScratchDir, 'PROMPT.txt');
    try {
      writeFileSync(promptHostPath, prompt, 'utf8');
      env['ADE_TASK_PROMPT_FILE'] = await this.execution.toBackendPath(backend, promptHostPath);
      const command = 'ADE_TASK_PROMPT="$(cat -- "$ADE_TASK_PROMPT_FILE")"; ' +
        `export ADE_TASK_PROMPT; ${spec.args[1]}`;
      return {
        spec: { ...spec, args: ['-lc', command], taskPrompt: undefined, env },
        env,
        promptScratchDir,
      };
    } catch (error) {
      rmSync(promptScratchDir, { recursive: true, force: true });
      throw error;
    }
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }
}
