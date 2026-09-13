import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { AdeApplicationService, RemoteApiError, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import { RemoteCommandLedger } from '../src/main/application/RemoteCommandLedger';
import { HostRestartController } from '../src/main/application/HostRestartController';
import { HostApiServer } from '../src/main/remote/HostApiServer';
import { RemoteAuthorizer, sha256Hex, signRequest } from '../src/main/remote/authorization';
import { REMOTE_COMMAND_CHANNELS } from '../src/main/ipcPolicy';

let passed = 0;
const check = (label: string, ok: boolean) => { if (!ok) throw new Error(label); passed++; console.log(`  ok  ${label}`); };
async function refuses(label: string, action: () => unknown, pattern: RegExp) {
  try { await action(); } catch (error) { check(label, pattern.test(`${error instanceof RemoteApiError ? error.code : ''} ${String(error)}`)); return; } throw new Error(label);
}
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-run-delete-')));
let server: HostApiServer | undefined;
void (async () => {
  const f = createRemoteWorkspaceFixture(root); const { store, devices, application: app, orchestration, coordinator } = f;
  devices.enroll('tablet', 'Tablet', 's'.repeat(40));
  const context = (key: string = randomUUID()): RemoteCommandContext => ({ principal: { id: 'tablet', kind: 'device', proof: 'device-signature', scopes: new Set(['read', 'runs:write']) }, requestId: 'delete-test', idempotencyKey: key });
  store.save({ repositories: [{ id: 'repo', name: 'Deletion fixture', rootPath: root, commonGitDir: join(root, '.git'), executionBackend: 'native', verified: true, createdAt: 1 }] });
  const make = (status: 'completed' | 'failed' | 'cancelled' | 'running' = 'completed') => {
    const result = orchestration.createSingleTaskRun({ agentId: 'builder', repositoryId: 'repo', name: 'Delete fixture', prompt: 'Private prompt stays off wire' });
    coordinator.onTaskStarted(result.task.id, { id: randomUUID(), agentId: 'builder', kind: 'task', title: 'Fixture', status: 'running', createdAt: Date.now(), runTaskId: result.task.id });
    if (status !== 'running') coordinator.onTaskFinished(result.task.id, status, status === 'completed' ? 0 : 1);
    return result;
  };
  const finished = make(); const other = make();
  check('dedicated deletion does not expand generic IPC remote allowlist', !REMOTE_COMMAND_CHANNELS.includes('run:delete'));
  await refuses('deletion requires device proof', () => app.deleteRun({ ...context(), principal: { ...context().principal, proof: 'bearer' } }, finished.run.id), /device_proof_required/);
  await refuses('read-only principal cannot delete', () => app.deleteRun({ ...context(), principal: { ...context().principal, scopes: new Set(['read']) } }, finished.run.id), /scope_not_granted/);
  await refuses('deletion requires an idempotency key', () => app.deleteRun({ ...context(), idempotencyKey: undefined }, finished.run.id), /idempotency_key_required/);
  await refuses('invalid key cannot delete', () => app.deleteRun(context('short'), finished.run.id), /idempotency_key_invalid/);
  devices.setAdminScopes('tablet', [], { mode: 'selected', repositoryIds: ['repo'], agentIds: ['builder'] });
  await refuses('restricted catalog grant cannot delete retained history', () => app.deleteRun(context(), finished.run.id), /scope_not_granted|resource_not_granted/);
  devices.setAdminScopes('tablet', [], { mode: 'all' });
  const active = make('running');
  await refuses('active run is rejected before stopping its task', () => app.deleteRun(context(), active.run.id), /Nur abgeschlossene/);
  check('rejected deletion leaves running task intact', store.get().runTasks.find((item) => item.id === active.task.id)?.status === 'running');
  coordinator.onTaskFinished(active.task.id, 'cancelled', 130);
  const published = make();
  store.save({ runPublications: [{ id: randomUUID(), runId: published.run.id, repositoryId: 'repo', provider: 'github', providerRepository: 'fixture/repo', remoteName: 'origin', baseBranch: 'main', headBranch: 'feature', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40), status: 'draft', createdAt: 1, updatedAt: 1 }] });
  await refuses('external publication audit prevents deletion', () => app.deleteRun(context(), published.run.id), /publication audit/);
  const leased = make();
  store.save({ runWorkspaceLeases: [{ id: randomUUID(), runId: leased.run.id, participantId: leased.task.participantId, agentId: 'builder', workspaceDir: root, isRepo: true, commonGitDir: join(root, '.git'), branch: 'main', baseSha: 'a'.repeat(40), status: 'active', acquiredAt: 1 }] });
  await refuses('active workspace lease prevents deletion', () => app.deleteRun(context(), leased.run.id), /active run/);
  const file = join(root, 'keep-project.txt'); writeFileSync(file, 'user work');
  const key = randomUUID(); const beforeSeq = Math.max(...store.get().runEvents.filter((event) => event.runId === finished.run.id).map((event) => event.seq));
  const [first, replay] = await Promise.all([app.deleteRun(context(key), finished.run.id), app.deleteRun(context(key), finished.run.id)]);
  check('concurrent duplicate confirms one deletion and one replay', first.deleted && replay.deleted && first.replayed !== replay.replayed);
  check('run and all owned journal rows are removed', !store.get().runs.some((item) => item.id === finished.run.id)
    && ['runParticipants', 'runTasks', 'runEvents', 'runArtifacts', 'runTaskResults', 'runApprovals', 'runWorkspaceLeases', 'runMessages'].every((name) => !(store.get()[name as 'runTasks']).some((item) => item.runId === finished.run.id)));
  check('journal reset advances while other run and workspace files remain', store.get().journalRetention.prunedSeq >= beforeSeq && store.get().runs.some((item) => item.id === other.run.id) && readFileSync(file, 'utf8') === 'user work');
  await refuses('same key cannot name another run', () => app.deleteRun(context(key), other.run.id), /idempotency_key_reused/);
  const receiptFile = join(root, 'remote', 'commands.json');
  const ledger = new RemoteCommandLedger(receiptFile, (entry) => devices.audit(entry), (id, scope) => devices.activeDevices().some((device) => device.id === id && device.scopes.includes(scope)));
  const restarted = new AdeApplicationService(store, orchestration, { status: () => ({ active: 0, queued: 0, maxActive: 4 }) }, {
    deleteCompletedRun: () => { throw new Error('must not execute twice'); }, resourceAccess: (id) => devices.resourceAccess(id),
    administration: { ledger, restart: new HostRestartController(f.gate, () => [], () => undefined, 'fixture', true) },
  });
  check('restart replays receipt after target run no longer exists', (await restarted.deleteRun(context(key), finished.run.id)).replayed);
  check('deletion receipts never retain prompts or workspace paths', !readFileSync(receiptFile, 'utf8').includes('Private prompt') && !readFileSync(receiptFile, 'utf8').includes(root.replace(/\\/g, '\\\\')));
  const authorizer = new RemoteAuthorizer('t'.repeat(32), [], undefined, devices);
  server = new HostApiServer(app, { authorizer, port: 0, audit: (entry) => devices.audit(entry) }); const address = await server.start();
  const request = (id: string, body = '', method = 'POST') => {
    const path = `/api/v1/runs/${id}/delete`; const timestamp = String(Date.now()); const requestKey = randomUUID();
    return fetch(`http://127.0.0.1:${address.port}${path}`, { method, ...(method === 'POST' && body ? { body } : {}), headers: {
      authorization: `Bearer ${'t'.repeat(32)}`, 'X-Ade-Device': 'tablet', 'X-Ade-Timestamp': timestamp, 'Idempotency-Key': requestKey, 'Content-Type': 'application/json',
      'X-Ade-Signature': signRequest('s'.repeat(40), { method, path, timestamp, idempotencyKey: requestKey, bodySha256: sha256Hex(body) }),
    } });
  };
  check('HTTP deletion rejects unexpected body', (await request(other.run.id, JSON.stringify({ command: 'anything' }))).status === 400);
  check('HTTP deletion is not available through GET', (await request(other.run.id, '', 'GET')).status === 405);
  check('signed HTTP deletion removes completed run', (await request(other.run.id)).status === 200 && !store.get().runs.some((item) => item.id === other.run.id));
  for (const status of ['failed', 'cancelled'] as const) { const run = make(status); check(`${status} run can be deleted`, (await app.deleteRun(context(), run.run.id)).deleted); }
  devices.revoke('tablet');
  await refuses('revoked device cannot replay old deletion', () => restarted.deleteRun(context(key), finished.run.id), /scope_not_granted/);
  const audit = readFileSync(join(root, 'remote', 'audit.jsonl'), 'utf8');
  check('requested executed replayed and rejected deletion are audited', ['requested', 'executed', 'replayed', 'rejected'].every((outcome) => audit.split('\n').some((line) => line.includes('run:delete') && line.includes(`"outcome":"${outcome}"`))));
  console.log(`Run deletion: ${passed} passed, 0 failed`);
})().catch((error) => { console.error(error); console.log(`Run deletion: ${passed} passed, 1 failed`); process.exitCode = 1; })
  .finally(async () => { await server?.stop(); if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected fixture root'); rmSync(root, { recursive: true, force: true }); });
