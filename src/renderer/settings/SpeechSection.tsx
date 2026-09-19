import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { SpeechCatalog } from '../../shared/speech';

export function SpeechSection(): JSX.Element {
  useLocale();
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
    catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+':\s*/, '') : translate("Voice operation failed.")); }
    finally { locked.current = false; if (live.current) { setBusy(false); requestAnimationFrame(() => {
      if (live.current && opener?.isConnected && document.activeElement === document.body) opener.focus();
    }); } }
  }, []);
  const load = useCallback(() => run(async () => {
    const result = await window.ade.invoke('speech:voices');
    if (live.current) { setCatalog(result); setVoiceId(result.selectedVoiceId ?? ''); }
  }), [run]);
  const stop = () => { audio.current?.pause(); if (audio.current) audio.current.currentTime = 0; setNotice(translate("Playback stopped.")); };
  return <section className="st-section st-speech" aria-label={translate("Voice output")}>
    <h3>{translate("Speech output · ElevenLabs")}</h3>
    <p>{translate('Select a voice for ADE and try a short sample sentence. The sample uses your ElevenLabs credits.')}</p>
    <button type="button" disabled={busy} onClick={() => void load()}>{catalog ? translate("Reload voices") : translate("Load voices")}</button>
    {catalog && <><label>{translate("Voice")}<select aria-label={translate("Voice")} value={voiceId} disabled={busy} onChange={(event) => {
      const next = event.target.value; stop(); setSource('');
      void run(async () => { await window.ade.invoke('speech:select', { voiceId: next }); if (live.current) { setVoiceId(next); setNotice(translate("Voice saved.")); } });
    }}><option value="" disabled>{translate("Choose voice")}</option>
      {voiceId && !catalog.voices.some(v => v.id === voiceId) && <option value={voiceId} disabled>{translate("Saved voice not available")}</option>}
      {catalog.voices.map(v => <option key={v.id} value={v.id}>{v.name}{v.gender === 'female' ? translate(' · Female') : v.gender === 'male' ? translate(" · Male") : ''}{v.language ? ` · ${v.language}` : ''}</option>)}
    </select></label>
      {!catalog.voices.length && <p role="status">{translate("No voices available. Check the ElevenLabs key and voice access.")}</p>}
      <button type="button" disabled={busy || !catalog.voices.some(v => v.id === voiceId)} onClick={() => {
        stop(); setSource(''); void run(async () => {
          await window.ade.invoke('speech:select', { voiceId });
          const result = await window.ade.invoke('speech:test', { voiceId });
          if (live.current) { setSource(`data:${result.mimeType};base64,${result.base64}`); setNotice(translate("Test ready. Starting playback.")); }
        });
      }}>{translate("Test voice")}</button></>}
    {busy && <p role="status">{translate("Voice operation in progress…")}</p>}{error && <p role="alert">{localizeAppMessage(error)}</p>}
    {notice && <p role="status">{localizeAppMessage(notice)}</p>}
    {source && <><audio ref={audio} controls autoPlay src={source} aria-label={translate("Voice test playback")} onEnded={() => setNotice(translate("Voice test playback completed."))}
      onError={() => setError(translate("Audio could not be played. Please try again."))} /><button type="button" onClick={stop}>{translate("Stop playback")}</button></>}
  </section>;
}
