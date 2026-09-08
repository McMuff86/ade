import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request, type IncomingMessage } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AdeApplicationService,
  JournalChangeHub,
  RemoteApiError,
  validateRemoteRunCreate,
  validateRemoteTaskSubmit,
  type RemoteAuditEntry,
} from '../src/main/application/AdeApplicationService';
import { OrchestrationService } from '../src/main/orchestration/OrchestrationService';
import { RunCoordinator } from '../src/main/orchestration/RunCoordinator';
import { RuntimeAdapterRegistry } from '../src/main/orchestration/runtimeAdapters';
import type { WorkspacePort } from '../src/main/orchestration/WorkspaceService';
import { HostApiServer } from '../src/main/remote/HostApiServer';
import { RemoteDeviceStore, type DeviceSecretProtection } from '../src/main/remote/RemoteDeviceStore';
import {
  BOOTSTRAP_PRINCIPAL,
  RemoteAuthorizer,
  parseCommandDevice,
  sha256Hex,
  signRequest,
  type RemoteDevice,
} from '../src/main/remote/authorization';
import { consumeHostApiConfig, parseHostApiConfig } from '../src/main/remote/hostApiConfig';
import type { MobileJournalPage, MobileSnapshot } from '../src/shared/remote';
import {
  DEFAULT_CONFIG,
  type AdeConfig,
  type Agent,
  type RunSummary,
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

function rejects(label: string, operation: () => unknown, message: RegExp): void {
  try {
    operation();
    check(label, false, 'operation unexpectedly succeeded');
  } catch (error) {
    check(label, message.test(error instanceof Error ? error.message : String(error)), error);
  }
}

async function waitFor(predicate: () => boolean, label: string, timeout = 4_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/* ------------------------------------------------------------- configuration */

const disabled = parseHostApiConfig({});
check('host API is disabled by default', disabled.enabled === false);

const token = 't'.repeat(32);
const deviceSecret = 'd'.repeat(40);
const enabled = parseHostApiConfig({
  ADE_HOST_API_ENABLED: '1',
  ADE_HOST_API_TOKEN: token,
  ADE_HOST_API_PORT: '4318',
});
check('explicit opt-in produces a loopback-only config without command devices',
  enabled.enabled === true
    && enabled.host === '127.0.0.1'
    && enabled.port === 4318
    && enabled.token === token
    && enabled.devices.length === 0);

const withDevice = parseHostApiConfig({
  ADE_HOST_API_ENABLED: '1',
  ADE_HOST_API_TOKEN: token,
  ADE_HOST_API_COMMAND_DEVICE: `phone-1:${deviceSecret}`,
});
check('a configured command device carries the write scope',
  withDevice.enabled
    && withDevice.devices.length === 1
    && withDevice.devices[0]?.id === 'phone-1'
    && withDevice.devices[0]?.scopes.includes('runs:write'));

const consumedEnv: Record<string, string | undefined> = {
  ADE_HOST_API_ENABLED: '1',
  ADE_HOST_API_TOKEN: token,
  ADE_HOST_API_COMMAND_DEVICE: `phone-1:${deviceSecret}`,
};
const consumed = consumeHostApiConfig(consumedEnv);
check('host API startup consumes token and device secret before child processes can inherit them',
  consumed.enabled
    && !('ADE_HOST_API_TOKEN' in consumedEnv)
    && !('ADE_HOST_API_COMMAND_DEVICE' in consumedEnv));

rejects(
  'enabled host API requires a strong token',
  () => parseHostApiConfig({ ADE_HOST_API_ENABLED: '1', ADE_HOST_API_TOKEN: 'short' }),
  /token/i,
);
rejects(
  'enabled host API accepts only bounded URL-safe ASCII token material',
  () => parseHostApiConfig({
    ADE_HOST_API_ENABLED: '1',
    ADE_HOST_API_TOKEN: ' '.repeat(32),
  }),
  /token/i,
);
rejects(
  'enabled host API rejects control characters in token material',
  () => parseHostApiConfig({
    ADE_HOST_API_ENABLED: '1',
    ADE_HOST_API_TOKEN: `${'t'.repeat(31)}\n`,
  }),
  /token/i,
);
rejects(
  'enabled host API rejects non-ASCII token material',
  () => parseHostApiConfig({
    ADE_HOST_API_ENABLED: '1',
    ADE_HOST_API_TOKEN: 'ü'.repeat(32),
  }),
  /token/i,
);
rejects(
  'enabled host API rejects oversized token material',
  () => parseHostApiConfig({
    ADE_HOST_API_ENABLED: '1',
    ADE_HOST_API_TOKEN: 't'.repeat(129),
  }),
  /token/i,
);
rejects(
  'enabled host API rejects invalid ports',
  () => parseHostApiConfig({
    ADE_HOST_API_ENABLED: '1',
    ADE_HOST_API_TOKEN: token,
    ADE_HOST_API_PORT: '70000',
  }),
  /port/i,
);
rejects(
  'command device requires the <id>:<secret> form',
  () => parseCommandDevice('phone-1'),
  /device/i,
);
rejects(
  'command device rejects a short secret',
  () => parseCommandDevice('phone-1:short'),
  /secret/i,
);
rejects(
  'command device rejects a path-like id',
  () => parseCommandDevice(`phones/one:${deviceSecret}`),
  /device id/i,
);
rejects(
  'command device secret must differ from the listener token',
  () => parseHostApiConfig({
    ADE_HOST_API_ENABLED: '1',
    ADE_HOST_API_TOKEN: token,
    ADE_HOST_API_COMMAND_DEVICE: `phone-1:${token}`,
  }),
  /differ/i,
);

/* ------------------------------------------------------------- authorization */

const device: RemoteDevice = { id: 'phone-1', secret: deviceSecret, scopes: ['read', 'runs:write'] };
let clock = 1_700_000_000_000;
const authorizer = new RemoteAuthorizer(token, [device], () => clock);
const signed = {
  method: 'POST',
  path: '/api/v1/runs',
  timestamp: String(clock),
  idempotencyKey: 'key-00000001',
  bodySha256: sha256Hex('{"name":"x"}'),
};
check('bearer authentication yields the read-only bootstrap principal',
  authorizer.authenticateBearer(`Bearer ${token}`) === BOOTSTRAP_PRINCIPAL
    && BOOTSTRAP_PRINCIPAL.scopes.has('read')
    && !BOOTSTRAP_PRINCIPAL.scopes.has('runs:write')
    && authorizer.authenticateBearer(`Bearer ${'x'.repeat(32)}`) === null
    && authorizer.authenticateBearer(undefined) === null);
const verdict = authorizer.verifyDeviceSignature('phone-1', signRequest(deviceSecret, signed), signed);
check('a valid device signature yields a device principal with the write scope',
  verdict.ok && verdict.principal.id === 'phone-1' && verdict.principal.scopes.has('runs:write')
    && verdict.principal.proof === 'device-signature');
check('an unknown device is refused even with a well-formed signature',
  !authorizer.verifyDeviceSignature('phone-9', signRequest(deviceSecret, signed), signed).ok
    && (authorizer.verifyDeviceSignature('phone-9', signRequest(deviceSecret, signed), signed) as { reason: string })
      .reason === 'unknown_device');
check('a signature from another secret is refused',
  (authorizer.verifyDeviceSignature('phone-1', signRequest('e'.repeat(40), signed), signed) as { reason: string })
    .reason === 'invalid_signature');
check('a signature over a different body is refused',
  (authorizer.verifyDeviceSignature('phone-1', signRequest(deviceSecret, signed), {
    ...signed, bodySha256: sha256Hex('{"name":"y"}'),
  }) as { reason: string }).reason === 'invalid_signature');
check('a signature over a different idempotency key is refused',
  (authorizer.verifyDeviceSignature('phone-1', signRequest(deviceSecret, signed), {
    ...signed, idempotencyKey: 'key-00000002',
  }) as { reason: string }).reason === 'invalid_signature');
const stale = { ...signed, timestamp: String(clock - 6 * 60_000) };
check('a timestamp outside the skew window is refused',
  (authorizer.verifyDeviceSignature('phone-1', signRequest(deviceSecret, stale), stale) as { reason: string })
    .reason === 'stale_timestamp');
const malformedTs = { ...signed, timestamp: 'now' };
check('a malformed timestamp is refused',
  (authorizer.verifyDeviceSignature('phone-1', signRequest(deviceSecret, malformedTs), malformedTs) as { reason: string })
    .reason === 'invalid_timestamp');
rejects('duplicate device ids are refused at construction',
  () => new RemoteAuthorizer(token, [device, device]), /duplicate/);

/* --------------------------------------------------------- remote validation */

const validCreate = {
  name: 'Mobile run',
  goal: 'Ship one bounded change',
  repositoryId: 'repo-1',
  participants: [
    { agentId: 'orchestrator', role: 'orchestrator' },
    { agentId: 'worker', role: 'worker', teamId: 'team', teamName: 'Team' },
  ],
  budget: { maxConcurrentTasks: 1, maxApprovals: 1 },
};
check('remote run creation accepts the documented bounded shape',
  validateRemoteRunCreate(validCreate).repositoryId === 'repo-1');
const remoteRejects = (label: string, payload: unknown, pattern: RegExp): void => {
  try {
    validateRemoteRunCreate(payload);
    check(label, false, 'accepted');
  } catch (error) {
    check(label, error instanceof RemoteApiError && error.status === 400 && pattern.test(error.message), error);
  }
};
remoteRejects('remote run creation refuses the desktop worktree reset opt-in',
  { ...validCreate, workspacePrepare: 'reset-to-base' }, /unknown field/);
remoteRejects('remote run creation refuses caller-chosen commandIds',
  { ...validCreate, commandId: 'mine' }, /unknown field/);
remoteRejects('remote run creation refuses per-participant harness overrides',
  { ...validCreate, participants: [{ agentId: 'a', role: 'orchestrator', runtime: 'codex' }] }, /unknown field/);
remoteRejects('remote run creation requires an explicit repository id',
  { ...validCreate, repositoryId: undefined }, /repositoryId/);
remoteRejects('remote run creation refuses a null repository (plain-workspace) scope',
  { ...validCreate, repositoryId: null }, /repositoryId/);
remoteRejects('remote run creation refuses path-like ids without echoing them',
  { ...validCreate, repositoryId: 'C:\\Users\\me\\repo' }, /^repositoryId must be an opaque identifier$/);
remoteRejects('remote run creation refuses POSIX path ids',
  { ...validCreate, participants: [{ agentId: '/home/me/agent', role: 'orchestrator' }] }, /opaque identifier/);
remoteRejects('remote run creation refuses control characters',
  { ...validCreate, name: 'x\u0007y' }, /control/);
remoteRejects('remote run creation requires a goal',
  { ...validCreate, goal: '   ' }, /goal is required/);
remoteRejects('remote run creation bounds the roster', {
  ...validCreate,
  participants: Array.from({ length: 33 }, (_, index) => ({ agentId: `a${index}`, role: 'worker' })),
}, /participants/);
remoteRejects('remote run creation refuses unknown budget fields',
  { ...validCreate, budget: { maxWorkers: 2 } }, /unknown field/);
remoteRejects('remote run creation refuses non-object bodies', [], /must be an object/);

const validSubmit = { agentId: 'worker', repositoryId: 'repo-1', prompt: 'Fix the flaky test\nand explain why.' };
check('remote task submission accepts agent, repository, a multi-line prompt and an optional name',
  validateRemoteTaskSubmit(validSubmit).agentId === 'worker'
    && validateRemoteTaskSubmit({ ...validSubmit, name: 'Quick fix' }).name === 'Quick fix'
    && validateRemoteTaskSubmit(validSubmit).name === undefined);
const submitRejects = (label: string, payload: unknown, pattern: RegExp): void => {
  try {
    validateRemoteTaskSubmit(payload);
    check(label, false, 'accepted');
  } catch (error) {
    check(label, error instanceof RemoteApiError && error.status === 400 && pattern.test(error.message), error);
  }
};
submitRejects('remote task submission refuses caller-chosen commandIds',
  { ...validSubmit, commandId: 'mine' }, /unknown field/);
submitRejects('remote task submission refuses run, participant and workspace binding fields',
  { ...validSubmit, runId: 'run-1' }, /unknown field/);
submitRejects('remote task submission requires an explicit repository id',
  { agentId: 'worker', prompt: 'x' }, /repositoryId/);
submitRejects('remote task submission refuses a null repository (plain-workspace) scope',
  { ...validSubmit, repositoryId: null }, /repositoryId/);
submitRejects('remote task submission refuses path-like agent ids without echoing them',
  { ...validSubmit, agentId: '/home/me/agent' }, /^agentId must be an opaque identifier$/);
submitRejects('remote task submission requires a prompt',
  { ...validSubmit, prompt: '   ' }, /prompt is required/);
submitRejects('remote task submission bounds the prompt',
  { ...validSubmit, prompt: 'x'.repeat(8_001) }, /prompt exceeds 8000/);
submitRejects('remote task submission refuses control characters in the prompt',
  { ...validSubmit, prompt: 'rm\u0000-rf' }, /control/);
submitRejects('remote task submission bounds the run name',
  { ...validSubmit, name: 'n'.repeat(81) }, /name exceeds/);

/* ------------------------------------------------------ static projections */

const config: AdeConfig = {
  ...structuredClone(DEFAULT_CONFIG),
  repositories: [{
    id: 'repo-1',
    name: 'ADE',
    rootPath: '/home/secret/projects/ade',
    commonGitDir: '/home/secret/projects/ade/.git',
    executionBackend: 'wsl:Ubuntu',
    verified: true,
    createdAt: 1,
  }],
  agents: [{
    id: 'agent-1',
    categoryId: 'category-1',
    name: 'Builder',
    role: 'Implementation',
    runtime: 'codex',
    permissionMode: 'bypass',
    customCommand: 'dangerous --token secret-value',
    workspaceDir: '/home/secret/workspace',
    homeWorkspaceDir: '/home/secret/home',
    homeExecutionBackend: 'wsl:Ubuntu',
    defaultRepositoryId: 'repo-1',
    memoryDir: '/home/secret/memory',
    dashboardUrl: 'https://dashboard.invalid/?token=secret-value',
  }],
};
const runSummary: RunSummary = {
  id: 'run-1',
  name: 'Safe run',
  goal: 'Implement a bounded feature',
  status: 'running',
  mode: 'managed',
  phase: 'working',
  repositoryId: 'repo-1',
  repositoryName: 'ADE',
  branch: 'ade/run-1',
  teams: [],
  participants: [],
  tasks: [],
  budget: { maxConcurrentTasks: 1, maxInputTokens: null, maxOutputTokens: null, maxCostUsd: null, maxApprovals: 1, maxTaskMinutes: null },
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, approvals: 0, unreportedCostTasks: 0 },
  pendingApprovalId: null,
  pausedTeamIds: [],
  createdAt: 1,
  updatedAt: 2,
  seqCursor: 7,
};
const staticRuns = {
  summarize: () => [runSummary],
  eventsSince: () => ({
    events: [{
      id: 'e1', runId: 'run-1', type: 'task.started' as const, createdAt: 3, taskId: 't1', participantId: 'p1', seq: 6,
      data: {
        sessionId: 'pty-1',
        workspaceDir: '/home/secret/workspace/.ade-worktrees/x',
        repositoryId: 'repo-1',
        error: 'worktree is not clean: C:\\Users\\me\\repo token=abcdef',
      },
    }],
    messages: [{
      id: 'm1', runId: 'run-1', toParticipantId: 'p1', fromParticipantId: 'p0', kind: 'assignment' as const,
      text: 'SECRET assignment text with /home/secret/path', createdAt: 4, seq: 7,
    }],
    nextCursor: 7,
  }),
  journalCursor: () => 7,
};
const application = new AdeApplicationService(
  { get: () => config },
  staticRuns,
  { status: () => ({ active: 1, queued: 2, maxActive: 4 }) },
);
const health = application.health();
check('application health reports API version, bounded queue state and disabled commands',
  health.apiVersion === 1
    && health.status === 'ready'
    && health.queue.active === 1
    && health.queue.queued === 2
    && health.queue.maxActive === 4
    && health.commands === 'disabled');
const catalog = application.catalog();
check('mobile catalog keeps stable repository and agent selection fields',
  catalog.repositories[0]?.id === 'repo-1'
    && catalog.repositories[0]?.name === 'ADE'
    && catalog.repositories[0]?.executionBackend === 'wsl:Ubuntu'
    && catalog.agents[0]?.id === 'agent-1'
    && catalog.agents[0]?.defaultRepositoryId === 'repo-1'
    && catalog.agents[0]?.runtime === 'codex');
const serializedCatalog = JSON.stringify(catalog);
check('mobile catalog excludes paths, commands, dashboard tokens and memory locations',
  !serializedCatalog.includes('/home/secret')
    && !serializedCatalog.includes('dangerous')
    && !serializedCatalog.includes('secret-value')
    && !serializedCatalog.includes('rootPath')
    && !serializedCatalog.includes('memoryDir'));
check('application run projection delegates to the sanitized summary contract',
  application.runs()[0]?.id === 'run-1'
    && application.runs()[0]?.seqCursor === 7);
const page = application.events(0);
const serializedPage = JSON.stringify(page);
check('journal projection whitelists event data and drops session ids and workspace paths',
  page.events[0]?.seq === 6
    && page.events[0]?.data?.repositoryId === 'repo-1'
    && !('sessionId' in (page.events[0]?.data ?? {}))
    && !('workspaceDir' in (page.events[0]?.data ?? {}))
    && !serializedPage.includes('/home/secret')
    && !serializedPage.includes('pty-1'));
check('journal projection redacts host paths and credentials inside free-text details',
  page.events[0]?.data?.error === 'worktree is not clean: [path] token=[credential]');
check('journal projection carries message metadata but never the mailbox body',
  page.messages[0]?.seq === 7
    && page.messages[0]?.kind === 'assignment'
    && !serializedPage.includes('SECRET assignment')
    && !('text' in (page.messages[0] ?? {})));
check('journal projection rejects negative cursors', (() => {
  try {
    application.events(-1);
    return false;
  } catch (error) {
    return error instanceof RemoteApiError && error.status === 400;
  }
})());

/* --------------------------------------------------------------- HTTP client */

interface HttpResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

interface HttpOptions {
  method?: string;
  token?: string;
  hostHeader?: string;
  origin?: string;
  headers?: Record<string, string>;
  body?: string;
}

function httpRequest(port: number, path: string, options: HttpOptions = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path,
      method: options.method ?? 'GET',
      headers: {
        host: options.hostHeader ?? `127.0.0.1:${port}`,
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.origin ? { origin: options.origin } : {}),
        ...(options.body !== undefined ? { 'content-length': Buffer.byteLength(options.body, 'utf8') } : {}),
        ...(options.headers ?? {}),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.once('error', reject);
    req.end(options.body);
  });
}

