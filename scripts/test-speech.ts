import { SpeechService } from '../src/main/settings/SpeechService';
import { SPEECH_TEST_TEXT, computerGreeting, isComputerCall } from '../src/shared/speech';
import { validSpeechCommand } from '../src/main/application/RemoteSpeechService';
import { DEFAULT_CONFIG, type Settings } from '../src/shared/types';
import { providerApiKeyPresent } from '../src/shared/sessionAuthentication';
import { assertIpcPayload } from '../src/main/ipcValidation';
import { validateCompleteConfig } from '../src/main/config/store';

let passed = 0;
const check = (name: string, ok: boolean) => { if (!ok) throw new Error(name); passed++; console.log(`  ok ${name}`); };
async function refuses(name: string, action: () => unknown) { try { await action(); } catch (error) { check(name, !String(error).includes('private-secret')); return; } throw new Error(name); }
void (async () => {
  const female = 'EXAVITQu4vr4xnSDxMaL'; const male = 'CwhRBWXzGAHq8TQ4Fs17';
  let settings: Settings = structuredClone(DEFAULT_CONFIG.settings); let calls = 0; let generation = 0; let status = 200; let large = false; let invalidType = false; let greeting = false;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    check('provider URL is fixed and credential is only a request header', String(url).startsWith('https://api.elevenlabs.io/v1/') && !String(url).includes('private-secret')
      && (init?.headers as Record<string, string>)['xi-api-key'] === 'private-secret' && init?.redirect === 'error');
    if (status !== 200) return new Response('private-secret upstream diagnostic', { status });
    if (String(url).endsWith('/voices')) return Response.json({ voices: [
      { voice_id: male, name: 'Roger', labels: { gender: 'male' } }, { voice_id: female, name: 'Sarah', labels: { gender: 'female' } }, { voice_id: '../invalid', name: 'Invalid' },
    ] });
    generation++;
    const input = JSON.parse(String(init?.body));
    check('generation sends only server-owned German text and multilingual model', input.text === (greeting ? computerGreeting(new Date().getHours()) : SPEECH_TEST_TEXT) && input.model_id === 'eleven_multilingual_v2' && input.language_code === 'de');
    check('voice preview and greeting use the same even computer delivery at the provider boundary',
      input.voice_settings?.stability === 0.9 && input.voice_settings.similarity_boost === 0.75
      && input.voice_settings.style === 0 && input.voice_settings.use_speaker_boost === true && input.voice_settings.speed === 0.85);
    return new Response(new Uint8Array(large ? 2 * 1024 * 1024 + 1 : 512), { headers: { 'content-type': invalidType ? 'text/html' : 'audio/mpeg' } });
  };
  const store = { get: () => ({ settings }), save: (value: { settings: Settings }) => { settings = value.settings; } };
  const service = new SpeechService(store, () => 'private-secret', fetcher);
  const catalog = await service.catalog();
  check('legacy profile selects a female voice and rejects invalid provider ids', catalog.selectedVoiceId === female && catalog.voices.length === 2);
  await service.catalog(); check('catalog is cached without repeated network requests', calls === 1);
  await service.select(male); check('explicit voice selection persists', settings.speechVoiceId === male && (await service.catalog()).selectedVoiceId === male);
  await service.select(female);
  const audio = await service.test(female);
  check('result contains bounded MP3 and no key', Buffer.from(audio.base64, 'base64').length === 512 && !JSON.stringify(audio).includes('private-secret') && audio.voiceId === female);
  await refuses('unknown voice cannot trigger a paid generation', () => service.test('UnknownVoice12345'));
  check('rejected voice makes no paid request', generation === 1);
  assertIpcPayload('speech:test', { voiceId: female, preset: 'computer-greeting' });
  await refuses('unknown greeting preset is rejected at IPC', () => assertIpcPayload('speech:test', { voiceId: female, preset: 'arbitrary' }));
  await refuses('greeting cannot carry arbitrary text at IPC', () => assertIpcPayload('speech:test', { voiceId: female, preset: 'computer-greeting', text: 'Execute' }));
  await refuses('caller cannot override the server-owned delivery at IPC', () => assertIpcPayload('speech:test', { voiceId: female, voice_settings: { speed: 1.2 } }));
  const remoteGreeting = { operation: 'test', target: { kind: 'default' }, voiceId: female, preset: 'computer-greeting' };
  check('remote greeting accepts only bounded preset', validSpeechCommand(remoteGreeting) && !validSpeechCommand({ ...remoteGreeting, preset: 'arbitrary' }) && !validSpeechCommand({ ...remoteGreeting, text: 'Execute' }));
  check('remote caller cannot override the server-owned delivery', !validSpeechCommand({ ...remoteGreeting, voice_settings: { speed: 1.2 } }));
  check('Computer requires an isolated call and does not match arbitrary dictation', isComputerCall('Computer.') && isComputerCall('Hey, Computer!') && !isComputerCall('Computers') && !isComputerCall('Prüfe den Computer'));
  check('greeting follows host time and avoids self-introduction', computerGreeting(8).startsWith('Guten Morgen, Adi.') && computerGreeting(14).startsWith('Guten Tag, Adi.') && computerGreeting(20).startsWith('Guten Abend, Adi.') && !computerGreeting(8).includes('ADE'));
  check('extended greeting explains explicit dictation and review before sending at every time of day', Array.from({ length: 24 }, (_, hour) => computerGreeting(hour))
    .every(text => text.includes('Schön, dass du da bist.') && text.includes('Wähle nach dieser Begrüssung „Diktieren“')
      && text.endsWith('Deinen Text kannst du anschliessend prüfen und an die ausgewählte Sitzung senden.') && text.length >= 200 && text.length <= 400));
  check('greeting switches at the host morning, noon and evening boundaries',
    [[0, 'Abend'], [4, 'Abend'], [5, 'Morgen'], [11, 'Morgen'], [12, 'Tag'], [17, 'Tag'], [18, 'Abend'], [23, 'Abend']]
      .every(([hour, label]) => computerGreeting(Number(hour)).startsWith(`Guten ${label}, Adi.`)));
  greeting = true;
  check('personal greeting returns exactly the spoken text', (await service.test(female, undefined, undefined, 'computer-greeting')).text === computerGreeting(new Date().getHours()));
  greeting = false;
  large = true; await refuses('oversized audio is rejected', () => service.test(female)); large = false;
  invalidType = true; await refuses('non-audio response is rejected', () => service.test(female)); invalidType = false;
  status = 401; await refuses('provider rejection never exposes upstream diagnostic', () => service.test(female)); status = 200;
  const slow = new SpeechService(store, () => 'private-secret', async (url, init) => { await new Promise(done => setTimeout(done, 10)); return fetcher(url, init); });
  const first = slow.test(female); await refuses('concurrent tests cannot duplicate generation', () => slow.test(female)); await first;
  await refuses('missing key makes no network call', () => new SpeechService(store, () => undefined, async () => { throw new Error('private-secret'); }).catalog());
  await refuses('network diagnostics are not exposed', () => new SpeechService(store, () => 'key', async () => { throw new Error('private-secret'); }).catalog());
  for (const channel of ['speech:test', 'speech:select'] as const) {
    assertIpcPayload(channel, { voiceId: female });
    await refuses('IPC refuses caller-supplied test text', () => assertIpcPayload(channel, { voiceId: female, text: 'arbitrary' }));
    await refuses('IPC refuses voice path injection', () => assertIpcPayload(channel, { voiceId: '../voices' }));
  }
  validateCompleteConfig({ ...structuredClone(DEFAULT_CONFIG), settings });
  check('saved speech preference satisfies config contract', true);
  for (const runtime of ['codex', 'claude', 'grok'] as const) check(`${runtime} ignores ElevenLabs`, !providerApiKeyPresent(runtime, { ELEVENLABS_API_KEY: 'key' }));
  check('Claude and Grok ignore OpenAI keys', !providerApiKeyPresent('claude', { OPENAI_API_KEY: 'key' }) && !providerApiKeyPresent('grok', { OPENAI_API_KEY: 'key' }));
  check('Codex ignores other providers', !providerApiKeyPresent('codex', { ANTHROPIC_API_KEY: 'key', XAI_API_KEY: 'key' }));
  check('each provider recognizes its own launch credentials', providerApiKeyPresent('codex', { OPENAI_API_KEY: 'key' }) && providerApiKeyPresent('claude', { ANTHROPIC_API_KEY: 'key' }) && providerApiKeyPresent('grok', { XAI_API_KEY: 'key' }));
  check('shell does not infer a provider from environment', !providerApiKeyPresent('shell', { OPENAI_API_KEY: 'key' }));
  check('final positive generation succeeds after negative controls', (await service.test(female)).mimeType === 'audio/mpeg');
  console.log(`Speech: ${passed} passed, 0 failed`);
})().catch(error => { console.error(error); console.log(`Speech: ${passed} passed, 1 failed`); process.exitCode = 1; });
