import { DICTATION_MAX_AUDIO_BYTES, validDictationJobId } from './dictation';

export const DICTATION_MAX_BASE64_CHARS = Math.ceil(DICTATION_MAX_AUDIO_BYTES / 3) * 4;
export interface DictationUpload { jobId: string; key: string; audioBase64: string }
export const validDictationBase64 = (value: unknown): value is string => typeof value === 'string'
  && value.length >= 4328 && value.length <= DICTATION_MAX_BASE64_CHARS && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
export function validDictationUpload(value: unknown): value is DictationUpload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).length === 3 && ['jobId', 'key', 'audioBase64'].every(key => Object.hasOwn(item, key))
    && validDictationJobId(item.jobId) && validDictationJobId(item.key) && validDictationBase64(item.audioBase64);
}
export const validPromptSessionId = (value: unknown): value is string => typeof value === 'string' && /^s[a-z0-9]{1,127}$/.test(value);
