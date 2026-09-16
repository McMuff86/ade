import { useEffect, useRef, useState } from 'react';
import { DICTATION_MAX_TEXT_CHARS, validPromptText, type DictationJobState } from '../../shared/dictation';
import type { TerminalPromptCapability, TerminalPromptReceipt } from '../../shared/terminalPrompt';
import { DictationRecorder } from './DictationRecorder';
import { LiveDictationRecorder } from './LiveDictationRecorder';
import { PromptDraftStore, type PromptDraft } from './promptDrafts';
import './prompt-composer.css';

export interface PromptComposerPort {
  capability(): Promise<TerminalPromptCapability>;
  send(text: string, mode: 'insert' | 'submit', commandId: string): Promise<TerminalPromptReceipt>;
  prepareRecording(): Promise<{ jobId: string }>;
  uploadRecording(jobId: string, key: string, bytes: Uint8Array): Promise<unknown>;
  readRecording(jobId: string): Promise<DictationJobState>;
  cancelRecording(jobId: string): Promise<unknown>;
  permitMicrophone?(): Promise<unknown>;
  revokeMicrophone?(): Promise<unknown>;
  copyText?(text: string): Promise<unknown>;
  liveRecording?: {
    start(jobId: string): Promise<unknown>;
    push(jobId: string, sequence: number, bytes: Uint8Array): Promise<unknown>;
    finish(jobId: string): Promise<unknown>;
  };
}

/** Mount with a key equal to draftKey. Both surfaces provide an immutable
 * target-bound port and their existing accessible dialog/focus shell. */
