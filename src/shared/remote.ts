import type { ExecutionBackendId } from './executionBackends';
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
}

export interface MobileCatalog {
  repositories: MobileRepositorySummary[];
  agents: MobileAgentSummary[];
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
  | 'too_many_streams'
  | 'response_too_large'
  | 'internal_error';

export interface MobileErrorBody {
  error: MobileErrorCode;
  /** Redacted, bounded human-readable detail; present for payload/command rejections only. */
  message?: string;
}
