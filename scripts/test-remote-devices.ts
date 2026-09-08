import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RemoteDeviceStore, type DeviceAuditEntry, type DeviceSecretProtection } from '../src/main/remote/RemoteDeviceStore';
import { RemoteAuthorizer, sha256Hex, signRequest, type RemoteDevice } from '../src/main/remote/authorization';
import { assertIpcPayload } from '../src/main/ipcValidation';
import { CHANNEL_POLICY } from '../src/main/ipcPolicy';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean): void {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.error(`FAIL  ${name}`); }
}
function rejects(name: string, action: () => unknown): void {
  try { action(); check(name, false); } catch { check(name, true); }
}
const key = randomBytes(32);
const protection: DeviceSecretProtection = {
  available: () => true,
  encrypt: (value) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  },
  decrypt: (value) => {
    const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
    cipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8');
  },
};
const root = mkdtempSync(join(tmpdir(), 'ade-device-tests-'));
const device: RemoteDevice = { id: 'phone-1', secret: 'd'.repeat(40), scopes: ['read', 'runs:write'] };
const audit: DeviceAuditEntry = { at: Date.now(), principalId: 'phone-1', principalKind: 'device',
  requestId: 'test-request', channel: 'run:create', target: 'run-1', outcome: 'executed' };
try {
  const dir = join(root, 'normal');
  let store = new RemoteDeviceStore(dir, protection);
  check('fresh vault has a useful empty inventory', store.inventory().available && store.inventory().devices.length === 0);
  store.importBootstrap([device]);
  check('bootstrap persists one revocable identity', store.inventory().devices[0]?.id === device.id && store.activeDevices().length === 1);
  const raw = readFileSync(join(dir, 'devices.json'), 'utf8');
  check('device secret is encrypted at rest and absent from desktop inventory', !raw.includes(device.secret)
    && !JSON.stringify(store.inventory()).includes('encryptedSecret') && !JSON.stringify(store.inventory()).includes(device.secret));
  store.rename(device.id, 'Mein Telefon');
  store = new RemoteDeviceStore(dir, protection);
  check('device name and credential survive restart', store.inventory().devices[0]?.name === 'Mein Telefon'
    && store.activeDevices()[0]?.secret === device.secret);
  store.importBootstrap([{ ...device, id: 'replacement' }]);
  check('bootstrap is consumed once, even if the environment changes', store.inventory().devices.length === 1);
  const authorizer = new RemoteAuthorizer('t'.repeat(32), [], undefined, store);
  const signed = { method: 'GET', path: '/api/v1/catalog', timestamp: String(Date.now()), idempotencyKey: '', bodySha256: sha256Hex('') };
  check('authorizer resolves the durable identity', authorizer.verifyDeviceSignature(device.id, signRequest(device.secret, signed), signed).ok);
  let revoked: string | null | undefined;
  store.onRevoked((id) => { revoked = id; });
  store.revoke(device.id);
  check('revocation synchronously notifies connections and removes authorization', revoked === device.id && authorizer.deviceCount() === 0
    && !authorizer.verifyDeviceSignature(device.id, signRequest(device.secret, signed), signed).ok);
  check('revocation removes encrypted key material', JSON.parse(readFileSync(join(dir, 'devices.json'), 'utf8')).devices[0].encryptedSecret === null);
  store = new RemoteDeviceStore(dir, protection);
  store.importBootstrap([device]);
  check('restart plus stale bootstrap cannot resurrect a revoked device', store.activeDevices().length === 0
    && store.inventory().devices[0]?.revokedAt !== null);
  const auditBefore = readFileSync(store.auditPath, 'utf8');
  store.revoke(device.id);
  check('repeated revocation is idempotent', readFileSync(store.auditPath, 'utf8') === auditBefore);
  rejects('revoked devices cannot be renamed', () => store.rename(device.id, 'Another name'));
  store.audit({ ...audit, reason: 'token=private-value /home/adi/private/file.txt' });
  const lines = readFileSync(store.auditPath, 'utf8');
  check('durable audit preserves earlier entries and device mutation outcomes', lines.startsWith(auditBefore)
    && lines.includes('device:import') && lines.includes('device:rename') && lines.includes('device:revoke') && lines.includes('requested'));
  check('audit excludes device keys, paths and credentials', !lines.includes(device.secret) && !lines.includes('private-value')
    && !lines.includes('/home/adi') && !lines.includes('encryptedSecret'));
  check('audit remains readable after restart', new RemoteDeviceStore(dir, protection).inventory().available);

  const unavailable = new RemoteDeviceStore(join(root, 'unavailable'), { ...protection, available: () => false });
  rejects('missing OS secret storage refuses provisioning', () => unavailable.importBootstrap([device]));
  check('unavailable encryption exposes an error and authorizes nobody', !unavailable.inventory().available
    && unavailable.inventory().error !== null && unavailable.activeDevices().length === 0);
  const corruptDir = join(root, 'corrupt');
  mkdirSync(corruptDir);
  writeFileSync(join(corruptDir, 'devices.json'), '{broken');
  const corrupt = new RemoteDeviceStore(corruptDir, protection);
  check('corrupt state fails closed and preserves original bytes', !corrupt.inventory().available
    && readFileSync(join(corruptDir, 'devices.json'), 'utf8') === '{broken');
  rejects('bootstrap never replaces corrupt state', () => corrupt.importBootstrap([device]));

  const missingDir = join(root, 'missing-state');
  const missing = new RemoteDeviceStore(missingDir, protection);
  missing.importBootstrap([device]);
  missing.revoke(device.id);
  rmSync(join(missingDir, 'devices.json'));
  const missingRestart = new RemoteDeviceStore(missingDir, protection);
  check('missing state with prior device audit is not treated as a new profile', !missingRestart.inventory().available);
  rejects('losing the device file cannot resurrect a revoked bootstrap identity', () => missingRestart.importBootstrap([device]));

  const tornDir = join(root, 'torn');
  const torn = new RemoteDeviceStore(tornDir, protection);
  torn.importBootstrap([device]);
  appendFileSync(torn.auditPath, '{partial');
  const restoredTorn = new RemoteDeviceStore(tornDir, protection);
  check('torn audit fails closed on restart', !restoredTorn.inventory().available && restoredTorn.activeDevices().length === 0);
  rejects('externally changed audit blocks the next write', () => torn.audit(audit));
  check('failed audit immediately disables existing authorization', torn.activeDevices().length === 0);

  const writeFail = new RemoteDeviceStore(join(root, 'write-fail'), protection);
  writeFail.importBootstrap([device]);
  const storedPath = join(root, 'write-fail', 'devices.json');
  // Non-recursive deletion of a known disposable file creates a deterministic rename failure.
  rmSync(storedPath);
  mkdirSync(storedPath);
  rejects('failed state write never reports a successful rename', () => writeFail.rename(device.id, 'Unsaved'));
  check('failed persistence disables live authorization', writeFail.activeDevices().length === 0);

  const fullDir = join(root, 'full');
  const full = new RemoteDeviceStore(fullDir, protection);
  full.importBootstrap([device]);
  writeFileSync(full.auditPath, Buffer.alloc(8 * 1024 * 1024, 10));
  rejects('audit size bound refuses further mutations', () => full.rename(device.id, 'Unsaved'));
  check('full audit fails closed on restart', !new RemoteDeviceStore(fullDir, protection).inventory().available);

  const linkTarget = join(root, 'link-target');
  mkdirSync(linkTarget);
  symlinkSync(linkTarget, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  check('device storage refuses a linked root', !new RemoteDeviceStore(join(root, 'linked'), protection).inventory().available);
  for (const name of ['', '   ', 'a'.repeat(81), 'bad\nname', 'bad\0name']) {
    rejects('IPC rejects invalid device name', () => assertIpcPayload('remoteDevices:rename', { deviceId: device.id, name }));
  }
  rejects('IPC rejects extra credential fields', () => assertIpcPayload('remoteDevices:rename', { deviceId: device.id, name: 'Phone', secret: device.secret }));
  rejects('IPC rejects traversal device ids', () => assertIpcPayload('remoteDevices:revoke', { deviceId: '../devices' }));
  rejects('inventory rejects payloads', () => assertIpcPayload('remoteDevices:list', { extra: true }));
  check('all device channels remain desktop-only', ['remoteDevices:list', 'remoteDevices:rename', 'remoteDevices:revoke']
    .every((channel) => CHANNEL_POLICY[channel as keyof typeof CHANNEL_POLICY].surface === 'desktop'));
  const positive = new RemoteDeviceStore(join(root, 'positive'), protection);
  positive.importBootstrap([device]);
  positive.rename(device.id, 'Positive control');
  check('final positive control persists normally after negative controls', new RemoteDeviceStore(join(root, 'positive'), protection).inventory().devices[0]?.name === 'Positive control');
} finally {
  // root is the absolute mkdtemp directory created by this test alone.
  rmSync(root, { recursive: true, force: true });
}
console.log(`\nRemote devices: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
