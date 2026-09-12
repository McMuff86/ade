import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { AdeApplicationService, RemoteApiError, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import { HostRestartController } from '../src/main/application/HostRestartController';
import { HostOperationGate } from '../src/main/application/HostOperationGate';
import { RemoteCommandLedger } from '../src/main/application/RemoteCommandLedger';
import { HostApiServer } from '../src/main/remote/HostApiServer';
import { BOOTSTRAP_PRINCIPAL, RemoteAuthorizer, sha256Hex, signRequest } from '../src/main/remote/authorization';
import { RemoteDeviceStore } from '../src/main/remote/RemoteDeviceStore';
import { createMobileFixture, fixtureProtection } from './helpers/mobileFixture';
import { assertIpcPayload } from '../src/main/ipcValidation';
import { CHANNEL_POLICY, REMOTE_COMMAND_CHANNELS, channelPolicyViolations } from '../src/main/ipcPolicy';
import type { MobileHostState, MobileRestartResult } from '../src/shared/remote';

let passed = 0; let failed = 0;
const check = (label: string, condition: boolean): void => { if (condition) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
async function refuses(label: string, action: () => unknown, code?: string): Promise<void> {
  try { await action(); check(label, false); } catch (error) { check(label, !code || error instanceof RemoteApiError && error.code === code); }
}
const root = mkdtempSync(join(tmpdir(), 'ade-admin-'));
let server: HostApiServer | undefined;
void (async () => {
  const fixture = createMobileFixture(root);
  const { devices } = fixture;
  const device = { id: 'admin-phone', secret: 'a'.repeat(40), scopes: ['read', 'runs:write'] as const };
  devices.importBootstrap([device]);
  check('existing device gains no administrative permission', devices.activeDevices()[0]!.scopes.join(',') === 'read,runs:write');
  await refuses('unknown device permissions are rejected', () => assertIpcPayload('remoteDevices:setAdminScopes', { deviceId: device.id, scopes: ['shell'] }));
  await refuses('duplicate device permissions are rejected', () => assertIpcPayload('remoteDevices:setAdminScopes', { deviceId: device.id, scopes: ['host:restart', 'host:restart'] }));
  await refuses('extra permission fields are rejected', () => assertIpcPayload('remoteDevices:setAdminScopes', { deviceId: device.id, scopes: [], command: 'whoami' }));
  check('permission grants remain desktop-only and existing remote IPC allowlist is unchanged', CHANNEL_POLICY['remoteDevices:setAdminScopes'].surface === 'desktop'
    && REMOTE_COMMAND_CHANNELS.join(',') === 'run:create,run:start,run:cancel,runTask:submit,run:answer' && channelPolicyViolations().length === 0);
  const gate = new HostOperationGate(); let blockers: string[] = []; let restarted = 0;
  const controller = new HostRestartController(gate, () => blockers, () => { restarted++; }, 'fixture-version', true);
  const file = join(root, 'remote', 'commands.json');
  const authorized = (id: string, scope: import('../src/shared/remoteDevices').RemoteAdminScope): boolean =>
    devices.activeDevices().some((item) => item.id === id && item.scopes.includes(scope));
  const ledger = new RemoteCommandLedger(file, (entry) => devices.audit(entry), authorized);
  const app = new AdeApplicationService(fixture.store, fixture.orchestration, { status: () => ({ active: 0, queued: 0, maxActive: 4 }) },
    { administration: { ledger, restart: controller }, activity: gate });
  const context = (key = 'restart-0001'): RemoteCommandContext => ({ principal: { id: device.id, kind: 'device', proof: 'device-signature',
    scopes: new Set(devices.activeDevices()[0]?.scopes ?? []) }, idempotencyKey: key, requestId: 'fixture-request' });
  const input = { instanceId: controller.instanceId };
  check('host status explains that the ordinary device lacks restart rights', !app.hostState(context().principal).canRestart);
  await refuses('ordinary signed device cannot restart', () => app.restartHost(context(), input), 'scope_not_granted');
  devices.setAdminScopes(device.id, ['host:restart']);
  check('desktop grant persists across device-store restart', new RemoteDeviceStore(join(root, 'remote'), fixtureProtection).activeDevices()[0]!.scopes.includes('host:restart'));
  check('authorized host status is bounded and contains no absolute path', app.hostState(context().principal).canRestart && !JSON.stringify(app.hostState(context().principal)).includes(root));
  await refuses('bearer principal cannot restart', () => app.restartHost({ ...context(), principal: BOOTSTRAP_PRINCIPAL }, input), 'device_proof_required');
  await refuses('restart requires a valid idempotency key', () => app.restartHost({ ...context(), idempotencyKey: undefined }, input), 'idempotency_key_required');
  await refuses('restart cannot accept executable or arbitrary parameters', () => app.restartHost(context(), { ...input, executable: 'powershell.exe' }), 'invalid_payload');
  blockers = ['A task is running'];
  await refuses('active work rejects restart for the intended reason', () => app.restartHost(context('busy-0001'), input), 'host_busy');
  check('refused restart leaves host admission open', !gate.pending()); blockers = [];
  let release!: () => void;
  const active = gate.use(() => new Promise<void>((done) => { release = done; }));
  await refuses('in-flight host action blocks restart', () => app.restartHost(context('busy-0002'), input), 'host_busy');
  release(); await active;
  await refuses('stale host instance is rejected', () => app.restartHost(context('stale-0001'), { instanceId: 'previous-instance' }), 'host_changed');
  const authorizer = new RemoteAuthorizer('t'.repeat(32), [], undefined, devices);
  server = new HostApiServer(app, { port: 0, authorizer, requireDeviceReads: true, audit: (entry) => devices.audit(entry) });
  const address = await server.start(); const origin = `http://127.0.0.1:${address.port}`;
  const request = async (path: string, method: string, body: string, key = '', corrupt = false) => {
    const signed = { method, path, timestamp: String(Date.now()), idempotencyKey: key, bodySha256: sha256Hex(body) };
    return fetch(origin + path, { method, ...(method === 'POST' ? { body } : {}), headers: {
      authorization: `Bearer ${'t'.repeat(32)}`, 'x-ade-device': device.id, 'x-ade-timestamp': signed.timestamp,
      'x-ade-signature': corrupt ? 'v1=' + '0'.repeat(64) : signRequest(device.secret, signed),
      ...(body ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}),
    } });
  };
  check('real HTTP host endpoint rejects unsigned bearer reads', (await fetch(origin + '/api/v1/host', { headers: { authorization: `Bearer ${'t'.repeat(32)}` } })).status === 401);
  const host = await request('/api/v1/host', 'GET', '');
  check('real signed host read exposes current instance and rights', host.status === 200 && ((await host.json()) as MobileHostState).instanceId === controller.instanceId);
  check('real HTTP rejects an invalid restart signature', (await request('/api/v1/host/restart', 'POST', JSON.stringify(input), 'http-0001', true)).status === 401);
  const response = await request('/api/v1/host/restart', 'POST', JSON.stringify(input), 'http-0001');
  const accepted = await response.json() as MobileRestartResult;
  check('positive HTTP restart records acceptance before scheduling', response.status === 200 && accepted.accepted && !accepted.replayed && restarted === 0 && gate.pending());
  const replay = await (await request('/api/v1/host/restart', 'POST', JSON.stringify(input), 'http-0001')).json() as MobileRestartResult;
  check('same request replays one restart receipt', replay.replayed && replay.operationId === accepted.operationId);
  await refuses('restart fence refuses new mutations', () => gate.use(() => undefined));
  check('receipt is durable and carries neither secret nor host path', readFileSync(file, 'utf8').includes(accepted.operationId)
    && !readFileSync(file, 'utf8').includes(device.secret) && !readFileSync(file, 'utf8').includes(root));
  await new Promise((done) => setTimeout(done, 1100));
  check('coalesced requests trigger exactly one relaunch', restarted === 1);
  controller.cancel(accepted.operationId);
  const newController = new HostRestartController(new HostOperationGate(), () => [], () => { restarted++; }, 'fixture-version', true);
  const recovered = new AdeApplicationService(fixture.store, fixture.orchestration, { status: () => ({ active: 0, queued: 0, maxActive: 4 }) },
    { administration: { ledger: new RemoteCommandLedger(file, (entry) => devices.audit(entry), authorized), restart: newController } });
  const durableReplay = await recovered.restartHost(context('http-0001'), input);
  check('host restart preserves receipt and never schedules a replay on the new instance', durableReplay.replayed && newController.instanceId !== durableReplay.instanceId && !newController.gate.pending());
  await refuses('reusing a key with a different instance is rejected', () => recovered.restartHost(context('http-0001'), { instanceId: newController.instanceId }), 'idempotency_key_reused');
  const cancelled = await recovered.restartHost(context('revoke-0001'), { instanceId: newController.instanceId });
  devices.setAdminScopes(device.id, []);
  await new Promise((done) => setTimeout(done, 1100));
  check('removing the desktop grant before relaunch cancels restart', restarted === 1 && !newController.gate.pending());
  check('revocation keeps device pairing but removes administrative scope', devices.activeDevices().length === 1 && !authorized(device.id, 'host:restart'));
  newController.cancel(cancelled.operationId);
  devices.setAdminScopes(device.id, ['host:restart']);
  const corruptFile = join(root, 'remote', 'corrupt-commands.json'); writeFileSync(corruptFile, '{bad');
  const broken = new RemoteCommandLedger(corruptFile, () => undefined, authorized);
  await refuses('corrupt ledger fails closed', () => broken.execute(context(), 'host:restart', 'host:restart', input, () => { restarted++; }), 'unavailable');
  check('corrupt evidence is preserved without side effects', readFileSync(corruptFile, 'utf8') === '{bad' && restarted === 1);
  const auditFailure = new RemoteCommandLedger(join(root, 'isolated-audit', 'commands.json'), () => { throw new Error('audit failure'); }, authorized);
  await refuses('audit failure precedes all side effects', () => auditFailure.execute(context(), 'host:restart', 'host:restart', input, () => { restarted++; }));
  check('failed admission never restarts', restarted === 1);
  const interruptedFile = join(root, 'interrupted.json');
  const interruptedState = JSON.parse(readFileSync(file, 'utf8')) as { version: number; entries: Array<Record<string, unknown>> };
  interruptedState.entries = interruptedState.entries.map((item) => ({ ...item, state: 'reserved' }));
  writeFileSync(interruptedFile, JSON.stringify(interruptedState));
  const interrupted = new RemoteCommandLedger(interruptedFile, () => undefined, authorized);
  await refuses('interrupted reservation never repeats a possible side effect', () => interrupted.execute(context('http-0001'), 'host:restart', 'host:restart', input,
    () => { restarted++; }), 'command_uncertain');
  unlinkSync(file);
  const missing = new RemoteCommandLedger(file, () => undefined, authorized);
  await refuses('missing ledger with existing administration audit fails closed', () => missing.execute(context('http-0001'), 'host:restart', 'host:restart', input,
    () => { restarted++; }), 'unavailable');
  check('interrupted and missing receipts cannot cause another relaunch', restarted === 1);
  const positive = new RemoteCommandLedger(join(root, 'final-positive', 'commands.json'), () => undefined, authorized);
  check('fresh positive ledger still executes after negative controls', (await positive.execute(context(), 'host:restart', 'host:restart', input, () => ({ accepted: true }))).value.accepted);
})().catch((error) => { failed++; console.error(error); }).finally(async () => {
  await server?.stop();
  if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('unexpected fixture root');
  rmSync(root, { recursive: true, force: true });
  console.log(`\nRemote administration: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
});
