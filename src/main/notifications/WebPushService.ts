import { createHash, randomUUID } from 'node:crypto';
import type { RunEvent } from '../../shared/types';
import type { MobilePushCommand, MobilePushKind, MobilePushPayload, MobilePushStatus } from '../../shared/remote';
import { PushStore, type PushDevice } from './PushStore';
import { sendWebPush, type PushTransport } from './pushTransport';

export interface PushSource {
  cursor(): number;
  events(after: number): { events: RunEvent[]; nextCursor: number };
  active(id: string): boolean;
  allowed(id: string, runId: string): boolean;
  completed(runId: string): boolean;
  subscribe?(changed: () => void): () => void;
}
const defaults = () => ({ question: true, error: true, result: true });
const TEST_COOLDOWN_MS = 30_000;
const kindOf = (event: RunEvent): MobilePushKind | null => event.type === 'question.requested' ? 'question'
  : event.type === 'run.completed' || event.type === 'task.completed' ? 'result' : event.type === 'run.failed' || event.type === 'task.failed' ? 'error' : null;
const tagFor = (device: string, key: string) => createHash('sha256').update(`${device}:${key}`).digest('hex').slice(0, 32);

/** Optional observer only: never mutates work. Reserve cursor/dedup before the
 * outbound request. Unknown delivery is not retried, including after restart. */
