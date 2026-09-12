import { validQuestionAnswers, type RunQuestionAnswerInput } from '../../shared/runQuestions';
import type { RunQuestionService } from '../orchestration/RunQuestionService';
import { createHash } from 'node:crypto';
import { DeviceResourceService } from './DeviceResourceService';
import type { DeviceResourceAccess } from '../../shared/remoteDevices';
import type {
  AdeConfig,
  Run,
  RunCreateInput,
  RunEvent,
  RunMessage,
  RunSummary,
  RunTaskSubmission,
  RunTaskSubmitInput,
  TaskQueueStatus,
} from '../../shared/types';
import type {
  MobileCatalog,
  MobileCommandResult,
  MobileErrorCode,
  MobileHealth,
  MobileHostState,
  MobileRestartResult,
  MobileAdminCommand,
  MobileAdministrationResult,
  MobileGitResult,
  MobileJournalEvent,
  MobileJournalMessage,
  MobileJournalPage,
  MobileJournalValue,
  MobileRunCreateInput,
  MobileSnapshot,
  MobileTaskSubmitInput,
} from '../../shared/remote';
import { IPC, type InvokeChannel } from '../../shared/ipc';
import { assertIpcPayload } from '../ipcValidation';
import { CHANNEL_POLICY, REMOTE_COMMAND_CHANNELS, type RemoteAccess } from '../ipcPolicy';
import { redactForWire, redactedWireMessage } from '../errors';
import { isValidIdempotencyKey, type RemotePrincipal } from '../remote/authorization';
import type { HostRestartController } from './HostRestartController';
import type { RemoteCommandLedger } from './RemoteCommandLedger';
import type { HostOperationGate } from './HostOperationGate';
import type { RemoteWorkspaceService } from './RemoteWorkspaceService';
import { validateFileSave, validateWorkbenchQuery, type RemoteWorkbenchService } from './RemoteWorkbenchService';
import { validateTerminal, type RemoteTerminalService } from './RemoteTerminalService';
import type { MobileTerminalQuery, MobileTerminalCommand, MobileTerminalInput } from '../../shared/remote';
import { validateProfileQuery, validateProfileUpdate, type RemoteProfileService } from './RemoteProfileService';
import type { RepositorySyncService } from '../repositories/RepositorySyncService';
import { REMOTE_ADMIN_SCOPES } from '../../shared/remoteDevices';
import { validSyncRef, type GitSyncOverview, type GitSyncPreview } from '../../shared/gitSync';
import { mobileDashboard } from '../dashboard/mobileDashboard';
import type { ProjectWorkspaceService, ProjectAuthorization } from '../repositories/ProjectWorkspaceService';
import type { RunInspectionService } from './RunInspectionService';
import type { MobileRunActivity } from '../../shared/remote';
import type { ProjectBranchService } from '../repositories/ProjectBranchService';
import type { ProjectGitService } from '../repositories/ProjectGitService';
import type { ProjectPublishService } from '../repositories/ProjectPublishService';
import type { ProjectWorkspaceCommandResult, ProjectWorkspaceQueryResult } from '../../shared/remote';
import { validProjectWorkspaceCommand, validProjectWorkspaceQuery } from '../../shared/projectWorkspaceRequests';

export interface ApplicationConfigPort {
  get(): AdeConfig;
}

export interface ApplicationRunPort {
  summarize(runId?: string): RunSummary[];
  eventsSince(sinceSeq: number, limit?: number): {
    events: RunEvent[];
    messages: RunMessage[];
    nextCursor: number;
  };
  /** Highest seq currently in the journal (0 when empty). */
  journalCursor(): number;
}

export interface ApplicationQueuePort {
  status(): TaskQueueStatus;
}

/**
 * The bounded commands the host API may issue: three managed-run commands
 * plus one single-task submission. Each port method already honors
 * `commandId` replay inside the orchestration layer; this service adds the
 * remote key→commandId binding on top.
 */
export interface ApplicationCommandPort {
  createRun(input: RunCreateInput): Run;
  startRun(runId: string, commandId: string): Promise<Run>;
  cancelRun(runId: string, commandId: string): Promise<void>;
  submitTask(input: RunTaskSubmitInput): Promise<RunTaskSubmission>;
}

/** Fires after every journal change; the SSE adapter flushes deltas on it. */
export interface ApplicationChangeSource {
  subscribe(listener: () => void): () => void;
}

export interface RemoteAuditEntry {
  at: number;
  principalId: string;
  principalKind: RemotePrincipal['kind'];
  requestId: string;
  channel: InvokeChannel;
  target: string | null;
  outcome: 'requested' | 'executed' | 'replayed' | 'denied' | 'rejected';
  /** Redacted, bounded reason for denied/rejected outcomes. */
  reason?: string;
}

export interface ApplicationOptions {
  resourceAccess?: (deviceId: string) => DeviceResourceAccess;
  questions?: RunQuestionService;
  projects?: ProjectWorkspaceService;
  runInspection?: RunInspectionService;
  projectBranches?: ProjectBranchService;
  projectGit?: ProjectGitService;
  projectPublish?: ProjectPublishService;
  workbench?: RemoteWorkbenchService;
  terminals?: RemoteTerminalService;
  profiles?: RemoteProfileService;
  deviceActive?: (deviceId: string) => boolean;
  activity?: HostOperationGate;
  administration?: { ledger: RemoteCommandLedger; restart: HostRestartController; workspaces?: RemoteWorkspaceService; git?: RepositorySyncService };
  commands?: ApplicationCommandPort;
  changes?: ApplicationChangeSource;
  /** Whether any principal can currently hold `runs:write` (health projection). */
  commandsEnabled?: () => boolean;
  audit?: (entry: RemoteAuditEntry) => void;
  now?: () => number;
}

export interface RemoteCommandContext {
  principal: RemotePrincipal;
  /** Validated by the adapter for presence; validated here for shape. */
  idempotencyKey: string | undefined;
  requestId: string;
}

/** Transport-neutral failure with a stable code; the HTTP adapter maps status. */
export class RemoteApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: MobileErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'RemoteApiError';
  }
}

/** Simple synchronous fan-out used by the composition root and tests. */
export class JournalChangeHub implements ApplicationChangeSource {
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  publish(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.warn('[ade] journal change listener failed:', redactedWireMessage(error));
      }
    }
  }
}

