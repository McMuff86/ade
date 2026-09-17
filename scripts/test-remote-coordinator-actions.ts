import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createMobileFixture } from './helpers/mobileFixture';
import { AdeApplicationService, RemoteApiError, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import { RemoteCommandLedger } from '../src/main/application/RemoteCommandLedger';
import { HostRestartController } from '../src/main/application/HostRestartController';
import { HostOperationGate } from '../src/main/application/HostOperationGate';
import { ConversationService } from '../src/main/conversation/ConversationService';
import { ConversationStore, conversationDigest } from '../src/main/conversation/ConversationStore';
import { CoordinatorActionStore } from '../src/main/conversation/CoordinatorActionStore';
import { CoordinatorActionService } from '../src/main/conversation/CoordinatorActionService';
import { SupervisionStore } from '../src/main/supervision/SupervisionStore';
import { SupervisionService } from '../src/main/supervision/SupervisionService';
import { HostApiServer } from '../src/main/remote/HostApiServer';
import { RemoteAuthorizer, sha256Hex, signRequest } from '../src/main/remote/authorization';
import type { CoordinatorActionDetail, CoordinatorActionReceipt, CoordinatorActionSummary } from '../src/shared/coordinatorActions';
import type { SessionMeta } from '../src/shared/types';

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-remote-actions-')));
let passed = 0; let failed = 0; let server: HostApiServer | undefined;
const check = (label: string, ok: boolean) => { if (!ok) throw new Error(label); passed++; console.log(`  ok  ${label}`); };
const rejects = async (label: string, fn: () => unknown, code: string) => { try { await fn(); check(label, false); } catch (error) { check(label, error instanceof RemoteApiError && error.code === code); } };
async function main() {
  const { store, devices, orchestration, coordinator } = createMobileFixture(root);
  const worker = { ...store.get().agents[1], runtime: 'codex' as const, customCommand: undefined, codexModel: 'gpt-5.6-sol', codexReasoningEffort: 'high' as const };
  store.save({ agents: [worker] }); let launched = 0; let launchAuthorize: (() => void) | undefined;
  coordinator.connect(async (agentId, _prompt, _dispatch, runTaskId, _repo, _workspace, authorize) => {
    launchAuthorize = authorize; authorize?.(); launched++; return { id: `fixture-${launched}`, agentId, runTaskId } as SessionMeta;
  }, () => undefined);
  const supervision = new SupervisionService(new SupervisionStore(join(root, 'supervision.json')), store, () => undefined);
  supervision.command({ operation: 'project', repositoryId: 'repo', objective: '', mode: 'coordinate', revision: 0, commandId: 'project' });
  const projectId = supervision.query().projects[0].id;
  const binding = { profileId: worker.id, toolContract: 'ade-project-actions-v1', authoritySha256: conversationDigest('authority') };
  let currentBinding = binding;
  const conversations = new ConversationService(new ConversationStore(join(root, 'conversations.json')), { binding: () => currentBinding, launch: () => { throw new Error('No model needed for boundary test'); } });
  const id = conversations.command({ operation: 'create', profileId: worker.id, commandId: 'create' }).conversationId;
  const actions = new CoordinatorActionService(new CoordinatorActionStore(join(root, 'actions.json')), { config: store, supervision,
    authorize: (id, binding, open) => conversations.assertActionAuthority(id, binding, open), submit: (input, authorize, reserved) => coordinator.submitSingleTask(input, authorize, reserved),
    report: id => orchestration.report(id), questions: runId => ({ runId, tasks: [] }) });
  const propose = (task = false) => actions.propose(task ? { kind: 'task', projectId, agentId: worker.id, prompt: 'PRIVATE_REMOTE_TASK_INPUT' }
    : { kind: 'handoff', projectId, text: 'Keep C:\\Private\\source and sk-proj-' + 'x'.repeat(30) + ' off the wire', nextStep: 'Review tomorrow' },
    { conversationId: id, turnId: randomUUID(), binding }, { threadId: 'native-private-thread', turnId: 'native-private-turn', callId: randomUUID(), signal: new AbortController().signal });
  const secret = 'a'.repeat(40); devices.enroll('tablet', 'Tablet', secret);
  let deviceId = 'tablet';
  const context = (): RemoteCommandContext => ({ principal: { id: deviceId, kind: 'device', proof: 'device-signature', scopes: new Set(devices.activeDevices().find(device => device.id === deviceId)!.scopes) }, idempotencyKey: randomUUID(), requestId: 'action-test' });
  const ledger = new RemoteCommandLedger(join(root, 'remote', 'commands.json'), e => devices.audit(e), (id, scope) => devices.activeDevices().some(d => d.id === id && d.scopes.includes(scope)));
  const gate = new HostOperationGate();
  const app = new AdeApplicationService(store, orchestration, { status: () => ({ active: 0, queued: 0, maxActive: 4 }) }, {
    conversations: () => conversations, conversationActions: () => actions, resourceAccess: id => devices.resourceAccess(id), deviceActive: id => devices.activeDevices().some(d => d.id === id),
    activity: gate, administration: { ledger, restart: new HostRestartController(gate, () => [], () => undefined, 'fixture', true) }, audit: e => devices.audit(e),
  });
  const read = { operation: 'list', conversationId: id };
  await rejects('action list requires workspace read rights', () => app.conversationActions(context(), read, false), 'scope_not_granted');
  devices.setAdminScopes('tablet', ['workspace:read'], { mode: 'all' });
  const note = propose();
  const list = await app.conversationActions(context(), read, false) as CoordinatorActionSummary[];
  check('remote list exposes only action metadata without handoff bodies or native IDs', list[0].id === note.id && !JSON.stringify(list).includes('Private') && !JSON.stringify(list).includes('native-private'));
  const detail = await app.conversationActions(context(), { operation: 'detail', conversationId: id, actionId: note.id }, false) as CoordinatorActionDetail;
  check('explicit handoff detail redacts host paths and credentials', !!detail.text?.includes('[path]') && !detail.text.includes('Private') && !detail.text.includes('sk-proj-'));
  await rejects('bearer-only access cannot read action details', () => app.conversationActions({ ...context(), principal: { ...context().principal, proof: 'bearer' } }, read, false), 'device_proof_required');
  await rejects('extra host path on an action query is rejected', () => app.conversationActions(context(), { ...read, cwd: root }, false), 'invalid_payload');
  const confirm = { operation: 'confirm', conversationId: id, actionId: note.id };
  await rejects('confirmation requires an idempotency key', () => app.conversationActions({ ...context(), idempotencyKey: undefined }, confirm, true), 'idempotency_key_required');
  await rejects('client cannot inject a main command ID', () => app.conversationActions(context(), { ...confirm, commandId: 'client' }, true), 'invalid_payload');
  const noWrite = context(); noWrite.principal = { ...noWrite.principal, scopes: new Set([...noWrite.principal.scopes].filter(scope => scope !== 'runs:write')) };
  await rejects('read-only device cannot confirm proposals', () => app.conversationActions(noWrite, confirm, true), 'scope_not_granted');
  const key = context(); const receipt = await app.conversationActions(key, confirm, true) as CoordinatorActionReceipt;
  const replay = await app.conversationActions(key, confirm, true) as CoordinatorActionReceipt;
  check('same signed command replays one handoff confirmation', receipt.state === 'applied' && replay.replayed && supervision.briefing().projects[0].handoffs.length === 1);
  await rejects('same device key cannot change the operation', () => app.conversationActions(key, { ...confirm, operation: 'dismiss' }, true), 'idempotency_key_reused');
  const task = propose(true);
  check('task proposal detail never transmits private task instructions', !JSON.stringify(await app.conversationActions(context(), { operation: 'detail', conversationId: id, actionId: task.id }, false)).includes('PRIVATE_REMOTE_TASK_INPUT'));
  const taskConfirm = { ...confirm, actionId: task.id }; const racing = app.conversationActions(context(), taskConfirm, true);
  devices.setAdminScopes('tablet', ['workspace:read'], { mode: 'selected', agentIds: [], repositoryIds: [] });
  await rejects('resource revocation during ledger admission prevents launch', () => racing, 'scope_not_granted');
  check('rejected admission leaves the proposal pending and no child run', !store.get().runs.length && actions.list(id).find(a => a.id === task.id)?.state === 'proposed');
  await rejects('selected-resource device cannot query global action history', () => app.conversationActions(context(), read, false), 'scope_not_granted');
  devices.setAdminScopes('tablet', ['workspace:read'], { mode: 'all' });
  currentBinding = { ...binding, authoritySha256: conversationDigest('changed') };
  await rejects('changed conversation authority prevents old proposal confirmation', () => app.conversationActions(context(), taskConfirm, true), 'scope_not_granted'); currentBinding = binding;
  server = new HostApiServer(app, { port: 0, authorizer: new RemoteAuthorizer('t'.repeat(32), [], undefined, devices), requireDeviceReads: true });
  const address = await server.start();
  const request = (path: string, payload: unknown, key: string = randomUUID()) => {
    const body = JSON.stringify(payload); const timestamp = String(Date.now());
    return fetch(`http://127.0.0.1:${address.port}${path}`, { method: 'POST', headers: { authorization: `Bearer ${'t'.repeat(32)}`, 'content-type': 'application/json',
      'x-ade-device': 'tablet', 'x-ade-timestamp': timestamp, 'idempotency-key': key,
      'x-ade-signature': signRequest(secret, { method: 'POST', path, timestamp, idempotencyKey: key, bodySha256: sha256Hex(Buffer.from(body)) }) }, body });
  };
  const httpList = await request('/api/v1/conversation/actions/query', read);
  check('signed HTTP action query reaches the same real service', httpList.status === 200 && (await httpList.json() as CoordinatorActionSummary[]).length === 2);
  const taskKey = `action-confirm-${task.id}`;
  const httpCommand = await request('/api/v1/conversation/actions/command', taskConfirm, taskKey);
  const httpReplay = await request('/api/v1/conversation/actions/command', taskConfirm, taskKey);
  check('actual browser-format key submits one child via signed HTTP and safely replays', httpCommand.status === 200 && httpReplay.status === 200 && (await httpReplay.json() as CoordinatorActionReceipt).replayed && launched === 1);
  const taskView = actions.list(id).find(a => a.id === task.id)!;
  const httpWork = await request('/api/v1/conversation/actions/query', { operation: 'work', conversationId: id, actionId: task.id });
  check('work detail uses the retained exact child and excludes the private prompt', httpWork.status === 200 && !!taskView.taskId && !(await httpWork.text()).includes('PRIVATE_REMOTE_TASK_INPUT'));
  check('remote receipt and audit files contain no private proposal bodies', !readFileSync(join(root, 'remote', 'commands.json'), 'utf8').includes('PRIVATE_REMOTE_TASK_INPUT')
    && !readFileSync(join(root, 'remote', 'audit.jsonl'), 'utf8').includes('PRIVATE_REMOTE_TASK_INPUT'));
  const stale = context(); devices.revoke('tablet');
  await rejects('revoked device cannot inspect actions using a stale principal', () => app.conversationActions(stale, read, false), 'unknown_device');
  await rejects('actual task launch guard retains device revocation checks', () => launchAuthorize!(), 'unknown_device');
  deviceId = 'second'; devices.enroll(deviceId, 'Tablet again', secret); devices.setAdminScopes(deviceId, ['workspace:read'], { mode: 'all' });
  check('final positive action read succeeds after access negative controls', (await app.conversationActions(context(), read, false) as CoordinatorActionSummary[]).some(a => a.runId === taskView.runId));
}
void main().catch(error => { failed++; console.error(error); }).finally(async () => {
  await server?.stop(); if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected fixture root'); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  console.log(`Remote coordinator actions: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
});
