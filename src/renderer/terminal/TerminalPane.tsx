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

import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { SearchAddon } from '@xterm/addon-search';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useSettings } from '../stores/settings';
import { XTERM_THEMES } from '../theme/themes';
import { createWriteCoalescer } from './write-coalescer';
import { useSessions } from '../stores/sessions';
import { SubscriptionUsagePanel } from './SubscriptionUsagePanel';
import { SessionProfileContext } from './SessionProfileContext';
import { TERMINAL_FONT_SIZES, useTerminalPreferences } from './preferences';
import { useCliWorkPreferences } from '../work/cliWorkPreferences';
import { DesktopPromptDialog } from './DesktopPromptDialog';
import { useAppData } from '../stores/appdata';
import { ReplySpeechButton, type ReplySpeechPort } from './ReplySpeechButton';
import { terminalReplySource } from './replySource';

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
  const session = useSessions(state => state.sessions[sessionId]);
  const repository = useAppData(state => state.repositories.find(item => item.id === session?.repositoryId));
  const [promptOpen, setPromptOpen] = useState(false);
  useEffect(() => { if (!active) setPromptOpen(false); }, [active]);
  const profileContext = useSessions(state => state.sessions[sessionId]?.profileContext);
  const termRef = useRef<Terminal | null>(null);
  const replyPort = useMemo<ReplySpeechPort>(() => ({
    prepare: input => window.ade.invoke('speech:reply', { operation: 'prepare', sessionId, ...input }),
    speak: replyId => window.ade.invoke('speech:reply', { operation: 'speak', replyId }),
    read: replyId => window.ade.invoke('speech:reply', { operation: 'read', replyId }),
    cancel: replyId => window.ade.invoke('speech:reply', { operation: 'cancel', replyId }),
  }), [sessionId]);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const pasteRef = useRef<() => void>(() => undefined);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState('');
  const [hasSelection, setHasSelection] = useState(false);
  const [scrolledBack, setScrolledBack] = useState(false);
  const [toolError, setToolError] = useState('');
  const [toolNotice, setToolNotice] = useState('');
  const exited = useSessions(state => state.sessions[sessionId]?.status === 'exited');
  const fontSize = useTerminalPreferences(state => state.fontSize);
  const [remoteInput, setRemoteInput] = useState(false);
  const remoteInputRef = useRef(false);
  const activeRef = useRef(active); activeRef.current = active;
  useEffect(() => {
    let live = true;
    const update = (state: { sessionId: string; remote: boolean }) => {
      if (!live || state.sessionId !== sessionId) return;
      remoteInputRef.current = state.remote; setRemoteInput(state.remote);
      if (termRef.current) termRef.current.options.disableStdin = state.remote;
    };
    const off = window.ade.on('terminal:controlChanged', update);
    void window.ade.invoke('terminal:control', { sessionId }).then(update).catch(() => undefined);
    return () => { live = false; off(); };
  }, [sessionId]);

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
      fontSize: useTerminalPreferences.getState().fontSize,
      disableStdin: remoteInputRef.current,
      theme: XTERM_THEMES[theme],
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = '11';
    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    searchRef.current = searchAddon;

    term.open(host);
    term.textarea?.setAttribute('aria-label', 'Terminal-Eingabe');
    termRef.current = term;
    fitRef.current = fitAddon;

    // Dev-only: expose the xterm instance on the host node so CDP verification
    // can read terminal.options.theme etc. Stripped from production builds.
    if (import.meta.env.DEV) {
      (host as unknown as { __term?: Terminal }).__term = term;
    }

    const coalescer = createWriteCoalescer((data) => term.write(data));
    const selectionDisp = term.onSelectionChange(() => setHasSelection(term.hasSelection()));
    const scrollDisp = term.onScroll(() => setScrolledBack(term.buffer.active.viewportY < term.buffer.active.baseY));

    // Clipboard chords. navigator.clipboard is blocked by the app's deny-all
    // permission policy, so copy/paste goes through the main-process bridge.
    //  - Ctrl+C copies ONLY while a selection exists (otherwise it stays SIGINT)
    //  - Ctrl+Shift+C / Ctrl+Insert always copy the selection
    //  - Ctrl(+Shift)+V / Shift+Insert paste text; with a text-less clipboard
    //    (e.g. a screenshot) the raw ^V is forwarded so CLIs like Claude Code
    //    can read the image from the OS clipboard themselves.
    const forwardRawPasteKey = (): void => {
      if (remoteInputRef.current) return;
      void window.ade
        .invoke('pty:write', { sessionId, dataBase64: utf8ToBase64('\x16') })
        .catch(() => undefined);
    };
    const paste = (): void => {
      if (remoteInputRef.current || useSessions.getState().sessions[sessionId]?.status === 'exited') return;
      setToolError('');
      void window.ade.invoke('clipboard:readText').then(({ text }) => {
        if (disposed || remoteInputRef.current) return;
        term.focus();
        if (text.length > 0) term.paste(text);
        else forwardRawPasteKey();
      }).catch(() => { if (!disposed) setToolError('Zwischenablage konnte nicht gelesen werden. Erneut versuchen.'); });
    };
    pasteRef.current = paste;
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
        paste();
        return false;
      }
      return true;
    });

    // keyboard -> pty
    let writeFailed = false;
    const keyDisp = term.onData((data) => {
      if (remoteInputRef.current) return;
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
    const markViewed = () => {
      if (!activeRef.current || disposed || !host.clientWidth || !host.clientHeight || !document.hasFocus()
        || document.visibilityState === 'hidden' || term.buffer.active.viewportY < term.buffer.active.baseY) return;
      const seen = useCliWorkPreferences.getState().entries[sessionId]?.seenSequence ?? 0;
      if (lastSequence > seen) useCliWorkPreferences.getState().update(sessionId, { seenSequence: lastSequence });
    };
    const seenTimer = window.setInterval(markViewed, 500);
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
        void window.ade.invoke('pty:resize', { sessionId, cols: term.cols, rows: term.rows }).catch(() => undefined);
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
      markViewed(); clearInterval(seenTimer);
      disposed = true;
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      observer.disconnect();
      keyDisp.dispose();
      selectionDisp.dispose();
      scrollDisp.dispose();
      unsubscribeData();
      coalescer.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
      pasteRef.current = () => undefined;
    };
  }, [sessionId]);

  // Reactive theme: restyle the live terminal on app theme switch (SPEC #8).
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.theme = XTERM_THEMES[theme];
  }, [theme]);

  useEffect(() => {
    const term = termRef.current;
    const host = hostRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    if (!host?.clientWidth || !host.clientHeight) return;
    try { fitRef.current?.fit(); } catch { return; }
    void window.ade.invoke('pty:resize', { sessionId, cols: term.cols, rows: term.rows }).catch(() => undefined);
  }, [fontSize, sessionId]);
  useEffect(() => { if (searchOpen && active) searchInput.current?.focus(); }, [searchOpen, active]);
  const find = (text = query, previous = false, incremental = false) => {
    if (!text) { searchRef.current?.clearDecorations(); termRef.current?.clearSelection(); setSearchResult(''); return; }
    const found = previous ? searchRef.current?.findPrevious(text) : searchRef.current?.findNext(text, { incremental });
    // xterm can clear and reselect the same match without a final selection event.
    // Read the completed search so Copy reflects the actual selection.
    setHasSelection(termRef.current?.hasSelection() ?? false);
    setSearchResult(found ? 'Treffer ausgewählt' : 'Keine Treffer im Terminalverlauf');
  };
  const closeSearch = () => {
    setSearchOpen(false); searchRef.current?.clearDecorations(); termRef.current?.clearSelection(); termRef.current?.focus();
  };

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
        void window.ade.invoke('pty:resize', { sessionId, cols: term.cols, rows: term.rows }).catch(() => undefined);
      }
      if (!document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')
        && !document.activeElement?.matches('[role="tab"], .terminal-search input')) term.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [active, sessionId]);

  return <div className="terminal-with-control" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
    onKeyDownCapture={(event) => {
      if ((event.target as Element).closest('[role="dialog"], dialog')) return;
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault(); event.stopPropagation(); setSearchOpen(true); searchInput.current?.focus();
      }
    }}>
    <div className="terminal-tools" role="group" aria-label="Terminal-Werkzeuge">
      <button type="button" disabled={!hasSelection} title="Auswahl kopieren (Ctrl+Shift+C)" onClick={() => {
        const text = termRef.current?.getSelection(); if (!text) return; setToolError('');
        void window.ade.invoke('clipboard:writeText', { text }).then(() => setToolNotice('Auswahl kopiert.'))
          .catch(() => setToolError('Auswahl konnte nicht kopiert werden. Erneut versuchen.'));
      }}>Kopieren</button>
      <button type="button" disabled={remoteInput || exited} title="Aus Zwischenablage einfügen (Ctrl+Shift+V)" onClick={() => pasteRef.current()}>Einfügen</button>
      <button type="button" aria-expanded={searchOpen} title="Terminal durchsuchen (Ctrl+Shift+F)" onClick={() => { setSearchOpen(true); searchInput.current?.focus(); }}>Suchen</button>
      <button type="button" aria-haspopup="dialog" aria-expanded={promptOpen} aria-controls={promptOpen ? `prompt-panel-${sessionId}` : undefined}
        onClick={() => {
          if (promptOpen) document.getElementById(`prompt-panel-${sessionId}`)?.querySelector('textarea')?.focus();
          else setPromptOpen(true);
        }}>Prompt / Diktat</button>
      <button type="button" onClick={() => { termRef.current?.scrollToTop(); }}>Verlauf-Anfang</button>
      {session?.kind === 'interactive' && !session.remoteAccessBlocked && <ReplySpeechButton key={sessionId} port={replyPort}
        active={active} disabled={promptOpen} readSource={() => terminalReplySource(termRef.current)}
        fallbackFocus={() => hostRef.current?.querySelector<HTMLElement>('.xterm-helper-textarea') ?? document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')} />}
      <button type="button" className={scrolledBack ? 'terminal-live-return' : ''} onClick={() => { termRef.current?.scrollToBottom(); termRef.current?.focus(); }}>Zur Live-Ausgabe</button>
      <label>Schrift<select aria-label="Terminal-Schriftgrösse" value={fontSize} onChange={(event) => useTerminalPreferences.getState().setFontSize(Number(event.target.value))}>
        {TERMINAL_FONT_SIZES.map(size => <option key={size} value={size}>{size} px</option>)}
      </select></label>
    </div>
    {searchOpen && <form className="terminal-search" role="search" aria-label="Terminalverlauf durchsuchen"
      onSubmit={(event) => { event.preventDefault(); find(); }} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSearch(); }
        else if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); find(query, true); }
      }}>
      <input ref={searchInput} type="search" aria-label="Im Terminal suchen" maxLength={200} value={query} placeholder="Im Terminalverlauf suchen…"
        onChange={(event) => { setQuery(event.target.value); find(event.target.value, false, true); }} />
      <button type="button" disabled={!query} onClick={() => find(query, true)} title="Shift+Enter">Vorheriger Treffer</button>
      <button type="submit" disabled={!query} title="Enter">Nächster Treffer</button>
      <button type="button" aria-label="Terminalsuchen schliessen" onClick={closeSearch}>×</button>
      <span role="status">{searchResult}</span>
    </form>}
    {toolError && <div className="terminal-tool-error" role="alert">{toolError}<button onClick={() => setToolError('')} aria-label="Terminal-Werkzeugfehler schliessen">×</button></div>}
    <span className="terminal-tool-status" role="status">{toolNotice}</span>
    <SubscriptionUsagePanel key={sessionId} load={() => window.ade.invoke('terminal:usage', { sessionId })} />
    {profileContext && <SessionProfileContext key={sessionId} context={profileContext}
      readText={() => window.ade.invoke('terminal:profileContext', { sessionId })}
      readRevision={async () => (await window.ade.invoke('agent:behaviorGet', { agentId: profileContext.profileId })).revision} />}
    {remoteInput && <div role="status" className="terminal-control-banner" style={{ padding: '8px 12px', display: 'flex', gap: 12, alignItems: 'center' }}>
      <span>Dieses Terminal wird von einem verbundenen Gerät gesteuert.</span>
      <button className="btn" onClick={() => { void window.ade.invoke('terminal:reclaim', { sessionId }).then(() => termRef.current?.focus())
        .catch(() => setToolError('Eingabe konnte nicht übernommen werden. Erneut versuchen.')); }}>Eingabe am Desktop übernehmen</button>
    </div>}
    <div className={`terminal-prompt-layout${promptOpen ? ' terminal-prompt-layout-open' : ''}`}>
    <div className="terminal-host" ref={hostRef} />
    {promptOpen && <DesktopPromptDialog sessionId={sessionId}
      label={`${session?.title ?? 'CLI'} · ${repository?.name ?? 'Eigener Workspace'}${session?.branch ? ` · ${session.branch}` : ''}`}
      onClose={() => setPromptOpen(false)} focusTerminal={() => termRef.current?.focus()}
      fallbackFocus={() => [...document.querySelectorAll<HTMLElement>('.terminal-host .xterm-helper-textarea, [role="tab"][aria-selected="true"]')]
        .find(element => element.getClientRects().length > 0) ?? null} />}
    </div>
  </div>;
}
