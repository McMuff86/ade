import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AdeApplicationService } from '../application/AdeApplicationService';
import { HOST_API_LOOPBACK } from './hostApiConfig';

export interface HostApiAddress {
  host: typeof HOST_API_LOOPBACK;
  port: number;
}

const RESPONSE_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
} as const;

function authorized(header: string | undefined, token: string): boolean {
  if (!header) return false;
  const supplied = Buffer.from(header, 'utf8');
  const expected = Buffer.from(`Bearer ${token}`, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

const MAX_RESPONSE_BYTES = 512 * 1_024;

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  let responseStatus = status;
  let body = `${JSON.stringify(value)}\n`;
  if (status < 400 && Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) {
    responseStatus = 503;
    body = `${JSON.stringify({ error: 'response_too_large' })}\n`;
  }
  response.writeHead(responseStatus, {
    ...RESPONSE_HEADERS,
    'content-length': Buffer.byteLength(body, 'utf8'),
  });
  response.end(body);
}

/**
 * Disabled-by-default startup is owned by the Electron lifecycle. This adapter
 * itself has no configurable bind address: every listener is IPv4 loopback.
 */
export class HostApiServer {
  private server: Server | null = null;
  private address: HostApiAddress | null = null;
  private starting: Promise<void> | null = null;

  constructor(
    private readonly application: AdeApplicationService,
    private readonly token: string,
    private readonly port: number,
  ) {}

  async start(): Promise<HostApiAddress> {
    if (this.server || this.address) throw new Error('ade: host API is already started');
    const server = createServer((request, response) => this.handle(request, response));
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
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    const address = this.address;
    if (!address) {
      writeJson(response, 503, { error: 'unavailable' });
      return;
    }

    const host = request.headers.host?.toLowerCase();
    const allowedHosts = new Set([
      `${HOST_API_LOOPBACK}:${address.port}`,
      `localhost:${address.port}`,
    ]);
    if (!host || !allowedHosts.has(host)) {
      writeJson(response, 400, { error: 'invalid_host' });
      return;
    }

    // No browser client is authorized in this foundation slice. The paired PWA
    // will add an exact configured origin; accepting arbitrary origins now would
    // create a DNS-rebinding/CORS policy that later code might accidentally keep.
    if (request.headers.origin !== undefined) {
      writeJson(response, 403, { error: 'origin_not_allowed' });
      return;
    }

    if (!authorized(request.headers.authorization, this.token)) {
      response.setHeader('www-authenticate', 'Bearer');
      writeJson(response, 401, { error: 'unauthorized' });
      return;
    }

    if (request.method !== 'GET') {
      response.setHeader('allow', 'GET');
      writeJson(response, 405, { error: 'method_not_allowed' });
      return;
    }

    const requestTarget = request.url ?? '/';
    if (!requestTarget.startsWith('/') || requestTarget.startsWith('//')) {
      writeJson(response, 400, { error: 'invalid_request_target' });
      return;
    }

    try {
      switch (requestTarget) {
        case '/api/v1/health':
          writeJson(response, 200, this.application.health());
          return;
        case '/api/v1/catalog':
          writeJson(response, 200, this.application.catalog());
          return;
        case '/api/v1/runs':
          writeJson(response, 200, this.application.runs());
          return;
        default:
          writeJson(response, 404, { error: 'not_found' });
      }
    } catch {
      // Application errors may contain paths or provider details. Keep both the
      // wire response and local log free of those values. The raw request target
      // is untrusted too, so it is deliberately not logged.
      console.warn('[ade] host API request failed');
      if (!response.headersSent) {
        writeJson(response, 500, { error: 'internal_error' });
      } else {
        response.destroy();
      }
    }
  }
}
