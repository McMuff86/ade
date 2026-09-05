import { createHash } from 'node:crypto';
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
  outcome: 'executed' | 'replayed' | 'denied' | 'rejected';
  /** Redacted, bounded reason for denied/rejected outcomes. */
  reason?: string;
}

export interface ApplicationOptions {
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
  'fromSha', 'toSha', 'preparedBaseSha',
]);

/**
 * Transport-neutral, mobile-safe boundary shared by Electron IPC and the
 * bounded Goal 7 HTTP adapter. Reads project sanitized DTOs; commands enforce
 * the channel's remote requirement, bind the idempotency key to the exact
 * payload and audit every attempt. It never returns AdeConfig directly.
 */
export class AdeApplicationService {
  private readonly commands: ApplicationCommandPort | null;
  private readonly changes: ApplicationChangeSource | null;
  private readonly commandsEnabled: () => boolean;
  private readonly auditSink: (entry: RemoteAuditEntry) => void;
  private readonly now: () => number;
  private readonly auditRing: RemoteAuditEntry[] = [];
  /** Same-key requests that arrive while the first is still executing. */
  private readonly inFlight = new Map<string, { commandId: string; result: Promise<MobileCommandResult> }>();

  constructor(
    private readonly store: ApplicationConfigPort,
    private readonly runsPort: ApplicationRunPort,
    private readonly queuePort: ApplicationQueuePort,
    options: ApplicationOptions = {},
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

  health(): MobileHealth {
    return {
      apiVersion: 1,
      status: 'ready',
      queue: { ...this.queuePort.status() },
      commands: this.commands && this.commandsEnabled() ? 'enabled' : 'disabled',
    };
  }

  catalog(): MobileCatalog {
    const config = this.store.get();
    return {
      repositories: config.repositories.map((repository) => ({
        id: repository.id,
        name: repository.name,
        executionBackend: repository.executionBackend,
        verified: repository.verified,
      })),
      agents: config.agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        ...(agent.role ? { role: agent.role } : {}),
        runtime: agent.runtime,
        ...(agent.defaultRepositoryId ? { defaultRepositoryId: agent.defaultRepositoryId } : {}),
        ...(agent.homeExecutionBackend
          ? { homeExecutionBackend: agent.homeExecutionBackend }
          : {}),
      })),
    };
  }

  runs(runId?: string): RunSummary[] {
    return this.runsPort.summarize(runId);
  }

  /** Current journal cursor plus every run summary, for stream (re)connects. */
  snapshot(): MobileSnapshot {
    return { cursor: this.runsPort.journalCursor(), runs: this.runsPort.summarize() };
  }

  journalCursor(): number {
    return this.runsPort.journalCursor();
  }

  /**
   * Sanitized journal window after `sinceSeq`. Records keep their seq so the
   * stream stays strictly monotonic across reconnects; the page cursor is the
   * highest seq included, or `sinceSeq` when nothing is newer.
   */
  events(sinceSeq: number, limit = MAX_EVENT_PAGE): MobileJournalPage {
    if (!Number.isSafeInteger(sinceSeq) || sinceSeq < 0) {
      throw new RemoteApiError(400, 'invalid_payload', 'cursor must be a non-negative integer');
    }
    const page = this.runsPort.eventsSince(sinceSeq, Math.max(1, Math.min(MAX_EVENT_PAGE, limit)));
    return {
      events: page.events.map(projectEvent),
      messages: page.messages.map(projectMessage),
      cursor: page.nextCursor,
    };
  }

  subscribe(listener: () => void): () => void {
    if (!this.changes) return () => undefined;
    return this.changes.subscribe(listener);
  }

  /** Bounded in-memory audit ring (newest last). Not durable yet — see STATUS. */
  auditTrail(): RemoteAuditEntry[] {
    return this.auditRing.map((entry) => ({ ...entry }));
  }

  /* --------------------------------------------------------------- commands */

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
      this.audit(context, channel, target ?? result.run.id, 'replayed');
      return { ...result, replayed: true };
    }

    const replayed = recorded !== undefined;
    const execution = (async (): Promise<MobileCommandResult> => {
      let outcome: { runId: string; taskId?: string };
      try {
        outcome = await execute(commandId, commands!);
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
  requireKeys(request, ['name', 'goal', 'repositoryId', 'participants', 'budget'], 'request');
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
  return { name, goal, repositoryId, participants, ...(budget ? { budget } : {}) };
}

/**
 * Narrow remote validation for a single-task submission. Ids are opaque, the
 * prompt is bounded and control-character free, and no desktop-only field
 * (run id, participant id, workspace binding, commandId) is accepted.
 */
export function validateRemoteTaskSubmit(payload: unknown): MobileTaskSubmitInput {
  const request = requireRecord(payload, 'request');
  requireKeys(request, ['agentId', 'repositoryId', 'prompt', 'name'], 'request');
  const agentId = requireId(request.agentId, 'agentId');
  const repositoryId = requireId(request.repositoryId, 'repositoryId');
  const prompt = requireText(request.prompt, 'prompt', MAX_REMOTE_PROMPT_CHARS);
  const name = request.name !== undefined
    ? requireText(request.name, 'name', MAX_REMOTE_NAME_CHARS)
    : undefined;
  return { agentId, repositoryId, prompt, ...(name !== undefined ? { name } : {}) };
}

function toRunCreateInput(input: MobileRunCreateInput, commandId: string): RunCreateInput {
  return {
    name: input.name,
    goal: input.goal,
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
