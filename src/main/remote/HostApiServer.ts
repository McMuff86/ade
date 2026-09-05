import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AdeApplicationService, RemoteApiError, type RemoteCommandContext } from '../application/AdeApplicationService';
import { redactedErrorDetail } from '../errors';
import type { MobileErrorBody, MobileErrorCode } from '../../shared/remote';
import { HOST_API_LOOPBACK } from './hostApiConfig';
import { RemoteAuthorizer, sha256Hex, type RemotePrincipal } from './authorization';

export interface HostApiAddress {
  host: typeof HOST_API_LOOPBACK;
  port: number;
}

export interface HostApiServerOptions {
  authorizer: RemoteAuthorizer;
  port: number;
  /** SSE keep-alive comment interval. */
  heartbeatMs?: number;
  /** Concurrent event-stream clients; more are refused with 503. */
  maxStreamClients?: number;
  /** Unsent bytes per stream before the connection is closed for the client to resume. */
  maxStreamBufferBytes?: number;
  /** Largest accepted JSON request body. */
  maxBodyBytes?: number;
}

const RESPONSE_HEADERS = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
} as const;

const JSON_HEADERS = { ...RESPONSE_HEADERS, 'content-type': 'application/json; charset=utf-8' } as const;

const MAX_RESPONSE_BYTES = 512 * 1_024;
const DEFAULT_MAX_BODY_BYTES = 64 * 1_024;
/** Refused bodies up to this size are drained so the client still reads the error. */
const DISCARD_BODY_LIMIT_BYTES = 1_024 * 1_024;
const DEFAULT_HEARTBEAT_MS = 15_000;
const DEFAULT_MAX_STREAM_CLIENTS = 8;
const DEFAULT_MAX_STREAM_BUFFER_BYTES = 256 * 1_024;
const STREAM_PAGE_LIMIT = 200;
const SSE_RETRY_MS = 2_000;
const RUN_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const CURSOR_PATTERN = /^\d{1,16}$/;
const REQUEST_ID_HEADER = 'x-ade-request-id';

type Route =
  | { kind: 'health' | 'catalog' | 'runs' | 'events' | 'tasks' }
  | { kind: 'startRun' | 'cancelRun'; runId: string };

type CommandKind = 'createRun' | 'startRun' | 'cancelRun' | 'submitTask';

interface ParsedTarget {
  path: string;
  query: string | null;
}

function writeJson(response: ServerResponse, status: number, value: unknown, extra: Record<string, string> = {}): void {
  let responseStatus = status;
  let body = `${JSON.stringify(value)}\n`;
  if (status < 400 && Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) {
    responseStatus = 503;
    body = `${JSON.stringify({ error: 'response_too_large' } satisfies MobileErrorBody)}\n`;
  }
  response.writeHead(responseStatus, {
    ...JSON_HEADERS,
    ...extra,
    'content-length': Buffer.byteLength(body, 'utf8'),
  });
  response.end(body);
}

function writeError(
  response: ServerResponse,
  status: number,
  code: MobileErrorCode,
  message?: string,
  extra: Record<string, string> = {},
): void {
  const body: MobileErrorBody = message ? { error: code, message } : { error: code };
  writeJson(response, status, body, extra);
}

function parseTarget(requestTarget: string): ParsedTarget | null {
  if (!requestTarget.startsWith('/') || requestTarget.startsWith('//')) return null;
  const separator = requestTarget.indexOf('?');
  if (separator === -1) return { path: requestTarget, query: null };
  return { path: requestTarget.slice(0, separator), query: requestTarget.slice(separator + 1) };
}

