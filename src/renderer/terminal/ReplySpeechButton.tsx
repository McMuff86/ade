import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MAX_REPLY_SOURCE_CHARS, type ReplyInput, type ReplyMode, type ReplyPreview, type ReplyResult, type ReplySource } from '../../shared/terminalSpeech';
import type { SpeechAudio } from '../../shared/speech';
import './reply-speech.css';

export interface ReplySpeechPort {
  prepare(input: ReplyInput): Promise<ReplyResult>;
  speak(replyId: string): Promise<ReplyResult>;
  read(replyId: string): Promise<ReplyResult>;
  cancel(replyId: string): Promise<unknown>;
}

export function ReplySpeechButton({ port, readSource, active, disabled = false, fallbackFocus, buttonContainer, label = translate("Listen to the reply"), sheetContainer, onOpenChange }: {
  port: ReplySpeechPort; readSource: () => ReplySource; active: boolean; disabled?: boolean; fallbackFocus: () => HTMLElement | null;
  buttonContainer?: HTMLElement | null; label?: string;
  /** With a sheet container the reply opens inside the voice strip instead of a modal dialog. */
  sheetContainer?: HTMLElement | null; onOpenChange?: (open: boolean) => void;
}) {
  useLocale();
  const [source, setSource] = useState<ReplySource>(); const [error, setError] = useState('');
  const button = useRef<HTMLButtonElement>(null); const context = useRef<AudioContext | undefined>(undefined);
  const openChange = useRef(onOpenChange); openChange.current = onOpenChange;
  const close = () => { setSource(undefined); void context.current?.close().catch(() => undefined); context.current = undefined; };
  useEffect(() => { if (!active || disabled) close(); }, [active, disabled]);
  useEffect(() => () => { void context.current?.close().catch(() => undefined); }, []);
  const opened = !!source;
  // Synchronous so the strip has restored its row before focus returns to the trigger.
  useLayoutEffect(() => { openChange.current?.(opened); return () => { if (opened) openChange.current?.(false); }; }, [opened]);
  const trigger = <>
    <button ref={button} type="button" aria-haspopup="dialog" aria-expanded={!!source} disabled={disabled || !active}
      onPointerDown={event => event.preventDefault()} onClick={async () => {
      setError('');
      try {
        let captured = readSource();
        button.current?.focus();
        // xterm parses a freshly written frame asynchronously; give a just-resized screen one beat.
        if (!captured.text.trim()) { await new Promise(done => setTimeout(done, 200)); captured = readSource(); }
        if (!captured.text.trim()) throw new Error(translate("There is no reply to read aloud yet."));
        if (captured.text.length > MAX_REPLY_SOURCE_CHARS) throw new Error(translate("Please mark a shorter section with a maximum of 12,000 characters."));
        context.current = new AudioContext(); void context.current.resume().catch(() => undefined);
        setSource(captured);
      } catch (reason) { setError(reason instanceof Error ? reason.message : translate("The answer could not be read.")); }
    }}>{label}</button>
    {error && <span role="alert" className="reply-speech-error">{localizeAppMessage(error)}</span>}
  </>;
  const restoreFocus = () => button.current?.isConnected && button.current.getClientRects().length ? button.current : fallbackFocus();
  return <>
    {buttonContainer === undefined ? trigger : buttonContainer ? createPortal(trigger, buttonContainer) : null}
    {source && (sheetContainer
      ? createPortal(<ReplySpeechSheet source={source} port={port} context={context.current!} onClose={close} restoreFocus={restoreFocus} />, sheetContainer)
      : <ReplySpeechDialog source={source} port={port} context={context.current!} onClose={close} restoreFocus={restoreFocus} />)}
  </>;
}

interface ReplyShellProps { source: ReplySource; port: ReplySpeechPort; context: AudioContext; onClose: () => void; restoreFocus: () => HTMLElement | null }