const AUDIT_RING_LIMIT = 200;
const REMOTE_COMMAND_PREFIX = 'remote:';
const FINGERPRINT_CHARS = 32;
const MAX_EVENT_PAGE = 500;
const MAX_REMOTE_NAME_CHARS = 80;
const MAX_REMOTE_GOAL_CHARS = 1_000;
/** Same bound as the desktop `runTask:create` validator; the PTY layer allows more, the wire does not. */
const MAX_REMOTE_PROMPT_CHARS = 8_000;
const MAX_REMOTE_PARTICIPANTS = 32;
const MAX_REMOTE_TEAM_NAME_CHARS = 80;
const MAX_REMOTE_ID_CHARS = 128;
const REMOTE_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const PARTICIPANT_ROLES = ['orchestrator', 'lead', 'worker'] as const;
const BUDGET_KEYS = [
  'maxConcurrentTasks', 'maxInputTokens', 'maxOutputTokens', 'maxCostUsd', 'maxApprovals', 'maxTaskMinutes',
] as const;

/**
 * Journal `data` keys allowed on the wire. Everything else — `workspaceDir`,
 * `sessionId`, `archiveRef`, publication provider details — is dropped, so a
 * new journal field is invisible remotely until it is added here on purpose.
 */
const WIRE_EVENT_DATA_KEYS: ReadonlySet<string> = new Set([
  'phase', 'detail', 'error', 'reason', 'exitCode', 'repositoryId', 'workspaceBindingId', 'managed',
  'teamId', 'approvalId', 'type', 'decision', 'automatic', 'kind', 'used', 'limit', 'commitCount',
  'outcome', 'adapterId', 'resultId', 'messageId', 'leaseId', 'branch', 'source', 'artifactId',
  'fromSha', 'toSha', 'preparedBaseSha', 'questionId', 'blocking', 'status',
]);

/**
 * Transport-neutral, mobile-safe boundary shared by Electron IPC and the
 * bounded Goal 7 HTTP adapter. Reads project sanitized DTOs; commands enforce
 * the channel's remote requirement, bind the idempotency key to the exact
 * payload and audit every attempt. It never returns AdeConfig directly.
 */
export class AdeApplicationService {
  private get resources(): DeviceResourceService { return new DeviceResourceService(this.store, this.options.resourceAccess); }
  private readonly commands: ApplicationCommandPort | null;
  private readonly changes: ApplicationChangeSource | null;
  private readonly commandsEnabled: () => boolean;
  private readonly auditSink: (entry: RemoteAuditEntry) => void;
  private readonly now: () => number;
  private readonly auditRing: RemoteAuditEntry[] = [];
  /** Same-key requests that arrive while the first is still executing. */
  private readonly inFlight = new Map<string, { commandId: string; result: Promise<MobileCommandResult> }>();
  private readonly gitPreviewOwners = new Map<string, { deviceId: string; expiresAt: number }>();

  constructor(
    private readonly store: ApplicationConfigPort,
    private readonly runsPort: ApplicationRunPort,
    private readonly queuePort: ApplicationQueuePort,
    private readonly options: ApplicationOptions = {},
  ) {
    this.commands = options.commands ?? null;
    this.changes = options.changes ?? null;
    this.commandsEnabled = options.commandsEnabled ?? (() => false);
    this.auditSink = options.audit ?? ((entry) => {
      console.log(
        `[ade] host API ${entry.channel} principal=${entry.principalKind}:${entry.principalId}`
        + ` request=${entry.requestId} target=${entry.target ?? '-'} outcome=${entry.outcome}`
        + (entry.reason ? ` reason=${entry.reason}` : ''),
      );
    });
    this.now = options.now ?? (() => Date.now());
  }

  /* ------------------------------------------------------------------ reads */

  queryProfile(context: RemoteCommandContext, payload: unknown) {
    if (!this.options.profiles) throw new RemoteApiError(404, 'not_found');
    if (context.principal.kind !== 'device' || context.principal.proof !== 'device-signature' || !context.principal.scopes.has('read')) throw new RemoteApiError(401, 'device_proof_required');
    if (!this.options.deviceActive?.(context.principal.id)) throw new RemoteApiError(401, 'unknown_device');
    try { const id = validateProfileQuery(payload); this.resources.assertAgent(context.principal, id); return this.options.profiles.query(id); }
    catch (error) { if (error instanceof RemoteApiError) throw error; throw new RemoteApiError(422, 'command_rejected', redactedWireMessage(error)); }
  }

  async updateProfile(context: RemoteCommandContext, payload: unknown) {
    const ledger = this.options.administration?.ledger; const profiles = this.options.profiles;
    if (!ledger || !profiles) throw new RemoteApiError(404, 'not_found');
    ledger.permits(context, 'profiles:write');
    const input = validateProfileUpdate(payload);
    this.resources.assertAgent(context.principal, input.agentId);
    const receipt = await ledger.execute(context, 'profile:update', 'profiles:write', input, () => {
      const execute = async () => { this.resources.assertAgent(context.principal, input.agentId); return profiles.update(input); };
      return this.options.activity ? this.options.activity.use(execute) : execute();
    });
    this.resources.assertAgent(context.principal, input.agentId);
    return { ...receipt.value, replayed: receipt.replayed };
  }

  async saveWorkspaceFile(context: RemoteCommandContext, payload: unknown) {
    const ledger = this.options.administration?.ledger; const workbench = this.options.workbench;
    if (!ledger || !workbench) throw new RemoteApiError(404, 'not_found');
    ledger.permits(context, 'workspace:read'); ledger.permits(context, 'workspace:write');
    const input = validateFileSave(payload);
    this.resources.assertSelection(context.principal, input);
    const receipt = await ledger.execute(context, 'workspace:save', 'workspace:write', input, () => {
      const execute = () => workbench.save(input, () => { ledger.permits(context, 'workspace:read'); ledger.permits(context, 'workspace:write'); this.resources.assertSelection(context.principal, input); });
      return this.options.activity ? this.options.activity.use(execute) : execute();
    });
    this.resources.assertSelection(context.principal, input);
    return { ...receipt.value, replayed: receipt.replayed };
  }

