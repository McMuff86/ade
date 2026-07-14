/**
 * SessionTail — a read-only live view of one task session for the Graph
 * inspector. Same sequence-aware attach as TerminalPane (replay first, then
 * live pty:data), but strictly observational: no pty:write, no pty:resize —
 * the running CLI must never notice a second viewer.
 */

import { useEffect, useRef, type JSX } from 'react';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useSettings } from '../stores/settings';
import { XTERM_THEMES } from '../theme/themes';

const TAIL_SCROLLBACK = 400;

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

export function SessionTail({ sessionId }: { sessionId: string }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const theme = useSettings.getState().theme;
    const term = new Terminal({
      cols: 100,
      rows: 14,
      disableStdin: true,
      cursorBlink: false,
      allowProposedApi: true,
      scrollback: TAIL_SCROLLBACK,
      fontFamily: monoFontFamily(),
      fontSize: 10,
      theme: XTERM_THEMES[theme],
    });
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = '11';
    term.open(host);

    let disposed = false;
    let attached = false;
    let lastSequence = 0;
    const pendingLive: Array<{ sequence: number; data: Uint8Array }> = [];
    const write = (data: Uint8Array): void => {
      if (disposed) return;
      term.write(data);
      term.scrollToBottom();
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
      unsubscribeData();
      term.dispose();
    };
  }, [sessionId]);

  return <div ref={hostRef} className="ginsp-tail" title="Live-Ausgabe (nur lesen)" />;
}
