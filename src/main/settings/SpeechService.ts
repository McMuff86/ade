import type { Settings } from '../../shared/types';
import { SPEECH_TEST_TEXT, validVoiceId, type SpeechAudio, type SpeechCatalog, type SpeechVoice } from '../../shared/speech';

interface Port { get(): { settings: Settings }; save(value: { settings: Settings }): unknown }
/** Fixed provider and fixed test text. Credentials and upstream error bodies never leave main. */
export class SpeechService {
  private busy = false;
  private cached?: { at: number; voices: SpeechVoice[] };
  constructor(private readonly store: Port, private readonly key: () => string | undefined, private readonly fetcher: typeof fetch = fetch) {}

  private async request(path: string, method = 'GET', body?: string): Promise<Response> {
    const key = this.key();
    if (!key) throw new Error('ElevenLabs-Key fehlt oder ist nicht verfügbar. Unter Service-Keys ELEVENLABS_API_KEY für alle Sessions speichern.');
    let response: Response;
    try { response = await this.fetcher(`https://api.elevenlabs.io${path}`, { method, body,
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(30_000) }); }
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

  async test(voiceId: string, authorize: () => void = () => undefined): Promise<SpeechAudio> {
    if (this.busy) throw new Error('Ein Stimmtest läuft bereits. Bitte warten.');
    this.busy = true;
    try {
      if (!validVoiceId(voiceId) || !(await this.catalog()).voices.some(v => v.id === voiceId)) throw new Error('Eine verfügbare Stimme auswählen.');
      authorize();
      const response = await this.request(`/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, 'POST',
        JSON.stringify({ text: SPEECH_TEST_TEXT, model_id: 'eleven_multilingual_v2', language_code: 'de' }));
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('audio/mpeg')) { await response.body?.cancel(); throw new Error('ElevenLabs hat keine MP3-Audiodatei geliefert.'); }
      const audio = await this.bytes(response, 2 * 1024 * 1024);
      if (audio.length < 100) throw new Error('ElevenLabs-Audio ist leer oder unvollständig.');
      return { base64: audio.toString('base64'), mimeType: 'audio/mpeg', text: SPEECH_TEST_TEXT, voiceId };
    } finally { this.busy = false; }
  }
}