function rawHttpRequest(port: number, target: string, token: string): Promise<string> {
  return rawHttp(port,
    `GET ${target} HTTP/1.1\r\n`
    + `Host: 127.0.0.1:${port}\r\n`
    + `Authorization: Bearer ${token}\r\n`
    + 'Connection: close\r\n\r\n');
}

function rawHttp(port: number, wire: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let response = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => { socket.end(wire); });
    socket.on('data', (chunk: string) => { response += chunk; });
    socket.on('error', reject);
    socket.on('close', () => resolve(response));
  });
}

interface CommandOptions {
  key?: string;
  body?: unknown;
  rawBody?: string;
  device?: RemoteDevice | null;
  timestamp?: string;
  contentType?: string | null;
  tamperSignature?: boolean;
  signPath?: string;
}

/** Signed command request the way a paired device would issue it. */
function command(port: number, path: string, options: CommandOptions = {}): Promise<HttpResult> {
  const rawBody = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  const key = options.key;
  const useDevice = options.device === undefined ? device : options.device;
  const headers: Record<string, string> = {};
  if (key !== undefined) headers['idempotency-key'] = key;
  if (rawBody !== undefined) {
    if (options.contentType !== null) headers['content-type'] = options.contentType ?? 'application/json';
  } else {
    headers['content-length'] = '0';
  }
  if (useDevice) {
    const timestamp = options.timestamp ?? String(Date.now());
    headers['x-ade-device'] = useDevice.id;
    headers['x-ade-timestamp'] = timestamp;
    const signature = signRequest(useDevice.secret, {
      method: 'POST',
      path: options.signPath ?? path,
      timestamp,
      idempotencyKey: key ?? '',
      bodySha256: sha256Hex(rawBody ?? ''),
    });
    // Replacing an existing trailing zero with zero leaves a valid signature.
    // The negative control must change a nibble on every invocation.
    headers['x-ade-signature'] = options.tamperSignature
      ? `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}` : signature;
  }
  return httpRequest(port, path, { method: 'POST', token, headers, body: rawBody });
}

