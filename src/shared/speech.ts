export interface SpeechVoice { id: string; name: string; gender: string; language: string }
export interface SpeechCatalog { voices: SpeechVoice[]; selectedVoiceId: string | null }
export interface SpeechAudio { base64: string; mimeType: 'audio/mpeg'; text: string; voiceId: string }
export const SPEECH_TEST_TEXT = 'Hallo Adi, hier spricht ADE. Die Sprachausgabe über ElevenLabs funktioniert. Ich bin bereit für unseren nächsten Schritt.';
export const validVoiceId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9]{10,80}$/.test(value);
