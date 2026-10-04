/** Registered projects whose folder was deleted on the PC: hidden, never auto-deleted, removable only on explicit, re-checked request. */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { RemoteApiError, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import { HostApiServer } from '../src/main/remote/HostApiServer';
import { RemoteAuthorizer, sha256Hex, signRequest } from '../src/main/remote/authorization';
import { ProjectDefaultsService } from '../src/main/settings/ProjectDefaultsService';
import { assertIpcPayload } from '../src/main/ipcValidation';
import { CHANNEL_POLICY, REMOTE_COMMAND_CHANNELS } from '../src/main/ipcPolicy';
import { validateCompleteConfig } from '../src/main/config/store';
import type { ProjectRemoveMissingResult, ProjectWorkspaceQueryResult } from '../src/shared/remote';
import type { SessionBookend } from '../src/shared/types';

let passed = 0; let failed = 0;
const check = (label: string, ok: boolean): void => { if (ok) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
async function refuses(label: string, action: () => unknown, expect?: string | RegExp): Promise<void> {
  try { await action(); } catch (error) {
    const ok = !expect || (typeof expect === 'string' ? error instanceof RemoteApiError && error.code === expect : expect.test(String((error as Error).message)));
    check(label, ok); if (!ok) console.error(error); return;
  }
  check(label, false);
}
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-missing-projects-')));
let server: HostApiServer | undefined;
void (async () => {
  const fixture = createRemoteWorkspaceFixture(root); const { application, store, devices, projects, sessions } = fixture;
  const parent = join(root, 'projects'); mkdirSync(parent);
  const init = (name: string) => { const path = join(parent, name); mkdirSync(path); execFileSync('git', ['init', '-q', '--initial-branch=main', path], { windowsHide: true, timeout: 10000 }); return path; };
  const keep = init('Keep'); const gone = init('Gone');
  new ProjectDefaultsService(store).save({ rootPath: parent, agentId: null });
  for (const name of ['Keep', 'Gone']) await projects.open((await projects.directory()).entries.find((item) => item.name === name)!.id);
  const goneId = store.get().repositories.find((item) => item.name === 'Gone')!.id;
  const keepId = store.get().repositories.find((item) => item.name === 'Keep')!.id;
  const bookend: SessionBookend = { id: 'bookend-gone', projectWorkspaceId: store.get().projectWorkspaces.find((item) => item.repositoryId === goneId)!.id,
    agentName: 'Shell', runtime: 'codex', repositoryId: goneId, repositoryName: 'Gone', startedAt: 1, endedAt: 2, exitReason: 'exit' };
  store.save({ sessionBookends: [bookend] });
  let validBefore = true; try { validateCompleteConfig(structuredClone(store.get())); } catch { validBefore = false; }

  const listed = (await projects.directory());
  check('both registered projects are listed while their folders exist', listed.entries.some((item) => item.repositoryId === goneId) && !listed.missing?.length);

  renameSync(gone, gone + '.moved');
  let view = await projects.directory();
  check('a deleted or moved folder is hidden from the list', !view.entries.some((item) => item.repositoryId === goneId) && view.entries.some((item) => item.repositoryId === keepId));
  check('the hidden project is reported once by name with removal allowed', view.missing?.length === 1 && view.missing[0]!.repositoryId === goneId
    && view.missing[0]!.name === 'Gone' && view.missing[0]!.removal === 'allowed');
  check('hiding never deregisters anything', store.get().repositories.some((item) => item.id === goneId) && store.get().projectWorkspaces.some((item) => item.repositoryId === goneId));
  check('the missing list carries no host path', !JSON.stringify(view).includes(root));
  renameSync(gone + '.moved', gone);
  view = await projects.directory();
  check('a returning folder makes the same project visible again', view.entries.some((item) => item.repositoryId === goneId && item.kind === 'repository') && !view.missing?.length);

  if (process.platform !== 'win32') {
    rmSync(gone, { recursive: true }); symlinkSync(keep, gone);
    view = await projects.directory();
    check('a link in place of the folder stays visible with its notice, never hidden', view.entries.some((item) => item.repositoryId === goneId && item.kind === 'unavailable' && !!item.notice)
      && !view.missing?.length);
    rmSync(gone); init('Gone');
    if (process.getuid?.() !== 0) {
      chmodSync(parent, 0o000);
      try {
        view = await projects.directory();
        check('a permission error keeps registered projects visible as unavailable', view.entries.some((item) => item.repositoryId === keepId && item.kind === 'unavailable') && !view.missing?.length);
      } finally { chmodSync(parent, 0o755); }
    }
  }
  rmSync(gone, { recursive: true, force: true });

  const device = { id: 'missing-tablet', secret: 's'.repeat(40), scopes: ['read', 'runs:write'] as const };
  devices.importBootstrap([device]);
  const context = (key = 'remove-missing-0001'): RemoteCommandContext => ({ principal: { id: device.id, kind: 'device', proof: 'device-signature',
    scopes: new Set(devices.activeDevices()[0]?.scopes ?? []) }, idempotencyKey: key, requestId: 'missing-fixture' });
  const input = { repositoryId: goneId };
  check('desktop removal channel is a desktop-only audited mutation; remote command channels are unchanged',
    CHANNEL_POLICY['project:removeMissing'].surface === 'desktop' && CHANNEL_POLICY['project:removeMissing'].audit
    && REMOTE_COMMAND_CHANNELS.join(',') === 'run:create,run:start,run:cancel,runTask:submit,run:answer,runTask:reply');
  await refuses('desktop payload rejects host paths', () => assertIpcPayload('project:removeMissing', { repositoryId: goneId, path: gone }));
  devices.setAdminScopes(device.id, ['workspace:read']);
  await refuses('removal requires the catalog grant', () => application.projectRemoveMissing(context(), input), 'scope_not_granted');
  devices.setAdminScopes(device.id, ['workspace:read', 'catalog:write'], { mode: 'selected', repositoryIds: [goneId], agentIds: [] });
  await refuses('selected-resource devices cannot change the shared catalog', () => application.projectRemoveMissing(context('remove-selected-0001'), input), 'scope_not_granted');
  devices.setAdminScopes(device.id, ['workspace:read', 'catalog:write'], { mode: 'all' });
  await refuses('removal rejects payload additions', () => application.projectRemoveMissing(context(), { ...input, path: gone }), 'invalid_payload');
  await refuses('removal requires an idempotency key', () => application.projectRemoveMissing({ ...context(), idempotencyKey: undefined }, input), 'idempotency_key_required');

  sessions.push({ id: 'shell-gone', title: 'Shell', kind: 'interactive', status: 'running', createdAt: Date.now(), repositoryId: goneId, workspaceDir: gone, executionBackend: 'native' } as never);
  check('an open terminal marks the missing project as active', (await projects.directory()).missing?.[0]?.removal === 'active');
  await refuses('removal is refused while a terminal is open in the project', () => projects.removeMissing(goneId), /Terminal/i);
  sessions.pop();
  const agents = store.get().agents;
  store.save({ agents: agents.map((agent, index) => index === 0 ? { ...agent, defaultRepositoryId: goneId } : agent) });
  check('a project still named by an agent stays hidden instead of removable', (await projects.directory()).missing?.[0]?.removal === 'history');
  await refuses('removal is refused while history refers to the project', () => projects.removeMissing(goneId), /hidden instead|ausgeblendet/);
  store.save({ agents });

  init('Gone');
  await refuses('removal re-checks the folder and refuses when it exists again', () => application.projectRemoveMissing(context('remove-again-0001'), input), 'command_rejected');
  check('a refused removal keeps the registration', store.get().repositories.some((item) => item.id === goneId));
  rmSync(gone, { recursive: true, force: true });

  server = new HostApiServer(application, { port: 0, requireDeviceReads: true, authorizer: new RemoteAuthorizer('t'.repeat(32), [], undefined, devices), audit: (event) => devices.audit(event) });
  const origin = `http://127.0.0.1:${(await server.start()).port}`;
  const request = (path: string, payload: unknown, key = '') => {
    const body = JSON.stringify(payload); const signed = { method: 'POST', path, timestamp: String(Date.now()), idempotencyKey: key, bodySha256: sha256Hex(body) };
    return fetch(origin + path, { method: 'POST', body, headers: { authorization: `Bearer ${'t'.repeat(32)}`, 'content-type': 'application/json',
      'x-ade-device': device.id, 'x-ade-timestamp': signed.timestamp, 'x-ade-signature': signRequest(device.secret, signed), ...(key ? { 'idempotency-key': key } : {}) } });
  };
  const wire = await (await request('/api/v1/projects/query', { operation: 'directory' })).json() as ProjectWorkspaceQueryResult;
  check('the signed tablet directory carries the missing project without host paths', wire.directory?.missing?.[0]?.repositoryId === goneId && !JSON.stringify(wire).includes(root));
  const runsBefore = JSON.stringify(store.get().runs);
  const response = await request('/api/v1/projects/remove-missing', input, 'http-remove-0001');
  const removed = await response.json() as ProjectRemoveMissingResult;
  check('signed tablet removal deregisters only the missing project', response.status === 200 && removed.removed && !store.get().repositories.some((item) => item.id === goneId)
    && store.get().repositories.some((item) => item.id === keepId));
  check('its project workspaces and assignments go with it; the other project keeps its workspace',
    !store.get().projectWorkspaces.some((item) => item.repositoryId === goneId) && store.get().projectWorkspaces.some((item) => item.repositoryId === keepId)
    && !store.get().workspaceAssignments.some((item) => item.repositoryId === goneId));
  check('session history and runs remain', store.get().sessionBookends.some((item) => item.id === 'bookend-gone') && JSON.stringify(store.get().runs) === runsBefore);
  let validAfter = true; try { validateCompleteConfig(structuredClone(store.get())); } catch (error) { validAfter = false; console.error(error); }
  check('the remaining configuration still validates', !validBefore || validAfter);
  check('the same key replays the receipt instead of running again', (await application.projectRemoveMissing(context('http-remove-0001'), input)).replayed);
  await refuses('the key cannot be reused for another project', () => application.projectRemoveMissing(context('http-remove-0001'), { repositoryId: keepId }), 'idempotency_key_reused');
  await refuses('an existing project cannot be removed through this command', () => application.projectRemoveMissing(context('remove-keep-0001'), { repositoryId: keepId }), 'command_rejected');
  check('the list has no missing projects left', !(await projects.directory()).missing?.length);

  // Project start (tablet): a stored rejection replays for its key; only a new key retries.
  const create = { operation: 'project-create', input: { name: 'Autokauf' } };
  const defaults = new ProjectDefaultsService(store);
  renameSync(parent, parent + '.old'); mkdirSync(parent);
  await refuses('project-create is rejected while the project root was replaced', () => application.administer(context('start-autokauf-project'), create), 'command_rejected');
  defaults.save({ rootPath: parent, agentId: null });
  await refuses('after fixing the root the same key still replays the stored rejection', () => application.administer(context('start-autokauf-project'), create), 'command_rejected');
  check('the replayed rejection created nothing', !store.get().repositories.some((item) => item.name === 'Autokauf'));
  const retried = await application.administer(context('start-autokauf-retry-1'), create);
  check('a new key after a definite rejection creates the project once', !!retried.created && store.get().repositories.filter((item) => item.name === 'Autokauf').length === 1);
  await refuses('a further new key for the same name fails closed instead of creating a duplicate', () => application.administer(context('start-autokauf-retry-2'), create), /exists|existiert/);
  check('still exactly one Autokauf project', store.get().repositories.filter((item) => item.name === 'Autokauf').length === 1);
  rmSync(parent + '.old', { recursive: true, force: true });
  const audit = readFileSync(devices.auditPath, 'utf8');
  check('the audit records the removal without host paths', audit.split('\n').some((line) => line.includes('"project:remove-missing"') && line.includes('"executed"'))
    && !audit.includes(root));
})().catch((error) => { failed++; console.error(error); })
  .finally(async () => {
    await server?.stop();
    if (dirname(root) !== realpathSync.native(resolve(tmpdir()))) throw new Error('Unexpected fixture directory');
    rmSync(root, { recursive: true, force: true });
    console.log(`Missing projects: ${passed} passed, ${failed} failed`);
    if (failed) process.exitCode = 1;
  });