interface SseFrame {
  event: string;
  id: number | null;
  data: unknown;
}

function pageSeqs(page: MobileJournalPage): number[] {
  return [...page.events.map((event) => event.seq), ...page.messages.map((message) => message.seq)]
    .sort((left, right) => left - right);
}

/** Every journal seq (events and messages) currently persisted, ascending. */
function persistedSeqs(orchestration: OrchestrationService): number[] {
  const page = orchestration.eventsSince(0, 10_000);
  return pageSeqs({ events: page.events, messages: page.messages } as unknown as MobileJournalPage);
}

/** Minimal EventSource stand-in over node:http so reconnects are real TCP connections. */
class SseClient {
  readonly frames: SseFrame[] = [];
  readonly comments: string[] = [];
  status = 0;
  headers: Record<string, string | string[] | undefined> = {};
  closed = false;
  private buffer = '';
  private response: IncomingMessage | null = null;
  private readonly waiters: Array<() => void> = [];
  private readonly opened: Promise<void>;

  constructor(port: number, path: string, headers: Record<string, string> = {}) {
    this.opened = new Promise((resolve) => {
      const req = request({
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: {
          host: `127.0.0.1:${port}`,
          authorization: `Bearer ${token}`,
          accept: 'text/event-stream',
          ...headers,
        },
      }, (response) => {
        this.response = response;
        this.status = response.statusCode ?? 0;
        this.headers = response.headers;
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => this.consume(chunk));
        response.on('end', () => this.markClosed());
        response.on('close', () => this.markClosed());
        resolve();
      });
      // A server that drops a stalled stream resets the socket; that is an
      // observable outcome for the backpressure test, not a harness failure.
      req.once('error', (error) => {
        this.error = error;
        this.markClosed();
        resolve();
      });
      req.end();
    });
  }

  error: Error | null = null;

  ready(): Promise<void> {
    return this.opened;
  }

  private markClosed(): void {
    this.closed = true;
    this.notify();
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    let separator = this.buffer.indexOf('\n\n');
    while (separator !== -1) {
      const block = this.buffer.slice(0, separator);
      this.buffer = this.buffer.slice(separator + 2);
      this.parse(block);
      separator = this.buffer.indexOf('\n\n');
    }
    this.notify();
  }

  private parse(block: string): void {
    let event = 'message';
    let id: number | null = null;
    const data: string[] = [];
    let isFrame = false;
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) {
        this.comments.push(line);
        continue;
      }
      if (line.startsWith('retry:')) continue;
      if (line.startsWith('event:')) { event = line.slice(6).trim(); isFrame = true; }
      else if (line.startsWith('id:')) { id = Number(line.slice(3).trim()); isFrame = true; }
      else if (line.startsWith('data:')) { data.push(line.slice(5).trim()); isFrame = true; }
    }
    if (isFrame) this.frames.push({ event, id, data: data.length ? JSON.parse(data.join('\n')) : null });
  }

  private notify(): void {
    for (const waiter of this.waiters.splice(0)) waiter();
  }

  async until(predicate: () => boolean, label: string, timeout = 4_000): Promise<void> {
    const started = Date.now();
    while (!predicate()) {
      if (Date.now() - started > timeout) throw new Error(`stream timed out waiting for ${label}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 50);
        this.waiters.push(() => { clearTimeout(timer); resolve(); });
      });
    }
  }

  /** Journal seqs in wire order: frame by frame, each frame's events and messages merged by seq. */
  journalSeqs(): number[] {
    return this.frames
      .filter((frame) => frame.event === 'journal')
      .flatMap((frame) => pageSeqs(frame.data as MobileJournalPage));
  }

  lastId(): number {
    const withId = this.frames.filter((frame) => frame.id !== null);
    return withId.length ? withId[withId.length - 1]!.id! : 0;
  }

  close(): void {
    this.response?.destroy();
    this.closed = true;
  }
}

/* --------------------------------------------- real coordinator fixture */

class MemoryStore {
  config: AdeConfig;

  constructor(config: AdeConfig) {
    this.config = structuredClone(config);
  }

  get(): AdeConfig {
    return this.config;
  }

  save(partial: Partial<AdeConfig>): AdeConfig {
    this.config = { ...this.config, ...structuredClone(partial) };
    return this.config;
  }
}

class FakeWorkspaces implements WorkspacePort {
  async inspect(workspaceDir: string) {
    return { workspaceDir, isRepo: false, clean: true, branch: '', headSha: '', commonGitDir: '' };
  }

  async validateCommit(_workspaceDir: string, _baseSha: string, commitSha: string): Promise<string[]> {
    return [commitSha];
  }

  async commitChanges(): Promise<string | null> {
    return null;
  }

  async integrateCommits(_workspaceDir: string, commits: string[]): Promise<number> {
    return commits.length;
  }

  async prepareDependencyBase(_workspaceDir: string, runBaseSha: string): Promise<string> {
    return runBaseSha;
  }

  async resetToBase(_workspaceDir: string, baseSha: string, archiveRef: string) {
    return { previousHeadSha: baseSha, headSha: baseSha, archiveRef };
  }
}

function fixtureAgent(id: string, root: string): Agent {
  return {
    id,
    categoryId: 'cat',
    name: id,
    runtime: 'custom',
    permissionMode: 'default',
    customCommand: 'fixture-agent',
    workspaceDir: join(root, 'workspaces', id),
    memoryDir: join(root, 'memory', id),
  };
}

interface Fixture {
  root: string;
  store: MemoryStore;
  orchestration: OrchestrationService;
  coordinator: RunCoordinator;
  application: AdeApplicationService;
  audit: RemoteAuditEntry[];
  launched: string[];
  cancelled: string[];
}

function createFixture(devices: RemoteDevice[], options: { failLaunch?: boolean; audit?: (entry: RemoteAuditEntry) => void } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'ade-host-api-'));
  const agents = [fixtureAgent('orchestrator', root), fixtureAgent('lead', root), fixtureAgent('worker', root)];
  for (const item of agents) {
    mkdirSync(item.workspaceDir, { recursive: true });
    mkdirSync(item.memoryDir, { recursive: true });
  }
  const store = new MemoryStore({
    ...structuredClone(DEFAULT_CONFIG),
    categories: [{ id: 'cat', name: 'Team', agents: agents.map((item) => item.id) }],
    agents,
    repositories: [{
      id: 'repo-1',
      name: 'Fixture',
      rootPath: join(root, 'repository'),
      commonGitDir: join(root, 'repository', '.git'),
      executionBackend: 'native',
      verified: true,
      createdAt: 1,
    }],
  });
  const changes = new JournalChangeHub();
  const orchestration = new OrchestrationService(store, () => changes.publish());
  const coordinator = new RunCoordinator(store, orchestration, new RuntimeAdapterRegistry(), new FakeWorkspaces());
  const launched: string[] = [];
  const cancelled: string[] = [];
  coordinator.connect(async (agentId, _prompt, _dispatchId, taskId) => {
    launched.push(taskId);
    if (options.failLaunch) {
      // Mirrors a PTY layer that rejects before it can report the failure
      // itself (e.g. the launcher is torn down): the coordinator must still
      // journal the task as failed rather than leave it queued forever.
      throw new Error(`ade: fixture launch refused at ${join(root, 'workspaces', agentId)}`);
    }
    const session: SessionMeta = {
      id: `pty-${launched.length}`,
      agentId,
      title: 'fixture',
      kind: 'task',
      status: 'running',
      createdAt: Date.now(),
      runTaskId: taskId,
      // The real PtyManager reports the absolute workspace; the wire must not.
      workspaceDir: join(root, 'workspaces', agentId),
    };
    coordinator.onTaskStarted(taskId, session);
    return session;
  }, (ids) => {
    cancelled.push(...ids);
    for (const id of ids) coordinator.onTaskFinished(id, 'cancelled', 130, 'cancelled by fixture');
  });
  const audit: RemoteAuditEntry[] = [];
  const application = new AdeApplicationService(store, orchestration, {
    status: () => ({ active: 0, queued: 0, maxActive: 4 }),
  }, {
    commands: {
      createRun: (input) => orchestration.createRun(input),
      startRun: (runId, commandId) => coordinator.start(runId, commandId),
      cancelRun: (runId, commandId) => coordinator.cancel(runId, undefined, commandId),
      submitTask: (input) => coordinator.submitSingleTask(input),
    },
    changes,
    commandsEnabled: () => devices.length > 0,
    audit: (entry) => { options.audit?.(entry); audit.push(entry); },
  });
  return { root, store, orchestration, coordinator, application, audit, launched, cancelled };
}

/** Both the generated title prefix and the remainder must stay off the wire. */
const PROMPT_TAIL = 'SECRET-PROMPT-TAIL-7c1f';
const submitBody = {
  agentId: 'worker',
  repositoryId: 'repo-1',
  prompt: 'Fix the flaky `date` test in tests/time.spec.ts, keep the public API unchanged and '
    + `explain the root cause in detail. ${PROMPT_TAIL}`,
};

const createBody = {
  name: 'Mobile run',
  goal: 'Implement two independent changes, integrate them, and verify the final repository.',
  repositoryId: 'repo-1',
  participants: [
    { agentId: 'orchestrator', role: 'orchestrator' },
    { agentId: 'lead', role: 'lead', teamId: 'team', teamName: 'Team' },
    { agentId: 'worker', role: 'worker', teamId: 'team', teamName: 'Team' },
  ],
  budget: { maxConcurrentTasks: 1, maxApprovals: 1 },
};

/* ------------------------------------------------------------ HTTP: reads */

async function testReadAdapter(): Promise<void> {
  console.log('\n== HTTP read surface ==');
  const server = new HostApiServer(application, { authorizer: new RemoteAuthorizer(token, []), port: 0 });
  const address = await server.start();
  try {
    check('HTTP adapter binds only the IPv4 loopback interface',
      address.host === '127.0.0.1' && address.port > 0, address);

    const unauthorized = await httpRequest(address.port, '/api/v1/catalog');
    check('HTTP adapter rejects missing authorization before returning catalog data',
      unauthorized.status === 401
        && unauthorized.headers['www-authenticate'] === 'Bearer'
        && !unauthorized.body.includes('repo-1')
        && !unauthorized.body.includes('agent-1'));

    const wrongBearer = await httpRequest(address.port, '/api/v1/catalog', {
      token: 'x'.repeat(32),
    });
    check('HTTP adapter rejects incorrect bearer values', wrongBearer.status === 401);

    const wrongHost = await httpRequest(address.port, '/api/v1/health', {
      token,
      hostHeader: 'attacker.invalid',
    });
    check('HTTP adapter rejects untrusted Host headers', wrongHost.status === 400);

    const unknownOrigin = await httpRequest(address.port, '/api/v1/health', {
      token,
      origin: 'https://attacker.invalid',
    });
    check('HTTP adapter rejects browser origins until paired PWA origins exist',
      unknownOrigin.status === 403);

    const healthResponse = await httpRequest(address.port, '/api/v1/health', { token });
    check('authenticated health endpoint returns bounded JSON with defensive headers and a request id',
      healthResponse.status === 200
        && JSON.parse(healthResponse.body).queue.active === 1
        && JSON.parse(healthResponse.body).commands === 'disabled'
        && healthResponse.headers['cache-control'] === 'no-store'
        && healthResponse.headers['x-content-type-options'] === 'nosniff'
        && healthResponse.headers['access-control-allow-origin'] === undefined
        && /^[0-9a-f-]{36}$/.test(String(healthResponse.headers['x-ade-request-id'])));

    const catalogResponse = await httpRequest(address.port, '/api/v1/catalog', { token });
    check('authenticated catalog endpoint returns the mobile-safe projection',
      catalogResponse.status === 200
        && JSON.parse(catalogResponse.body).repositories[0]?.id === 'repo-1'
        && !catalogResponse.body.includes('/home/secret'));

    const runsResponse = await httpRequest(address.port, '/api/v1/runs', { token });
    check('authenticated runs endpoint returns sanitized run summaries',
      runsResponse.status === 200
        && JSON.parse(runsResponse.body)[0]?.id === 'run-1');

    const healthPost = await httpRequest(address.port, '/api/v1/health', { method: 'POST', token });
    check('read endpoints refuse POST with an Allow header',
      healthPost.status === 405 && healthPost.headers['allow'] === 'GET');
    const startGet = await httpRequest(address.port, '/api/v1/runs/run-1/start', { token });
    check('command endpoints refuse GET with an Allow header',
      startGet.status === 405 && startGet.headers['allow'] === 'POST');
    const deleteRuns = await httpRequest(address.port, '/api/v1/runs', { method: 'DELETE', token });
    check('the runs collection allows only GET and POST',
      deleteRuns.status === 405 && deleteRuns.headers['allow'] === 'GET, POST');

    const unknown = await httpRequest(address.port, '/api/v1/unknown', { token });
    check('HTTP adapter rejects unknown endpoint paths', unknown.status === 404);
    const unknownAction = await httpRequest(address.port, '/api/v1/runs/run-1/delete', { method: 'POST', token });
    check('HTTP adapter exposes no run deletion or other unlisted actions', unknownAction.status === 404);
    const pathLikeRun = await httpRequest(address.port, '/api/v1/runs/..%2F..%2Fetc/start', { method: 'POST', token });
    check('HTTP adapter rejects run ids that are not opaque identifiers', pathLikeRun.status === 404);

    const queryAlias = await httpRequest(address.port, '/api/v1/health?view=full', { token });
    check('HTTP adapter rejects query aliases of exact endpoint paths', queryAlias.status === 404);

    const dotSegment = await httpRequest(address.port, '/api/v1/../v1/health', { token });
    const encodedDotSegment = await httpRequest(
      address.port,
      '/api/v1/%2e%2e/v1/health',
      { token },
    );
    check('HTTP adapter matches only exact raw endpoint paths without URL normalization',
      dotSegment.status === 404 && encodedDotSegment.status === 404);

    const malformedTarget = await rawHttpRequest(address.port, 'http://[::1', token);
    const absoluteTarget = await rawHttpRequest(
      address.port,
      `http://127.0.0.1:${address.port}/api/v1/health`,
      token,
    );
    check('HTTP adapter rejects malformed absolute request targets without crashing Electron',
      malformedTarget.startsWith('HTTP/1.1 400'));
    check('HTTP adapter rejects valid absolute-form request targets',
      absoluteTarget.startsWith('HTTP/1.1 400'));

    // Without any configured device no principal can ever hold runs:write.
    const signedWithoutDevices = await command(address.port, '/api/v1/runs', { key: 'key-nodevice1', body: createBody });
    check('a host without command devices refuses every signed command as unknown device',
      signedWithoutDevices.status === 401 && JSON.parse(signedWithoutDevices.body).error === 'unknown_device');
    const bearerOnlyCommand = await command(address.port, '/api/v1/runs', {
      key: 'key-bearer0001', body: createBody, device: null,
    });
    check('the listener bearer token alone can never issue a command',
      bearerOnlyCommand.status === 401 && JSON.parse(bearerOnlyCommand.body).error === 'device_proof_required');
    const tasksGet = await httpRequest(address.port, '/api/v1/tasks', { token });
    check('the tasks collection is command-only (no listing of prompts) and advertises POST',
      tasksGet.status === 405 && tasksGet.headers['allow'] === 'POST');
    const bearerOnlyTask = await command(address.port, '/api/v1/tasks', {
      key: 'key-bearer0002', body: submitBody, device: null,
    });
    check('the bearer token alone cannot submit a task either',
      bearerOnlyTask.status === 401 && JSON.parse(bearerOnlyTask.body).error === 'device_proof_required');
    const unknownTaskAction = await httpRequest(address.port, '/api/v1/tasks/t1/cancel', { method: 'POST', token });
    check('there is no per-task action surface; tasks are cancelled through their run', unknownTaskAction.status === 404);
  } finally {
    await server.stop();
  }
}

