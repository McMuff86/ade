import { useEffect, useRef, useState } from 'react';
import { t, intlLocale } from '../../shared/i18n';
import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { APP_LOCALES } from '../../shared/i18n/locales';
import { MAX_STUDIO_TEXT, STUDIO_MODELS, validSpeechTest, validSpeechTuning, validVoiceId, type SpeechAudio, type SpeechCatalog, type SpeechTestInput, type SpeechTuning, type StudioModel, type VoiceStudioInput } from '../../shared/speech';
import { useLocale } from '../i18n/language';
import { ConversationVoice } from './ConversationVoice';
import type { ConversationRecordingPort } from './ConversationRecording';
import type { ConversationDrafts } from './conversationDrafts';
import './voice-studio.css';

export interface VoiceStudioPort {
  load(): Promise<SpeechCatalog>;
  generate(input: SpeechTestInput, key: string): Promise<SpeechAudio>;
  /** Only adapters with durable, same-key receipts can recover a paid request. */
  recover?: boolean;
  /** Make a variant's voice and tuning the ADE default voice (PC and tablet); absent when the surface cannot save preferences. */
  select?(voiceId: string, tuning: SpeechTuning, key: string): Promise<void>;
}
/** Dictation for the sample text: the recording port of the open conversation, keyed apart from the message dictation. */
export interface VoiceStudioDictation { port: ConversationRecordingPort; drafts: ConversationDrafts; conversationId: string }
type Slot = 'a' | 'b';
interface Setup { voiceId: string; model: StudioModel; tuning: SpeechTuning }
interface Pending { key: string; slot: Slot; input: SpeechTestInput }
interface Preset { name: string; setup: Setup }
interface State { version: 1; a: Setup; b: Setup; text: string; language: VoiceStudioInput['language']; presets: Preset[]; pending: Pending | null }
interface Sample { audio: SpeechAudio; setup: Setup; text: string }
const neutral = (): SpeechTuning => ({ speed: 1, stability: 0.5, similarityBoost: 0.75, style: 0, speakerBoost: true });
const setup = (): Setup => ({ voiceId: '', model: 'eleven_multilingual_v2', tuning: neutral() });
const validSetup = (v: unknown): v is Setup => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).sort().join(',') === 'model,tuning,voiceId' && STUDIO_MODELS.includes((v as Setup).model)
  && ((v as Setup).voiceId === '' || validVoiceId((v as Setup).voiceId)) && validSpeechTuning((v as Setup).tuning);