  async queryProjects(context: RemoteCommandContext, payload: unknown): Promise<ProjectWorkspaceQueryResult> {
    const ledger = this.options.administration?.ledger; const projects = this.options.projects;
    if (!ledger || !projects) throw new RemoteApiError(404, 'not_found');
    ledger.permits(context, 'workspace:read');
    if (!validProjectWorkspaceQuery(payload)) throw new RemoteApiError(400, 'invalid_payload');
    const checkResources = () => { if (payload.operation !== 'directory') this.resources.assertWorkspace(context.principal, payload.workspaceId); };
    checkResources();
    try {
      if (payload.operation === 'run-results') {
        const workspace = await projects.overview(payload.workspaceId);
        if (!this.options.runInspection) throw new RemoteApiError(404, 'not_found');
        const runResults = this.options.runInspection.projectRuns(workspace.repositoryId, payload.cursor, (id) => this.resources.run(context.principal, id));
        ledger.permits(context, 'workspace:read'); checkResources();
        return { runResults: { ...runResults, runs: runResults.runs.filter((run) => this.resources.run(context.principal, run.id)) } };
      }
      if (payload.operation === 'publish-status' || payload.operation === 'publish-preview') {
        const publisher = this.options.projectPublish; if (!publisher) throw new RemoteApiError(404, 'not_found');
        const authorize = () => { ledger.permits(context, 'workspace:read');
          if (payload.operation === 'publish-preview') { ledger.permits(context, 'projects:write'); ledger.permits(context, 'projectGit:publish'); } };
        authorize(); const result = payload.operation === 'publish-status' ? { publish: await publisher.status(payload.workspaceId, payload.remote) }
          : { publishPreview: await publisher.preview(payload.workspaceId, payload.action, context.principal.id) };
        authorize(); checkResources(); return result;
      }
      const branches = this.options.projectBranches;
      const git = this.options.projectGit;
      if (payload.operation.startsWith('git') && !git) throw new RemoteApiError(404, 'not_found');
      if ((payload.operation === 'branches' || payload.operation === 'branch-preview') && !branches) throw new RemoteApiError(404, 'not_found');
      if (payload.operation === 'branch-preview' || payload.operation === 'git-preview') { ledger.permits(context, 'projectGit:write'); ledger.permits(context, 'projects:write'); }
      const result = payload.operation === 'directory' ? { directory: await projects.directory() }
        : payload.operation === 'git' ? { git: await git!.overview(payload.workspaceId) }
          : payload.operation === 'git-diff' ? { gitDiff: await git!.diff(payload.workspaceId, payload.path) }
            : payload.operation === 'git-preview' ? { gitPreview: await git!.preview(payload.workspaceId, payload.action, context.principal.id) }
        : payload.operation === 'branches' ? { branches: await branches!.overview(payload.workspaceId) }
          : payload.operation === 'branch-preview' ? { preview: await branches!.preview(payload.workspaceId, payload.action, context.principal.id) }
            : { workspace: await projects.overview(payload.workspaceId) };
      if (payload.operation === 'branch-preview' || payload.operation === 'git-preview') { ledger.permits(context, 'projectGit:write'); ledger.permits(context, 'projects:write'); }
      ledger.permits(context, 'workspace:read'); checkResources();
      if (result.directory && this.resources.access(context.principal).mode === 'selected') {
        result.directory.entries = result.directory.entries.filter((entry) => !!entry.repositoryId && this.resources.repository(context.principal, entry.repositoryId));
        result.directory.notice = 'Es werden nur die am PC für dieses Gerät ausgewählten Projekte angezeigt.';
      }
      return result;
    } catch (error) { if (error instanceof RemoteApiError) throw error; throw new RemoteApiError(422, 'command_rejected', redactedWireMessage(error)); }
  }

  async commandProject(context: RemoteCommandContext, payload: unknown): Promise<ProjectWorkspaceCommandResult> {
    const ledger = this.options.administration?.ledger; const projects = this.options.projects;
    if (!ledger || !projects) throw new RemoteApiError(404, 'not_found');
    if (!validProjectWorkspaceCommand(payload)) throw new RemoteApiError(400, 'invalid_payload');
    const targets: Array<{ repositoryId?: string; workspaceId?: string }> = [];
    const resources: ProjectAuthorization = (target) => {
      if (target) targets.push(target);
      for (const item of targets) {
        if (item.repositoryId) this.resources.assertRepository(context.principal, item.repositoryId);
        if (item.workspaceId) this.resources.assertWorkspace(context.principal, item.workspaceId);
      }
    };
    if (payload.operation === 'publish-apply') {
      const publisher = this.options.projectPublish; if (!publisher) throw new RemoteApiError(404, 'not_found');
      const authorize: ProjectAuthorization = (target) => { ledger.permits(context, 'workspace:read'); ledger.permits(context, 'projects:write'); ledger.permits(context, 'projectGit:publish'); resources(target); };
      authorize(); const result = await ledger.execute(context, 'project:publish-apply', 'projectGit:publish', payload, () => {
        const execute = () => publisher.apply(payload.previewId, context.principal.id, authorize);
        return this.options.activity ? this.options.activity.use(execute) : execute();
      });
      authorize({ workspaceId: result.value.workspace.id }); return { ...result.value, replayed: result.replayed };
    }
    const authorize: ProjectAuthorization = (target) => { ledger.permits(context, 'workspace:read'); ledger.permits(context, 'projects:write');
      if (payload.operation !== 'open') ledger.permits(context, 'projectGit:write'); resources(target); };
    authorize();
    if (payload.operation === 'branch-apply' && !this.options.projectBranches) throw new RemoteApiError(404, 'not_found');
    if (payload.operation === 'git-apply' && !this.options.projectGit) throw new RemoteApiError(404, 'not_found');
    const result = await ledger.execute(context, `project:${payload.operation}`, payload.operation !== 'open' ? 'projectGit:write' : 'projects:write', payload, () => {
      const execute = async () => ({ workspace: payload.operation === 'open' ? await projects.open(payload.entryId, authorize)
        : payload.operation === 'git-apply' ? (await this.options.projectGit!.apply(payload.previewId, context.principal.id, authorize)).workspace
        : await this.options.projectBranches!.apply(payload.previewId, context.principal.id, authorize) });
      return this.options.activity ? this.options.activity.use(execute) : execute();
    });
    authorize({ workspaceId: result.value.workspace.id });
    const git = payload.operation === 'git-apply' ? await this.options.projectGit!.overview(result.value.workspace.id) : undefined;
    authorize(); return { ...result.value, ...(git ? { workspace: git.workspace, git } : {}), replayed: result.replayed };
  }

