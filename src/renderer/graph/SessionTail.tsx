/**
 * SessionTail — a read-only live view of one task session for the Graph
 * inspector and the bottom dock. Same sequence-aware attach as TerminalPane
 * (replay first, then live pty:data), but strictly observational: no
 * pty:write, no pty:resize — the running CLI must never notice a viewer.
 *
 * Scrolling: new output follows the bottom only while the viewport IS at the
 * bottom; once the user scrolls up to read, the position stays put.
 */

import { useEffect, useRef, type JSX } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useSettings } from '../stores/settings';
import { XTERM_THEMES } from '../theme/themes';

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function monoFontFamily(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim();
  return v.length > 0 ? v : 'Consolas, ui-monospace, monospace';
}

export function SessionTail({
  sessionId,
  rows = 14,
  cols = 100,
  fontSize = 10,
  scrollback = 400,
  fit = false,
  className = 'ginsp-tail',
}: {
  sessionId: string;
  rows?: number;
  cols?: number;
  fontSize?: number;
  scrollback?: number;
  /** Refit the local viewport to the host size (never resizes the PTY). */
  fit?: boolean;
  className?: string;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const theme = useSettings.getState().theme;
    const term = new Terminal({
      cols,
      rows,
      disableStdin: true,
      cursorBlink: false,
      allowProposedApi: true,
      scrollback,
      fontFamily: monoFontFamily(),
      fontSize,
      theme: XTERM_THEMES[theme],
    });
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = '11';
    let fitAddon: FitAddon | null = null;
    if (fit) {
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
    }
    term.open(host);
    let observer: ResizeObserver | null = null;
    if (fitAddon) {
      const doFit = (): void => {
        if (host.clientWidth <= 0 || host.clientHeight <= 0) return;
        try {
          fitAddon.fit();
        } catch {
          /* hidden host; retried on next resize */
        }
      };
      doFit();
      observer = new ResizeObserver(doFit);
      observer.observe(host);
    }

    let disposed = false;
    let attached = false;
    let lastSequence = 0;
    const pendingLive: Array<{ sequence: number; data: Uint8Array }> = [];
    const write = (data: Uint8Array): void => {
      if (disposed) return;
      const buffer = term.buffer.active;
      const wasAtBottom = buffer.viewportY >= buffer.baseY;
      term.write(data, () => {
        if (!disposed && wasAtBottom) term.scrollToBottom();
      });
    };

    const unsubscribeData = window.ade.on('pty:data', (payload) => {
      if (payload.sessionId !== sessionId) return;
      const data = base64ToBytes(payload.dataBase64);
      if (!attached) {
        pendingLive.push({ sequence: payload.sequence, data });
      } else if (payload.sequence > lastSequence) {
        lastSequence = payload.sequence;
        write(data);
      }
    });

    void window.ade
      .invoke('pty:attach', { sessionId })
      .then(({ replayBase64, sequence }) => {
        if (disposed) return;
        if (replayBase64.length > 0) write(base64ToBytes(replayBase64));
        lastSequence = sequence;
        attached = true;
        for (const item of pendingLive) {
          if (item.sequence <= lastSequence) continue;
          lastSequence = item.sequence;
          write(item.data);
        }
        pendingLive.length = 0;
      })
      .catch(() => {
        if (!disposed) term.write('\r\n[Live-Ansicht nicht verfügbar]\r\n');
      });

    return () => {
      disposed = true;
      observer?.disconnect();
      unsubscribeData();
      term.dispose();
    };
  }, [sessionId, rows, cols, fontSize, scrollback, fit]);

  return <div ref={hostRef} className={className} title="Live-Ausgabe (nur lesen)" />;
}