/** Preview, synthesis and playback state shared by the modal dialog and the strip sheet. */
function useReplySpeech({ source, port, context, onClose }: Omit<ReplyShellProps, 'restoreFocus'>) {
  const [mode, setMode] = useState<ReplyMode>('full'); const [preview, setPreview] = useState<ReplyPreview>();
  const [draft, setDraft] = useState(source.text);
  const [status, setStatus] = useState(translate("The answer is being prepared…")); const [error, setError] = useState('');
  const [busy, setBusy] = useState(true); const [hasAudio, setHasAudio] = useState(false);
  const generation = useRef(0); const replyId = useRef<string | undefined>(undefined); const audio = useRef<SpeechAudio | undefined>(undefined);
  const playback = useRef<AudioBufferSourceNode | undefined>(undefined); const locked = useRef(false); const mounted = useRef(true);
  const close = useRef(onClose); close.current = onClose;
  const stopAudio = () => { const current = playback.current; playback.current = undefined; if (current) { current.onended = null; current.stop(); current.disconnect(); } };
  const discard = () => { const id = replyId.current; replyId.current = undefined; if (id) void port.cancel(id).catch(() => undefined); };
  useEffect(() => {
    mounted.current = true;
    const hide = () => { if (document.hidden) close.current(); };
    document.addEventListener('visibilitychange', hide);
    return () => { mounted.current = false; generation.current++; stopAudio(); discard(); document.removeEventListener('visibilitychange', hide); };
  }, []);
  const previewText = useRef('');
  const play = async (id: string, own: number) => {
    const current = () => mounted.current && generation.current === own;
    try {
      if (!audio.current) {
        setStatus(translate("The voice is being prepared…")); await port.speak(id);
        if (!current()) return;
        const result = await port.read(id); if (!current()) return;
        if (!result.audio || result.audio.text !== previewText.current) throw new Error(translate("The voice response could not be assigned. Open it again."));
        audio.current = result.audio; setHasAudio(true);
      }
      const bytes = Uint8Array.from(atob(audio.current.base64), c => c.charCodeAt(0));
      const buffer = await context.decodeAudioData(bytes.buffer); if (!current()) return;
      if (context.state !== 'running') throw new Error(translate("Tap “Listen” to start playback."));
      const node = context.createBufferSource(); node.buffer = buffer; node.connect(context.destination); playback.current = node;
      node.onended = () => { node.disconnect(); if (playback.current === node) playback.current = undefined;
        if (current()) { locked.current = false; setBusy(false); setStatus(translate("Done. You can listen to the reply again.")); } };
      setStatus(translate('Reading the text aloud…')); node.start();
    } catch (reason) {
      if (current()) { locked.current = false; setBusy(false); setStatus(''); setError(reason instanceof Error ? reason.message : translate("Voice output is not available at the moment.")); }
    }
  };
  const prepare = async (selectedMode: ReplyMode) => {
    const own = ++generation.current; locked.current = true; stopAudio(); discard(); audio.current = undefined; setHasAudio(false);
    setBusy(true); setPreview(undefined); setError(''); setStatus(translate("The answer is being prepared…"));
    const current = () => mounted.current && generation.current === own;
    try {
      const prepared = await port.prepare({ ...source, text: draft, mode: selectedMode });
      if (!prepared.replyId) throw new Error(translate("The answer could not be prepared."));
      if (!current()) { void port.cancel(prepared.replyId).catch(() => undefined); return; }
      replyId.current = prepared.replyId;
      const result = await port.read(prepared.replyId); if (!current()) return;
      if (!result.preview) throw new Error(translate("The speech text is no longer available."));
      previewText.current = result.preview.text; setPreview(result.preview);
      locked.current = false; setBusy(false); setStatus(translate("Ready to listen."));
    } catch (reason) { if (current()) { locked.current = false; setBusy(false); setStatus(''); setError(reason instanceof Error ? reason.message : translate("The answer could not be prepared.")); } }
  };
  useEffect(() => { void prepare('full'); }, []);
  const stop = () => { generation.current++; stopAudio(); if (!audio.current) { discard(); setPreview(undefined); }
    locked.current = false; setBusy(false); setStatus(translate("Stopped.")); setError(''); };
  const edit = (text: string) => {
    generation.current++; stopAudio(); discard(); audio.current = undefined; setHasAudio(false); setPreview(undefined);
    setDraft(text); setError(''); setStatus(translate("Modified text. Please check Speech text again."));
  };
  const choose = (next: ReplyMode) => { setMode(next); void prepare(next); };
  const listen = () => {
    if (locked.current) return; locked.current = true; setBusy(true); setError('');
    void context.resume().catch(() => undefined);
    if (replyId.current) void play(replyId.current, ++generation.current);
  };
  return { mode, choose, preview, draft, edit, status, error, busy, hasAudio, prepare, listen, stop };
}

