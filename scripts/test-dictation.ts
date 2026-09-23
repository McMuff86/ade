import { DictationService, validateDictationAudio } from '../src/main/settings/DictationService';
import { encodeDictationPcm } from '../src/shared/dictationAudio';
import { DICTATION_MAX_AUDIO_BYTES, DICTATION_SAMPLE_RATE, validPromptText } from '../src/shared/dictation';

let passed = 0;
function check(name: string, ok: boolean) { if (!ok) throw new Error(name); passed++; console.log(`  ok ${name}`); }
async function refuses(name: string, operation: () => unknown, reason: RegExp) {
  try { await operation(); } catch (error) {
    check(name, reason.test(String(error)) && !String(error).includes('private-provider-detail')); return;
  }
  throw new Error(`${name}: unexpectedly allowed`);
}

void (async () => {
  const audio = encodeDictationPcm(new Float32Array(DICTATION_SAMPLE_RATE));
  check('host derives duration from validated PCM bytes', validateDictationAudio(audio) === 1);
  const extrema = new Float32Array(DICTATION_SAMPLE_RATE / 10); extrema[0] = -1; extrema[1] = 1;
  const encoded = encodeDictationPcm(extrema); const view = new DataView(encoded.buffer);
  check('encoder preserves signed PCM extrema and minimum duration', view.getInt16(44, true) === -32768
    && view.getInt16(46, true) === 32767 && validateDictationAudio(encoded) === 0.1);
  for (const [name, position] of [['RIFF size', 4], ['PCM format', 20], ['channel count', 22], ['sample rate', 24], ['byte rate', 28], ['alignment', 32], ['bit depth', 34], ['data size', 40]] as const) {
    const damaged = audio.slice(); damaged[position] ^= 1;
    await refuses(`host refuses altered ${name}`, () => validateDictationAudio(damaged), /Audioformat/);
  }
  await refuses('oversized recording cannot make a paid request', () => validateDictationAudio(new Uint8Array(DICTATION_MAX_AUDIO_BYTES + 1)), /60 Sekunden/);
  await refuses('extra WAV chunks are refused', () => validateDictationAudio(new Uint8Array([...audio, 0, 0])), /Audioformat/);
  await refuses('empty recording is refused', () => encodeDictationPcm(new Float32Array()), /0,1/);
  await refuses('NaN samples are refused', () => encodeDictationPcm(new Float32Array(1600).fill(NaN)), /Audiodaten/);
  check('multiline Unicode prompt survives without terminal escapes', validPromptText('Prüfe die Änderung.\nDann teste sie.\tÄ') && !validPromptText('\x1b[200~text')
    && !validPromptText('\x9b[200~text') && !validPromptText('   ') && !validPromptText('a'.repeat(12001)));

  let requests = 0; let response: () => Response = () => Response.json({ text: 'Prüfe die Änderung.\nDann teste sie.', language_code: 'de' });
  let allowed = true; const authorize = () => { if (!allowed) throw new Error('grant revoked'); };
  const fetcher: typeof fetch = async (url, init) => {
    requests++;
    if (String(url) !== 'https://api.elevenlabs.io/v1/speech-to-text' || init?.redirect !== 'error'
      || (init.headers as Record<string, string>)['xi-api-key'] !== 'private-provider-detail') throw new Error('incorrect request');
    const body = init.body as FormData;
    if (body.get('model_id') !== 'scribe_v2' || body.get('language_code') !== 'deu' || body.get('timestamps_granularity') !== 'none'
      || body.get('diarize') !== 'false' || body.get('tag_audio_events') !== 'false'
      || (body.get('file') as Blob).size !== audio.length || [...body.keys()].length !== 6) throw new Error('incorrect multipart contract');
    return response();
  };
  const service = new DictationService(() => 'private-provider-detail', fetcher);
  const transcript = await service.transcribe(audio, authorize);
  check('fixed German Scribe request returns editable text and measured audio duration', transcript.text === 'Prüfe die Änderung.\nDann teste sie.'
    && transcript.language === 'de' && transcript.model === 'scribe_v2' && transcript.audioSeconds === 1 && requests === 1);
  allowed = false;
  await refuses('revoked grant refuses before network', () => service.transcribe(audio, authorize), /revoked/);
  check('denied request has no provider side effect', requests === 1); allowed = true;
  await refuses('missing key refuses before network', () => new DictationService(() => undefined, fetcher).transcribe(audio, authorize), /Key fehlt/);
  for (const status of [401, 403, 429, 500]) {
    response = () => new Response('private-provider-detail', { status });
    await refuses(`HTTP ${status} exposes only a fixed error`, () => service.transcribe(audio, authorize), /ElevenLabs|HTTP/);
  }
  response = () => new Response('private-provider-detail', { headers: { 'content-type': 'text/html' } });
  await refuses('HTML diagnostic is never a transcript', () => service.transcribe(audio, authorize), /gültiges Transkript/);
  response = () => new Response('private-provider-detail', { headers: { 'content-type': 'application/json' } });
  await refuses('malformed JSON is refused without provider body', () => service.transcribe(audio, authorize), /gültiges Transkript/);
  response = () => new Response('x'.repeat(128 * 1024 + 1), { headers: { 'content-type': 'application/json' } });
  await refuses('response stream is bounded', () => service.transcribe(audio, authorize), /zu gross/);
  response = () => Response.json({ text: '\x1b[31munsafe' });
  await refuses('provider terminal controls never become a draft', () => service.transcribe(audio, authorize), /Steuerzeichen/);
  response = () => Response.json({ text: 'x'.repeat(12001) });
  await refuses('transcript length is independently bounded', () => service.transcribe(audio, authorize), /zu lang/);
  response = () => { allowed = false; return Response.json({ text: 'private transcript' }); };
  await refuses('revocation during provider response hides transcript', () => service.transcribe(audio, authorize), /revoked/); allowed = true;
  const cancelled = new AbortController(); cancelled.abort(); const before = requests;
  await refuses('cancel before send has no provider effect', () => service.transcribe(audio, authorize, cancelled.signal), /abgebrochen/);
  check('cancelled recording was not submitted', requests === before);
  response = () => { cancelled.abort(); return Response.json({ text: 'not returned' }); };
  const during = new AbortController(); response = () => { during.abort(); return Response.json({ text: 'not returned' }); };
  await refuses('cancel during response does not return text', () => service.transcribe(audio, authorize, during.signal), /abgebrochen/);
  let release!: () => void;
  const slow = new DictationService(() => 'key', async () => { await new Promise<void>(done => { release = done; }); return Response.json({ text: 'fertig' }); });
  const pending = slow.transcribe(audio, authorize);
  await refuses('one active provider request prevents duplicate parallel generation', () => slow.transcribe(audio, authorize), /bereits/);
  release(); await pending;
  response = () => Response.json({ text: '', language_code: 'untrusted/path' });
  const silence = await service.transcribe(audio, authorize);
  check('silence stays empty and unknown language remains unknown', silence.text === '' && silence.language === null);
  response = () => Response.json({ text: 'Abschlusskontrolle', language_code: 'de' });
  check('final positive control succeeds after all rejections', (await service.transcribe(audio, authorize)).text === 'Abschlusskontrolle');
  console.log(`Dictation: ${passed} passed, 0 failed`);
})().catch(error => { console.error(error); console.log(`Dictation: ${passed} passed, 1 failed`); process.exitCode = 1; });
