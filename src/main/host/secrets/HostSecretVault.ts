import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { fingerprint, MAX_VAULT_BYTES, readVaultFile, writeVaultFile } from './vaultFile';

/** No provider messages, paths or secret values may enter this diagnostic. */
export type KeyringProbe = { state: 'ready'; protection: 'encrypted' | 'passwordless' | 'unknown' }
  | { state: 'locked' | 'unavailable' };
export type VaultStatus = KeyringProbe | { state: 'unavailable'; reason: 'not-initialized' | 'keyring' | 'key-missing' | 'key-invalid' | 'storage' | 'closed' };

/**
 * A profile-scoped OS entry. The provider MUST inspect the target collection's
 * Locked property before returning ready, use Secret Service without a fallback,
 * and refuse create if an entry already exists. The caller owns the profile lock.
 * read returns an owned buffer; create must copy its input before resolving.
 * No Electron implementation or production provider is wired in H2a.
 */
export interface WrappingKeyStore {
  probe(): Promise<KeyringProbe>;
  read(): Promise<Buffer | null>;
  create(key: Buffer): Promise<void>;
}

export interface MigrationReceipt { sourceDigest: string; id: string }
interface Entry { id: string; value: string }
interface State {
  version: 1;
  entries: Entry[];
  migration: { sourceDigest: string; complete: boolean; ids: string[] } | null;
}
const MAGIC = Buffer.from('ADEVAULT\x01', 'binary');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_ENTRIES = 256;
const MAX_VALUE_BYTES = 512 * 1024;
const ID = /^(harness|service|device|push):[A-Za-z0-9_.:-]{1,128}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const empty = (): State => ({ version: 1, entries: [], migration: null });
const validEntry = (entry: Entry): boolean => Boolean(entry) && typeof entry.id === 'string' && ID.test(entry.id)
  && typeof entry.value === 'string' && Buffer.byteLength(entry.value) <= MAX_VALUE_BYTES;

export class VaultError extends Error {
  constructor(readonly code: 'unavailable' | 'invalid' | 'migration-conflict' | 'migration-pending') {
    super(`ade: secret vault ${code}`);
  }
}

/**
 * H2a, not yet composed into the running application. One OS-held 256-bit key
 * encrypts the complete bounded store with AES-256-GCM. Profile identity and
 * format version are authenticated; neither entry names nor receipts are plain
 * on disk. Methods returning values are host-only, never renderer/wire DTOs.
 *
 * refresh clears cached secrets before probing. It is called after unlock or
 * service loss by the future platform adapter; this core has no polling timer.
 */
export class HostSecretVault {
  private key: Buffer | null = null;
  private data: State = empty();
  private diskFingerprint: string | null = null;
  private diagnostic: VaultStatus = { state: 'unavailable', reason: 'not-initialized' };
  private pending: Promise<VaultStatus> | null = null;
  private closed = false;
  private generation = 0;
  private readonly aad: Buffer;

  constructor(private readonly file: string, profileId: string, private readonly keyring: WrappingKeyStore) {
    if (!DIGEST.test(profileId)) throw new VaultError('invalid');
    this.aad = Buffer.from(`ade:host-secret-vault:1:${profileId}`);
  }

  status(): VaultStatus { return { ...this.diagnostic }; }
  available(): boolean { return !this.closed && this.key !== null && this.diagnostic.state === 'ready'; }

  refresh(): Promise<VaultStatus> {
    if (this.closed) return Promise.resolve(this.status());
    if (this.pending) return this.pending;
    this.clear(); this.diagnostic = { state: 'unavailable', reason: 'not-initialized' };
    this.pending = this.initialize(++this.generation).finally(() => { this.pending = null; });
    return this.pending;
  }

  close(): void {
    this.closed = true; this.clear(); this.diagnostic = { state: 'unavailable', reason: 'closed' };
  }

  /** Called by the platform observer before retrying after a keyring change. */
  invalidate(): void {
    if (this.closed) return;
    this.generation++; this.clear(); this.diagnostic = { state: 'unavailable', reason: 'keyring' };
  }

  get(id: string): string | null {
    this.assertReady(); this.assertId(id);
    if (this.data.migration && !this.data.migration.complete) throw new VaultError('migration-pending');
    return this.data.entries.find(entry => entry.id === id)?.value ?? null;
  }

