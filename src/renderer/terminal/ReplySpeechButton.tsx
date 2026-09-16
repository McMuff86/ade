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

export function ReplySpeechButton({ port, readSource, active, disabled = false, fallbackFocus, buttonContainer, label = 'Antwort anhören', sheetContainer, onOpenChange }: {
  port: ReplySpeechPort; readSource: () => ReplySource; active: boolean; disabled?: boolean; fallbackFocus: () => HTMLElement | null;
  buttonContainer?: HTMLElement | null; label?: string;
  /** With a sheet container the reply opens inside the voice strip instead of a modal dialog. */
  sheetContainer?: HTMLElement | null; onOpenChange?: (open: boolean) => void;
}) {
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
        if (!captured.text.trim()) throw new Error('Hier ist noch keine Antwort zum Vorlesen.');
        if (captured.text.length > MAX_REPLY_SOURCE_CHARS) throw new Error('Bitte markiere einen kürzeren Abschnitt mit höchstens 12’000 Zeichen.');
        context.current = new AudioContext(); void context.current.resume().catch(() => undefined);
        setSource(captured);
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'Die Antwort konnte nicht gelesen werden.'); }
    }}>{label}</button>
    {error && <span role="alert" className="reply-speech-error">{error}</span>}
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
  const [status, setStatus] = useState('Die Antwort wird vorbereitet…'); const [error, setError] = useState('');
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
        setStatus('Die Stimme wird vorbereitet…'); await port.speak(id);
        if (!current()) return;
        const result = await port.read(id); if (!current()) return;
        if (!result.audio || result.audio.text !== previewText.current) throw new Error('Die Sprachantwort konnte nicht zugeordnet werden. Öffne sie erneut.');
        audio.current = result.audio; setHasAudio(true);
      }
      const bytes = Uint8Array.from(atob(audio.current.base64), c => c.charCodeAt(0));
      const buffer = await context.decodeAudioData(bytes.buffer); if (!current()) return;
      if (context.state !== 'running') throw new Error('Tippe auf „Anhören“, um die Wiedergabe zu starten.');
      const node = context.createBufferSource(); node.buffer = buffer; node.connect(context.destination); playback.current = node;
      node.onended = () => { node.disconnect(); if (playback.current === node) playback.current = undefined;
        if (current()) { locked.current = false; setBusy(false); setStatus('Fertig. Du kannst die Antwort erneut anhören.'); } };
      setStatus('Ich lese dir den Text vor…'); node.start();
    } catch (reason) {
      if (current()) { locked.current = false; setBusy(false); setStatus(''); setError(reason instanceof Error ? reason.message : 'Die Sprachausgabe ist gerade nicht verfügbar.'); }
    }
  };
  const prepare = async (selectedMode: ReplyMode) => {
    const own = ++generation.current; locked.current = true; stopAudio(); discard(); audio.current = undefined; setHasAudio(false);
    setBusy(true); setPreview(undefined); setError(''); setStatus('Die Antwort wird vorbereitet…');
    const current = () => mounted.current && generation.current === own;
    try {
      const prepared = await port.prepare({ ...source, text: draft, mode: selectedMode });
      if (!prepared.replyId) throw new Error('Die Antwort konnte nicht vorbereitet werden.');
      if (!current()) { void port.cancel(prepared.replyId).catch(() => undefined); return; }
      replyId.current = prepared.replyId;
      const result = await port.read(prepared.replyId); if (!current()) return;
      if (!result.preview) throw new Error('Der Sprechtext ist nicht mehr verfügbar.');
      previewText.current = result.preview.text; setPreview(result.preview);
      locked.current = false; setBusy(false); setStatus('Bereit zum Anhören.');
    } catch (reason) { if (current()) { locked.current = false; setBusy(false); setStatus(''); setError(reason instanceof Error ? reason.message : 'Die Antwort konnte nicht vorbereitet werden.'); } }
  };
  useEffect(() => { void prepare('full'); }, []);
  const stop = () => { generation.current++; stopAudio(); if (!audio.current) { discard(); setPreview(undefined); }
    locked.current = false; setBusy(false); setStatus('Gestoppt.'); setError(''); };
  const edit = (text: string) => {
    generation.current++; stopAudio(); discard(); audio.current = undefined; setHasAudio(false); setPreview(undefined);
    setDraft(text); setError(''); setStatus('Text geändert. Bitte den Sprechtext erneut prüfen.');
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
    <header><h2 ref={heading} id={title} tabIndex={-1}>Antwort anhören</h2><button type="button" onClick={onClose} aria-label="Antwort anhören schliessen">Schliessen</button></header>
    <p>{source.source === 'selection' ? 'Dein markierter Text' : 'Sichtbarer Terminalausschnitt · kann mehrere Meldungen enthalten'}</p>
    <label>Text zum Vorlesen<textarea aria-label="Text zum Vorlesen" value={draft} maxLength={MAX_REPLY_SOURCE_CHARS}
      disabled={busy} onChange={event => reply.edit(event.target.value)} rows={7} /></label>
    <p className="reply-speech-help">Behalte hier die gewünschte Antwort. Das Bearbeiten ändert nichts in der Sitzung.</p>
    <label>Umfang <select aria-label="Vorleseumfang" value={mode} disabled={busy} onChange={event => reply.choose(event.target.value as ReplyMode)}>
      <option value="excerpt">Kurz vorlesen</option><option value="full">Alles vorlesen</option></select></label>
    <p className="reply-speech-help">{mode === 'excerpt' ? 'Ein kurzer Auszug aus den ersten vollständigen Sätzen. Keine KI-Zusammenfassung.' : 'Der ausgewählte Text mit bereinigter Formatierung.'} Codeblöcke werden ausgelassen. Der Sprechtext wird an ElevenLabs gesendet.</p>
    {preview && <><p className="reply-speech-help">{preview.shortened ? 'Gekürzter Sprechtext' : 'Sprechtext'}</p><p className="reply-speech-text" aria-label="Sprechtext">{preview.text}</p></>}
    {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
    <div className="reply-speech-actions">
      {!preview && <button type="button" disabled={busy || !draft.trim()} onClick={() => void reply.prepare(mode)}>Sprechtext prüfen</button>}
      <button type="button" disabled={busy || !preview} onClick={reply.listen}>{hasAudio ? 'Erneut abspielen' : 'Anhören'}</button>
      <button type="button" disabled={!busy} onClick={reply.stop}>Stoppen</button>
    </div>
  </dialog>;
}

const InfoIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
const PlayIcon = () => <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>;

/** Tablet: the reply lives in the voice strip below the terminal. Nothing is covered; Escape or Schliessen returns to the strip. */
function ReplySpeechSheet({ source, port, context, onClose, restoreFocus }: ReplyShellProps) {
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
      <h2 ref={heading} id={title} tabIndex={-1}>Antwort anhören</h2>
      <span className="voice-status">{source.source === 'selection' ? 'Dein markierter Text' : 'Sichtbarer Terminalausschnitt'}</span>
      <div role="radiogroup" aria-label="Vorleseumfang" className="reply-segment">
        {(['excerpt', 'full'] as const).map(value => <button key={value} type="button" role="radio" aria-checked={mode === value} disabled={busy}
          onClick={() => { if (mode !== value) reply.choose(value); }}>{value === 'excerpt' ? 'Kurz' : 'Alles'}</button>)}
      </div>
      <button type="button" className="voice-icon-button" aria-label="Hinweise zum Vorlesen" aria-expanded={help} onClick={() => setHelp(open => !open)}><InfoIcon /></button>
      <button type="button" className="voice-quiet" aria-label="Antwort anhören schliessen" onClick={close}>Schliessen</button>
    </div>
    {help && <p className="reply-speech-help">Das Bearbeiten ändert nichts in der Sitzung. {mode === 'excerpt' ? 'Kurz: ein Auszug aus den ersten vollständigen Sätzen, keine KI-Zusammenfassung.' : 'Alles: der Text mit bereinigter Formatierung.'} Codeblöcke werden ausgelassen. Der Sprechtext wird an ElevenLabs gesendet.</p>}
    <textarea className="reply-sheet-text" aria-label="Text zum Vorlesen" value={draft} maxLength={MAX_REPLY_SOURCE_CHARS} disabled={busy} rows={3} spellCheck={false}
      onChange={event => reply.edit(event.target.value)} />
    {preview && <p className="reply-speech-text" aria-label="Sprechtext">{preview.text}</p>}
    <div className="reply-sheet-row">
      {!preview && <button type="button" className="voice-quiet" disabled={busy || !draft.trim()} onClick={() => void reply.prepare(mode)}>Sprechtext prüfen</button>}
      <button ref={playButton} type="button" className="voice-quiet voice-send" disabled={busy || !preview} onClick={reply.listen}><PlayIcon />{hasAudio ? 'Erneut' : 'Anhören'}</button>
      <button type="button" className="voice-quiet" disabled={!busy} onClick={reply.stop}>Stoppen</button>
      {preview?.shortened && <span className="voice-status">Gekürzter Sprechtext</span>}
      {status && <span role="status" className="voice-status">{status}</span>}{error && <span role="alert" className="voice-alert">{error}</span>}
    </div>
  </section>;
}
