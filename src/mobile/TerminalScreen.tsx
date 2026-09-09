import { useEffect, useRef, type JSX } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { MobileTerminalFrame } from '../shared/remote';
import '@xterm/xterm/css/xterm.css';

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

export function TerminalScreen({ frame, enabled, active, onData, onSize }: {
  frame: MobileTerminalFrame; enabled: boolean; active: boolean;
  onData: (data: string) => void; onSize: (cols: number, rows: number) => void;
}): JSX.Element {
  const container = useRef<HTMLDivElement>(null); const terminal = useRef<Terminal | undefined>(undefined);
  const callbacks = useRef({ onData, onSize }); callbacks.current = { onData, onSize };
  const lastFrame = useRef('');
  useEffect(() => {
    const term = new Terminal({ cols: frame.cols, rows: frame.rows, fontSize: 14, fontFamily: 'Consolas, monospace', documentOverride: terminalDocument(),
      scrollback: 0, cursorBlink: true, disableStdin: true, convertEol: false, theme: { background: '#0d0f12', foreground: '#c9ccd3' } });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(container.current!); terminal.current = term;
    term.textarea?.setAttribute('aria-label', 'Direkte Terminal-Eingabe');
    term.textarea?.setAttribute('autocapitalize', 'off');
    const data = term.onData((value) => callbacks.current.onData(value));
    const measure = () => {
      const size = fit.proposeDimensions();
      if (size && container.current!.clientHeight > 0) callbacks.current.onSize(Math.max(20, Math.min(240, size.cols)), Math.max(5, Math.min(100, size.rows)));
    };
    const observer = new ResizeObserver(measure); observer.observe(container.current!); measure();
    return () => { observer.disconnect(); data.dispose(); term.dispose(); terminal.current = undefined; lastFrame.current = ''; };
  }, []);
  useEffect(() => { if (terminal.current) terminal.current.options.disableStdin = !enabled || !active; }, [enabled, active]);
  useEffect(() => {
    const term = terminal.current; if (!term || lastFrame.current === frame.revision) return;
    term.resize(frame.cols, frame.rows); term.write(frame.ansi); lastFrame.current = frame.revision;
  }, [frame]);
  return <div className="m-terminal-screen m-terminal-xterm" aria-label="Terminalanzeige" ref={container}
    onPointerDown={() => { if (enabled) terminal.current?.focus(); }} />;
}
