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

export function ReplySpeechButton({ port, readSource, active, disabled = false, fallbackFocus, buttonContainer, label = 'Antwort anhören' }: {
  port: ReplySpeechPort; readSource: () => ReplySource; active: boolean; disabled?: boolean; fallbackFocus: () => HTMLElement | null;
  buttonContainer?: HTMLElement | null; label?: string;
}) {
  const [source, setSource] = useState<ReplySource>(); const [error, setError] = useState('');
  const button = useRef<HTMLButtonElement>(null); const context = useRef<AudioContext | undefined>(undefined);
  const close = () => { setSource(undefined); void context.current?.close().catch(() => undefined); context.current = undefined; };
  useEffect(() => { if (!active || disabled) close(); }, [active, disabled]);
  useEffect(() => () => { void context.current?.close().catch(() => undefined); }, []);
  const trigger = <>
    <button ref={button} type="button" aria-haspopup="dialog" aria-expanded={!!source} disabled={disabled || !active}
      onPointerDown={event => event.preventDefault()} onClick={() => {
      setError('');
      try {
        const captured = readSource();
        button.current?.focus();
        if (!captured.text.trim()) throw new Error('Hier ist noch keine Antwort zum Vorlesen.');
        if (captured.text.length > MAX_REPLY_SOURCE_CHARS) throw new Error('Bitte markiere einen kürzeren Abschnitt mit höchstens 12’000 Zeichen.');
        context.current = new AudioContext(); void context.current.resume().catch(() => undefined);
        setSource(captured);
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'Die Antwort konnte nicht gelesen werden.'); }
    }}>{label}</button>
    {error && <span role="alert" className="reply-speech-error">{error}</span>}
  </>;
  return <>
    {buttonContainer === undefined ? trigger : buttonContainer ? createPortal(trigger, buttonContainer) : null}
    {source && <ReplySpeechDialog source={source} port={port} context={context.current!} onClose={close}
      restoreFocus={() => button.current?.isConnected && button.current.getClientRects().length ? button.current : fallbackFocus()} />}
  </>;
}

function ReplySpeechDialog({ source, port, context, onClose, restoreFocus }: {
  source: ReplySource; port: ReplySpeechPort; context: AudioContext; onClose: () => void; restoreFocus: () => HTMLElement | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null); const title = useId(); const heading = useRef<HTMLHeadingElement>(null);
  const [mode, setMode] = useState<ReplyMode>('full'); const [preview, setPreview] = useState<ReplyPreview>();
  const [draft, setDraft] = useState(source.text);
  const [status, setStatus] = useState('Die Antwort wird vorbereitet…'); const [error, setError] = useState('');
  const [busy, setBusy] = useState(true); const [hasAudio, setHasAudio] = useState(false);
  const generation = useRef(0); const replyId = useRef<string | undefined>(undefined); const audio = useRef<SpeechAudio | undefined>(undefined);
  const playback = useRef<AudioBufferSourceNode | undefined>(undefined); const locked = useRef(false); const mounted = useRef(true);
  const close = useRef(onClose); close.current = onClose;
  const stopAudio = () => { const current = playback.current; playback.current = undefined; if (current) { current.onended = null; current.stop(); current.disconnect(); } };
  const discard = () => { const id = replyId.current; replyId.current = undefined; if (id) void port.cancel(id).catch(() => undefined); };
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal(); heading.current?.focus();
    return () => { element.close(); restoreFocus()?.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    mounted.current = true;
    const hide = () => { if (document.hidden) close.current(); };
    document.addEventListener('visibilitychange', hide);
    return () => { mounted.current = false; generation.current++; stopAudio(); discard(); document.removeEventListener('visibilitychange', hide); };
  }, []);
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
  const previewText = useRef('');
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
  return <dialog ref={dialog} className="reply-speech-dialog" aria-labelledby={title} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}>
    <header><h2 ref={heading} id={title} tabIndex={-1}>Antwort anhören</h2><button type="button" onClick={onClose} aria-label="Antwort anhören schliessen">Schliessen</button></header>
    <p>{source.source === 'selection' ? 'Dein markierter Text' : 'Sichtbarer Terminalausschnitt · kann mehrere Meldungen enthalten'}</p>
    <label>Text zum Vorlesen<textarea aria-label="Text zum Vorlesen" value={draft} maxLength={MAX_REPLY_SOURCE_CHARS}
      disabled={busy} onChange={event => edit(event.target.value)} rows={7} /></label>
    <p className="reply-speech-help">Behalte hier die gewünschte Antwort. Das Bearbeiten ändert nichts in der Sitzung.</p>
    <label>Umfang <select aria-label="Vorleseumfang" value={mode} disabled={busy} onChange={event => {
      const next = event.target.value as ReplyMode; setMode(next); void prepare(next);
    }}><option value="excerpt">Kurz vorlesen</option><option value="full">Alles vorlesen</option></select></label>
    <p className="reply-speech-help">{mode === 'excerpt' ? 'Ein kurzer Auszug aus den ersten vollständigen Sätzen. Keine KI-Zusammenfassung.' : 'Der ausgewählte Text mit bereinigter Formatierung.'} Codeblöcke werden ausgelassen. Der Sprechtext wird an ElevenLabs gesendet.</p>
    {preview && <><p className="reply-speech-help">{preview.shortened ? 'Gekürzter Sprechtext' : 'Sprechtext'}</p><p className="reply-speech-text" aria-label="Sprechtext">{preview.text}</p></>}
    {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
    <div className="reply-speech-actions">
      {!preview && <button type="button" disabled={busy || !draft.trim()} onClick={() => void prepare(mode)}>Sprechtext prüfen</button>}
      <button type="button" disabled={busy || !preview} onClick={() => {
        if (locked.current) return; locked.current = true; setBusy(true); setError('');
        void context.resume().catch(() => undefined);
        if (replyId.current) void play(replyId.current, ++generation.current);
      }}>{hasAudio ? 'Erneut abspielen' : 'Anhören'}</button>
      <button type="button" disabled={!busy} onClick={stop}>Stoppen</button>
    </div>
  </dialog>;
}
