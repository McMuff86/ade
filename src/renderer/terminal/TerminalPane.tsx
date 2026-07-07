/**
 * TerminalPane — mounts one xterm.js instance for one session (Phase B1).
 *
 * Lifecycle:
 *  - on mount: create the Terminal, load Fit + Unicode11 addons, open it,
 *    pull the ring-buffer replay (pty:attach) so scrollback survives remounts,
 *    then subscribe to live output (pty:data, write-coalesced one frame/write).
 *  - keyboard input -> pty:write; a ResizeObserver refits and -> pty:resize.
 *  - theme switches set terminal.options.theme reactively (SPEC #8: the
 *    terminal itself restyles, not just the surrounding chrome).
 *
 * The instance is kept alive across tab switches: the pane stays mounted and
 * TerminalArea hides inactive panes with CSS, so switching is instant. The
 * terminal is disposed only when the session's tab is closed (unmount).
 */

import { useEffect, useRef, type JSX } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useSettings } from '../stores/settings';
import { XTERM_THEMES } from '../theme/themes';
import { createWriteCoalescer } from './write-coalescer';

const RESIZE_DEBOUNCE_MS = 75;
const SCROLLBACK = 5000;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function monoFontFamily(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim();
  return v.length > 0 ? v : 'Consolas, ui-monospace, monospace';
}

export function TerminalPane({
  sessionId,
  active,
}: {
  sessionId: string;
  active: boolean;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // Create + wire the terminal once per session id.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const theme = useSettings.getState().theme;
    const term = new Terminal({
      cols: 120,
      rows: 32,
      cursorBlink: true,
      allowProposedApi: true, // required for the unicode11 addon
      scrollback: SCROLLBACK,
      fontFamily: monoFontFamily(),
      fontSize: 13,
      theme: XTERM_THEMES[theme],
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = '11';

    term.open(host);
    termRef.current = term;
    fitRef.current = fitAddon;

    // Dev-only: expose the xterm instance on the host node so CDP verification
    // can read terminal.options.theme etc. Stripped from production builds.
    if (import.meta.env.DEV) {
      (host as unknown as { __term?: Terminal }).__term = term;
    }

    const coalescer = createWriteCoalescer((data) => term.write(data));

    // keyboard -> pty
    const keyDisp = term.onData((data) => {
      window.ade.invoke('pty:write', { sessionId, dataBase64: utf8ToBase64(data) });
    });

    let disposed = false;
    let unsubscribeData: (() => void) | null = null;

    // Replay the ring buffer first, then attach to the live stream so
    // scrollback is redrawn before new output lands.
    void window.ade
      .invoke('pty:attach', { sessionId })
      .then(({ replayBase64 }) => {
        if (disposed) return;
        if (replayBase64.length > 0) term.write(base64ToBytes(replayBase64));
        unsubscribeData = window.ade.on('pty:data', (payload) => {
          if (payload.sessionId !== sessionId) return;
          coalescer.push(base64ToBytes(payload.dataBase64));
        });
      })
      .catch((err) => console.error('[ade] pty:attach failed:', err));

    // fit + report size to the pty (guard against hidden 0x0 hosts)
    const doFit = (): void => {
      if (host.clientWidth <= 0 || host.clientHeight <= 0) return;
      try {
        fitAddon.fit();
      } catch {
        return;
      }
      if (term.cols > 0 && term.rows > 0) {
        window.ade.invoke('pty:resize', { sessionId, cols: term.cols, rows: term.rows });
      }
    };

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(doFit, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(host);
    doFit();

    return () => {
      disposed = true;
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      observer.disconnect();
      keyDisp.dispose();
      unsubscribeData?.();
      coalescer.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId]);

  // Reactive theme: restyle the live terminal on app theme switch (SPEC #8).
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.theme = XTERM_THEMES[theme];
  }, [theme]);

  // On becoming the visible tab, refit (the host had 0 size while hidden) + focus.
  useEffect(() => {
    if (!active) return;
    const term = termRef.current;
    const fit = fitRef.current;
    const host = hostRef.current;
    if (!term || !fit || !host) return;
    // next frame so the CSS `display` flip has taken effect and the host has size
    const raf = requestAnimationFrame(() => {
      if (host.clientWidth <= 0 || host.clientHeight <= 0) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      if (term.cols > 0 && term.rows > 0) {
        window.ade.invoke('pty:resize', { sessionId, cols: term.cols, rows: term.rows });
      }
      term.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [active, sessionId]);

  return <div className="terminal-host" ref={hostRef} />;
}