  async remoteTerminal(context: RemoteCommandContext, payload: unknown, kind: 'query' | 'command' | 'input') {
    const ledger = this.options.administration?.ledger; const terminals = this.options.terminals;
    if (!ledger || !terminals) throw new RemoteApiError(404, 'not_found');
    ledger.permits(context, 'terminal:control');
    const input = validateTerminal(payload, kind);
    this.resources.assertSelection(context.principal, input);
    try {
      if (kind === 'query') return await terminals.query(context.principal.id, input as MobileTerminalQuery);
      if (kind === 'input') return await terminals.input(context, input as MobileTerminalInput);
      const command = input as MobileTerminalCommand;
      const result = await ledger.execute(context, `terminal:${command.operation}`, 'terminal:control', command, () => {
        const execute = () => terminals.command(context.principal.id, command);
        return this.options.activity ? this.options.activity.use(execute) : execute();
      });
      return { ...result.value, replayed: result.replayed };
    } catch (error) {
      if (error instanceof RemoteApiError) throw error;
      throw new RemoteApiError(422, 'command_rejected', redactedWireMessage(error));
    }
  }

  async remoteSessionInventory(principal: RemotePrincipal) {
    const ledger = this.options.administration?.ledger; const terminals = this.options.terminals;
    if (!ledger || !terminals) throw new RemoteApiError(404, 'not_found');
    ledger.permits({ principal, idempotencyKey: undefined, requestId: 'terminal-inventory' }, 'terminal:control');
    try { return await terminals.inventory(principal.id); }
    catch (error) { if (error instanceof RemoteApiError) throw error; throw new RemoteApiError(422, 'command_rejected', redactedWireMessage(error)); }
  }

  async inspectRun(principal: RemotePrincipal, runId: string, taskId?: string): Promise<MobileRunActivity> {
    const authorize = this.inspectionAuthorization(principal, runId);
    const run = this.runs().find((item) => item.id === runId); if (!run) throw new RemoteApiError(404, 'not_found');
    const tasks = this.options.runInspection!.activity(runId, taskId); authorize();
    return { run, tasks, checkedAt: Date.now() };
  }

  async runFiles(principal: RemotePrincipal, runId: string, taskId?: string) {
    const authorize = this.inspectionAuthorization(principal, runId);
    return this.options.runInspection!.files(runId, taskId, authorize);
  }

  async runFile(principal: RemotePrincipal, runId: string, taskId: string, fileId: string) {
    const authorize = this.inspectionAuthorization(principal, runId);
    return this.options.runInspection!.file(runId, taskId, fileId, authorize);
  }

  private inspectionAuthorization(principal: RemotePrincipal, runId: string): () => void {
    const ledger = this.options.administration?.ledger;
    if (!ledger || !this.options.runInspection) throw new RemoteApiError(404, 'not_found');
    const authorize = () => { ledger.permits({ principal, requestId: 'run-inspection', idempotencyKey: undefined }, 'workspace:read'); this.resources.assertRun(principal, runId); };
    authorize(); return authorize;
  }

  async queryWorkspace(context: RemoteCommandContext, payload: unknown) {
    const ledger = this.options.administration?.ledger;
    if (!ledger || !this.options.workbench) throw new RemoteApiError(404, 'not_found');
    ledger.permits(context, 'workspace:read');
    const input = validateWorkbenchQuery(payload);
    this.resources.assertSelection(context.principal, input);
    try {
      const result = await this.options.workbench.query(input);
      ledger.permits(context, 'workspace:read');
      this.resources.assertSelection(context.principal, input);
      return result;
    } catch (error) {
      if (error instanceof RemoteApiError) throw error;
      throw new RemoteApiError(422, 'command_rejected', redactedWireMessage(error));
    }
  }

  health(): MobileHealth {
    return {
      apiVersion: 1,
      status: 'ready',
      queue: { ...this.queuePort.status() },
      commands: this.commands && this.commandsEnabled() ? 'enabled' : 'disabled',
    };
  }

  hostState(principal: RemotePrincipal): MobileHostState {
    const admin = this.options.administration;
    if (!admin) throw new RemoteApiError(404, 'not_found');
    let canRestart = false;
    try { admin.ledger.permits({ principal, idempotencyKey: undefined, requestId: 'host-state' }, 'host:restart'); canRestart = true; }
    catch { /* Existing devices can inspect availability without gaining privileges. */ }
    return { ...admin.restart.state(canRestart), resourceSelection: this.resources.access(principal).mode, capabilities: REMOTE_ADMIN_SCOPES.filter((scope) => {
      try { admin.ledger.permits({ principal, idempotencyKey: undefined, requestId: 'host-state' }, scope); return true; } catch { return false; }
    }) };
  }

  async restartHost(context: RemoteCommandContext, payload: unknown): Promise<MobileRestartResult> {
    const admin = this.options.administration;
    if (!admin) throw new RemoteApiError(404, 'not_found');
    admin.ledger.permits(context, 'host:restart');
    const input = requireRecord(payload, 'request'); requireKeys(input, ['instanceId'], 'request');
    const instanceId = requireId(input.instanceId, 'instanceId');
    let operationId: string | undefined;
    try {
      const receipt = await admin.ledger.execute(context, 'host:restart', 'host:restart', { instanceId }, () => {
        const result = admin.restart.reserve(instanceId); operationId = result.operationId; return result;
      });
      if (!receipt.replayed) admin.restart.commit(receipt.value.operationId, () => {
        try { admin.ledger.permits(context, 'host:restart'); return true; } catch { return false; }
      });
      return { ...receipt.value, replayed: receipt.replayed };
    } catch (error) { if (operationId) admin.restart.cancel(operationId); throw error; }
  }

  async administer(context: RemoteCommandContext, payload: unknown): Promise<MobileAdministrationResult> {
    const admin = this.options.administration;
    if (!admin) throw new RemoteApiError(404, 'not_found');
    const command = validateAdministration(payload);
    // Catalog creation and cross-agent repository synchronization require the full catalog.
    const authorizeResources = () => {
      if (command.operation === 'workspace-prepare') this.resources.assertSelection(context.principal, command.input);
      else this.resources.assertAll(context.principal);
    };
    authorizeResources();
    const scope = command.operation.startsWith('git-') ? 'repositories:write' : 'catalog:write';
    const receipt = await admin.ledger.execute(context, `admin:${command.operation}`, scope, command, () => {
      const execute = async () => {
        authorizeResources();
        if (command.operation === 'git-fetch') {
          this.requireNativeRemoteRepository(command.input.repositoryId);
          if (!admin.git) throw new RemoteApiError(404, 'not_found');
          return { git: projectGit(await admin.git.fetch(command.input.repositoryId)) };
        }
        if (command.operation === 'git-apply') {
          const owner = this.gitPreviewOwners.get(command.input.previewId);
          if (!admin.git || !owner || owner.deviceId !== context.principal.id || owner.expiresAt < Date.now()) {
            throw new RemoteApiError(409, 'command_rejected', 'Git-Vorschau abgelaufen oder für ein anderes Gerät erstellt. Erneut prüfen.');
          }
          this.gitPreviewOwners.delete(command.input.previewId);
          return { git: projectGit(await admin.git.apply(command.input.previewId)) };
        }
        if (!admin.workspaces) throw new RemoteApiError(404, 'not_found');
        return admin.workspaces.execute(command, () => { admin.ledger.permits(context, scope); authorizeResources(); });
      };
      return this.options.activity ? this.options.activity.use(execute) : execute();
    });
    admin.ledger.permits(context, scope);
    authorizeResources();
    return { ...receipt.value, replayed: receipt.replayed };
  }

