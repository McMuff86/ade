import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SPEECH_TUNING, type SpeechAudio, type SpeechPreference, type SpeechTuning } from '../../shared/speech';
import './speech-preference.css';

export interface SpeechPreferencePort {
  load(): Promise<SpeechPreference>;
  select(voiceId: string | null, tuning?: SpeechTuning): Promise<void>;
  test(voiceId: string, tuning?: SpeechTuning): Promise<SpeechAudio>;
}
export function SpeechPreferenceSection({ port, enabled = true, pending = false, title = 'Sprachausgabe', recoveredAudio }: {
  port: SpeechPreferencePort; enabled?: boolean; pending?: boolean; title?: string; recoveredAudio?: SpeechAudio;
}) {
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
    try { await work(); } catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : 'Sprachaktion konnte nicht bestätigt werden.'); }
    finally { lock.current = false; if (live.current) { setBusy(false); requestAnimationFrame(() => { if (live.current && opener?.isConnected && document.activeElement === document.body) opener.focus(); }); } }
  };
  const load = async (resetTuning = true) => { const result = await port.load(); if (live.current) { setState(result); if (resetTuning) setTuning({ ...result.tuning }); } };
  const dirty = state && Object.keys(DEFAULT_SPEECH_TUNING).some(key => tuning[key as keyof SpeechTuning] !== state.tuning[key as keyof SpeechTuning]);
  const changeTuning = (next: SpeechTuning) => { stop(); setSource(''); setNotice(''); setTuning(next); };
  const effective = state?.voices.find(voice => voice.id === state.effectiveVoiceId);
  const sources = { agent: 'Agent', project: 'Projekt', default: 'ADE-Standard', 'female-default': 'weibliche Vorauswahl', unavailable: 'keine Stimme' };
  return <section className="speech-preference" aria-label={title}>
    <h3>{title} · ElevenLabs</h3>
    <p>Stimmenwahl gilt für die ADE-Sprachausgabe. Ein Stimmtest verwendet ElevenLabs-Guthaben.</p>
    {!enabled && <p role="status">PC nicht verbunden. Sprachaktionen sind derzeit nicht verfügbar.</p>}
    <button type="button" disabled={!enabled || busy || pending} onClick={() => void run(() => load())}>{state ? 'Stimmen neu laden' : 'Stimmen laden'}</button>
    {state && <>
      <label>Stimme<select aria-label="Stimme" disabled={!enabled || busy || pending} value={state.selectedVoiceId ?? ''} onChange={event => {
        const voiceId = event.target.value || null; stop(); setSource(''); void run(async () => { await port.select(voiceId); await load(false); if (live.current) setNotice('Stimmenauswahl gespeichert.'); });
      }}>
        <option value="">{state.target.kind === 'default' ? 'Automatische weibliche Vorauswahl' : 'Erben (Projekt / ADE-Standard)'}</option>
        {state.selectedVoiceId && !state.voices.some(voice => voice.id === state.selectedVoiceId) && <option value={state.selectedVoiceId}>Gespeicherte Stimme nicht verfügbar</option>}
        {state.voices.map(voice => <option key={voice.id} value={voice.id}>{voice.name}{voice.gender === 'female' ? ' · Weiblich' : voice.gender === 'male' ? ' · Männlich' : ''}</option>)}
      </select></label>
      <p>Wirksam: <strong>{effective?.name ?? 'Keine verfügbare Stimme'}</strong> · Quelle: {sources[state.source]}</p>
      {!effective && <p role="status">Die gewählte oder geerbte Stimme ist nicht verfügbar. Stimmen neu laden oder eine andere Stimme wählen.</p>}
      {state.target.kind === 'default' ? <>
        <p>Diese Stimmparameter gelten für ADE auf PC und Tablet, auch für die Computer-Begrüssung. Änderungen zuerst probehören, danach speichern.</p>
        <fieldset className="speech-tuning" disabled={!enabled || busy || pending}>
          <legend>Stimmparameter</legend>
          {([
            ['speed', 'Tempo', 0.7, 1.2, 'Unter 1,00 spricht die Stimme langsamer.'],
            ['stability', 'Stabilität', 0, 1, 'Höhere Werte sorgen für gleichmässigere Betonung.'],
            ['similarityBoost', 'Stimmähnlichkeit', 0, 1, 'Wie stark die gewählte Originalstimme erhalten bleibt.'],
            ['style', 'Stil', 0, 1, 'Höhere Werte betonen den Ausdruck der Stimme stärker.'],
          ] as const).map(([key, label, min, max, help]) => <label key={key}>
            <span>{label} <output>{tuning[key].toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</output></span>
            <input type="range" aria-label={label} min={min} max={max} step={0.01} value={tuning[key]} onChange={event => changeTuning({ ...tuning, [key]: Number(event.target.value) })} />
            <small>{help}</small>
          </label>)}
          <label className="speech-boost"><input type="checkbox" checked={tuning.speakerBoost} onChange={event => changeTuning({ ...tuning, speakerBoost: event.target.checked })} />Speaker Boost</label>
          <small>Unterstützt die Ähnlichkeit zur Originalstimme und kann die Erzeugung etwas verlängern.</small>
          <div className="speech-tuning-actions">
            <button type="button" disabled={!dirty} onClick={() => void run(async () => {
              stop(); setSource(''); await port.select(state.selectedVoiceId, tuning); await load(); if (live.current) setNotice('Stimmparameter gespeichert. Gilt auf PC und Tablet.');
            })}>Parameter speichern</button>
            <button type="button" disabled={!dirty} onClick={() => changeTuning({ ...state.tuning })}>Änderungen verwerfen</button>
            <button type="button" onClick={() => changeTuning({ ...DEFAULT_SPEECH_TUNING })}>Ruhiger Computer</button>
          </div>
        </fieldset>
        {dirty && <p role="status">Ungespeicherte Stimmparameter. „Stimme testen“ verwendet diese Vorschau.</p>}
      </> : <p>Tempo und Ausdruck folgen den globalen Einstellungen unter Einstellungen → Stimme.</p>}
      <button type="button" disabled={!enabled || busy || pending || !effective} onClick={() => { stop(); setSource(''); void run(async () => {
        const result = await port.test(state.effectiveVoiceId!, state.target.kind === 'default' ? tuning : undefined); if (live.current && available.current) { setSource(`data:${result.mimeType};base64,${result.base64}`); setNotice('Stimmtest bereit.'); }
      }); }}>Stimme testen</button>
    </>}
    {busy && <p role="status">Sprachaktion läuft…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {source && <><audio ref={audio} controls autoPlay src={source} aria-label="Stimmtest Wiedergabe" onEnded={() => setNotice('Stimmtest vollständig abgespielt.')} onError={() => setError('Audio konnte nicht abgespielt werden.')} />
      <button type="button" onClick={() => { stop(); setNotice('Wiedergabe gestoppt.'); }}>Wiedergabe stoppen</button></>}
  </section>;
}
