import { execFileSync } from 'node:child_process';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { RemoteApiError, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import { HostApiServer } from '../src/main/remote/HostApiServer';
import { RemoteAuthorizer, signRequest, sha256Hex } from '../src/main/remote/authorization';

let passed = 0; let failed = 0;
const check = (name: string, ok: boolean): void => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } };
async function refuses(name: string, operation: () => unknown, code: string): Promise<void> {
  try { await operation(); check(name, false); } catch (error) { check(name, error instanceof RemoteApiError && error.code === code); }
}
const root = mkdtempSync(join(tmpdir(), 'ade-workbench-')); let server: HostApiServer | undefined;
void (async () => {
  const fixture = createRemoteWorkspaceFixture(root); const { application: app, store, devices } = fixture;
  devices.enroll('tablet', 'Tablet', 'd'.repeat(40));
  devices.setAdminScopes('tablet', ['catalog:write']);
  const context = (): RemoteCommandContext => ({ principal: { id: 'tablet', kind: 'device', proof: 'device-signature',
    scopes: new Set(devices.activeDevices().find((device) => device.id === 'tablet')!.scopes) }, idempotencyKey: randomUUID(), requestId: 'workbench-test' });
  const created = await app.administer(context(), { operation: 'project-create', input: { name: 'Workbench' } });
  const selection = { agentId: 'builder', repositoryId: created.created!.id };
  const query = (operation: Record<string, unknown>, ctx = context()) => app.queryWorkspace(ctx, { ...selection, ...operation });
  await refuses('existing catalog grant cannot read source', () => query({ operation: 'overview' }), 'scope_not_granted');
  devices.setAdminScopes('tablet', ['catalog:write', 'workspace:read']);
  const before = store.get().workspaceBindings.length;
  check('missing workspace is an explicit empty state without provisioning', !(await query({ operation: 'overview' })).overview!.ready && store.get().workspaceBindings.length === before);
  await app.administer(context(), { operation: 'workspace-prepare', input: selection });
  const binding = store.get().workspaceBindings.find((item) => item.agentId === selection.agentId && item.repositoryId === selection.repositoryId)!;
  const cwd = binding.workspaceDir; const git = (...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { windowsHide: true, encoding: 'utf8' });
  writeFileSync(join(cwd, 'tracked.txt'), 'original\n');
  git('add', '--', 'tracked.txt'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Tracked fixture');
  writeFileSync(join(cwd, 'tracked.txt'), 'staged change\n'); git('add', '--', 'tracked.txt'); writeFileSync(join(cwd, 'tracked.txt'), 'working change\n');
  mkdirSync(join(cwd, 'notes')); writeFileSync(join(cwd, 'notes', 'readme.md'), '# Workspace\r\nHello\r\n');
  writeFileSync(join(cwd, '.env'), 'PASSWORD=must-not-read');
  writeFileSync(join(cwd, 'sanitized.txt'), 'path C:\\private\\source\napi_key=private-value\n');
  writeFileSync(join(cwd, 'large.txt'), 'L'.repeat(25 * 1024)); writeFileSync(join(cwd, 'binary.dat'), Buffer.from([0, 1, 2]));
  const overview = (await query({ operation: 'overview' })).overview!;
  check('workspace opens without any terminal', overview.ready && !overview.busy && fixture.sessions.length === 0);
  check('overview reports both index and worktree changes', overview.changes.some((item) => item.path === 'tracked.txt' && item.staged && item.unstaged));
  check('overview contains real branch and recent commit', overview.branch === binding.branch && overview.commits[0]?.subject === 'Tracked fixture');
  const tree = await query({ operation: 'tree', path: '' });
  check('tree shows safe files and folders without metadata or secrets', tree.entries!.some((item) => item.path === 'notes' && item.kind === 'directory')
    && !tree.entries!.some((item) => ['.env', '.git'].includes(item.path)));
  check('nested filename search finds a real file', (await query({ operation: 'search', search: 'readme' })).entries!.some((item) => item.path === 'notes/readme.md'));
  const file = (await query({ operation: 'file', path: 'notes/readme.md' })).file!;
  check('file read preserves newlines and returns an opaque revision', file.text === '# Workspace\r\nHello\r\n' && file.editable && /^[a-f0-9]{64}$/.test(file.revision));
  check('staged diff reflects the actual index', (await query({ operation: 'diff', path: 'tracked.txt', staged: true })).diff!.includes('+staged change'));
  check('unstaged diff reflects actual working changes', (await query({ operation: 'diff', path: 'tracked.txt', staged: false })).diff!.includes('+working change'));
  check('untracked file has a readable addition preview', (await query({ operation: 'diff', path: 'notes/readme.md', staged: false })).diff!.includes('+# Workspace'));
  const safe = (await query({ operation: 'file', path: 'sanitized.txt' })).file!;
  check('redacted file is not editable and reveals neither path nor key', !safe.editable && !safe.text.includes('private') && !!safe.notice);
  check('large file is bounded and explicitly read-only', !(await query({ operation: 'file', path: 'large.txt' })).file!.editable);
  const growing = join(cwd, 'growing.txt'); writeFileSync(growing, 'small');
  const originalStat = fs.fstatSync; let grew = false;
  try {
    fs.fstatSync = ((fd: number) => {
      const stat = originalStat(fd);
      if (!grew && stat.size === 5) { grew = true; writeFileSync(growing, 'G'.repeat(32 * 1024)); }
      return stat;
    }) as typeof fs.fstatSync;
    const result = fixture.workbench.read(binding, 'growing.txt');
    check('file growth during read remains bounded and explicitly oversized', grew && !result.editable && result.text === '' && result.notice!.includes('24 KiB'));
  } finally { fs.fstatSync = originalStat; }
  check('binary content is not serialized', (await query({ operation: 'file', path: 'binary.dat' })).file!.text === '');
  for (const path of ['../outside.txt', '/outside', 'C:\\outside', '.git/config', '.env', 'notes/../tracked.txt', 'notes/file:stream', 'notes/CON']) {
    await refuses(`reject unsafe path ${path}`, () => query({ operation: 'file', path }), 'command_rejected');
  }
  await refuses('reject injected host fields', () => query({ operation: 'file', path: 'tracked.txt', workspaceDir: cwd }), 'invalid_payload');
  await refuses('reject unknown operation', () => query({ operation: 'shell' }), 'invalid_payload');
  mkdirSync(join(root, 'outside')); writeFileSync(join(root, 'outside', 'private.txt'), 'outside');
  symlinkSync(join(root, 'outside'), join(cwd, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await refuses('junction cannot expose outside files', () => query({ operation: 'file', path: 'linked/private.txt' }), 'command_rejected');
  linkSync(join(root, 'outside', 'private.txt'), join(cwd, 'hardlink.txt'));
  await refuses('hardlink cannot expose outside files', () => query({ operation: 'file', path: 'hardlink.txt' }), 'command_rejected');
  const stale = context(); devices.setAdminScopes('tablet', ['catalog:write']);
  await refuses('revocation invalidates a previously resolved principal', () => query({ operation: 'overview' }, stale), 'scope_not_granted');
  devices.setAdminScopes('tablet', ['catalog:write', 'workspace:read']);
  server = new HostApiServer(app, { port: 0, requireDeviceReads: true, authorizer: new RemoteAuthorizer('t'.repeat(32), [], undefined, devices) });
  const address = await server.start(); const url = `http://127.0.0.1:${address.port}/api/v1/workspace/query`;
  const body = JSON.stringify({ ...selection, operation: 'overview' }); const timestamp = String(Date.now());
  const headers = { authorization: `Bearer ${'t'.repeat(32)}`, 'content-type': 'application/json', 'x-ade-device': 'tablet', 'x-ade-timestamp': timestamp,
    'x-ade-signature': signRequest('d'.repeat(40), { method: 'POST', path: '/api/v1/workspace/query', timestamp, idempotencyKey: '', bodySha256: sha256Hex(body) }) };
  check('unsigned HTTP source read is refused', (await fetch(url, { method: 'POST', headers: { authorization: headers.authorization, 'content-type': 'application/json' }, body })).status === 401);
  const response = await fetch(url, { method: 'POST', headers, body }); const wire = await response.text();
  check('signed HTTP source read succeeds without absolute host paths', response.status === 200 && wire.includes('Tracked fixture') && !wire.includes('C:\\') && !wire.includes(root));
  const saveInput = { ...selection, path: 'notes/readme.md', workspaceVersion: tree.workspaceVersion, revision: file.revision, text: '# Edited\nHello\n' };
  await refuses('read grant alone cannot save a file', () => app.saveWorkspaceFile(context(), saveInput), 'scope_not_granted');
  devices.setAdminScopes('tablet', ['catalog:write', 'workspace:read', 'workspace:write']);
  const saveContext = context(); const saved = await app.saveWorkspaceFile(saveContext, saveInput);
  check('explicit save changes the real file and preserves CRLF', saved.saved && readFileSync(join(cwd, 'notes/readme.md'), 'utf8') === '# Edited\r\nHello\r\n');
  writeFileSync(join(cwd, 'notes/readme.md'), '# External\r\nHello\r\n');
  const replay = await app.saveWorkspaceFile(saveContext, saveInput);
  check('save receipt replay never overwrites a later external edit', replay.replayed && readFileSync(join(cwd, 'notes/readme.md'), 'utf8').startsWith('# External'));
  const conflict = await app.saveWorkspaceFile(context(), { ...saveInput, text: 'stale' });
  check('stale revision reports a conflict without modifying the file', !conflict.saved && readFileSync(join(cwd, 'notes/readme.md'), 'utf8').startsWith('# External'));
  await refuses('save refuses a replaced workspace identity', () => app.saveWorkspaceFile(context(), { ...saveInput, workspaceVersion: 'f'.repeat(64) }), 'command_rejected');
  const fresh = (await query({ operation: 'file', path: 'notes/readme.md' })).file!;
  fixture.sessions.push({ id: 'busy', agentId: selection.agentId, repositoryId: selection.repositoryId, workspaceBindingId: binding.id,
    workspaceDir: cwd, executionBackend: 'native', title: 'Busy', kind: 'task', status: 'running', createdAt: Date.now(), runTaskId: 'task' });
  await refuses('active task blocks saving into its workspace', () => app.saveWorkspaceFile(context(), { ...saveInput, revision: fresh.revision }), 'command_rejected');
  fixture.sessions[0]!.kind = 'interactive'; fixture.sessions[0]!.runTaskId = undefined;
  await refuses('interactive session also blocks conflicting file writes', () => app.saveWorkspaceFile(context(), { ...saveInput, revision: fresh.revision }), 'command_rejected');
  fixture.sessions[0]!.status = 'exited';
  await refuses('save refuses secret metadata paths', () => app.saveWorkspaceFile(context(), { ...saveInput, path: '.env' }), 'command_rejected');
  await refuses('save refuses junction targets', () => app.saveWorkspaceFile(context(), { ...saveInput, path: 'linked/private.txt' }), 'command_rejected');
  await refuses('save refuses oversized bodies', () => app.saveWorkspaceFile(context(), { ...saveInput, text: 'X'.repeat(25 * 1024) }), 'invalid_payload');
  await refuses('redacted source cannot be overwritten remotely', () => app.saveWorkspaceFile(context(), { ...saveInput, path: 'sanitized.txt', revision: safe.revision }), 'command_rejected');
  writeFileSync(join(cwd, 'bom.txt'), '\uFEFFhello\r\n'); const bom = (await query({ operation: 'file', path: 'bom.txt' })).file!;
  const bomSave = await app.saveWorkspaceFile(context(), { ...saveInput, path: 'bom.txt', revision: bom.revision, text: 'updated\n' });
  check('UTF-8 BOM is retained on save', bomSave.saved && readFileSync(join(cwd, 'bom.txt'), 'utf8') === '\uFEFFupdated\r\n');
  writeFileSync(join(cwd, 'mixed.txt'), 'one\r\ntwo\n');
  check('mixed newlines are explicit read-only', !(await query({ operation: 'file', path: 'mixed.txt' })).file!.editable);
  check('atomic save leaves no scratch files behind', !readdirSync(join(cwd, 'notes')).some((name) => name.startsWith('.ade-edit-')));
  const changed = store.get().workspaceBindings.map((item) => item.id === binding.id ? { ...item, workspaceDir: join(root, 'outside') } : item);
  store.save({ workspaceBindings: changed });
  await refuses('replaced workspace cannot impersonate repository identity', () => query({ operation: 'overview' }), 'command_rejected');
  store.save({ workspaceBindings: store.get().workspaceBindings.map((item) => item.id === binding.id ? binding : item) });
  check('final positive control still reads the original workspace', (await query({ operation: 'file', path: 'notes/readme.md' })).file!.text.includes('Hello'));
})().catch((error) => { failed++; console.error(error); }).finally(async () => {
  await server?.stop(); rmSync(root, { recursive: true, force: true }); console.log(`Remote workbench: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
});