  async queryGit(context: RemoteCommandContext, payload: unknown): Promise<MobileGitResult> {
    const admin = this.options.administration;
    if (!admin?.git) throw new RemoteApiError(404, 'not_found');
    if (context.principal.kind !== 'device' || context.principal.proof !== 'device-signature'
      || !context.principal.scopes.has('read')) throw new RemoteApiError(401, 'device_proof_required');
    this.resources.assertAll(context.principal);
    const request = requireRecord(payload, 'request');
    requireKeys(request, ['operation', 'repositoryId', 'sourceRef', 'targetId'], 'request');
    const repositoryId = requireId(request.repositoryId, 'repositoryId'); this.requireNativeRemoteRepository(repositoryId);
    const sourceRef = request.sourceRef === undefined ? undefined : requireText(request.sourceRef, 'sourceRef', 300);
    if (sourceRef !== undefined && !validSyncRef(sourceRef)) invalidPayload('sourceRef is invalid');
    if (request.operation === 'git-overview') {
      if (request.targetId !== undefined) invalidPayload('targetId is not accepted for an overview');
      const overview = projectGit(await admin.git.overview({ repositoryId, sourceRef }));
      this.resources.assertAll(context.principal); return { overview };
    }
    if (request.operation !== 'git-preview') invalidPayload('unknown query operation');
    admin.ledger.permits(context, 'repositories:write');
    const preview = await admin.git.preview({ repositoryId, sourceRef, targetId: requireId(request.targetId, 'targetId') });
    for (const [id, owner] of this.gitPreviewOwners) if (owner.expiresAt < Date.now()) this.gitPreviewOwners.delete(id);
    if (this.gitPreviewOwners.size >= 20) this.gitPreviewOwners.delete(this.gitPreviewOwners.keys().next().value!);
    this.gitPreviewOwners.set(preview.id, { deviceId: context.principal.id, expiresAt: preview.expiresAt });
    const overview = projectGit(preview.overview);
    const projected: GitSyncPreview = { id: preview.id, expiresAt: preview.expiresAt, overview, target: overview.targets.find((target) => target.id === preview.target.id)! };
    this.resources.assertAll(context.principal); return { overview, preview: projected };
  }

  private requireNativeRemoteRepository(repositoryId: string): void {
    if (!this.store.get().repositories.some((repo) => repo.id === repositoryId && repo.executionBackend === 'native')) {
      throw new RemoteApiError(422, 'command_rejected', 'Dieser Remote-Workflow benötigt ein natives Projekt aus dem Katalog.');
    }
  }

  catalog(principal?: RemotePrincipal): MobileCatalog {
    const config = this.store.get();
    return this.resources.catalog(principal, {
      projectStart: { configured: !!config.settings.projectDefaults,
        ...(config.settings.projectDefaults?.agentId ? { agentId: config.settings.projectDefaults.agentId } : {}) },
      categories: config.categories.map((category) => ({ id: category.id, name: redactForWire(category.name, 160) })),
      agentSources: [
        { id: 'codex', kind: 'runtime' as const, name: 'Codex · neues Standardprofil', runtime: 'codex' as const },
        ...config.agents.map((agent) => ({ id: agent.id, kind: 'agent' as const, name: redactForWire(agent.name, 160), runtime: agent.runtime })),
        ...config.agentTemplates.map((template) => ({ id: template.id, kind: 'template' as const, name: redactForWire(template.name, 160), runtime: template.runtime })),
      ],
      repositories: config.repositories.map((repository) => ({
        id: repository.id,
        name: redactForWire(repository.name, 160),
        executionBackend: repository.executionBackend,
        verified: repository.verified,
      })),
      agents: config.agents.map((agent) => ({
        id: agent.id,
        name: redactForWire(agent.name, 160),
        ...(agent.role ? { role: redactForWire(agent.role, 160) } : {}),
        runtime: agent.runtime,
        dashboard: mobileDashboard(agent),
        ...(agent.photo ? { photoVersion: createHash('sha256').update(agent.photo).digest('hex') } : {}),
        ...(agent.defaultRepositoryId ? { defaultRepositoryId: agent.defaultRepositoryId } : {}),
        ...(agent.homeExecutionBackend
          ? { homeExecutionBackend: agent.homeExecutionBackend }
          : {}),
      })),
    });
  }

  runs(runId?: string, principal?: RemotePrincipal): RunSummary[] {
    return this.runsPort.summarize(runId).filter((run) => this.resources.run(principal, run.id));
  }

  /** Current journal cursor plus every run summary, for stream (re)connects. */
  snapshot(principal?: RemotePrincipal): MobileSnapshot {
    return { cursor: this.runsPort.journalCursor(), runs: this.runs(undefined, principal) };
  }

  journalCursor(): number {
    return this.runsPort.journalCursor();
  }

  /** A client behind this cursor has missed records that were archived/deleted. */
  journalFloor(): number { return this.store.get().journalRetention.prunedSeq; }

  /**
   * Sanitized journal window after `sinceSeq`. Records keep their seq so the
   * stream stays strictly monotonic across reconnects; the page cursor is the
   * highest seq included, or `sinceSeq` when nothing is newer.
   */
  events(sinceSeq: number, limit = MAX_EVENT_PAGE, principal?: RemotePrincipal): MobileJournalPage {
    if (!Number.isSafeInteger(sinceSeq) || sinceSeq < 0) {
      throw new RemoteApiError(400, 'invalid_payload', 'cursor must be a non-negative integer');
    }
    const page = this.runsPort.eventsSince(sinceSeq, Math.max(1, Math.min(MAX_EVENT_PAGE, limit)));
    return {
      events: page.events.filter((item) => this.resources.run(principal, item.runId)).map(projectEvent),
      messages: page.messages.filter((item) => this.resources.run(principal, item.runId)).map(projectMessage),
      cursor: page.nextCursor,
    };
  }

