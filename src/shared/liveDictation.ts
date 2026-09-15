import { validDictationJobId } from './dictation';

export const LIVE_DICTATION_CHUNK_BYTES = 16_000;
export interface LiveDictationChunk { jobId: string; sequence: number; audioBase64: string }
export function validLiveDictationChunk(value: unknown): value is LiveDictationChunk {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).length === 3 && ['jobId', 'sequence', 'audioBase64'].every(key => Object.hasOwn(item, key))
    && validDictationJobId(item.jobId) && Number.isSafeInteger(item.sequence) && Number(item.sequence) >= 0 && Number(item.sequence) < 1000
    && typeof item.audioBase64 === 'string' && item.audioBase64.length >= 4
    && item.audioBase64.length <= Math.ceil(LIVE_DICTATION_CHUNK_BYTES / 3) * 4
    && item.audioBase64.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(item.audioBase64);
}