  set(id: string, value: string): void {
    this.assertReady();
    if (!validEntry({ id, value })) throw new VaultError('invalid');
    if (this.data.migration && !this.data.migration.complete) throw new VaultError('migration-pending');
    const next = structuredClone(this.data);
    const existing = next.entries.find(entry => entry.id === id);
    if (existing) existing.value = value; else next.entries.push({ id, value });
    this.save(next);
  }

  remove(id: string): void {
    this.assertReady(); this.assertId(id);
    if (this.data.migration && !this.data.migration.complete) throw new VaultError('migration-pending');
    const next = structuredClone(this.data); next.entries = next.entries.filter(entry => entry.id !== id); this.save(next);
  }

  /** Digest is of the legacy encrypted source manifest, NEVER of plaintext. */
  beginMigration(sourceDigest: string): void {
    this.assertReady();
    if (!DIGEST.test(sourceDigest)) throw new VaultError('invalid');
    if (this.data.migration) {
      if (this.data.migration.sourceDigest !== sourceDigest) throw new VaultError('migration-conflict');
      return;
    }
    if (this.data.entries.length) throw new VaultError('migration-conflict');
    this.save({ ...empty(), migration: { sourceDigest, complete: false, ids: [] } });
  }

  /** Only acknowledges after fsync, atomic rename and authenticated read-back. */
  importLegacy(sourceDigest: string, id: string, value: string): MigrationReceipt {
    this.assertReady();
    if (!validEntry({ id, value })) throw new VaultError('invalid');
    const migration = this.data.migration;
    if (!migration || migration.complete || migration.sourceDigest !== sourceDigest) throw new VaultError('migration-conflict');
    const existing = this.data.entries.find(entry => entry.id === id);
    if (existing) {
      if (existing.value !== value || !migration.ids.includes(id)) throw new VaultError('migration-conflict');
      // A resumed sender receives a receipt only after another durable read.
      this.verifyDisk();
    } else {
      const next = structuredClone(this.data); next.entries.push({ id, value }); next.migration!.ids.push(id); this.save(next);
    }
    return { sourceDigest, id };
  }

  /** Exact expected set prevents an interrupted/partial migration being sealed. */
  finishMigration(sourceDigest: string, ids: readonly string[]): void {
    this.assertReady();
    const migration = this.data.migration;
    if (!migration || migration.sourceDigest !== sourceDigest || new Set(ids).size !== ids.length
      || ids.length !== migration.ids.length || ids.some(id => !migration.ids.includes(id))) throw new VaultError('migration-conflict');
    const next = structuredClone(this.data); next.migration!.complete = true; this.save(next);
  }

  migrationStatus(): { sourceDigest: string; complete: boolean; ids: string[] } | null {
    this.assertReady(); return structuredClone(this.data.migration);
  }

  private async initialize(generation: number): Promise<VaultStatus> {
    const stale = () => this.closed || generation !== this.generation;
    let reason: 'keyring' | 'key-missing' | 'key-invalid' | 'storage' = 'keyring';
    let candidate: Buffer | null = null;
    let created = false;
    try {
      const probe = await this.keyring.probe();
      if (stale()) return this.status();
      if (probe.state !== 'ready') { this.diagnostic = { state: probe.state }; return this.status(); }
      reason = 'storage'; const raw = readVaultFile(this.file);
      reason = 'keyring'; candidate = await this.keyring.read();
      if (stale()) return this.status();
      if (candidate === null) {
        if (raw !== null) { reason = 'key-missing'; throw new Error(); }
        // Probe again: a lock between the read and creation must not mean first use.
        const beforeCreate = await this.keyring.probe();
        if (stale()) return this.status();
        if (beforeCreate.state !== 'ready') { this.diagnostic = { state: beforeCreate.state }; return this.status(); }
        const generated = randomBytes(32);
        try { await this.keyring.create(generated); created = true; } finally { generated.fill(0); }
        if (stale()) return this.status();
        candidate = await this.keyring.read();
      }
      if (stale()) return this.status();
      reason = 'key-invalid';
      if (!Buffer.isBuffer(candidate) || candidate.length !== 32) throw new Error();
      reason = 'storage';
      // An existing OS entry is evidence of prior use. A deleted vault must not
      // silently become an empty one, including in a fresh host process.
      if (raw === null && !created) throw new Error();
      const state = raw === null ? empty() : this.decode(raw, candidate);
      // Recheck collection state after reads; no cached key survives a lock.
      reason = 'keyring'; const afterRead = await this.keyring.probe();
      if (stale()) return this.status();
      if (afterRead.state !== 'ready') { this.diagnostic = { state: afterRead.state }; return this.status(); }
      reason = 'storage';
      if (fingerprint(readVaultFile(this.file)) !== fingerprint(raw)) throw new Error();
      this.key = Buffer.from(candidate); this.data = state; this.diskFingerprint = fingerprint(raw);
      if (created) this.save(state);
      this.diagnostic = { state: 'ready', protection: afterRead.protection };
    } catch {
      // Native provider errors can contain credentials; never retain or log them.
      this.clear();
      if (!stale()) this.diagnostic = { state: 'unavailable', reason };
    } finally { candidate?.fill(0); }
    return this.status();
  }

