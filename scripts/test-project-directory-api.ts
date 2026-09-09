import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { AdeApplicationService, RemoteApiError, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import { RemoteCommandLedger } from '../src/main/application/RemoteCommandLedger';
import { HostRestartController } from '../src/main/application/HostRestartController';
import { HostApiServer } from '../src/main/remote/HostApiServer';
import { BOOTSTRAP_PRINCIPAL, RemoteAuthorizer, sha256Hex, signRequest } from '../src/main/remote/authorization';
import { ProjectWorkspaceService } from '../src/main/repositories/ProjectWorkspaceService';
import { ProjectDefaultsService } from '../src/main/settings/ProjectDefaultsService';
import { assertIpcPayload } from '../src/main/ipcValidation';
import { CHANNEL_POLICY, REMOTE_COMMAND_CHANNELS } from '../src/main/ipcPolicy';
import type { ProjectWorkspaceCommandResult, ProjectWorkspaceQueryResult } from '../src/shared/remote';

let passed = 0; const check = (label: string, ok: boolean): void => { if (!ok) throw new Error(label); passed++; console.log(`  ok  ${label}`); };
async function refuses(label: string, action: () => unknown, code?: string): Promise<void> {
  try { await action(); } catch (error) { check(label, !code || error instanceof RemoteApiError && error.code === code); return; } throw new Error(label);
}
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-project-api-')));
let server: HostApiServer | undefined;
void (async () => {
  const fixture = createRemoteWorkspaceFixture(root); const { application, store, devices } = fixture;
  const parent = join(root, 'projects'); const repo = join(parent, 'Unregistered project'); mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '--initial-branch=main', repo], { windowsHide: true, timeout: 10000 });
  new ProjectDefaultsService(store).save({ rootPath: parent, agentId: null });
  const device = { id: 'project-tablet', secret: 's'.repeat(40), scopes: ['read', 'runs:write'] as const };
  devices.importBootstrap([device]);
  const context = (key = 'project-open-0001'): RemoteCommandContext => ({ principal: { id: device.id, kind: 'device', proof: 'device-signature',
    scopes: new Set(devices.activeDevices()[0]?.scopes ?? []) }, idempotencyKey: key, requestId: 'project-fixture' });
  check('new project channels remain desktop IPC and generic remote commands stay unchanged', CHANNEL_POLICY['project:query'].surface === 'desktop'
    && CHANNEL_POLICY['project:command'].surface === 'desktop' && REMOTE_COMMAND_CHANNELS.join(',') === 'run:create,run:start,run:cancel,runTask:submit');
  await refuses('project query rejects arbitrary paths', () => assertIpcPayload('project:query', { operation: 'directory', path: repo }));
  await refuses('project open rejects arbitrary command data', () => assertIpcPayload('project:command', { operation: 'open', entryId: 'p' + 'a'.repeat(32), command: 'whoami' }));
  await refuses('project query rejects malformed workspace UUID', () => assertIpcPayload('project:query', { operation: 'workspace', workspaceId: '-'.repeat(36) }));
  await refuses('existing signed device cannot discover host folders', () => application.queryProjects(context(), { operation: 'directory' }), 'scope_not_granted');
  devices.setAdminScopes(device.id, ['workspace:read']);
  const directory = (await application.queryProjects(context(), { operation: 'directory' })).directory!;
  const entry = directory.entries.find((item) => item.name === 'Unregistered project')!;
  check('read grant discovers unregistered repo without mutating the catalog', !!entry && !entry.repositoryId && !store.get().repositories.length && !store.get().projectWorkspaces.length);
  const input = { operation: 'open', entryId: entry.id };
  await refuses('read grant alone cannot register a workspace', () => application.commandProject(context(), input), 'scope_not_granted');
  devices.setAdminScopes(device.id, ['workspace:read', 'catalog:write', 'repositories:write']);
  await refuses('older catalog and repository grants do not implicitly grant independent project opens', () => application.commandProject(context(), input), 'scope_not_granted');
  devices.setAdminScopes(device.id, ['workspace:read', 'projects:write']);
  await refuses('bearer principal cannot query project folders', () => application.queryProjects({ ...context(), principal: BOOTSTRAP_PRINCIPAL }, { operation: 'directory' }), 'device_proof_required');
  await refuses('project mutation requires durable key', () => application.commandProject({ ...context(), idempotencyKey: undefined }, input), 'idempotency_key_required');
  await refuses('project mutation rejects payload additions', () => application.commandProject(context(), { ...input, agentId: 'builder' }), 'invalid_payload');
  server = new HostApiServer(application, { port: 0, requireDeviceReads: true, authorizer: new RemoteAuthorizer('t'.repeat(32), [], undefined, devices), audit: (event) => devices.audit(event) });
  const origin = `http://127.0.0.1:${(await server.start()).port}`;
  const request = (path: string, payload: unknown, key = '', bad = false) => {
    const body = JSON.stringify(payload); const signed = { method: 'POST', path, timestamp: String(Date.now()), idempotencyKey: key, bodySha256: sha256Hex(body) };
    return fetch(origin + path, { method: 'POST', body, headers: { authorization: `Bearer ${'t'.repeat(32)}`, 'content-type': 'application/json',
      'x-ade-device': device.id, 'x-ade-timestamp': signed.timestamp, 'x-ade-signature': bad ? 'v1=' + '0'.repeat(64) : signRequest(device.secret, signed),
      ...(key ? { 'idempotency-key': key } : {}) } });
  };
  check('HTTP project endpoint rejects invalid device signature', (await request('/api/v1/projects/command', input, 'http-open-0001', true)).status === 401);
  check('HTTP project query returns bounded path-free directory', (await (await request('/api/v1/projects/query', { operation: 'directory' })).json() as ProjectWorkspaceQueryResult).directory?.entries[0]?.id === entry.id);
  const beforeAgents = JSON.stringify(store.get().agents); const beforeBindings = JSON.stringify(store.get().workspaceBindings);
  const [first, duplicate] = await Promise.all([request('/api/v1/projects/command', input, 'http-open-0001'), request('/api/v1/projects/command', input, 'http-open-0001')]);
  const opened = await first.json() as ProjectWorkspaceCommandResult; const replay = await duplicate.json() as ProjectWorkspaceCommandResult;
  check('concurrent signed commands create one workspace with one replay receipt', first.status === 200 && duplicate.status === 200
    && opened.workspace.id === replay.workspace.id && opened.replayed !== replay.replayed && store.get().projectWorkspaces.length === 1);
  check('open registers exact checkout and no agent or agent binding', store.get().projectWorkspaces[0]?.workspaceDir === repo
    && JSON.stringify(store.get().agents) === beforeAgents && JSON.stringify(store.get().workspaceBindings) === beforeBindings && opened.workspace.branch === 'main');
  const detail = await (await request('/api/v1/projects/query', { operation: 'workspace', workspaceId: opened.workspace.id })).json() as ProjectWorkspaceQueryResult;
  check('workspace query uses opaque identity and returns actual branch', detail.workspace?.id === opened.workspace.id && detail.workspace?.kind === 'checkout');
  const receiptFile = join(root, 'remote', 'commands.json'); const receiptText = readFileSync(receiptFile, 'utf8');
  check('responses and receipt contain no absolute paths, device secret or profile content', !JSON.stringify([directory, opened, detail]).includes(root.replace(/\\/g, '\\\\'))
    && !receiptText.includes(root.replace(/\\/g, '\\\\')) && !receiptText.includes(device.secret));
  await refuses('reusing command key for another target is rejected', () => application.commandProject(context('http-open-0001'), { operation: 'open', entryId: 'p' + 'a'.repeat(32) }), 'idempotency_key_reused');
  devices.setAdminScopes(device.id, ['workspace:read']);
  await refuses('revoked write grant cannot replay previous success', () => application.commandProject(context('http-open-0001'), input), 'scope_not_granted');
  devices.setAdminScopes(device.id, ['projects:write']);
  await refuses('write grant without read does not expose workspace result', () => application.commandProject(context('http-open-0001'), input), 'scope_not_granted');
  devices.setAdminScopes(device.id, ['workspace:read', 'projects:write']);
  const authorized = (id: string, scope: import('../src/shared/remoteDevices').RemoteAdminScope) => devices.activeDevices().some((item) => item.id === id && item.scopes.includes(scope));
  const restarted = new RemoteCommandLedger(receiptFile, (event) => devices.audit(event), authorized);
  const durable = await restarted.execute(context('http-open-0001'), 'project:open', 'projects:write', input, () => { throw new Error('Must not rerun'); });
  check('receipt survives process/service restart and never reruns open', durable.replayed);
  const projects = new ProjectWorkspaceService(store); const original = projects.directory.bind(projects);
  projects.directory = async () => { const value = await original(); devices.setAdminScopes(device.id, ['projects:write']); return value; };
  const guarded = new AdeApplicationService(store, fixture.orchestration, { status: () => ({ active: 0, queued: 0, maxActive: 4 }) }, {
    projects, administration: { ledger: restarted, restart: new HostRestartController(fixture.gate, () => [], () => undefined, 'fixture', true) },
  });
  await refuses('read revoked during asynchronous discovery suppresses result', () => guarded.queryProjects(context(), { operation: 'directory' }), 'scope_not_granted');
  devices.setAdminScopes(device.id, ['workspace:read', 'projects:write']);
  let authorizationChecks = 0; const previous = JSON.stringify(store.get().projectWorkspaces);
  await refuses('service rechecks authorization after asynchronous Git validation', () => projects.open(entry.id, () => {
    if (++authorizationChecks > 1) throw new Error('revoked');
  }));
  check('revoked open never adds a workspace', authorizationChecks === 2 && JSON.stringify(store.get().projectWorkspaces) === previous);
  unlinkSync(receiptFile);
  const missing = new RemoteCommandLedger(receiptFile, () => undefined, authorized);
  await refuses('missing ledger with project audit history refuses possible duplicate mutations', () => missing.execute(context('http-open-0001'), 'project:open', 'projects:write', input, () => true), 'unavailable');
  const positive = new RemoteCommandLedger(join(root, 'positive', 'commands.json'), () => undefined, authorized);
  check('final positive control opens same exact workspace after authorization restored', (await positive.execute(context(), 'project:open', 'projects:write', input, () => projects.open(entry.id))).value.id === opened.workspace.id);
  console.log(`Project directory API: ${passed} passed, 0 failed`);
})().catch((error) => { console.error(error); console.log(`Project directory API: ${passed} passed, 1 failed`); process.exitCode = 1; })
  .finally(async () => { await server?.stop(); if (dirname(root) !== realpathSync.native(resolve(tmpdir()))) throw new Error('Unexpected fixture directory'); rmSync(root, { recursive: true, force: true }); });
