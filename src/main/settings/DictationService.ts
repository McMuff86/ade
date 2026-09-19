import { t as translate } from "../../shared/i18n";
import {
  DICTATION_MAX_AUDIO_BYTES, DICTATION_MAX_TEXT_CHARS, DICTATION_SAMPLE_RATE,
  validPromptText, type DictationTranscript,
} from '../../shared/dictation';
import type { SpeechUsageService, SpeechUsageAttempt, SpeechUsageAttribution } from '../usage/SpeechUsageService';
import { redactedErrorDetail } from '../errors';
import { openLiveDictation, type LiveDictationSession } from './LiveDictationService';

/** Accept only the exact PCM/WAV envelope produced by ADE's recorder. No codec,
 * remote URL, filename or client-reported duration is trusted by the host. */
export function validateDictationAudio(audio: Uint8Array): number {
  if (!(audio instanceof Uint8Array) || audio.byteLength < 44 + 3200 || audio.byteLength > DICTATION_MAX_AUDIO_BYTES) {
    throw new Error(translate("The recording must be between 0.1 and 60 seconds long."));
  }
  const bytes = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.readUInt32LE(4) !== bytes.length - 8
    || bytes.toString('ascii', 8, 16) !== 'WAVEfmt ' || bytes.readUInt32LE(16) !== 16
    || bytes.readUInt16LE(20) !== 1 || bytes.readUInt16LE(22) !== 1
    || bytes.readUInt32LE(24) !== DICTATION_SAMPLE_RATE || bytes.readUInt32LE(28) !== DICTATION_SAMPLE_RATE * 2
    || bytes.readUInt16LE(32) !== 2 || bytes.readUInt16LE(34) !== 16
    || bytes.toString('ascii', 36, 40) !== 'data' || bytes.readUInt32LE(40) !== bytes.length - 44
    || (bytes.length - 44) % 2 !== 0) throw new Error(translate("The recording is invalid audio format, please re-record."));
  return (bytes.length - 44) / (DICTATION_SAMPLE_RATE * 2);
}

/** Main-only, bounded batch transcription. No automatic retry or local audio
 * persistence. The caller owns authorization, idempotency and draft identity. */
export class DictationService {
  private busy = false;
  private usage?: SpeechUsageService;
  setUsage(usage: SpeechUsageService): void { this.usage = usage; }
  constructor(private readonly key: () => string | undefined, private readonly fetcher: typeof fetch = fetch) {}

  async startLive(authorize: () => void, signal: AbortSignal, attribution: SpeechUsageAttribution, preview: (text: string) => void): Promise<LiveDictationSession> {
    authorize();
    if (this.busy) throw new Error(translate("A transcription is already underway. Please wait."));
    const key = this.key(); if (!key) throw new Error(translate("ElevenLabs key missing. Save under service keys ELEVENLABS_API_KEY."));
    this.busy = true;
    try {
      const session = await openLiveDictation({ key, authorize, signal, attribution, preview, usage: this.usage, fetcher: this.fetcher });
      void session.result.finally(() => { this.busy = false; }).catch(() => undefined);
      return session;
    } catch (error) { this.busy = false; throw error; }
  }

  async transcribe(audio: Uint8Array, authorize: () => void, signal?: AbortSignal, attribution: SpeechUsageAttribution = {}): Promise<DictationTranscript> {
    authorize();
    const audioSeconds = validateDictationAudio(audio);
    if (this.busy) throw new Error(translate("A transcription is already underway. Please wait."));
    const key = this.key();
    if (!key) throw new Error(translate("ElevenLabs key missing. Save under service keys ELEVENLABS_API_KEY."));
    const deadline = AbortSignal.timeout(60_000);
    const cancellation = signal ? AbortSignal.any([signal, deadline]) : deadline;
    if (cancellation.aborted) throw new Error(translate("Transcription cancelled."));
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
      authorize(); if (cancellation.aborted) throw new Error(translate("Transcription cancelled."));
      let response: Response;
      try {
        dispatched = true;
        response = await this.fetcher('https://api.elevenlabs.io/v1/speech-to-text', {
          method: 'POST', headers: { 'xi-api-key': key }, body: form, redirect: 'error', signal: cancellation,
        });
      } catch {
        throw new Error(cancellation.aborted ? translate("Transcription aborted or time limit reached.")
          : translate("ElevenLabs is currently unreachable. The shipping status is unknown; no automatic repetition."));
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(response.status === 401 || response.status === 403 ? translate("ElevenLabs rejects Speech to Text. Check key and authorization.")
          : response.status === 429 ? translate("ElevenLabs limit is reached. Please try again later.")
            : translate("Transcription failed (HTTP {{value1}}).", { value1: response.status }));
      }
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
        await response.body?.cancel(); throw new Error(translate("ElevenLabs did not provide a valid transcript."));
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error(translate("ElevenLabs did not provide a transcript."));
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
        throw new Error(translate("Transcript incomplete, too large or aborted."));
      } finally { reader.releaseLock(); }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new Error(translate("ElevenLabs did not provide a valid transcript.")); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(translate("ElevenLabs did not provide a valid transcript."));
      const data = body as Record<string, unknown>;
      if (typeof data.text !== 'string' || data.text.length > DICTATION_MAX_TEXT_CHARS
        || (data.text.trim() && !validPromptText(data.text))) throw new Error(translate("The transcript is too long or contains invalid control characters."));
      if (cancellation.aborted) throw new Error(translate("Transcription cancelled."));
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