/** Exact raw-path routing: no normalization, no trailing slashes, no aliases. */
function matchRoute(path: string): { route: Route; allow: string[] } | null {
  switch (path) {
    case '/api/v1/health': return { route: { kind: 'health' }, allow: ['GET'] };
    case '/api/v1/catalog': return { route: { kind: 'catalog' }, allow: ['GET'] };
    case '/api/v1/runs': return { route: { kind: 'runs' }, allow: ['GET', 'POST'] };
    case '/api/v1/tasks': return { route: { kind: 'tasks' }, allow: ['POST'] };
    case '/api/v1/events': return { route: { kind: 'events' }, allow: ['GET'] };
    default: {
      const match = /^\/api\/v1\/runs\/([^/]+)\/(start|cancel)$/.exec(path);
      if (!match || !RUN_ID_PATTERN.test(match[1]!)) return null;
      return {
        route: { kind: match[2] === 'start' ? 'startRun' : 'cancelRun', runId: match[1]! },
        allow: ['POST'],
      };
    }
  }
}

function singleHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}

/**
 * Disabled-by-default startup is owned by the Electron lifecycle. This adapter
 * itself has no configurable bind address: every listener is IPv4 loopback.
 * Reads need the bearer token; commands additionally need a signed device
 * proof and an idempotency key, enforced by the application service against
 * the channel policy. The event stream resumes from the journal `seq`.
 */
export class HostApiServer {
  private server: Server | null = null;
  private address: HostApiAddress | null = null;
  private starting: Promise<void> | null = null;
  private readonly authorizer: RemoteAuthorizer;
  private readonly port: number;
  private readonly heartbeatMs: number;
  private readonly maxStreamClients: number;
  private readonly maxStreamBufferBytes: number;
  private readonly maxBodyBytes: number;
  private readonly streams = new Set<() => void>();

  constructor(
    private readonly application: AdeApplicationService,
    options: HostApiServerOptions,
  ) {
    this.authorizer = options.authorizer;
    this.port = options.port;
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.maxStreamClients = options.maxStreamClients ?? DEFAULT_MAX_STREAM_CLIENTS;
    this.maxStreamBufferBytes = options.maxStreamBufferBytes ?? DEFAULT_MAX_STREAM_BUFFER_BYTES;
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  }

