import { useEffect, useRef, useState } from 'react';
import { t, intlLocale } from '../../shared/i18n';
import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { APP_LOCALES } from '../../shared/i18n/locales';
import { MAX_STUDIO_TEXT, STUDIO_MODELS, validSpeechTest, validSpeechTuning, validVoiceId, type SpeechAudio, type SpeechCatalog, type SpeechTestInput, type SpeechTuning, type StudioModel, type VoiceStudioInput } from '../../shared/speech';
import { useLocale } from '../i18n/language';
import './voice-studio.css';

export interface VoiceStudioPort {
  load(): Promise<SpeechCatalog>;
  generate(input: SpeechTestInput, key: string): Promise<SpeechAudio>;
  /** Only adapters with durable, same-key receipts can recover a paid request. */
  recover?: boolean;
}
type Slot = 'a' | 'b';
interface Setup { voiceId: string; model: StudioModel; tuning: SpeechTuning }
interface Pending { key: string; slot: Slot; input: SpeechTestInput }
interface Preset { name: string; setup: Setup }
interface State { version: 1; a: Setup; b: Setup; text: string; language: VoiceStudioInput['language']; presets: Preset[]; pending: Pending | null }
const neutral = (): SpeechTuning => ({ speed: 1, stability: 0.5, similarityBoost: 0.75, style: 0, speakerBoost: true });
const setup = (): Setup => ({ voiceId: '', model: 'eleven_multilingual_v2', tuning: neutral() });
const validSetup = (v: unknown): v is Setup => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).sort().join(',') === 'model,tuning,voiceId' && STUDIO_MODELS.includes((v as Setup).model)
  && ((v as Setup).voiceId === '' || validVoiceId((v as Setup).voiceId)) && validSpeechTuning((v as Setup).tuning);
