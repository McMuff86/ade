import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { RemoteApiError, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import { HostApiServer } from '../src/main/remote/HostApiServer';
import { RemoteAuthorizer, sha256Hex, signRequest } from '../src/main/remote/authorization';
import { BrowserRequestBudget } from '../src/main/remote/BrowserRequestBudget';
import { REMOTE_COMMAND_CHANNELS } from '../src/main/ipcPolicy';
import { REMOTE_ADMIN_SCOPES } from '../src/shared/remoteDevices';
import { REMOTE_SCOPE_LABELS } from '../src/shared/setup';
import { validDiagnosticsQuery, type MobileDiagnosticsResult } from '../src/shared/remote';
import type { RuntimeDiagnosticsResult } from '../src/shared/types';

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-remote-diagnostics-')));
let passed = 0; let failed = 0; let server: HostApiServer | undefined;
const check = (name: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } };
async function refuses(name: string, action: () => unknown, code: string) { try { await action(); check(name, false); } catch (error) { check(name, error instanceof RemoteApiError && error.code === code); } }

void (async () => {
  const fixture = createRemoteWorkspaceFixture(root); const { devices, application: app, diagnostics } = fixture;
  fixture.store.save({ agents: [
    { id: 'a1', name: 'Codex', runtime: 'codex', role: 'worker', createdAt: 1 } as never,
    { id: 'a2', name: 'Claude', runtime: 'claude', role: 'worker', createdAt: 1 } as never,
  ] });
  const secret = 'd'.repeat(40); devices.enroll('tablet', 'Tablet', secret);
  const context = (key: string = randomUUID()): RemoteCommandContext => ({ principal: { id: 'tablet', kind: 'device', proof: 'device-signature', scopes: new Set(devices.activeDevices().find(d => d.id === 'tablet')!.scopes) }, idempotencyKey: key, requestId: 'diag' });
  const probe: RuntimeDiagnosticsResult = { checkedAt: 5, platform: 'win32', items: [
    { agentId: 'a1', agentName: 'Codex', runtime: 'codex', label: 'Codex CLI', executionBackend: 'native', command: 'codex', installed: true, version: '0.42.0', authStatus: 'authenticated',
      authDetail: 'Logged in; config at C:\\Users\\adi\\.codex\\auth.json', taskTransport: 'argument', status: 'ready', message: 'Ready. Binary found at C:\\Users\\adi\\AppData\\npm\\codex.cmd' },
    { agentId: 'a2', agentName: 'Claude', runtime: 'claude', label: 'Claude CLI', executionBackend: 'wsl:Ubuntu', command: 'claude', installed: false, authStatus: 'unknown',
      authDetail: 'Not checked', taskTransport: 'unavailable', status: 'error', message: 'The selected WSL distribution or /bin/bash is unavailable: /home/adi/.local/bin missing' },
  ] };
  diagnostics.result = probe;
  const query = (payload: unknown = {}) => app.diagnostics(context(), payload) as Promise<MobileDiagnosticsResult>;

  check('the diagnostics grant exists with a label that says it starts checks on the PC', (REMOTE_ADMIN_SCOPES as readonly string[]).includes('diagnostics:read') && REMOTE_SCOPE_LABELS['diagnostics:read'].length > 10);
  await refuses('diagnostics need the dedicated grant', () => query(), 'scope_not_granted');
  check('a refused query never reaches the probes', diagnostics.calls.length === 0);
  devices.setAdminScopes('tablet', ['diagnostics:read'], { mode: 'all' });
  const all = await query();
  check('the grant runs the probes once and returns every configured runtime', diagnostics.calls.length === 1 && all.items.length === 2 && all.checkedAt === 5 && all.items[0]!.status === 'ready' && all.items[1]!.installed === false);
  const wire = JSON.stringify(all);
  check('host paths are redacted on the wire while structured facts survive', !wire.includes('Users') && !wire.includes('/home/') && wire.includes('[path]') && wire.includes('"version":"0.42.0"') && wire.includes('"executionBackend":"wsl:Ubuntu"'));
  await refuses('bearer token cannot run diagnostics', () => app.diagnostics({ ...context(), principal: { id: 'bootstrap', kind: 'bootstrap-token', proof: 'bearer', scopes: new Set(['read', 'diagnostics:read']) } }, {}), 'device_proof_required');
  for (const payload of [{ sessionId: 'pty-1' }, { agentId: 'a1', extra: 1 }, { agentId: 'C:\\bad' }, [], null, 'x']) await refuses('payload beyond an optional agent id is rejected', () => query(payload), 'invalid_payload');
  check('the shared validator matches the service', validDiagnosticsQuery({}) && validDiagnosticsQuery({ agentId: 'a1' }) && !validDiagnosticsQuery({ sessionId: 's' }) && !validDiagnosticsQuery({ agentId: '' }));
  const one = await query({ agentId: 'a1' });
  check('an agent id is handed to the probes', diagnostics.calls.at(-1) === 'a1' && one.items.length === 2);
  devices.setAdminScopes('tablet', ['diagnostics:read'], { mode: 'selected', repositoryIds: [], agentIds: ['a1'] });
  const filtered = await query();
  check('a device restricted to selected agents sees only their runtimes', filtered.items.length === 1 && filtered.items[0]!.agentId === 'a1');
  await refuses('a hidden agent cannot be probed by id', () => query({ agentId: 'a2' }), 'scope_not_granted');
  devices.setAdminScopes('tablet', ['diagnostics:read'], { mode: 'all' });
  diagnostics.result = { ...probe, items: [] };
  check('no agents yields an empty, well-formed report', (await query()).items.length === 0);
  diagnostics.result = probe;
  const audit = readFileSync(join(root, 'remote/audit.jsonl'), 'utf8');
  check('every run is audited under the desktop channel without leaking probe text', audit.includes('runtime:diagnose') && audit.includes('"executed"') && !audit.includes('Users'));

  const budget = new BrowserRequestBudget(() => 1_000);
  let allowed = 0; for (let i = 0; i < 20; i++) if (budget.permits('diagnosticsQuery', 'POST')) allowed++;
  check('browser sessions may start at most twelve diagnostics runs per minute', allowed === 12 && budget.permits('organizerQuery', 'POST'));

  const authorizer = new RemoteAuthorizer('t'.repeat(32), [], undefined, devices);
  server = new HostApiServer(app, { port: 0, authorizer, requireDeviceReads: true, audit: entry => devices.audit(entry) });
  const address = await server.start();
  const request = async (path: string, payload: unknown, key: string = randomUUID(), unsigned = false) => {
    const body = JSON.stringify(payload); const timestamp = String(Date.now());
    return fetch(`http://127.0.0.1:${address.port}${path}`, { method: 'POST', headers: { authorization: `Bearer ${'t'.repeat(32)}`, 'content-type': 'application/json',
      ...(unsigned ? {} : { 'x-ade-device': 'tablet', 'x-ade-timestamp': timestamp, 'idempotency-key': key, 'x-ade-signature': signRequest(secret, { method: 'POST', path, timestamp, idempotencyKey: key, bodySha256: sha256Hex(Buffer.from(body)) }) }) }, body });
  };
  const http = await request('/api/v1/diagnostics/query', {});
  const httpBody = await http.text();
  check('signed HTTP query reaches the diagnostics route', http.status === 200 && httpBody.includes('"agentId":"a1"') && !httpBody.includes('Users'));
  check('unsigned HTTP query cannot use bearer alone', (await request('/api/v1/diagnostics/query', {}, randomUUID(), true)).status === 401);
  check('GET is not allowed on the diagnostics route', (await fetch(`http://127.0.0.1:${address.port}/api/v1/diagnostics/query`, { headers: { authorization: `Bearer ${'t'.repeat(32)}` } })).status === 405);
  check('generic remote command allowlist stays unchanged', REMOTE_COMMAND_CHANNELS.join(',') === 'run:create,run:start,run:cancel,runTask:submit,run:answer');
  const stale = context(); devices.revoke('tablet');
  await refuses('revocation blocks an old signed principal', () => app.diagnostics(stale, {}), 'unknown_device');
  check('final positive control: the probe result itself was never mutated', probe.items[0]!.message.includes('C:\\Users'));
})().catch(error => { failed++; console.error(error); }).finally(async () => {
  await server?.stop();
  if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected temporary root');
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  console.log(`Remote diagnostics: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
});
