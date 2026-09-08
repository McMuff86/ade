import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { redactedWireMessage } from '../errors';
import { isValidIdempotencyKey } from '../remote/authorization';
import type { RemoteAdminScope } from '../../shared/remoteDevices';
import type { MobileErrorCode } from '../../shared/remote';
import type { DeviceAuditEntry } from '../remote/RemoteDeviceStore';
import { RemoteApiError, type RemoteCommandContext } from './AdeApplicationService';
import { assertNoLinks } from '../repositories/pathDiscipline';

interface Receipt {
  key: string; fingerprint: string; state: 'reserved' | 'complete' | 'rejected';
  result?: unknown; error?: { status: number; code: MobileErrorCode; message: string };
}
const MAX_BYTES = 1024 * 1024;
const MAX_RECEIPTS = 500;

/** Durable at-most-once administration. Interrupted reservations never execute again. */
export class RemoteCommandLedger {
  private entries: Receipt[] = [];
  private available = true;
  private readonly inFlight = new Map<string, { fingerprint: string; result: Promise<unknown> }>();
  constructor(private readonly file: string, private readonly audit: (entry: DeviceAuditEntry) => void,
    private readonly authorized: (id: string, scope: RemoteAdminScope) => boolean) {
    try {
      assertNoLinks(file); mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      try {
        if (lstatSync(file).size > MAX_BYTES) throw new Error('ledger too large');
        const value = JSON.parse(readFileSync(file, 'utf8')) as { version: number; entries: Receipt[] };
        if (value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > MAX_RECEIPTS) throw new Error('invalid ledger');
        const keys = new Set<string>();
        for (const item of value.entries) {
          if (!item || !/^[a-f0-9]{64}$/.test(item.key) || !/^[a-f0-9]{64}$/.test(item.fingerprint)
            || !['reserved', 'complete', 'rejected'].includes(item.state) || keys.has(item.key)
            || (item.state === 'complete' && item.result === undefined)
            || (item.state === 'rejected' && (!item.error || !Number.isInteger(item.error.status) || item.error.status < 400 || item.error.status > 599
              || typeof item.error.code !== 'string' || typeof item.error.message !== 'string'))) throw new Error('invalid receipt');
          keys.add(item.key);
        }
        this.entries = value.entries;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const auditFile = join(dirname(file), 'audit.jsonl'); assertNoLinks(auditFile);
        try {
          if (lstatSync(auditFile).size > 8 * 1024 * 1024) throw new Error('audit too large');
          for (const line of readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean)) {
            const entry = JSON.parse(line) as DeviceAuditEntry;
            if (entry.channel === 'host:restart' || entry.channel.startsWith('admin:')) throw new Error('administration history without its receipts');
          }
        } catch (auditError) { if ((auditError as NodeJS.ErrnoException).code !== 'ENOENT') throw auditError; }
      }
    } catch { this.available = false; console.warn('[ade] remote command ledger unavailable; administration disabled'); }
  }

  permits(context: RemoteCommandContext, scope: RemoteAdminScope): void {
    if (context.principal.kind !== 'device' || context.principal.proof !== 'device-signature') {
      throw new RemoteApiError(401, 'device_proof_required');
    }
    if (!context.principal.scopes.has(scope) || !this.authorized(context.principal.id, scope)) {
      throw new RemoteApiError(403, 'scope_not_granted');
    }
    if (!this.available) throw new RemoteApiError(503, 'unavailable');
  }

  async execute<T>(context: RemoteCommandContext, channel: string, scope: RemoteAdminScope, payload: unknown,
    operation: () => T | Promise<T>): Promise<{ value: T; replayed: boolean }> {
    this.permits(context, scope);
    const key = context.idempotencyKey;
    if (key === undefined) throw new RemoteApiError(400, 'idempotency_key_required');
    if (!isValidIdempotencyKey(key)) throw new RemoteApiError(400, 'idempotency_key_invalid');
    const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
    const keyHash = digest(`${context.principal.id}\n${key}`);
    const fingerprint = digest(`${channel}\n${JSON.stringify(payload)}`);
    const entry: DeviceAuditEntry = { at: Date.now(), principalId: context.principal.id, principalKind: 'device',
      requestId: context.requestId, channel, target: null, outcome: 'requested' };
    this.audit(entry);
    const running = this.inFlight.get(keyHash);
    const receipt = this.entries.find((item) => item.key === keyHash);
    if ((receipt && receipt.fingerprint !== fingerprint) || (running && running.fingerprint !== fingerprint)) {
      throw new RemoteApiError(409, 'idempotency_key_reused');
    }
    if (running || receipt) {
      let value: T;
      if (running) value = await running.result as T;
      else if (receipt!.state === 'complete') value = structuredClone(receipt!.result) as T;
      else if (receipt!.state === 'rejected') throw new RemoteApiError(receipt!.error!.status, receipt!.error!.code, receipt!.error!.message);
      else throw new RemoteApiError(409, 'command_uncertain', 'Die vorherige Aktion wurde unterbrochen. Zustand am PC prüfen; sie wird nicht erneut ausgeführt.');
      this.permits(context, scope); this.audit({ ...entry, outcome: 'replayed' });
      return { value, replayed: true };
    }
    if (this.entries.length >= MAX_RECEIPTS) throw new RemoteApiError(503, 'unavailable', 'Remote-Aktionsspeicher ist voll.');
    const reserved: Receipt = { key: keyHash, fingerprint, state: 'reserved' };
    this.save([...this.entries, reserved]);
    const execution = Promise.resolve().then(async () => {
      this.permits(context, scope);
      let value: T;
      try { value = await operation(); }
      catch (error) {
        // Exceptions after a partial side effect are terminal for this key too.
        const message = redactedWireMessage(error);
        const status = error instanceof RemoteApiError ? error.status : 422;
        const code = error instanceof RemoteApiError ? error.code : 'command_rejected';
        this.save(this.entries.map((item) => item.key === keyHash ? { ...item, state: 'rejected', error: { status, code, message } } : item));
        this.audit({ ...entry, outcome: 'rejected', reason: message });
        throw error instanceof RemoteApiError ? error : new RemoteApiError(422, 'command_rejected', message);
      }
      this.save(this.entries.map((item) => item.key === keyHash ? { ...item, state: 'complete', result: value } : item));
      this.audit({ ...entry, outcome: 'executed' });
      return value;
    });
    this.inFlight.set(keyHash, { fingerprint, result: execution });
    try { return { value: await execution, replayed: false }; }
    finally { this.inFlight.delete(keyHash); }
  }

  private save(entries: Receipt[]): void {
    const temp = join(dirname(this.file), `commands-${randomUUID()}.tmp`);
    try {
      const bytes = JSON.stringify({ version: 1, entries });
      if (Buffer.byteLength(bytes) > MAX_BYTES) throw new Error('ledger full');
      assertNoLinks(this.file); assertNoLinks(temp);
      const fd = openSync(temp, 'wx', 0o600);
      try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, this.file);
      if (process.platform !== 'win32') { const fd = openSync(dirname(this.file), 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
      this.entries = entries;
    } catch { this.available = false; throw new RemoteApiError(503, 'unavailable'); }
    finally { try { unlinkSync(temp); } catch { /* Renamed or never created. */ } }
  }
}
