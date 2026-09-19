import { t as translate } from "./i18n";
import { isAppLocale, type AppLocale } from './i18n/locales';
export interface SpeechVoice { id: string; name: string; gender: string; language: string }
export interface SpeechCatalog { voices: SpeechVoice[]; selectedVoiceId: string | null }
/** Legacy fields remain readable; Eleven v3 dialogue consumes stability only. */
export interface SpeechTuning { speed: number; stability: number; similarityBoost: number; style: number; speakerBoost: boolean }
export const DEFAULT_SPEECH_TUNING: Readonly<SpeechTuning> = Object.freeze({ speed: 0.85, stability: 0.9, similarityBoost: 0.75, style: 0, speakerBoost: true });
export const validSpeechTuning = (value: unknown): value is SpeechTuning => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const bounded = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  return Object.keys(item).length === 5 && ['speed', 'stability', 'similarityBoost', 'style', 'speakerBoost'].every(key => Object.hasOwn(item, key))
    && bounded(item.speed, 0.7, 1.2) && bounded(item.stability, 0, 1) && bounded(item.similarityBoost, 0, 1) && bounded(item.style, 0, 1) && typeof item.speakerBoost === 'boolean';
};
export interface SpeechAudio { base64: string; mimeType: 'audio/mpeg'; text: string; voiceId: string }
export type SpeechPreset = 'voice-check' | 'computer-greeting';
export const validSpeechPreset = (value: unknown): value is SpeechPreset => value === 'voice-check' || value === 'computer-greeting';
export const computerGreeting = (hour: number): string => [
  `${hour >= 5 && hour < 12 ? translate("Good morning") : hour >= 12 && hour < 18 ? translate("Hello") : translate("Good evening")}, Adi.`,
  translate("I'm glad you're here. What can I do for you?"),
  translate("After this greeting, choose “Dictate” and describe what you need help with."),
  translate("You can then check your text and send it to the selected session."),
].join(' ');
export const isComputerCall = (text: string): boolean => /^\s*(?:hey[,\s]+)?computer[.!?,\s]*$/iu.test(text);
/** Fixed legacy fixture; interactive tests resolve the current language below. */
export const SPEECH_TEST_TEXT = translate("Hi Adi, I'm your agent. What can I do for you?", { lng: 'de' });
export const speechTestText = (): string => translate("Hi Adi, I'm your agent. What can I do for you?");
export const validVoiceId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9]{10,80}$/.test(value);

export type SpeechTarget = { kind: 'default' } | { kind: 'project'; repositoryId: string } | { kind: 'agent'; agentId: string; repositoryId?: string };
export interface SpeechPreference extends SpeechCatalog {
  tuning: SpeechTuning;
  target: SpeechTarget;
  effectiveVoiceId: string | null;
  inheritedVoiceId: string | null;
  source: 'agent' | 'project' | 'default' | 'female-default' | 'unavailable';
}
export interface SpeechSelection { target: SpeechTarget; voiceId: string | null; tuning?: SpeechTuning }
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
  return Object.keys(item).every(key => ['target', 'voiceId', 'tuning'].includes(key)) && Object.hasOwn(item, 'target') && Object.hasOwn(item, 'voiceId') && validSpeechTarget(item.target) && (item.voiceId === null || validVoiceId(item.voiceId))
    && (!Object.hasOwn(item, 'tuning') || item.target.kind === 'default' && validSpeechTuning(item.tuning));
};
export const STUDIO_MODELS = ['eleven_multilingual_v2', 'eleven_v3'] as const;
export type StudioModel = typeof STUDIO_MODELS[number];
export interface VoiceStudioInput { model: StudioModel; text: string; language: AppLocale | 'auto' }
export const MAX_STUDIO_TEXT = 1200;
export function validVoiceStudioInput(value: unknown): value is VoiceStudioInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).length === 3 && ['model', 'text', 'language'].every(k => Object.hasOwn(item, k))
    && STUDIO_MODELS.some(model => model === item.model) && typeof item.text === 'string' && !!item.text.trim()
    && item.text.length <= MAX_STUDIO_TEXT && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(item.text)
    && (item.language === 'auto' || isAppLocale(item.language));
}
export interface SpeechTestInput { voiceId: string; preset?: SpeechPreset; tuning?: SpeechTuning; studio?: VoiceStudioInput }
export const validSpeechTest = (value: unknown): value is SpeechTestInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).every(key => ['voiceId', 'preset', 'tuning', 'studio'].includes(key)) && Object.hasOwn(item, 'voiceId') && validVoiceId(item.voiceId)
    && (!Object.hasOwn(item, 'preset') || validSpeechPreset(item.preset))
    && (!Object.hasOwn(item, 'tuning') || item.preset !== 'computer-greeting' && validSpeechTuning(item.tuning))
    && (!Object.hasOwn(item, 'studio') || !Object.hasOwn(item, 'preset') && validVoiceStudioInput(item.studio) && validSpeechTuning(item.tuning));
};
/** Shared with recovery drafts so retry validation matches the signed host contract. */
export const validMobileSpeechCommand = (value: unknown): value is import('./remote').MobileSpeechCommand => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const { operation, target, ...input } = value as Record<string, unknown>;
  return operation === 'select' ? validSpeechSelection({ target, ...input })
    : operation === 'test' && validSpeechTarget(target) && validSpeechTest(input);
};
export const speechTargetKey = (target: SpeechTarget): string => `speech:${JSON.stringify([target.kind, target.kind === 'agent' ? target.agentId : '', target.kind === 'default' ? '' : target.repositoryId ?? ''])}`;
