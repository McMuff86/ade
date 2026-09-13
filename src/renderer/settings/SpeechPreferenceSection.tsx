import { useEffect, useRef, useState } from 'react';
import type { SpeechAudio, SpeechPreference } from '../../shared/speech';
import './speech-preference.css';

export interface SpeechPreferencePort {
  load(): Promise<SpeechPreference>;
  select(voiceId: string | null): Promise<void>;
  test(voiceId: string): Promise<SpeechAudio>;
}
export function SpeechPreferenceSection({ port, enabled = true, pending = false, title = 'Sprachausgabe', recoveredAudio }: {
  port: SpeechPreferencePort; enabled?: boolean; pending?: boolean; title?: string; recoveredAudio?: SpeechAudio;
}) {
  const [state, setState] = useState<SpeechPreference>(); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [source, setSource] = useState('');
  const live = useRef(true); const lock = useRef(false); const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => { live.current = true; return () => { live.current = false; audio.current?.pause(); }; }, []);
  useEffect(() => { if (!enabled) { audio.current?.pause(); setSource(''); } }, [enabled]);
  useEffect(() => { if (recoveredAudio && enabled) setSource(`data:${recoveredAudio.mimeType};base64,${recoveredAudio.base64}`); }, [recoveredAudio, enabled]);
  const stop = () => { audio.current?.pause(); if (audio.current) audio.current.currentTime = 0; };
  const run = async (work: () => Promise<void>) => {
    if (lock.current || !enabled) return; lock.current = true; setBusy(true); setError(''); setNotice('');
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try { await work(); } catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : 'Sprachaktion konnte nicht bestätigt werden.'); }
    finally { lock.current = false; if (live.current) { setBusy(false); requestAnimationFrame(() => { if (live.current && opener?.isConnected && document.activeElement === document.body) opener.focus(); }); } }
  };
  const load = async () => { const result = await port.load(); if (live.current) setState(result); };
  const effective = state?.voices.find(voice => voice.id === state.effectiveVoiceId);
  const sources = { agent: 'Agent', project: 'Projekt', default: 'ADE-Standard', 'female-default': 'weibliche Vorauswahl', unavailable: 'keine Stimme' };
  return <section className="speech-preference" aria-label={title}>
    <h3>{title} · ElevenLabs</h3>
    <p>Stimmenwahl gilt für die ADE-Sprachausgabe. Ein Stimmtest verwendet ElevenLabs-Guthaben.</p>
    {!enabled && <p role="status">PC nicht verbunden. Sprachaktionen sind derzeit nicht verfügbar.</p>}
    <button type="button" disabled={!enabled || busy} onClick={() => void run(load)}>{state ? 'Stimmen neu laden' : 'Stimmen laden'}</button>
    {state && <>
      <label>Stimme<select aria-label="Stimme" disabled={!enabled || busy || pending} value={state.selectedVoiceId ?? ''} onChange={event => {
        const voiceId = event.target.value || null; stop(); setSource(''); void run(async () => { await port.select(voiceId); await load(); if (live.current) setNotice('Stimmenauswahl gespeichert.'); });
      }}>
        <option value="">{state.target.kind === 'default' ? 'Automatische weibliche Vorauswahl' : 'Erben (Projekt / ADE-Standard)'}</option>
        {state.selectedVoiceId && !state.voices.some(voice => voice.id === state.selectedVoiceId) && <option value={state.selectedVoiceId}>Gespeicherte Stimme nicht verfügbar</option>}
        {state.voices.map(voice => <option key={voice.id} value={voice.id}>{voice.name}{voice.gender === 'female' ? ' · Weiblich' : voice.gender === 'male' ? ' · Männlich' : ''}</option>)}
      </select></label>
      <p>Wirksam: <strong>{effective?.name ?? 'Keine verfügbare Stimme'}</strong> · Quelle: {sources[state.source]}</p>
      {!effective && <p role="status">Die gewählte oder geerbte Stimme ist nicht verfügbar. Stimmen neu laden oder eine andere Stimme wählen.</p>}
      <button type="button" disabled={!enabled || busy || pending || !effective} onClick={() => { stop(); setSource(''); void run(async () => {
        const result = await port.test(state.effectiveVoiceId!); if (live.current) { setSource(`data:${result.mimeType};base64,${result.base64}`); setNotice('Stimmtest bereit.'); }
      }); }}>Stimme testen</button>
    </>}
    {busy && <p role="status">Sprachaktion läuft…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {source && <><audio ref={audio} controls autoPlay src={source} aria-label="Stimmtest Wiedergabe" onEnded={() => setNotice('Stimmtest vollständig abgespielt.')} onError={() => setError('Audio konnte nicht abgespielt werden.')} />
      <button type="button" onClick={() => { stop(); setNotice('Wiedergabe gestoppt.'); }}>Wiedergabe stoppen</button></>}
  </section>;
}
