import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { RemoteApiError, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import { DeviceResourceService } from '../src/main/application/DeviceResourceService';
import { RemoteDeviceStore } from '../src/main/remote/RemoteDeviceStore';
import { fixtureProtection } from './helpers/mobileFixture';
import { HostApiServer } from '../src/main/remote/HostApiServer';
import { RemoteAuthorizer, sha256Hex, signRequest } from '../src/main/remote/authorization';
import { assertIpcPayload } from '../src/main/ipcValidation';
import { REMOTE_ADMIN_SCOPES, isDeviceResourceAccess, type DeviceResourceAccess } from '../src/shared/remoteDevices';

let passed = 0;
const check = (label: string, ok: boolean): void => { if (!ok) throw new Error(label); passed++; console.log(`  ok  ${label}`); };
async function denies(label: string, action: () => unknown): Promise<void> {
  try { await action(); } catch (error) { check(label, error instanceof RemoteApiError && error.code === 'scope_not_granted'); return; }
  throw new Error(label);
}
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-resource-access-')));
let server: HostApiServer | undefined;
void (async () => {
  const f = createRemoteWorkspaceFixture(root); const { store, devices, application: app } = f;
  const device = { id: 'tablet', secret: 's'.repeat(40) }; devices.enroll(device.id, 'Tablet', device.secret);
  const context = (key = randomUUID()): RemoteCommandContext => ({ principal: { id: device.id, kind: 'device', proof: 'device-signature',
    scopes: new Set(devices.activeDevices()[0]!.scopes) }, idempotencyKey: key, requestId: 'resource-test' });
  const resources = new DeviceResourceService(store, (id) => devices.resourceAccess(id));
  const grant = (access: DeviceResourceAccess) => devices.setAdminScopes(device.id, [...REMOTE_ADMIN_SCOPES], access);
  check('legacy devices retain their existing whole-catalog grant', devices.resourceAccess(device.id).mode === 'all');
  check('selection validator accepts explicit empty and all selections', isDeviceResourceAccess({ mode: 'selected', repositoryIds: [], agentIds: [] }) && isDeviceResourceAccess({ mode: 'all' }));
  for (const invalid of [{ mode: 'all', repositoryIds: [] }, { mode: 'selected', repositoryIds: ['../escape'], agentIds: [] },
    { mode: 'selected', repositoryIds: [], agentIds: ['a', 'a'] }, { mode: 'selected', repositoryIds: [], agentIds: Array.from({ length: 501 }, (_, i) => `a${i}`) },
    { mode: 'selected', repositoryIds: [] }, { mode: 'selected', repositoryIds: [], agentIds: [], root }]) {
    check('malformed sharing policy is rejected', !isDeviceResourceAccess(invalid));
    let rejected = false; try { assertIpcPayload('remoteDevices:setAdminScopes', { deviceId: device.id, scopes: [], resourceAccess: invalid }); } catch { rejected = true; }
    check('desktop IPC rejects malformed sharing policy', rejected);
  }
  grant({ mode: 'all' });
  const create = async (name: string) => (await app.administer(context(), { operation: 'project-create', input: { name } })).created!.id;
  const first = await create('Shared project'); const second = await create('Private project');
  const directory = (await app.queryProjects(context(), { operation: 'directory' })).directory!;
  const firstEntry = directory.entries.find((entry) => entry.repositoryId === first)!;
  const secondEntry = directory.entries.find((entry) => entry.repositoryId === second)!;
  const openContext = context(); const openInput = { operation: 'open', entryId: firstEntry.id };
  const firstWorkspace = (await app.commandProject(openContext, openInput)).workspace;
  const secondWorkspace = (await app.commandProject(context(), { operation: 'open', entryId: secondEntry.id })).workspace;
  const run = (name: string, repositoryId: string, agentId = 'builder') => app.createRun(context(), {
    name, goal: 'Private task prompt must stay in main', repositoryId, participants: [{ agentId, role: 'orchestrator' }],
  });
  const visibleRun = await run('Shared run', first); const privateRun = await run('Private run', second);
  const privateAgentRun = await run('Private agent run', first, 'reviewer');
  const selection: DeviceResourceAccess = { mode: 'selected', repositoryIds: [first], agentIds: ['builder'] }; grant(selection);
  const stalePrincipal = context().principal;
  check('selected catalog excludes private agent and project names', app.catalog(stalePrincipal).agents.map((item) => item.id).join() === 'builder'
    && app.catalog(stalePrincipal).repositories.map((item) => item.id).join() === first);
  check('run inventory requires both shared project and every participating agent', app.runs(undefined, stalePrincipal).map((item) => item.id).join() === visibleRun.run.id);
  check('snapshot uses the same resource projection', app.snapshot(stalePrincipal).runs.map((item) => item.id).join() === visibleRun.run.id);
  const events = app.events(0, 100, stalePrincipal);
  check('journal excludes hidden run records and still advances cursor', events.events.every((event) => event.runId === visibleRun.run.id) && events.cursor === app.journalCursor());
  check('directory only returns the explicitly shared registered project', (await app.queryProjects(context(), { operation: 'directory' })).directory!.entries.map((item) => item.id).join() === firstEntry.id);
  check('granted workspace remains readable', (await app.queryProjects(context(), { operation: 'workspace', workspaceId: firstWorkspace.id })).workspace!.id === firstWorkspace.id);
  await denies('hidden workspace cannot be reached by remembered opaque ID', () => app.queryProjects(context(), { operation: 'workspace', workspaceId: secondWorkspace.id }));
  await denies('hidden entry cannot be opened directly', () => app.commandProject(context(), { operation: 'open', entryId: secondEntry.id }));
  await denies('hidden agent cannot be queried directly', () => app.queryProfile(context(), { agentId: 'reviewer' }));
  await denies('hidden project cannot submit a task', () => app.submitTask(context(), { agentId: 'builder', repositoryId: second, prompt: 'Private' }));
  await denies('hidden agent cannot submit a task', () => app.submitTask(context(), { agentId: 'reviewer', repositoryId: first, prompt: 'Private' }));
  await denies('hidden run cannot be cancelled', () => app.cancelRun(context(), privateRun.run.id));
  await denies('run with hidden participant cannot be inspected', () => app.inspectRun(stalePrincipal, privateAgentRun.run.id));
  await denies('catalog selection cannot create an implicitly shared project', () => create('Unapproved'));
  await denies('cross-agent synchronization cannot expose unshared workspaces', () => app.queryGit(context(), { operation: 'git-overview', repositoryId: first }));
  const projectPath = store.get().repositories.find((item) => item.id === first)!.rootPath;
  const git = (args: string[]) => execFileSync('git', ['-C', projectPath, ...args], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
  git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@localhost']); git(['config', 'commit.gpgSign', 'false']);
  const hooks = join(root, 'hooks'); mkdirSync(hooks); git(['config', 'core.hooksPath', hooks]);
  writeFileSync(join(projectPath, 'chosen.txt'), 'Chosen change\n'); writeFileSync(join(projectPath, 'keep.txt'), 'Not selected\n');
  const preview = (await app.queryProjects(context(), { operation: 'git-preview', workspaceId: firstWorkspace.id,
    action: { kind: 'commit', paths: ['chosen.txt'], message: 'Selected tablet change' } })).gitPreview!;
  const head = git(['rev-parse', 'HEAD']);
  let revoked = 0; const stop = devices.onRevoked(() => { revoked++; });
  grant({ mode: 'selected', repositoryIds: [], agentIds: [] });
  check('sharing change immediately invalidates existing connections', revoked === 1); stop();
  await denies('old principal cannot read after resource grant is removed', () => app.queryProjects({ ...context(), principal: stalePrincipal }, { operation: 'workspace', workspaceId: firstWorkspace.id }));
  await denies('cached open receipt cannot expose removed workspace', () => app.commandProject(openContext, openInput));
  await denies('old Git preview cannot commit after resource grant is removed', () => app.commandProject(context(), { operation: 'git-apply', previewId: preview.id }));
  check('rejected commit leaves exact HEAD and files unchanged', git(['rev-parse', 'HEAD']) === head && readFileSync(join(projectPath, 'chosen.txt'), 'utf8') === 'Chosen change\n');
  check('empty selection exposes no projects, agents, runs or journal records', !app.catalog(stalePrincipal).agents.length && !app.runs(undefined, stalePrincipal).length
    && !app.events(0, 100, stalePrincipal).events.length && !(await app.queryProjects(context(), { operation: 'directory' })).directory!.entries.length);
  grant(selection);
  const restored = new RemoteDeviceStore(join(root, 'remote'), fixtureProtection);
  check('selection survives vault reload without changing credentials', JSON.stringify(restored.resourceAccess(device.id)) === JSON.stringify(selection) && restored.activeDevices()[0]!.secret === device.secret);
  const defensive = devices.resourceAccess(device.id); if (defensive.mode === 'selected') defensive.repositoryIds.length = 0;
  check('caller cannot mutate grants through a returned reference', resources.repository(stalePrincipal, first));
  const oldDirectory = f.projects.directory.bind(f.projects);
  f.projects.directory = async () => { const result = await oldDirectory(); grant({ mode: 'selected', repositoryIds: [], agentIds: [] }); return result; };
  check('revocation during discovery suppresses previously discovered names', !(await app.queryProjects(context(), { operation: 'directory' })).directory!.entries.length);
  f.projects.directory = oldDirectory; grant(selection);
  const applied = await app.commandProject(context(), { operation: 'git-apply', previewId: preview.id });
  check('restored grant executes still-current preview and commits only selected file', applied.git!.workspace.id === firstWorkspace.id
    && git(['show', '--format=', '--name-only', 'HEAD']) === 'chosen.txt' && git(['status', '--porcelain']).includes('keep.txt'));
  server = new HostApiServer(app, { port: 0, requireDeviceReads: true, authorizer: new RemoteAuthorizer('b'.repeat(40), [], undefined, devices) });
  const origin = `http://127.0.0.1:${(await server.start()).port}`;
  const get = (path: string) => { const signed = { method: 'GET', path, timestamp: String(Date.now()), idempotencyKey: '', bodySha256: sha256Hex('') };
    return fetch(origin + path, { headers: { accept: 'text/event-stream', authorization: `Bearer ${'b'.repeat(40)}`, 'x-ade-device': device.id,
      'x-ade-signature': signRequest(device.secret, signed), 'x-ade-timestamp': signed.timestamp } }); };
  const catalog = await (await get('/api/v1/catalog')).text(); const runs = await (await get('/api/v1/runs')).text();
  check('signed HTTP catalogue projects the authenticated device', catalog.includes('Shared project') && !catalog.includes('Private project') && !catalog.includes('Reviewer'));
  check('signed HTTP run list hides names of inaccessible runs', runs.includes('Shared run') && !runs.includes('Private run') && !runs.includes('Private agent run'));
  const stream = await get('/api/v1/events'); const reader = stream.body!.getReader(); let snapshot = '';
  try { for (let i = 0; i < 10 && !snapshot.includes('event: snapshot'); i++) snapshot += new TextDecoder().decode((await reader.read()).value); }
  finally { await reader.cancel(); }
  check('SSE initial snapshot follows the same device selection', snapshot.includes('Shared run') && !snapshot.includes('Private run') && !snapshot.includes('Private agent run'));
  grant({ mode: 'all' });
  check('final positive control restores all original projects and agents', app.catalog(stalePrincipal).agents.length === 3 && app.catalog(stalePrincipal).repositories.length === 2
    && app.runs(undefined, stalePrincipal).length === 3 && devices.activeDevices()[0]!.secret === device.secret);
  console.log(`Device resources: ${passed} passed, 0 failed`);
})().catch((error) => { console.error(error); console.log(`Device resources: ${passed} passed, 1 failed`); process.exitCode = 1; })
  .finally(async () => { await server?.stop(); if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected fixture root'); rmSync(root, { recursive: true, force: true }); });
