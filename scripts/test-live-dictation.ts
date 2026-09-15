import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { openLiveDictation } from '../src/main/settings/LiveDictationService';
import { DictationJobs } from '../src/main/settings/DictationJobs';
import { SpeechUsageService } from '../src/main/usage/SpeechUsageService';
import { UsageJournal } from '../src/main/usage/UsageJournal';
import { NativeUsageService } from '../src/main/usage/NativeUsageService';
import { assertIpcPayload } from '../src/main/ipcValidation';
import { validLiveDictationChunk } from '../src/shared/liveDictation';
import { CHANNEL_POLICY } from '../src/main/ipcPolicy';

let passed = 0;
const check = (name: string, ok: boolean) => { if (!ok) throw new Error(name); passed++; console.log(`  ok ${name}`); };
async function refuses(name: string, action: () => unknown, reason: RegExp) {
  try { await action(); } catch (error) { check(name, reason.test(String(error)) && !String(error).includes('private-fixture')); return; }
  throw new Error(`${name}: unexpectedly accepted`);
}
const tick = () => new Promise<void>(done => setImmediate(done));
class Socket extends EventTarget {
  readyState = 1; bufferedAmount = 0; sent: Array<{ audio_base_64: string; commit?: boolean; sample_rate: number }> = [];
  constructor() { super(); setImmediate(() => this.message({ message_type: 'session_started' })); }
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  message(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
}
const root = mkdtempSync(join(tmpdir(), 'ade-live-dictation-'));
let journal = new UsageJournal(join(root, 'usage.jsonl'));
void (async () => {
  const jobId = '00000000-0000-0000-0000-000000000001';
  const packet = { jobId, sequence: 0, audioBase64: Buffer.alloc(8192).toString('base64') };
  check('stream chunk has an exact bounded IPC contract', validLiveDictationChunk(packet));
  for (const mutation of [{ sequence: -1 }, { sequence: 1.2 }, { sequence: 1000 }, { audioBase64: '' }, { audioBase64: 'a'.repeat(24000) }, { extra: true }, { jobId: 'wrong' }]) {
    await refuses('invalid live chunk is rejected at IPC', () => assertIpcPayload('dictation:streamChunk', { ...packet, ...mutation }), /invalid live dictation chunk/);
  }
  for (const channel of ['dictation:streamStart', 'dictation:streamChunk', 'dictation:streamFinish'] as const) {
    check(`${channel} stays confined to desktop host operations`, CHANNEL_POLICY[channel].surface === 'desktop' && CHANNEL_POLICY[channel].effect === 'host');
  }
  let socket!: Socket; let endpoint = ''; let tokenRequests = 0; let allowed = true; const previews: string[] = [];
  const controller = new AbortController();
  const options = {
    key: 'private-fixture-key', authorize: () => { if (!allowed) throw new Error('revoked'); }, signal: controller.signal,
    preview: (text: string) => previews.push(text), attribution: { terminalSessionId: 'live-target' }, usage: new SpeechUsageService(journal),
    fetcher: (async (url, init) => {
      check('token request stays on fixed endpoint with main-owned credential', String(url) === 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe'
        && (init?.headers as Record<string, string>)['xi-api-key'] === 'private-fixture-key' && init?.redirect === 'error');
      tokenRequests++; return Response.json({ token: 'private-fixture-token' });
    }) as typeof fetch,
    connect: (url: string) => { endpoint = url; socket = new Socket(); return socket as unknown as WebSocket; },
  };
  const live = await openLiveDictation(options);
  check('stream uses fixed model, PCM format and manual finalization', endpoint.startsWith('wss://api.elevenlabs.io/v1/speech-to-text/realtime?')
    && new URL(endpoint).searchParams.get('model_id') === 'scribe_v2_realtime' && new URL(endpoint).searchParams.get('commit_strategy') === 'manual');
  check('stream attempt is durable before audio with unknown duration and price', journal.view().facts[0]?.requestState === 'pending'
    && journal.view().facts[0]?.audioSeconds === null && journal.view().facts[0]?.costUsd === null);
  check('terminal usage marks an unfinished live duration as unknown', new NativeUsageService(journal).consumption('live-target').speech?.[0]?.unknownAmounts?.pending === 1);
  live.push(Buffer.alloc(8192)); socket.message({ message_type: 'partial_transcript', text: 'Prüfe' });
  socket.message({ message_type: 'partial_transcript', text: 'Prüfe den Code.' });
  check('partial revisions are separate previews before Stop', previews.join('|') === 'Prüfe|Prüfe den Code.' && !socket.sent.some(item => item.commit));
  await refuses('odd PCM bytes are rejected', () => live.push(Buffer.alloc(3)), /Ungültiger oder zu langer Audiostream/);
  await refuses('oversized PCM packet is rejected', () => live.push(Buffer.alloc(16002)), /Ungültiger oder zu langer Audiostream/);
  live.finish(); live.finish();
  check('Stop sends exactly one commit without a second upload', socket.sent.filter(item => item.commit).length === 1 && tokenRequests === 1);
  await refuses('audio cannot be sent after Stop', () => live.push(Buffer.alloc(8192)), /nicht mehr aufnahmebereit/);
  socket.message({ message_type: 'committed_transcript', text: 'Prüfe den Code!' });
  const final = await live.result;
  check('final result is provider-confirmed text with measured PCM duration', final.text === 'Prüfe den Code!' && final.audioSeconds === 8192 / 32000 && final.model === 'scribe_v2_realtime');
  check('socket closes on completion and records duration once', socket.readyState === 3 && journal.view().facts.length === 1
    && journal.view().facts[0]?.audioSeconds === final.audioSeconds && journal.view().facts[0]?.requestState === 'complete');
  check('usage journal contains neither transcripts nor credentials', !readFileSync(join(root, 'usage.jsonl'), 'utf8').includes('Prüfe')
    && !readFileSync(join(root, 'usage.jsonl'), 'utf8').includes('private-fixture'));
  await refuses('conflicting stream duration cannot rewrite finalized usage', () => journal.speechOutcome(journal.view().facts[0]!.id, 'complete', 59), /invalid speech outcome/);
  await journal.close(); journal = new UsageJournal(join(root, 'usage.jsonl'));
  check('stream usage duration survives replay', journal.view().facts[0]?.audioSeconds === final.audioSeconds);
  const fresh = () => ({ ...options, signal: new AbortController().signal, usage: undefined });
  const rejected = await openLiveDictation(fresh()); socket.message({ message_type: 'auth_error', error: 'private-fixture-provider-detail' });
  await refuses('provider errors are bounded and never expose upstream details', () => rejected.result, /ElevenLabs hat das Live-Diktat beendet/);
  const malformed = await openLiveDictation(fresh()); socket.message({ message_type: 'partial_transcript', text: '\x1b[31m' });
  await refuses('terminal control bytes cannot enter live previews', () => malformed.result, /kein gültiges Transkript/);
  const oversized = await openLiveDictation(fresh()); socket.message({ message_type: 'partial_transcript', text: 'x'.repeat(12001) });
  await refuses('live transcript length remains bounded', () => oversized.result, /kein gültiges Transkript/);
  const cancelledController = new AbortController(); const cancelled = await openLiveDictation({ ...fresh(), signal: cancelledController.signal });
  cancelled.push(Buffer.alloc(8192)); cancelledController.abort();
  await refuses('cancel closes an in-flight stream', () => cancelled.result, /Live-Diktat abgebrochen/);
  const previewCount = previews.length; socket.message({ message_type: 'partial_transcript', text: 'late' });
  check('late messages after cancellation are ignored', previews.length === previewCount && socket.readyState === 3);
  const bounded = await openLiveDictation(fresh()); for (let index = 0; index < 120; index++) bounded.push(Buffer.alloc(16000));
  await refuses('host enforces sixty seconds independently of the recorder timer', () => bounded.push(Buffer.alloc(2)), /Ungültiger oder zu langer Audiostream/);
  bounded.finish(); socket.message({ message_type: 'committed_transcript', text: '' }); await bounded.result;
  const slow = await openLiveDictation(fresh()); socket.bufferedAmount = 65537;
  await refuses('slow connection stops rather than accumulating unbounded audio', () => slow.push(Buffer.alloc(8192)), /Audiostream gestoppt/);
  await refuses('backpressure failure terminates the result', () => slow.result, /zu langsam verbunden/);
  const revoked = await openLiveDictation(fresh()); allowed = false;
  await refuses('changed target authorization blocks the next packet', () => revoked.push(Buffer.alloc(8192)), /revoked/);
  socket.message({ message_type: 'partial_transcript', text: 'forbidden' }); await refuses('revocation invalidates provider events', () => revoked.result, /kein gültiges Transkript/); allowed = true;

  let finishJob!: (value: typeof final) => void; let pushes = 0; let commits = 0; let previewJob!: (text: string) => void;
  const jobs = new DictationJobs({ transcribe: async () => final, startLive: async (_authorize, _signal, _usage, preview) => {
    previewJob = preview; return { result: new Promise(resolve => { finishJob = resolve; }), push: () => { pushes++; }, finish: () => { commits++; } };
  } });
  try {
    const ticket = jobs.prepare('desktop:1', () => undefined);
    await refuses('another owner cannot start the prepared live ticket', () => jobs.startLive('desktop:2', ticket.jobId), /nicht mehr verfügbar/);
    await jobs.startLive('desktop:1', ticket.jobId);
    await refuses('prepared ticket cannot open two paid streams', () => jobs.startLive('desktop:1', ticket.jobId), /nicht als Live-Diktat gestartet/);
    jobs.pushLive('desktop:1', ticket.jobId, 0, Buffer.alloc(8192));
    await refuses('duplicate stream sequence is never replayed upstream', () => jobs.pushLive('desktop:1', ticket.jobId, 0, Buffer.alloc(8192)), /Reihenfolge geändert/);
    await refuses('out-of-order audio is refused', () => jobs.pushLive('desktop:1', ticket.jobId, 2, Buffer.alloc(8192)), /Reihenfolge geändert/);
    previewJob('live draft'); const state = jobs.read('desktop:1', ticket.jobId);
    check('job query exposes only the owner-bound preview', state.status === 'recording' && state.text === 'live draft' && pushes === 1);
    jobs.finishLive('desktop:1', ticket.jobId); jobs.finishLive('desktop:1', ticket.jobId);
    check('job finish remains idempotent', commits === 1);
    jobs.cancel('desktop:1', ticket.jobId); finishJob(final); await tick();
    check('late final result cannot revive a cancelled job', jobs.read('desktop:1', ticket.jobId).status === 'cancelled');
  } finally { jobs.dispose(); }

  // Execute the actual worklet with deterministic input, including a stereo
  // downmix and the hard sample limit independent of browser timer scheduling.
  type Worklet = { port: { onmessage: (event: { data: string }) => void }; process(inputs: Float32Array[][]): boolean };
  let Processor!: new () => Worklet; const emitted: Array<{ type: string; bytes?: ArrayBuffer }> = [];
  runInNewContext(readFileSync(resolve('src/renderer/terminal/dictation-worklet.js'), 'utf8'), {
    AudioWorkletProcessor: class { port = { onmessage: () => undefined, postMessage: (message: typeof emitted[number]) => emitted.push(message) }; },
    registerProcessor: (_name: string, processor: typeof Processor) => { Processor = processor; },
  });
  const processor = new Processor(); processor.process([[new Float32Array(128).fill(1), new Float32Array(128).fill(-1)]]);
  processor.port.onmessage({ data: 'stop' });
  check('worklet flushes short final packet as little-endian mono PCM without echo', emitted[0]?.bytes?.byteLength === 256
    && new DataView(emitted[0]!.bytes!).getInt16(0, true) === 0 && emitted[1]?.type === 'end');
  emitted.length = 0; const limited = new Processor(); for (let index = 0; index < 8000; index++) limited.process([[new Float32Array(128).fill(0.5)]]);
  check('worklet enforces exactly sixty seconds and emits one completion', emitted.filter(item => item.type === 'end').length === 1
    && emitted.reduce((sum, item) => sum + (item.bytes?.byteLength ?? 0), 0) === 1_920_000);
  const positive = await openLiveDictation(fresh()); positive.push(Buffer.alloc(3200)); positive.finish();
  socket.message({ message_type: 'committed_transcript', text: 'Positive Schlusskontrolle.' });
  check('final positive stream succeeds after all negative controls', (await positive.result).text === 'Positive Schlusskontrolle.');
  console.log(`Live dictation: ${passed} passed, 0 failed`);
})().catch(error => { console.error(error); console.log(`Live dictation: ${passed} passed, 1 failed`); process.exitCode = 1; })
  .finally(async () => { await journal.close(); rmSync(root, { recursive: true, force: true }); });
