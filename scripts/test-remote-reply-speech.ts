import { ReplySpeechService } from '../src/main/settings/ReplySpeechService';
import { FixtureSpeechService as SpeechService } from './helpers/speechSocket';
import { SpeechPreferences } from '../src/main/settings/SpeechPreferences';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { RemoteTerminalService } from '../src/main/application/RemoteTerminalService';
import { DeviceResourceService } from '../src/main/application/DeviceResourceService';
import { AdeApplicationService, RemoteApiError, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import { HostRestartController } from '../src/main/application/HostRestartController';

let passed = 0; let terminal: RemoteTerminalService | undefined; let replies: ReplySpeechService | undefined;
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-remote-reply-')));
const check = (name: string, ok: boolean) => { if (!ok) throw new Error(name); passed++; console.log(`  ok ${name}`); };
async function refuses(name: string, action: () => unknown, code: string) {
  try { await action(); } catch (error) { check(name, error instanceof RemoteApiError && error.code === code); return; }
  throw new Error(`${name}: unexpectedly accepted`);
}
void (async () => {
  const fixture = createRemoteWorkspaceFixture(root); const { store, devices, sessions, workbench, ledger, gate } = fixture;
  const secret = 'd'.repeat(40); devices.enroll('tablet', 'Tablet', secret); devices.enroll('other', 'Other', 'e'.repeat(40));
  const grants = ['catalog:write', 'workspace:read', 'terminal:control', 'speech:control'] as const;
  devices.setAdminScopes('tablet', [...grants]); devices.setAdminScopes('other', [...grants]);
  const context = (id = 'tablet'): RemoteCommandContext => ({ principal: { id, kind: 'device', proof: 'device-signature',
    scopes: new Set(devices.activeDevices().find(item => item.id === id)!.scopes) }, idempotencyKey: randomUUID(), requestId: 'dictation-test' });
  const repo = (await fixture.application.administer(context(), { operation: 'project-create', input: { name: 'Reading' } })).created!.id;
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
    writePrompt: (_id, text) => { if (!available) throw new Error('CLI ended'); writes.push(typeof text === 'string' ? text : text.join('')); },
  }, id => devices.activeDevices().some(item => item.id === id && item.scopes.includes('terminal:control')),
  entry => devices.audit(entry), undefined, undefined, (id, target) => resources.assertSelection(id, target));
  const speech = new SpeechService(store, () => 'provider-fixture-secret', async url => {
    if (String(url).endsWith('/voices')) return Response.json({ voices: [{ voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', labels: { gender: 'female' } }] });
    providerCalls++; return new Response(new Uint8Array(512), { headers: { 'content-type': 'audio/mpeg' } });
  });
  replies = new ReplySpeechService(speech, new SpeechPreferences(store, speech));
  devices.onRevoked(id => { terminal!.revoke(id); if (id === null) replies!.revoke(); else replies!.revoke(`device:${id}`); });
  const app = new AdeApplicationService(store, fixture.orchestration, { status: () => ({ active: 0, queued: 0, maxActive: 4 }) }, {
    resourceAccess: id => devices.resourceAccess(id), workbench, terminals: terminal, replies, audit: entry => devices.audit(entry),
    administration: { ledger, restart: new HostRestartController(gate, () => [], () => {}, 'fixture', true) },
  });
  const opened = await app.remoteTerminal(context(), { ...selection, operation: 'open', mode: 'codex' }, 'command') as { terminalId: string };
  const target = { ...selection, terminalId: opened.terminalId };
  const input = { operation: 'prepare', target, text: 'Die Antwort ist noch nicht fertig. Bitte pruefen.', source: 'selection', mode: 'full' };
  for (const payload of [{ ...input, command: 'injected' }, { ...input, target: { ...target, leaseId: 'unused' } }, { ...input, source: 'last-answer' }, { ...input, text: 'a'.repeat(12001) }]) {
    await refuses('strict preparation rejects extras, lease IDs, invented sources and oversize text', () => app.terminalSpeech(context(), payload), 'invalid_payload');
  }
  await refuses('unsigned bearer cannot prepare speech', () => app.terminalSpeech({ ...context(), principal: { ...context().principal, kind: 'bootstrap-token', proof: 'bearer' } }, input), 'device_proof_required');
  await refuses('preparation requires an idempotency key', () => app.terminalSpeech({ ...context(), idempotencyKey: undefined }, input), 'idempotency_key_required');
  devices.setAdminScopes('tablet', ['terminal:control', 'workspace:read']);
  await refuses('terminal access alone cannot prepare speech', () => app.terminalSpeech(context(), input), 'scope_not_granted');
  devices.setAdminScopes('tablet', [...grants]);
  const prepareContext = context();
  const prepared = await app.terminalSpeech(prepareContext, input); const id = prepared.replyId!;
  const replay = await app.terminalSpeech(prepareContext, input);
  check('preparation replay preserves the receipt without invoking a provider', replay.replayed === true && replay.replyId === id && providerCalls === 0);
  await refuses('prepare key is bound to source text', () => app.terminalSpeech(prepareContext, { ...input, text: 'Changed' }), 'idempotency_key_reused');
  await refuses('another device cannot read the receipt', () => app.terminalSpeech(context('other'), { operation: 'read', replyId: id }), 'command_rejected');
  await refuses('another device cannot synthesize the receipt', () => app.terminalSpeech(context('other'), { operation: 'speak', replyId: id }), 'command_rejected');
  await app.terminalSpeech(context('other'), { operation: 'cancel', replyId: id });
  const read = await app.terminalSpeech({ ...context(), idempotencyKey: undefined }, { operation: 'read', replyId: id });
  check('authorized read needs no mutation key and foreign cancel is inert', read.preview?.text === input.text);
  terminal.reclaim(sessions[0]!.id);
  const speakContext = context();
  await app.terminalSpeech(speakContext, { operation: 'speak', replyId: id });
  const spokenAgain = await app.terminalSpeech(speakContext, { operation: 'speak', replyId: id });
  await app.terminalSpeech(context(), { operation: 'speak', replyId: id });
  check('reading works with desktop keyboard ownership and synthesizes once across retries', spokenAgain.replayed === true && providerCalls === 1 && writes.length === 0);
  await refuses('speak key cannot cross to cancellation', () => app.terminalSpeech(speakContext, { operation: 'cancel', replyId: id }), 'idempotency_key_reused');
  const result = await app.terminalSpeech(context(), { operation: 'read', replyId: id });
  check('audio matches the preview and is returned only by explicit read', result.audio?.text === input.text && result.audio.mimeType === 'audio/mpeg' && Object.keys(spokenAgain).sort().join() === 'replayed,replyId');
  const durable = readFileSync(join(root, 'remote', 'commands.json'), 'utf8');
  check('ledger persists no source, preview or MP3 payload', !durable.includes(input.text) && !durable.includes('audio/mpeg') && !durable.includes('base64'));
  sessions[0]!.status = 'exited';
  await refuses('terminal exit blocks cached audio reads', () => app.terminalSpeech(context(), { operation: 'read', replyId: id }), 'command_rejected');
  sessions[0]!.status = 'running';
  devices.setAdminScopes('tablet', ['terminal:control']);
  await refuses('scope revocation blocks existing audio', () => app.terminalSpeech(context(), { operation: 'read', replyId: id }), 'scope_not_granted');
  devices.setAdminScopes('tablet', [...grants]);
  await refuses('restoring a grant cannot resurrect a revoked receipt', () => app.terminalSpeech(context(), { operation: 'read', replyId: id }), 'command_rejected');
  // Open a fresh selected terminal after revocation removed its remote entry.
  const finalOpen = await app.remoteTerminal(context(), { ...selection, operation: 'open', mode: 'codex' }, 'command') as { terminalId: string };
  const final = await app.terminalSpeech(context(), { ...input, target: { ...target, terminalId: finalOpen.terminalId } });
  await app.terminalSpeech(context(), { operation: 'speak', replyId: final.replyId });
  check('final positive control after negative authorization checks', (await app.terminalSpeech(context(), { operation: 'read', replyId: final.replyId })).audio?.text === input.text && providerCalls === 2 && writes.length === 0);
  await replies.dispose(); terminal.dispose();
  console.log(`Remote reply speech: ${passed} passed, 0 failed`);
})().catch(error => { console.error(error); console.log(`Remote reply speech: ${passed} passed, 1 failed`); process.exitCode = 1; })
  .finally(async () => { await replies?.dispose(); terminal?.dispose();
    if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected fixture root'); rmSync(root, { recursive: true, force: true }); });