  subscribe(listener: () => void): () => void {
    if (!this.changes) return () => undefined;
    return this.changes.subscribe(listener);
  }

  /** Bounded diagnostic ring (newest last); production also supplies the durable device-store sink. */
  auditTrail(): RemoteAuditEntry[] {
    return this.auditRing.map((entry) => ({ ...entry }));
  }

  /* --------------------------------------------------------------- commands */

  runQuestions(principal: RemotePrincipal, runId: string) {
    const ledger = this.options.administration?.ledger; const questions = this.options.questions;
    if (!ledger || !questions) throw new RemoteApiError(404, 'not_found');
    ledger.permits({ principal, requestId: 'run-questions', idempotencyKey: undefined }, 'workspace:read');
    this.resources.assertRun(principal, runId);
    return questions.view(runId);
  }

  answerRunQuestion(context: RemoteCommandContext, runId: string, payload: unknown): Promise<MobileCommandResult> {
    return this.command(IPC.RunAnswer, context, { runId, answer: payload }, runId, async (commandId) => {
      if (!this.options.questions) throw new RemoteApiError(404, 'not_found');
      const request = requireRecord(payload, 'request'); requireKeys(request, ['taskId', 'questionId', 'answers'], 'request');
      if (!validQuestionAnswers(request.answers)) invalidPayload('invalid question answers');
      const input: RunQuestionAnswerInput = { runId, taskId: requireId(request.taskId, 'taskId'),
        questionId: requireId(request.questionId, 'questionId'), answers: request.answers, commandId };
      assertIpcPayload(IPC.RunAnswer, input);
      await this.options.questions.answer(input); return { runId };
    });
  }

  createRun(context: RemoteCommandContext, payload: unknown): Promise<MobileCommandResult> {
    return this.command(IPC.RunCreate, context, payload, null, async (commandId, commands) => {
      const input = toRunCreateInput(validateRemoteRunCreate(payload), commandId);
      assertIpcPayload(IPC.RunCreate, input);
      const run = commands.createRun(input);
      return { runId: run.id };
    });
  }

  startRun(context: RemoteCommandContext, runId: string): Promise<MobileCommandResult> {
    return this.command(IPC.RunStart, context, { runId }, runId, async (commandId, commands) => {
      assertIpcPayload(IPC.RunStart, { runId, commandId });
      const run = await commands.startRun(runId, commandId);
      return { runId: run.id };
    });
  }

  cancelRun(context: RemoteCommandContext, runId: string): Promise<MobileCommandResult> {
    return this.command(IPC.RunCancel, context, { runId }, runId, async (commandId, commands) => {
      assertIpcPayload(IPC.RunCancel, { runId, commandId });
      await commands.cancelRun(runId, commandId);
      return { runId };
    });
  }

  /**
   * One bounded task for an explicit agent/repository pair. The response is
   * the wrapping run's summary plus the task id; progress arrives through the
   * journal stream like every other task.
   */
  submitTask(context: RemoteCommandContext, payload: unknown): Promise<MobileCommandResult> {
    return this.command(IPC.RunTaskSubmit, context, payload, null, async (commandId, commands) => {
      const input: RunTaskSubmitInput = { ...validateRemoteTaskSubmit(payload), commandId };
      assertIpcPayload(IPC.RunTaskSubmit, input);
      const submission = await commands.submitTask(input);
      return { runId: submission.run.id, taskId: submission.task.id };
    });
  }

