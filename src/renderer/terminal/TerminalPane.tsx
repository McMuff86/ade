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
import { useSessions } from '../stores/sessions';

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

    // Clipboard chords. navigator.clipboard is blocked by the app's deny-all
    // permission policy, so copy/paste goes through the main-process bridge.
    //  - Ctrl+C copies ONLY while a selection exists (otherwise it stays SIGINT)
    //  - Ctrl+Shift+C / Ctrl+Insert always copy the selection
    //  - Ctrl(+Shift)+V / Shift+Insert paste text; with a text-less clipboard
    //    (e.g. a screenshot) the raw ^V is forwarded so CLIs like Claude Code
    //    can read the image from the OS clipboard themselves.
    const forwardRawPasteKey = (): void => {
      void window.ade
        .invoke('pty:write', { sessionId, dataBase64: utf8ToBase64('\x16') })
        .catch(() => undefined);
    };
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const ctrl = event.ctrlKey && !event.altKey && !event.metaKey;
      const key = event.key.toLowerCase();
      const copyChord = (ctrl && key === 'c' && (event.shiftKey || term.hasSelection()))
        || (ctrl && !event.shiftKey && event.key === 'Insert');
      if (copyChord) {
        const selection = term.getSelection();
        if (selection.length > 0) {
          void window.ade.invoke('clipboard:writeText', { text: selection }).catch(() => undefined);
        }
        return false;
      }
      const pasteChord = (ctrl && key === 'v')
        || (event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && event.key === 'Insert');
      if (pasteChord) {
        void window.ade.invoke('clipboard:readText')
          .then(({ text }) => {
            if (text.length > 0) term.paste(text);
            else forwardRawPasteKey();
          })
          .catch(forwardRawPasteKey);
        return false;
      }
      return true;
    });

    // keyboard -> pty
    let writeFailed = false;
    const keyDisp = term.onData((data) => {
      void window.ade
        .invoke('pty:write', { sessionId, dataBase64: utf8ToBase64(data) })
        .catch((error) => {
          if (writeFailed) return;
          writeFailed = true;
          useSessions.getState().reportError(error, { source: 'attach', sessionId });
        });
    });

    let disposed = false;
    let attached = false;
    let lastSequence = 0;
    const pendingLive: Array<{ sequence: number; data: Uint8Array }> = [];

    // Subscribe before taking the replay snapshot. Sequence numbers let us
    // discard chunks already included in the snapshot without losing chunks
    // emitted between the attach invoke and its renderer-side resolution.
    const unsubscribeData = window.ade.on('pty:data', (payload) => {
      if (payload.sessionId !== sessionId) return;
      const data = base64ToBytes(payload.dataBase64);
      if (!attached) {
        pendingLive.push({ sequence: payload.sequence, data });
      } else if (payload.sequence > lastSequence) {
        lastSequence = payload.sequence;
        coalescer.push(data);
      }
    });

    void window.ade
      .invoke('pty:attach', { sessionId })
      .then(({ replayBase64, sequence }) => {
        if (disposed) return;
        if (replayBase64.length > 0) term.write(base64ToBytes(replayBase64));
        lastSequence = sequence;
        attached = true;
        for (const item of pendingLive) {
          if (item.sequence <= lastSequence) continue;
          lastSequence = item.sequence;
          coalescer.push(item.data);
        }
        pendingLive.length = 0;
      })
      .catch((error) => {
        console.error('[ade] pty:attach failed:', error);
        useSessions.getState().reportError(error, { source: 'attach', sessionId });
      });

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
      unsubscribeData();
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
