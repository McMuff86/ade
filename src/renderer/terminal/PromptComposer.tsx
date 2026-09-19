import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useEffect, useRef, useState, type RefObject } from 'react';
import { DICTATION_MAX_SECONDS, DICTATION_MAX_TEXT_CHARS, validPromptText, type DictationJobState } from '../../shared/dictation';
import { LIVE_DICTATION_MAX_SECONDS } from '../../shared/liveDictation';
import type { TerminalPromptCapability, TerminalPromptReceipt } from '../../shared/terminalPrompt';
import { DictationRecorder } from './DictationRecorder';
import { LiveDictationRecorder } from './LiveDictationRecorder';
import { ComputerVoiceTest } from './ComputerVoiceTest';
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
  computerGreeting?(): Promise<import('../../shared/speech').SpeechAudio>;
  computerAllowed?: boolean;
  liveRecording?: {
    start(jobId: string): Promise<unknown>;
    push(jobId: string, sequence: number, bytes: Uint8Array): Promise<unknown>;
    finish(jobId: string): Promise<unknown>;
  };
}

export type PromptPhase = 'idle' | 'permission' | 'recording' | 'transcribing' | 'sending';
export type PromptNoticeKind = 'info' | 'transcribed' | 'empty' | 'submitted' | 'inserted' | 'cancelled' | 'recovered' | 'pending' | 'copied' | 'cleared';

export interface PromptComposerOptions { draftKey: string; online: boolean; speechAllowed: boolean; port: PromptComposerPort; sendBlockedReason?: string }

export interface PromptComposerState {
  draft: PromptDraft; liveText: string; value: string; phase: PromptPhase; seconds: number; maxSeconds: number;
  error: string; notice: string; noticeKind: PromptNoticeKind; storageError: string; capability: TerminalPromptCapability;
  computerBusy: boolean; setComputerBusy(busy: boolean): void; input: RefObject<HTMLTextAreaElement | null>;
  readOnly: boolean; canRecord: boolean; canSend: boolean; recordingOpen: boolean; deliveryOpen: boolean;
  setText(text: string): void; record(): Promise<void>; stop(): void; cancel(): void; send(mode: 'insert' | 'submit'): Promise<void>;
  copy(): void; clear(): void; checkRecording(): void; discardRecording(): void; acknowledgeDelivery(): void;
}

/** Recording, recovery, delivery and draft persistence shared by every prompt surface.
 * Mount the owning component with a key equal to draftKey. */
