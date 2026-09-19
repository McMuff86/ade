import { t as translate } from "../../shared/i18n";
import type { Settings } from '../../shared/types';
import { DEFAULT_SPEECH_TUNING, validSpeechTuning, type SpeechTuning, speechTestText, computerGreeting, validSpeechPreset, validVoiceId, type SpeechPreset, type SpeechAudio, type SpeechCatalog, type SpeechVoice } from '../../shared/speech';
import type { SpeechUsageService, SpeechUsageAttempt, SpeechUsageAttribution } from '../usage/SpeechUsageService';
import { redactedErrorDetail } from '../errors';
import { MAX_REPLY_SPOKEN_CHARS } from '../../shared/terminalSpeech';
import { dialogueAudio, speechPronunciation, SPEECH_MODEL, type DialogueConnect } from './ElevenDialogue';
import { validVoiceStudioInput, type VoiceStudioInput } from '../../shared/speech';

interface Port { get(): { settings: Settings }; save(value: { settings: Settings }): unknown }

/** Fixed provider and bounded server-owned presets. Credentials and upstream error bodies never leave main. */
export class SpeechService {
  private busy = false;
  private cached?: { at: number; voices: SpeechVoice[] };
  private usage?: SpeechUsageService;
  setUsage(usage: SpeechUsageService): void { this.usage = usage; }
  constructor(private readonly store: Port, private readonly key: () => string | undefined, private readonly fetcher: typeof fetch = fetch, private readonly connect?: DialogueConnect) {}