/** The text a sample uses when the box is empty, so a listen never needs typing first. */
export const defaultSampleText = (): string => t("Hi Adi, I'm your agent. What can I do for you?");
function read(key: string): State {
  const fallback: State = { version: 1, a: setup(), b: setup(), text: '', language: 'auto', presets: [], pending: null };
  const raw = localStorage.getItem(key); if (!raw) return fallback;
  if (raw.length > 32_000) throw new Error(t('Voice studio storage cannot be read. Saved data has been preserved.'));
  const s = JSON.parse(raw) as State;
  if (!s || Object.keys(s).sort().join(',') !== 'a,b,language,pending,presets,text,version' || s.version !== 1 || !validSetup(s.a) || !validSetup(s.b)
    || typeof s.text !== 'string' || s.text.length > MAX_STUDIO_TEXT || s.language !== 'auto' && !APP_LOCALES.some(l => l.id === s.language)
    || !Array.isArray(s.presets) || s.presets.length > 12 || s.presets.some(p => !p || typeof p.name !== 'string' || p.name.length > 80 || !validSetup(p.setup))
    || s.pending !== null && (!s.pending || !/^[a-f0-9-]{36}$/.test(s.pending.key) || !['a', 'b'].includes(s.pending.slot) || !validSpeechTest(s.pending.input) || !s.pending.input.studio)) {
    throw new Error(t('Voice studio storage cannot be read. Saved data has been preserved.'));
  }
  return s;
}
/** Generated samples stay on this device (bounded) so reopening the studio does not cost another generation. */
const SAMPLE_BYTES = 1_500_000;
function readSamples(key: string): Partial<Record<Slot, Sample>> {
  try {
    const raw = localStorage.getItem(`${key}:samples`); if (!raw || raw.length > SAMPLE_BYTES) return {};
    const value = JSON.parse(raw) as Partial<Record<Slot, Sample>>; const out: Partial<Record<Slot, Sample>> = {};
    for (const slot of ['a', 'b'] as const) {
      const sample = value[slot];
      if (sample && validSetup(sample.setup) && typeof sample.text === 'string' && sample.audio && typeof sample.audio.base64 === 'string' && typeof sample.audio.mimeType === 'string' && validVoiceId(sample.audio.voiceId)) out[slot] = sample;
    }
    return out;
  } catch { return {}; }
}
function writeSamples(key: string, samples: Partial<Record<Slot, Sample>>): void {
  try { const raw = JSON.stringify(samples); if (raw.length <= SAMPLE_BYTES) localStorage.setItem(`${key}:samples`, raw); else localStorage.removeItem(`${key}:samples`); } catch { /* a sample that cannot be stored is still playable now */ }
}
const sameSetup = (a: Setup, b: Setup): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Browser-local settings; only an explicit generation sends text to ElevenLabs. */
export function VoiceStudio({ port, scope, enabled, reply = '', dictation }: { port: VoiceStudioPort; scope: string; enabled: boolean; reply?: string; dictation?: VoiceStudioDictation }) {
  useLocale();
  const key = `ade:voice-studio:${scope}`;
  const [initial] = useState(() => { try { return { value: read(key), error: '' }; } catch (error) { return { value: null, error: localizeAppMessage(error instanceof Error ? error.message : String(error)) }; } });
  const [state, setState] = useState(initial.value); const stateRef = useRef(state); stateRef.current = state;
  const [catalog, setCatalog] = useState<SpeechCatalog>(); const [busy, setBusy] = useState(false); const locked = useRef(false);
  const [error, setError] = useState(initial.error); const [notice, setNotice] = useState(''); const [name, setName] = useState('');
  const [samples, setSamplesState] = useState<Partial<Record<Slot, Sample>>>(() => readSamples(key));
  const setSamples = (update: (old: Partial<Record<Slot, Sample>>) => Partial<Record<Slot, Sample>>) => setSamplesState(old => { const next = update(old); writeSamples(key, next); return next; });
  const [open, setOpen] = useState(true); const [presetsOpen, setPresetsOpen] = useState(false);
  const live = useRef(true); const available = useRef(enabled); available.current = enabled;
  const root = useRef<HTMLDetailsElement>(null); const loadedOnce = useRef(false);
  const stop = () => root.current?.querySelectorAll('audio').forEach(audio => audio.pause());
  useEffect(() => { live.current = true; return () => { live.current = false; stop(); }; }, []);
  useEffect(() => { if (!enabled) stop(); }, [enabled]);
  const save = (next: State): boolean => {
    try { localStorage.setItem(key, JSON.stringify(next)); stateRef.current = next; setState(next); return true; }
    catch { setError(t('Browser storage is unavailable. No voice request was started.')); return false; }
  };
  const change = (slot: Slot, next: Setup) => { if (!state) return; stop(); save({ ...state, [slot]: next }); };
  const run = async (work: () => Promise<void>) => {
    if (locked.current || !available.current) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    locked.current = true; setBusy(true); setError(''); setNotice(''); stop();
    try { await work(); } catch (reason) { if (live.current) setError(localizeAppMessage(reason instanceof Error ? reason.message : String(reason))); }
    finally { locked.current = false; if (live.current) { setBusy(false); requestAnimationFrame(() => { if (opener?.isConnected && document.activeElement === document.body) opener.focus(); }); } }
  };
  /** Load the catalog and seat the default voice in empty variants; the PC's default is the natural starting point. */
  const load = async () => {
    const result = await port.load(); if (!live.current) return; setCatalog(result);
    const current = stateRef.current; if (!current) return;
    const fallback = result.selectedVoiceId || result.voices[0]?.id || '';
    save({ ...current, a: { ...current.a, voiceId: current.a.voiceId || fallback }, b: { ...current.b, voiceId: current.b.voiceId || fallback } });
  };
  useEffect(() => { if (open && enabled && !catalog && !loadedOnce.current && state) { loadedOnce.current = true; void run(load); } }, [open, enabled, catalog, state]);
  const sampleText = (current: State) => current.text.trim() || defaultSampleText();
  const generate = async (slot: Slot, recovery?: Pending) => {
    const current = stateRef.current; if (!current || !available.current || !live.current) return;
    const request: Pending = recovery ?? { key: crypto.randomUUID(), slot, input: { voiceId: current[slot].voiceId, tuning: { ...current[slot].tuning }, studio: { model: current[slot].model, text: sampleText(current), language: current.language } } };
    if (!validSpeechTest(request.input)) throw new Error(t('Choose a voice and enter a sample text first.'));
    if (!save({ ...current, pending: request })) return;
    const audio = await port.generate(request.input, request.key);
    if (!live.current || !available.current) return;
    const saved = stateRef.current!;
    if (!save({ ...saved, pending: null })) return;
    setSamples(old => ({ ...old, [slot]: { audio, setup: { voiceId: request.input.voiceId, model: request.input.studio!.model, tuning: request.input.tuning! }, text: request.input.studio!.text } }));
    setNotice(t('Sample ready. Press play to listen.'));
  };
  const fresh = enabled && !busy && !!state && !state.pending;
  const voiceKnown = (id: string) => !!catalog?.voices.some(v => v.id === id);
  const ready = (slot: Slot) => fresh && !!state && voiceKnown(state[slot].voiceId);
  const voiceName = (id: string) => catalog?.voices.find(v => v.id === id)?.name ?? (id ? t('Saved voice') : t('No voice yet'));
  const defaultVoiceId = catalog?.selectedVoiceId ?? '';
  const isDefault = (slot: Slot) => !!state && !!defaultVoiceId && state[slot].voiceId === defaultVoiceId;
  /** A stored sample matches only while voice, model, tuning and text are unchanged. */
  const currentSample = (slot: Slot): Sample | undefined => { const sample = samples[slot]; return state && sample && sameSetup(sample.setup, state[slot]) && sample.text === sampleText(state) ? sample : undefined; };
  return <details className="voice-studio" ref={root} open={open} onToggle={event => { setOpen(event.currentTarget.open); if (!event.currentTarget.open) stop(); }}>
    <summary><span className="voice-studio-title">{t('Voice studio')} <span>ElevenLabs</span></span>
      <span className="voice-studio-default" data-testid="voice-studio-default">{defaultVoiceId ? `${t('Default voice')}: ${voiceName(defaultVoiceId)}` : catalog ? t('No default voice yet') : ''}</span></summary>
    <div className="voice-studio-body">
      {!enabled && <p role="status" className="conversation-note">{t('PC not connected. Voice actions are not currently available.')}</p>}
      {catalog && !catalog.voices.length && <p>{t('No voices available. Check the ElevenLabs key and voice access.')}</p>}
      {state && <>
        <div className="voice-studio-text">
          <label>{t('Sample text')}<textarea rows={2} maxLength={MAX_STUDIO_TEXT} value={state.text} placeholder={defaultSampleText()} disabled={!fresh} onChange={e => { stop(); save({ ...state, text: e.target.value }); }} /></label>
          <div className="voice-studio-text-tools">
            <span className="conversation-note">{state.text.trim() ? `${state.text.length}/${MAX_STUDIO_TEXT}` : t('Empty box: the sample uses the suggested text.')}</span>
            <button type="button" className="voice-studio-quiet" disabled={!fresh || !reply} onClick={() => { stop(); save({ ...state, text: reply.slice(0, MAX_STUDIO_TEXT) }); setNotice(reply.length > MAX_STUDIO_TEXT ? t('The beginning of the reply was copied. Review the sample text before listening.') : t('Reply copied. Review the sample text before listening.')); }}>{t('Use last reply')}</button>
            {state.text.trim() && <button type="button" className="voice-studio-quiet" disabled={!fresh} onClick={() => { stop(); save({ ...state, text: '' }); }}>{t('Reset to suggested text')}</button>}
            <label className="voice-studio-language">{t('Spoken language')}<select disabled={!fresh} value={state.language} onChange={e => { stop(); save({ ...state, language: e.target.value as State['language'] }); }}>
              <option value="auto">{t('Detect from text')}</option>{APP_LOCALES.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select></label>
          </div>
          {dictation && <ConversationVoice key={dictation.conversationId} id={`studio:${dictation.conversationId}`} drafts={dictation.drafts} purpose="organizer" enabled={fresh} maxApplyChars={MAX_STUDIO_TEXT}
            port={{ ...dictation.port, prepare: () => dictation.port.prepare(dictation.conversationId) }} onApply={text => { stop(); save({ ...stateRef.current!, text: text.slice(0, MAX_STUDIO_TEXT) }); }} />}
        </div>
        <div className="voice-studio-variants">{(['a', 'b'] as const).map(slot => { const sample = currentSample(slot); return <fieldset key={slot} disabled={!fresh} className={isDefault(slot) ? 'voice-studio-is-default' : undefined}>
          <legend>{t('Variant {{variant}}', { variant: slot.toUpperCase() })}{isDefault(slot) && <span className="voice-studio-badge">{t('Default voice')}</span>}</legend>
          <label>{t('Voice')}<select aria-label={t('Variant {{variant}}: voice', { variant: slot.toUpperCase() })} value={state[slot].voiceId} onChange={e => change(slot, { ...state[slot], voiceId: e.target.value })}>
            <option value="">{t('Choose voice')}</option>{state[slot].voiceId && !voiceKnown(state[slot].voiceId) && <option value={state[slot].voiceId}>{t('Saved voice — load voices to check availability')}</option>}
            {catalog?.voices.map(v => <option key={v.id} value={v.id}>{v.name}{v.id === defaultVoiceId ? ` · ${t('default')}` : ''}</option>)}
          </select></label>
          <label>{t('Voice model')}<select aria-label={t('Variant {{variant}}: voice model', { variant: slot.toUpperCase() })} value={state[slot].model} onChange={e => change(slot, { ...state[slot], model: e.target.value as StudioModel })}>
            <option value="eleven_multilingual_v2">Eleven Multilingual v2</option><option value="eleven_v3">Eleven v3 · Text to Dialogue</option>
          </select></label>
          <div className="voice-studio-sliders">{([
            ['stability', t('Stability'), 0, 1, t('Higher values make delivery more consistent.')],
            ['speed', t('Speed'), 0.7, 1.2, t('1.00 is normal speed.')],
            ['similarityBoost', t('Voice similarity'), 0, 1, t('How closely the result follows the selected voice.')],
            ['style', t('Expressiveness'), 0, 1, t('Emphasises the original voice style; higher values can increase generation time.')],
          ] as const).filter(([field]) => state[slot].model !== 'eleven_v3' || field === 'stability').map(([field, label, min, max, help]) => <label key={field} title={help}>
            <span>{label} <output>{state[slot].tuning[field].toLocaleString(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</output></span>
            <input type="range" min={min} max={max} step={0.01} value={state[slot].tuning[field]} aria-describedby={`${slot}-${field}-help`} onChange={e => change(slot, { ...state[slot], tuning: { ...state[slot].tuning, [field]: Number(e.target.value) } })} />
            <small id={`${slot}-${field}-help`}>{help}</small>
          </label>)}</div>
          {state[slot].model !== 'eleven_v3' && <label className="voice-studio-check"><input type="checkbox" checked={state[slot].tuning.speakerBoost} onChange={e => change(slot, { ...state[slot], tuning: { ...state[slot].tuning, speakerBoost: e.target.checked } })} />{t('Speaker boost')}</label>}
          <p className="conversation-note">{state[slot].model === 'eleven_v3' ? t('This v3 connection supports stability. Other settings remain saved for Multilingual v2.') : t('Multilingual v2 uses speed, stability, similarity, style and speaker boost. It detects the language from your text.')}</p>
          <div className="voice-studio-actions">
            <button type="button" className="voice-studio-primary" disabled={!ready(slot)} onClick={() => void run(() => generate(slot))}>{sample ? t('Generate {{variant}} again', { variant: slot.toUpperCase() }) : t('Generate {{variant}}', { variant: slot.toUpperCase() })}</button>
            {port.select && !isDefault(slot) && <button type="button" disabled={!fresh || !voiceKnown(state[slot].voiceId)} onClick={() => void run(async () => {
              const chosen = stateRef.current?.[slot]; if (!chosen) return;
              await port.select!(chosen.voiceId, { ...chosen.tuning }, crypto.randomUUID()); if (!live.current) return;
              setCatalog(existing => existing ? { ...existing, selectedVoiceId: chosen.voiceId } : existing);
              setNotice(t('Variant {{variant}} is now the default voice. Applies to PC and tablet.', { variant: slot.toUpperCase() }));
            })}>{t('Use {{variant}} as default voice', { variant: slot.toUpperCase() })}</button>}
          </div>
          {sample && <figure className="voice-studio-sample"><figcaption>{voiceName(sample.audio.voiceId)} · {sample.setup.model === 'eleven_v3' ? 'v3' : 'v2'} · {sample.text.length > 60 ? `${sample.text.slice(0, 60)}…` : sample.text}</figcaption>
            <audio controls src={`data:${sample.audio.mimeType};base64,${sample.audio.base64}`} aria-label={t('Listen to variant {{variant}}', { variant: slot.toUpperCase() })} onPlay={event => root.current?.querySelectorAll('audio').forEach(a => { if (a !== event.currentTarget) a.pause(); })} onError={() => setError(t('Audio could not be played. Please try again.'))} />
          </figure>}
          {!sample && samples[slot] && <p className="conversation-note">{t('Settings changed since the last sample; generate again to hear them.')}</p>}
        </fieldset>; })}</div>
        <div className="voice-studio-actions voice-studio-footer">
          <button type="button" disabled={!ready('a') || !ready('b')} onClick={() => void run(async () => { await generate('a'); if (live.current && available.current && !stateRef.current?.pending) await generate('b'); })}>{t('Compare A/B · generate two samples')}</button>
          <button type="button" className="voice-studio-quiet" disabled={!fresh} onClick={() => change('b', structuredClone(state.a))}>{t('Copy A settings to B')}</button>
          <button type="button" className="voice-studio-quiet" disabled={!enabled || busy} onClick={() => void run(load)}>{catalog ? t('Reload voices') : t('Load voices')}</button>
          <button type="button" className="voice-studio-quiet" aria-expanded={presetsOpen} onClick={() => setPresetsOpen(value => !value)}>{t('Presets')}</button>
        </div>
        {presetsOpen && <div className="voice-studio-presets" role="group" aria-label={t('Presets')}>
          {(['a', 'b'] as const).map(slot => <label key={slot}>{t('Apply to {{variant}}', { variant: slot.toUpperCase() })}<select value="" disabled={!fresh} onChange={e => {
            const presets: Record<string, SpeechTuning> = { neutral: neutral(), calm: { ...neutral(), speed: 0.85, stability: 0.8 }, expressive: { ...neutral(), stability: 0.35, style: 0.5 } };
            const selected = state.presets[Number(e.target.value.slice(7))];
            if (e.target.value.startsWith('custom:') && selected) change(slot, structuredClone(selected.setup));
            else if (presets[e.target.value]) change(slot, { ...state[slot], tuning: presets[e.target.value] });
          }}><option value="">{t('Apply a preset')}</option><option value="neutral">{t('Neutral')}</option><option value="calm">{t('Calm')}</option><option value="expressive">{t('Expressive')}</option>{state.presets.map((p, i) => <option key={i} value={`custom:${i}`}>{p.name}</option>)}</select></label>)}
          <label>{t('Preset name')}<input maxLength={80} value={name} disabled={!fresh} onChange={e => setName(e.target.value)} /></label>
          <button type="button" disabled={!fresh || !name.trim() || state.presets.length >= 12} onClick={() => { if (save({ ...state, presets: [...state.presets, { name: name.trim(), setup: structuredClone(state.a) }] })) { setName(''); setNotice(t('Preset saved on this device.')); } }}>{t('Save A as preset')}</button>
          {state.presets.length > 0 && <label>{t('Remove saved preset')}<select disabled={!fresh} value="" onChange={e => save({ ...state, presets: state.presets.filter((_, i) => i !== Number(e.target.value)) })}><option value="">{t('Choose a preset')}</option>{state.presets.map((p, i) => <option key={i} value={i}>{p.name}</option>)}</select></label>}
        </div>}
        {state.pending && <section role="status" className="voice-studio-pending"><p>{t('The last generation is unconfirmed. It will not be repeated automatically.')}</p>
          {port.recover && <button type="button" disabled={!enabled || busy} onClick={() => void run(() => generate(state.pending!.slot, state.pending!))}>{t('Check the same request again')}</button>}
          <button type="button" disabled={busy} onClick={() => save({ ...state, pending: null })}>{t('Dismiss pending generation')}</button><p className="conversation-note">{t('Starting a new sample after dismissing may use credits again.')}</p>
        </section>}
      </>}
      {busy && <p role="status" className="conversation-note">{t('Voice operation in progress…')}</p>}{notice && <p role="status">{localizeAppMessage(notice)}</p>}{error && <p role="alert">{localizeAppMessage(error)}</p>}
      <p className="conversation-note">{t('Each generated sample uses ElevenLabs credits; changing sliders is free.')}</p>
    </div>
  </details>;
}
