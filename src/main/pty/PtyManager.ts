/**
 * Main-process PTY supervisor.
 *
 * Interactive sessions keep a shell alive around the selected CLI. Graph tasks
 * are separate, bounded one-shot sessions: a FIFO lease caps active task CLIs,
 * the prompt is delivered through a runtime-specific non-interactive command,
 * and the slot is released only when the process exits or is cancelled.
 */

import { BrowserWindow } from 'electron';
import { mkdirSync } from 'node:fs';
import * as os from 'node:os';
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
import type { ConfigStore } from '../config/store';
import { injectMemoryBlock } from '../memory/inject';
import { showSessionExitNotification } from '../notifications';
import {
  TaskQueueCancelledError,
  TaskSlotQueue,
  type TaskLease,
  type TaskQueueKey,
} from './TaskQueue';

const RING_BUFFER_CAP = 256 * 1024;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;
const MAX_TASK_PROMPT_CHARS = 32_000;
const EXITED_SESSION_RETENTION_MS = 30 * 60 * 1000;
const FORCE_STOP_MS = 5_000;
const CANCELLED_DISPATCH_TTL_MS = 10 * 60 * 1000;

export const MAX_ACTIVE_TASK_SESSIONS = 4;

export interface TaskLifecycleSink {
  getTaskLaunch?: (taskId: string) => {
    prompt: string;
    env: Record<string, string>;
    command?: string;
    transport?: 'argument' | 'stdin';
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

  constructor(
    private readonly store: ConfigStore,
    private readonly taskLifecycle?: TaskLifecycleSink,
  ) {
    this.taskQueue = new TaskSlotQueue(MAX_ACTIVE_TASK_SESSIONS, (status) => {
      this.broadcast(IPC_EVENTS.PtyTaskQueue, status);
    });
  }

  async create(
    agentId: string,
    task?: string,
    dispatchId?: string,
    runTaskId?: string,
  ): Promise<SessionMeta> {
    const text = task?.trim() ?? '';
    if (!text) return this.spawn(agentId);
    if (text.length > MAX_TASK_PROMPT_CHARS) {
      const error = new Error(`ade: task exceeds ${MAX_TASK_PROMPT_CHARS} characters`);
      this.notifyLaunchFailed(runTaskId, false, error);
      throw error;
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

    const key: TaskQueueKey = { agentId, dispatchId, runTaskId };
    let lease: TaskLease | undefined;
    try {
      lease = await this.taskQueue.acquire(key);
      if (dispatchId && this.cancelledDispatches.has(dispatchId)) {
        throw new Error('ade: task dispatch was cancelled');
      }
      return this.spawn(agentId, { task: text, dispatchId, runTaskId, lease });
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
      session.taskLease?.release();
      session.taskLease = undefined;
      try {
        session.proc.kill();
      } catch {
        // already dead
      }
    }
    this.sessions.clear();
  }

  private spawn(
    agentId: string,
    task?: { task: string; dispatchId?: string; runTaskId?: string; lease: TaskLease },
  ): SessionMeta {
    const agent = this.requireAgent(agentId);
    const managedLaunch = task?.runTaskId
      ? this.taskLifecycle?.getTaskLaunch?.(task.runTaskId)
      : undefined;
    // Managed tasks already receive their complete task/result/mailbox
    // contract in the prompt. Mutating CLAUDE.md/AGENTS.md after a clean
    // workspace lease would contaminate (or alter) the repository itself.
    if (!managedLaunch) {
      try {
        injectMemoryBlock(agent, this.store.get().settings.memory);
      } catch (error) {
        console.warn(`[ade] memory inject failed for agent=${agentId}:`, error);
      }
    }

    const cwd = this.resolveCwd(agent);
    const spec = task
      ? this.resolveTaskSpawn(agent, task.task, managedLaunch)
      : this.resolveInteractiveSpawn(agent);
    const env = {
      ...process.env,
      TERM: 'xterm-256color',
      ...(spec.env ?? {}),
      ...(spec.taskPrompt ? { ADE_TASK_PROMPT: spec.taskPrompt } : {}),
    } as Record<string, string>;
    const proc = pty.spawn(spec.file, spec.args, {
      name: 'xterm-256color',
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd,
      env,
      useConpty: true,
    });

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
    });

    proc.onExit(({ exitCode }) => this.handleExit(session, exitCode));

    if (spec.initialCommand) proc.write(`${spec.initialCommand}${spec.lineEnding}`);

    console.log(
      `[ade] pty:create ${id} agent=${agentId} kind=${meta.kind} runtime=${agent.runtime} ` +
        `file=${spec.file} args=${JSON.stringify(spec.args)} ` +
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

  private appendToRing(session: Session, chunk: Buffer): void {
    session.buffer.push(chunk);
    session.bufferBytes += chunk.byteLength;
    while (session.bufferBytes > RING_BUFFER_CAP && session.buffer.length > 0) {
      const head = session.buffer.shift();
      if (head) session.bufferBytes -= head.byteLength;
    }
  }

  private resolveCwd(agent: Agent): string {
    const dir = agent.workspaceDir?.trim() || os.homedir();
    try {
      mkdirSync(dir, { recursive: true });
    } catch (error) {
      console.warn(`[ade] pty:create - could not create workspaceDir ${dir}:`, error);
    }
    return dir;
  }

  private resolveInteractiveSpawn(agent: Agent): SpawnSpec {
    const command = resolveLaunchCommand(agent);
    const isWin = process.platform === 'win32';
    const shell = isWin ? 'powershell.exe' : (process.env['SHELL'] ?? 'bash');
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
  ): SpawnSpec {
    const isWin = process.platform === 'win32';
    const task = managed?.command
      ? { command: managed.command, transport: managed.transport ?? 'argument' as const }
      : resolveTaskLaunchCommand(agent, isWin ? 'win32' : 'posix');
    if (!task) {
      throw new Error(`ade: runtime "${agent.runtime}" has no non-interactive task transport`);
    }
    const shell = isWin ? 'powershell.exe' : (process.env['SHELL'] ?? 'bash');
    return {
      file: shell,
      args: isWin ? ['-NoLogo', '-NoProfile', '-Command', task.command] : ['-lc', task.command],
      lineEnding: isWin ? '\r' : '\n',
      taskPrompt: managed?.prompt ?? prompt,
      taskTransport: task.transport,
      env: managed?.env,
    };
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }
}
