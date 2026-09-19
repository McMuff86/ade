import { useContext, useEffect, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { MobileTerminalFrame } from '../shared/remote';
import { TabletKeyboardContext } from './useTabletViewport';
import { openTerminalKeyboard } from './terminalKeyboard';
import '@xterm/xterm/css/xterm.css';
import { XTERM_THEMES } from '../renderer/theme/themes';
import { ReplySpeechButton, type ReplySpeechPort } from '../renderer/terminal/ReplySpeechButton';
import { terminalReplySource } from '../renderer/terminal/replySource';
import { terminalWebLinks, completeTerminalLink, type TerminalWebLink } from '../shared/terminalLinks';
import { LinkedTerminalText, TerminalLinksDialog } from './TerminalLinks';

/** Only styles created by xterm receive the per-document CSP nonce. */
function terminalDocument(): Document {
  const nonce = document.querySelector<HTMLMetaElement>('meta[name="ade-style-nonce"]')?.content;
  if (!nonce) return document;
  return new Proxy(document, { get(target, property) {
    if (property === 'createElement') return (tag: string, options?: ElementCreationOptions) => {
      const node = target.createElement(tag, options); if (node instanceof HTMLStyleElement) node.nonce = nonce; return node;
    };
    const value = Reflect.get(target, property, target) as unknown;
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

export function TerminalScreen({ frame, screen, enabled, active, onData, onSize, fontSize = 14, replyPort, replyButtonContainer, replySheetContainer, onReplyOpenChange, toolContainer }: {
  frame: MobileTerminalFrame; enabled: boolean; active: boolean;
  screen: string;
  fontSize?: number;
  replyPort?: ReplySpeechPort;
  /** The voice strip's slot; "Anhören" renders there instead of floating over the output. */
  replyButtonContainer?: HTMLElement | null;
  /** Where Verlauf/Links render; without it they overlay the output. */
  toolContainer?: HTMLElement | null;
  /** The strip's sheet area; the reply opens there as a sheet instead of a modal. */
  replySheetContainer?: HTMLElement | null;
  onReplyOpenChange?: (open: boolean) => void;
  onData: (data: string) => void; onSize: (cols: number, rows: number) => void;
}): JSX.Element {
  const keyboardOpen = useContext(TabletKeyboardContext);
  const container = useRef<HTMLDivElement>(null); const terminal = useRef<Terminal | undefined>(undefined);
  const callbacks = useRef({ onData, onSize }); callbacks.current = { onData, onSize };
  const lastFrame = useRef('');
  const measureRef = useRef<() => void>(() => undefined);
  const [history, setHistory] = useState<string | null>(null);
  const historyRef = useRef<HTMLPreElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null);
  const linksButton = useRef<HTMLButtonElement>(null);
  const [linksOpen, setLinksOpen] = useState(false);
  const openLink = (link: TerminalWebLink) => {
    if (link.local) setLinksOpen(true);
    else window.open(link.href, '_blank', 'noopener,noreferrer');
  };
  const openLinkRef = useRef(openLink); openLinkRef.current = openLink;
  const transcriptRef = useRef(screen); transcriptRef.current = screen;
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const activateAt = (x: number, y: number): boolean => {
    const term = terminal.current; const box = container.current?.querySelector('.xterm-screen')?.getBoundingClientRect();
    if (!term || !box?.width || !box.height) return false;
    const row = Math.floor((y - box.top) * term.rows / box.height);
    const col = Math.floor((x - box.left) * term.cols / box.width);
    const line = row >= 0 && row < term.rows && col >= 0 && col < term.cols ? term.buffer.active.getLine(term.buffer.active.viewportY + row) : undefined;
    if (!line) return false;
    const offset = line.translateToString(false, 0, col).length;
    const link = terminalWebLinks(line.translateToString(true)).find(item => offset >= item.start && offset < item.end);
    if (!link) return false;
    const full = completeTerminalLink(link, screen); if (full) openLink(full); else setLinksOpen(true);
    return true;
  };
  const showHistory = () => setHistory(screen || 'Noch keine Terminalausgabe vorhanden.');
  const closeHistory = () => { setHistory(null); historyButton.current?.focus(); };
  useEffect(() => {
    if (history === null || !historyRef.current) return;
    historyRef.current.scrollTop = Math.max(0, historyRef.current.scrollHeight - historyRef.current.clientHeight - 80);
    historyRef.current.focus();
  }, [history]);
  useEffect(() => {
    const term = new Terminal({ cols: frame.cols, rows: frame.rows, fontSize, fontFamily: 'Consolas, monospace', documentOverride: terminalDocument(),
      scrollback: 0, cursorBlink: true, disableStdin: true, convertEol: false });
    const theme = () => { term.options.theme = XTERM_THEMES[document.documentElement.dataset.theme === 'light' ? 'light' : 'dark']; };
    theme(); const themes = new MutationObserver(theme); themes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(container.current!); terminal.current = term;
    const linkProvider = term.registerLinkProvider({ provideLinks: (row, done) => {
      const line = term.buffer.active.getLine(row - 1); if (!line) { done(undefined); return; }
      const text = line.translateToString(true);
      const column = (offset: number) => {
        let chars = 0; let col = 0;
        while (col < term.cols && chars < offset) { chars += line.getCell(col)?.getChars().length ?? 0; col++; }
        return col;
      };
      done(terminalWebLinks(text).map(link => ({ text: link.text,
        range: { start: { x: column(link.start) + 1, y: row }, end: { x: column(link.end), y: row } },
        activate: (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); const full = completeTerminalLink(link, transcriptRef.current); if (full) openLinkRef.current(full); },
      })));
    } });
    term.textarea?.setAttribute('aria-label', 'Direkte Terminal-Eingabe');
    term.textarea?.setAttribute('autocapitalize', 'off');
    term.textarea?.setAttribute('inputmode', 'text');
    const data = term.onData((value) => callbacks.current.onData(value));
    const measure = () => {
      const size = fit.proposeDimensions();
      if (size && container.current!.clientHeight > 0) callbacks.current.onSize(Math.max(20, Math.min(240, size.cols)), Math.max(5, Math.min(100, size.rows)));
    };
    measureRef.current = measure;
    const observer = new ResizeObserver(measure); observer.observe(container.current!); measure();
    return () => { themes.disconnect(); observer.disconnect(); linkProvider.dispose(); data.dispose(); term.dispose(); terminal.current = undefined; lastFrame.current = ''; measureRef.current = () => undefined; };
  }, []);
  useEffect(() => { if (terminal.current) { terminal.current.options.fontSize = fontSize; measureRef.current(); } }, [fontSize]);
  useEffect(() => { if (terminal.current) terminal.current.options.disableStdin = !enabled || !active; }, [enabled, active]);
  useEffect(() => {
    const term = terminal.current; if (!term || lastFrame.current === frame.revision) return;
    if (term.cols !== frame.cols || term.rows !== frame.rows) {
      term.resize(frame.cols, frame.rows);
      // xterm reflow can leave a base/viewport offset even with scrollback 0.
      // Replace that local buffer with the authoritative frame after resizing;
      // clear() preserves the keyboard modes and in-progress IME composition.
      term.clear();
    }
    term.write(frame.ansi); lastFrame.current = frame.revision;
  }, [frame]);
  return <div className={`m-terminal-screen m-terminal-xterm m-terminal-history-host${toolContainer ? ' m-terminal-tools-slotted' : ''}`} aria-label="Terminalanzeige"
    onKeyDownCapture={(event) => {
      if (event.target instanceof Element && event.target.closest('.reply-speech-dialog, .m-terminal-links-dialog')) return;
      if (event.shiftKey && event.key === 'PageUp') { event.preventDefault(); event.stopPropagation(); showHistory(); }
      if (history !== null && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeHistory(); }
    }}>
    <div className="m-terminal-live" ref={container}
    aria-hidden={history !== null} inert={history !== null}
    onWheelCapture={(event) => { if (event.deltaY < 0 && !event.ctrlKey) { event.stopPropagation(); showHistory(); } }}
    onTouchStartCapture={(event) => { touchStart.current = event.touches.length === 1 ? { x: event.touches[0]!.clientX, y: event.touches[0]!.clientY } : null; swiped.current = false; }}
    onTouchMoveCapture={(event) => {
      if (touchStart.current !== null && event.touches.length === 1) {
        const delta = event.touches[0]!.clientY - touchStart.current.y;
        if (Math.abs(delta) > 12 || Math.abs(event.touches[0]!.clientX - touchStart.current.x) > 12) swiped.current = true;
        if (delta > 24) { touchStart.current = null; showHistory(); }
      }
    }}
    onTouchEndCapture={(event) => {
      // xterm prevents the compatibility click on some touch browsers. The
      // actual touchend still carries user activation and must handle the link.
      if (!swiped.current && touchStart.current && event.changedTouches.length === 1
        && activateAt(event.changedTouches[0]!.clientX, event.changedTouches[0]!.clientY)) {
        event.preventDefault(); event.stopPropagation(); swiped.current = true;
      }
      touchStart.current = null;
    }}
    onPointerDown={(event) => { if (enabled && active && event.pointerType === 'mouse') terminal.current?.focus(); }}
    onClickCapture={(event) => {
      if (swiped.current) return;
      if (activateAt(event.clientX, event.clientY)) { event.preventDefault(); event.stopPropagation(); }
    }}
    onClick={() => {
      if (swiped.current) { swiped.current = false; return; }
      if (!enabled || !active) return;
      // A completed tap carries touch user activation; pointerdown may not.
      if (navigator.maxTouchPoints > 0) openTerminalKeyboard(terminal.current?.textarea, keyboardOpen);
      else terminal.current?.focus();
    }} />
    {(() => {
      // The tools belong next to the other terminal tools (voice strip), not on
      // top of the first output line. Without a slot they fall back to the overlay.
      const tools = <>
        <button ref={historyButton} className="m-terminal-history-button" aria-expanded={history !== null}
          onClick={() => history === null ? showHistory() : closeHistory()}>{history === null ? 'Verlauf' : 'Zur Live-Ausgabe'}</button>
        <button ref={linksButton} className="m-terminal-links-button" onClick={(event) => { event.currentTarget.focus(); setLinksOpen(true); }}>Links</button>
      </>;
      return toolContainer ? createPortal(tools, toolContainer) : tools;
    })()}
    {linksOpen && <TerminalLinksDialog text={history ?? screen} onClose={() => setLinksOpen(false)} opener={() => linksButton.current ?? historyButton.current} />}
    {replyPort && <ReplySpeechButton port={replyPort} active={active} buttonContainer={replyButtonContainer} label={replyButtonContainer ? 'Anhören' : 'Antwort anhören'}
      sheetContainer={replySheetContainer} onOpenChange={onReplyOpenChange}
      fallbackFocus={() => historyButton.current} readSource={() => {
        if (history !== null) {
          const selection = window.getSelection();
          const selected = selection && historyRef.current?.contains(selection.anchorNode) && historyRef.current?.contains(selection.focusNode) ? selection.toString() : '';
          return { source: selected ? 'selection' : 'screen', text: selected || history };
        }
        return terminalReplySource(terminal.current);
      }} />}
    {history !== null && <div className="m-terminal-history-panel">
      <p>Gespeicherter Textverlauf · Anzeige pausiert. Zur Live-Ausgabe zurückkehren, um weiter einzugeben.</p>
      <pre ref={historyRef} tabIndex={0} aria-label="Terminalverlauf lesen"><LinkedTerminalText text={history} onLocal={() => setLinksOpen(true)} /></pre>
    </div>}
  </div>;
}
