import { useContext, useEffect, useRef, useState, type JSX } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { MobileTerminalFrame } from '../shared/remote';
import { TabletKeyboardContext } from './useTabletViewport';
import { openTerminalKeyboard } from './terminalKeyboard';
import '@xterm/xterm/css/xterm.css';
import { XTERM_THEMES } from '../renderer/theme/themes';
import { ReplySpeechButton, type ReplySpeechPort } from '../renderer/terminal/ReplySpeechButton';
import { terminalReplySource } from '../renderer/terminal/replySource';

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

export function TerminalScreen({ frame, screen, enabled, active, onData, onSize, fontSize = 14, replyPort, replyButtonContainer }: {
  frame: MobileTerminalFrame; enabled: boolean; active: boolean;
  screen: string;
  fontSize?: number;
  replyPort?: ReplySpeechPort;
  /** The voice strip's slot; "Anhören" renders there instead of floating over the output. */
  replyButtonContainer?: HTMLElement | null;
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
  const touchStart = useRef<number | null>(null);
  const swiped = useRef(false);
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
    return () => { themes.disconnect(); observer.disconnect(); data.dispose(); term.dispose(); terminal.current = undefined; lastFrame.current = ''; measureRef.current = () => undefined; };
  }, []);
  useEffect(() => { if (terminal.current) { terminal.current.options.fontSize = fontSize; measureRef.current(); } }, [fontSize]);
  useEffect(() => { if (terminal.current) terminal.current.options.disableStdin = !enabled || !active; }, [enabled, active]);
  useEffect(() => {
    const term = terminal.current; if (!term || lastFrame.current === frame.revision) return;
    term.resize(frame.cols, frame.rows); term.write(frame.ansi); lastFrame.current = frame.revision;
  }, [frame]);
  return <div className="m-terminal-screen m-terminal-xterm m-terminal-history-host" aria-label="Terminalanzeige"
    onKeyDownCapture={(event) => {
      if (event.target instanceof Element && event.target.closest('.reply-speech-dialog')) return;
      if (event.shiftKey && event.key === 'PageUp') { event.preventDefault(); event.stopPropagation(); showHistory(); }
      if (history !== null && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeHistory(); }
    }}>
    <div className="m-terminal-live" ref={container}
    aria-hidden={history !== null} inert={history !== null}
    onWheelCapture={(event) => { if (event.deltaY < 0 && !event.ctrlKey) { event.stopPropagation(); showHistory(); } }}
    onTouchStart={(event) => { touchStart.current = event.touches.length === 1 ? event.touches[0]!.clientY : null; swiped.current = false; }}
    onTouchMove={(event) => {
      if (touchStart.current !== null && event.touches.length === 1 && event.touches[0]!.clientY - touchStart.current > 24) {
        swiped.current = true; touchStart.current = null; showHistory();
      }
    }}
    onPointerDown={(event) => { if (enabled && active && event.pointerType === 'mouse') terminal.current?.focus(); }}
    onClick={() => {
      if (swiped.current) { swiped.current = false; return; }
      if (!enabled || !active) return;
      // A completed tap carries touch user activation; pointerdown may not.
      if (navigator.maxTouchPoints > 0) openTerminalKeyboard(terminal.current?.textarea, keyboardOpen);
      else terminal.current?.focus();
    }} />
    <button ref={historyButton} className="m-terminal-history-button" aria-expanded={history !== null}
      onClick={() => history === null ? showHistory() : closeHistory()}>{history === null ? 'Verlauf' : 'Zur Live-Ausgabe'}</button>
    {replyPort && <ReplySpeechButton port={replyPort} active={active} buttonContainer={replyButtonContainer} label={replyButtonContainer ? 'Anhören' : 'Antwort anhören'}
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
      <pre ref={historyRef} tabIndex={0} aria-label="Terminalverlauf lesen">{history}</pre>
    </div>}
  </div>;
}
