export interface SpeechVoice { id: string; name: string; gender: string; language: string }
export interface SpeechCatalog { voices: SpeechVoice[]; selectedVoiceId: string | null }
export interface SpeechAudio { base64: string; mimeType: 'audio/mpeg'; text: string; voiceId: string }
export type SpeechPreset = 'voice-check' | 'computer-greeting';
export const validSpeechPreset = (value: unknown): value is SpeechPreset => value === 'voice-check' || value === 'computer-greeting';
export const computerGreeting = (hour: number): string => `${hour >= 5 && hour < 12 ? 'Guten Morgen' : hour >= 12 && hour < 18 ? 'Guten Tag' : 'Guten Abend'}, Adi. Ich bin bereit. Was möchtest du als Nächstes angehen?`;
export const isComputerCall = (text: string): boolean => /^\s*(?:hey[,\s]+)?computer[.!?,\s]*$/iu.test(text);
export const SPEECH_TEST_TEXT = 'Hallo Adi, hier spricht ADE. Die Sprachausgabe über ElevenLabs funktioniert. Ich bin bereit für unseren nächsten Schritt.';
export const validVoiceId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9]{10,80}$/.test(value);

export type SpeechTarget = { kind: 'default' } | { kind: 'project'; repositoryId: string } | { kind: 'agent'; agentId: string; repositoryId?: string };
export interface SpeechPreference extends SpeechCatalog {
  target: SpeechTarget;
  effectiveVoiceId: string | null;
  inheritedVoiceId: string | null;
  source: 'agent' | 'project' | 'default' | 'female-default' | 'unavailable';
}
export interface SpeechSelection { target: SpeechTarget; voiceId: string | null }
export const validSpeechTarget = (value: unknown): value is SpeechTarget => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>; const keys = Object.keys(item);
  if (!Object.hasOwn(item, 'kind')) return false;
  const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(v);
  if (item.kind === 'default') return keys.length === 1;
  if (item.kind === 'project') return keys.length === 2 && Object.hasOwn(item, 'repositoryId') && id(item.repositoryId);
  return item.kind === 'agent' && Object.hasOwn(item, 'agentId') && id(item.agentId) && (item.repositoryId === undefined || id(item.repositoryId))
    && keys.every(key => ['kind', 'agentId', 'repositoryId'].includes(key));
};
export const validSpeechSelection = (value: unknown): value is SpeechSelection => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).length === 2 && Object.hasOwn(item, 'target') && Object.hasOwn(item, 'voiceId') && validSpeechTarget(item.target) && (item.voiceId === null || validVoiceId(item.voiceId));
};
export const speechTargetKey = (target: SpeechTarget): string => `speech:${JSON.stringify([target.kind, target.kind === 'agent' ? target.agentId : '', target.kind === 'default' ? '' : target.repositoryId ?? ''])}`;
