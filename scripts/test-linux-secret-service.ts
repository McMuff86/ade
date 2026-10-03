/** Native Linux integration; registered with an explicit platform gate in verify. */
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HostSecretVault } from '../src/main/host/secrets/HostSecretVault';
import { LinuxWrappingKeyStore, secretProfileId } from '../src/main/host/secrets/LinuxWrappingKeyStore';
import { SecretVaultMonitor } from '../src/main/host/secrets/SecretVaultMonitor';
import { IsolatedSecretService } from './helpers/isolatedSecretService';
import { buildDir } from './helpers/buildOutput';

let passed = 0; let failed = 0;
const check = (label: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
const rejects = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch { return true; } };
async function run(): Promise<void> {
  if (process.platform !== 'linux') throw new Error('Use verify platform gate: Linux Secret Service is not measured here');
  const require = createRequire(import.meta.url);
  const workerPath = join(buildDir(), 'main', 'keyringWorker.js');
  if (!existsSync(workerPath)) throw new Error('Build the isolated keyring worker through verify first');
  for (const [runtime, executable] of [['node', process.execPath], ['electron-run-as-node', require('electron') as string]]) {
    const service = new IsolatedSecretService();
    let monitor: SecretVaultMonitor | undefined;
    try {
      await service.startBus();
      const directory = join(service.root, 'profile'); mkdirSync(directory);
      const id = secretProfileId(directory); const file = join(directory, 'secrets.vault');
      const keyring = new LinuxWrappingKeyStore(id, { workerPath, executable, env: service.env });
      const vault = new HostSecretVault(file, id, keyring);
      check(`${runtime}: absent service is unavailable without fallback`, (await keyring.probe()).state === 'unavailable');
      await service.startDaemon('fixture-password');
      check(`${runtime}: unlocked password-protected collection is diagnosed`, JSON.stringify(await keyring.probe()) === JSON.stringify({ state: 'ready', protection: 'encrypted' }));
      service.lock(); await vault.refresh();
      check(`${runtime}: locked empty collection creates neither key nor vault`, vault.status().state === 'locked' && !existsSync(file));
      check(`${runtime}: locked collection rejects key creation`, await rejects(() => keyring.create(randomBytes(32))));
      await service.unlock('fixture-password'); await vault.refresh();
      check(`${runtime}: unlock allows native key provisioning`, vault.available());
      vault.set('harness:codex', 'native-keyring-fixture');
      const key = await keyring.read();
      check(`${runtime}: native OS entry roundtrip has exactly 32 bytes`, key?.length === 32);
      check(`${runtime}: existing wrapping key is never overwritten`, await rejects(() => keyring.create(randomBytes(32))) && (await keyring.read())?.equals(key!) === true);
      const other = join(service.root, 'other-profile'); mkdirSync(other);
      const otherId = secretProfileId(other); const otherKeyring = new LinuxWrappingKeyStore(otherId, { workerPath, executable, env: service.env });
      check(`${runtime}: profile identity is stable and isolates OS entries`, id === secretProfileId(directory) && id !== otherId && await otherKeyring.read() === null);
      const reopened = new HostSecretVault(file, id, keyring); await reopened.refresh();
      check(`${runtime}: host restart reads same persistent secret`, reopened.get('harness:codex') === 'native-keyring-fixture');
      monitor = new SecretVaultMonitor(reopened, keyring); await monitor.checkNow();
      service.lock(); await monitor.checkNow();
      check(`${runtime}: observer drops cached key after lock`, !reopened.available() && reopened.status().state === 'locked');
      await service.unlock('fixture-password'); await monitor.checkNow();
      check(`${runtime}: observer recovers after unlock`, reopened.get('harness:codex') === 'native-keyring-fixture');
      const before = readFileSync(file); await service.stopDaemon(); await monitor.checkNow();
      check(`${runtime}: service loss blocks cached secrets and preserves vault`, !reopened.available() && readFileSync(file).equals(before));
      await service.startDaemon('fixture-password'); await monitor.checkNow();
      check(`${runtime}: service restart recovers same OS key and ciphertext`, reopened.get('harness:codex') === 'native-keyring-fixture' && readFileSync(file).equals(before));
      // A non-durable session collection must never become a fallback target.
      const originalCollection = service.collection();
      service.call('call', 'org.freedesktop.secrets', '/org/freedesktop/secrets', 'org.freedesktop.Secret.Service', 'SetAlias', 'so', 'default', '/org/freedesktop/secrets/collection/session');
      check(`${runtime}: session collection is refused for a new profile`, (await otherKeyring.probe()).state === 'unavailable');
      check(`${runtime}: existing key uses its actual collection, not changed default`, (await keyring.read())?.equals(key!) === true);
      service.call('call', 'org.freedesktop.secrets', '/org/freedesktop/secrets', 'org.freedesktop.Secret.Service', 'SetAlias', 'so', 'default', originalCollection);
      const duplicate = service.duplicate(id);
      check(`${runtime}: ambiguous OS entries are refused without modifying the vault`, (await keyring.probe()).state === 'unavailable' && readFileSync(file).equals(before));
      service.call('call', 'org.freedesktop.secrets', duplicate, 'org.freedesktop.Secret.Item', 'Delete');
      check(`${runtime}: removing fixture ambiguity restores the original wrapping key`, (await keyring.read())?.equals(key!) === true);
      service.replaceKey(id, randomBytes(32)); await monitor.checkNow();
      check(`${runtime}: changed key in same OS item invalidates cached vault`, !reopened.available() && readFileSync(file).equals(before));
      service.replaceKey(id, key!); await monitor.checkNow();
      check(`${runtime}: original key restores access after external replacement control`, reopened.get('harness:codex') === 'native-keyring-fixture');
      monitor.close(); otherKeyring.close(); key?.fill(0);
    } finally { monitor?.close(); await service.close(); }
    const passwordless = new IsolatedSecretService();
    try {
      await passwordless.startBus(); await passwordless.startDaemon('');
      const directory = join(passwordless.root, 'profile'); mkdirSync(directory);
      const keyring = new LinuxWrappingKeyStore(secretProfileId(directory), { workerPath, executable, env: passwordless.env });
      check(`${runtime}: passwordless GNOME collection has explicit diagnosis`, JSON.stringify(await keyring.probe()) === JSON.stringify({ state: 'ready', protection: 'passwordless' }));
      const vault = new HostSecretVault(join(directory, 'secrets.vault'), secretProfileId(directory), keyring); await vault.refresh();
      vault.set('service:CONTROL', 'positive');
      check(`${runtime}: final positive control stores and retrieves with passwordless diagnosis`, vault.get('service:CONTROL') === 'positive' && JSON.stringify(vault.status()).includes('passwordless'));
      keyring.close(); vault.close();
    } finally { await passwordless.close(); }
  }
  console.log(`\n${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
}
run().catch(error => { console.error(error); process.exitCode = 1; });
