import { t as translate } from "../../shared/i18n";
import { useEffect, useRef, useState } from 'react';
import { isComputerCall, type SpeechAudio } from '../../shared/speech';
import { LiveDictationRecorder } from './LiveDictationRecorder';
import type { PromptComposerPort } from './PromptComposer';

export type ComputerPhase = 'idle' | 'preparing' | 'listening' | 'finishing' | 'greeting' | 'speaking';

export interface ComputerCall {
  phase: ComputerPhase; active: boolean; status: string; error: string; reply: SpeechAudio | undefined;
  /** Start a call, or replay a greeting already received without another synthesis. */
  run(replay?: SpeechAudio): Promise<void>;
  stop(): void;
  dismiss(): void;
}

/** Explicit, foreground-only call-and-response shared by the desktop test box and
 * the tablet voice strip. It never writes a prompt; the caller decides what
 * follows a played greeting. */
export function useComputerCall(port: PromptComposerPort, { enabled, onBusy, onSettled, onGreeted }: {
  enabled: boolean; onBusy(busy: boolean): void; onSettled?(): void; onGreeted?(audio: SpeechAudio): void;
}): ComputerCall {
  const [phase, setPhase] = useState<ComputerPhase>('idle'); const [status, setStatus] = useState('');
  const [error, setError] = useState(''); const [reply, setReply] = useState<SpeechAudio>();
  const sequence = useRef(0); const busy = useRef(false); const mounted = useRef(true);
  const capture = useRef<LiveDictationRecorder | undefined>(undefined); const job = useRef<string | undefined>(undefined);
  const output = useRef<AudioContext | undefined>(undefined); const finishPlayback = useRef<(() => void) | undefined>(undefined);
  const listenTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = useRef({ port, onBusy, onSettled, onGreeted, enabled }); current.current = { port, onBusy, onSettled, onGreeted, enabled };
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
    if (mounted.current) { setPhase('idle'); setStatus(translate("Computer voice test ended.")); current.current.onSettled?.(); }
  };
  useEffect(() => {
    mounted.current = true;
    const hidden = () => { if (document.hidden && busy.current) stop(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { mounted.current = false; sequence.current++; release(); current.current.onBusy(false); document.removeEventListener('visibilitychange', hidden); };
  }, []);
  useEffect(() => { if (!enabled && busy.current) stop(); }, [enabled]);

  const run = async (replay?: SpeechAudio) => {
    const { port: target } = current.current;
    if (busy.current || !current.current.enabled || !target.liveRecording || !target.computerGreeting) return;
    busy.current = true; current.current.onBusy(true); setPhase('preparing'); setError('');
    const own = ++sequence.current; const valid = () => mounted.current && sequence.current === own;
    let played: SpeechAudio | undefined;
    try {
      // Resume in the click/keyboard gesture so tablet playback is already unlocked.
      const context = new AudioContext(); output.current = context;
      await context.resume();
      if (!valid()) return;
      let audio = replay;
      if (!audio) {
        setReply(undefined); setStatus(translate("Microphone is being prepared…"));
        const prepared = await target.prepareRecording();
        if (!valid()) { void target.cancelRecording(prepared.jobId).catch(() => undefined); return; }
        job.current = prepared.jobId;
        await target.permitMicrophone?.(); if (!valid()) return;
        const recorder = new LiveDictationRecorder(); capture.current = recorder;
        await recorder.prepare(); if (!valid()) return;
        await target.liveRecording.start(prepared.jobId); if (!valid()) return;
        let packet = 0; let complete!: (done: Promise<void>) => void;
        const stopped = new Promise<void>((resolve, reject) => { complete = done => { void done.then(resolve, reject); }; });
        void stopped.catch(() => undefined);
        await recorder.start(bytes => target.liveRecording!.push(prepared.jobId, packet++, bytes), complete);
        if (!valid()) return;
        setPhase('listening'); setStatus(translate("I'm listening. Now say \"computer.\""));
        listenTimer.current = setTimeout(() => recorder.stop(), 20_000);
        const deadline = Date.now() + 20_000; let heard = false;
        while (valid() && Date.now() < deadline) {
          const state = await target.readRecording(prepared.jobId); if (!valid()) return;
          if (state.status === 'failed') throw new Error(state.message);
          if (state.status === 'recording' && isComputerCall(state.text)) { heard = true; break; }
          await new Promise(done => setTimeout(done, 250));
        }
        if (!valid()) return;
        clearTimeout(listenTimer.current); recorder.stop(); await stopped; if (!valid()) return;
        capture.current = undefined; await target.revokeMicrophone?.();
        if (!heard) throw new Error(translate("\"Computer\" was not detected. You can start the test again."));
        setPhase('finishing'); setStatus(translate("“Computer” is heard. Greetings are being prepared…"));
        await target.liveRecording.finish(prepared.jobId); if (!valid()) return;
        const finalDeadline = Date.now() + 16_000; let finalized = false;
        while (valid() && Date.now() < finalDeadline) {
          const state = await target.readRecording(prepared.jobId); if (!valid()) return;
          // A short call can be revised/omitted in the final provider segment.
          // The isolated live call already authorizes only this harmless greeting;
          // never use this rule for task submission or other consequential actions.
          if (state.status === 'complete') { finalized = true; break; }
          if (state.status === 'failed') throw new Error(state.message);
          await new Promise(done => setTimeout(done, 250));
        }
        if (!valid()) return;
        if (!finalized) throw new Error(translate("Recording completion could not be confirmed. Please try again."));
        job.current = undefined;
        setPhase('greeting');
        audio = await target.computerGreeting(); if (!valid()) return;
        setReply(audio);
      }
      const bytes = Uint8Array.from(atob(audio.base64), char => char.charCodeAt(0));
      const buffer = await context.decodeAudioData(bytes.buffer); if (!valid()) return;
      if (context.state !== 'running') throw new Error(translate("Audio was stopped by the browser. Tap on \"play greeting\"."));
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
      setPhase('speaking'); setStatus(translate("Computer is replying…"));
      await new Promise<void>(done => { finishPlayback.current = done; source.onended = () => { source.disconnect(); done(); }; source.start(); });
      if (valid()) { setStatus(translate("Greeting played. You can now dictate a task.")); played = audio; }
    } catch (reason) {
      if (valid()) { setError(reason instanceof Error ? reason.message : translate("Computer test could not be completed.")); setStatus(''); }
    } finally {
      if (valid()) { release(); busy.current = false; current.current.onBusy(false); setPhase('idle'); current.current.onSettled?.(); }
    }
    if (played && mounted.current && sequence.current === own) current.current.onGreeted?.(played);
  };
  const dismiss = () => { if (!busy.current) { setReply(undefined); setStatus(''); setError(''); } };
  return { phase, active: phase !== 'idle', status, error, reply, run, stop, dismiss };
}
