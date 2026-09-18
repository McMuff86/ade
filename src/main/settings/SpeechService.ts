import type { Settings } from '../../shared/types';
import { DEFAULT_SPEECH_TUNING, validSpeechTuning, type SpeechTuning, SPEECH_TEST_TEXT, computerGreeting, validSpeechPreset, validVoiceId, type SpeechPreset, type SpeechAudio, type SpeechCatalog, type SpeechVoice } from '../../shared/speech';
import type { SpeechUsageService, SpeechUsageAttempt, SpeechUsageAttribution } from '../usage/SpeechUsageService';
import { redactedErrorDetail } from '../errors';
import { MAX_REPLY_SPOKEN_CHARS } from '../../shared/terminalSpeech';
import { dialogueAudio, speechPronunciation, SPEECH_MODEL, type DialogueConnect } from './ElevenDialogue';

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
    if (!key) throw new Error('ElevenLabs-Key fehlt oder ist nicht verfügbar. Unter Service-Keys ELEVENLABS_API_KEY für alle Sessions speichern.');
    dispatch?.();
    let response: Response;
    try { response = await this.fetcher(`https://api.elevenlabs.io${path}`, { method, body,
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) }); }
    catch { throw new Error('ElevenLabs ist gerade nicht erreichbar. Bitte erneut versuchen.'); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(response.status === 401 || response.status === 403 ? 'ElevenLabs lehnt den Zugriff ab. Key und Freigabe für Stimmen / Text to Speech prüfen.'
        : response.status === 429 ? 'ElevenLabs-Limit erreicht. Bitte später erneut versuchen.' : `ElevenLabs-Anfrage fehlgeschlagen (HTTP ${response.status}).`);
    }
    return response;
  }

  private async bytes(response: Response, limit: number): Promise<Buffer> {
    const reader = response.body?.getReader(); if (!reader) throw new Error('ElevenLabs hat keine Daten geliefert.');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const next = await reader.read(); if (next.done) break;
        size += next.value.byteLength;
        if (size > limit) { await reader.cancel(); throw new Error('limit'); } chunks.push(next.value);
      }
    } catch { throw new Error('ElevenLabs-Antwort unvollständig oder zu groß. Bitte erneut versuchen.'); }
    return Buffer.concat(chunks);
  }

  async catalog(refresh = false): Promise<SpeechCatalog> {
    if (refresh || !this.cached || Date.now() - this.cached.at > 60_000) {
      const response = await this.request('/v1/voices');
      let body: { voices?: unknown };
      try { body = JSON.parse((await this.bytes(response, 2 * 1024 * 1024)).toString('utf8')); }
      catch { throw new Error('ElevenLabs-Stimmen konnten nicht geladen werden.'); }
      if (!Array.isArray(body.voices)) throw new Error('ElevenLabs hat keine Stimmenliste geliefert.');
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
    if (!validVoiceId(voiceId) || !(await this.catalog()).voices.some(v => v.id === voiceId)) throw new Error('Stimme ist nicht mehr verfügbar. Stimmen neu laden.');
    this.store.save({ settings: { ...this.store.get().settings, speechVoiceId: voiceId } });
  }

  async test(voiceId: string, authorize: () => void = () => undefined, attribution: SpeechUsageAttribution = {}, preset: SpeechPreset = 'voice-check', tuning?: SpeechTuning): Promise<SpeechAudio> {
    if (!validSpeechPreset(preset)) throw new Error('Unbekannte Sprachvorlage.');
    if (tuning !== undefined && (preset === 'computer-greeting' || !validSpeechTuning(tuning))) throw new Error('Ungültige Stimmparameter.');
    const delivery = { ...(tuning ?? this.store.get().settings.speechTuning ?? DEFAULT_SPEECH_TUNING) };
    if (!validSpeechTuning(delivery)) throw new Error('Ungültige gespeicherte Stimmparameter.');
    const text = preset === 'computer-greeting' ? computerGreeting(new Date().getHours()) : SPEECH_TEST_TEXT;
    return this.synthesize(voiceId, text, delivery, 'speech-test', authorize, attribution);
  }

  /** Only called with the already redacted, bounded preview owned by ReplySpeechService. */
  async reply(voiceId: string, text: string, authorize: () => void, attribution: SpeechUsageAttribution, signal: AbortSignal): Promise<SpeechAudio> {
    if (!text.trim() || text.length > MAX_REPLY_SPOKEN_CHARS) throw new Error('Ungültiger Sprechtext.');
    const delivery = { ...(this.store.get().settings.speechTuning ?? DEFAULT_SPEECH_TUNING) };
    if (!validSpeechTuning(delivery)) throw new Error('Ungültige gespeicherte Stimmparameter.');
    return this.synthesize(voiceId, text, delivery, 'speech-reply', authorize, attribution, signal);
  }

  private async synthesize(voiceId: string, text: string, delivery: SpeechTuning, product: 'speech-test' | 'speech-reply',
    authorize: () => void, attribution: SpeechUsageAttribution, signal?: AbortSignal): Promise<SpeechAudio> {
    if (this.busy) throw new Error('Eine Sprachausgabe wird bereits vorbereitet. Bitte kurz warten.');
    this.busy = true;
    let attempt: SpeechUsageAttempt | undefined; let dispatched = false;
    try {
      if (!validVoiceId(voiceId) || !(await this.catalog()).voices.some(v => v.id === voiceId)) throw new Error('Eine verfügbare Stimme auswählen.');
      authorize();
      signal?.throwIfAborted();
      const key = this.key();
      if (!key) throw new Error('ElevenLabs-Key fehlt oder ist nicht verfügbar. Unter Service-Keys ELEVENLABS_API_KEY für alle Sessions speichern.');
      const spoken = speechPronunciation(text);
      if (spoken.length > 12_000) throw new Error('Sprechtext mit Aussprachevorgaben ist zu lang. Bitte kürzer vorlesen.');
      attempt = await this.usage?.begin({ ...attribution, product, model: SPEECH_MODEL, characters: spoken.length });
      authorize();
      signal?.throwIfAborted();
      const audio = await dialogueAudio({ key, voiceId, text: spoken, tuning: delivery, authorize,
        dispatched: () => { dispatched = true; }, signal, connect: this.connect });
      await attempt?.finish('complete').catch(error => console.warn('[ade] speech usage finalization failed:', redactedErrorDetail(error)));
      return { base64: audio.toString('base64'), mimeType: 'audio/mpeg', text, voiceId };
    } catch (error) {
      await attempt?.finish(dispatched ? 'unconfirmed' : 'not-sent').catch(failure => console.warn('[ade] speech usage finalization failed:', redactedErrorDetail(failure)));
      throw error;
    } finally { this.busy = false; }
  }
}
