import {
  DICTATION_MAX_AUDIO_BYTES, DICTATION_MAX_TEXT_CHARS, DICTATION_SAMPLE_RATE,
  validPromptText, type DictationTranscript,
} from '../../shared/dictation';
import type { SpeechUsageService, SpeechUsageAttempt, SpeechUsageAttribution } from '../usage/SpeechUsageService';
import { redactedErrorDetail } from '../errors';

/** Accept only the exact PCM/WAV envelope produced by ADE's recorder. No codec,
 * remote URL, filename or client-reported duration is trusted by the host. */
export function validateDictationAudio(audio: Uint8Array): number {
  if (!(audio instanceof Uint8Array) || audio.byteLength < 44 + 3200 || audio.byteLength > DICTATION_MAX_AUDIO_BYTES) {
    throw new Error('Die Aufnahme muss zwischen 0,1 und 60 Sekunden lang sein.');
  }
  const bytes = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.readUInt32LE(4) !== bytes.length - 8
    || bytes.toString('ascii', 8, 16) !== 'WAVEfmt ' || bytes.readUInt32LE(16) !== 16
    || bytes.readUInt16LE(20) !== 1 || bytes.readUInt16LE(22) !== 1
    || bytes.readUInt32LE(24) !== DICTATION_SAMPLE_RATE || bytes.readUInt32LE(28) !== DICTATION_SAMPLE_RATE * 2
    || bytes.readUInt16LE(32) !== 2 || bytes.readUInt16LE(34) !== 16
    || bytes.toString('ascii', 36, 40) !== 'data' || bytes.readUInt32LE(40) !== bytes.length - 44
    || (bytes.length - 44) % 2 !== 0) throw new Error('Die Aufnahme hat ein ungültiges Audioformat. Bitte erneut aufnehmen.');
  return (bytes.length - 44) / (DICTATION_SAMPLE_RATE * 2);
}

/** Main-only, bounded batch transcription. No automatic retry or local audio
 * persistence. The caller owns authorization, idempotency and draft identity. */
export class DictationService {
  private busy = false;
  private usage?: SpeechUsageService;
  setUsage(usage: SpeechUsageService): void { this.usage = usage; }
  constructor(private readonly key: () => string | undefined, private readonly fetcher: typeof fetch = fetch) {}

  async transcribe(audio: Uint8Array, authorize: () => void, signal?: AbortSignal, attribution: SpeechUsageAttribution = {}): Promise<DictationTranscript> {
    authorize();
    const audioSeconds = validateDictationAudio(audio);
    if (this.busy) throw new Error('Eine Transkription läuft bereits. Bitte warten.');
    const key = this.key();
    if (!key) throw new Error('ElevenLabs-Key fehlt. Unter Service-Keys ELEVENLABS_API_KEY speichern.');
    const deadline = AbortSignal.timeout(60_000);
    const cancellation = signal ? AbortSignal.any([signal, deadline]) : deadline;
    if (cancellation.aborted) throw new Error('Transkription abgebrochen.');
    this.busy = true;
    let attempt: SpeechUsageAttempt | undefined; let dispatched = false;
    try {
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'dictation.wav');
      form.set('model_id', 'scribe_v2');
      form.set('timestamps_granularity', 'none');
      form.set('tag_audio_events', 'false');
      form.set('diarize', 'false');
      authorize();
      attempt = await this.usage?.begin({ ...attribution, product: 'dictation', model: 'scribe_v2', audioSeconds });
      authorize(); if (cancellation.aborted) throw new Error('Transkription abgebrochen.');
      let response: Response;
      try {
        dispatched = true;
        response = await this.fetcher('https://api.elevenlabs.io/v1/speech-to-text', {
          method: 'POST', headers: { 'xi-api-key': key }, body: form, redirect: 'error', signal: cancellation,
        });
      } catch {
        throw new Error(cancellation.aborted ? 'Transkription abgebrochen oder Zeitlimit erreicht.'
          : 'ElevenLabs ist gerade nicht erreichbar. Der Versandstatus ist unbekannt; keine automatische Wiederholung.');
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(response.status === 401 || response.status === 403 ? 'ElevenLabs lehnt Speech to Text ab. Key und Berechtigung prüfen.'
          : response.status === 429 ? 'ElevenLabs-Limit erreicht. Bitte später erneut versuchen.'
            : `Transkription fehlgeschlagen (HTTP ${response.status}).`);
      }
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
        await response.body?.cancel(); throw new Error('ElevenLabs hat kein gültiges Transkript geliefert.');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('ElevenLabs hat kein Transkript geliefert.');
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const next = await reader.read(); if (next.done) break;
          size += next.value.byteLength;
          if (size > 128 * 1024 || cancellation.aborted) throw new Error('limit');
          chunks.push(next.value);
        }
      } catch {
        await reader.cancel().catch(() => undefined);
        throw new Error('Transkript unvollständig, zu gross oder abgebrochen.');
      } finally { reader.releaseLock(); }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new Error('ElevenLabs hat kein gültiges Transkript geliefert.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('ElevenLabs hat kein gültiges Transkript geliefert.');
      const data = body as Record<string, unknown>;
      if (typeof data.text !== 'string' || data.text.length > DICTATION_MAX_TEXT_CHARS
        || (data.text.trim() && !validPromptText(data.text))) throw new Error('Das Transkript ist zu lang oder enthält ungültige Steuerzeichen.');
      if (cancellation.aborted) throw new Error('Transkription abgebrochen.');
      authorize();
      await attempt?.finish('complete').catch(error => console.warn('[ade] speech usage finalization failed:', redactedErrorDetail(error)));
      return { text: data.text, language: typeof data.language_code === 'string' && /^[a-z]{2,3}$/.test(data.language_code)
        ? data.language_code : null, audioSeconds, model: 'scribe_v2' };
    } catch (error) {
      await attempt?.finish(dispatched ? 'unconfirmed' : 'not-sent').catch(failure => console.warn('[ade] speech usage finalization failed:', redactedErrorDetail(failure)));
      throw error;
    } finally { this.busy = false; }
  }
}
