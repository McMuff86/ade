/** Opt-in installed app-server handshake/config/thread probe. No model turn. */
import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { assertCoordinatorCodexConfig, assertCoordinatorCodexThread, assertCoordinatorCodexVersion, COORDINATOR_CODEX_CONTRACT, launchCoordinatorCodex } from '../src/main/pty/CoordinatorCodexPolicy';
import { redactedErrorDetail } from '../src/main/errors';

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-coordinator-policy-')));
const evidence = resolve('test-results/main-agent-planning'); mkdirSync(evidence, { recursive: true });
void new Promise<void>((resolve, reject) => {
  const child = launchCoordinatorCodex(root, process.env as Record<string, string>); let confirmed = false; let failed = false; let failure: unknown; let outputBytes = 0;
  const stop = () => { if (child.pid && child.exitCode === null && child.signalCode === null) execFile('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, error => { if (error) child.kill(); }); };
  const fail = (error: unknown) => { if (failed) return; failed = true; failure = error; stop(); };
  const timer = setTimeout(() => fail(new Error('Native coordinator policy probe exceeded 30 seconds')), 30000);
  const send = (id: number, method: string, params: unknown) => child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  child.on('error', fail); child.stdin.on('error', fail); child.stderr.on('data', () => undefined);
  child.stdout.on('data', (chunk: Buffer) => { outputBytes += chunk.length; if (outputBytes > 2 * 1024 * 1024) fail(new Error('Native config response exceeded bound')); });
  createInterface({ input: child.stdout }).on('line', line => {
    if (failed) return;
    try {
      const message = JSON.parse(line) as { id?: number; error?: unknown; result?: unknown };
      if (message.error) throw new Error('Native Codex policy request was refused');
      if (message.id === 1) { assertCoordinatorCodexVersion(message.result); child.stdin.write('{"method":"initialized"}\n'); send(2, 'config/read', { includeLayers: false, cwd: root }); }
      if (message.id === 2) { assertCoordinatorCodexConfig(message.result); send(3, 'thread/start', { cwd: root, sandbox: 'read-only', approvalPolicy: 'never' }); }
      if (message.id === 3) { assertCoordinatorCodexThread(message.result); confirmed = true; stop(); }
    } catch (error) { fail(error); }
  });
  child.on('close', () => { clearTimeout(timer); if (confirmed && !failed) resolve(); else reject(failure ?? new Error('Native Codex closed before policy confirmation')); });
  send(1, 'initialize', { clientInfo: { name: 'ade_coordinator_probe', version: '0.1' }, capabilities: { experimentalApi: true } });
}).then(() => {
  writeFileSync(join(evidence, 'codex-coordinator-policy.json'), JSON.stringify({ at: new Date().toISOString(), platform: process.platform, native: true,
    contract: COORDINATOR_CODEX_CONTRACT, checks: { version: true, effectiveConfig: true, threadReadOnlyWithoutNetwork: true }, modelTurnStarted: false }, null, 2));
  console.log('Native coordinator Codex policy: 3 passed, 0 failed; no model turn');
}).catch(error => { console.error(redactedErrorDetail(error)); process.exitCode = 1; }).finally(() => {
  if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected probe workspace');
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
