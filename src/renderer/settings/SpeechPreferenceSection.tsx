import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { intlLocale } from '../../shared/i18n';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SPEECH_TUNING, type SpeechAudio, type SpeechPreference, type SpeechTuning } from '../../shared/speech';
import './speech-preference.css';

export interface SpeechPreferencePort {
  load(): Promise<SpeechPreference>;
  select(voiceId: string | null, tuning?: SpeechTuning): Promise<void>;
  test(voiceId: string, tuning?: SpeechTuning): Promise<SpeechAudio>;
}
export function SpeechPreferenceSection({ port, enabled = true, pending = false, title = translate("Voice output"), recoveredAudio }: {
  port: SpeechPreferencePort; enabled?: boolean; pending?: boolean; title?: string; recoveredAudio?: SpeechAudio;
}) {
  useLocale();
  const [state, setState] = useState<SpeechPreference>(); const [busy, setBusy] = useState(false);
  const [tuning, setTuning] = useState<SpeechTuning>({ ...DEFAULT_SPEECH_TUNING });
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [source, setSource] = useState('');
  const live = useRef(true); const lock = useRef(false); const audio = useRef<HTMLAudioElement>(null);
  const available = useRef(enabled); available.current = enabled;
  useEffect(() => { live.current = true; return () => { live.current = false; audio.current?.pause(); }; }, []);
  useEffect(() => { if (!enabled) { audio.current?.pause(); setSource(''); } }, [enabled]);
  useEffect(() => { if (recoveredAudio && enabled) setSource(`data:${recoveredAudio.mimeType};base64,${recoveredAudio.base64}`); }, [recoveredAudio, enabled]);
  useEffect(() => { const element = audio.current; return () => { element?.pause(); }; }, [source]);
  const stop = () => { audio.current?.pause(); if (audio.current) audio.current.currentTime = 0; };
  const run = async (work: () => Promise<void>) => {
    if (lock.current || !enabled) return; lock.current = true; setBusy(true); setError(''); setNotice('');
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try { await work(); } catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : translate("Voice operation could not be confirmed.")); }
    finally { lock.current = false; if (live.current) { setBusy(false); requestAnimationFrame(() => { if (live.current && opener?.isConnected && document.activeElement === document.body) opener.focus(); }); } }
  };
  const load = async (resetTuning = true) => { const result = await port.load(); if (live.current) { setState(result); if (resetTuning) setTuning({ ...result.tuning }); } };
  const dirty = state && Object.keys(DEFAULT_SPEECH_TUNING).some(key => tuning[key as keyof SpeechTuning] !== state.tuning[key as keyof SpeechTuning]);
  const changeTuning = (next: SpeechTuning) => { stop(); setSource(''); setNotice(''); setTuning(next); };
  const effective = state?.voices.find(voice => voice.id === state.effectiveVoiceId);
  const sources = ({ agent: translate("Agent"), project: translate("Project"), default: translate('ADE default'), 'female-default': translate("automatic female voice"), unavailable: translate("No voice") });
  return <section className="speech-preference" aria-label={title}>
    <h3>{title} {" "}{translate("· ElevenLabs")}</h3>
    <p>{translate("The selected voice is used for ADE speech output. Voice tests use ElevenLabs credits.")}</p>
    {!enabled && <p role="status">{translate("PC not connected. Voice actions are not currently available.")}</p>}
    <button type="button" disabled={!enabled || busy || pending} onClick={() => void run(() => load())}>{state ? translate("Reload voices") : translate("Load voices")}</button>
    {state && <>
      <label>{translate("Voice")}<select aria-label={translate("Voice")} disabled={!enabled || busy || pending} value={state.selectedVoiceId ?? ''} onChange={event => {
        const voiceId = event.target.value || null; stop(); setSource(''); void run(async () => { await port.select(voiceId); await load(false); if (live.current) setNotice(translate("Voice selection saved.")); });
      }}>
        <option value="">{state.target.kind === 'default' ? translate("Automatic female pre-selection") : translate("Inherit (project / ADE default)")}</option>
        {state.selectedVoiceId && !state.voices.some(voice => voice.id === state.selectedVoiceId) && <option value={state.selectedVoiceId}>{translate("Saved voice not available")}</option>}
        {state.voices.map(voice => <option key={voice.id} value={voice.id}>{voice.name}{voice.gender === 'female' ? translate(' · Female') : voice.gender === 'male' ? translate(" · Male") : ''}</option>)}
      </select></label>
      <p>{translate("Effective:")}{" "}<strong>{effective?.name ?? translate("No available voice")}</strong> {" "}{translate("· Source:")}{" "}{sources[state.source]}</p>
      <p>{translate("Eleven v3 · Text to Dialogue.")}</p>
      {!effective && <p role="status">{translate("The chosen or inherited voice is unavailable, reloading voices or choosing another voice.")}</p>}
      {state.target.kind === 'default' ? <>
        <p>{translate("Stability applies to PC and tablet, including for computer greeting. try changes first, save afterwards. tempo, voice similarity, style and speaker boost are not supported by this v3 connection.")}</p>
        <fieldset className="speech-tuning" disabled={!enabled || busy || pending}>
          <legend>{translate("Voice parameters")}</legend>
          {([
            ['stability', translate("Stability"), 0, 1, translate("Higher values provide more uniform emphasis.")],
          ] as const).map(([key, label, min, max, help]) => <label key={key}>
            <span>{label} <output>{tuning[key].toLocaleString(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</output></span>
            <input type="range" aria-label={label} min={min} max={max} step={0.01} value={tuning[key]} onChange={event => changeTuning({ ...tuning, [key]: Number(event.target.value) })} />
            <small>{help}</small>
          </label>)}
          <div className="speech-tuning-actions">
            <button type="button" disabled={!dirty} onClick={() => void run(async () => {
              stop(); setSource(''); await port.select(state.selectedVoiceId, tuning); await load(); if (live.current) setNotice(translate("Voice parameters stored. Applies to PC and tablet."));
            })}>{translate("Save parameters")}</button>
            <button type="button" disabled={!dirty} onClick={() => changeTuning({ ...state.tuning })}>{translate("Discard changes")}</button>
            <button type="button" onClick={() => changeTuning({ ...tuning, stability: DEFAULT_SPEECH_TUNING.stability })}>{translate("Quiet computer")}</button>
          </div>
        </fieldset>
        {dirty && <p role="status">{translate("Unsaved voice parameters. “Test voice” uses this preview.")}</p>}
      </> : <p>{translate("Stability follows the global settings under Settings → Voice.")}</p>}
      <button type="button" disabled={!enabled || busy || pending || !effective} onClick={() => { stop(); setSource(''); void run(async () => {
        const result = await port.test(state.effectiveVoiceId!, state.target.kind === 'default' ? tuning : undefined); if (live.current && available.current) { setSource(`data:${result.mimeType};base64,${result.base64}`); setNotice(translate("Voice test ready.")); }
      }); }}>{translate("Test voice")}</button>
    </>}
    {busy && <p role="status">{translate("Voice operation in progress…")}</p>}{error && <p role="alert">{localizeAppMessage(error)}</p>}{notice && <p role="status">{localizeAppMessage(notice)}</p>}
    {source && <><audio ref={audio} controls autoPlay src={source} aria-label={translate("Voice test playback")} onEnded={() => setNotice(translate("Voice test playback completed."))} onError={() => setError(translate("Audio could not be played."))} />
      <button type="button" onClick={() => { stop(); setNotice(translate("Playback stopped.")); }}>{translate("Stop playback")}</button></>}
  </section>;
}
