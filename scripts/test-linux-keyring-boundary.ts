/** Child-process and observer contracts, independent of the user's keyring. */
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostSecretVault, type KeyringProbe } from '../src/main/host/secrets/HostSecretVault';
import { LinuxWrappingKeyStore, secretProfileId } from '../src/main/host/secrets/LinuxWrappingKeyStore';
import { SecretVaultMonitor, type ObservedKeyStore } from '../src/main/host/secrets/SecretVaultMonitor';

let passed = 0; let failed = 0;
const check = (label: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
class ObservedFake implements ObservedKeyStore {
  state: KeyringProbe = { state: 'ready', protection: 'encrypted' };
  key: Buffer | null = null; epoch = 'one'; reads = 0; closed = false; probes = 0;
  async probe(): Promise<KeyringProbe> { this.probes++; return { ...this.state }; }
  async read(): Promise<Buffer | null> { this.reads++; return this.key && Buffer.from(this.key); }
  async create(key: Buffer): Promise<void> { if (this.key) throw new Error(); this.key = Buffer.from(key); }
  generation(): string { return this.epoch; }
  close(): void { this.closed = true; }
}
async function run(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'ade-keyring-boundary-'));
  try {
    const id = secretProfileId(root);
    check('profile ID exposes no absolute path and is stable', /^[a-f0-9]{64}$/.test(id) && secretProfileId(root) === id);
    const other = join(root, 'other'); mkdirSync(other);
    check('distinct profiles have distinct entries', secretProfileId(other) !== id);
    const fake = new ObservedFake(); const vault = new HostSecretVault(join(root, 'vault'), id, fake);
    const states: string[] = []; const monitor = new SecretVaultMonitor(vault, fake, state => states.push(state.state), 50, 200);
    await monitor.checkNow(); vault.set('harness:codex', 'test-key'); const reads = fake.reads;
    await monitor.checkNow();
    check('unchanged healthy probe keeps cached key without extra reads', fake.reads === reads && vault.get('harness:codex') === 'test-key');
    fake.state = { state: 'locked' }; await monitor.checkNow();
    check('observer emits locked and removes cached access', states.at(-1) === 'locked' && !vault.available());
    fake.state = { state: 'ready', protection: 'encrypted' }; await monitor.checkNow();
    check('observer recovers on unlock', vault.get('harness:codex') === 'test-key' && states.at(-1) === 'ready');
    fake.state = { state: 'ready', protection: 'passwordless' }; await monitor.checkNow();
    check('protection change updates diagnostic even with unchanged service generation', JSON.stringify(vault.status()).includes('passwordless'));
    fake.key = randomBytes(32); fake.epoch = 'restarted'; await monitor.checkNow();
    check('changed service/key generation cannot reuse stale cached values', !vault.available());
    monitor.close();
    check('monitor closes provider and vault', fake.closed && JSON.stringify(vault.status()).includes('closed'));

    const retryFake = new ObservedFake(); retryFake.state = { state: 'unavailable' };
    const retryVault = new HostSecretVault(join(root, 'retry'), id, retryFake);
    const retry = new SecretVaultMonitor(retryVault, retryFake, () => undefined, 50, 200); await retry.start();
    const probes = retryFake.probes; await delay(130);
    check('unavailable provider is automatically retried', retryFake.probes > probes && !retryVault.available());
    retryFake.state = { state: 'ready', protection: 'unknown' };
    const deadline = Date.now() + 1000;
    while (!retryVault.available() && Date.now() < deadline) await delay(25);
    check('automatic retry recovers when service appears', retryVault.available());
    retry.close(); const stoppedProbes = retryFake.probes; await delay(220);
    check('close removes all retry work', stoppedProbes === retryFake.probes);

    const pendingFake = new ObservedFake(); let release!: (value: KeyringProbe) => void;
    pendingFake.probe = () => new Promise(resolve => { release = resolve; });
    const pendingVault = new HostSecretVault(join(root, 'pending'), id, pendingFake);
    const pending = pendingVault.refresh(); pendingVault.invalidate(); release({ state: 'ready', protection: 'encrypted' }); await pending;
    check('invalidation during pending initialization cannot restore stale availability', !pendingVault.available() && pendingFake.key === null);

    if (process.platform === 'linux') {
      const worker = join(root, 'worker.cjs');
      const make = (body: string, timeoutMs = 1000) => {
        writeFileSync(worker, body);
        return new LinuxWrappingKeyStore(id, { workerPath: worker, executable: process.execPath, timeoutMs,
          env: { HOME: root, DBUS_SESSION_BUS_ADDRESS: 'unix:path=/no-test-bus', NODE_OPTIONS: '--invalid-option', SECRET_TOKEN: 'must-not-propagate' } });
      };
      let store = make('setInterval(()=>{},1000)', 150); const started = Date.now();
      check('hung native worker is killed within bounded wall time', (await store.probe()).state === 'unavailable' && Date.now() - started < 2000);
      store = make('setInterval(()=>{},1000)'); const active = store.probe(); store.close();
      check('close cancels an active native operation', (await active).state === 'unavailable' && (await store.probe()).state === 'unavailable');
      store = make('process.stdout.write("x".repeat(3000));setInterval(()=>{},1000)');
      check('oversized worker output fails closed', (await store.probe()).state === 'unavailable');
      store = make('process.stdout.write("not json");');
      check('malformed worker output fails closed', (await store.probe()).state === 'unavailable');
      store = make('process.stdout.write(JSON.stringify({state:"unavailable",error:"secret=must-not-propagate"}));');
      check('worker errors are projected to fixed diagnostics', JSON.stringify(await store.probe()) === '{"state":"unavailable"}');
      const revision = createHash('sha256').update('test').digest('hex');
      store = make(`if(process.env.SECRET_TOKEN||process.env.NODE_OPTIONS)process.exit(1);process.stdout.write(JSON.stringify({state:'ready',protection:'unknown',revision:'${revision}',extra:'not-public'}));`);
      check('worker environment excludes credentials and loader options; output is projected', JSON.stringify(await store.probe()) === '{"state":"ready","protection":"unknown"}');
      const key = randomBytes(32);
      store = make(`let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{const r=JSON.parse(s);if(process.argv.length!==2||r.operation!=='create'||r.key!=='${key.toString('base64')}')process.exit(1);process.stdout.write(JSON.stringify({state:'ready',protection:'unknown',revision:'${revision}'}))});`);
      let created = false; try { await store.create(key); created = true; } catch { /* Checked below. */ }
      check('wrapping key travels only through stdin, never argv', created);
      store = make(`process.stdout.write(JSON.stringify({state:'ready',protection:'unknown',revision:'${revision}',key:'bad'}));`);
      check('invalid key encoding is refused at process boundary', (await store.probe()).state === 'unavailable');
      store = make(`process.stdout.write(JSON.stringify({state:'ready',protection:'unknown',revision:'${revision}',key:'${key.toString('base64')}'}));`);
      check('final positive control accepts canonical 256-bit key', (await store.read())?.equals(key) === true);
      store.close(); key.fill(0);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
  console.log(`\n${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
}
run().catch(error => { console.error(error); process.exitCode = 1; });
