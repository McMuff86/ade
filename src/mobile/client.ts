import type { MobileSessionInfo } from '../shared/remote';

interface Credential { id: string; key: CryptoKey }
export class MobileClientError extends Error {
  constructor(readonly code: string, readonly status = 0, detail?: string) { super(detail ?? code); }
}
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer): string => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');

async function credentialStore<T>(operation: (store: IDBObjectStore) => IDBRequest<T>, write = false): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('ade-mobile-identity', 1);
    open.onupgradeneeded = () => { open.result.createObjectStore('identity'); };
    open.onerror = () => reject(new MobileClientError('storage_unavailable'));
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('identity', write ? 'readwrite' : 'readonly');
      const request = operation(tx.objectStore('identity'));
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(new MobileClientError('storage_unavailable')); };
    };
  });
}

export class MobileClient {
  get deviceId(): string | null { return this.credential?.id ?? null; }
  private credential: Credential | null = null;
  private session: MobileSessionInfo | null = null;
  private authenticating: Promise<void> | null = null;

  async restore(): Promise<boolean> {
    this.credential = await credentialStore<Credential | undefined>((store) => store.get('current')) ?? null;
    return !!this.credential;
  }

  async pair(challenge: string, name: string): Promise<void> {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    bytes.fill(0);
    const id = crypto.randomUUID();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    this.credential = { id, key };
    // Persist the non-exportable key before requesting enrollment; an interrupted reply is recoverable.
    await credentialStore((store) => store.put(this.credential, 'current'), true);
    try {
      const response = await fetch('/api/v1/pair', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge, deviceId: id, name, secret }),
        signal: AbortSignal.timeout(15_000) });
      await this.check(response);
      this.session = await response.json() as MobileSessionInfo;
    } catch (error) {
      if (error instanceof MobileClientError) { await this.forget(); throw error; }
      // Pairing may have committed while its response was lost. Prove the persisted key to recover.
      await this.authenticate();
    }
  }

  async request<T>(path: string, method = 'GET', payload?: unknown, idempotencyKey = ''): Promise<T> {
    await this.authenticate();
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const send = async (): Promise<Response> => fetch(path, { method, cache: 'no-store', credentials: 'same-origin',
      headers: await this.headers(path, method, body, idempotencyKey),
      ...(method === 'POST' ? { body } : {}), signal: AbortSignal.timeout(20_000) });
    let response = await send();
    // Another tab or a host restart can invalidate cookies. Reauthenticate, keeping the command key.
    if (response.status === 401 || response.status === 403) {
      const error = await response.clone().json().catch(() => ({})) as { error?: string };
      if (error.error === 'unauthorized' || error.error === 'csrf_required') {
        this.session = null; await this.authenticate(); response = await send();
      }
    }
    await this.check(response);
    return response.json() as Promise<T>;
  }

  async stream(cursor: number | null, signal: AbortSignal, onFrame: (event: string, id: number, data: unknown) => void): Promise<void> {
    await this.authenticate();
    const watchdog = new AbortController();
    let heartbeat = setTimeout(() => watchdog.abort(), 45_000);
    const streamSignal = AbortSignal.any([signal, watchdog.signal]);
    const path = `/api/v1/events${cursor === null ? '' : `?cursor=${cursor}`}`;
    let response: Response;
    try { response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: streamSignal,
      headers: { ...await this.headers(path, 'GET', '', ''), accept: 'text/event-stream' } });
      await this.check(response);
    } catch (error) { clearTimeout(heartbeat); throw error; }
    const reader = response.body?.getReader();
    if (!reader) { clearTimeout(heartbeat); throw new MobileClientError('stream_unavailable'); }
    const decoder = new TextDecoder();
    let buffered = '';
    try {
      while (!signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        clearTimeout(heartbeat); heartbeat = setTimeout(() => watchdog.abort(), 45_000);
        buffered += decoder.decode(chunk.value, { stream: true });
        if (buffered.length > 512 * 1024) throw new MobileClientError('stream_too_large');
        let end: number;
        while ((end = buffered.indexOf('\n\n')) >= 0) {
          const frame = buffered.slice(0, end); buffered = buffered.slice(end + 2);
          const fields = Object.fromEntries(frame.split('\n').filter((line) => !line.startsWith(':')).map((line) => {
            const colon = line.indexOf(':'); return [line.slice(0, colon), line.slice(colon + 1).trimStart()];
          }));
          if ((fields.event === 'snapshot' || fields.event === 'journal') && /^\d+$/.test(fields.id ?? '')) {
            const id = Number(fields.id);
            if (Number.isSafeInteger(id)) onFrame(fields.event, id, JSON.parse(fields.data!));
          }
        }
      }
    } finally { clearTimeout(heartbeat); await reader.cancel().catch(() => undefined); }
  }

  async disconnect(): Promise<void> {
    try { await this.request('/api/v1/logout', 'POST'); }
    finally { await this.forget(); }
  }

  async forget(): Promise<void> {
    this.credential = null; this.session = null;
    await credentialStore((store) => store.delete('current'), true);
  }

  private async authenticate(): Promise<void> {
    if (!this.credential) throw new MobileClientError('not_paired', 401);
    if (this.session && this.session.expiresAt > Date.now() + 60_000) return;
    if (this.authenticating) return this.authenticating;
    this.authenticating = (async () => {
      let response = await fetch('/api/v1/session', { cache: 'no-store', credentials: 'same-origin',
        headers: await this.headers('/api/v1/session', 'GET', '', ''), signal: AbortSignal.timeout(15_000) });
      if (response.status === 401 || (response.ok && ((await response.clone().json()) as MobileSessionInfo).expiresAt <= Date.now() + 60_000)) {
        response = await fetch('/api/v1/session', { method: 'POST', body: '', cache: 'no-store', credentials: 'same-origin',
          headers: await this.headers('/api/v1/session', 'POST', '', ''), signal: AbortSignal.timeout(15_000) });
      }
      await this.check(response);
      this.session = await response.json() as MobileSessionInfo;
    })().finally(() => { this.authenticating = null; });
    return this.authenticating;
  }

  private async headers(path: string, method: string, body: string, key: string): Promise<Record<string, string>> {
    const credential = this.credential;
    if (!credential) throw new MobileClientError('not_paired', 401);
    const timestamp = String(Date.now());
    const digest = hex(await crypto.subtle.digest('SHA-256', encoder.encode(body)));
    const canonical = ['ADE-HTTP-V1', method, path, timestamp, key, digest].join('\n');
    const signature = hex(await crypto.subtle.sign('HMAC', credential.key, encoder.encode(canonical)));
    return { 'x-ade-device': credential.id, 'x-ade-timestamp': timestamp, 'x-ade-signature': `v1=${signature}`,
      ...(key ? { 'idempotency-key': key } : {}), ...(body ? { 'content-type': 'application/json' } : {}),
      ...(this.session ? { 'x-ade-csrf': this.session.csrf } : {}) };
  }

  private async check(response: Response): Promise<void> {
    if (response.ok) return;
    const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
    if (body.error === 'unauthorized') this.session = null;
    throw new MobileClientError(body.error ?? 'host_unavailable', response.status,
      typeof body.message === 'string' ? body.message.slice(0, 1000) : undefined);
  }
}
