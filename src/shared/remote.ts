import type { ExecutionBackendId } from './executionBackends';
import type { RemoteAdminScope } from './remoteDevices';
import type { GitSyncOverview, GitSyncPreview } from './gitSync';
import type {
  RunBudget,
  RunEventType,
  RunMessage,
  RunParticipantRole,
  RunSummary,
  RuntimeId,
  TaskQueueStatus,
} from './types';

export interface MobileHealth {
  apiVersion: 1;
  status: 'ready';
  queue: TaskQueueStatus;
  /** Whether at least one device identity may sign commands on this host. */
  commands: 'enabled' | 'disabled';
}

export interface MobileHostState {
  instanceId: string;
  version: string;
  restart: 'ready' | 'pending';
  canRestart: boolean;
  blockers: string[];
  capabilities?: RemoteAdminScope[];
}
export interface MobileRestartInput { instanceId: string }
export interface MobileRestartResult {
  operationId: string;
  instanceId: string;
  accepted: true;
  replayed: boolean;
}

export interface MobilePairInput {
  challenge: string;
  deviceId: string;
  name: string;
  secret: string;
}

/** Cookie is HttpOnly; only its CSRF counterpart is returned to the browser. */
export interface MobileSessionInfo {
  deviceId: string;
  csrf: string;
  expiresAt: number;
}

export interface MobileRepositorySummary {
  id: string;
  name: string;
  executionBackend: ExecutionBackendId;
  verified: boolean;
}

export interface MobileAgentSummary {
  id: string;
  name: string;
  role?: string;
  runtime: RuntimeId;
  defaultRepositoryId?: string;
  homeExecutionBackend?: ExecutionBackendId;
  photoVersion?: string;
  dashboard?: { url?: string; notice?: string };
}
export interface MobileAgentProfile { agent: MobileAgentSummary; revision: string; photo?: { mime: 'image/png'; bytesBase64: string }; photoError?: string }
export interface MobileProfileUpdate { agentId: string; revision: string; name: string; role: string; photo?: { bytesBase64: string } | null }

export interface MobileCatalog {
  projectStart?: { configured: boolean; agentId?: string };
  repositories: MobileRepositorySummary[];
  agents: MobileAgentSummary[];
  categories?: Array<{ id: string; name: string }>;
  agentSources?: Array<{ id: string; kind: 'agent' | 'template' | 'runtime'; name: string; runtime: RuntimeId }>;
}

export interface MobileAgentCreateInput {
  name: string;
  source: { kind: 'agent' | 'template' | 'runtime'; id: string };
  categoryId?: string;
}
export interface MobileProjectCreateInput { name: string }
export interface MobileWorkspacePrepareInput { agentId: string; repositoryId: string }
export type MobileAdminCommand =
  | { operation: 'agent-create'; input: MobileAgentCreateInput }
  | { operation: 'project-create'; input: MobileProjectCreateInput }
  | { operation: 'workspace-prepare'; input: MobileWorkspacePrepareInput }
  | { operation: 'git-fetch'; input: { repositoryId: string } }
  | { operation: 'git-apply'; input: { previewId: string } };
export type MobileGitQuery = { operation: 'git-overview' | 'git-preview'; repositoryId: string; sourceRef?: string; targetId?: string };
export interface MobileAdministrationValue {
  created?: { kind: 'agent' | 'repository' | 'workspace'; id: string; agentId?: string; repositoryId?: string; branch?: string };
  git?: GitSyncOverview;
}
export interface MobileAdministrationResult extends MobileAdministrationValue { replayed: boolean }
export interface MobileGitResult { overview: GitSyncOverview; preview?: GitSyncPreview }

/** Directory/workspace projections never contain absolute host paths. */
export interface ProjectDirectoryEntry {
  id: string;
  name: string;
  repositoryId?: string;
  kind: 'repository' | 'folder' | 'unavailable';
  backend: string;
  source: 'root' | 'catalog';
  notice: string | null;
}
export interface ProjectDirectoryView {
  configured: boolean;
  entries: ProjectDirectoryEntry[];
  limited: boolean;
  notice: string | null;
}
export interface ProjectWorkspaceView {
  id: string;
  repositoryId: string;
  name: string;
  branch: string;
  kind: 'checkout' | 'worktree';
  backend: 'native';
}
export type ProjectWorkspaceQuery = { operation: 'directory' } | { operation: 'workspace' | 'branches'; workspaceId: string }
  | { operation: 'branch-preview'; workspaceId: string; action: import('./projectBranches').ProjectBranchAction };
