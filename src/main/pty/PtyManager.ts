import { t as translate } from "../../shared/i18n";
import { CodexAppServerProcess, type TaskProcess } from './CodexAppServerProcess';
import type { RunQuestionService } from '../orchestration/RunQuestionService';
/**
 * Main-process PTY supervisor.
 *
 * Supported native coding CLIs end their wrapper shell with the invocation;
 * custom/WSL assistants retain their existing interactive shell. Graph tasks
 * are separate, bounded one-shot sessions: a FIFO lease caps active task CLIs,
 * the prompt is delivered through a runtime-specific non-interactive command,
 * and the slot is released only when the process exits or is cancelled.
 */

import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { RunFileTracker } from '../application/RunFileTracker';
import { redactedErrorDetail } from '../errors';
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
  HARNESS_LOGIN_COMMANDS,
  LAUNCH_PROFILES,
  effectiveParticipantAgent,
  resolveLaunchCommand,
  resolveTaskLaunchCommand,
} from '../../shared/runtimes';
import type {
  Agent,
  RuntimeId,
  SessionBookend,
  SessionBookendExitReason,
  SessionMeta,
  TaskQueueStatus,
} from '../../shared/types';
import {
  NATIVE_EXECUTION_BACKEND,
  executionBackendPlatform,
} from '../../shared/executionBackends';
import type { ConfigStore } from '../config/store';
import { ClaudeActivityParser, type ActivityLine } from '../orchestration/claudeStream';
import { CodexActivityParser } from '../orchestration/codexStream';
import { GrokActivityParser } from '../orchestration/grokStream';
import { injectMemoryBlock } from '../memory/inject';
import { buildInteractiveProfileSnapshot } from '../memory/interactiveProfileSnapshot';
import { prepareProfileLaunch, type PreparedProfileLaunch } from './profileLaunch';
import { readCodexProfileConfig } from './CodexProfileConfig';
import { showSessionExitNotification } from '../notifications';
import { redactArgs } from '../errors';
import { resolveHostShell, sameHostPath } from '../platform';
import { broadcastToRenderers } from '../rendererWindows';
import {
  agentHomeBackend,
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
import { SessionLaunchService, type InteractiveLaunchSettings } from './SessionLaunchService';
import { ProjectWorkspaceService } from '../repositories/ProjectWorkspaceService';
import { prepareProgram, ProgramSignalReader } from './InteractiveProgram';
import { prepareProtectedProgram } from './ProtectedProgram';
import { QwenActivityParser } from '../orchestration/qwenStream';
import { TerminalPromptDelivery } from './TerminalPromptDelivery';
import { ProtectedPromptWriter } from './ProtectedPromptWriter';
import type { TerminalPromptCapability, TerminalPromptRequest } from '../../shared/terminalPrompt';
import { RemoteTerminalDisplay } from '../application/RemoteTerminalScreen';
import { cachedCodexAccountUsage } from '../settings/CodexAccountUsage';
import type { NativeUsageLaunch, NativeUsageService } from '../usage/NativeUsageService';
import { providerApiKeyPresent } from '../../shared/sessionAuthentication';
import type { SubscriptionUsage } from '../../shared/remote';
import type { MobileTerminalSelection, SessionLaunchChoice } from '../../shared/remote';
import { terminalHome } from './terminalHome';
import { workspaceOperations, WorkspaceOperationBusyError } from '../repositories/WorkspaceOperationGate';
import {
  closeInteractiveBookend,
  interruptOrphanBookends,
  startInteractiveBookend,
} from '../overview/sessionBookends';

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
  'ADE_TASK_PROMPT_FILE',
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
    activityFormat?: 'claude-stream-json' | 'codex-jsonl' | 'grok-streaming-json' | 'qwen-stream-json';
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
  usageFinish?: NativeUsageLaunch['finish'];
  promptProtected?: boolean;
  cols: number;
  rows: number;
  usageProvider?: 'codex' | 'claude' | 'grok';
  usageApiKey?: boolean;
  lastOutputAt?: number;
  outputBytes?: number;
  programReader?: ProgramSignalReader;
  programCleanup?: () => void;
  profileCleanup?: () => void;
  /** Captured text is main-only and available through an explicit detail read. */
  profileText?: string;
  programStartTimer?: ReturnType<typeof setTimeout>;
  display?: RemoteTerminalDisplay;
  meta: SessionMeta;
  proc: TaskProcess;
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
    sequence: number;
    parser: ClaudeActivityParser | CodexActivityParser | GrokActivityParser;
    lines: ActivityLine[];
    /** Task-dir JSONL so the feed survives session end; best effort. */
    filePath?: string;
    persisted: number;
  };
}

interface SpawnSpec {
  activityFormat?: 'claude-stream-json' | 'codex-jsonl' | 'grok-streaming-json' | 'qwen-stream-json';
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
  private nativeUsage?: NativeUsageService;
  setNativeUsage(service: NativeUsageService): void { this.nativeUsage = service; }
  private readonly promptWriter = new ProtectedPromptWriter({ check: id => {
    const capability = this.promptCapability(id);
    if (!capability.available) throw new Error(capability.reason);
  }, write: (id, text) => this.sessions.get(id)!.proc.write(text) });
  private readonly promptDelivery = new TerminalPromptDelivery({ capability: id => this.promptCapability(id), write: (id, text, authorize) => this.writePrompt(id, text, authorize) });
  private taskFileTracker?: RunFileTracker;
  setTaskFileTracker(tracker: RunFileTracker): void { this.taskFileTracker = tracker; }
  private readonly sessions = new Map<string, Session>();
  private readonly taskQueue: TaskSlotQueue;
  private readonly cancelledDispatches = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly scopes: RepositoryScopePort;