  /**
   * Shared command pipeline: policy requirement → scope → idempotency key
   * binding → in-flight coalescing → execute → audit. `execute` returns the
   * run id whose summary becomes the response (plus the task id for a
   * single-task submission).
   */
  private async command(
    channel: InvokeChannel,
    context: RemoteCommandContext,
    payload: unknown,
    target: string | null,
    execute: (
      commandId: string,
      commands: ApplicationCommandPort,
    ) => Promise<{ runId: string; taskId?: string }>,
  ): Promise<MobileCommandResult> {
    const requirement = remoteRequirement(channel);
    const deny = (status: number, code: MobileErrorCode, reason: string): never => {
      this.audit(context, channel, target, 'denied', reason);
      throw new RemoteApiError(status, code, reason);
    };

    if (requirement.proof === 'device-signature' && context.principal.proof !== 'device-signature') {
      deny(401, 'device_proof_required', 'command requires a signed device proof');
    }
    if (!context.principal.scopes.has(requirement.scope)) {
      deny(403, 'scope_not_granted', `principal lacks the ${requirement.scope} scope`);
    }
    const commands = this.commands;
    if (!commands) deny(403, 'scope_not_granted', 'commands are not connected on this host');
    const key = context.idempotencyKey;
    if (requirement.idempotency === 'required') {
      if (key === undefined) deny(400, 'idempotency_key_required', 'Idempotency-Key header is required');
      if (!isValidIdempotencyKey(key!)) {
        deny(400, 'idempotency_key_invalid', 'Idempotency-Key must be 8-64 URL-safe ASCII characters');
      }
    }

    const authorizeResources = () => {
      if (target) this.resources.assertRun(context.principal, target);
      else if (channel === IPC.RunCreate) {
        const input = validateRemoteRunCreate(payload);
        this.resources.assertRepository(context.principal, input.repositoryId);
        for (const participant of input.participants) this.resources.assertAgent(context.principal, participant.agentId);
      } else if (channel === IPC.RunTaskSubmit) this.resources.assertSelection(context.principal, validateRemoteTaskSubmit(payload));
    };
    try { authorizeResources(); }
    catch (error) { this.audit(context, channel, target, error instanceof RemoteApiError && error.status === 403 ? 'denied' : 'rejected', redactedWireMessage(error)); throw error; }

    const keyPrefix = `${REMOTE_COMMAND_PREFIX}${key}:`;
    const commandId = `${keyPrefix}${fingerprint(channel, payload)}`;

    // A recorded outcome under this key with another fingerprint means the
    // client reused a key for a different command. Never execute, never replay.
    const recorded = this.store.get().commandLog.find((entry) => entry.commandId.startsWith(keyPrefix));
    if (recorded && recorded.commandId !== commandId) {
      deny(409, 'idempotency_key_reused', 'Idempotency-Key was already used with a different payload');
    }
    const running = this.inFlight.get(keyPrefix);
    if (running) {
      if (running.commandId !== commandId) {
        deny(409, 'idempotency_key_reused', 'Idempotency-Key is in flight with a different payload');
      }
      const result = await running.result;
      authorizeResources(); this.resources.assertRun(context.principal, result.run.id);
      this.audit(context, channel, target ?? result.run.id, 'replayed');
      return { ...result, replayed: true };
    }

    const replayed = recorded !== undefined;
    // Durable admission precedes domain side effects; a broken audit sink fails closed.
    this.audit(context, channel, target, 'requested');
    const execution = (async (): Promise<MobileCommandResult> => {
      let outcome: { runId: string; taskId?: string };
      try {
        authorizeResources();
        outcome = this.options.activity
          ? await this.options.activity.use(() => execute(commandId, commands!))
          : await execute(commandId, commands!);
      } catch (error) {
        if (error instanceof RemoteApiError) {
          this.audit(context, channel, target, 'rejected', error.message);
          throw error;
        }
        const detail = redactedWireMessage(error);
        if (detail.startsWith('ade: invalid IPC payload')) {
          this.audit(context, channel, target, 'rejected', detail);
          throw new RemoteApiError(400, 'invalid_payload', detail.replace(/^ade: invalid IPC payload for "[^"]*": /, ''));
        }
        if (detail.startsWith('ade:')) {
          this.audit(context, channel, target, 'rejected', detail);
          throw new RemoteApiError(422, 'command_rejected', detail.replace(/^ade: /, ''));
        }
        this.audit(context, channel, target, 'rejected', 'internal error');
        throw error;
      }
      const summary = this.runsPort.summarize(outcome.runId)[0];
      authorizeResources(); this.resources.assertRun(context.principal, outcome.runId);
      if (!summary) throw new Error('ade: command produced no run summary');
      this.audit(context, channel, outcome.taskId ?? outcome.runId, replayed ? 'replayed' : 'executed');
      return {
        run: summary,
        ...(outcome.taskId !== undefined ? { taskId: outcome.taskId } : {}),
        replayed,
      };
    })();
    this.inFlight.set(keyPrefix, { commandId, result: execution });
    try {
      return await execution;
    } finally {
      this.inFlight.delete(keyPrefix);
    }
  }

  private audit(
    context: RemoteCommandContext,
    channel: InvokeChannel,
    target: string | null,
    outcome: RemoteAuditEntry['outcome'],
    reason?: string,
  ): void {
    const entry: RemoteAuditEntry = {
      at: this.now(),
      principalId: context.principal.id,
      principalKind: context.principal.kind,
      requestId: context.requestId,
      channel,
      target,
      outcome,
      ...(reason ? { reason: redactForWire(reason) } : {}),
    };
    this.auditRing.push(entry);
    if (this.auditRing.length > AUDIT_RING_LIMIT) this.auditRing.splice(0, this.auditRing.length - AUDIT_RING_LIMIT);
    this.auditSink(entry);
  }
}

/* ----------------------------------------------------------------- helpers */

function remoteRequirement(channel: InvokeChannel): RemoteAccess {
  const policy = CHANNEL_POLICY[channel];
  if (policy.surface !== 'shared' || !policy.remote || !REMOTE_COMMAND_CHANNELS.includes(channel)) {
    // A programming error, not a client error: the adapter routed a channel
    // the policy does not allow remotely. Fail closed without detail.
    throw new Error(`ade: channel ${channel} is not a remote command`);
  }
  return policy.remote;
}

function fingerprint(channel: string, payload: unknown): string {
  return createHash('sha256')
    .update(channel)
    .update('\n')
    .update(stableJson(payload))
    .digest('hex')
    .slice(0, FINGERPRINT_CHARS);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
  return `{${entries.join(',')}}`;
}

function projectEvent(event: RunEvent): MobileJournalEvent {
  const data: Record<string, MobileJournalValue> = {};
  let hasData = false;
  for (const [key, value] of Object.entries(event.data ?? {})) {
    if (!WIRE_EVENT_DATA_KEYS.has(key)) continue;
    if (typeof value === 'string') data[key] = redactForWire(value);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) data[key] = value;
    else continue;
    hasData = true;
  }
  return {
    seq: event.seq,
    id: event.id,
    runId: event.runId,
    type: event.type,
    createdAt: event.createdAt,
    ...(event.taskId ? { taskId: event.taskId } : {}),
    ...(event.participantId ? { participantId: event.participantId } : {}),
    ...(hasData ? { data } : {}),
  };
}

function projectMessage(message: RunMessage): MobileJournalMessage {
  return {
    seq: message.seq,
    id: message.id,
    runId: message.runId,
    ...(message.taskId ? { taskId: message.taskId } : {}),
    ...(message.fromParticipantId ? { fromParticipantId: message.fromParticipantId } : {}),
    toParticipantId: message.toParticipantId,
    kind: message.kind,
    createdAt: message.createdAt,
  };
}

function invalidPayload(detail: string): never {
  throw new RemoteApiError(400, 'invalid_payload', detail);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalidPayload(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  const extra = Object.keys(value).find((key) => !allowedSet.has(key));
  if (extra) invalidPayload(`${label} contains unknown field "${redactForWire(extra, 40)}"`);
}

function requireText(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string') invalidPayload(`${label} must be a string`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    invalidPayload(`${label} contains control characters`);
  }
  if (!allowEmpty && value.trim().length === 0) invalidPayload(`${label} is required`);
  if (value.length > max) invalidPayload(`${label} exceeds ${max} characters`);
  return value;
}

/** Ids are opaque tokens, never paths: no slashes, backslashes or whitespace. */
function requireId(value: unknown, label: string): string {
  const text = requireText(value, label, MAX_REMOTE_ID_CHARS);
  if (!REMOTE_ID_PATTERN.test(text)) invalidPayload(`${label} must be an opaque identifier`);
  return text;
}

