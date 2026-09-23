/** Fixed mono PCM format makes duration independently verifiable at the host. */
export const DICTATION_SAMPLE_RATE = 16_000;
export const DICTATION_MAX_SECONDS = 60;
export const DICTATION_MAX_AUDIO_BYTES = 44 + DICTATION_SAMPLE_RATE * 2 * DICTATION_MAX_SECONDS;
export const DICTATION_MAX_TEXT_CHARS = 12_000;
/** Scribe's automatic detection transcribed spoken High German as Dutch, so
 * batch and live dictation always request German, whatever the interface language. */
export const DICTATION_LANGUAGE = 'deu';

export interface DictationTranscript {
  text: string;
  language: string | null;
  audioSeconds: number;
  model: 'scribe_v2' | 'scribe_v2_realtime';
}

export type DictationJobState = { status: 'prepared' | 'transcribing' | 'cancelled' }
  | { status: 'recording'; text: string }
  | { status: 'complete'; transcript: DictationTranscript }
  | { status: 'failed'; message: string };
export const validDictationJobId = (value: unknown): value is string => typeof value === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);

/** Draft text is plain text. Terminal control bytes never become user prompts. */
export const validPromptText = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= DICTATION_MAX_TEXT_CHARS && value.trim().length > 0
  && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(value);