  private save(next: State): void {
    this.validate(next);
    const plain = Buffer.from(JSON.stringify(next));
    if (plain.length + MAGIC.length + NONCE_BYTES + TAG_BYTES > MAX_VAULT_BYTES) { plain.fill(0); throw new VaultError('invalid'); }
    try {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', this.key!, nonce); cipher.setAAD(this.aad);
      const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
      const bytes = Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), ciphertext]);
      writeVaultFile(this.file, bytes, this.diskFingerprint);
      const persisted = readVaultFile(this.file);
      if (!persisted || !persisted.equals(bytes)) throw new Error();
      this.data = this.decode(persisted, this.key!); this.diskFingerprint = fingerprint(persisted);
    } catch {
      this.clear(); this.diagnostic = { state: 'unavailable', reason: 'storage' }; throw new VaultError('unavailable');
    } finally { plain.fill(0); }
  }

  private verifyDisk(): void {
    try {
      const bytes = readVaultFile(this.file);
      if (!bytes || fingerprint(bytes) !== this.diskFingerprint) throw new Error();
      this.decode(bytes, this.key!);
    } catch { this.clear(); this.diagnostic = { state: 'unavailable', reason: 'storage' }; throw new VaultError('unavailable'); }
  }

  private decode(bytes: Buffer, key: Buffer): State {
    const nonceAt = MAGIC.length; const tagAt = nonceAt + NONCE_BYTES; const bodyAt = tagAt + TAG_BYTES;
    if (bytes.length <= bodyAt || bytes.length > MAX_VAULT_BYTES || !bytes.subarray(0, nonceAt).equals(MAGIC)) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(nonceAt, tagAt));
    decipher.setAAD(this.aad); decipher.setAuthTag(bytes.subarray(tagAt, bodyAt));
    const plain = Buffer.concat([decipher.update(bytes.subarray(bodyAt)), decipher.final()]);
    try { const state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)) as State; this.validate(state); return state; }
    finally { plain.fill(0); }
  }

  private validate(state: State): void {
    if (!state || state.version !== 1 || !Array.isArray(state.entries) || state.entries.length > MAX_ENTRIES
      || !state.entries.every(validEntry) || new Set(state.entries.map(entry => entry.id)).size !== state.entries.length) throw new VaultError('invalid');
    const migration = state.migration;
    if (migration !== null && (!migration || !DIGEST.test(migration.sourceDigest) || typeof migration.complete !== 'boolean'
      || !Array.isArray(migration.ids) || migration.ids.length > MAX_ENTRIES || !migration.ids.every(id => typeof id === 'string' && ID.test(id))
      || new Set(migration.ids).size !== migration.ids.length
      || !migration.complete && (migration.ids.length !== state.entries.length || migration.ids.some(id => !state.entries.some(entry => entry.id === id))))) throw new VaultError('invalid');
  }
  private assertReady(): void { if (!this.available()) throw new VaultError('unavailable'); }
  private assertId(id: string): void { if (typeof id !== 'string' || !ID.test(id)) throw new VaultError('invalid'); }
  private clear(): void { this.key?.fill(0); this.key = null; this.data = empty(); this.diskFingerprint = null; }
}