function ReplySpeechDialog({ source, port, context, onClose, restoreFocus }: ReplyShellProps) {
  useLocale();
  const dialog = useRef<HTMLDialogElement>(null); const title = useId(); const heading = useRef<HTMLHeadingElement>(null);
  const reply = useReplySpeech({ source, port, context, onClose });
  const { mode, preview, draft, status, error, busy, hasAudio } = reply;
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal(); heading.current?.focus();
    return () => { element.close(); restoreFocus()?.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="reply-speech-dialog" aria-labelledby={title} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}>
    <header><h2 ref={heading} id={title} tabIndex={-1}>{translate("Listen to the reply")}</h2><button type="button" onClick={onClose} aria-label={translate("Close read-aloud reply")}>{translate("Close")}</button></header>
    <p>{source.source === 'selection' ? translate("Your marked text") : translate("Visible terminal section · may contain multiple messages")}</p>
    <label>{translate("Text for reading")}<textarea aria-label={translate("Text for reading")} value={draft} maxLength={MAX_REPLY_SOURCE_CHARS}
      disabled={busy} onChange={event => reply.edit(event.target.value)} rows={7} /></label>
    <p className="reply-speech-help">{translate("Keep the desired answer here. The editing does not change anything in the session.")}</p>
    <label>{translate("Scope")}{" "}<select aria-label={translate("Read-aloud scope")} value={mode} disabled={busy} onChange={event => reply.choose(event.target.value as ReplyMode)}>
      <option value="excerpt">{translate("Read brief version")}</option><option value="full">{translate("Read everything")}</option></select></label>
    <p className="reply-speech-help">{mode === 'excerpt' ? translate("A short excerpt from the first full sentences. No AI summary.") : translate("The selected text with adjusted formatting.")} {" "}{translate("Blocks of code are omitted. The Speech text is sent to ElevenLabs.")}</p>
    {preview && <><p className="reply-speech-help">{preview.shortened ? translate("Shortened speech text") : translate("Speech text")}</p><p className="reply-speech-text" aria-label={translate("Speech text")}>{preview.text}</p></>}
    {status && <p role="status">{status}</p>}{error && <p role="alert">{localizeAppMessage(error)}</p>}
    <div className="reply-speech-actions">
      {!preview && <button type="button" disabled={busy || !draft.trim()} onClick={() => void reply.prepare(mode)}>{translate("Review speech text")}</button>}
      <button type="button" disabled={busy || !preview} onClick={reply.listen}>{hasAudio ? translate("Play again") : translate("Listen")}</button>
      <button type="button" disabled={!busy} onClick={reply.stop}>{translate("Stop")}</button>
    </div>
  </dialog>;
}

const InfoIcon = () => { useLocale(); return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>); };
const PlayIcon = () => { useLocale(); return (<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>); };