/** Narrow remote validation before the shared IPC validator and the domain run. */
export function validateRemoteRunCreate(payload: unknown): MobileRunCreateInput {
  const request = requireRecord(payload, 'request');
  requireKeys(request, ['name', 'goal', 'repositoryId', 'participants', 'budget', 'allowQuestions'], 'request');
  const name = requireText(request.name, 'name', MAX_REMOTE_NAME_CHARS);
  const goal = requireText(request.goal, 'goal', MAX_REMOTE_GOAL_CHARS);
  const repositoryId = requireId(request.repositoryId, 'repositoryId');
  if (!Array.isArray(request.participants)
      || request.participants.length < 1
      || request.participants.length > MAX_REMOTE_PARTICIPANTS) {
    invalidPayload(`participants must contain between 1 and ${MAX_REMOTE_PARTICIPANTS} entries`);
  }
  const participants = (request.participants as unknown[]).map((item, index) => {
    const label = `participants[${index}]`;
    const participant = requireRecord(item, label);
    requireKeys(participant, ['agentId', 'role', 'teamId', 'teamName'], label);
    const role = participant.role;
    if (typeof role !== 'string' || !(PARTICIPANT_ROLES as readonly string[]).includes(role)) {
      invalidPayload(`${label}.role is not supported`);
    }
    return {
      agentId: requireId(participant.agentId, `${label}.agentId`),
      role: role as MobileRunCreateInput['participants'][number]['role'],
      ...(participant.teamId !== undefined ? { teamId: requireId(participant.teamId, `${label}.teamId`) } : {}),
      ...(participant.teamName !== undefined
        ? { teamName: requireText(participant.teamName, `${label}.teamName`, MAX_REMOTE_TEAM_NAME_CHARS) }
        : {}),
    };
  });
  let budget: MobileRunCreateInput['budget'];
  if (request.budget !== undefined) {
    const record = requireRecord(request.budget, 'budget');
    requireKeys(record, BUDGET_KEYS, 'budget');
    budget = {};
    for (const key of BUDGET_KEYS) {
      const value = record[key];
      if (value === undefined) continue;
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
        invalidPayload(`budget.${key} must be null or a finite number`);
      }
      (budget as Record<string, number | null>)[key] = value as number | null;
    }
  }
  if (request.allowQuestions !== undefined && typeof request.allowQuestions !== 'boolean') invalidPayload('allowQuestions must be boolean');
  return { name, goal, repositoryId, participants, ...(budget ? { budget } : {}), ...(request.allowQuestions !== undefined ? { allowQuestions: request.allowQuestions as boolean } : {}) };
}

/**
 * Narrow remote validation for a single-task submission. Ids are opaque, the
 * prompt is bounded and control-character free, and no desktop-only field
 * (run id, participant id, workspace binding, commandId) is accepted.
 */
export function validateRemoteTaskSubmit(payload: unknown): MobileTaskSubmitInput {
  const request = requireRecord(payload, 'request');
  requireKeys(request, ['agentId', 'repositoryId', 'prompt', 'name', 'allowQuestions'], 'request');
  const agentId = requireId(request.agentId, 'agentId');
  const repositoryId = requireId(request.repositoryId, 'repositoryId');
  const prompt = requireText(request.prompt, 'prompt', MAX_REMOTE_PROMPT_CHARS);
  const name = request.name !== undefined
    ? requireText(request.name, 'name', MAX_REMOTE_NAME_CHARS)
    : undefined;
  if (request.allowQuestions !== undefined && typeof request.allowQuestions !== 'boolean') invalidPayload('allowQuestions must be boolean');
  return { agentId, repositoryId, prompt, ...(name !== undefined ? { name } : {}), ...(request.allowQuestions !== undefined ? { allowQuestions: request.allowQuestions as boolean } : {}) };
}

function toRunCreateInput(input: MobileRunCreateInput, commandId: string): RunCreateInput {
  return {
    name: input.name,
    goal: input.goal,
    allowQuestions: input.allowQuestions,
    repositoryId: input.repositoryId,
    participants: input.participants.map((participant) => ({
      agentId: participant.agentId,
      role: participant.role,
      ...(participant.teamId !== undefined ? { teamId: participant.teamId } : {}),
      ...(participant.teamName !== undefined ? { teamName: participant.teamName } : {}),
    })),
    ...(input.budget ? { budget: input.budget } : {}),
    commandId,
  };
}

export function validateAdministration(payload: unknown): MobileAdminCommand {
  const request = requireRecord(payload, 'request'); requireKeys(request, ['operation', 'input'], 'request');
  const input = requireRecord(request.input, 'input');
  switch (request.operation) {
    case 'agent-create': {
      requireKeys(input, ['name', 'source', 'categoryId'], 'input');
      const source = requireRecord(input.source, 'source'); requireKeys(source, ['kind', 'id'], 'source');
      if (source.kind !== 'agent' && source.kind !== 'template' && source.kind !== 'runtime') invalidPayload('invalid agent source');
      const id = requireId(source.id, 'source.id');
      if (source.kind === 'runtime' && id !== 'codex') invalidPayload('unsupported runtime profile');
      return { operation: 'agent-create', input: { name: requireText(input.name, 'name', 80), source: { kind: source.kind, id },
        ...(input.categoryId === undefined ? {} : { categoryId: requireId(input.categoryId, 'categoryId') }) } };
    }
    case 'project-create':
      requireKeys(input, ['name'], 'input');
      return { operation: 'project-create', input: { name: requireText(input.name, 'name', 80) } };
    case 'workspace-prepare':
      requireKeys(input, ['agentId', 'repositoryId'], 'input');
      return { operation: 'workspace-prepare', input: { agentId: requireId(input.agentId, 'agentId'), repositoryId: requireId(input.repositoryId, 'repositoryId') } };
    case 'git-fetch':
      requireKeys(input, ['repositoryId'], 'input');
      return { operation: 'git-fetch', input: { repositoryId: requireId(input.repositoryId, 'repositoryId') } };
    case 'git-apply':
      requireKeys(input, ['previewId'], 'input');
      return { operation: 'git-apply', input: { previewId: requireId(input.previewId, 'previewId') } };
    default: return invalidPayload('unsupported administration operation');
  }
}

function projectGit(overview: GitSyncOverview): GitSyncOverview {
  return { ...overview, repositoryName: redactForWire(overview.repositoryName, 160),
    sourceRef: redactForWire(overview.sourceRef, 300), refs: overview.refs.slice(0, 100).map((item) => ({
      ref: redactForWire(item.ref, 300), label: redactForWire(item.label, 320),
    })), targets: overview.targets.slice(0, 201).map((item) => ({ ...item, name: redactForWire(item.name, 160),
      branch: redactForWire(item.branch, 300), blockedReason: item.blockedReason === null ? null : redactForWire(item.blockedReason, 500) })) };
}