export class WebPushService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private disposed = false;
  private unsubscribe: (() => void) | undefined;
  private sending = new Map<string, AbortController>();
  constructor(private readonly store: PushStore, private readonly source: PushSource,
    private readonly transport: PushTransport = sendWebPush, private readonly now = Date.now) {}
  start(): void {
    if (this.timer || this.disposed) return;
    this.unsubscribe = this.source.subscribe?.(() => { queueMicrotask(() => { void this.poll(); }); });
    this.timer = setInterval(() => { void this.poll(); }, 2000); this.timer.unref();
  }
  dispose(): void { this.disposed = true; this.unsubscribe?.(); if (this.timer) clearInterval(this.timer); this.timer = null; for (const c of this.sending.values()) c.abort(); }
  status(id: string): MobilePushStatus {
    if (!this.store.available()) return { available: false, publicKey: null, enabled: false, preferences: defaults(), last: null, testRetryAfterMs: 0 };
    const state = this.store.get(); const d = state.devices.find(d => d.id === id);
    const testRetryAfterMs = d ? Math.min(TEST_COOLDOWN_MS, Math.max(0, d.testAt + TEST_COOLDOWN_MS - this.now())) : 0;
    return { available: true, publicKey: state.keys.publicKey, enabled: !!d, preferences: d?.preferences ?? defaults(), last: d?.last ?? null, testRetryAfterMs };
  }
  async command(id: string, command: MobilePushCommand): Promise<MobilePushStatus> {
    if (this.disposed || !this.source.active(id)) throw new Error('Push unavailable');
    const state = this.store.get();
    if (command.operation === 'disable') { this.revoke(id); return this.status(id); }
    if (command.operation === 'enable') {
      this.sending.get(id)?.abort();
      // A browser endpoint belongs to exactly one paired device. Re-pairing
      // cannot leave two identities sending notifications to the same browser.
      for (const d of state.devices) if (d.subscription.endpoint === command.subscription.endpoint) this.sending.get(d.id)?.abort();
      state.devices = state.devices.filter(d => d.id !== id && d.subscription.endpoint !== command.subscription.endpoint);
      if (state.devices.length >= 100) throw new Error('Push unavailable');
      state.devices.push({ id, generation: randomUUID(), subscription: structuredClone(command.subscription), preferences: { ...command.preferences },
        locale: command.locale, cursor: this.source.cursor(), recent: [], last: null, testAt: 0 });
      this.store.save(state); return this.status(id);
    }
    const d = state.devices.find(d => d.id === id);
    if (!d || this.sending.has(id) || this.now() - d.testAt < TEST_COOLDOWN_MS) throw new Error('Push test unavailable; wait before trying again');
    d.testAt = this.now(); this.store.save(state);
    await this.deliver(d, { version: 1, kind: 'test', locale: d.locale, tag: tagFor(id, 'test'), runId: null });
    return this.status(id);
  }
  revoke(id: string | null): void {
    if (id === null) { for (const c of this.sending.values()) c.abort(); } else this.sending.get(id)?.abort();
    if (!this.store.available()) return;
    const state = this.store.get(); const devices = id === null ? [] : state.devices.filter(d => d.id !== id);
    if (devices.length !== state.devices.length) this.store.save({ ...state, devices });
  }
  authorityChanged(id: string | null): void {
    if (id === null) { this.revoke(null); return; }
    this.sending.get(id)?.abort();
    if (!this.source.active(id)) { this.revoke(id); return; }
    if (!this.store.available()) return;
    const state = this.store.get(); const device = state.devices.find(d => d.id === id);
    if (device) { device.generation = randomUUID(); this.store.save(state); }
  }
  async poll(): Promise<void> {
    if (this.disposed || this.busy || !this.store.available()) return;
    this.busy = true;
    try {
      // Device count and journal page are bounded. Current authorization is
      // rechecked immediately before each individual network request.
      for (const original of this.store.get().devices) {
        if (this.disposed) break;
        if (!this.source.active(original.id)) { this.revoke(original.id); continue; }
        if (this.sending.has(original.id)) continue;
        const state = this.store.get(); const d = state.devices.find(d => d.id === original.id);
        if (!d) continue;
        const page = this.source.events(d.cursor); const pending: MobilePushPayload[] = [];
        for (const event of page.events) {
          const kind = kindOf(event);
          if (!kind || !d.preferences[kind] || event.createdAt < this.now() - 300_000 || !this.source.allowed(d.id, event.runId)) continue;
          // Single-task runs derive completion from task events; multi-phase
          // runs must reach their final completed state before a result notice.
          if (kind === 'result' && !this.source.completed(event.runId)) continue;
          const tag = tagFor(d.id, `${kind}:${event.runId}`);
          if (d.recent.some(r => r.tag === tag && this.now() - r.at < 30_000)) continue;
          if (pending.length >= 5) continue;
          d.recent = [...d.recent.filter(r => this.now() - r.at < 300_000), { tag, at: this.now() }].slice(-100);
          pending.push({ version: 1, kind, locale: d.locale, tag, runId: event.runId });
        }
        if (page.nextCursor > d.cursor) { d.cursor = page.nextCursor; this.store.save(state); }
        for (const payload of pending) await this.deliver(d, payload);
      }
    } catch { console.warn('[ade] push observer unavailable; work is unchanged'); }
    finally { this.busy = false; }
  }
  private async deliver(d: PushDevice, payload: MobilePushPayload): Promise<void> {
    const current = () => !this.disposed && this.store.available() && this.source.active(d.id)
      && this.store.get().devices.some(item => item.id === d.id && item.generation === d.generation)
      && (payload.runId === null || this.source.allowed(d.id, payload.runId));
    if (!current()) return;
    const controller = new AbortController(); this.sending.set(d.id, controller);
    let outcome: 'accepted' | 'failed' | 'expired' = 'failed';
    try {
      const code = await this.transport(d.subscription, payload, this.store.get().keys, controller.signal);
      outcome = code === 201 || code === 202 ? 'accepted' : code === 404 || code === 410 ? 'expired' : 'failed';
    } catch { /* No endpoint, key, provider response or private context in logs. */ }
    finally { if (this.sending.get(d.id) === controller) this.sending.delete(d.id); }
    if (!current()) return;
    const state = this.store.get(); const item = state.devices.find(item => item.id === d.id)!;
    item.last = { at: this.now(), outcome };
    // Keep an expired status but no usable endpoint? Remove the subscription;
    // status is then disabled and the browser can explicitly subscribe again.
    if (outcome === 'expired') state.devices = state.devices.filter(item => item.id !== d.id);
    this.store.save(state);
  }
}