/** Tablet: the reply lives in the voice strip below the terminal. Nothing is covered; Escape or Schliessen returns to the strip. */
function ReplySpeechSheet({ source, port, context, onClose, restoreFocus }: ReplyShellProps) {
  useLocale();
  const title = useId(); const heading = useRef<HTMLHeadingElement>(null); const [help, setHelp] = useState(false);
  const section = useRef<HTMLElement>(null); const playButton = useRef<HTMLButtonElement>(null);
  const reply = useReplySpeech({ source, port, context, onClose });
  const { mode, preview, draft, status, error, busy, hasAudio } = reply;
  useLayoutEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  // A control disabled during playback drops keyboard focus to body; bring it back to the play button.
  useEffect(() => { if (!busy && preview && (document.activeElement === document.body || !document.activeElement)) playButton.current?.focus({ preventScroll: true }); }, [busy, preview]);
  const closeRef = useRef(() => undefined as void);
  closeRef.current = () => { onClose(); requestAnimationFrame(() => restoreFocus()?.focus({ preventScroll: true })); };
  useEffect(() => {
    // Escape closes only this sheet, also when focus sits on body. The enclosing
    // native dialog acts on the Escape keyup, so that keyup is swallowed as well.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const active = document.activeElement;
      if (!(section.current?.contains(active) || !active || active === document.body)) return;
      event.preventDefault(); event.stopPropagation();
      const swallow = (keyup: KeyboardEvent) => { if (keyup.key === 'Escape') { keyup.preventDefault(); keyup.stopPropagation(); } window.removeEventListener('keyup', swallow, true); };
      window.addEventListener('keyup', swallow, true);
      closeRef.current();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);
  const close = () => closeRef.current();
  return <section ref={section} className="reply-sheet" role="dialog" aria-labelledby={title}>
    <div className="reply-sheet-head">
      <h2 ref={heading} id={title} tabIndex={-1}>{translate("Listen to the reply")}</h2>
      <span className="voice-status">{source.source === 'selection' ? translate("Your marked text") : translate("Visible terminal section")}</span>
      <div role="radiogroup" aria-label={translate("Read-aloud scope")} className="reply-segment">
        {(['excerpt', 'full'] as const).map(value => <button key={value} type="button" role="radio" aria-checked={mode === value} disabled={busy}
          onClick={() => { if (mode !== value) reply.choose(value); }}>{value === 'excerpt' ? translate("Short") : translate("Everything")}</button>)}
      </div>
      <button type="button" className="voice-icon-button" aria-label={translate("Notes for reading aloud")} aria-expanded={help} onClick={() => setHelp(open => !open)}><InfoIcon /></button>
      <button type="button" className="voice-quiet" aria-label={translate("Close read-aloud reply")} onClick={close}>{translate("Close")}</button>
    </div>
    {help && <p className="reply-speech-help">{translate("Editing does not change anything in the session.")}{" "}{mode === 'excerpt' ? translate("In short: an excerpt from the first complete sentences, not an AI summary.") : translate("Everything: the text with adjusted formatting.")} {" "}{translate("Blocks of code are omitted. The Speech text is sent to ElevenLabs.")}</p>}
    <textarea className="reply-sheet-text" aria-label={translate("Text for reading")} value={draft} maxLength={MAX_REPLY_SOURCE_CHARS} disabled={busy} rows={3} spellCheck={false}
      onChange={event => reply.edit(event.target.value)} />
    {preview && <p className="reply-speech-text" aria-label={translate("Speech text")}>{preview.text}</p>}
    <div className="reply-sheet-row">
      {!preview && <button type="button" className="voice-quiet" disabled={busy || !draft.trim()} onClick={() => void reply.prepare(mode)}>{translate("Review speech text")}</button>}
      <button ref={playButton} type="button" className="voice-quiet voice-send" disabled={busy || !preview} onClick={reply.listen}><PlayIcon />{hasAudio ? translate("Again") : translate("Listen")}</button>
      <button type="button" className="voice-quiet" disabled={!busy} onClick={reply.stop}>{translate("Stop")}</button>
      {preview?.shortened && <span className="voice-status">{translate("Shortened speech text")}</span>}
      {status && <span role="status" className="voice-status">{status}</span>}{error && <span role="alert" className="voice-alert">{localizeAppMessage(error)}</span>}
    </div>
  </section>;
}