function read(key: string): State {
  const fallback: State = { version: 1, a: setup(), b: setup(), text: t("Hi Adi, I'm your agent. What can I do for you?"), language: 'auto', presets: [], pending: null };
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

/** Browser-local settings; only an explicit generation sends text to ElevenLabs. */
export function VoiceStudio({ port, scope, enabled, reply = '' }: { port: VoiceStudioPort; scope: string; enabled: boolean; reply?: string }) {
  useLocale();
  const key = `ade:voice-studio:${scope}`;
  const [initial] = useState(() => { try { return { value: read(key), error: '' }; } catch (error) { return { value: null, error: localizeAppMessage(error instanceof Error ? error.message : String(error)) }; } });
  const [state, setState] = useState(initial.value); const stateRef = useRef(state); stateRef.current = state;
  const [catalog, setCatalog] = useState<SpeechCatalog>(); const [busy, setBusy] = useState(false); const locked = useRef(false);
  const [error, setError] = useState(initial.error); const [notice, setNotice] = useState(''); const [name, setName] = useState('');
  const [samples, setSamples] = useState<Partial<Record<Slot, { audio: SpeechAudio; setup: Setup }>>>({});
  const live = useRef(true); const available = useRef(enabled); available.current = enabled;
  const root = useRef<HTMLDetailsElement>(null);
  const stop = () => root.current?.querySelectorAll('audio').forEach(audio => audio.pause());
  useEffect(() => { live.current = true; return () => { live.current = false; stop(); }; }, []);
  useEffect(() => { if (!enabled) { stop(); setSamples({}); } }, [enabled]);
  const save = (next: State): boolean => {
    try { localStorage.setItem(key, JSON.stringify(next)); stateRef.current = next; setState(next); return true; }
    catch { setError(t('Browser storage is unavailable. No voice request was started.')); return false; }
  };
  const change = (slot: Slot, next: Setup) => { if (!state) return; stop(); setSamples(old => ({ ...old, [slot]: undefined })); save({ ...state, [slot]: next }); };
  const run = async (work: () => Promise<void>) => {
    if (locked.current || !available.current) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    locked.current = true; setBusy(true); setError(''); setNotice(''); stop();
    try { await work(); } catch (reason) { if (live.current) setError(localizeAppMessage(reason instanceof Error ? reason.message : String(reason))); }
    finally { locked.current = false; if (live.current) { setBusy(false); requestAnimationFrame(() => { if (opener?.isConnected && document.activeElement === document.body) opener.focus(); }); } }
  };
  const generate = async (slot: Slot, recovery?: Pending) => {
    const current = stateRef.current; if (!current || !available.current || !live.current) return;
    const request: Pending = recovery ?? { key: crypto.randomUUID(), slot, input: { voiceId: current[slot].voiceId, tuning: { ...current[slot].tuning }, studio: { model: current[slot].model, text: current.text, language: current.language } } };
    if (!validSpeechTest(request.input)) throw new Error(t('Choose a voice and enter a sample text first.'));
    if (!save({ ...current, pending: request })) return;
    const audio = await port.generate(request.input, request.key);
    if (!live.current || !available.current) return;
    const saved = stateRef.current!;
    if (!save({ ...saved, pending: null })) return;
    setSamples(old => ({ ...old, [slot]: { audio, setup: { voiceId: request.input.voiceId, model: request.input.studio!.model, tuning: request.input.tuning! } } }));
    setNotice(t('Sample ready. Press play to listen.'));
  };
  const fresh = enabled && !busy && !!state && !state.pending;
  const ready = (slot: Slot) => fresh && !!state?.text.trim() && !!catalog?.voices.some(v => v.id === state[slot].voiceId);
  return <details className="voice-studio" ref={root} onToggle={event => { if (!event.currentTarget.open) stop(); }}>
    <summary>{t('Voice studio')} <span>ElevenLabs</span></summary>
    <div className="voice-studio-body">
      <p>{t('Try voices with your own text or a conversation reply. Each generated sample uses ElevenLabs credits. Changing sliders is free.')}</p>
      {!enabled && <p role="status">{t('PC not connected. Voice actions are not currently available.')}</p>}
      <button type="button" disabled={!enabled || busy} onClick={() => void run(async () => { const result = await port.load(); if (!live.current) return; setCatalog(result); const current = stateRef.current; if (current) save({ ...current,
        a: { ...current.a, voiceId: current.a.voiceId || result.selectedVoiceId || result.voices[0]?.id || '' }, b: { ...current.b, voiceId: current.b.voiceId || result.selectedVoiceId || result.voices[0]?.id || '' } }); })}>{catalog ? t('Reload voices') : t('Load voices')}</button>
      {catalog && !catalog.voices.length && <p>{t('No voices available. Check the ElevenLabs key and voice access.')}</p>}
      {state && <>
        <label>{t('Sample text')}<textarea rows={3} maxLength={MAX_STUDIO_TEXT} value={state.text} disabled={!fresh} onChange={e => { stop(); setSamples({}); save({ ...state, text: e.target.value }); }} /></label>
        <div className="conversation-controls"><span>{state.text.length}/{MAX_STUDIO_TEXT}</span>
          <button type="button" disabled={!fresh || !reply} onClick={() => { stop(); setSamples({}); save({ ...state, text: reply.slice(0, MAX_STUDIO_TEXT) }); setNotice(reply.length > MAX_STUDIO_TEXT ? t('The beginning of the reply was copied. Review the sample text before listening.') : t('Reply copied. Review the sample text before listening.')); }}>{t('Use latest reply')}</button>
          <label>{t('Spoken language')}<select disabled={!fresh} value={state.language} onChange={e => { stop(); setSamples({}); save({ ...state, language: e.target.value as State['language'] }); }}>
            <option value="auto">{t('Detect from text')}</option>{APP_LOCALES.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select></label>
        </div>
        <div className="voice-studio-variants">{(['a', 'b'] as const).map(slot => <fieldset key={slot} disabled={!fresh}>
          <legend>{t('Variant {{variant}}', { variant: slot.toUpperCase() })}</legend>
          <label>{t('Voice')}<select value={state[slot].voiceId} onChange={e => change(slot, { ...state[slot], voiceId: e.target.value })}>
            <option value="">{t('Choose voice')}</option>{state[slot].voiceId && !catalog?.voices.some(v => v.id === state[slot].voiceId) && <option value={state[slot].voiceId}>{t('Saved voice — load voices to check availability')}</option>}
            {catalog?.voices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select></label>
          <label>{t('Voice model')}<select value={state[slot].model} onChange={e => change(slot, { ...state[slot], model: e.target.value as StudioModel })}>
            <option value="eleven_multilingual_v2">Eleven Multilingual v2</option><option value="eleven_v3">Eleven v3 · Text to Dialogue</option>
          </select></label>
          <p className="conversation-note">{state[slot].model === 'eleven_v3' ? t('This v3 connection supports stability. Other settings remain saved for Multilingual v2.') : t('Multilingual v2 uses speed, stability, similarity, style and speaker boost. It detects the language from your text.')}</p>
          {([
            ['stability', t('Stability'), 0, 1, t('Higher values make delivery more consistent.')],
            ['speed', t('Speed'), 0.7, 1.2, t('1.00 is normal speed.')],
            ['similarityBoost', t('Voice similarity'), 0, 1, t('How closely the result follows the selected voice.')],
            ['style', t('Expressiveness'), 0, 1, t('Emphasises the original voice style; higher values can increase generation time.')],
          ] as const).filter(([field]) => state[slot].model !== 'eleven_v3' || field === 'stability').map(([field, label, min, max, help]) => <label key={field}>
            <span>{label} <output>{state[slot].tuning[field].toLocaleString(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</output></span>
            <input type="range" min={min} max={max} step={0.01} value={state[slot].tuning[field]} onChange={e => change(slot, { ...state[slot], tuning: { ...state[slot].tuning, [field]: Number(e.target.value) } })} />
            <small>{help}</small>
          </label>)}
          {state[slot].model !== 'eleven_v3' && <label className="voice-studio-check"><input type="checkbox" checked={state[slot].tuning.speakerBoost} onChange={e => change(slot, { ...state[slot], tuning: { ...state[slot].tuning, speakerBoost: e.target.checked } })} />{t('Speaker boost')}</label>}
          <label>{t('Preset')}<select value="" onChange={e => {
            const presets: Record<string, SpeechTuning> = { neutral: neutral(), calm: { ...neutral(), speed: 0.85, stability: 0.8 }, expressive: { ...neutral(), stability: 0.35, style: 0.5 } };
            const selected = state.presets[Number(e.target.value.slice(7))];
            if (e.target.value.startsWith('custom:') && selected) change(slot, structuredClone(selected.setup));
            else if (presets[e.target.value]) change(slot, { ...state[slot], tuning: presets[e.target.value] });
          }}><option value="">{t('Apply a preset')}</option><option value="neutral">{t('Neutral')}</option><option value="calm">{t('Calm')}</option><option value="expressive">{t('Expressive')}</option>{state.presets.map((p, i) => <option key={i} value={`custom:${i}`}>{p.name}</option>)}</select></label>
          <button type="button" disabled={!ready(slot)} onClick={() => void run(() => generate(slot))}>{t('Generate {{variant}}', { variant: slot.toUpperCase() })}</button>
        </fieldset>)}</div>
        <div className="conversation-controls">
          <button type="button" className="voice-studio-primary" disabled={!ready('a') || !ready('b')} onClick={() => void run(async () => { await generate('a'); if (live.current && available.current && !stateRef.current?.pending) await generate('b'); })}>{t('Compare A/B · generate two samples')}</button>
          <button type="button" disabled={!fresh} onClick={() => change('b', structuredClone(state.a))}>{t('Copy A settings to B')}</button>
        </div>
        <div className="voice-studio-presets"><label>{t('Preset name')}<input maxLength={80} value={name} disabled={!fresh} onChange={e => setName(e.target.value)} /></label>
          <button type="button" disabled={!fresh || !name.trim() || state.presets.length >= 12} onClick={() => { if (save({ ...state, presets: [...state.presets, { name: name.trim(), setup: structuredClone(state.a) }] })) { setName(''); setNotice(t('Preset saved on this device.')); } }}>{t('Save A as preset')}</button>
          {state.presets.length > 0 && <label>{t('Remove saved preset')}<select disabled={!fresh} value="" onChange={e => save({ ...state, presets: state.presets.filter((_, i) => i !== Number(e.target.value)) })}><option value="">{t('Choose a preset')}</option>{state.presets.map((p, i) => <option key={i} value={i}>{p.name}</option>)}</select></label>}
        </div>
        {state.pending && <section role="status"><p>{t('The last generation is unconfirmed. It will not be repeated automatically.')}</p>
          {port.recover && <button type="button" disabled={!enabled || busy} onClick={() => void run(() => generate(state.pending!.slot, state.pending!))}>{t('Check the same request again')}</button>}
          <button type="button" disabled={busy} onClick={() => save({ ...state, pending: null })}>{t('Dismiss pending generation')}</button><p className="conversation-note">{t('Starting a new sample after dismissing may use credits again.')}</p>
        </section>}
      </>}
      <div className="voice-studio-samples">{(['a', 'b'] as const).map(slot => { const sample = samples[slot]; return sample && <figure key={slot}><figcaption>{t('Variant {{variant}}', { variant: slot.toUpperCase() })} · {catalog?.voices.find(v => v.id === sample.audio.voiceId)?.name ?? sample.audio.voiceId} · {sample.setup.model}</figcaption>
        <audio controls src={`data:${sample.audio.mimeType};base64,${sample.audio.base64}`} aria-label={t('Listen to variant {{variant}}', { variant: slot.toUpperCase() })} onPlay={event => root.current?.querySelectorAll('audio').forEach(a => { if (a !== event.currentTarget) a.pause(); })} onError={() => setError(t('Audio could not be played. Please try again.'))} />
      </figure>; })}</div>
      {busy && <p role="status">{t('Voice operation in progress…')}</p>}{notice && <p role="status">{localizeAppMessage(notice)}</p>}{error && <p role="alert">{localizeAppMessage(error)}</p>}
    </div>
  </details>;
}
