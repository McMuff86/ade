import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createECDH, randomUUID } from 'node:crypto';
import { generateVAPIDKeys } from 'web-push';
import type { DeviceSecretProtection } from '../remote/RemoteDeviceStore';
import type { MobilePushPreferences, MobilePushStatus, MobilePushSubscription } from '../../shared/remote';
import { assertNoLinks } from '../repositories/pathDiscipline';
import { validPushCommand } from './pushValidation';

export interface PushDevice {
  id: string; generation: string; subscription: MobilePushSubscription;
  preferences: MobilePushPreferences; locale: 'de' | 'en'; cursor: number;
  recent: Array<{ tag: string; at: number }>; last: MobilePushStatus['last']; testAt: number;
}
export interface PushState { version: 1; keys: { publicKey: string; privateKey: string }; devices: PushDevice[] }
const MAX_BYTES = 512 * 1024;
/** Entire push state is OS-encrypted and separate from config/export. A corrupt
 * key fails closed; damaged state is never silently replaced with new keys. */
export class PushStore {
  private state: PushState | null = null;
  private healthy = true;
  constructor(private readonly file: string, private readonly protection: DeviceSecretProtection) {
    try {
      if (!protection.available()) throw new Error('unavailable');
      assertNoLinks(file); mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      try {
        const stat = lstatSync(file);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES) throw new Error('invalid vault');
        const envelope = JSON.parse(readFileSync(file, 'utf8')) as { version: number; encrypted: string };
        if (envelope.version !== 1 || typeof envelope.encrypted !== 'string') throw new Error('invalid vault');
        const state = JSON.parse(protection.decrypt(Buffer.from(envelope.encrypted, 'base64'))) as PushState;
        if (state.version !== 1 || !state.keys || !/^[A-Za-z0-9_-]{87}$/.test(state.keys.publicKey) || !/^[A-Za-z0-9_-]{43}$/.test(state.keys.privateKey)
          || !Array.isArray(state.devices) || state.devices.length > 100) throw new Error('invalid state');
        const key = createECDH('prime256v1'); key.setPrivateKey(Buffer.from(state.keys.privateKey, 'base64url'));
        if (key.getPublicKey().toString('base64url') !== state.keys.publicKey) throw new Error('invalid key pair');
        const ids = new Set<string>();
        for (const d of state.devices) {
          if (!d || typeof d.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(d.id) || ids.has(d.id)
            || typeof d.generation !== 'string' || !validPushCommand({ operation: 'enable', subscription: d.subscription, preferences: d.preferences, locale: d.locale })
            || !Number.isSafeInteger(d.cursor) || d.cursor < 0 || !Number.isSafeInteger(d.testAt) || d.testAt < 0
            || !Array.isArray(d.recent) || d.recent.length > 100 || d.recent.some(r => !/^[a-f0-9]{32}$/.test(r.tag) || !Number.isSafeInteger(r.at) || r.at < 0)
            || d.last !== null && (!Number.isSafeInteger(d.last.at) || !['accepted', 'failed', 'expired'].includes(d.last.outcome))) throw new Error('invalid device');
          ids.add(d.id);
        }
        this.state = state;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        this.save({ version: 1, keys: generateVAPIDKeys(), devices: [] });
      }
    } catch { this.healthy = false; this.state = null; }
  }
  available(): boolean { return this.healthy && this.state !== null && this.protection.available(); }
  get(): PushState { if (!this.available()) throw new Error('Push storage unavailable'); return structuredClone(this.state!); }
  save(state: PushState): void {
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      if (!this.healthy || !this.protection.available()) throw new Error('unavailable');
      const encrypted = this.protection.encrypt(JSON.stringify(state)).toString('base64');
      const bytes = JSON.stringify({ version: 1, encrypted });
      if (Buffer.byteLength(bytes) > MAX_BYTES) throw new Error('full');
      assertNoLinks(this.file); assertNoLinks(temp);
      try { const stat = lstatSync(this.file); if (!stat.isFile() || stat.nlink !== 1) throw new Error('linked vault'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const fd = openSync(temp, 'wx', 0o600);
      try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, this.file);
      if (process.platform !== 'win32') { const dir = openSync(dirname(this.file), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); } }
      this.state = structuredClone(state);
    } catch { this.healthy = false; throw new Error('Push storage unavailable'); }
    finally { try { unlinkSync(temp); } catch { /* renamed or not created */ } }
  }
}