  /** Dedicated interactive launcher: configured agent or plain shell, never a task. */
  sessionOptions(selection: MobileTerminalSelection) {
    return new SessionLaunchService(this.store, this.execution).options(selection);
  }

  async createRemoteInteractive(agentId: string, repositoryId: string | null, workspaceBindingId: string | undefined, mode: SessionLaunchChoice['mode'], model?: string, authorize: () => void = () => undefined): Promise<SessionMeta> {
    return workspaceOperations.use(async () => {
      const scope = await this.scopes.resolve(agentId, { repositoryId, workspaceBindingId });
      this.assertScopeAvailable(scope);
      authorize();
      return this.spawn(agentId, scope, undefined, undefined, mode === 'ollama' ? { mode, model: model! } : { mode }, undefined, authorize);
    });
  }

  constructor(
    private readonly store: ConfigStore,
    private readonly taskLifecycle?: TaskLifecycleSink,
    scopes?: RepositoryScopePort,
    private readonly execution = new ExecutionBackendService(),
    /** Main-only source of harness API-key env for the launching runtime. */
    private readonly harnessCredentials?: { envFor(runtime: RuntimeId): Record<string, string> },
    private readonly questions?: RunQuestionService,
  ) {
    this.scopes = scopes ?? {
      resolve: async (agentId) => {
        const agent = this.requireAgent(agentId);
        const backend = agent.defaultRepositoryId
          ? NATIVE_EXECUTION_BACKEND
          : agentHomeBackend(agent);
        return {
          source: agent.defaultRepositoryId ? 'agent-default' : 'plain-home',
          repositoryId: agent.defaultRepositoryId,
          workspaceDir: backend === NATIVE_EXECUTION_BACKEND
            ? agent.workspaceDir?.trim() || homeWorkspace(agent)
            : homeWorkspace(agent),
          branch: '',
          executionBackend: backend,
        };
      },
    };
    this.taskQueue = new TaskSlotQueue(MAX_ACTIVE_TASK_SESSIONS, (status) => {
      this.broadcast(IPC_EVENTS.PtyTaskQueue, status);
    });
    this.interruptOrphanBookends();
  }

  async create(
    agentId: string, task?: string, dispatchId?: string, runTaskId?: string,
    repositoryId?: string | null, workspaceBindingId?: string, authorize: () => void = () => undefined,
  ): Promise<SessionMeta> {
    try {
      return await workspaceOperations.use(() => this.createInWorkspace(agentId, task, dispatchId, runTaskId, repositoryId, workspaceBindingId, authorize));
    } catch (error) {
      if (error instanceof WorkspaceOperationBusyError) this.notifyLaunchFailed(runTaskId, false, error);
      throw error;
    }
  }

