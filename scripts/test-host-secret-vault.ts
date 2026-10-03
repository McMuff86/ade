/** H2a: real crypto/filesystem, injected OS entry. No personal keyring access. */
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostSecretVault, VaultError, type KeyringProbe, type WrappingKeyStore } from '../src/main/host/secrets/HostSecretVault';
import { MAX_VAULT_BYTES } from '../src/main/host/secrets/vaultFile';

let passed = 0; let failed = 0;
const check = (label: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
const refused = (fn: () => unknown, code: VaultError['code']) => { try { fn(); return false; } catch (error) { return error instanceof VaultError && error.code === code; } };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const profile = hash('isolated-test-profile');
class FakeKeyring implements WrappingKeyStore {
  probeResult: KeyringProbe = { state: 'ready', protection: 'encrypted' };
  key: Buffer | null = null;
  reads = 0; creates = 0;
  async probe(): Promise<KeyringProbe> { return { ...this.probeResult }; }
  async read(): Promise<Buffer | null> { this.reads++; return this.key && Buffer.from(this.key); }
  async create(key: Buffer): Promise<void> {
    this.creates++;
    if (this.key || this.probeResult.state !== 'ready') throw new Error('refuse replacement or locked collection');
    this.key = Buffer.from(key);
  }
}
const root = mkdtempSync(join(tmpdir(), 'ade-host-vault-'));
let serial = 0;
function fixture() {
  const file = join(root, String(++serial), 'secrets.vault'); const keyring = new FakeKeyring();
  return { file, keyring, vault: new HostSecretVault(file, profile, keyring) };
}
async function run(): Promise<void> {
try {
  const { vault, keyring, file } = fixture();
  check('starts unavailable until OS keyring initialization', !vault.available() && refused(() => vault.get('harness:codex'), 'unavailable'));
  await Promise.all([vault.refresh(), vault.refresh(), vault.refresh()]);
  check('concurrent initialization creates exactly one 256-bit OS entry', vault.available() && keyring.creates === 1 && keyring.key?.length === 32);
  const secret = 'sk-vault-only-fixture-plain';
  vault.set('harness:codex', secret); vault.set('service:UNICODE', 'Grüezi 🔐');
  check('host can read persisted values including UTF-8', vault.get('harness:codex') === secret && vault.get('service:UNICODE') === 'Grüezi 🔐');
  const raw = readFileSync(file);
  check('file contains neither values nor entry names nor OS key', !raw.includes(secret) && !raw.includes('harness:codex') && !raw.includes(keyring.key!));
  vault.set('harness:codex', secret);
  check('identical writes use different GCM nonces/ciphertext', !raw.equals(readFileSync(file)));
  check('store is bounded and no temporary file remains', raw.length < MAX_VAULT_BYTES && readdirSync(join(file, '..')).length === 1);
  if (process.platform !== 'win32') check('new vault and directory have private Unix modes', (lstatSync(file).mode & 0o777) === 0o600 && (lstatSync(join(file, '..')).mode & 0o777) === 0o700);
  vault.close();
  const reopened = new HostSecretVault(file, profile, keyring); await reopened.refresh();
  check('fresh host instance decrypts durable data with the OS entry', reopened.get('harness:codex') === secret && keyring.creates === 1);
  reopened.remove('service:UNICODE'); await reopened.refresh();
  check('removal survives refresh', reopened.get('service:UNICODE') === null);
  check('unknown entry reads as absent', reopened.get('device:missing') === null);
  check('invalid IDs and oversized values fail without disabling healthy storage', refused(() => reopened.set('__proto__', 'x'), 'invalid')
    && refused(() => reopened.set('service:LARGE', 'x'.repeat(512 * 1024 + 1)), 'invalid') && reopened.available());
  check('invalid profile identity is rejected', refused(() => new HostSecretVault(file, '/host/path', keyring), 'invalid'));

  keyring.probeResult = { state: 'locked' }; const reads = keyring.reads; await reopened.refresh();
  check('locked collection is checked before looking up even an existing key', reopened.status().state === 'locked' && keyring.reads === reads);
  check('refresh on lock discards cached access to secrets', refused(() => reopened.get('harness:codex'), 'unavailable') && refused(() => reopened.set('harness:codex', 'x'), 'unavailable'));
  keyring.probeResult = { state: 'ready', protection: 'passwordless' }; await reopened.refresh();
  check('unlock recovers previous values without replacing the key', reopened.get('harness:codex') === secret && keyring.creates === 1);
  check('passwordless protection is explicit, value-free diagnostics', JSON.stringify(reopened.status()) === JSON.stringify({ state: 'ready', protection: 'passwordless' }));
  keyring.probeResult = { state: 'unavailable' }; await reopened.refresh();
  check('service loss is distinct from locked and refuses cached values', reopened.status().state === 'unavailable' && refused(() => reopened.get('harness:codex'), 'unavailable'));
  keyring.probeResult = { state: 'ready', protection: 'unknown' }; await reopened.refresh();
  check('service recovery is retryable and does not claim encrypted keyring protection', reopened.available() && JSON.stringify(reopened.status()).includes('unknown'));

  const locked = fixture(); locked.keyring.probeResult = { state: 'locked' }; await locked.vault.refresh();
  check('negative: missing key in locked collection creates no key or file', locked.vault.status().state === 'locked' && locked.keyring.reads === 0 && locked.keyring.creates === 0 && !existsSync(locked.file));
  const racing = fixture(); racing.keyring.read = async () => { racing.keyring.probeResult = { state: 'locked' }; return null; }; await racing.vault.refresh();
  check('negative: collection locks after missing-key read; no first-use creation', racing.vault.status().state === 'locked' && racing.keyring.creates === 0);
  const missing = fixture(); await missing.vault.refresh(); missing.vault.set('harness:codex', secret); const preserved = readFileSync(missing.file);
  missing.keyring.key = null; await missing.vault.refresh();
  check('negative: existing vault with lost OS key is never reinitialized', JSON.stringify(missing.vault.status()).includes('key-missing') && missing.keyring.creates === 1 && readFileSync(missing.file).equals(preserved));
  const deleted = fixture(); await deleted.vault.refresh(); deleted.vault.set('harness:codex', secret); rmSync(deleted.file);
  const afterDeletion = new HostSecretVault(deleted.file, profile, deleted.keyring); await afterDeletion.refresh();
  check('negative: deleted vault with existing OS key is not silently recreated on restart', !afterDeletion.available() && deleted.keyring.creates === 1 && !existsSync(deleted.file));
  const orphan = fixture(); orphan.keyring.key = randomBytes(32); await orphan.vault.refresh();
  check('orphan OS key after interrupted first initialization fails closed', !orphan.vault.available() && orphan.keyring.creates === 0 && !existsSync(orphan.file));
  const invalidKey = fixture(); invalidKey.keyring.key = Buffer.from('short'); await invalidKey.vault.refresh();
  check('malformed OS key is refused without replacement', JSON.stringify(invalidKey.vault.status()).includes('key-invalid') && invalidKey.keyring.creates === 0);
  const brokenProvider = fixture(); brokenProvider.keyring.read = async () => { throw new Error(`password=${secret} /private/host/path`); }; await brokenProvider.vault.refresh();
  check('native provider errors cannot leak into diagnostics', JSON.stringify(brokenProvider.vault.status()) === JSON.stringify({ state: 'unavailable', reason: 'keyring' }));

  const validBytes = readFileSync(file);
  for (const [label, index] of [['version', 8], ['nonce', 9], ['tag', 21], ['ciphertext', validBytes.length - 1]] as const) {
    const corrupt = Buffer.from(validBytes); corrupt[index] ^= 1; writeFileSync(file, corrupt); await reopened.refresh();
    check(`negative: altered ${label} is refused without changing the file`, !reopened.available() && readFileSync(file).equals(corrupt));
  }
  writeFileSync(file, validBytes);
  const otherProfile = new HostSecretVault(file, hash('different-profile'), keyring); await otherProfile.refresh();
  check('negative: same OS key cannot decrypt another profile context', !otherProfile.available());
  const originalKey = Buffer.from(keyring.key!); keyring.key = randomBytes(32); await reopened.refresh();
  check('negative: wrong OS key cannot decrypt or reset existing vault', !reopened.available() && readFileSync(file).equals(validBytes));
  keyring.key = originalKey; await reopened.refresh();
  check('positive: intact file and original key recover after negative controls', reopened.get('harness:codex') === secret);

  const stale = new HostSecretVault(file, profile, keyring); await stale.refresh(); reopened.set('service:FIRST', 'one');
  const newest = readFileSync(file);
  check('external modification fence refuses stale writer and preserves newer data', refused(() => stale.set('service:STALE', 'two'), 'unavailable') && readFileSync(file).equals(newest));

  // Desktop migration sender is deliberately a fixture in H2a: old files are
  // only read here. OS safeStorage decoding and activation belong to H2c.
  const legacyFiles = ['harness-credentials.json', 'devices.json', 'push.json'].map(name => join(root, name));
  legacyFiles.forEach((path, index) => writeFileSync(path, `encrypted-old-store-${index}`));
  const snapshots = legacyFiles.map(path => readFileSync(path));
  const source = hash(snapshots.map(bytes => hash(bytes.toString())).join(':'));
  const migrating = fixture(); await migrating.vault.refresh(); migrating.vault.beginMigration(source);
  const receipt = migrating.vault.importLegacy(source, 'harness:codex', secret);
  check('migration returns a value-free per-entry durable receipt', JSON.stringify(receipt) === JSON.stringify({ sourceDigest: source, id: 'harness:codex' }));
  check('partial migration blocks ordinary writes and removal', refused(() => migrating.vault.set('device:one', 'x'), 'migration-pending') && refused(() => migrating.vault.remove('harness:codex'), 'migration-pending'));
  check('partial migration cannot supply credentials to a launching consumer', refused(() => migrating.vault.get('harness:codex'), 'migration-pending'));
  check('partial migration cannot be confirmed with missing or duplicate entry IDs', refused(() => migrating.vault.finishMigration(source, []), 'migration-conflict')
    && refused(() => migrating.vault.finishMigration(source, ['harness:codex', 'harness:codex']), 'migration-conflict'));
  migrating.vault.close(); // Sender/host interrupted after the first acknowledgement.
  check('interrupted migration leaves all three old stores byte-for-byte intact', legacyFiles.every((path, index) => readFileSync(path).equals(snapshots[index])));
  const resume = new HostSecretVault(migrating.file, profile, migrating.keyring); await resume.refresh(); resume.beginMigration(source);
  check('restart retains partial migration status and first entry confirmation', resume.migrationStatus()?.complete === false && resume.migrationStatus()?.ids.includes('harness:codex') === true);
  const beforeRetry = readFileSync(migrating.file);
  check('retry of acknowledged entry is idempotent and does not rewrite', resume.importLegacy(source, 'harness:codex', secret).id === receipt.id && readFileSync(migrating.file).equals(beforeRetry));
  check('changed source manifest or changed value cannot overwrite acknowledged entry', refused(() => resume.beginMigration(hash('other source')), 'migration-conflict')
    && refused(() => resume.importLegacy(source, 'harness:codex', 'replacement'), 'migration-conflict'));
  resume.importLegacy(source, 'device:phone', 'device-test-only'); resume.importLegacy(source, 'push:state', '{"privateKey":"push-test-only"}');
  resume.finishMigration(source, ['push:state', 'harness:codex', 'device:phone']); await resume.refresh();
  check('positive: complete migration survives reopen with all values and confirmations', resume.migrationStatus()?.complete === true
    && resume.get('device:phone') === 'device-test-only' && resume.get('push:state') === '{"privateKey":"push-test-only"}');
  check('migration metadata is encrypted with the values', !readFileSync(migrating.file).includes(source) && !readFileSync(migrating.file).includes('device:phone'));
  resume.remove('harness:codex'); resume.finishMigration(source, ['harness:codex', 'device:phone', 'push:state']);
  check('completed migration retries cannot resurrect a later deleted credential', refused(() => resume.importLegacy(source, 'harness:codex', secret), 'migration-conflict') && resume.get('harness:codex') === null);
  check('positive: successful migration also retains old files for explicit later cleanup', legacyFiles.every((path, index) => readFileSync(path).equals(snapshots[index])));
  check('migration cannot replace a nonempty independently populated vault', refused(() => reopened.beginMigration(source), 'migration-conflict'));

  const noReceipt = fixture(); await noReceipt.vault.refresh(); noReceipt.vault.beginMigration(source);
  writeFileSync(noReceipt.file, 'changed underneath');
  check('failed durable write returns no receipt and disables vault', refused(() => noReceipt.vault.importLegacy(source, 'device:phone', secret), 'unavailable')
    && !noReceipt.vault.available() && readFileSync(noReceipt.file, 'utf8') === 'changed underneath');
  const limit = fixture(); await limit.vault.refresh();
  for (let i = 0; i < 256; i++) limit.vault.set(`service:KEY_${i}`, 'x');
  check('entry count is bounded with existing values preserved', refused(() => limit.vault.set('service:EXCESS', 'x'), 'invalid') && limit.vault.get('service:KEY_0') === 'x');
  const aggregate = fixture(); await aggregate.vault.refresh();
  for (let i = 0; i < 3; i++) aggregate.vault.set(`push:chunk_${i}`, 'x'.repeat(512 * 1024));
  check('aggregate size is bounded before writing and keeps healthy data', refused(() => aggregate.vault.set('push:chunk_3', 'x'.repeat(512 * 1024)), 'invalid') && aggregate.vault.available());

  const oversized = fixture(); mkdirSync(join(oversized.file, '..'), { recursive: true }); writeFileSync(oversized.file, Buffer.alloc(MAX_VAULT_BYTES + 1)); await oversized.vault.refresh();
  check('oversized disk input is refused before a key is created', !oversized.vault.available() && oversized.keyring.creates === 0);
  const truncated = fixture(); mkdirSync(join(truncated.file, '..'), { recursive: true }); writeFileSync(truncated.file, ''); await truncated.vault.refresh();
  check('empty/truncated existing file is not mistaken for first use', !truncated.vault.available() && truncated.keyring.creates === 0);
  const directory = fixture(); mkdirSync(directory.file, { recursive: true }); await directory.vault.refresh();
  check('directory at file path is refused', !directory.vault.available() && directory.keyring.creates === 0);

  // Authenticated but structurally invalid plaintext is still refused.
  const invalidState = fixture(); invalidState.keyring.key = randomBytes(32); mkdirSync(join(invalidState.file, '..'), { recursive: true });
  const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', invalidState.keyring.key, nonce);
  cipher.setAAD(Buffer.from(`ade:host-secret-vault:1:${profile}`));
  const body = Buffer.concat([cipher.update(JSON.stringify({ version: 1, entries: [{ id: '__proto__', value: secret }], migration: null })), cipher.final()]);
  writeFileSync(invalidState.file, Buffer.concat([Buffer.from('ADEVAULT\x01', 'binary'), nonce, cipher.getAuthTag(), body])); await invalidState.vault.refresh();
  check('authenticated malformed state fails schema validation', !invalidState.vault.available());

  if (process.platform !== 'win32') {
    const linked = fixture(); mkdirSync(join(linked.file, '..'), { recursive: true }); symlinkSync(file, linked.file); await linked.vault.refresh();
    check('symlinked vault is refused without keyring writes', !linked.vault.available() && linked.keyring.creates === 0);
    const hardlinked = fixture(); mkdirSync(join(hardlinked.file, '..'), { recursive: true }); linkSync(file, hardlinked.file); await hardlinked.vault.refresh();
    check('hardlinked vault is refused without keyring writes', !hardlinked.vault.available() && hardlinked.keyring.creates === 0);
    const parent = join(root, 'linked-parent'); symlinkSync(join(migrating.file, '..'), parent);
    const parentVault = new HostSecretVault(join(parent, 'secrets.vault'), profile, migrating.keyring); await parentVault.refresh();
    check('symlinked ancestor is refused for reads and writes', !parentVault.available());
  }

  const closing = fixture(); let release!: (probe: KeyringProbe) => void;
  closing.keyring.probe = () => new Promise(resolve => { release = resolve; });
  const pending = closing.vault.refresh(); closing.vault.close(); release({ state: 'ready', protection: 'encrypted' }); await pending;
  check('close during asynchronous initialization cannot resurrect cached keys', !closing.vault.available() && closing.keyring.creates === 0 && JSON.stringify(closing.vault.status()).includes('closed'));
  await closing.vault.refresh();
  check('closed vault cannot be reopened through refresh', !closing.vault.available() && refused(() => closing.vault.get('harness:codex'), 'unavailable'));
  await resume.refresh();
  check('final positive control: migrated vault remains readable', resume.available() && resume.get('device:phone') === 'device-test-only');
} finally { rmSync(root, { recursive: true, force: true }); }

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
