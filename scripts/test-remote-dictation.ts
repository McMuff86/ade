import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { RemoteTerminalService } from '../src/main/application/RemoteTerminalService';
import { DeviceResourceService } from '../src/main/application/DeviceResourceService';
import { AdeApplicationService, RemoteApiError, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import { HostRestartController } from '../src/main/application/HostRestartController';
import { HostApiServer } from '../src/main/remote/HostApiServer';
import { RemoteAuthorizer, sha256Hex, signRequest } from '../src/main/remote/authorization';
import { DictationJobs } from '../src/main/settings/DictationJobs';
import { encodeDictationPcm } from '../src/shared/dictationAudio';
import type { MobileTerminalState } from '../src/shared/remote';
import type { DictationTranscript } from '../src/shared/dictation';
import { LIVE_DICTATION_MAX_PACKETS } from '../src/shared/liveDictation';

let passed = 0; let terminal: RemoteTerminalService | undefined; let jobs: DictationJobs | undefined; let server: HostApiServer | undefined;
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-remote-dictation-')));
const check = (name: string, ok: boolean) => { if (!ok) throw new Error(name); passed++; console.log(`  ok ${name}`); };
async function refuses(name: string, action: () => unknown, code: string) {
  try { await action(); } catch (error) { check(name, error instanceof RemoteApiError && error.code === code); return; }
  throw new Error(`${name}: unexpectedly accepted`);
}
void (async () => {
  const fixture = createRemoteWorkspaceFixture(root); const { store, devices, sessions, workbench, ledger, gate } = fixture;
  const secret = 'd'.repeat(40); devices.enroll('tablet', 'Tablet', secret); devices.enroll('other', 'Other', 'e'.repeat(40));
  const grants = ['catalog:write', 'workspace:read', 'terminal:control', 'dictation:transcribe'] as const;
  devices.setAdminScopes('tablet', [...grants]); devices.setAdminScopes('other', [...grants]);
  const context = (id = 'tablet'): RemoteCommandContext => ({ principal: { id, kind: 'device', proof: 'device-signature',
    scopes: new Set(devices.activeDevices().find(item => item.id === id)!.scopes) }, idempotencyKey: randomUUID(), requestId: 'dictation-test' });
  const repo = (await fixture.application.administer(context(), { operation: 'project-create', input: { name: 'Dictation' } })).created!.id;
  const selection = { agentId: 'builder', repositoryId: repo };
  await fixture.application.administer(context(), { operation: 'workspace-prepare', input: selection });
  const binding = store.get().workspaceBindings.find(item => item.repositoryId === repo)!;
  const resources = new DeviceResourceService(store, id => devices.resourceAccess(id));
  const writes: string[] = []; let available = true; let providerCalls = 0;
  terminal = new RemoteTerminalService(workbench, { list: () => sessions,
    create: async (agentId, repositoryId, workspaceBindingId) => {
      const session = { id: `s${sessions.length + 1}`, agentId, repositoryId: repositoryId!, workspaceBindingId, workspaceDir: binding.workspaceDir,
        executionBackend: 'native' as const, kind: 'interactive' as const, title: 'Codex', status: 'running' as const, createdAt: Date.now() };
      sessions.push(session); return session;
    }, attach: () => ({ replayBase64: '', sequence: 1 }), resize: () => {}, kill: () => {}, write: (_id, data) => writes.push(data.toString()),
    promptCapability: () => available ? { available: true } : { available: false, reason: 'CLI ended' },
    writePrompt: (_id, text) => { if (!available) throw new Error('CLI ended'); writes.push(text); },
  }, id => devices.activeDevices().some(item => item.id === id && item.scopes.includes('terminal:control')),
  entry => devices.audit(entry), undefined, undefined, (id, target) => resources.assertSelection(id, target));
  let liveStarts = 0; let livePackets = 0; let liveFinishes = 0; let liveAborts = 0;
  jobs = new DictationJobs({ transcribe: async (_audio, authorize) => { authorize(); providerCalls++;
    return { text: 'Prüfe C:\\Users\\private\\file.ts bitte.', language: 'de', audioSeconds: 3, model: 'scribe_v2' }; },
    startLive: async (authorize, signal, _usage, preview) => {
      authorize(); liveStarts++; let finish!: (value: DictationTranscript) => void;
      const result = new Promise<DictationTranscript>((resolve, reject) => { finish = resolve; signal.addEventListener('abort', () => { liveAborts++; reject(new Error('aborted')); }, { once: true }); });
      return { result, push: () => { authorize(); livePackets++; preview('Live C:\\Users\\private\\file.ts prüfen.'); },
        finish: () => { authorize(); liveFinishes++; finish({ text: 'Live abgeschlossen.', language: 'de', audioSeconds: 3, model: 'scribe_v2_realtime' }); } };
    } });
  devices.onRevoked(id => { terminal!.revoke(id); if (id === null) jobs!.revokeDevices(); else jobs!.revokeOwner(`device:${id}`); });
  const app = new AdeApplicationService(store, fixture.orchestration, { status: () => ({ active: 0, queued: 0, maxActive: 4 }) }, {
    resourceAccess: id => devices.resourceAccess(id), workbench, terminals: terminal, dictation: jobs,
    audit: entry => devices.audit(entry),
    administration: { ledger, restart: new HostRestartController(gate, () => [], () => {}, 'fixture', true) },
  });
  const opened = await app.remoteTerminal(context(), { ...selection, operation: 'open', mode: 'codex' }, 'command') as { terminalId: string };
  const state = await app.remoteTerminal(context(), { ...selection, terminalId: opened.terminalId, prompt: true }, 'query') as MobileTerminalState;
  const target = { ...selection, terminalId: opened.terminalId, leaseId: state.leaseId! };
  check('selected terminal exposes explicit prompt capability', state.promptCapability?.available === true);
  devices.setAdminScopes('tablet', ['terminal:control', 'speech:control']);
  await refuses('voice playback grant does not authorize transcription', () => app.remoteDictation(context(), { operation: 'prepare', target }), 'scope_not_granted');
  devices.setAdminScopes('tablet', [...grants]);
  await app.remoteTerminal(context(), { ...selection, terminalId: target.terminalId, operation: 'claim' }, 'command');
  target.leaseId = ((await app.remoteTerminal(context(), { ...selection, terminalId: target.terminalId }, 'query')) as MobileTerminalState).leaseId!;
  for (const payload of [{ operation: 'prepare', target: { ...target, command: 'injected' } }, { operation: 'prepare', target: { ...target, terminalId: '../private' } }, { operation: 'prepare', target, provider: 'other' }]) {
    await refuses('prepare rejects caller commands, paths and providers', () => app.remoteDictation(context(), payload), 'invalid_payload');
  }
  await refuses('another device cannot record for this control lease', () => app.remoteDictation(context('other'), { operation: 'prepare', target }), 'command_rejected');
  const prepareContext = context();
  const prepared = await app.remoteDictation(prepareContext, { operation: 'prepare', target }); if (!('jobId' in prepared)) throw new Error('no ticket');
  const repeated = await app.remoteDictation(prepareContext, { operation: 'prepare', target });
  check('prepare replay returns same host ticket without a provider call', 'jobId' in repeated && repeated.jobId === prepared.jobId && repeated.replayed && providerCalls === 0);
  const audioBase64 = Buffer.from(encodeDictationPcm(new Float32Array(48_000))).toString('base64');
  const payload = { jobId: prepared.jobId, audioBase64 }; const submitContext = context();
  await refuses('upload requires an idempotency key', () => app.remoteDictation({ ...context(), idempotencyKey: undefined }, payload, true), 'idempotency_key_required');
  await refuses('another device cannot upload to this ticket', () => app.remoteDictation(context('other'), payload, true), 'command_rejected');
  await app.remoteDictation(submitContext, payload, true);
  const replay = await app.remoteDictation(submitContext, payload, true);
  check('audio retry calls provider exactly once', 'replayed' in replay && replay.replayed && providerCalls === 1);
  await refuses('same key cannot change audio', () => app.remoteDictation(submitContext, { ...payload, audioBase64: Buffer.from(encodeDictationPcm(new Float32Array(32_000))).toString('base64') }, true), 'idempotency_key_reused');
  await refuses('same key cannot cross command channels', () => app.remoteDictation(submitContext, { operation: 'cancel', jobId: prepared.jobId }), 'idempotency_key_reused');
  const result = await app.remoteDictation(context(), { operation: 'query', jobId: prepared.jobId });
  check('transcript is returned only in explicit result detail and host paths are removed', 'state' in result && result.state.status === 'complete'
    && !result.state.transcript.text.includes('C:\\Users') && result.state.transcript.audioSeconds === 3);
  const ledgerText = readFileSync(join(root, 'remote', 'commands.json'), 'utf8');
  check('durable receipts contain neither audio nor transcript text', !ledgerText.includes(audioBase64.slice(0, 100)) && !ledgerText.includes('Prüfe'));
  const prompt = { ...target, sequence: 1, cols: 80, rows: 24, text: 'Ein\nPrompt.', mode: 'submit' as const }; const promptContext = context();
  await app.remotePrompt(promptContext, prompt); const resent = await app.remotePrompt(promptContext, prompt);
  check('remote prompt reaches one atomic bracketed write and replay stays inert', resent.replayed && writes.length === 1 && writes[0] === '\x1b[200~Ein\nPrompt.\x1b[201~\r');
  await refuses('prompt cannot inject terminal escape controls', () => app.remotePrompt(context(), { ...prompt, sequence: 2, text: '\x1b[201~unsafe' }), 'invalid_payload');
  const liveTicket = await app.remoteDictation(context(), { operation: 'prepare', target }); if (!('jobId' in liveTicket)) throw new Error('no live ticket');
  const liveId = liveTicket.jobId; const startContext = context();
  await refuses('live start requires an idempotency key', () => app.remoteDictation({ ...context(), idempotencyKey: undefined }, { operation: 'stream-start', jobId: liveId }), 'idempotency_key_required');
  await app.remoteDictation(startContext, { operation: 'stream-start', jobId: liveId });
  const startReplay = await app.remoteDictation(startContext, { operation: 'stream-start', jobId: liveId });
  check('live start replay opens exactly one provider stream', 'replayed' in startReplay && startReplay.replayed && liveStarts === 1);
  await refuses('new key cannot restart a live ticket', () => app.remoteDictation(context(), { operation: 'stream-start', jobId: liveId }), 'command_rejected');
  const packet = { operation: 'stream-chunk', jobId: liveId, sequence: 0, audioBase64: Buffer.alloc(8192).toString('base64') };
  const packetContext = { ...context(), idempotencyKey: `${liveId}:0` };
  for (const extra of [{ audioBase64: 'AAAA' }, { audioBase64: 'AB==' }, { audioBase64: 'A'.repeat(24000) }, { sequence: -1 }, { provider: 'injected' }]) {
    await refuses('live packets reject malformed, odd, oversized or extra data', () => app.remoteDictation(packetContext, { ...packet, ...extra }), 'invalid_payload');
  }
  await refuses('live packet requires its job/sequence key', () => app.remoteDictation(context(), packet), 'idempotency_key_invalid');
  await refuses('live packet cannot cross device identities', () => app.remoteDictation({ ...context('other'), idempotencyKey: `${liveId}:0` }, packet), 'command_rejected');
  const receiptsBefore = readFileSync(join(root, 'remote', 'commands.json'), 'utf8');
  await app.remoteDictation(packetContext, packet);
  const replayPacket = await app.remoteDictation(packetContext, packet);
  check('duplicate live packet is acknowledged without forwarding audio twice', 'replayed' in replayPacket && replayPacket.replayed && livePackets === 1);
  await refuses('same live packet cannot change audio', () => app.remoteDictation(packetContext, { ...packet, audioBase64: Buffer.alloc(8192, 1).toString('base64') }), 'command_rejected');
  await refuses('live packets cannot skip a sequence', () => app.remoteDictation({ ...context(), idempotencyKey: `${liveId}:2` }, { ...packet, sequence: 2 }), 'command_rejected');
  for (let sequence = 1; sequence < LIVE_DICTATION_MAX_PACKETS; sequence++) await app.remoteDictation({ ...context(), idempotencyKey: `${liveId}:${sequence}` }, { ...packet, sequence });
  check('five minutes of audio do not fill durable command receipts', readFileSync(join(root, 'remote', 'commands.json'), 'utf8') === receiptsBefore && livePackets === LIVE_DICTATION_MAX_PACKETS);
  await refuses('remote packet sequence stays bounded at the new limit', () => app.remoteDictation({ ...context(), idempotencyKey: `${liveId}:${LIVE_DICTATION_MAX_PACKETS}` }, { ...packet, sequence: LIVE_DICTATION_MAX_PACKETS }), 'invalid_payload');
  const partial = await app.remoteDictation(context(), { operation: 'query', jobId: liveId });
  check('live previews are private result details with host paths removed', 'state' in partial && partial.state.status === 'recording' && partial.state.text.includes('Live') && !partial.state.text.includes('C:\\Users'));
  const finishContext = context();
  await app.remoteDictation(finishContext, { operation: 'stream-finish', jobId: liveId });
  await app.remoteDictation(finishContext, { operation: 'stream-finish', jobId: liveId });
  await new Promise(done => setImmediate(done));
  const liveResult = await app.remoteDictation(context(), { operation: 'query', jobId: liveId });
  check('live finish commits once and returns confirmed text without executing it', liveFinishes === 1 && writes.length === 1 && 'state' in liveResult && liveResult.state.status === 'complete' && liveResult.state.transcript.model === 'scribe_v2_realtime');
  const liveRecords = readFileSync(join(root, 'remote', 'commands.json'), 'utf8') + readFileSync(join(root, 'remote', 'audit.jsonl'), 'utf8');
  check('live receipts and audit contain no audio or transcript bodies', !liveRecords.includes(packet.audioBase64.slice(0, 100)) && !liveRecords.includes('Live abgeschlossen') && !liveRecords.includes('file.ts'));
  available = false;
  await refuses('ended CLI refuses new recording before billing', () => app.remoteDictation(context(), { operation: 'prepare', target }), 'command_rejected');
  available = true;
  const cancelled = await app.remoteDictation(context(), { operation: 'prepare', target }); if (!('jobId' in cancelled)) throw new Error('no ticket');
  await app.remoteDictation(context(), { operation: 'cancel', jobId: cancelled.jobId });
  await refuses('cancelled recording cannot be submitted later', () => app.remoteDictation(context(), { jobId: cancelled.jobId, audioBase64 }, true), 'command_rejected');

  server = new HostApiServer(app, { authorizer: new RemoteAuthorizer('t'.repeat(32), [], undefined, devices), port: 0 });
  const address = await server.start();
  const post = async (path: string, body: object, key: string = randomUUID()) => {
    const serialized = JSON.stringify(body); const timestamp = String(Date.now());
    return fetch(`http://127.0.0.1:${address.port}${path}`, { method: 'POST', headers: { authorization: `Bearer ${'t'.repeat(32)}`, 'content-type': 'application/json',
      'x-ade-device': 'tablet', 'x-ade-timestamp': timestamp, 'idempotency-key': key,
      'x-ade-signature': signRequest(secret, { method: 'POST', path, timestamp, idempotencyKey: key, bodySha256: sha256Hex(serialized) }) }, body: serialized });
  };
  const httpPrepared = await (await post('/api/v1/dictation/command', { operation: 'prepare', target })).json() as { jobId: string };
  const httpUpload = await post('/api/v1/dictation/upload', { jobId: httpPrepared.jobId, audioBase64 });
  check('signed HTTP audio upload accepts WAV larger than ordinary JSON limit', httpUpload.status === 200 && audioBase64.length > 64 * 1024);
  check('ordinary terminal endpoint retains 64 KiB limit', (await post('/api/v1/terminal/input', { data: audioBase64 })).status === 413);
  let oversizedRefused = false;
  try { oversizedRefused = (await post('/api/v1/dictation/upload', { jobId: httpPrepared.jobId, audioBase64: 'A'.repeat(2_600_000) })).status === 413; }
  catch (error) { oversizedRefused = (error as { cause?: { code?: string } }).cause?.code === 'ECONNRESET'; }
  check('audio endpoint rejects oversized body with 413 or deliberate connection close', oversizedRefused);
  check('audio endpoint rejects invalid PCM envelope', (await post('/api/v1/dictation/upload', { jobId: httpPrepared.jobId, audioBase64: 'A'.repeat(4400) })).status === 422);
  const httpLive = await (await post('/api/v1/dictation/command', { operation: 'prepare', target })).json() as { jobId: string };
  check('signed HTTP starts a live stream', (await post('/api/v1/dictation/command', { operation: 'stream-start', jobId: httpLive.jobId })).status === 200);
  check('signed HTTP accepts a bounded live packet', (await post('/api/v1/dictation/command', { ...packet, jobId: httpLive.jobId }, `${httpLive.jobId}:0`)).status === 200);
  devices.setAdminScopes('tablet', ['terminal:control']);
  await refuses('revoked dictation scope closes live reads', () => app.remoteDictation(context(), { operation: 'query', jobId: httpLive.jobId }), 'scope_not_granted');
  devices.setAdminScopes('tablet', [...grants]);
  await refuses('restoring permission cannot resurrect revoked audio', () => app.remoteDictation(context(), { operation: 'stream-finish', jobId: httpLive.jobId }), 'command_rejected');
  check('revocation aborts the existing live provider session', liveAborts >= 1);
  await app.remoteTerminal(context(), { ...selection, terminalId: target.terminalId, operation: 'claim' }, 'command');
  target.leaseId = ((await app.remoteTerminal(context(), { ...selection, terminalId: target.terminalId }, 'query')) as MobileTerminalState).leaseId!;
  const waiting = await app.remoteDictation(context(), { operation: 'prepare', target }); if (!('jobId' in waiting)) throw new Error('no ticket');
  terminal.reclaim(sessions[0]!.id);
  await refuses('desktop takeover invalidates prepared mobile audio', () => app.remoteDictation(context(), { jobId: waiting.jobId, audioBase64 }, true), 'command_rejected');
  check('negative controls did not bill again or send another prompt', providerCalls === 2 && writes.length === 1);
  console.log(`Remote dictation: ${passed} passed, 0 failed`);
})().catch(error => { console.error(error); console.log(`Remote dictation: ${passed} passed, 1 failed`); process.exitCode = 1; })
  .finally(async () => { await server?.stop(); jobs?.dispose(); terminal?.dispose();
    if (dirname(root) !== realpathSync.native(tmpdir()) || !root.includes('ade-remote-dictation-')) throw new Error('Unexpected dictation fixture path');
    rmSync(root, { recursive: true, force: true });
  });
