import { DICTATION_SAMPLE_RATE, validDictationJobId } from './dictation';

/** ADE limits, independent of the provider's session/quota limits. */
export const LIVE_DICTATION_MAX_SECONDS = 5 * 60;
export const LIVE_DICTATION_PACKET_SAMPLES = 4096;
export const LIVE_DICTATION_MAX_PACKETS = Math.ceil(LIVE_DICTATION_MAX_SECONDS * DICTATION_SAMPLE_RATE / LIVE_DICTATION_PACKET_SAMPLES);
export const LIVE_DICTATION_AUDIO_START_TIMEOUT_MS = 30_000;
export const LIVE_DICTATION_SESSION_TIMEOUT_MS = (LIVE_DICTATION_MAX_SECONDS + 5) * 1000;
export const LIVE_DICTATION_CHUNK_BYTES = 16_000;
export interface LiveDictationChunk { jobId: string; sequence: number; audioBase64: string }
export function validLiveDictationChunk(value: unknown): value is LiveDictationChunk {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).length === 3 && ['jobId', 'sequence', 'audioBase64'].every(key => Object.hasOwn(item, key))
    && validDictationJobId(item.jobId) && Number.isSafeInteger(item.sequence) && Number(item.sequence) >= 0 && Number(item.sequence) < LIVE_DICTATION_MAX_PACKETS
    && typeof item.audioBase64 === 'string' && item.audioBase64.length >= 4
    && item.audioBase64.length <= Math.ceil(LIVE_DICTATION_CHUNK_BYTES / 3) * 4
    && item.audioBase64.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(item.audioBase64);
}
