import { t as translate } from "../../shared/i18n";
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';

export interface UsageLog { name: string; attributes: Record<string, string | number> }
const MAX_BYTES = 1024 * 1024;
const KEYS = new Set(['event.name', 'event.timestamp', 'event.sequence', 'conversation.id', 'session.id', 'model',
  'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_creation_tokens', 'cost_usd', 'request_id', 'client_request_id']);
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown, limit: number): unknown[] => {
  if (!Array.isArray(value) || value.length > limit) throw new Error('invalid OTLP collection'); return value;
};
function scalar(value: unknown): string | number | undefined {
  const item = object(value);
  if (typeof item.stringValue === 'string' && item.stringValue.length <= 200 && /^[A-Za-z0-9_.:+/-]+$/.test(item.stringValue)) return item.stringValue;
  if (typeof item.doubleValue === 'number' && Number.isFinite(item.doubleValue)) return item.doubleValue;
  if (typeof item.intValue === 'string' && /^-?\d{1,16}$/.test(item.intValue) || typeof item.intValue === 'number') {
    const number = Number(item.intValue); if (Number.isSafeInteger(number)) return number;
  }
  return undefined;
}

/** Project only known numeric/identity attributes. Log bodies, prompts,
 * resource attributes, user identifiers and tool details are never retained. */
export function projectUsageLogs(value: unknown): UsageLog[] {
  const result: UsageLog[] = []; let inspected = 0;
  for (const resource of list(object(value).resourceLogs, 32)) for (const scope of list(object(resource).scopeLogs, 32)) {
    for (const raw of list(object(scope).logRecords, 512)) {
      if (++inspected > 512) throw new Error('too many OTLP logs');
      const log = object(raw); const attributes: UsageLog['attributes'] = {};
      for (const rawAttribute of list(log.attributes ?? [], 128)) {
        const attribute = object(rawAttribute); if (typeof attribute.key !== 'string' || !KEYS.has(attribute.key)) continue;
        if (Object.hasOwn(attributes, attribute.key)) throw new Error('duplicate OTLP attribute');
        const parsed = scalar(attribute.value); if (parsed !== undefined) attributes[attribute.key] = parsed;
      }
      const name = [log.eventName, object(log.body).stringValue, attributes['event.name']].find(candidate => typeof candidate === 'string'
        && /^(codex\.(conversation_starts|sse_event)|claude_code\.api_request)$/.test(candidate));
      if (typeof name === 'string') result.push({ name, attributes });
    }
  }
  return result;
}

/** Private loopback receiver for per-launch native CLI telemetry. This is
 * independent of the browser host API and accepts no browser origins. */
export class OtlpUsageReceiver {
  private server?: Server;
  private opening?: Promise<void>;
  private port = 0;
  private inFlight = 0;
  private closing = false;
  private readonly consumers = new Map<string, (logs: UsageLog[]) => Promise<void>>();
  private digest(token: string): string { return createHash('sha256').update(token).digest('hex'); }

  async register(consume: (logs: UsageLog[]) => Promise<void>): Promise<{ endpoint: string; header: string; release(): void }> {
    if (this.closing) throw new Error(translate("Usage collector is closing."));
    if (this.consumers.size >= 128) throw new Error(translate("Usage collector has too many active sessions."));
    await (this.opening ??= this.listen());
    if (this.closing || this.consumers.size >= 128) throw new Error(translate("Usage collector is unavailable."));
    const token = randomBytes(32).toString('hex'); const key = this.digest(token); this.consumers.set(key, consume);
    return { endpoint: `http://127.0.0.1:${this.port}/v1/logs`, header: `x-ade-usage-token=${token}`,
      release: () => { this.consumers.delete(key); } };
  }
  async close(): Promise<void> {
    this.closing = true; await this.opening?.catch(() => undefined);
    this.consumers.clear(); const server = this.server; this.server = undefined;
    if (server) { server.closeIdleConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }

  private async listen(): Promise<void> {
    this.server = createServer(async (request, response) => {
      const reply = (status: number) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'connection': 'close' }); response.end(status === 200 ? '{}' : '{"error":"usage_unavailable"}'); };
      const token = request.headers['x-ade-usage-token'];
      const consume = typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? this.consumers.get(this.digest(token)) : undefined;
      if (request.method !== 'POST' || request.url !== '/v1/logs' || request.headers.host !== `127.0.0.1:${this.port}`
        || request.headers.origin !== undefined || !consume || this.inFlight >= 4
        || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(String(request.headers['content-type'] ?? ''))
        || request.headers['content-encoding'] !== undefined && request.headers['content-encoding'] !== 'identity') {
        reply(403); request.resume(); return;
      }
      const declared = request.headers['content-length'];
      if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) { reply(413); request.resume(); return; }
      this.inFlight++; const chunks: Buffer[] = []; let bytes = 0;
      const timer = setTimeout(() => request.destroy(), 5000); timer.unref();
      try {
        for await (const chunk of request) {
          bytes += chunk.length; if (bytes > MAX_BYTES) { request.destroy(); return; } chunks.push(chunk);
        }
        const logs = projectUsageLogs(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        if (this.consumers.get(this.digest(token as string)) !== consume) { reply(403); return; }
        await consume(logs); if (!response.destroyed) reply(200);
      } catch { if (!response.destroyed) reply(400); }
      finally { clearTimeout(timer); this.inFlight--; }
    });
    this.server.headersTimeout = 6000; this.server.requestTimeout = 10000;
    this.server.maxConnections = 16;
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject); this.server!.listen(0, '127.0.0.1', () => {
        const address = this.server!.address(); if (!address || typeof address === 'string') { reject(new Error(translate("Usage collector unavailable."))); return; }
        this.port = address.port; resolve();
      });
    });
  }
}
