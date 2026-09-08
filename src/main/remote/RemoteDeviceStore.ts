import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RemoteDeviceInfo, RemoteDeviceInventory } from '../../shared/remoteDevices';
import { isValidRemoteDeviceName as validName } from '../../shared/remoteDevices';
import { redactForWire } from '../errors';
import { isValidDeviceId, isValidDeviceSecret, type RemoteDevice } from './authorization';

export interface DeviceSecretProtection {
  available(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

interface StoredDevice extends RemoteDeviceInfo { encryptedSecret: string | null }
interface DeviceState { version: 1; bootstrapImported: boolean; devices: StoredDevice[]; mobileEnabled?: boolean; ownsServe?: boolean }
export interface DeviceAuditEntry {
  at: number;
  principalId: string;
  principalKind: string;
  requestId: string;
  channel: string;
  target: string | null;
  outcome: string;
  reason?: string;
}

const MAX_STATE_BYTES = 256 * 1024;
const MAX_AUDIT_BYTES = 8 * 1024 * 1024;
const UNAVAILABLE = 'Geräteverwaltung ist nicht verfügbar. Sichere Schlüsselablage und Remote-Speicher prüfen.';

/** Reject links at every existing component, including the final file. */
function noLinks(file: string): void {
  const absolute = resolve(file);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error('ade: remote storage refuses links');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

/** Independent host-local vault and fsynced, append-only audit. Never part of AdeConfig. */
export class RemoteDeviceStore {
  private state: DeviceState = { version: 1, bootstrapImported: false, devices: [] };
  private readonly secrets = new Map<string, string>();
  private failure: string | null = null;
  private auditBytes: number | null = null;
  private readonly listeners = new Set<(id: string | null) => void>();
  private readonly statePath: string;
  readonly auditPath: string;

  constructor(private readonly dir: string, private readonly protection: DeviceSecretProtection) {
    this.statePath = join(dir, 'devices.json');
    this.auditPath = join(dir, 'audit.jsonl');
    try {
      noLinks(dir);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      this.auditBytes = this.checkAudit();
      let hasDeviceHistory = false;
      if (this.auditBytes > 0) {
        for (const line of readFileSync(this.auditPath, 'utf8').trimEnd().split('\n')) {
          const entry = JSON.parse(line) as DeviceAuditEntry;
          if (!entry || !Number.isSafeInteger(entry.at) || typeof entry.requestId !== 'string'
            || typeof entry.channel !== 'string' || typeof entry.outcome !== 'string') throw new Error('invalid audit');
          if (entry.channel.startsWith('device:')) hasDeviceHistory = true;
        }
      }
      noLinks(this.statePath);
      let raw: string;
      try {
        if (lstatSync(this.statePath).size > MAX_STATE_BYTES) throw new Error('state too large');
        raw = readFileSync(this.statePath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !hasDeviceHistory) return;
        throw error;
      }
      const state = JSON.parse(raw) as DeviceState;
      if (state.version !== 1 || typeof state.bootstrapImported !== 'boolean'
        || (state.mobileEnabled !== undefined && typeof state.mobileEnabled !== 'boolean')
        || (state.ownsServe !== undefined && typeof state.ownsServe !== 'boolean')
        || !Array.isArray(state.devices) || state.devices.length > 100
        || (state.devices.length > 0 && !state.bootstrapImported)) throw new Error('invalid state');
      const ids = new Set<string>();
      for (const item of state.devices) {
        if (!item || typeof item.id !== 'string' || !isValidDeviceId(item.id) || ids.has(item.id)
          || !validName(item.name) || !Number.isSafeInteger(item.createdAt) || item.createdAt < 0
          || (item.revokedAt !== null && (!Number.isSafeInteger(item.revokedAt) || item.revokedAt < 0))
          || (item.revokedAt === null ? typeof item.encryptedSecret !== 'string' : item.encryptedSecret !== null)) {
          throw new Error('invalid device');
        }
        ids.add(item.id);
        if (item.revokedAt === null) {
          if (!protection.available()) throw new Error('secure storage unavailable');
          const secret = protection.decrypt(Buffer.from(item.encryptedSecret!, 'base64'));
          if (!isValidDeviceSecret(secret)) throw new Error('invalid secret');
          this.secrets.set(item.id, secret);
        }
      }
      this.state = state;
      if (!this.auditBytes) throw new Error('device state requires its audit');
    } catch { this.disable(); }
  }

  inventory(): RemoteDeviceInventory {
    return {
      devices: this.state.devices.map(({ id, name, createdAt, revokedAt }) => ({ id, name, createdAt, revokedAt })),
      available: this.failure === null && this.protection.available(),
      error: this.failure ?? (this.protection.available() ? null : UNAVAILABLE),
    };
  }

  activeDevices(): RemoteDevice[] {
    if (!this.inventory().available) return [];
    return this.state.devices.filter((item) => item.revokedAt === null).map((item) => ({
      id: item.id, secret: this.secrets.get(item.id)!, scopes: ['read', 'runs:write'],
    }));
  }

  onRevoked(listener: (id: string | null) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  mobilePreferences(): { enabled: boolean; ownsServe: boolean } {
    return { enabled: this.state.mobileEnabled === true, ownsServe: this.state.ownsServe === true };
  }

  setMobilePreferences(enabled: boolean, ownsServe: boolean): void {
    this.assertAvailable();
    this.change({ ...structuredClone(this.state), mobileEnabled: enabled, ownsServe }, 'mobile:configure', 'host');
  }

  /** Only the trusted pairing service may enroll a browser-generated signing key. */
  enroll(id: string, name: string, secret: string): void {
    this.assertAvailable();
    if (!isValidDeviceId(id) || !validName(name) || !isValidDeviceSecret(secret)) throw new Error('ade: invalid paired device');
    if (this.state.devices.length >= 100 || this.state.devices.some((device) => device.id === id)) {
      throw new Error('ade: device limit or duplicate identity');
    }
    const next = structuredClone(this.state);
    next.bootstrapImported = true;
    next.devices.push({ id, name: name.trim(), createdAt: Date.now(), revokedAt: null,
      encryptedSecret: this.protection.encrypt(secret).toString('base64') });
    this.change(next, 'device:pair', id);
    this.secrets.set(id, secret);
  }

  /** One-time migration only. Leaving the old env value set cannot revive a revoked device. */
  importBootstrap(devices: readonly RemoteDevice[]): void {
    this.assertAvailable();
    if (this.state.bootstrapImported || devices.length === 0) return;
    if (devices.length !== 1) throw new Error('ade: bootstrap accepts exactly one device');
    const device = devices[0]!;
    if (!isValidDeviceId(device.id) || !isValidDeviceSecret(device.secret)) throw new Error('ade: invalid bootstrap device');
    const next = structuredClone(this.state);
    next.bootstrapImported = true;
    next.devices.push({ id: device.id, name: device.id, createdAt: Date.now(), revokedAt: null,
      encryptedSecret: this.protection.encrypt(device.secret).toString('base64') });
    this.change(next, 'device:import', device.id);
    this.secrets.set(device.id, device.secret);
  }

  rename(id: string, name: string): RemoteDeviceInventory {
    this.assertAvailable();
    if (!validName(name)) throw new Error('ade: device name must contain 1-80 printable characters');
    const next = structuredClone(this.state);
    const device = next.devices.find((item) => item.id === id);
    if (!device || device.revokedAt !== null) throw new Error('ade: active device not found');
    device.name = name.trim();
    this.change(next, 'device:rename', id);
    return this.inventory();
  }

  revoke(id: string): RemoteDeviceInventory {
    this.assertAvailable();
    const next = structuredClone(this.state);
    const device = next.devices.find((item) => item.id === id);
    if (!device) throw new Error('ade: device not found');
    if (device.revokedAt !== null) return this.inventory();
    device.revokedAt = Date.now();
    device.encryptedSecret = null;
    this.change(next, 'device:revoke', id);
    this.secrets.delete(id);
    this.notify(id);
    return this.inventory();
  }

  /** Called before remote work and on its outcome; a failed audit disables authorization. */
  audit(entry: DeviceAuditEntry): void {
    this.assertAvailable();
    try {
      const bytes = this.checkAudit();
      // Explicit projection: names, payloads, signatures and secrets are never accepted as audit fields.
      const clean = (value: string): string => redactForWire(value).slice(0, 256);
      const line = JSON.stringify({ at: entry.at, principalId: clean(entry.principalId),
        principalKind: clean(entry.principalKind), requestId: clean(entry.requestId),
        channel: clean(entry.channel), target: entry.target === null ? null : clean(entry.target),
        outcome: clean(entry.outcome), ...(entry.reason ? { reason: clean(entry.reason) } : {}) }) + '\n';
      if (bytes + Buffer.byteLength(line) > MAX_AUDIT_BYTES) throw new Error('audit full');
      const fd = openSync(this.auditPath, 'a', 0o600);
      try { writeFileSync(fd, line); fsyncSync(fd); } finally { closeSync(fd); }
      this.auditBytes = bytes + Buffer.byteLength(line);
    } catch {
      this.disable();
      throw new Error(UNAVAILABLE);
    }
  }

  private checkAudit(): number {
    noLinks(this.auditPath);
    try {
      const size = lstatSync(this.auditPath).size;
      if (size >= MAX_AUDIT_BYTES) throw new Error('audit full');
      if (this.auditBytes !== null && size !== this.auditBytes) throw new Error('audit changed outside ADE');
      // Bound reads; a torn append must not be silently accepted on restart.
      if (size > 0) {
        const fd = openSync(this.auditPath, 'r');
        try {
          const last = Buffer.alloc(1);
          if (readSync(fd, last, 0, 1, size - 1) !== 1 || last[0] !== 10) throw new Error('incomplete audit');
        } finally { closeSync(fd); }
      }
      return size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !this.auditBytes) return 0;
      throw error;
    }
  }

  private change(next: DeviceState, channel: string, target: string): void {
    const entry: DeviceAuditEntry = { at: Date.now(), principalId: 'desktop', principalKind: 'desktop',
      requestId: randomUUID(), channel, target, outcome: 'requested' };
    this.audit(entry);
    const temp = join(this.dir, `devices-${randomUUID()}.tmp`);
    try {
      noLinks(this.statePath);
      const fd = openSync(temp, 'wx', 0o600);
      try { writeFileSync(fd, JSON.stringify(next)); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, this.statePath);
      if (process.platform !== 'win32') {
        const directory = openSync(dirname(this.statePath), 'r');
        try { fsyncSync(directory); } finally { closeSync(directory); }
      }
      this.state = next;
      this.audit({ ...entry, outcome: 'executed' });
    } catch {
      this.disable();
      throw new Error(UNAVAILABLE);
    } finally {
      try { unlinkSync(temp); } catch { /* renamed or never created */ }
    }
  }

  private assertAvailable(): void {
    if (!this.inventory().available) throw new Error(UNAVAILABLE);
  }
  private notify(id: string | null): void {
    for (const listener of this.listeners) listener(id);
  }
  private disable(): void {
    this.failure = UNAVAILABLE;
    this.secrets.clear();
    this.notify(null);
    console.warn('[ade] remote device storage unavailable; device authorization disabled');
  }
}