export function usePromptComposer({ draftKey, online, speechAllowed, port, sendBlockedReason }: PromptComposerOptions): PromptComposerState {
  // Access the browser getter inside the store's guarded read/write calls:
  // a disabled storage origin must still show an editable, copyable draft.
  const store = useRef(new PromptDraftStore({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }));
  const [storageError, setStorageError] = useState('');
  const [draft, setDraft] = useState<PromptDraft>(() => {
    try { return store.current.read(draftKey); } catch { return { text: '' }; }
  });
  const draftRef = useRef(draft); draftRef.current = draft;
  const [capability, setCapability] = useState<TerminalPromptCapability>({ available: false, reason: translate("Checking session target…") });
  const [phase, setPhase] = useState<PromptPhase>('idle');
  const [error, setError] = useState(''); const [seconds, setSeconds] = useState(0);
  const [noticeState, setNoticeState] = useState<{ text: string; kind: PromptNoticeKind }>(draft.recordingInterrupted
    ? { text: translate("Stop recording on change. Check recognized text before sending."), kind: 'recovered' } : { text: '', kind: 'info' });
  const setNotice = (text: string, kind: PromptNoticeKind = 'info') => setNoticeState({ text, kind });
  const [liveText, setLiveText] = useState(''); const liveTextRef = useRef('');
  const [computerBusy, setComputerBusyState] = useState(false);
  // A greeting hands over to dictation in the same tick the call settles; read the flag synchronously.
  const computerBusyRef = useRef(false);
  const setComputerBusy = (busy: boolean) => { computerBusyRef.current = busy; setComputerBusyState(busy); };
  const maxSeconds = port.liveRecording ? LIVE_DICTATION_MAX_SECONDS : DICTATION_MAX_SECONDS;
  const busy = useRef(false); const generation = useRef(0); const mounted = useRef(true);
  const recorder = useRef<DictationRecorder | LiveDictationRecorder | null>(null); const job = useRef<string | null>(null);
  const portRef = useRef(port); portRef.current = port;
  const initialPort = useRef(port); const input = useRef<HTMLTextAreaElement>(null);
  const savedKey = useRef(draftKey);
  const save = (next: PromptDraft): boolean => {
    draftRef.current = next; setDraft(next);
    try { store.current.save(savedKey.current, next); setStorageError(''); return true; }
    catch (reason) { setStorageError(reason instanceof Error ? reason.message : translate("Draft is only available until closing.")); return false; }
  };
  useEffect(() => {
    mounted.current = true;
    try { store.current.read(savedKey.current); } catch (reason) { setStorageError(String(reason)); }
    return () => {
      mounted.current = false; generation.current++; recorder.current?.cancel();
      if (job.current) void initialPort.current.cancelRecording(job.current).catch(() => undefined);
      if (job.current && initialPort.current.liveRecording) {
        // Preserve the last visible preview on its original target before
        // cancelling a stream during navigation. It is not a final transcript.
        const text = [draftRef.current.text, liveTextRef.current.trim()].filter(Boolean).join('\n').slice(0, DICTATION_MAX_TEXT_CHARS);
        try { store.current.save(savedKey.current, { ...draftRef.current, text, recordingJob: undefined, recordingInterrupted: true }); } catch { /* Keep the existing draft on storage failure. */ }
      }
      void initialPort.current.revokeMicrophone?.().catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    if (!online) return;
    let stopped = false;
    const refresh = () => { void portRef.current.capability().then(value => { if (!stopped) setCapability(value); })
      .catch(() => { if (!stopped) setCapability({ available: false, reason: translate("Could not check the session. Your draft has been preserved.") }); }); };
    refresh(); const timer = window.setInterval(refresh, 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, [online]);
  useEffect(() => {
    if (phase !== 'recording') return;
    const started = Date.now(); const timer = window.setInterval(() => setSeconds(Math.min(maxSeconds, Math.floor((Date.now() - started) / 1000))), 250);
    return () => clearInterval(timer);
  }, [phase, maxSeconds]);
  useEffect(() => { if (liveText && input.current) input.current.scrollTop = input.current.scrollHeight; }, [liveText]);
  const cancel = (preservePreview = false) => {
    const preview = preservePreview ? liveTextRef.current.trim() : '';
    generation.current++; recorder.current?.cancel(); recorder.current = null;
    const id = job.current; job.current = null; busy.current = false; setPhase('idle');
    liveTextRef.current = ''; setLiveText('');
    if (id) void portRef.current.cancelRecording(id).catch(() => undefined);
    void portRef.current.revokeMicrophone?.().catch(() => undefined);
    setNotice(translate("Recording cancelled. Audio already sent may have been processed by the provider."), 'cancelled');
    if (online || preservePreview) save({ ...draftRef.current, recordingJob: undefined,
      ...(preview ? { text: [draftRef.current.text, preview].filter(Boolean).join('\n').slice(0, DICTATION_MAX_TEXT_CHARS) } : {}) });
    if (preview) setNotice(translate("Interrupted. The last intermediary was secured as a draft. Please check for completeness."), 'recovered');
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
        if (text.length > DICTATION_MAX_TEXT_CHARS) throw new Error(translate("Transcript and draft are too long together, shorten draft and retrieve transcript."));
        save({ ...current, text, recordingJob: undefined }); job.current = null;
        liveTextRef.current = ''; setLiveText('');
        if (state.transcript.text.trim()) setNotice(translate("Inserted transcript. Please check, then handed over specifically."), 'transcribed');
        else setNotice(translate("No speech detected. Your draft is unchanged."), 'empty');
        input.current?.focus(); return;
      }
      if (state.status === 'failed') throw new Error(state.message);
      if (state.status === 'cancelled' || state.status === 'prepared') throw new Error(translate("No full recording available. Re-recorded as needed."));
      setNotice(translate("The transcription is still ongoing. Check the status again later."), 'pending'); return;
    }
  };

  const record = async () => {
    if (busy.current || computerBusyRef.current || !online || !speechAllowed || draftRef.current.delivery || draftRef.current.recordingJob) return;
    busy.current = true; const own = ++generation.current; const target = portRef.current;
    setError(''); setNotice(''); setPhase('permission'); setSeconds(0);
    liveTextRef.current = ''; setLiveText('');
    try {
      const prepared = await target.prepareRecording();
      if (!mounted.current || generation.current !== own) { void target.cancelRecording(prepared.jobId).catch(() => undefined); return; }
      job.current = prepared.jobId;
      if (!save({ ...draftRef.current, recordingJob: prepared.jobId })) { void target.cancelRecording(prepared.jobId).catch(() => undefined); throw new Error(translate("Recording not started: backup draft first.")); }
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
          setError(reason instanceof Error ? reason.message : translate("Live dictation interrupted."));
          if (preview) setNotice(combined.length > DICTATION_MAX_TEXT_CHARS ? translate("The partial transcript was truncated at the maximum draft length. Check that it is complete.")
            : translate("The last interim status has been secured as a draft and please check for completeness."), 'recovered');
        };
        const capture = new LiveDictationRecorder(); recorder.current = capture; let sequence = 0;
        await capture.prepare();
        if (!mounted.current || generation.current !== own) return;
        await live.start(prepared.jobId);
        if (!mounted.current || generation.current !== own) { void target.cancelRecording(prepared.jobId).catch(() => undefined); return; }
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
          } catch (reason) { if (mounted.current && generation.current === own) setError(reason instanceof Error ? reason.message : translate("Transcription failed. Check status of recording.")); }
          finally { if (mounted.current && generation.current === own) { busy.current = false; setPhase('idle'); } }
        })();
      });
      if (mounted.current && generation.current === own && recorder.current) setPhase('recording');
    } catch (reason) {
      if (!mounted.current || generation.current !== own) return;
      recorder.current?.cancel(); recorder.current = null;
      if (job.current) void target.cancelRecording(job.current).catch(() => undefined);
      if (mounted.current && generation.current === own) {
        job.current = null; save({ ...draftRef.current, recordingJob: undefined });
        setError(reason instanceof Error ? reason.message : translate("Recording could not be started.")); busy.current = false; setPhase('idle');
      }
      void target.revokeMicrophone?.().catch(() => undefined);
    }
  };
  const send = async (mode: 'insert' | 'submit') => {
    if (busy.current || computerBusy || !online || sendBlockedReason || !capability.available || draftRef.current.delivery || !validPromptText(draftRef.current.text)) return;
    busy.current = true; setError(''); setNotice(''); const commandId = crypto.randomUUID();
    const outgoing = { ...draftRef.current, delivery: { commandId, mode } };
    if (!save(outgoing)) { busy.current = false; return; }
    setPhase('sending');
    try {
      await portRef.current.send(outgoing.text, mode, commandId);
      if (!mounted.current) return;
      save({ text: '', recordingJob: draftRef.current.recordingJob });
      if (mode === 'submit') setNotice(translate("Handed over to the CLI. The processing by the model has not yet been confirmed."), 'submitted');
      else setNotice(translate("Inserted into the CLI. Check there and send with Enter."), 'inserted');
    } catch (reason) { if (mounted.current) setError(translate("{{value1}} Check the terminal; ADE will not send again automatically.", { value1: reason instanceof Error ? reason.message : translate("Delivery not confirmed.") })); }
    finally { busy.current = false; if (mounted.current) setPhase('idle'); }
  };
  const checkRecording = () => {
    if (busy.current || !draft.recordingJob) return;
    busy.current = true; const own = ++generation.current; setError(''); setPhase('transcribing');
    void recover(draft.recordingJob, own, false).catch(reason => { if (mounted.current) setError(String(reason)); })
      .finally(() => { busy.current = false; if (mounted.current) setPhase('idle'); });
  };
  const discardRecording = () => {
    if (!draft.recordingJob) return;
    job.current = draft.recordingJob; cancel(); save({ ...draftRef.current, recordingJob: undefined });
  };
  const copy = () => {
    if (!portRef.current.copyText) return;
    void portRef.current.copyText([draftRef.current.text, liveTextRef.current].filter(Boolean).join('\n')).then(() => { if (mounted.current) setNotice(translate("Draft copied."), 'copied'); })
      .catch(() => { if (mounted.current) setError(translate("Copy failed. Mark text and copy it with the keyboard.")); });
  };
  const clear = () => {
    if (phase !== 'idle' || draft.delivery) return;
    if (draft.recordingJob) void portRef.current.cancelRecording(draft.recordingJob).catch(() => undefined);
    save({ text: '' }); setError(''); setNotice(translate("Draft deleted."), 'cleared');
  };
  const canSend = !computerBusy && phase === 'idle' && online && !sendBlockedReason && capability.available && !draft.delivery && validPromptText(draft.text);
  const canRecord = !computerBusy && phase === 'idle' && online && speechAllowed && !draft.delivery && !draft.recordingJob;
  return {
    draft, liveText, value: [draft.text, liveText].filter(Boolean).join('\n'), phase, seconds, maxSeconds,
    error, notice: noticeState.text, noticeKind: noticeState.kind, storageError, capability, computerBusy, setComputerBusy, input,
    readOnly: !!draft.delivery || !!port.liveRecording && phase !== 'idle', canRecord, canSend,
    recordingOpen: !!draft.recordingJob && phase === 'idle', deliveryOpen: !!draft.delivery && phase !== 'sending',
    setText: text => save({ ...draftRef.current, text }), record, stop: () => recorder.current?.stop(), cancel: () => cancel(), send,
    copy, clear, checkRecording, discardRecording, acknowledgeDelivery: () => { save({ ...draftRef.current, delivery: undefined }); setError(''); },
  };
}