  private async request(path: string, method = 'GET', body?: string, dispatch?: () => void, signal?: AbortSignal): Promise<Response> {
    const key = this.key();
    if (!key) throw new Error(translate("ElevenLabs key is missing or unavailable. Save under service keys ELEVENLABS_API_KEY for all sessions."));
    dispatch?.();
    let response: Response;
    try { response = await this.fetcher(`https://api.elevenlabs.io${path}`, { method, body,
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) }); }
    catch { throw new Error(translate("ElevenLabs is not available right now, please try again.")); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(response.status === 401 || response.status === 403 ? translate("ElevenLabs refuses access. Check key and permission for voices / text to speech.")
        : response.status === 429 ? translate("ElevenLabs limit is reached. Please try again later.") : translate("ElevenLabs request failed (HTTP {{value1}}).", { value1: response.status }));
    }
    return response;
  }

  private async bytes(response: Response, limit: number): Promise<Buffer> {
    const reader = response.body?.getReader(); if (!reader) throw new Error(translate("ElevenLabs did not provide any data."));
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const next = await reader.read(); if (next.done) break;
        size += next.value.byteLength;
        if (size > limit) { await reader.cancel(); throw new Error('limit'); } chunks.push(next.value);
      }
    } catch { throw new Error(translate("ElevenLabs response is incomplete or too large. Please try again.")); }
    return Buffer.concat(chunks);
  }

  async catalog(refresh = false): Promise<SpeechCatalog> {
    if (refresh || !this.cached || Date.now() - this.cached.at > 60_000) {
      const response = await this.request('/v1/voices');
      let body: { voices?: unknown };
      try { body = JSON.parse((await this.bytes(response, 2 * 1024 * 1024)).toString('utf8')); }
      catch { throw new Error(translate("Could not load ElevenLabs voices.")); }
      if (!Array.isArray(body.voices)) throw new Error(translate("ElevenLabs did not return a voice list."));
      const clean = (value: unknown) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 100) : '';
      const voices: SpeechVoice[] = body.voices.slice(0, 500).flatMap((item) => {
        if (!item || !validVoiceId(item.voice_id)) return [];
        return [{ id: item.voice_id, name: clean(item.name) || item.voice_id, gender: clean(item.labels?.gender), language: clean(item.labels?.language) }];
      });
      this.cached = { at: Date.now(), voices };
    }
    const { voices } = this.cached;
    const saved = this.store.get().settings.speechVoiceId;
    // Older profiles default to an available female voice; never silently replace a saved voice.
    return { voices, selectedVoiceId: saved ?? voices.find(v => v.gender === 'female')?.id ?? null };
  }

  async select(voiceId: string): Promise<void> {
    if (!validVoiceId(voiceId) || !(await this.catalog()).voices.some(v => v.id === voiceId)) throw new Error(translate("Voice is no longer available. Reload voices."));
    this.store.save({ settings: { ...this.store.get().settings, speechVoiceId: voiceId } });
  }

  async test(voiceId: string, authorize: () => void = () => undefined, attribution: SpeechUsageAttribution = {}, preset: SpeechPreset = 'voice-check', tuning?: SpeechTuning, studio?: VoiceStudioInput): Promise<SpeechAudio> {
    if (!validSpeechPreset(preset)) throw new Error(translate("Unknown speech preset."));
    if (studio !== undefined && (!validVoiceStudioInput(studio) || !validSpeechTuning(tuning) || preset !== 'voice-check')) throw new Error(translate('Invalid voice studio request.'));
    if (tuning !== undefined && (preset === 'computer-greeting' || !validSpeechTuning(tuning))) throw new Error(translate("Invalid voice parameters."));
    const delivery = { ...(tuning ?? this.store.get().settings.speechTuning ?? DEFAULT_SPEECH_TUNING) };
    if (!validSpeechTuning(delivery)) throw new Error(translate("Invalid stored voice parameters."));
    const text = studio?.text ?? (preset === 'computer-greeting' ? computerGreeting(new Date().getHours()) : speechTestText());
    return this.synthesize(voiceId, text, delivery, 'speech-test', authorize, attribution, undefined, studio);
  }

  /** Only called with the already redacted, bounded preview owned by ReplySpeechService. */
  async reply(voiceId: string, text: string, authorize: () => void, attribution: SpeechUsageAttribution, signal: AbortSignal): Promise<SpeechAudio> {
    if (!text.trim() || text.length > MAX_REPLY_SPOKEN_CHARS) throw new Error(translate("Invalid speech text."));
    const delivery = { ...(this.store.get().settings.speechTuning ?? DEFAULT_SPEECH_TUNING) };
    if (!validSpeechTuning(delivery)) throw new Error(translate("Invalid stored voice parameters."));
    return this.synthesize(voiceId, text, delivery, 'speech-reply', authorize, attribution, signal);
  }

  private async synthesize(voiceId: string, text: string, delivery: SpeechTuning, product: 'speech-test' | 'speech-reply',
    authorize: () => void, attribution: SpeechUsageAttribution, signal?: AbortSignal, studio?: VoiceStudioInput): Promise<SpeechAudio> {
    if (this.busy) throw new Error(translate("Speech output is already being prepared. Please wait briefly."));
    this.busy = true;
    let attempt: SpeechUsageAttempt | undefined; let dispatched = false;
    try {
      if (!validVoiceId(voiceId) || !(await this.catalog()).voices.some(v => v.id === voiceId)) throw new Error(translate("Select an available voice."));
      authorize();
      signal?.throwIfAborted();
      const key = this.key();
      if (!key) throw new Error(translate("ElevenLabs key is missing or unavailable. Save under service keys ELEVENLABS_API_KEY for all sessions."));
      const model = studio?.model ?? SPEECH_MODEL;
      // v3 understands inline pronunciation hints; Multilingual v2 receives plain text.
      const spoken = model === 'eleven_v3' ? speechPronunciation(text) : text;
      if (spoken.length > 12_000) throw new Error(translate("Speech text with pronunciation hints is too long. Choose a shorter text to read aloud."));
      attempt = await this.usage?.begin({ ...attribution, product, model, characters: spoken.length });
      authorize();
      signal?.throwIfAborted();
      const audio = model === 'eleven_multilingual_v2'
        ? await this.studioAudio(voiceId, spoken, delivery, authorize, () => { dispatched = true; }, signal)
        : await dialogueAudio({ key, voiceId, text: spoken, tuning: delivery, authorize, language: studio?.language,
          dispatched: () => { dispatched = true; }, signal, connect: this.connect });
      authorize(); signal?.throwIfAborted();
      await attempt?.finish('complete').catch(error => console.warn('[ade] speech usage finalization failed:', redactedErrorDetail(error)));
      return { base64: audio.toString('base64'), mimeType: 'audio/mpeg', text, voiceId };
    } catch (error) {
      await attempt?.finish(dispatched ? 'unconfirmed' : 'not-sent').catch(failure => console.warn('[ade] speech usage finalization failed:', redactedErrorDetail(failure)));
      throw error;
    } finally { this.busy = false; }
  }

  /** Per-request settings only: experimenting never changes the provider's saved voice. */
  private async studioAudio(voiceId: string, text: string, tuning: SpeechTuning, authorize: () => void, dispatched: () => void, signal?: AbortSignal): Promise<Buffer> {
    const cancellation = new AbortController();
    const monitor = setInterval(() => { try { authorize(); } catch { cancellation.abort(); } }, 500);
    const bounded = AbortSignal.any([cancellation.signal, AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
    try {
      authorize(); bounded.throwIfAborted();
      const response = await this.request(`/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, 'POST', JSON.stringify({
        text, model_id: 'eleven_multilingual_v2', voice_settings: {
          stability: tuning.stability, similarity_boost: tuning.similarityBoost, style: tuning.style,
          speed: tuning.speed, use_speaker_boost: tuning.speakerBoost,
        },
      }), dispatched, bounded);
      const audio = await this.bytes(response, 2 * 1024 * 1024);
      authorize(); bounded.throwIfAborted();
      if (audio.length < 100 || !(response.headers.get('content-type') ?? '').toLowerCase().startsWith('audio/')) throw new Error(translate('ElevenLabs did not return playable audio.'));
      return audio;
    } finally { clearInterval(monitor); cancellation.abort(); }
  }
}