/* --------------------------------------------------- HTTP: commands + SSE */

async function testCommandsAndStream(): Promise<void> {
  console.log('\n== HTTP commands and event stream (real coordinator) ==');
  const fixture = createFixture([device]);
  const server = new HostApiServer(fixture.application, {
    authorizer: new RemoteAuthorizer(token, [device]),
    port: 0,
    heartbeatMs: 60,
    maxStreamClients: 2,
    maxBodyBytes: 4_096,
  });
  const address = await server.start();
  const port = address.port;
  const streamA = new SseClient(port, '/api/v1/events');
  try {
    const healthResponse = await httpRequest(port, '/api/v1/health', { token });
    check('health reports enabled commands once a device identity exists',
      JSON.parse(healthResponse.body).commands === 'enabled');

    await streamA.ready();
    await streamA.until(() => streamA.frames.length >= 1, 'initial snapshot');
    const snapshot = streamA.frames[0]!;
    check('a stream without cursor opens with one bundled snapshot at the current journal cursor',
      streamA.status === 200
        && String(streamA.headers['content-type']).startsWith('text/event-stream')
        && streamA.headers['cache-control'] === 'no-store'
        && snapshot.event === 'snapshot'
        && snapshot.id === 0
        && (snapshot.data as MobileSnapshot).runs.length === 0);
    await streamA.until(() => streamA.comments.some((line) => line.startsWith(': ping')), 'heartbeat');
    check('the stream emits keep-alive comments', streamA.comments.some((line) => line.startsWith(': ping')));

    // --- fail-closed before any state changes -----------------------------
    const noProof = await command(port, '/api/v1/runs', { key: 'key-noproof01', body: createBody, device: null });
    check('a command without device proof is denied and audited',
      noProof.status === 401
        && JSON.parse(noProof.body).error === 'device_proof_required'
        && fixture.audit.at(-1)?.outcome === 'denied'
        && fixture.audit.at(-1)?.principalKind === 'bootstrap-token');
    const wrongDevice = await command(port, '/api/v1/runs', {
      key: 'key-wrongdev1', body: createBody, device: { ...device, id: 'phone-9' },
    });
    check('an unpaired device is refused', wrongDevice.status === 401 && JSON.parse(wrongDevice.body).error === 'unknown_device');
    const wrongSecret = await command(port, '/api/v1/runs', {
      key: 'key-wrongsec1', body: createBody, device: { ...device, secret: 'e'.repeat(40) },
    });
    check('a wrong device secret is refused',
      wrongSecret.status === 401 && JSON.parse(wrongSecret.body).error === 'invalid_signature');
    const tampered = await command(port, '/api/v1/runs', { key: 'key-tamper001', body: createBody, tamperSignature: true });
    check('a tampered signature is refused',
      tampered.status === 401 && JSON.parse(tampered.body).error === 'invalid_signature');
    const replayedPath = await command(port, '/api/v1/runs', {
      key: 'key-path00001', body: createBody, signPath: '/api/v1/runs/other/start',
    });
    check('a signature for another path is refused',
      replayedPath.status === 401 && JSON.parse(replayedPath.body).error === 'invalid_signature');
    const staleCommand = await command(port, '/api/v1/runs', {
      key: 'key-stale0001', body: createBody, timestamp: String(Date.now() - 10 * 60_000),
    });
    check('a stale timestamp is refused',
      staleCommand.status === 401 && JSON.parse(staleCommand.body).error === 'stale_timestamp');
    const partialProof = await httpRequest(port, '/api/v1/runs', {
      method: 'POST', token, body: JSON.stringify(createBody),
      headers: { 'content-type': 'application/json', 'x-ade-device': 'phone-1', 'idempotency-key': 'key-partial01' },
    });
    check('incomplete device headers are refused',
      partialProof.status === 401 && JSON.parse(partialProof.body).error === 'invalid_signature');
    const noKey = await command(port, '/api/v1/runs', { body: createBody });
    check('a command without Idempotency-Key is refused',
      noKey.status === 400 && JSON.parse(noKey.body).error === 'idempotency_key_required');
    const shortKey = await command(port, '/api/v1/runs', { key: 'short', body: createBody });
    check('a malformed Idempotency-Key is refused',
      shortKey.status === 400 && JSON.parse(shortKey.body).error === 'idempotency_key_invalid');
    const wrongType = await command(port, '/api/v1/runs', { key: 'key-type00001', body: createBody, contentType: 'text/plain' });
    check('a non-JSON content type is refused',
      wrongType.status === 415 && JSON.parse(wrongType.body).error === 'unsupported_media_type');
    const noType = await command(port, '/api/v1/runs', { key: 'key-notype001', body: createBody, contentType: null });
    check('a missing content type is refused', noType.status === 415);
    const chunkedPayload = JSON.stringify(createBody);
    const chunked = await rawHttp(port,
      'POST /api/v1/runs HTTP/1.1\r\n'
      + `Host: 127.0.0.1:${port}\r\n`
      + `Authorization: Bearer ${token}\r\n`
      + 'Content-Type: application/json\r\n'
      + 'Idempotency-Key: key-chunked01\r\n'
      + 'Transfer-Encoding: chunked\r\n'
      + 'Connection: close\r\n\r\n'
      + `${Buffer.byteLength(chunkedPayload).toString(16)}\r\n${chunkedPayload}\r\n0\r\n\r\n`);
    check('a chunked body without content-length is refused', chunked.startsWith('HTTP/1.1 411'));
    const oversized = await command(port, '/api/v1/runs', {
      key: 'key-oversz001', body: { ...createBody, goal: 'g'.repeat(5_000) },
    });
    check('an oversized body is refused before parsing',
      oversized.status === 413 && JSON.parse(oversized.body).error === 'payload_too_large');
    const malformed = await command(port, '/api/v1/runs', { key: 'key-malform01', rawBody: '{"name":' });
    check('malformed JSON is refused',
      malformed.status === 400 && JSON.parse(malformed.body).error === 'invalid_payload');
    const arrayBody = await command(port, '/api/v1/runs', { key: 'key-array0001', rawBody: '[]' });
    check('non-object JSON is refused', arrayBody.status === 400);
    const unknownField = await command(port, '/api/v1/runs', {
      key: 'key-unknown01', body: { ...createBody, workspacePrepare: 'reset-to-base' },
    });
    check('the worktree reset opt-in cannot be requested remotely',
      unknownField.status === 400 && JSON.parse(unknownField.body).message.includes('unknown field'));
    const pathId = await command(port, '/api/v1/runs', {
      key: 'key-pathid001', body: { ...createBody, repositoryId: 'C:\\Users\\me\\secret-repo' },
    });
    check('an absolute path as repository id is refused without echoing it',
      pathId.status === 400 && !pathId.body.includes('secret-repo') && !pathId.body.includes('C:\\'));
    const unknownRepo = await command(port, '/api/v1/runs', {
      key: 'key-norepo001', body: { ...createBody, repositoryId: 'repo-missing' },
    });
    check('an unknown repository id is a redacted command rejection',
      unknownRepo.status === 422
        && JSON.parse(unknownRepo.body).error === 'command_rejected'
        && JSON.parse(unknownRepo.body).message.includes('repository not found')
        && !unknownRepo.body.includes(fixture.root));
    const unknownAgent = await command(port, '/api/v1/runs', {
      key: 'key-noagent01', body: { ...createBody, participants: [{ agentId: 'ghost', role: 'orchestrator' }] },
    });
    check('an unknown agent id is a command rejection', unknownAgent.status === 422);
    check('no failed attempt created a run', fixture.orchestration.snapshot().runs.length === 0);
    check('every denial and rejection is audited without paths',
      fixture.audit.length >= 8
        && fixture.audit.every((entry) => ['requested', 'denied', 'rejected'].includes(entry.outcome))
        && !JSON.stringify(fixture.audit).includes(fixture.root));

    // --- create -----------------------------------------------------------
    const created = await command(port, '/api/v1/runs', { key: 'key-create001', body: createBody });
    const createdBody = JSON.parse(created.body);
    check('a signed, keyed run creation succeeds with a sanitized summary',
      created.status === 200
        && createdBody.replayed === false
        && createdBody.run.status === 'draft'
        && createdBody.run.repositoryId === 'repo-1'
        && createdBody.run.participants.length === 3
        && !created.body.includes(fixture.root));
    const runId: string = createdBody.run.id;
    check('the creation is audited as executed by the device principal',
      fixture.audit.at(-1)?.outcome === 'executed'
        && fixture.audit.at(-1)?.principalId === 'phone-1'
        && fixture.audit.at(-1)?.principalKind === 'device'
        && fixture.audit.at(-1)?.target === runId
        && fixture.audit.at(-1)?.channel === 'run:create');

    const replay = await command(port, '/api/v1/runs', { key: 'key-create001', body: createBody });
    check('retrying the same key and body replays the original run instead of creating another',
      replay.status === 200
        && JSON.parse(replay.body).replayed === true
        && JSON.parse(replay.body).run.id === runId
        && fixture.orchestration.snapshot().runs.length === 1
        && fixture.audit.at(-1)?.outcome === 'replayed');
    const reused = await command(port, '/api/v1/runs', { key: 'key-create001', body: { ...createBody, name: 'Other' } });
    check('reusing a key with a different payload is refused and creates nothing',
      reused.status === 409
        && JSON.parse(reused.body).error === 'idempotency_key_reused'
        && fixture.orchestration.snapshot().runs.length === 1);
    const reorderedKey = await command(port, `/api/v1/runs/${runId}/start`, { key: 'key-create001' });
    check('a key recorded for one command cannot be reused for another command',
      reorderedKey.status === 409 && fixture.launched.length === 0);

    const [first, second] = await Promise.all([
      command(port, '/api/v1/runs', { key: 'key-concurr01', body: { ...createBody, name: 'Concurrent' } }),
      command(port, '/api/v1/runs', { key: 'key-concurr01', body: { ...createBody, name: 'Concurrent' } }),
    ]);
    const concurrentIds = new Set([JSON.parse(first.body).run.id, JSON.parse(second.body).run.id]);
    check('concurrent duplicates of one key produce exactly one run',
      first.status === 200 && second.status === 200
        && concurrentIds.size === 1
        && fixture.orchestration.snapshot().runs.length === 2
        && [JSON.parse(first.body).replayed, JSON.parse(second.body).replayed].filter(Boolean).length === 1);
    const concurrentRunId = [...concurrentIds][0] as string;

    await streamA.until(() => streamA.journalSeqs().length >= 8, 'creation journal batches');
    const seqsAfterCreate = streamA.journalSeqs();
    check('the live stream delivered the creation journal strictly ascending',
      seqsAfterCreate.every((seq, index) => index === 0 || seq > seqsAfterCreate[index - 1]!)
        && JSON.stringify(seqsAfterCreate) === JSON.stringify(persistedSeqs(fixture.orchestration))
        && streamA.frames.filter((frame) => frame.event === 'journal')
          .every((frame) => frame.id === Math.max(...pageSeqs(frame.data as MobileJournalPage))));

    // --- start ------------------------------------------------------------
    const startedUnknown = await command(port, '/api/v1/runs/run-missing/start', { key: 'key-startmis1' });
    check('starting an unknown run is a command rejection', startedUnknown.status === 422 && fixture.launched.length === 0);
    const started = await command(port, `/api/v1/runs/${runId}/start`, { key: 'key-start0001' });
    check('a signed, keyed start launches the planner exactly once',
      started.status === 200
        && JSON.parse(started.body).run.phase === 'planning'
        && JSON.parse(started.body).run.status === 'running'
        && fixture.launched.length === 1);
    const startReplay = await command(port, `/api/v1/runs/${runId}/start`, { key: 'key-start0001' });
    check('retrying the start with the same key launches nothing new',
      startReplay.status === 200
        && JSON.parse(startReplay.body).replayed === true
        && fixture.launched.length === 1);
    const startAgain = await command(port, `/api/v1/runs/${runId}/start`, { key: 'key-start0002' });
    check('a second start under a new key is rejected and launches nothing',
      startAgain.status === 422 && fixture.launched.length === 1);
    const startWithBody = await command(port, `/api/v1/runs/${runId}/start`, { key: 'key-startbody', body: {} });
    check('start takes no body', startWithBody.status === 400);

    await streamA.until(() => streamA.frames.some((frame) => frame.event === 'journal'
      && (frame.data as MobileJournalPage).events.some((event) => event.type === 'task.started')), 'task.started');
    const transcript = JSON.stringify(streamA.frames);
    const startedEvent = streamA.frames.flatMap((frame) => frame.event === 'journal'
      ? (frame.data as MobileJournalPage).events : []).find((event) => event.type === 'task.started');
    check('journal events on the wire carry no workspace path or PTY session id',
      startedEvent !== undefined
        && !('workspaceDir' in (startedEvent.data ?? {}))
        && !('sessionId' in (startedEvent.data ?? {}))
        && !transcript.includes(fixture.root)
        && !transcript.includes('pty-1')
        && !transcript.includes('fixture-agent'));

    // --- cancel -----------------------------------------------------------
    const cancelled = await command(port, `/api/v1/runs/${runId}/cancel`, { key: 'key-cancel001' });
    check('a signed, keyed cancel ends the run and stops its task',
      cancelled.status === 200
        && JSON.parse(cancelled.body).run.status === 'cancelled'
        && fixture.cancelled.length === 1);
    const cancelReplay = await command(port, `/api/v1/runs/${runId}/cancel`, { key: 'key-cancel001' });
    check('retrying the cancel replays without a second cancellation',
      cancelReplay.status === 200 && JSON.parse(cancelReplay.body).replayed === true && fixture.cancelled.length === 1);
    const startAfterCancel = await command(port, `/api/v1/runs/${runId}/start`, { key: 'key-startlate' });
    check('a start after cancel is rejected and launches nothing',
      startAfterCancel.status === 422 && fixture.launched.length === 1);

    await streamA.until(() => streamA.frames.some((frame) => frame.event === 'journal'
      && (frame.data as MobileJournalPage).events.some((event) => event.type === 'run.cancelled')), 'run.cancelled');
    const cancelEvent = streamA.frames.flatMap((frame) => frame.event === 'journal'
      ? (frame.data as MobileJournalPage).events : []).find((event) => event.type === 'run.cancelled');
    check('the cancel reaches the stream with its redacted detail',
      cancelEvent?.data?.detail === 'Cancelled by user');

    // --- reconnect --------------------------------------------------------
    const resumeFrom = streamA.lastId();
    const seqsBeforeDisconnect = streamA.journalSeqs();
    streamA.close();
    await waitFor(() => server.streamClientCount() === 0, 'stream A teardown');

    const offline = await command(port, '/api/v1/runs', { key: 'key-offline01', body: { ...createBody, name: 'While offline' } });
    check('commands succeed while no stream is connected', offline.status === 200);

    const streamB = new SseClient(port, '/api/v1/events', { 'last-event-id': String(resumeFrom) });
    await streamB.ready();
    const allSeqs = persistedSeqs(fixture.orchestration);
    await streamB.until(
      () => seqsBeforeDisconnect.length + streamB.journalSeqs().length >= allSeqs.length,
      'resumed journal',
    );
    const resumedSeqs = streamB.journalSeqs();
    check('reconnecting with Last-Event-ID resumes with only newer records, no snapshot and no duplicates',
      streamB.frames[0]?.event === 'journal'
        && resumedSeqs.every((seq) => seq > resumeFrom)
        && new Set(resumedSeqs).size === resumedSeqs.length
        && resumedSeqs.every((seq, index) => index === 0 || seq > resumedSeqs[index - 1]!));
    check('the union of both connections equals the complete journal exactly once',
      JSON.stringify([...seqsBeforeDisconnect, ...resumedSeqs]) === JSON.stringify(allSeqs));
    streamB.close();
    await waitFor(() => server.streamClientCount() === 0, 'stream B teardown');

    const streamQuery = new SseClient(port, `/api/v1/events?cursor=${resumeFrom}`);
    await streamQuery.ready();
    await streamQuery.until(() => streamQuery.journalSeqs().length >= resumedSeqs.length, 'query-cursor journal');
    check('the cursor may also be supplied as a query parameter for clients that cannot set headers',
      streamQuery.frames[0]?.event === 'journal'
        && JSON.stringify(streamQuery.journalSeqs()) === JSON.stringify(resumedSeqs));
    streamQuery.close();
    await waitFor(() => server.streamClientCount() === 0, 'query stream teardown');

    const ahead = new SseClient(port, '/api/v1/events', { 'last-event-id': '999999' });
    await ahead.ready();
    await ahead.until(() => ahead.frames.length >= 1, 'ahead snapshot');
    check('a cursor beyond the journal resets the client with a fresh snapshot',
      ahead.frames[0]?.event === 'snapshot'
        && (ahead.frames[0]?.data as MobileSnapshot).runs.length === 3
        && (ahead.frames[0]?.data as MobileSnapshot).cursor === allSeqs.at(-1));
    ahead.close();
    await waitFor(() => server.streamClientCount() === 0, 'ahead stream teardown');

    const badCursor = await httpRequest(port, '/api/v1/events?cursor=abc', { token, headers: { accept: 'text/event-stream' } });
    const conflictingCursor = await httpRequest(port, '/api/v1/events?cursor=5', {
      token, headers: { accept: 'text/event-stream', 'last-event-id': '6' },
    });
    const foreignQuery = await httpRequest(port, '/api/v1/events?foo=1', { token, headers: { accept: 'text/event-stream' } });
    check('malformed, conflicting or foreign cursor parameters are refused',
      badCursor.status === 400 && conflictingCursor.status === 400 && foreignQuery.status === 400);
    const noAccept = await httpRequest(port, '/api/v1/events', { token });
    check('the stream requires an event-stream Accept header', noAccept.status === 406);
    const streamOrigin = await httpRequest(port, '/api/v1/events', {
      token, origin: 'https://attacker.invalid', headers: { accept: 'text/event-stream' },
    });
    check('the stream refuses browser origins like every other endpoint', streamOrigin.status === 403);

    const c1 = new SseClient(port, '/api/v1/events');
    const c2 = new SseClient(port, '/api/v1/events');
    await c1.ready();
    await c2.ready();
    await waitFor(() => server.streamClientCount() === 2, 'two streams');
    const overflowClient = await httpRequest(port, '/api/v1/events', { token, headers: { accept: 'text/event-stream' } });
    check('stream clients are bounded per host',
      overflowClient.status === 503 && JSON.parse(overflowClient.body).error === 'too_many_streams');
    c1.close();
    c2.close();
    await waitFor(() => server.streamClientCount() === 0, 'stream cleanup');

    // Reads on the same server still work and the summaries stay path-free.
    const runs = await httpRequest(port, '/api/v1/runs', { token });
    check('run summaries over HTTP contain the cancelled and draft runs without paths',
      runs.status === 200
        && (JSON.parse(runs.body) as RunSummary[]).length === 3
        && (JSON.parse(runs.body) as RunSummary[]).some((run) => run.id === concurrentRunId)
        && !runs.body.includes(fixture.root));
  } finally {
    streamA.close();
    await server.stop();
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

/* ------------------------------------------- HTTP: single-task submission */

async function testSingleTaskSubmission(): Promise<void> {
  console.log('\n== HTTP single-task submission (real coordinator) ==');
  const fixture = createFixture([device]);
  const server = new HostApiServer(fixture.application, {
    authorizer: new RemoteAuthorizer(token, [device]),
    port: 0,
    heartbeatMs: 60,
  });
  const address = await server.start();
  const port = address.port;
  const stream = new SseClient(port, '/api/v1/events');
  const journalEvents = () => stream.frames.flatMap((frame) => frame.event === 'journal'
    ? (frame.data as MobileJournalPage).events : []);
  try {
    await stream.ready();
    await stream.until(() => stream.frames.length >= 1, 'initial snapshot');

    // --- refusals that create nothing ------------------------------------
    const noType = await command(port, '/api/v1/tasks', { key: 'key-tasknotype' });
    const emptyBody = await command(port, '/api/v1/tasks', { key: 'key-tasknobody', rawBody: '' });
    check('a task submission requires a JSON body', noType.status === 415 && emptyBody.status === 400);
    const withRunId = await command(port, '/api/v1/tasks', { key: 'key-taskrunid1', body: { ...submitBody, runId: 'run-1' } });
    check('a task submission cannot target an existing run or participant',
      withRunId.status === 400 && JSON.parse(withRunId.body).error === 'invalid_payload');
    const withCommandId = await command(port, '/api/v1/tasks', { key: 'key-taskcmdid1', body: { ...submitBody, commandId: 'mine' } });
    check('a task submission cannot choose its own commandId; the Idempotency-Key owns replay',
      withCommandId.status === 400);
    const pathAgent = await command(port, '/api/v1/tasks', {
      key: 'key-taskpath01', body: { ...submitBody, agentId: 'C:\\Users\\me\\agent' },
    });
    check('a path-like agent id is refused without echoing it',
      pathAgent.status === 400 && !pathAgent.body.includes('Users'));
    const unknownAgent = await command(port, '/api/v1/tasks', { key: 'key-taskagent1', body: { ...submitBody, agentId: 'ghost' } });
    check('an unknown agent is a redacted command rejection',
      unknownAgent.status === 422 && JSON.parse(unknownAgent.body).error === 'command_rejected');
    const unknownRepo = await command(port, '/api/v1/tasks', { key: 'key-taskrepo01', body: { ...submitBody, repositoryId: 'nope' } });
    check('an unknown repository is a command rejection', unknownRepo.status === 422);
    check('no refused submission created a run, a task or a launch',
      fixture.orchestration.snapshot().runs.length === 0
        && fixture.orchestration.snapshot().tasks.length === 0
        && fixture.launched.length === 0);
    check('every refusal is audited under the submission channel without paths',
      fixture.audit.filter((entry) => entry.channel === 'runTask:submit').length >= 4
        && fixture.audit.every((entry) => !(entry.reason ?? '').includes(fixture.root)
          && !(entry.reason ?? '').includes('Users')));

    // --- submit -----------------------------------------------------------
    const submitted = await command(port, '/api/v1/tasks', { key: 'key-tasksub001', body: submitBody });
    const submittedBody = JSON.parse(submitted.body);
    const taskId: string = submittedBody.taskId;
    const runId: string = submittedBody.run.id;
    check('a signed, keyed submission answers with the wrapping run summary and the task id',
      submitted.status === 200
        && submittedBody.replayed === false
        && typeof taskId === 'string'
        && submittedBody.run.mode === 'manual'
        && submittedBody.run.repositoryId === 'repo-1'
        && submittedBody.run.participants.length === 1
        && submittedBody.run.participants[0].role === 'worker'
        && submittedBody.run.participants[0].agentName === 'worker'
        && submittedBody.run.teams.length === 1
        && submittedBody.run.tasks.length === 1
        && submittedBody.run.tasks[0].id === taskId
        && submittedBody.run.tasks[0].managed === false
        && ['queued', 'running'].includes(submittedBody.run.tasks[0].status)
        && submittedBody.run.status === 'running', submittedBody);
    check('automatic run and task labels reveal no prompt excerpt or path',
      submittedBody.run.name === 'Single task'
        && submittedBody.run.tasks[0].title === 'Task'
        && !submitted.body.includes(submitBody.prompt.slice(0, 80))
        && !submitted.body.includes(PROMPT_TAIL)
        && !submitted.body.includes(fixture.root));
    check('the submission launched exactly one task session for the chosen agent',
      fixture.launched.length === 1 && fixture.launched[0] === taskId);
    const persistedTask = fixture.orchestration.snapshot().tasks.find((task) => task.id === taskId);
    check('the persisted task is a manual, unmanaged task scoped to the repository',
      persistedTask?.managed === false
        && persistedTask.phase === 'manual'
        && persistedTask.repositoryId === 'repo-1'
        && persistedTask.prompt === submitBody.prompt
        && persistedTask.status === 'running');
    check('the submission is audited as executed against the task id by the device principal',
      fixture.audit.at(-1)?.outcome === 'executed'
        && fixture.audit.at(-1)?.channel === 'runTask:submit'
        && fixture.audit.at(-1)?.target === taskId
        && fixture.audit.at(-1)?.principalKind === 'device');

    // --- idempotency ------------------------------------------------------
    const replay = await command(port, '/api/v1/tasks', { key: 'key-tasksub001', body: submitBody });
    check('retrying the same key and body replays the original run and task without a second launch',
      replay.status === 200
        && JSON.parse(replay.body).replayed === true
        && JSON.parse(replay.body).taskId === taskId
        && JSON.parse(replay.body).run.id === runId
        && fixture.launched.length === 1
        && fixture.orchestration.snapshot().runs.length === 1);
    const reused = await command(port, '/api/v1/tasks', { key: 'key-tasksub001', body: { ...submitBody, prompt: 'Something else entirely' } });
    check('reusing the key with another prompt is refused and launches nothing',
      reused.status === 409 && fixture.launched.length === 1);
    const crossChannel = await command(port, `/api/v1/runs/${runId}/cancel`, { key: 'key-tasksub001' });
    check('a submission key cannot be replayed as another command', crossChannel.status === 409);
    const [first, second] = await Promise.all([
      command(port, '/api/v1/tasks', { key: 'key-taskconc01', body: { ...submitBody, name: 'Concurrent' } }),
      command(port, '/api/v1/tasks', { key: 'key-taskconc01', body: { ...submitBody, name: 'Concurrent' } }),
    ]);
    check('concurrent duplicates of one submission key produce exactly one task and one launch',
      first.status === 200 && second.status === 200
        && JSON.parse(first.body).taskId === JSON.parse(second.body).taskId
        && fixture.launched.length === 2
        && fixture.orchestration.snapshot().runs.length === 2
        && [JSON.parse(first.body).replayed, JSON.parse(second.body).replayed].filter(Boolean).length === 1);

    // --- the run is a plain container, not a managed run ------------------
    const startIt = await command(port, `/api/v1/runs/${runId}/start`, { key: 'key-taskstart1' });
    check('a single-task run cannot be started as a managed orchestration', startIt.status === 422);
    const draft = await command(port, '/api/v1/runs', { key: 'key-taskdraft1', body: { ...createBody, name: 'Draft only' } });
    const draftCancel = await command(port, `/api/v1/runs/${JSON.parse(draft.body).run.id}/cancel`, { key: 'key-taskdraft2' });
    check('cancelling a draft run without any work is a command rejection, not a silent success',
      draft.status === 200 && draftCancel.status === 422 && fixture.cancelled.length === 0);

    // --- journal ----------------------------------------------------------
    await stream.until(() => journalEvents().some((event) => event.type === 'task.started' && event.taskId === taskId), 'task.started');
    const created = journalEvents().find((event) => event.type === 'run.created' && event.runId === runId);
    const queued = journalEvents().find((event) => event.type === 'task.queued' && event.taskId === taskId);
    const transcript = JSON.stringify(stream.frames);
    check('the stream shows the single-task run creation, the queued task and its start in order',
      created?.data?.kind === 'single-task'
        && created.data.repositoryId === 'repo-1'
        && queued !== undefined
        && created.seq < queued.seq
        && queued.seq < journalEvents().find((event) => event.type === 'task.started' && event.taskId === taskId)!.seq);
    check('the stream carries neither the prompt, the workspace path nor the PTY session id',
      !transcript.includes(PROMPT_TAIL)
        && !transcript.includes(submitBody.prompt.slice(0, 80))
        && !transcript.includes(fixture.root)
        && !transcript.includes('pty-1'));

    // --- cancel -----------------------------------------------------------
    const cancelled = await command(port, `/api/v1/runs/${runId}/cancel`, { key: 'key-taskcancel' });
    check('cancelling the wrapping run stops the single task and the derived run status follows',
      cancelled.status === 200
        && fixture.cancelled.includes(taskId)
        && JSON.parse(cancelled.body).run.status === 'cancelled'
        && JSON.parse(cancelled.body).run.tasks[0].status === 'cancelled');
    const cancelReplay = await command(port, `/api/v1/runs/${runId}/cancel`, { key: 'key-taskcancel' });
    check('retrying the cancel replays without cancelling twice',
      cancelReplay.status === 200 && JSON.parse(cancelReplay.body).replayed === true
        && fixture.cancelled.filter((id) => id === taskId).length === 1);
    const runs = await httpRequest(port, '/api/v1/runs', { token });
    check('the runs listing includes the cancelled single-task run without its prompt',
      runs.status === 200
        && (JSON.parse(runs.body) as RunSummary[]).some((run) => run.id === runId && run.status === 'cancelled')
        && !runs.body.includes(submitBody.prompt.slice(0, 80))
        && !runs.body.includes(PROMPT_TAIL));
  } finally {
    stream.close();
    await server.stop();
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

async function testSingleTaskLaunchFailure(): Promise<void> {
  const fixture = createFixture([device], { failLaunch: true });
  const server = new HostApiServer(fixture.application, { authorizer: new RemoteAuthorizer(token, [device]), port: 0 });
  const address = await server.start();
  try {
    const submitted = await command(address.port, '/api/v1/tasks', { key: 'key-taskfail01', body: submitBody });
    const taskId: string = JSON.parse(submitted.body).taskId;
    check('a submission whose launch is refused still answers with the persisted run and task',
      submitted.status === 200 && typeof taskId === 'string' && fixture.launched.length === 1);
    await waitFor(() => fixture.orchestration.snapshot().tasks.find((task) => task.id === taskId)?.status === 'failed',
      'launch failure journaled');
    const task = fixture.orchestration.snapshot().tasks.find((candidate) => candidate.id === taskId);
    const run = fixture.orchestration.snapshot().runs.find((candidate) => candidate.id === task?.runId);
    check('a refused launch fails the task and the wrapping run closed instead of leaving them queued',
      task?.status === 'failed' && typeof task.error === 'string' && run?.status === 'failed');
    const page = fixture.application.events(0);
    const failedEvent = page.events.find((event) => event.type === 'task.failed' && event.taskId === taskId);
    check('the journaled launch failure reaches the wire path-free',
      failedEvent !== undefined
        && typeof failedEvent.data?.error === 'string'
        && !JSON.stringify(page).includes(fixture.root));
    const replay = await command(address.port, '/api/v1/tasks', { key: 'key-taskfail01', body: submitBody });
    check('replaying a failed submission returns the failed task rather than relaunching it',
      replay.status === 200
        && JSON.parse(replay.body).replayed === true
        && JSON.parse(replay.body).run.tasks[0].status === 'failed'
        && fixture.launched.length === 1);
  } finally {
    await server.stop();
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

async function testStreamBackpressure(): Promise<void> {
  console.log('\n== event stream backpressure ==');
  const fixture = createFixture([device]);
  const server = new HostApiServer(fixture.application, {
    authorizer: new RemoteAuthorizer(token, [device]),
    port: 0,
    maxStreamBufferBytes: 64,
  });
  const address = await server.start();
  try {
    const client = new SseClient(address.port, '/api/v1/events');
    await client.ready();
    await client.until(() => client.closed, 'bounded stream closed');
    check('a stream whose unsent bytes exceed the bound is closed instead of buffering unboundedly',
      client.closed && client.frames.length === 0);
    await waitFor(() => server.streamClientCount() === 0, 'backpressure cleanup');
    check('a closed stream releases its client slot', server.streamClientCount() === 0);
  } finally {
    await server.stop();
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

async function testResponseBounds(): Promise<void> {
  const oversizedApplication = new AdeApplicationService(
    { get: () => config },
    { ...staticRuns, summarize: () => Array.from({ length: 4_000 }, () => runSummary) },
    { status: () => ({ active: 0, queued: 0, maxActive: 4 }) },
  );
  const server = new HostApiServer(oversizedApplication, { authorizer: new RemoteAuthorizer(token), port: 0 });
  const address = await server.start();
  try {
    const response = await httpRequest(address.port, '/api/v1/runs', { token });
    check('HTTP adapter fails closed instead of returning an unbounded JSON snapshot',
      response.status === 503
        && JSON.parse(response.body).error === 'response_too_large'
        && !response.body.includes('run-1'));
  } finally {
    await server.stop();
  }
}

async function testErrorRedaction(): Promise<void> {
  const failingApplication = new AdeApplicationService(
    { get: () => { throw new Error('failed at /home/secret/token-value'); } },
    { ...staticRuns, summarize: () => [] },
    { status: () => ({ active: 0, queued: 0, maxActive: 4 }) },
  );
  const server = new HostApiServer(failingApplication, { authorizer: new RemoteAuthorizer(token), port: 0 });
  const address = await server.start();
  try {
    const response = await httpRequest(address.port, '/api/v1/catalog', { token });
    check('HTTP adapter redacts application failures instead of leaking paths or secrets',
      response.status === 500
        && JSON.parse(response.body).error === 'internal_error'
        && !response.body.includes('/home/secret')
        && !response.body.includes('token-value'));
  } finally {
    await server.stop();
  }
}

async function testStartStopRace(): Promise<void> {
  const server = new HostApiServer(application, { authorizer: new RemoteAuthorizer(token), port: 0 });
  const start = server.start();
  const stop = server.stop();
  const outcome = await Promise.race([
    Promise.allSettled([start, stop]).then((results) => ({ kind: 'settled' as const, results })),
    new Promise<{ kind: 'timeout' }>((resolve) => {
      setTimeout(() => resolve({ kind: 'timeout' }), 1_000);
    }),
  ]);
  try {
    check('concurrent app shutdown cleanly fences an in-flight host API start',
      outcome.kind === 'settled'
        && outcome.results.every((result) => result.status === 'fulfilled'), outcome);
  } finally {
    await server.stop().catch(() => undefined);
  }
}

async function testStopWithOpenStream(): Promise<void> {
  const fixture = createFixture([device]);
  const server = new HostApiServer(fixture.application, { authorizer: new RemoteAuthorizer(token, [device]), port: 0 });
  const address = await server.start();
  const client = new SseClient(address.port, '/api/v1/events');
  await client.ready();
  await client.until(() => client.frames.length >= 1, 'snapshot before stop');
  const stopped = await Promise.race([
    server.stop().then(() => 'stopped' as const),
    new Promise<'timeout'>((resolve) => { setTimeout(() => resolve('timeout'), 2_000); }),
  ]);
  check('stopping the host API ends open event streams promptly', stopped === 'stopped');
  await client.until(() => client.closed, 'client sees stream end');
  check('the client observes the stream end on shutdown', client.closed);
  rmSync(fixture.root, { recursive: true, force: true });
}

async function testDurableDeviceRevocation(): Promise<void> {
  const protection: DeviceSecretProtection = { available: () => true,
    encrypt: (value) => Buffer.from(value.split('').reverse().join('')),
    decrypt: (value) => value.toString().split('').reverse().join('') };
  let devices: RemoteDeviceStore;
  const fixture = createFixture([device], { audit: (entry) => devices.audit(entry) });
  const deviceDir = join(fixture.root, 'remote');
  devices = new RemoteDeviceStore(deviceDir, protection);
  devices.importBootstrap([device]);
  const otherDevice: RemoteDevice = { id: 'other-phone', secret: 'o'.repeat(40), scopes: ['read', 'runs:write'] };
  const otherStore = new RemoteDeviceStore(join(fixture.root, 'other-device'), protection);
  otherStore.importBootstrap([otherDevice]);
  const authorizer = new RemoteAuthorizer(token, [], undefined, {
    activeDevices: () => [...devices.activeDevices(), ...otherStore.activeDevices()],
    onRevoked: (listener) => {
      const off = devices.onRevoked(listener);
      const offOther = otherStore.onRevoked(listener);
      return () => { off(); offOther(); };
    },
  });
  let server = new HostApiServer(fixture.application, { authorizer, port: 0, requireDeviceReads: true,
    audit: (entry) => devices.audit(entry) });
  let address = await server.start();
  const readHeaders = (path: string, identity = device): Record<string, string> => {
    const timestamp = String(Date.now());
    return { 'x-ade-device': identity.id, 'x-ade-timestamp': timestamp,
      'x-ade-signature': signRequest(identity.secret, { method: 'GET', path, timestamp,
        idempotencyKey: '', bodySha256: sha256Hex('') }) };
  };
  let client: SseClient | null = null;
  let otherClient: SseClient | null = null;
  try {
    for (const path of ['/api/v1/health', '/api/v1/catalog', '/api/v1/runs', '/api/v1/events']) {
      const denied = await httpRequest(address.port, path, { token });
      check(`durable mode refuses bearer-only ${path}`, denied.status === 401 && !denied.body.includes('repo-1'));
    }
    const catalog = await httpRequest(address.port, '/api/v1/catalog', { token, headers: readHeaders('/api/v1/catalog') });
    check('durable device can read sanitized catalog', catalog.status === 200 && catalog.body.includes('repo-1') && !catalog.body.includes(fixture.root));
    const wrongPath = await httpRequest(address.port, '/api/v1/runs', { token, headers: readHeaders('/api/v1/catalog') });
    check('device read proof binds the exact request target', wrongPath.status === 401);
    client = new SseClient(address.port, '/api/v1/events?cursor=0', readHeaders('/api/v1/events?cursor=0'));
    await client.ready();
    await client.until(() => client!.frames.length > 0, 'durable device snapshot');
    check('device-bound SSE opens with a snapshot', client.status === 200 && server.streamClientCount() === 1);
    const created = await command(address.port, '/api/v1/runs', { key: 'durable-create-1', body: createBody });
    check('durable device creates a run', created.status === 200);
    const journal = readFileSync(devices.auditPath, 'utf8');
    check('command admission and outcome reach the durable audit with attribution', journal.includes('requested') && journal.includes('executed')
      && journal.includes('run:create') && journal.includes('phone-1') && !journal.includes(createBody.goal));
    check('signature and bearer denials reach the durable audit with their reason', journal.includes('http:request') && journal.includes('unknown_device'));
    devices.rename(device.id, 'Renamed phone');
    check('renaming keeps an existing stream connected', !client.closed && server.streamClientCount() === 1);
    otherClient = new SseClient(address.port, '/api/v1/events', readHeaders('/api/v1/events', otherDevice));
    await otherClient.ready();
    await otherClient.until(() => otherClient!.frames.length > 0, 'other device snapshot');
    devices.revoke(device.id);
    await client.until(() => client!.closed, 'revocation disconnect');
    await waitFor(() => server.streamClientCount() === 1, 'stream cleanup after revocation');
    check('revocation immediately disconnects the device SSE client', client.closed && server.streamClientCount() === 1);
    check('revocation leaves another device connected and authorized', !otherClient.closed
      && (await httpRequest(address.port, '/api/v1/catalog', { token, headers: readHeaders('/api/v1/catalog', otherDevice) })).status === 200);
    for (const path of ['/api/v1/catalog', '/api/v1/runs', '/api/v1/events']) {
      const denied = await httpRequest(address.port, path, { token, headers: readHeaders(path) });
      check(`revoked device cannot reconnect to ${path}`, denied.status === 401);
    }
    const count = fixture.store.get().runs.length;
    const deniedCommand = await command(address.port, '/api/v1/runs', { key: 'durable-create-2', body: createBody });
    check('revoked commands cannot create work', deniedCommand.status === 401 && fixture.store.get().runs.length === count);
    await server.stop();
    devices = new RemoteDeviceStore(deviceDir, protection);
    devices.importBootstrap([device]);
    server = new HostApiServer(fixture.application, { authorizer, port: 0, requireDeviceReads: true, audit: (entry) => devices.audit(entry) });
    address = await server.start();
    check('host restart plus stale bootstrap preserves revocation',
      (await command(address.port, '/api/v1/runs', { key: 'durable-create-3', body: createBody })).status === 401);

    await server.stop();
    devices = new RemoteDeviceStore(join(fixture.root, 'fresh-remote'), protection);
    devices.importBootstrap([device]);
    server = new HostApiServer(fixture.application, { authorizer, port: 0, requireDeviceReads: true, audit: (entry) => devices.audit(entry) });
    address = await server.start();
    appendFileSync(devices.auditPath, '{torn');
    const blocked = await command(address.port, '/api/v1/runs', { key: 'durable-audit-fail', body: createBody })
      .catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ECONNRESET') throw error; return { status: 0 }; });
    check('failed durable admission disconnects the caller before executing work', blocked.status === 0 && fixture.store.get().runs.length === count);
    check('audit failure disables device authorization', !authorizer.isActive(device.id));
    await server.stop();
    devices = new RemoteDeviceStore(join(fixture.root, 'positive-remote'), protection);
    devices.importBootstrap([device]);
    server = new HostApiServer(fixture.application, { authorizer, port: 0, requireDeviceReads: true, audit: (entry) => devices.audit(entry) });
    address = await server.start();
    check('final positive device control can create work after negative controls',
      (await command(address.port, '/api/v1/runs', { key: 'durable-positive', body: createBody })).status === 200);
  } finally {
    client?.close();
    otherClient?.close();
    await server.stop();
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

void (async () => {
  await testDurableDeviceRevocation();
  await testReadAdapter();
  await testCommandsAndStream();
  await testSingleTaskSubmission();
  await testSingleTaskLaunchFailure();
  await testStreamBackpressure();
  await testResponseBounds();
  await testErrorRedaction();
  await testStartStopRace();
  await testStopWithOpenStream();
})()
  .catch((error) => {
    failed += 1;
    console.error('FAIL  HTTP adapter test crashed', error);
  })
  .finally(() => {
    console.log(`\nHost API: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  });
