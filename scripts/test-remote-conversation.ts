import { mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { AdeApplicationService, RemoteApiError, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import { HostRestartController } from '../src/main/application/HostRestartController';
import { RemoteCommandLedger } from '../src/main/application/RemoteCommandLedger';
import { ConversationService, type ConversationLaunch, type ConversationProcess } from '../src/main/conversation/ConversationService';
import { ConversationStore, conversationDigest } from '../src/main/conversation/ConversationStore';
import { HostApiServer } from '../src/main/remote/HostApiServer';
import { RemoteAuthorizer, sha256Hex, signRequest } from '../src/main/remote/authorization';
import type { ConversationReceipt } from '../src/shared/conversation';
import type { MobileConversationAnswer, MobileConversationDetail, MobileConversationQuestion, MobileConversationOverview } from '../src/shared/remote';
import { REMOTE_COMMAND_CHANNELS } from '../src/main/ipcPolicy';
import { redactForWire } from '../src/main/errors';
import { DictationJobs } from '../src/main/settings/DictationJobs';
import type { DictationTranscript } from '../src/shared/dictation';

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-remote-conversation-')));
let passed = 0; let failed = 0; let service: ConversationService | undefined; let server: HostApiServer | undefined;
let jobs: DictationJobs | undefined;
const check = (name: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } };
async function refuses(name: string, fn: () => unknown, code: string) { try { await fn(); check(name, false); } catch (e) { check(name, e instanceof RemoteApiError && e.code === code); } }
void (async () => {
  const { devices, store, orchestration, ledger, gate } = createRemoteWorkspaceFixture(root);
  const secret = 'd'.repeat(40); devices.enroll('tablet', 'Tablet', secret); let deviceId = 'tablet';
  const context = (): RemoteCommandContext => ({ principal: { id: deviceId, kind: 'device', proof: 'device-signature', scopes: new Set(devices.activeDevices().find(d => d.id === deviceId)!.scopes) }, idempotencyKey: randomUUID(), requestId: 'conversation-test' });
  let authority = 'original'; let callback!: ConversationLaunch; let launches = 0; let sends = 0; let delivered = 0;
  const exits: Array<(event: { exitCode: number }) => void> = [];
  service = new ConversationService(new ConversationStore(join(root, 'conversation.json')), {
    binding: profileId => ({ profileId, authoritySha256: conversationDigest(authority), toolContract: 'ade-fixture' }),
    launch: input => { callback = input; launches++; return {
      sendTurn: async () => { sends++; return { threadId: 'native-thread', turnId: 'native-next' }; },
      interruptTurn: async () => undefined, write: () => { throw new Error('PTY unavailable'); }, resize: () => undefined,
      kill: () => exits.splice(0).forEach(fn => fn({ exitCode: 0 })), onData: () => ({ dispose() {} }), onExit: fn => { exits.push(fn); return { dispose() {} }; },
    } satisfies ConversationProcess; },
  });
  let speechStarts = 0; let speechPackets = 0; let speechAborts = 0; let speechUsage = '';
  jobs = new DictationJobs({ transcribe: async () => { throw new Error('No upload endpoint'); }, startLive: async (authorize, signal, usage, preview) => {
    authorize(); speechStarts++; speechUsage = JSON.stringify(usage); let complete!: (value: DictationTranscript) => void;
    const result = new Promise<DictationTranscript>((resolve, reject) => { complete = resolve; signal.addEventListener('abort', () => { speechAborts++; reject(new Error('aborted')); }, { once: true }); });
    return { result, push: () => { authorize(); speechPackets++; preview('Private C:\\Users\\fixture\\notes.txt'); },
      finish: () => { authorize(); complete({ text: 'Final C:\\Users\\fixture\\notes.txt', language: 'deu', audioSeconds: 1, model: 'scribe_v2_realtime' }); } };
  } });
  const app = new AdeApplicationService(store, orchestration, { status: () => ({ active: 0, queued: 0, maxActive: 4 }) }, {
    dictation: jobs, audit: entry => devices.audit(entry),
    conversations: () => service!, resourceAccess: id => devices.resourceAccess(id), deviceActive: id => devices.activeDevices().some(d => d.id === id), activity: gate,
    administration: { ledger, restart: new HostRestartController(gate, () => [], () => undefined, 'fixture', true) },
  });
  const query = async () => (await app.conversation(context(), { operation: 'overview' }, false) as MobileConversationOverview).conversations;
  await refuses('conversation read requires workspace read grant', query, 'scope_not_granted');
  devices.setAdminScopes('tablet', ['workspace:read'], { mode: 'all' });
  check('authorized inventory is empty without a terminal or model', !(await query()).length && !launches);
  await refuses('bearer cannot read global conversations', () => app.conversation({ ...context(), principal: { id: 'bootstrap', kind: 'bootstrap-token', proof: 'bearer', scopes: new Set(['read', 'workspace:read']) } }, { operation: 'overview' }, false), 'device_proof_required');
  const readOnly = context(); readOnly.principal.scopes = new Set(['read', 'workspace:read']);
  await refuses('read-only device cannot start a conversation', () => app.conversation(readOnly, { operation: 'create', profileId: 'profile' }, true), 'scope_not_granted');
  await refuses('creation requires an idempotency key', () => app.conversation({ ...context(), idempotencyKey: undefined }, { operation: 'create', profileId: 'profile' }, true), 'idempotency_key_required');
  for (const extra of [{ commandId: 'injected' }, { threadId: 'native' }, { cwd: root }, { ptyId: 'injected' }]) {
    await refuses('conversation command rejects private identity or host parameter injection', () => app.conversation(context(), { operation: 'create', profileId: 'profile', ...extra }, true), 'invalid_payload');
  }
  const createKey = context(); const created = await app.conversation(createKey, { operation: 'create', profileId: 'profile' }, true) as ConversationReceipt;
  check('lost creation acknowledgement replays one conversation without model launch', (await app.conversation(createKey, { operation: 'create', profileId: 'profile' }, true) as ConversationReceipt).replayed && (await query()).length === 1 && !launches);
  const id = created.conversationId; const send = { operation: 'send', conversationId: id, afterTurnId: null, text: 'Private user input must remain on host' };
  const prepareVoice = { operation: 'prepare', conversationId: id };
  await refuses('conversation recording requires explicit dictation grant', () => app.conversationDictation(context(), prepareVoice), 'scope_not_granted');
  devices.setAdminScopes('tablet', ['workspace:read', 'dictation:transcribe'], { mode: 'all' });
  await refuses('conversation recording rejects terminal injection', () => app.conversationDictation(context(), { ...prepareVoice, target: { sessionId: 'fake' } }), 'invalid_payload');
  await refuses('recording preparation requires a durable key', () => app.conversationDictation({ ...context(), idempotencyKey: undefined }, prepareVoice), 'idempotency_key_required');
  const voiceKey = context(); const voice = await app.conversationDictation(voiceKey, prepareVoice) as { jobId: string };
  const voiceReplay = await app.conversationDictation(voiceKey, prepareVoice) as { jobId: string; replayed: boolean };
  check('ticket replay needs neither a terminal service nor terminal control', voice.jobId === voiceReplay.jobId && voiceReplay.replayed && speechStarts === 0 && !launches);
  const startVoice = context(); await app.conversationDictation(startVoice, { operation: 'stream-start', jobId: voice.jobId }); await app.conversationDictation(startVoice, { operation: 'stream-start', jobId: voice.jobId });
  check('speech start replay has one paid effect attributed to the conversation profile', speechStarts === 1 && speechUsage === '{"agentId":"profile"}');
  const packetKey = { ...context(), idempotencyKey: `${voice.jobId}:0` }; const packet = { operation: 'stream-chunk', jobId: voice.jobId, sequence: 0, audioBase64: Buffer.alloc(8192).toString('base64') };
  await app.conversationDictation(packetKey, packet); await app.conversationDictation(packetKey, packet);
  check('audio packet replay has one provider effect', speechPackets === 1);
  await refuses('same packet key cannot change its bytes', () => app.conversationDictation(packetKey, { ...packet, audioBase64: Buffer.alloc(8192, 1).toString('base64') }), 'command_rejected');
  const voicePreview = await app.conversationDictation(context(), { operation: 'query', jobId: voice.jobId });
  check('transcript paths are redacted before reaching the tablet', JSON.stringify(voicePreview).includes('[path]') && !JSON.stringify(voicePreview).includes('Users'));
  const foreign = jobs.prepare('device:tablet', () => {});
  await refuses('terminal owner tickets cannot use conversation voice', () => app.conversationDictation(context(), { operation: 'query', jobId: foreign.jobId }), 'command_rejected');
  await app.conversationDictation(context(), { operation: 'stream-finish', jobId: voice.jobId });
  check('completed voice remains a draft without launching a model', JSON.stringify(await app.conversationDictation(context(), { operation: 'query', jobId: voice.jobId })).includes('Final [path]') && !launches);
  const invalidated = await app.conversationDictation(context(), prepareVoice) as { jobId: string };
  await app.conversationDictation(context(), { operation: 'stream-start', jobId: invalidated.jobId });
  authority = 'different-recording-scope';
  await refuses('changed project authority revokes a started recording', () => app.conversationDictation(context(), { operation: 'query', jobId: invalidated.jobId }), 'command_rejected');
  check('invalidated authority aborts the provider', speechAborts > 0);
  authority = 'original';
  check('fresh authorized recording works after the rejection cases', !!(await app.conversationDictation(context(), prepareVoice) as { jobId: string }).jobId);
  const sendKey = context(); const receipt = await app.conversation(sendKey, send, true) as ConversationReceipt;
  check('remote send creates one durable model turn and replays the same receipt', (await app.conversation(sendKey, send, true) as ConversationReceipt).turnId === receipt.turnId && launches === 1 && sends === 0);
  await refuses('changed prompt cannot reuse an accepted command key', () => app.conversation(sendKey, { ...send, text: 'Changed' }, true), 'idempotency_key_reused');
  callback.ready({ threadId: 'native-thread', model: 'model-fixture', reasoningEffort: 'high' });
  const question = callback.question([{ id: 'choice', header: 'Choose', question: 'Read C:\\Private\\notes before continuing?', isOther: true, isSecret: false, options: [{ label: 'Continue', description: 'Use /home/private/work' }] }], true, async () => { delivered++; });
  const metadata = await app.conversation(context(), { operation: 'detail', conversationId: id }, false) as MobileConversationDetail;
  check('detail metadata exposes digests and question counts without input, model answer or native IDs', metadata.turns[0].input.chars === send.text.length && metadata.turns[0].questions[0].items === 1 && !JSON.stringify(metadata).includes('Private') && !JSON.stringify(metadata).includes('native-'));
  const q = await app.conversation(context(), { operation: 'question', conversationId: id, turnId: receipt.turnId, questionId: question.id, item: 0 }, false) as MobileConversationQuestion;
  check('explicit question detail redacts paths while preserving the exact ADE question identity', q.questionId === question.id && q.redacted && !JSON.stringify(q).includes('Private') && q.value.question.includes('[path]'));
  const answer = { operation: 'answer', conversationId: id, turnId: receipt.turnId, questionId: question.id, answers: { choice: { answers: ['Private question answer'] } } };
  const answerKey = context(); await app.conversation(answerKey, answer, true); await app.conversation(answerKey, answer, true);
  check('question reply is delivered once and stores no raw answer in remote receipts', delivered === 1 && !readFileSync(join(root, 'remote/commands.json'), 'utf8').includes('Private question answer'));
  const output = 'a'.repeat(1990) + ' C:\\Private\\long-path ' + '😀日本語'.repeat(5000) + '\nsk-proj-' + 'x'.repeat(30) + '\nComplete final sentence';
  callback.completed({ threadId: 'native-thread', turnId: 'native-turn', status: 'completed', text: output });
  await refuses('stale remote message has an explicit confirmed admission refusal', () => app.conversation(context(), send, true), 'conversation_not_accepted');
  check('refused stale send leaves the existing native history unchanged', service.detail(id).turns.length === 1 && sends === 0);
  let offset: number | null = 0; let complete = ''; let pages = 0; let bounded = true;
  while (offset !== null) {
    const page = await app.conversation(context(), { operation: 'answer', conversationId: id, turnId: receipt.turnId, offset }, false) as MobileConversationAnswer;
    complete += page.text; offset = page.nextOffset; pages++; bounded &&= page.text.length <= 2000 && Buffer.byteLength(JSON.stringify(page)) < 16 * 1024 && page.sha256 === conversationDigest(output);
  }
  check('all answer pages reconstruct the full redacted Unicode answer including its final sentence', pages > 10 && bounded && complete === redactForWire(output, output.length) && complete.endsWith('Complete final sentence'));
  check('credential and path spanning page boundaries never reach the wire', !complete.includes('Private') && !complete.includes('sk-proj-'));
  await refuses('answer rejects offsets outside the redacted result', () => app.conversation(context(), { operation: 'answer', conversationId: id, turnId: receipt.turnId, offset: output.length + 1 }, false), 'command_rejected');
  await refuses('detail query rejects unrequested file paths', () => app.conversation(context(), { operation: 'detail', conversationId: id, path: root }, false), 'invalid_payload');
  check('wire command ledger contains no user text or native session identity', !readFileSync(join(root, 'remote/commands.json'), 'utf8').includes(send.text) && !readFileSync(join(root, 'remote/commands.json'), 'utf8').includes('native-thread'));
  devices.setAdminScopes('tablet', ['workspace:read'], { mode: 'selected', agentIds: ['profile'], repositoryIds: [] });
  await refuses('selected-project grant cannot inspect global conversation inventory', query, 'scope_not_granted');
  await refuses('selected-project grant cannot replay a previous global command', () => app.conversation(sendKey, send, true), 'scope_not_granted');
  devices.setAdminScopes('tablet', ['workspace:read'], { mode: 'all' });
  authority = 'changed';
  check('changed project authority removes old history from remote inventory', !(await query()).length && service.detail(id).turns.length === 1);
  await refuses('old context is not readable through a remembered ADE ID', () => app.conversation(context(), { operation: 'detail', conversationId: id }, false), 'scope_not_granted');
  authority = 'original';
  // An asynchronous ledger admission is a real revocation boundary.
  const racing = app.conversation(context(), { operation: 'create', profileId: 'profile' }, true);
  devices.setAdminScopes('tablet', ['workspace:read'], { mode: 'selected', agentIds: [], repositoryIds: [] });
  await refuses('resource revocation while a command awaits admission prevents creation', () => racing, 'scope_not_granted');
  check('revoked pending command leaves conversation inventory unchanged', service.query().length === 1);
  devices.setAdminScopes('tablet', ['workspace:read'], { mode: 'all' });
  const authorizer = new RemoteAuthorizer('t'.repeat(32), [], undefined, devices);
  server = new HostApiServer(app, { port: 0, authorizer, requireDeviceReads: true, audit: entry => devices.audit(entry) });
  const address = await server.start();
  const request = async (path: string, payload: unknown, key = randomUUID()) => {
    const body = JSON.stringify(payload); const timestamp = String(Date.now());
    return fetch(`http://127.0.0.1:${address.port}${path}`, { method: 'POST', headers: { authorization: `Bearer ${'t'.repeat(32)}`, 'content-type': 'application/json', 'x-ade-device': 'tablet', 'x-ade-timestamp': timestamp,
      'idempotency-key': key, 'x-ade-signature': signRequest(secret, { method: 'POST', path, timestamp, idempotencyKey: key, bodySha256: sha256Hex(Buffer.from(body)) }) }, body });
  };
  const httpRead = await request('/api/v1/conversation/query', { operation: 'overview' });
  check('signed HTTP route reads the same application conversation service', httpRead.status === 200 && (await httpRead.json() as MobileConversationOverview).conversations[0].id === id);
  devices.setAdminScopes('tablet', ['workspace:read', 'dictation:transcribe'], { mode: 'all' });
  const httpVoice = await request('/api/v1/conversation/dictation', prepareVoice);
  check('signed HTTP conversation dictation route reaches the common main service', httpVoice.status === 200 && !!(await httpVoice.json() as { jobId: string }).jobId);
  const httpKey = randomUUID(); const close = { operation: 'close', conversationId: id };
  const httpClose = await request('/api/v1/conversation/command', close, httpKey); const httpReplay = await request('/api/v1/conversation/command', close, httpKey);
  check('signed HTTP close ends only its conversation and same-key retry is acknowledged', httpClose.status === 200 && httpReplay.status === 200 && (await httpReplay.json() as ConversationReceipt).replayed && service.detail(id).closed);
  check('generic IPC remote command allowlist remains unchanged', REMOTE_COMMAND_CHANNELS.join(',') === 'run:create,run:start,run:cancel,runTask:submit,run:answer');
  const stale = context(); devices.revoke('tablet');
  await refuses('revoked device cannot use an old signed principal to read history', () => app.conversation(stale, { operation: 'overview' }, false), 'unknown_device');
  unlinkSync(join(root, 'remote/commands.json'));
  const missing = new RemoteCommandLedger(join(root, 'remote/commands.json'), () => undefined, () => true);
  await refuses('conversation audit without its command ledger fails closed', () => missing.permits(stale, 'workspace:read'), 'unavailable');
  deviceId = 'second'; devices.enroll(deviceId, 'Second', 'e'.repeat(40)); devices.setAdminScopes(deviceId, ['workspace:read'], { mode: 'all' });
  check('final independent read remains complete after negative controls', (await app.conversation(context(), { operation: 'answer', conversationId: id, turnId: receipt.turnId, offset: 0 }, false) as MobileConversationAnswer).text.length > 0);
})().catch(error => { failed++; console.error(error); }).finally(async () => {
  await server?.stop(); await service?.shutdown(); jobs?.dispose();
  if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected fixture root');
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  console.log(`Remote conversation: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
});
