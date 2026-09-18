import { dialogueAudio, speechPronunciation } from '../src/main/settings/ElevenDialogue';
import { DEFAULT_SPEECH_TUNING } from '../src/shared/speech';
let passed = 0;
const check = (name: string, ok: boolean) => { if (!ok) throw Error(name); passed++; console.log(`  ok ${name}`); };
class Peer extends EventTarget {
  readyState = 0; frames: Record<string, any>[] = []; closed = false;
  send(raw: string) { this.frames.push(JSON.parse(raw)); }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  message(value: unknown) { this.raw(JSON.stringify(value)); }
  raw(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data })); }
  close() { this.closed = true; this.readyState = 3; this.dispatchEvent(new Event('close')); }
}
const base = { key: 'private-dialogue-secret', voiceId: 'EXAVITQu4vr4xnSDxMaL', text: 'Hallo "/ˈadi/".', tuning: DEFAULT_SPEECH_TUNING, authorize: () => {}, dispatched: () => {} };
const start = (options: Partial<Parameters<typeof dialogueAudio>[0]> = {}) => {
  const peer = new Peer(); let url = ''; let sent = 0;
  const promise = dialogueAudio({ ...base, dispatched: () => { sent++; }, connect: value => { url = value; return peer as unknown as WebSocket; }, ...options });
  void promise.catch(() => {});
  return { peer, promise, url, sent: () => sent };
};
const audio = Buffer.alloc(256, 1);
async function refuses(name: string, value: ReturnType<typeof start>) {
  let error: unknown; try { await value.promise; } catch (failure) { error = failure; }
  check(name, error instanceof Error && !error.message.includes('private-dialogue-secret') && !error.message.includes('C:\\Users') && value.peer.closed);
}
void (async () => {
  const normal = start(); const url = new URL(normal.url);
  check('fixed v3 dialogue endpoint and German MP3 format, no key in URL', url.origin === 'wss://api.elevenlabs.io' && url.pathname === '/v1/text-to-dialogue/stream-input'
    && url.searchParams.get('model_id') === 'eleven_v3' && url.searchParams.get('language_code') === 'de' && url.searchParams.get('output_format') === 'mp3_44100_128' && !normal.url.includes(base.key));
  check('no billable input before the connection opens', normal.sent() === 0 && normal.peer.frames.length === 0);
  normal.peer.open(); const [init, input, close] = normal.peer.frames;
  check('initial frame registers the selected voice and authenticates only once', init?.voices[0] === base.voiceId && init?.xi_api_key === base.key && !JSON.stringify(normal.peer.frames.slice(1)).includes(base.key));
  check('TTD receives only its supported stability parameter', JSON.stringify(init?.voice_settings) === '{"stability":0.9}');
  check('one authorized input and explicit flush-close are dispatched', normal.sent() === 1 && input?.inputs[0].text === base.text && input.inputs[0].voice_id === base.voiceId && close?.close_socket === true);
  normal.peer.message({ audio: audio.subarray(0, 128).toString('base64') });
  normal.peer.message({ is_final_audio_for_turn: true });
  check('turn boundary does not truncate the remaining MP3 encoder output', !normal.peer.closed);
  normal.peer.message({ audio: audio.subarray(128).toString('base64'), is_final: true });
  check('all chunks resolve once and close the socket after final receipt', (await normal.promise).equals(audio) && normal.peer.closed);
  normal.peer.message({ error: base.key });
  check('late provider events cannot replace successful audio', (await normal.promise).equals(audio));
  for (const [name, event] of [
    ['provider error', { error: `private-dialogue-secret C:\\Users\\Private` }], ['array frame', []], ['null frame', null],
    ['invalid audio type', { audio: 12 }], ['invalid base64', { audio: 'invalid@@' }], ['empty final', { is_final: true }],
    ['short audio', { audio: Buffer.alloc(99).toString('base64'), is_final: true }],
  ] as const) {
    const item = start(); item.peer.open(); item.peer.message(event); await refuses(`${name} fails closed without upstream diagnostics`, item);
  }
  const malformed = start(); malformed.peer.open(); malformed.peer.raw('{'); await refuses('invalid JSON is bounded', malformed);
  const binary = start(); binary.peer.open(); binary.peer.raw(new Uint8Array(8)); await refuses('unexpected binary frames are rejected', binary);
  const oversized = start(); oversized.peer.open(); oversized.peer.raw('x'.repeat(3 * 1024 * 1024)); await refuses('oversized frame is rejected before parsing', oversized);
  const accumulated = start(); accumulated.peer.open(); const chunk = Buffer.alloc(1024 * 1024).toString('base64');
  accumulated.peer.message({ audio: chunk }); accumulated.peer.message({ audio: chunk }); accumulated.peer.message({ audio: audio.toString('base64') });
  await refuses('aggregate audio limit spans multiple valid frames', accumulated);
  const lost = start(); lost.peer.open(); lost.peer.message({ audio: audio.toString('base64') }); lost.peer.close(); await refuses('close without final receipt never returns partial audio', lost);
  check('lost receipt does not replay billable input', lost.sent() === 1);
  const network = start(); network.peer.open(); network.peer.dispatchEvent(new Event('error')); await refuses('socket error closes the session', network);
  const timeout = start({ timeoutMs: 15 }); await refuses('connection timeout is bounded before input', timeout); check('timeout sent no input', timeout.sent() === 0);
  const controller = new AbortController(); const cancel = start({ signal: controller.signal }); cancel.peer.open(); controller.abort(); await refuses('abort closes the active provider session', cancel);
  let connections = 0;
  try { await dialogueAudio({ ...base, signal: AbortSignal.abort(), connect: () => { connections++; return new Peer() as unknown as WebSocket; } }); } catch {}
  check('already aborted action never opens a socket', connections === 0);
  let allowed = true; const revoked = start({ authorize: () => { if (!allowed) throw Error('private-dialogue-secret'); } });
  allowed = false; revoked.peer.open(); await refuses('revocation while connecting prevents text dispatch', revoked); check('revocation dispatched no text', revoked.sent() === 0);
  allowed = true; const late = start({ authorize: () => { if (!allowed) throw Error('private-dialogue-secret'); } });
  late.peer.open(); allowed = false; late.peer.message({ audio: audio.toString('base64'), is_final: true });
  await refuses('revocation before the final receipt rejects audio', late);
  check('short-A phonetics target only the whole name', speechPronunciation('Hallo Adi, Adi! Adile Adi2 xAdi _Adi ÄAdi Adié.') === 'Hallo "/ˈadi/", "/ˈadi/"! Adile Adi2 xAdi _Adi ÄAdi Adié.');
  check('ordinary answers do not inherit the voice-check Agent override', speechPronunciation('Dein Agent meldet: Die Datei ist fertig.') === 'Dein Agent meldet: Die Datei ist fertig.');
  const final = start(); final.peer.open(); final.peer.message({ audio: audio.toString('base64'), is_final: true });
  check('final positive control still completes', (await final.promise).length === 256);
  console.log(`Eleven dialogue: ${passed} passed, 0 failed`);
})().catch(error => { console.error(error); console.log(`Eleven dialogue: ${passed} passed, 1 failed`); process.exitCode = 1; });
