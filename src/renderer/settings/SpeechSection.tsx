import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { SpeechCatalog } from '../../shared/speech';

export function SpeechSection(): JSX.Element {
  const [catalog, setCatalog] = useState<SpeechCatalog>();
  const [voiceId, setVoiceId] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [notice, setNotice] = useState(''); const [source, setSource] = useState('');
  const live = useRef(true); const locked = useRef(false); const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => { live.current = true; return () => { live.current = false; audio.current?.pause(); }; }, []);
  const run = useCallback(async (action: () => Promise<void>) => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (locked.current) return; locked.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+':\s*/, '') : 'Sprachaktion fehlgeschlagen.'); }
    finally { locked.current = false; if (live.current) { setBusy(false); requestAnimationFrame(() => {
      if (live.current && opener?.isConnected && document.activeElement === document.body) opener.focus();
    }); } }
  }, []);
  const load = useCallback(() => run(async () => {
    const result = await window.ade.invoke('speech:voices');
    if (live.current) { setCatalog(result); setVoiceId(result.selectedVoiceId ?? ''); }
  }), [run]);
  const stop = () => { audio.current?.pause(); if (audio.current) audio.current.currentTime = 0; setNotice('Wiedergabe gestoppt.'); };
  return <section className="st-section st-speech" aria-label="Sprachausgabe">
    <h3>Sprachausgabe · ElevenLabs</h3>
    <p>Stimme für ADE auswählen und mit einem kurzen deutschen Satz testen. Der Test verwendet dein ElevenLabs-Guthaben.</p>
    <button type="button" disabled={busy} onClick={() => void load()}>{catalog ? 'Stimmen neu laden' : 'Stimmen laden'}</button>
    {catalog && <><label>Stimme<select aria-label="Stimme" value={voiceId} disabled={busy} onChange={(event) => {
      const next = event.target.value; stop(); setSource('');
      void run(async () => { await window.ade.invoke('speech:select', { voiceId: next }); if (live.current) { setVoiceId(next); setNotice('Stimme gespeichert.'); } });
    }}><option value="" disabled>Stimme auswählen</option>
      {voiceId && !catalog.voices.some(v => v.id === voiceId) && <option value={voiceId} disabled>Gespeicherte Stimme nicht verfügbar</option>}
      {catalog.voices.map(v => <option key={v.id} value={v.id}>{v.name}{v.gender === 'female' ? ' · Weiblich' : v.gender === 'male' ? ' · Männlich' : ''}{v.language ? ` · ${v.language}` : ''}</option>)}
    </select></label>
      {!catalog.voices.length && <p role="status">Keine Stimmen verfügbar. ElevenLabs-Key und Stimmenfreigabe prüfen.</p>}
      <button type="button" disabled={busy || !catalog.voices.some(v => v.id === voiceId)} onClick={() => {
        stop(); setSource(''); void run(async () => {
          await window.ade.invoke('speech:select', { voiceId });
          const result = await window.ade.invoke('speech:test', { voiceId });
          if (live.current) { setSource(`data:${result.mimeType};base64,${result.base64}`); setNotice('Test bereit. Wiedergabe startet.'); }
        });
      }}>Stimme testen</button></>}
    {busy && <p role="status">Sprachaktion läuft…</p>}{error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {source && <><audio ref={audio} controls autoPlay src={source} aria-label="Stimmtest Wiedergabe" onEnded={() => setNotice('Stimmtest vollständig abgespielt.')}
      onError={() => setError('Audio konnte nicht abgespielt werden. Bitte erneut testen.')} /><button type="button" onClick={stop}>Wiedergabe stoppen</button></>}
  </section>;
}