  private async createInWorkspace(
    agentId: string,
    task?: string,
    dispatchId?: string,
    runTaskId?: string,
    repositoryId?: string | null,
    workspaceBindingId?: string,
    authorize: () => void = () => undefined,
  ): Promise<SessionMeta> {
    authorize();
    const text = task?.trim() ?? '';
    if (text.length > MAX_TASK_PROMPT_CHARS) {
      const error = new Error(`ade: task exceeds ${MAX_TASK_PROMPT_CHARS} characters`);
      this.notifyLaunchFailed(runTaskId, false, error);
      throw error;
    }
    if (!text) {
      const scope = await this.scopes.resolve(agentId, { repositoryId, workspaceBindingId });
      this.assertScopeAvailable(scope);
      return await this.spawn(agentId, scope, undefined, undefined, undefined, undefined, authorize);
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
      authorize();
      return await this.spawn(agentId, scope, { task: text, dispatchId, runTaskId, lease }, undefined, undefined, undefined, authorize);
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
      .map((session) => ({ ...session.meta, lastOutputAt: session.lastOutputAt, outputSequence: session.sequence }))
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
    if (this.promptWriter.busy(sessionId)) throw new Error(translate("Prompt handover is running. Wait a minute."));
    const session = this.sessions.get(sessionId);
    if (!session || session.meta.status === 'exited') return;
    session.proc.write(data.toString('utf8'));
  }

  promptCapability(sessionId: string, requirePaste = true): TerminalPromptCapability {
    const session = this.sessions.get(sessionId);
    if (!session || session.meta.status !== 'running' || session.meta.kind !== 'interactive' || session.meta.remoteAccessBlocked) {
      return { available: false, reason: translate("This CLI session has ended or is unavailable. Your draft is preserved.") };
    }
    if (!session.promptProtected) return { available: false, reason: translate("For secure prompt delivery, open a new native Codex, Claude, or Grok session.") };
    if (session.meta.program?.status !== 'running') return { available: false, reason: translate("The started CLI is not yet available or has already ended.") };
    if (requirePaste && !session.display?.acceptsBracketedPaste()) return { available: false, reason: translate("The CLI cannot accept a multiline paste right now. Check the terminal and wait briefly.") };
    return { available: true };
  }

  deliverPrompt(request: TerminalPromptRequest, authorize: () => void | Promise<void>) { return this.promptDelivery.deliver(request, authorize); }

  writePrompt(sessionId: string, text: string | readonly string[], authorize: () => void | Promise<void>): Promise<void> {
    return this.promptWriter.write(sessionId, text, authorize);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.meta.status === 'exited' || cols < 1 || rows < 1) return;
    if (session.cols === cols && session.rows === rows) return;
    try {
      session.proc.resize(cols, rows);
      session.display?.resize(cols, rows);
      session.cols = cols; session.rows = rows;
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
    const directlyMatches = (agentId: string | undefined, runTaskId?: string): boolean =>
      !hasScope
      || Boolean(agentId && selectedAgents?.has(agentId))
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

  async createHomeInteractive(choice: SessionLaunchChoice, authorize: () => void = () => undefined): Promise<SessionMeta> {
    return workspaceOperations.use(async () => {
      authorize();
      if (choice.mode === 'agent') throw new Error(translate("ade: Select the workspace for an agent profile."));
      const home = terminalHome();
      const revalidate = async () => {
        if (JSON.stringify(terminalHome()) !== JSON.stringify(home)) throw new Error(translate("ade: User directory has been changed."));
        authorize();
      };
      return this.spawn(undefined, { ...home, source: 'terminal-home', branch: '' }, undefined, undefined, choice,
        { settings: { name: translate("Standalone terminal"), runtime: 'shell', permissionMode: 'default' }, revalidate }, authorize);
    });
  }

  profileContextText(sessionId: string): string | null {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(translate("ade: Session no longer exists."));
    return session.profileText ?? null;
  }

  async createProjectInteractive(workspaceId: string, expectedBranch: string, choice: SessionLaunchChoice,
    profileId?: string, assertAuthorized: () => void = () => undefined): Promise<SessionMeta> {
    return workspaceOperations.use(async () => {
      assertAuthorized();
      if (choice.mode === 'agent' ? !profileId : profileId !== undefined) throw new Error(translate("ade: Select start profile explicitly or start without profile."));
      const projects = new ProjectWorkspaceService(this.store);
      const resolved = await projects.resolve(workspaceId);
      const profile = profileId ? this.requireAgent(profileId) : undefined;
      if (profile?.homeExecutionBackend && profile.homeExecutionBackend !== 'native') throw new Error(translate("ade: This profile belongs to a different environment. Choose a native profile or open its own workspace."));
      const fingerprint = JSON.stringify(profile);
      const revalidate = async () => {
        const current = await projects.resolve(workspaceId);
        if (current.branch !== expectedBranch || !sameHostPath(current.workspace.workspaceDir, resolved.workspace.workspaceDir)) throw new Error(translate("ade: Project branch has been changed. Update workspace and restart it."));
        if (profileId && JSON.stringify(this.requireAgent(profileId)) !== fingerprint) throw new Error(translate("ade: Start profile has since been changed. Select again."));
        if (this.store.get().runWorkspaceLeases.some((lease) => lease.status === 'active' && sameHostPath(lease.commonGitDir, current.repository.commonGitDir))) throw new Error(translate("ade: Repository is occupied by a managed job."));
        assertAuthorized();
      };
      await revalidate();
      const scope: ResolvedExecutionScope = { source: 'project-workspace', repositoryId: resolved.repository.id,
        workspaceDir: resolved.workspace.workspaceDir, branch: resolved.branch, executionBackend: 'native' };
      return this.spawn(undefined, scope, undefined, undefined, choice, { workspaceId, profileId, revalidate,
        settings: profile ?? { name: translate("Without an agent profile"), runtime: 'shell', permissionMode: 'default' } });
    });
  }

  async subscriptionUsage(sessionId: string): Promise<SubscriptionUsage> {
    const session = this.sessions.get(sessionId);
    if (!session || session.meta.kind !== 'interactive' || session.meta.remoteAccessBlocked) throw new Error(translate("Interactive terminal is not available."));
    const provider = session.usageProvider ?? 'unknown';
    const fallback: SubscriptionUsage = ({ provider, source: 'cli', checkedAt: Date.now(), status: 'unavailable', windows: [],
      consumption: this.nativeUsage?.consumption(sessionId),
      message: session.meta.runtime === 'ollama' ? translate("This session uses Ollama. An automatic subscription and session usage indicator for Ollama has not yet been set up.")
        : provider === 'unknown' ? translate("No subscription provider is known for this shell or this own start command.")
        : provider === 'claude' ? translate("Claude Code shows the current subscription limits with /usage. Automatic integration in ADE is not yet set up.")
          : provider === 'grok' ? translate("Grok Build shows the current usage and reset with /usage.")
            : translate("For this environment, check the subscription limits with /status in Codex."),
      ...(provider !== 'unknown' ? { command: provider === 'codex' ? '/status' : '/usage' } as const : {}) });
    const launchUsage: SubscriptionUsage = session.usageApiKey && provider !== 'unknown' ? { ...fallback, authentication: 'api-key-present',
      message: translate("For {{value1}}, a separate API access was given at launch, which is not an ElevenLabs key, and check the login and billing actually used in the CLI.", { value1: provider === 'codex' ? 'Codex' : provider === 'claude' ? 'Claude Code' : 'Grok Build' }) } : fallback;
    if (provider !== 'codex' || session.meta.executionBackend !== 'native') return launchUsage;
    // A supplied API key must not hide an independently observable local subscription.
    // This probe observes the host account, not the auth state of the existing TUI.
    const result = await cachedCodexAccountUsage();
    if (this.sessions.get(sessionId) !== session) throw new Error(translate("Terminal session has since been closed."));
    return { ...result, consumption: this.nativeUsage?.consumption(sessionId), authentication: session.usageApiKey ? 'api-key-present' : result.status === 'available' ? 'subscription-account' : 'unknown',
      message: `${session.usageApiKey ? launchUsage.message + ' ' : ''}${result.message}`, command: '/status' };
  }

  async remoteDisplay(sessionId: string): Promise<Awaited<ReturnType<RemoteTerminalDisplay['snapshot']>>> {
    const display = this.sessions.get(sessionId)?.display;
    if (!display) throw new Error(translate("Interactive terminal is no longer available."));
    return display.snapshot();
  }

  /** Replay of a task's rendered activity; empty for sessions without a stream. */
  activitySnapshot(sessionId: string): { lines: ActivityLine[]; lastOutputAt?: number; outputBytes: number; structured: boolean } {
    const session = this.sessions.get(sessionId);
    return { lines: (session?.activity?.lines ?? []).map((line) => ({ ...line })), lastOutputAt: session?.lastOutputAt,
      outputBytes: session?.outputBytes ?? 0, structured: !!session?.activity };
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
      void session.usageFinish?.().catch(error => console.warn('[ade] usage finalization failed:', redactedErrorDetail(error)));
      if (session.reapTimer) clearTimeout(session.reapTimer);
      session.display?.dispose();
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
    agentId: string | undefined,
    scope: ResolvedExecutionScope,
    task?: { task: string; dispatchId?: string; runTaskId?: string; lease: TaskLease },
    login?: { command: string; title: string },
    launchChoice?: SessionLaunchChoice,
    project?: { workspaceId?: string; profileId?: string; settings: InteractiveLaunchSettings; revalidate(): Promise<void> },
    authorize: () => void = () => undefined,
  ): Promise<SessionMeta> {
    const savedAgent = agentId ? this.requireAgent(agentId) : undefined; const before = JSON.stringify(savedAgent);
    const settings = project?.settings ?? savedAgent;
    if (!settings || ((task || login) && !savedAgent)) throw new Error(translate("ade: Session does not have a valid starting context."));
    const agent = launchChoice ? await new SessionLaunchService(this.store, this.execution).effectiveSettings(settings, scope.executionBackend, launchChoice)
      : this.effectiveTaskAgent(savedAgent!, task?.runTaskId);
    if (!login) await new SessionLaunchService(this.store, this.execution).validateOllamaCoding(agent, scope.executionBackend);
    const ollamaCoding = agent.runtime === 'ollama' && agent.ollamaMode === 'coding';
    const ollamaCodex = ollamaCoding && agent.ollamaHarness !== 'qwen-code';
    if (agentId && before !== JSON.stringify(this.requireAgent(agentId))) throw new Error(translate("ade: The agent has changed. Reopen the session."));
    this.assertScopeAvailable(scope, task?.runTaskId);
    const managedLaunch = task?.runTaskId
      ? this.taskLifecycle?.getTaskLaunch?.(task.runTaskId)
      : undefined;
    const allowQuestions = !!task?.runTaskId && this.store.get().runTasks.find((item) => item.id === task.runTaskId)?.allowQuestions === true;
    // A raw CLI/login/shell never receives ADE behavior just because its tab
    // belongs to an agent. An explicitly saved behavior opts a profile into the
    // external snapshot transport, independent of the memory toggle.
    const profileIdentity = !task && !login && (!launchChoice || launchChoice.mode === 'agent')
      ? project?.profileId ? this.requireAgent(project.profileId) : savedAgent : undefined;
    // Qwen does not automatically read ADE's AGENTS.md/CLAUDE.md injection.
    // Deliver identity/memory through the same external snapshot even without
    // an explicitly edited behavior profile; never create QWEN.md in a project.
    const profileSnapshot = profileIdentity && (profileIdentity.profile !== undefined || (ollamaCoding && !ollamaCodex))
      ? buildInteractiveProfileSnapshot(profileIdentity, this.store.get().settings.memory) : undefined;
    if (allowQuestions && (agent.runtime !== 'codex' || agent.customCommand?.trim() || scope.executionBackend !== NATIVE_EXECUTION_BACKEND || !this.questions)) {
      throw new Error(translate("ade: Interactive runs require a native Codex runtime and the ADE query service."));
    }
    // Coordinator single-task runs use the native question transport without a
    // managed phase launch. Deliver their identity as main-owned prompt context,
    // too: writing AGENTS.md here would dirty the checkout before task tracking.
    const questionTaskProfile = allowQuestions && !managedLaunch
      ? buildInteractiveProfileSnapshot({ ...savedAgent!, ...agent }, this.store.get().settings.memory) : undefined;
    // Managed tasks already receive their complete task/result/mailbox
    // contract in the prompt. Mutating CLAUDE.md/AGENTS.md after a clean
    // workspace lease would contaminate (or alter) the repository itself.
    if (savedAgent && !project && !managedLaunch && !questionTaskProfile && !login && !profileSnapshot && (!launchChoice || launchChoice.mode === 'agent') && scope.executionBackend === NATIVE_EXECUTION_BACKEND) {
      try {
        injectMemoryBlock({ ...savedAgent, ...agent }, this.store.get().settings.memory, scope.workspaceDir);
      } catch (error) {
        console.warn(`[ade] memory inject failed for agent=${agentId}:`, redactedErrorDetail(error));
      }
    }

    const cwd = project ? scope.workspaceDir : await this.resolveCwd(scope);
    const backendPlatform = executionBackendPlatform(scope.executionBackend);
    const baseSpec = task
      ? this.resolveTaskSpawn({ ...savedAgent!, ...agent }, task.task, managedLaunch, backendPlatform)
      : login
        ? this.resolveLoginSpawn(login.command, backendPlatform)
        : this.resolveInteractiveSpawn(agent, backendPlatform);
    let spec = baseSpec;
    let preparedProfile: PreparedProfileLaunch | undefined;
    let promptScratchDir: string | undefined;
    let backendEnv: Record<string, string> | undefined;
    if (scope.executionBackend !== NATIVE_EXECUTION_BACKEND && task) {
      const prepared = await this.prepareWslTask(baseSpec, scope.executionBackend);
      spec = prepared.spec;
      backendEnv = prepared.env;
      promptScratchDir = prepared.promptScratchDir;
    }
    const credentialEnv = login ? {} : this.harnessCredentials?.envFor(agent.runtime) ?? {};
    if (profileSnapshot && profileIdentity) {
      if (scope.executionBackend !== NATIVE_EXECUTION_BACKEND || process.platform !== 'win32') throw new Error(translate("ade: Interactive profile instructions currently require a native Windows startup."));
      if (!spec.initialCommand) throw new Error(translate("ade: This session start cannot transfer profile instructions."));
      const baseline = agent.runtime === 'codex' || ollamaCodex ? await readCodexProfileConfig({ cwd,
        env: { ...process.env, TERM: 'xterm-256color', ...credentialEnv, ...(spec.env ?? {}) } }) : undefined;
      if (baseline?.status === 'unavailable') throw new Error(baseline.message);
      preparedProfile = prepareProfileLaunch({ agent: { ...profileIdentity, ...agent, ...(ollamaCodex ? { runtime: 'codex' as const } : {}) }, snapshot: profileSnapshot,
        command: spec.initialCommand, scratchRoot: join(os.tmpdir(), 'ade-profile-snapshots'), workspaceDir: scope.workspaceDir,
        executionBackend: scope.executionBackend,
        codexDeveloperInstructions: baseline?.status === 'verified' ? { mode: 'append-verified', existing: baseline.developerInstructions ?? '' } : undefined });
      spec = { ...spec, initialCommand: preparedProfile.command };
    }
    const promptProtected = !task && !login && !!spec.initialCommand && !agent.customCommand && process.platform === 'win32'
      && scope.executionBackend === NATIVE_EXECUTION_BACKEND && (ollamaCoding || ['codex', 'claude', 'grok'].includes(agent.runtime));
    const id = `s${Date.now().toString(36)}${(sessionSeq++).toString(36)}`;
    let usageLaunch: NativeUsageLaunch | undefined;
    if (promptProtected && !ollamaCoding && this.nativeUsage) {
      try {
        usageLaunch = await this.nativeUsage.prepare({ provider: agent.runtime as 'codex' | 'claude' | 'grok', command: spec.initialCommand!,
          env: { ...process.env, ...credentialEnv, ...spec.env }, terminalSessionId: id, repositoryId: scope.repositoryId, agentId });
        spec = { ...spec, initialCommand: usageLaunch.command, env: { ...spec.env, ...usageLaunch.env } };
      } catch (error) { console.warn('[ade] usage collection could not start:', redactedErrorDetail(error)); }
    }
    const finishUsage = () => { void usageLaunch?.finish().catch(error => console.warn('[ade] usage finalization failed:', redactedErrorDetail(error))); };
    let program: Awaited<ReturnType<typeof prepareProgram>> | undefined;
    try { program = !task && !login && spec.initialCommand
      ? await (promptProtected ? prepareProtectedProgram : prepareProgram)(spec.initialCommand, backendPlatform, (path) => scope.executionBackend === NATIVE_EXECUTION_BACKEND
        ? Promise.resolve(path) : this.execution.toBackendPath(scope.executionBackend, path)) : undefined;
    } catch (error) { finishUsage(); preparedProfile?.dispose(); throw error; }
    if (program) spec = { ...spec, args: program.args ?? spec.args, initialCommand: program.initialCommand };
    // Match the read-only Codex config probe's clean shell environment. A
    // PowerShell profile must not swap aliases/config after baseline capture.
    if (preparedProfile && !spec.args.includes('-NoProfile')) spec = { ...spec, args: ['-NoProfile', ...spec.args] };
    // Stored service keys and the matching harness API key reach only
    // sessions of the effective runtime; explicit task/launch env always
    // wins. Login terminals stay credential-free so the CLI's own sign-in
    // state is what gets created and checked.
    let command: ReturnType<ExecutionBackendService['ptyCommand']>;
    try { command = this.execution.ptyCommand(
      scope.executionBackend,
      spec.file,
      spec.args,
      scope.workspaceDir,
      scope.executionBackend === NATIVE_EXECUTION_BACKEND ? undefined : {
        TERM: 'xterm-256color',
        ...credentialEnv,
        ...(backendEnv ?? spec.env ?? {}),
      },
    ); } catch (error) { finishUsage(); program?.dispose(); preparedProfile?.dispose(); throw error; }
    // WSL launches receive their backend fields through WSLENV in the host
    // environment of wsl.exe (see ExecutionBackendService.wslLaunch), never
    // through argv, so the credential is not on the relay's command line.
    const env = scope.executionBackend === NATIVE_EXECUTION_BACKEND
      ? {
          ...process.env,
          TERM: 'xterm-256color',
          ...credentialEnv,
          ...(spec.env ?? {}),
          ...(spec.taskPrompt ? { ADE_TASK_PROMPT: spec.taskPrompt } : {}),
        } as Record<string, string>
      : command.hostEnv ?? (process.env as Record<string, string>);
    let proc: TaskProcess;
    try {
      if (project) await project.revalidate();
      if (profileSnapshot && profileIdentity && buildInteractiveProfileSnapshot(this.requireAgent(profileIdentity.id), this.store.get().settings.memory).sha256 !== profileSnapshot.sha256) {
        throw new Error(translate("ade: Profile instructions have been changed during the start. Reopen session."));
      }
      if (questionTaskProfile && buildInteractiveProfileSnapshot({ ...this.requireAgent(agentId!), ...this.effectiveTaskAgent(this.requireAgent(agentId!), task!.runTaskId) },
        this.store.get().settings.memory).sha256 !== questionTaskProfile.sha256) {
        throw new Error(translate("ade: Profile instructions were changed during the start of the job. Check the job again."));
      }
      if (task?.runTaskId && this.taskFileTracker) {
        await this.taskFileTracker.before(task.runTaskId, scope);
        const currentTask = this.store.get().runTasks.find((item) => item.id === task.runTaskId);
        if (!currentTask || currentTask.status !== 'queued') throw new Error(translate("ade: Job was terminated before process start."));
      }
      this.assertScopeAvailable(scope, task?.runTaskId);
      authorize();
      const questionTaskPrompt = questionTaskProfile
        ? `ADE profile context (read-only snapshot; repository instructions and the task request take precedence). Work only in the assigned workspace; do not edit external profile or memory files.\n\n${questionTaskProfile.content}\n\nTask request:\n${task!.task}`
        : task?.task;
      proc = allowQuestions ? new CodexAppServerProcess({ cwd, env, agent, prompt: managedLaunch?.prompt ?? questionTaskPrompt!,
        resultPath: managedLaunch?.env.ADE_TASK_RESULT_PATH, schemaPath: managedLaunch?.env.ADE_TASK_SCHEMA_PATH,
        question: (items, blocking, deliver) => this.questions!.register(task!.runTaskId!, items, blocking, deliver),
      }) : pty.spawn(command.file, command.args, {
      name: 'xterm-256color',
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd: command.hostCwd ?? (scope.executionBackend === NATIVE_EXECUTION_BACKEND ? cwd : os.homedir()),
      env,
      useConpty: true,
      });
    } catch (error) {
      finishUsage();
      program?.dispose();
      preparedProfile?.dispose();
      if (promptScratchDir) rmSync(promptScratchDir, { recursive: true, force: true });
      throw error;
    }

    const label = LAUNCH_PROFILES[agent.runtime]?.label ?? 'Shell';
    const meta: SessionMeta = {
      runtime: agent.runtime,
      launchModel: agent.customCommand ? undefined : agent.runtime === 'codex' ? agent.codexModel
        : agent.runtime === 'claude' ? agent.claudeModel : agent.runtime === 'grok' ? agent.grokModel
        : agent.runtime === 'ollama' ? agent.ollamaModel : undefined,
      workspaceKind: project?.workspaceId ? this.store.get().projectWorkspaces.find(item => item.id === project.workspaceId)?.kind
        : scope.workspaceBindingId ? 'worktree' : 'home',
      profileContext: profileSnapshot && profileIdentity ? { profileId: profileIdentity.id, profileName: profileIdentity.name,
        digest: profileSnapshot.sha256, profileDigest: profileSnapshot.profileDigest, capturedAt: Date.now(), delivery: 'supplied', sources: profileSnapshot.sources } : undefined,
      program: program ? { status: 'starting' } : undefined,
      launchChoice,
      remoteAccessBlocked: login ? true : undefined,
      id,
      agentId,
      projectWorkspaceId: project?.workspaceId,
      launchProfileId: project?.profileId,
      launchProfileName: project?.profileId ? project.settings.name : undefined,
      branch: scope.branch,
      title: launchChoice?.mode === 'hermes' ? 'Hermes' : launchChoice?.mode === 'ollama' ? `Ollama · ${launchChoice.model}` : login ? login.title : task ? `${label} task`
        : program && (agent.runtime === 'custom' || agent.runtime === 'shell') ? agent.name : label,
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
      usageFinish: usageLaunch?.finish,
      promptProtected,
      cols: DEFAULT_COLS, rows: DEFAULT_ROWS,
      profileText: profileSnapshot?.content,
      profileCleanup: preparedProfile?.dispose,
      usageProvider: !agent.customCommand && (agent.runtime === 'codex' || agent.runtime === 'claude' || agent.runtime === 'grok') ? agent.runtime : undefined,
      usageApiKey: !agent.customCommand && providerApiKeyPresent(agent.runtime, scope.executionBackend === NATIVE_EXECUTION_BACKEND
        ? env : { ...credentialEnv, ...(backendEnv ?? spec.env ?? {}) }),
      display: meta.kind === 'interactive' ? new RemoteTerminalDisplay(DEFAULT_COLS, DEFAULT_ROWS, { conpty: process.platform === 'win32' }) : undefined,
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
      activity: (allowQuestions || managedLaunch?.activityFormat || baseSpec.activityFormat)
        ? {
            sequence: 0,
            parser: activityParserFor(allowQuestions ? 'codex-jsonl' : (managedLaunch?.activityFormat ?? baseSpec.activityFormat)!),
            lines: [],
            filePath: managedLaunch?.env['ADE_TASK_DIR']
              ? join(managedLaunch.env['ADE_TASK_DIR'], 'ACTIVITY.jsonl')
              : undefined,
            persisted: 0,
          }
        : undefined,
    };
    this.sessions.set(id, session);
    if (program) {
      session.programCleanup = program.dispose;
      session.programReader = new ProgramSignalReader(program.nonce, (signal) => {
        if (session.meta.status !== 'running') return;
        if (session.programStartTimer) clearTimeout(session.programStartTimer);
        session.programStartTimer = undefined;
        this.setProgram(session, signal.status === 'running' ? { status: 'running', startedAt: Date.now() }
          : signal.status === 'unknown' ? { ...session.meta.program, status: 'unknown', endedAt: Date.now() }
          : { ...session.meta.program, status: 'exited', exitCode: signal.exitCode, endedAt: Date.now() });
      });
      session.programStartTimer = setTimeout(() => {
        if (session.meta.program?.status === 'starting') this.setProgram(session, { status: 'unknown' });
      }, 15_000);
      session.programStartTimer.unref?.();
    }
    if (meta.kind === 'interactive') this.recordInteractiveStart(meta, agent);
    if (task?.runTaskId) {
      try {
        this.taskLifecycle?.onTaskStarted(task.runTaskId, { ...meta });
      } catch (error) {
        console.error(`[ade] run task start persistence failed for ${task.runTaskId}:`, error);
      }
    }

    proc.onData((data) => {
      data = session.programReader?.push(data) ?? data;
      if (!data) return;
      const chunk = Buffer.from(data, 'utf8');
      session.lastOutputAt = Date.now(); session.outputBytes = (session.outputBytes ?? 0) + chunk.length;
      session.sequence += 1;
      this.appendToRing(session, chunk);
      session.display?.write(chunk);
      this.broadcast(IPC_EVENTS.PtyData, {
        sessionId: id,
        dataBase64: chunk.toString('base64'),
        sequence: session.sequence,
      });
      if (session.activity) {
        // The raw stream stays byte-exact in the ring buffer (telemetry parses
        // it at completion); activity is a derived, human-readable view.
        const rendered = session.activity.parser.push(data).map((line) => ({ ...line, sequence: ++session.activity!.sequence, at: Date.now() }));
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
                `${JSON.stringify({ kind: 'error', text: translate("[ADE: Activity Limit Reached — Additional Lines Not Recorded]") })}\n`,
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

    if (!allowQuestions && spec.initialCommand) proc.write(`${spec.initialCommand}${spec.lineEnding}`);

    // argv is logged through the redaction funnel: interactive launch profiles
    // are operator-authored and may carry `--api-key`-style flags.
    console.log(
      `[ade] pty:create ${id} agent=${agentId} kind=${meta.kind} runtime=${agent.runtime} ` +
        `backend=${scope.executionBackend} file=${command.file} args=${JSON.stringify(redactArgs(command.args))} ` +
        `transport=${allowQuestions ? 'codex-app-server' : spec.taskTransport ?? 'interactive'} cwd=${cwd}`,
    );
    return { ...meta };
  }

  private setProgram(session: Session, program: NonNullable<SessionMeta['program']>): void {
    session.meta.program = program;
    this.broadcast(IPC_EVENTS.PtyProgram, { sessionId: session.meta.id, program: { ...program } });
  }

  private finishProgram(session: Session): void {
    // A PTY exit/cancellation cannot prove the child program's exit code.
    if (session.meta.program && session.meta.program.status !== 'exited') {
      this.setProgram(session, { ...session.meta.program, status: 'unknown', endedAt: Date.now() });
    }
  }

  private handleExit(session: Session, exitCode: number): void {
    void session.usageFinish?.(exitCode === 0 && !session.stopping && !session.cancelled ? 'normal' : 'interrupted')
      .catch(error => console.warn('[ade] usage finalization failed:', redactedErrorDetail(error)));
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
    this.finishProgram(session);
    this.recordInteractiveEnd(session, session.cancelled ? 'cancelled' : 'exit');
    this.broadcast(IPC_EVENTS.PtyExit, {
      sessionId: session.meta.id,
      exitCode,
      reason: session.cancelled ? 'cancelled' : 'exit',
    });
    const managedNotification = session.meta.runTaskId
      ? this.taskLifecycle?.handlesTaskNotification?.(session.meta.runTaskId) === true
      : false;
    void this.notifyFinished(session, exitCode);
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
    this.finishProgram(session);
    this.recordInteractiveEnd(session, 'cancelled');
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
    this.promptDelivery.forget(sessionId);
    session.display?.dispose();
    this.broadcast(IPC_EVENTS.PtyRemoved, { sessionId });
  }

  private releaseTaskLease(session: Session): void {
    session.profileCleanup?.();
    session.profileCleanup = undefined;
    if (session.programStartTimer) clearTimeout(session.programStartTimer);
    session.programStartTimer = undefined;
    session.programCleanup?.();
    session.programCleanup = undefined;
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

  private async notifyFinished(session: Session, exitCode: number): Promise<void> {
    const runTaskId = session.meta.runTaskId;
    if (!runTaskId) return;
    const status = session.cancelled ? 'cancelled' : (exitCode === 0 ? 'completed' : 'failed');
    try {
      const terminalOutput = Buffer.concat(session.buffer, session.bufferBytes).toString('utf8');
      try { await this.taskFileTracker?.after(runTaskId); }
      catch (error) { console.warn('[ade] task file comparison unavailable:', redactedErrorDetail(error)); }
      this.taskLifecycle?.onTaskFinished(runTaskId, status, exitCode, terminalOutput);
    } catch (error) {
      console.error(`[ade] run task completion persistence failed for ${runTaskId}:`, error);
    }
  }

  private interruptOrphanBookends(): void {
    this.persistBookends((bookends) => interruptOrphanBookends(bookends, new Set(), Date.now()));
  }

  private recordInteractiveStart(meta: SessionMeta, agent: InteractiveLaunchSettings): void {
    const config = this.store.get();
    const repositoryName = meta.repositoryId
      ? (config.repositories.find((repository) => repository.id === meta.repositoryId)?.name ?? null)
      : null;
    const record: SessionBookend = {
      id: meta.id,
      agentId: meta.agentId,
      projectWorkspaceId: meta.projectWorkspaceId,
      branch: meta.branch,
      agentName: meta.projectWorkspaceId ? `${meta.title} · ${meta.launchProfileName ?? translate("Without an agent profile")}` : agent.name,
      runtime: agent.runtime,
      repositoryId: meta.repositoryId ?? null,
      repositoryName,
      startedAt: meta.createdAt,
      endedAt: null,
    };
    this.persistBookends((bookends) => startInteractiveBookend(bookends, record));
  }

  private recordInteractiveEnd(session: Session, exitReason: SessionBookendExitReason): void {
    if (session.meta.kind !== 'interactive') return;
    const endedAt = session.meta.endedAt ?? Date.now();
    this.persistBookends((bookends) => closeInteractiveBookend(bookends, session.meta.id, endedAt, exitReason));
  }

  private persistBookends(mutator: (bookends: SessionBookend[]) => SessionBookend[]): void {
    try {
      const current = this.store.get().sessionBookends;
      const next = mutator(current);
      if (next === current) return;
      this.store.save({ sessionBookends: next });
    } catch (error) {
      console.error('[ade] session bookend persist failed:', error);
    }
  }

  private requireAgent(agentId: string): Agent {
    const agent = this.store.get().agents.find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(`pty:create - unknown agent "${agentId}"`);
    return agent;
  }

  /** Run tasks launch with the participant's per-run harness override. */
  private effectiveTaskAgent(agent: Agent, runTaskId?: string): Agent {
    if (!runTaskId) return agent;
    const config = this.store.get();
    const runTask = config.runTasks.find((candidate) => candidate.id === runTaskId);
    const participant = runTask
      ? config.runParticipants.find((candidate) => candidate.id === runTask.participantId)
      : undefined;
    return effectiveParticipantAgent(agent, participant?.runtime);
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

  /**
   * Terminal running one harness's documented sign-in command in the agent's
   * portable home. The command comes exclusively from ADE's fixed table; the
   * CLI owns the whole OAuth/device flow. Native backend only for now — WSL
   * distros hold their own per-home sign-in state.
   */
  async createHarnessLogin(agentId: string, runtime: RuntimeId): Promise<SessionMeta> {
    return workspaceOperations.use(() => this.createHarnessLoginInWorkspace(agentId, runtime));
  }

  private async createHarnessLoginInWorkspace(agentId: string, runtime: RuntimeId): Promise<SessionMeta> {
    const command = HARNESS_LOGIN_COMMANDS[runtime];
    if (!command) throw new Error(`ade: harness "${runtime}" has no documented sign-in command`);
    this.requireAgent(agentId);
    const scope = await this.scopes.resolve(agentId, { repositoryId: null });
    if (scope.executionBackend !== NATIVE_EXECUTION_BACKEND) {
      throw new Error('ade: the sign-in terminal currently supports the native backend only');
    }
    this.assertScopeAvailable(scope);
    return this.spawn(agentId, scope, undefined, {
      command,
      title: `${LAUNCH_PROFILES[runtime].label} sign-in`,
    });
  }

  private resolveLoginSpawn(command: string, platform: 'win32' | 'posix'): SpawnSpec {
    const isWin = platform === 'win32';
    return {
      file: isWin ? resolveHostShell() : '/bin/bash',
      args: isWin ? ['-NoLogo'] : ['-l'],
      initialCommand: command,
      lineEnding: isWin ? '\r' : '\n',
    };
  }

  private resolveInteractiveSpawn(agent: InteractiveLaunchSettings, platform: 'win32' | 'posix'): SpawnSpec {
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
      activityFormat: 'activityFormat' in task ? task.activityFormat : undefined,
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
    broadcastToRenderers(channel, payload);
  }
}

function activityParserFor(
  format: 'claude-stream-json' | 'codex-jsonl' | 'grok-streaming-json' | 'qwen-stream-json',
): ClaudeActivityParser | CodexActivityParser | GrokActivityParser {
  if (format === 'codex-jsonl') return new CodexActivityParser();
  if (format === 'grok-streaming-json') return new GrokActivityParser();
  if (format === 'qwen-stream-json') return new QwenActivityParser();
  return new ClaudeActivityParser();
}