export function PromptComposer({ draftKey, targetLabel, online, speechAllowed, port }: {
  draftKey: string; targetLabel: string; online: boolean; speechAllowed: boolean; port: PromptComposerPort;
}) {
  // Access the browser getter inside the store's guarded read/write calls:
  // a disabled storage origin must still show an editable, copyable draft.
  const store = useRef(new PromptDraftStore({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }));
  const [storageError, setStorageError] = useState('');
  const [draft, setDraft] = useState<PromptDraft>(() => {
    try { return store.current.read(draftKey); } catch { return { text: '' }; }
  });
  const draftRef = useRef(draft); draftRef.current = draft;
  const [capability, setCapability] = useState<TerminalPromptCapability>({ available: false, reason: 'Sitzungsziel wird geprüft…' });
  const [phase, setPhase] = useState<'idle' | 'permission' | 'recording' | 'transcribing' | 'sending'>('idle');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [seconds, setSeconds] = useState(0);
  const [liveText, setLiveText] = useState(''); const liveTextRef = useRef('');
  const busy = useRef(false); const generation = useRef(0); const mounted = useRef(true);
  const recorder = useRef<DictationRecorder | LiveDictationRecorder | null>(null); const job = useRef<string | null>(null);
  const portRef = useRef(port); portRef.current = port;
  const initialPort = useRef(port); const input = useRef<HTMLTextAreaElement>(null);
  const savedKey = useRef(draftKey);
  const save = (next: PromptDraft): boolean => {
    draftRef.current = next; setDraft(next);
    try { store.current.save(savedKey.current, next); setStorageError(''); return true; }
    catch (reason) { setStorageError(reason instanceof Error ? reason.message : 'Entwurf ist nur bis zum Schliessen verfügbar.'); return false; }
  };
  useEffect(() => {
    mounted.current = true;
    try { store.current.read(savedKey.current); } catch (reason) { setStorageError(String(reason)); }
    return () => {
      mounted.current = false; generation.current++; recorder.current?.cancel();
      if (job.current) void initialPort.current.cancelRecording(job.current).catch(() => undefined);
      if (job.current && initialPort.current.liveRecording) {
        // Closing a live dock cancels that stream; do not leave a stale ticket
        // disabling the next recording when its saved draft is reopened.
        try { store.current.save(savedKey.current, { ...draftRef.current, recordingJob: undefined }); } catch { /* Keep the existing draft on storage failure. */ }
      }
      void initialPort.current.revokeMicrophone?.().catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    if (!online) return;
    let stopped = false;
    const refresh = () => { void portRef.current.capability().then(value => { if (!stopped) setCapability(value); })
      .catch(() => { if (!stopped) setCapability({ available: false, reason: 'Sitzung konnte nicht geprüft werden. Entwurf bleibt erhalten.' }); }); };
    refresh(); const timer = window.setInterval(refresh, 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, [online]);
  useEffect(() => {
    if (phase !== 'recording') return;
    const started = Date.now(); const timer = window.setInterval(() => setSeconds(Math.min(60, Math.floor((Date.now() - started) / 1000))), 250);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => { if (liveText && input.current) input.current.scrollTop = input.current.scrollHeight; }, [liveText]);
  const cancel = (preservePreview = false) => {
    const preview = preservePreview ? liveTextRef.current.trim() : '';
    generation.current++; recorder.current?.cancel(); recorder.current = null;
    const id = job.current; job.current = null; busy.current = false; setPhase('idle');
    liveTextRef.current = ''; setLiveText('');
    if (id) void portRef.current.cancelRecording(id).catch(() => undefined);
    void portRef.current.revokeMicrophone?.().catch(() => undefined);
    setNotice('Aufnahme abgebrochen. Bereits übertragene Audiodaten können beim Anbieter verarbeitet worden sein.');
    if (online || preservePreview) save({ ...draftRef.current, recordingJob: undefined,
      ...(preview ? { text: [draftRef.current.text, preview].filter(Boolean).join('\n').slice(0, DICTATION_MAX_TEXT_CHARS) } : {}) });
    if (preview) setNotice('Verbindung unterbrochen. Der letzte Zwischenstand wurde als Entwurf gesichert. Bitte auf Vollständigkeit prüfen.');
  };
  useEffect(() => { if (!online && recorder.current) cancel(true); }, [online]);

  const recover = async (id: string, own: number, wait: boolean) => {
    const target = portRef.current;
    while (mounted.current && generation.current === own) {
      const state = await target.readRecording(id);
      if (!mounted.current || generation.current !== own) return;
      if (state.status === 'recording' && wait) { liveTextRef.current = state.text; setLiveText(state.text); }
      if (['recording', 'transcribing'].includes(state.status) && wait) { await new Promise(done => setTimeout(done, 250)); continue; }
      if (state.status === 'complete') {
        const current = draftRef.current;
        const text = [current.text, state.transcript.text.trim()].filter(Boolean).join('\n');
        if (text.length > DICTATION_MAX_TEXT_CHARS) throw new Error('Transkript und Entwurf sind zusammen zu lang. Entwurf kürzen und Transkript erneut holen.');
        save({ ...current, text, recordingJob: undefined }); job.current = null;
        liveTextRef.current = ''; setLiveText('');
        setNotice(state.transcript.text.trim() ? 'Transkript eingefügt. Bitte prüfen, dann gezielt übergeben.' : 'Keine Sprache erkannt. Der Entwurf ist unverändert.');
        input.current?.focus(); return;
      }
      if (state.status === 'failed') throw new Error(state.message);
      if (state.status === 'cancelled' || state.status === 'prepared') throw new Error('Keine vollständige Aufnahme verfügbar. Bei Bedarf neu aufnehmen.');
      setNotice('Die Transkription läuft noch. Den Status später erneut prüfen.'); return;
    }
  };

  const record = async () => {
    if (busy.current || !online || !speechAllowed || draftRef.current.delivery) return;
    busy.current = true; const own = ++generation.current; const target = portRef.current;
    setError(''); setNotice(''); setPhase('permission'); setSeconds(0);
    liveTextRef.current = ''; setLiveText('');
    try {
      const prepared = await target.prepareRecording();
      if (!mounted.current || generation.current !== own) { void target.cancelRecording(prepared.jobId).catch(() => undefined); return; }
      job.current = prepared.jobId;
      if (!save({ ...draftRef.current, recordingJob: prepared.jobId })) { void target.cancelRecording(prepared.jobId).catch(() => undefined); throw new Error('Aufnahme nicht gestartet: Entwurf zuerst sichern.'); }
      await target.permitMicrophone?.();
      if (!mounted.current || generation.current !== own) return;
      if (target.liveRecording) {
        const live = target.liveRecording;
        const failLive = (reason: unknown) => {
          if (!mounted.current || generation.current !== own) return;
          generation.current++; recorder.current?.cancel(); recorder.current = null;
          void target.cancelRecording(prepared.jobId).catch(() => undefined);
          void target.revokeMicrophone?.().catch(() => undefined);
          const preview = liveTextRef.current.trim();
          const combined = [draftRef.current.text, preview].filter(Boolean).join('\n');
          save({ ...draftRef.current, text: combined.slice(0, DICTATION_MAX_TEXT_CHARS), recordingJob: undefined });
          liveTextRef.current = ''; setLiveText(''); job.current = null; busy.current = false; setPhase('idle');
          setError(reason instanceof Error ? reason.message : 'Live-Diktat unterbrochen.');
          if (preview) setNotice(combined.length > DICTATION_MAX_TEXT_CHARS ? 'Der Zwischenstand wurde an der maximalen Entwurfslänge gekürzt. Bitte auf Vollständigkeit prüfen.'
            : 'Der letzte Zwischenstand wurde als Entwurf gesichert. Bitte auf Vollständigkeit prüfen.');
        };
        await live.start(prepared.jobId);
        if (!mounted.current || generation.current !== own) { void target.cancelRecording(prepared.jobId).catch(() => undefined); return; }
        const capture = new LiveDictationRecorder(); recorder.current = capture; let sequence = 0;
        await capture.start(bytes => live.push(prepared.jobId, sequence++, bytes), done => {
          if (!mounted.current || generation.current !== own) return;
          recorder.current = null; setPhase('transcribing'); void target.revokeMicrophone?.().catch(() => undefined);
          void done.then(() => live.finish(prepared.jobId)).catch(failLive);
        });
        if (!mounted.current || generation.current !== own) return;
        if (recorder.current) setPhase('recording');
        void recover(prepared.jobId, own, true).catch(failLive).finally(() => {
          if (mounted.current && generation.current === own) { recorder.current = null; busy.current = false; setPhase('idle'); }
        });
        return;
      }
      const capture = new DictationRecorder(); recorder.current = capture;
      await capture.start(audio => {
        if (!mounted.current || generation.current !== own) return;
        recorder.current = null; setPhase('transcribing');
        void target.revokeMicrophone?.().catch(() => undefined);
        void (async () => {
          try {
            const bytes = await audio;
            if (!mounted.current || generation.current !== own) return;
            await target.uploadRecording(prepared.jobId, crypto.randomUUID(), bytes);
            await recover(prepared.jobId, own, true);
          } catch (reason) { if (mounted.current && generation.current === own) setError(reason instanceof Error ? reason.message : 'Transkription fehlgeschlagen. Status der Aufnahme prüfen.'); }
          finally { if (mounted.current && generation.current === own) { busy.current = false; setPhase('idle'); } }
        })();
      });
      if (mounted.current && generation.current === own && recorder.current) setPhase('recording');
    } catch (reason) {
      recorder.current?.cancel(); recorder.current = null;
      if (job.current) void target.cancelRecording(job.current).catch(() => undefined);
      if (mounted.current && generation.current === own) {
        job.current = null; save({ ...draftRef.current, recordingJob: undefined });
        setError(reason instanceof Error ? reason.message : 'Aufnahme konnte nicht gestartet werden.'); busy.current = false; setPhase('idle');
      }
      void target.revokeMicrophone?.().catch(() => undefined);
    }
  };
  const send = async (mode: 'insert' | 'submit') => {
    if (busy.current || !online || !capability.available || draftRef.current.delivery || !validPromptText(draftRef.current.text)) return;
    busy.current = true; setError(''); setNotice(''); const commandId = crypto.randomUUID();
    const outgoing = { ...draftRef.current, delivery: { commandId, mode } };
    if (!save(outgoing)) { busy.current = false; return; }
    setPhase('sending');
    try {
      await portRef.current.send(outgoing.text, mode, commandId);
      if (!mounted.current) return;
      save({ text: '', recordingJob: draftRef.current.recordingJob });
      setNotice(mode === 'submit' ? 'An die CLI übergeben. Die Verarbeitung durch das Modell ist damit noch nicht bestätigt.' : 'In die CLI eingefügt. Dort prüfen und mit Enter absenden.');
    } catch (reason) { if (mounted.current) setError(`${reason instanceof Error ? reason.message : 'Übergabe nicht bestätigt.'} Terminal prüfen; ADE sendet nicht automatisch erneut.`); }
    finally { busy.current = false; if (mounted.current) setPhase('idle'); }
  };
  const disabled = phase !== 'idle' || !online || !capability.available || !!draft.delivery || !validPromptText(draft.text);
  return <section className="prompt-composer" aria-label="Promptentwurf">
    <p className="prompt-target"><strong>An: {targetLabel}</strong></p>
    <p>Vor der Übergabe Anmeldung und Projektvertrauen direkt im Terminal abschliessen. Die CLI muss ihren Eingabeprompt anzeigen.</p>
    {!online && <p role="status">Offline. Der Entwurf kann weiter bearbeitet werden.</p>}
    {!capability.available && <p role="status">{capability.reason}</p>}
    <label>Prompt prüfen und bearbeiten<textarea ref={input} aria-label="CLI-Promptentwurf" rows={7} maxLength={DICTATION_MAX_TEXT_CHARS}
      readOnly={!!draft.delivery || !!port.liveRecording && phase !== 'idle'} value={[draft.text, liveText].filter(Boolean).join('\n')}
      onChange={event => save({ ...draftRef.current, text: event.target.value })} /></label>
    {port.liveRecording && phase === 'recording' && <p role="status">Live-Transkription · {liveText ? 'Zwischenstand – Wörter können sich noch ändern.' : 'Sprich jetzt. Der Text erscheint hier während der Aufnahme.'}</p>}
    <p className="prompt-help">Dieser Entwurf bleibt an diese Sitzung gebunden und wird auf diesem Gerät gespeichert. Aufnahmen dauern höchstens 60 Sekunden. {port.liveRecording ? 'Beim Diktieren wird das Audio laufend an ElevenLabs übertragen.' : 'Beim Transkribieren geht das Audio an ElevenLabs.'}</p>
    {storageError && <p role="alert">{storageError}</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="prompt-actions">
      <button type="button" disabled={phase !== 'idle' || !online || !speechAllowed || !!draft.delivery || !!draft.recordingJob} onClick={() => void record()}>Diktieren</button>
      {phase === 'recording' && <button type="button" onClick={() => recorder.current?.stop()}>Aufnahme stoppen · {seconds} s</button>}
      {['permission', 'recording', 'transcribing'].includes(phase) && <button type="button" onClick={() => cancel()}>Aufnahme abbrechen</button>}
      {phase === 'permission' && <span role="status">Mikrofon wird angefragt…</span>}{phase === 'transcribing' && <span role="status">Audio wird transkribiert…</span>}
      <button type="button" disabled={disabled} onClick={() => void send('insert')}>In CLI einfügen</button>
      <button type="button" disabled={disabled} onClick={() => void send('submit')}>An CLI absenden</button>
    </div>
    {!speechAllowed && <p>ElevenLabs-Diktat braucht die eigene Diktat-Freigabe am PC.</p>}
    {draft.recordingJob && phase === 'idle' && <div className="prompt-actions"><button type="button" disabled={!online} onClick={() => {
      if (busy.current) return; busy.current = true; const own = ++generation.current; setError(''); setPhase('transcribing');
      void recover(draft.recordingJob!, own, false).catch(reason => { if (mounted.current) setError(String(reason)); })
        .finally(() => { busy.current = false; if (mounted.current) setPhase('idle'); });
    }}>Status der Aufnahme prüfen</button><button type="button" onClick={() => { job.current = draft.recordingJob!; cancel(); save({ ...draftRef.current, recordingJob: undefined }); }}>Aufnahme verwerfen</button></div>}
    {draft.delivery && phase !== 'sending' && <div><p role="alert">Die vorige Übergabe ist nicht bestätigt. Vor erneutem Senden zuerst die CLI prüfen.</p>
      <button type="button" onClick={() => { save({ ...draftRef.current, delivery: undefined }); setError(''); }}>Terminal geprüft – Entwurf weiterbearbeiten</button></div>}
    {port.copyText && <button type="button" disabled={!draft.text && !liveText} onClick={() => {
      void portRef.current.copyText!([draftRef.current.text, liveTextRef.current].filter(Boolean).join('\n')).then(() => { if (mounted.current) setNotice('Entwurf kopiert.'); })
        .catch(() => { if (mounted.current) setError('Kopieren fehlgeschlagen. Text markieren und mit der Tastatur kopieren.'); });
    }}>Entwurf kopieren</button>}
    <button type="button" disabled={phase !== 'idle' || !!draft.delivery} onClick={() => { if (draft.recordingJob) void portRef.current.cancelRecording(draft.recordingJob).catch(() => undefined); save({ text: '' }); setError(''); setNotice('Entwurf gelöscht.'); }}>Entwurf löschen</button>
  </section>;
}