/** Mount with a key equal to draftKey. Both surfaces provide an immutable
 * target-bound port and their existing accessible dialog/focus shell. */
export function PromptComposer({ draftKey, targetLabel, online, speechAllowed, port, sendBlockedReason }: {
  draftKey: string; targetLabel: string; online: boolean; speechAllowed: boolean; port: PromptComposerPort;
  sendBlockedReason?: string;
}) {
  useLocale();
  const composer = usePromptComposer({ draftKey, online, speechAllowed, port, sendBlockedReason });
  const { draft, liveText, phase, seconds, maxSeconds, error, notice, storageError, capability } = composer;
  return <section className="prompt-composer" aria-label={translate("Prompt draft")}>
    <p className="prompt-target"><strong>{translate("To:")}{" "}{targetLabel}</strong></p>
    {port.computerGreeting && <ComputerVoiceTest port={port} onBusy={composer.setComputerBusy}
      enabled={online && speechAllowed && port.computerAllowed !== false && phase === 'idle' && !draft.delivery && !draft.recordingJob} />}
    <p>{translate("Before sending, complete sign-in and project trust directly in the terminal. The CLI must show its input prompt.")}</p>
    {!online && <p role="status">{translate("Offline. The draft can be further edited.")}</p>}
    {sendBlockedReason && <p role="status">{sendBlockedReason}{translate(". You can still edit the draft.")}</p>}
    {!capability.available && <p role="status">{capability.reason}</p>}
    <label>{translate("Review and edit prompt")}<textarea ref={composer.input} aria-label={translate("CLI-prompt draft")} rows={7} maxLength={DICTATION_MAX_TEXT_CHARS}
      readOnly={composer.readOnly} value={composer.value} onChange={event => composer.setText(event.target.value)} /></label>
    {port.liveRecording && phase === 'recording' && <p role="status">{translate("Live transcription ·")}{" "}{liveText ? translate("Intermediate – Words can still change.") : translate("Speak now. The text appears here during the recording.")}</p>}
    <p className="prompt-help">{translate("This draft stays tied to this session and is saved on this device. Recordings last at most")}{" "}{maxSeconds >= 120 ? translate("{{value1}} minutes", { value1: maxSeconds / 60 }) : translate("{{value1}} seconds", { value1: maxSeconds })}. {port.liveRecording ? translate("When dictating, the audio is continuously transmitted to ElevenLabs.") : translate("When transcribing, the audio goes to ElevenLabs.")}</p>
    {storageError && <p role="alert">{storageError}</p>}{error && <p role="alert">{localizeAppMessage(error)}</p>}{notice && <p role="status">{localizeAppMessage(notice)}</p>}
    <div className="prompt-actions">
      <button type="button" disabled={!composer.canRecord} onClick={() => void composer.record()}>{translate("Dictate")}</button>
      {phase === 'recording' && <button type="button" onClick={composer.stop}>{translate("Stop recording ·")}{" "}{seconds} {" "}{translate("s")}</button>}
      {['permission', 'recording', 'transcribing'].includes(phase) && <button type="button" onClick={composer.cancel}>{translate("Cancel recording")}</button>}
      {phase === 'permission' && <span role="status">{translate("Requesting microphone…")}</span>}{phase === 'transcribing' && <span role="status">{translate("Transcribing audio…")}</span>}
      <button type="button" disabled={!composer.canSend} onClick={() => void composer.send('insert')}>{translate("Insert to CLI")}</button>
      <button type="button" disabled={!composer.canSend} onClick={() => void composer.send('submit')}>{translate("Submit to CLI")}</button>
    </div>
    {!speechAllowed && <p>{translate("ElevenLabs dictation needs its own dictation permission on the PC.")}</p>}
    {composer.recordingOpen && <div className="prompt-actions"><button type="button" disabled={!online} onClick={composer.checkRecording}>{translate("Check recording status")}</button>
      <button type="button" onClick={composer.discardRecording}>{translate("Discard recording")}</button></div>}
    {composer.deliveryOpen && <div><p role="alert">{translate("The previous handover is not confirmed, and before re-sending, check the CLI first.")}</p>
      <button type="button" onClick={composer.acknowledgeDelivery}>{translate("Terminal inspected – continue working on the draft")}</button></div>}
    {port.copyText && <button type="button" disabled={!draft.text && !liveText} onClick={composer.copy}>{translate("Copy draft")}</button>}
    <button type="button" disabled={phase !== 'idle' || !!draft.delivery} onClick={composer.clear}>{translate("Delete the draft")}</button>
  </section>;
}