export type ProjectWorkspaceCommand = { operation: 'open'; entryId: string } | { operation: 'branch-apply'; previewId: string };
export interface ProjectWorkspaceQueryResult { directory?: ProjectDirectoryView; workspace?: ProjectWorkspaceView;
  branches?: import('./projectBranches').ProjectBranchOverview; preview?: import('./projectBranches').ProjectBranchPreview }
export interface ProjectWorkspaceCommandResult { workspace: ProjectWorkspaceView; replayed: boolean }

/** null explicitly selects the agent home, regardless of its default project. */
export type MobileWorkspaceSelection =
  | { agentId: string; repositoryId: string | null; projectWorkspaceId?: never }
  | { projectWorkspaceId: string; agentId?: never; repositoryId?: never };
export type SessionLaunchChoice = { mode: 'shell' | 'agent' | 'codex' | 'claude' | 'grok' | 'hermes' } | { mode: 'ollama'; model: string };
export type SessionLaunchRequest = MobileWorkspaceSelection & SessionLaunchChoice & { expectedBranch?: string; profileId?: string };
export interface SessionLaunchOptions {
  environment: string;
  choices: Array<{ mode: SessionLaunchChoice['mode']; available: boolean; notice: string | null }>;
  models: string[];
  profiles?: Array<{ id: string; name: string; runtime: import('./types').RuntimeId }>;
}
export interface MobileTerminalSummary {
  program?: import('./types').SessionProgramState;
  id: string; title: string; status: 'running' | 'exited'; owner: 'desktop' | 'self' | 'other';
  launchMode?: SessionLaunchChoice['mode'];
  launchProfileId?: string;
  launchProfileName?: string;
  branch?: string;
}
export type MobileRecentSession = MobileTerminalSummary & MobileWorkspaceSelection & { createdAt: number; projectName?: string };
export interface MobileSessionInventory { sessions: MobileRecentSession[]; omitted: number }

/** Read-only observations, with output separate from the run summary. No PTY ids. */
export interface MobileRunActivity {
  run: MobileRunSummary; checkedAt: number; tasks: Array<{
    id: string; participantId: string; status: import('./types').RunTaskStatus;
    startedAt?: number; endedAt?: number; exitCode?: number;
    process: 'running' | 'exited' | 'unavailable'; lastOutputAt?: number; outputBytes?: number;
    activity: Array<{ kind: string; text: string }>; notice: string | null;
    output?: import('./types').RunTaskOutput; result?: import('./types').RunReportResult | null;
  }>;
}
export interface MobileRunFiles { files: Array<{ id: string; path: string; name: string; bytes: number; image: boolean }>; limited: boolean; notice: string | null }
export interface MobileTerminalState {
  launchOptions?: SessionLaunchOptions;
  terminals: MobileTerminalSummary[];
  selected?: MobileTerminalSummary;
  screen?: string;
  frame?: MobileTerminalFrame;
  cols?: number;
  rows?: number;
  leaseId?: string;
  lastSequence?: number;
  inputUncertain?: boolean;
}
/** Main-generated, redacted screen. Only allowlisted display sequences, never raw PTY output. */
export interface MobileTerminalFrame { revision: string; cols: number; rows: number; ansi: string }
export type MobileTerminalQuery = MobileWorkspaceSelection & { terminalId?: string; options?: true };
export type MobileTerminalCommand = MobileWorkspaceSelection & (
  | ({ operation: 'open'; expectedBranch?: string; profileId?: string } & SessionLaunchChoice)
  | { operation: 'claim' | 'release' | 'close'; terminalId: string }
);
export type MobileTerminalInput = MobileWorkspaceSelection & {
  terminalId: string; leaseId: string; sequence: number; data: string; cols: number; rows: number;
};
export type MobileWorkspaceOperation =
  | { operation: 'overview' }
  | { operation: 'tree'; path: string }
  | { operation: 'search'; search: string }
  | { operation: 'file'; path: string }
  | { operation: 'diff'; path: string; staged: boolean }
