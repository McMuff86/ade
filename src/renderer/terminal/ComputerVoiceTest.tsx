import { useEffect, useRef, useState } from 'react';
import { isComputerCall, type SpeechAudio } from '../../shared/speech';
import { LiveDictationRecorder } from './LiveDictationRecorder';
import type { PromptComposerPort } from './PromptComposer';

/** Explicit, foreground-only call-and-response. This component never writes a prompt. */
export function ComputerVoiceTest({ port, enabled, onBusy }: {
  port: PromptComposerPort; enabled: boolean; onBusy(busy: boolean): void;
}) {
  const [active, setActive] = useState(false); const [status, setStatus] = useState('');
  const [error, setError] = useState(''); const [reply, setReply] = useState<SpeechAudio>();
  const sequence = useRef(0); const busy = useRef(false); const mounted = useRef(true);
  const capture = useRef<LiveDictationRecorder | undefined>(undefined); const job = useRef<string | undefined>(undefined);
  const output = useRef<AudioContext | undefined>(undefined); const finishPlayback = useRef<(() => void) | undefined>(undefined);
  const listenTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const button = useRef<HTMLButtonElement>(null); const current = useRef({ port, onBusy }); current.current = { port, onBusy };
  const restoreFocus = () => requestAnimationFrame(() => { if (mounted.current && !busy.current) button.current?.focus(); });
  const release = () => {
    clearTimeout(listenTimer.current); listenTimer.current = undefined;
    capture.current?.cancel(); capture.current = undefined;
    if (job.current) void current.current.port.cancelRecording(job.current).catch(() => undefined);
    job.current = undefined;
    void current.current.port.revokeMicrophone?.().catch(() => undefined);
    finishPlayback.current?.(); finishPlayback.current = undefined;
    if (output.current) void output.current.close().catch(() => undefined); output.current = undefined;
  };
  const stop = () => {
    sequence.current++; release(); busy.current = false; current.current.onBusy(false);
    if (mounted.current) { setActive(false); setStatus('Computer-Test beendet.'); restoreFocus(); }
  };
  useEffect(() => {
    mounted.current = true;
    const hidden = () => { if (document.hidden && busy.current) stop(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { mounted.current = false; sequence.current++; release(); current.current.onBusy(false); document.removeEventListener('visibilitychange', hidden); };
  }, []);
  useEffect(() => { if (!enabled && busy.current) stop(); }, [enabled]);

  const run = async (replay?: SpeechAudio) => {
    if (busy.current || !enabled || !port.liveRecording || !port.computerGreeting) return;
    busy.current = true; onBusy(true); setActive(true); setError('');
    const own = ++sequence.current; const valid = () => mounted.current && sequence.current === own;
    try {
      // Resume in the click/keyboard gesture so tablet playback is already unlocked.
      const context = new AudioContext(); output.current = context;
      await context.resume();
      if (!valid()) return;
      let audio = replay;
      if (!audio) {
        setReply(undefined); setStatus('Mikrofon wird vorbereitet…');
        const prepared = await port.prepareRecording();
        if (!valid()) { void port.cancelRecording(prepared.jobId).catch(() => undefined); return; }
        job.current = prepared.jobId;
        await port.permitMicrophone?.(); if (!valid()) return;
        const recorder = new LiveDictationRecorder(); capture.current = recorder;
        await recorder.prepare(); if (!valid()) return;
        await port.liveRecording.start(prepared.jobId); if (!valid()) return;
        let packet = 0; let complete!: (done: Promise<void>) => void;
        const stopped = new Promise<void>((resolve, reject) => { complete = done => { void done.then(resolve, reject); }; });
        void stopped.catch(() => undefined);
        await recorder.start(bytes => port.liveRecording!.push(prepared.jobId, packet++, bytes), complete);
        if (!valid()) return;
        setStatus('Ich höre zu. Sage jetzt „Computer“.');
        listenTimer.current = setTimeout(() => recorder.stop(), 20_000);
        const deadline = Date.now() + 20_000; let heard = false;
        while (valid() && Date.now() < deadline) {
          const state = await port.readRecording(prepared.jobId); if (!valid()) return;
          if (state.status === 'failed') throw new Error(state.message);
          if (state.status === 'recording' && isComputerCall(state.text)) { heard = true; break; }
          await new Promise(done => setTimeout(done, 250));
        }
        if (!valid()) return;
        clearTimeout(listenTimer.current); recorder.stop(); await stopped; if (!valid()) return;
        capture.current = undefined; await port.revokeMicrophone?.();
        if (!heard) throw new Error('„Computer“ wurde nicht erkannt. Du kannst den Test erneut starten.');
        setStatus('„Computer“ gehört. Begrüssung wird vorbereitet…');
        await port.liveRecording.finish(prepared.jobId); if (!valid()) return;
        const finalDeadline = Date.now() + 16_000; let finalized = false;
        while (valid() && Date.now() < finalDeadline) {
          const state = await port.readRecording(prepared.jobId); if (!valid()) return;
          // A short call can be revised/omitted in the final provider segment.
          // The isolated live call already authorizes only this harmless greeting;
          // never use this rule for task submission or other consequential actions.
          if (state.status === 'complete') { finalized = true; break; }
          if (state.status === 'failed') throw new Error(state.message);
          await new Promise(done => setTimeout(done, 250));
        }
        if (!valid()) return;
        if (!finalized) throw new Error('Aufnahmeabschluss konnte nicht bestätigt werden. Bitte erneut versuchen.');
        job.current = undefined;
        audio = await port.computerGreeting(); if (!valid()) return;
        setReply(audio);
      }
      const bytes = Uint8Array.from(atob(audio.base64), char => char.charCodeAt(0));
      const buffer = await context.decodeAudioData(bytes.buffer); if (!valid()) return;
      if (context.state !== 'running') throw new Error('Audio wurde vom Browser angehalten. Tippe auf „Begrüssung abspielen“.');
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
      setStatus('Computer antwortet…');
      await new Promise<void>(done => { finishPlayback.current = done; source.onended = () => { source.disconnect(); done(); }; source.start(); });
      if (valid()) setStatus('Begrüssung abgespielt. Du kannst jetzt eine Aufgabe diktieren.');
    } catch (reason) {
      if (valid()) { setError(reason instanceof Error ? reason.message : 'Computer-Test konnte nicht abgeschlossen werden.'); setStatus(''); }
    } finally {
      if (valid()) { release(); busy.current = false; onBusy(false); setActive(false); restoreFocus(); }
    }
  };
  return <section className="computer-voice-test" aria-label="Computer Sprachtest">
    <div className="prompt-actions">
      <button ref={button} type="button" disabled={!enabled || active} onClick={() => void run()}>Computer testen</button>
      {active && <button type="button" onClick={stop}>Computer-Test beenden</button>}
      {reply && !active && <button type="button" disabled={!enabled} onClick={() => void run(reply)}>Begrüssung abspielen</button>}
    </div>
    <p className="prompt-help">Aktivieren, dann „Computer“ sagen. Kurze Begrüssung mit der ADE-Standardstimme. Der Test hört bis zu 20 Sekunden zu; dieses Fenster offen lassen. Verwendet ElevenLabs für Erkennung und Stimme.</p>
    {!enabled && <p className="prompt-help">Benötigt eine freie Diktatfunktion und auf dem Tablet auch die Freigabe für Stimmen.</p>}
    {status && <p role="status">{status}</p>}{reply && <p aria-label="Computer Antwort">{reply.text}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