  async start(): Promise<HostApiAddress> {
    if (this.server || this.address) throw new Error('ade: host API is already started');
    const server = createServer((request, response) => {
      void this.handle(request, response);
    });
    // Header/request timeouts protect against slowloris-style clients. Both
    // count until the request message is complete, so an open SSE response
    // (whose request finished with its headers) is not affected.
    server.requestTimeout = 10_000;
    server.headersTimeout = 5_000;
    server.keepAliveTimeout = 5_000;
    this.server = server;

    const starting = new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.port, HOST_API_LOOPBACK);
    });
    this.starting = starting;
    try {
      await starting;
    } catch (error) {
      this.server = null;
      if (server.listening) server.close();
      throw error;
    } finally {
      if (this.starting === starting) this.starting = null;
    }

    const address = server.address();
    if (!address || typeof address === 'string') {
      await this.stop();
      throw new Error('ade: host API did not acquire a TCP address');
    }
    this.address = {
      host: HOST_API_LOOPBACK,
      port: (address as AddressInfo).port,
    };
    return { ...this.address };
  }

  async stop(): Promise<void> {
    const starting = this.starting;
    if (starting) await starting.catch(() => undefined);
    const server = this.server;
    this.server = null;
    this.address = null;
    for (const close of [...this.streams]) close();
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      // Ended stream responses leave keep-alive sockets idle; drop them so
      // shutdown does not wait for the client's keep-alive timeout.
      server.closeIdleConnections();
    });
  }

  /** Live event-stream clients (for tests and health diagnostics). */
  streamClientCount(): number {
    return this.streams.size;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = randomUUID();
    response.setHeader(REQUEST_ID_HEADER, requestId);
    const address = this.address;
    if (!address) {
      writeError(response, 503, 'unavailable');
      return;
    }

    const host = request.headers.host?.toLowerCase();
    const allowedHosts = new Set([
      `${HOST_API_LOOPBACK}:${address.port}`,
      `localhost:${address.port}`,
    ]);
    if (!host || !allowedHosts.has(host)) {
      writeError(response, 400, 'invalid_host');
      return;
    }

    // No browser client is authorized yet. The paired PWA will add an exact
    // configured origin; accepting arbitrary origins now would create a
    // DNS-rebinding/CORS policy that later code might accidentally keep.
    if (request.headers.origin !== undefined) {
      writeError(response, 403, 'origin_not_allowed');
      return;
    }

    const bearer = this.authorizer.authenticateBearer(singleHeader(request, 'authorization'));
    if (!bearer) {
      writeError(response, 401, 'unauthorized', undefined, { 'www-authenticate': 'Bearer' });
      return;
    }

    const target = parseTarget(request.url ?? '/');
    if (!target) {
      writeError(response, 400, 'invalid_request_target');
      return;
    }
    const matched = matchRoute(target.path);
    if (!matched) {
      writeError(response, 404, 'not_found');
      return;
    }
    // Query strings exist for exactly one purpose: the stream cursor.
    if (target.query !== null && matched.route.kind !== 'events') {
      writeError(response, 404, 'not_found');
      return;
    }
    const method = request.method ?? '';
    if (!matched.allow.includes(method)) {
      writeError(response, 405, 'method_not_allowed', undefined, { allow: matched.allow.join(', ') });
      return;
    }

    try {
      switch (matched.route.kind) {
        case 'health':
          writeJson(response, 200, this.application.health());
          return;
        case 'catalog':
          writeJson(response, 200, this.application.catalog());
          return;
        case 'runs':
          if (method === 'GET') {
            writeJson(response, 200, this.application.runs());
            return;
          }
          await this.handleCommand(request, response, requestId, bearer, target.path, 'createRun');
          return;
        case 'tasks':
          await this.handleCommand(request, response, requestId, bearer, target.path, 'submitTask');
          return;
        case 'events':
          this.handleStream(request, response, target.query);
          return;
        case 'startRun':
        case 'cancelRun':
          await this.handleCommand(
            request, response, requestId, bearer, target.path, matched.route.kind, matched.route.runId,
          );
          return;
      }
    } catch (error) {
      this.fail(response, error);
    }
  }

  /**
   * Command pipeline: bounded JSON body → per-request device signature →
   * application command (policy requirement, scope, idempotency, validation,
   * domain). Every rejection reaches the wire only as a stable code plus a
   * redacted, bounded message.
   */
  private async handleCommand(
    request: IncomingMessage,
    response: ServerResponse,
    requestId: string,
    bearer: RemotePrincipal,
    path: string,
    kind: CommandKind,
    runId?: string,
  ): Promise<void> {
    const expectsJson = kind === 'createRun' || kind === 'submitTask';
    const body = await this.readBody(request, response, expectsJson);
    if (body === null) return;

    let principal = bearer;
    const deviceId = singleHeader(request, 'x-ade-device');
    const signature = singleHeader(request, 'x-ade-signature');
    const timestamp = singleHeader(request, 'x-ade-timestamp');
    const idempotencyKey = singleHeader(request, 'idempotency-key');
    if (deviceId !== undefined || signature !== undefined || timestamp !== undefined) {
      if (deviceId === undefined || signature === undefined || timestamp === undefined) {
        writeError(response, 401, 'invalid_signature');
        return;
      }
      const verdict = this.authorizer.verifyDeviceSignature(deviceId, signature, {
        method: request.method ?? '',
        path,
        timestamp,
        idempotencyKey: idempotencyKey ?? '',
        bodySha256: sha256Hex(body),
      });
      if (!verdict.ok) {
        writeError(response, 401, verdict.reason);
        return;
      }
      principal = verdict.principal;
    }

    const context: RemoteCommandContext = { principal, idempotencyKey, requestId };
    let payload: unknown = undefined;
    if (expectsJson) {
      try {
        payload = JSON.parse(body.toString('utf8'));
      } catch {
        writeError(response, 400, 'invalid_payload', 'body is not valid JSON');
        return;
      }
    }

    try {
      const result = kind === 'createRun'
        ? await this.application.createRun(context, payload)
        : kind === 'submitTask'
          ? await this.application.submitTask(context, payload)
          : kind === 'startRun'
            ? await this.application.startRun(context, runId!)
            : await this.application.cancelRun(context, runId!);
      writeJson(response, 200, result);
    } catch (error) {
      if (error instanceof RemoteApiError) {
        const detailed = error.status === 400 || error.status === 409 || error.status === 422;
        writeError(response, error.status, error.code, detailed ? error.message : undefined);
        return;
      }
      this.fail(response, error);
    }
  }

  /**
   * Read a bounded request body. Commands with a payload must declare
   * `application/json` and an exact `content-length`; start/cancel carry no
   * body. Returns null after writing the error response.
   */
  private async readBody(
    request: IncomingMessage,
    response: ServerResponse,
    expectsJson: boolean,
  ): Promise<Buffer | null> {
    const lengthHeader = singleHeader(request, 'content-length');
    const declared = lengthHeader !== undefined && /^\d{1,10}$/.test(lengthHeader) ? Number(lengthHeader) : null;
    // Refusing before the body is consumed: discard a small body so the
    // client can still read the answer, otherwise close the connection
    // right after the response instead of buffering a hostile payload.
    const refuse = (status: number, code: MobileErrorCode, message?: string): null => {
      if (declared !== null && declared <= DISCARD_BODY_LIMIT_BYTES) request.resume();
      else response.once('finish', () => request.destroy());
      writeError(response, status, code, message, { connection: 'close' });
      return null;
    };
    if (request.headers['transfer-encoding'] !== undefined || declared === null) {
      return refuse(411, 'length_required');
    }
    if (declared > this.maxBodyBytes) return refuse(413, 'payload_too_large');
    if (expectsJson) {
      const contentType = singleHeader(request, 'content-type')?.toLowerCase().replace(/\s+/g, '') ?? '';
      if (contentType !== 'application/json' && contentType !== 'application/json;charset=utf-8') {
        return refuse(415, 'unsupported_media_type');
      }
      if (declared === 0) return refuse(400, 'invalid_payload', 'body is required');
    } else if (declared !== 0) {
      return refuse(400, 'invalid_payload', 'this command takes no body');
    }

    const chunks: Buffer[] = [];
    let received = 0;
    const body = await new Promise<Buffer | null>((resolve) => {
      request.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > declared || received > this.maxBodyBytes) {
          resolve(null);
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on('end', () => resolve(Buffer.concat(chunks)));
      request.on('error', () => resolve(null));
      request.on('close', () => resolve(chunks.length && received === declared ? Buffer.concat(chunks) : null));
    });
    if (body === null || body.length !== declared) {
      if (!response.headersSent) writeError(response, 413, 'payload_too_large');
      return null;
    }
    return body;
  }

  /**
   * Resumable server-sent events over the journal seq. Without a usable
   * cursor the client first receives one bundled `snapshot`; afterwards every
   * `journal` message carries records strictly after the previous `id`. A
   * stalled client whose unsent bytes exceed the bound is disconnected and
   * resumes from its last id — the journal is durable, so nothing is lost.
   */
  private handleStream(request: IncomingMessage, response: ServerResponse, query: string | null): void {
    const accept = singleHeader(request, 'accept') ?? '';
    if (!accept.split(',').some((part) => part.trim().toLowerCase().startsWith('text/event-stream'))) {
      writeError(response, 406, 'not_acceptable');
      return;
    }
    const cursor = this.streamCursor(request, query);
    if (cursor === 'invalid') {
      writeError(response, 400, 'invalid_payload', 'cursor must be a non-negative integer');
      return;
    }
    if (this.streams.size >= this.maxStreamClients) {
      writeError(response, 503, 'too_many_streams', undefined, { 'retry-after': '5' });
      return;
    }

    request.socket.setNoDelay(true);
    request.socket.setTimeout(0);
    response.writeHead(200, {
      ...RESPONSE_HEADERS,
      'content-type': 'text/event-stream; charset=utf-8',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    response.write(`retry: ${SSE_RETRY_MS}\n\n`);

    let lastSent = 0;
    let closed = false;
    let scheduled = false;
    let waitingForDrain = false;

    const close = (): void => {
      if (closed) return;
      closed = true;
      this.streams.delete(close);
      unsubscribe();
      clearInterval(heartbeat);
      if (!response.writableEnded) response.end();
    };

    const send = (event: 'snapshot' | 'journal', id: number, data: unknown): boolean => {
      if (closed) return false;
      const frame = `event: ${event}\nid: ${id}\ndata: ${JSON.stringify(data)}\n\n`;
      if (response.writableLength + Buffer.byteLength(frame, 'utf8') > this.maxStreamBufferBytes) {
        // The client is not keeping up. Closing lets it resume from its last
        // id instead of letting one slow phone grow main-process memory.
        response.destroy();
        close();
        return false;
      }
      const ok = response.write(frame);
      if (!ok) {
        waitingForDrain = true;
        response.once('drain', () => {
          waitingForDrain = false;
          schedule();
        });
      }
      return true;
    };

    const flush = (): void => {
      scheduled = false;
      while (!closed && !waitingForDrain) {
        const page = this.application.events(lastSent, STREAM_PAGE_LIMIT);
        if (page.events.length === 0 && page.messages.length === 0) return;
        if (!send('journal', page.cursor, page)) return;
        lastSent = page.cursor;
      }
    };

    const schedule = (): void => {
      if (closed || scheduled || waitingForDrain) return;
      scheduled = true;
      setImmediate(flush);
    };

    const unsubscribe = this.application.subscribe(schedule);
    const heartbeat = setInterval(() => {
      if (closed) return;
      if (!response.write(': ping\n\n')) waitingForDrain = true;
    }, this.heartbeatMs);
    heartbeat.unref();
    this.streams.add(close);
    response.on('close', close);
    response.on('error', close);

    try {
      const top = this.application.journalCursor();
      if (cursor === undefined || cursor === 0 || cursor > top) {
        // Unknown or unusable cursor: bundle the current picture first.
        const snapshot = this.application.snapshot();
        lastSent = snapshot.cursor;
        if (!send('snapshot', snapshot.cursor, snapshot)) return;
      } else {
        lastSent = cursor;
      }
      flush();
    } catch (error) {
      console.warn('[ade] host API stream failed:', redactedErrorDetail(error));
      response.destroy();
      close();
    }
  }

  /** `Last-Event-ID` (EventSource reconnect) or `?cursor=` (first connect); both must agree. */
  private streamCursor(request: IncomingMessage, query: string | null): number | undefined | 'invalid' {
    const fromHeader = singleHeader(request, 'last-event-id');
    let fromQuery: string | undefined;
    if (query !== null) {
      const match = /^cursor=(\d{1,16})$/.exec(query);
      if (!match) return 'invalid';
      fromQuery = match[1];
    }
    if (fromHeader !== undefined && !CURSOR_PATTERN.test(fromHeader)) return 'invalid';
    if (fromHeader !== undefined && fromQuery !== undefined && fromHeader !== fromQuery) return 'invalid';
    const raw = fromHeader ?? fromQuery;
    if (raw === undefined) return undefined;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : 'invalid';
  }

  private fail(response: ServerResponse, error: unknown): void {
    // Application errors may contain paths or provider details. Keep the wire
    // free of them; the main-process log gets the redacted detail only.
    console.warn('[ade] host API request failed:', redactedErrorDetail(error));
    if (!response.headersSent) {
      writeError(response, 500, 'internal_error');
    } else {
      response.destroy();
    }
  }
}