;
export type MobileWorkspaceQuery = MobileWorkspaceSelection & MobileWorkspaceOperation;
export interface MobileWorkspaceEntry { path: string; name: string; kind: 'file' | 'directory' }
export interface MobileWorkspaceFile {
  path: string; text: string; revision: string; editable: boolean; notice: string | null;
}
export type MobileFileSaveInput = MobileWorkspaceSelection & {
  path: string; workspaceVersion: string; revision: string; text: string;
}
export interface MobileFileSaveResult { saved: boolean; revision: string; replayed: boolean }
export interface MobileWorkspaceOverview {
  ready: boolean; branch: string; workspaceVersion: string; busy: boolean;
  changes: Array<{ path: string; state: string; staged: boolean; unstaged: boolean }>;
  commits: Array<{ sha: string; subject: string }>; notice: string | null;
}
export interface MobileWorkspaceResult {
  workspaceVersion: string;
  overview?: MobileWorkspaceOverview;
  entries?: MobileWorkspaceEntry[];
  limited?: boolean;
  file?: MobileWorkspaceFile;
  diff?: string;
}

export type MobileRunSummary = RunSummary;

/* ------------------------------------------------------------ journal feed */

/** Scalar journal detail values the wire may carry (after whitelist + redaction). */
export type MobileJournalValue = string | number | boolean | null;

/**
 * One journal event as the host API emits it. `data` contains only
 * whitelisted keys; free text passed the wire redaction funnel and is
 * bounded. Absolute host paths, PTY session ids and mailbox bodies never
 * appear.
 */
export interface MobileJournalEvent {
  seq: number;
  id: string;
  runId: string;
  type: RunEventType;
  createdAt: number;
  taskId?: string;
  participantId?: string;
  data?: Record<string, MobileJournalValue>;
}

/** Mailbox metadata without the message body. */
export interface MobileJournalMessage {
  seq: number;
  id: string;
  runId: string;
  taskId?: string;
  fromParticipantId?: string;
  toParticipantId: string;
  kind: RunMessage['kind'];
  createdAt: number;
}

/** A cursor-paged window of the journal; `cursor` is the highest seq included. */
export interface MobileJournalPage {
  events: MobileJournalEvent[];
  messages: MobileJournalMessage[];
  cursor: number;
}

/**
 * Bundled state a stream client receives on connect (no or unknown cursor)
 * so it never has to assemble the current picture from an unbounded backlog.
 */
export interface MobileSnapshot {
  cursor: number;
  runs: RunSummary[];
}

/* ---------------------------------------------------------------- commands */

/**
 * Bounded managed-run creation over the host API. Compared with the desktop
 * `RunCreateInput`, the remote shape requires an explicit repository, allows
 * no per-participant harness override, no worktree reset opt-in and no
 * caller-chosen commandId: the idempotency key header owns that.
 */
export interface MobileRunCreateInput {
  name: string;
  goal: string;
  repositoryId: string;
  participants: Array<{
    agentId: string;
    role: RunParticipantRole;
    teamId?: string;
    teamName?: string;
  }>;
  budget?: Partial<RunBudget>;
}

/**
 * Bounded single-task submission over the host API (`POST /api/v1/tasks`).
 * The caller chooses one agent and one repository from the catalog; ADE
 * creates the wrapping manual run, the participant and the task, and
 * launches the agent's one-shot task session. No run, participant, workspace
 * binding or commandId is accepted from the wire — the idempotency key owns
 * replay, and plain-workspace (no repository) submission is not offered.
 */
export interface MobileTaskSubmitInput {
  agentId: string;
  repositoryId: string;
  prompt: string;
  /** Optional run name; defaults to the task title derived from the prompt. */
  name?: string;
}

export interface MobileCommandResult {
  run: RunSummary;
  /** Present for a single-task submission: the id of the task inside `run.tasks`. */
  taskId?: string;
  /** True when the idempotency key replayed an already-recorded outcome. */
  replayed: boolean;
}

/** Stable, path-free error codes of the host API. */
export type MobileErrorCode =
  | 'unavailable'
  | 'invalid_host'
  | 'origin_not_allowed'
  | 'unauthorized'
  | 'pairing_expired'
  | 'csrf_required'
  | 'rate_limited'
  | 'device_proof_required'
  | 'unknown_device'
  | 'invalid_signature'
  | 'invalid_timestamp'
  | 'stale_timestamp'
  | 'scope_not_granted'
  | 'method_not_allowed'
  | 'not_acceptable'
  | 'invalid_request_target'
  | 'not_found'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'length_required'
  | 'invalid_payload'
  | 'idempotency_key_required'
  | 'idempotency_key_invalid'
  | 'idempotency_key_reused'
  | 'command_rejected'
  | 'command_uncertain'
  | 'host_busy'
  | 'host_changed'
  | 'too_many_streams'
  | 'response_too_large'
  | 'internal_error';

export interface MobileErrorBody {
  error: MobileErrorCode;
  /** Redacted, bounded human-readable detail; present for payload/command rejections only. */
  message?: string;
}
