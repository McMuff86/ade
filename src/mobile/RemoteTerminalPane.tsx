import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { MobileTerminalCommand, MobileTerminalInput, MobileTerminalState, SessionLaunchChoice, SessionLaunchOptions } from '../shared/remote';
import { canLaunchChoice, SessionLaunchFields } from '../renderer/sessions/SessionLaunchFields';
import type { MobileHost } from './useMobileHost';
import { MobileClientError } from './client';
import { workspaceError } from './AgentWorkspace';
import { Dialog } from './ui';
import { useDeviceDraft } from './deviceDrafts';
import { TerminalScreen } from './TerminalScreen';
import { TerminalInputQueue } from './TerminalInputQueue';
import { DashboardLink } from './DashboardLink';
import { SESSION_LAUNCH_LABELS } from '../shared/sessionLaunch';
import { TabletKeyboardContext } from './useTabletViewport';
import { openTerminalKeyboard } from './terminalKeyboard';

interface TerminalDraft { text: string; review: boolean }

export function RemoteTerminalPane({ host, agentId, repositoryId, active, initialTerminalId, projectEntry, compactControls, profileIntent, onProfileIntentConsumed }: {
  host: MobileHost; agentId: string; repositoryId: string | null; active: boolean;
  initialTerminalId?: string;
  projectEntry?: boolean;
  compactControls?: boolean;
  profileIntent?: string; onProfileIntentConsumed?: () => void;
}): JSX.Element {
  const keyboardOpen = useContext(TabletKeyboardContext);
  const [state, setState] = useState<MobileTerminalState>({ terminals: [] });
  const [remembered, remember] = useDeviceDraft(host.deviceId, `terminal-selection:${agentId}:${repositoryId ?? 'home'}`, '');
  const [selected, select] = useState(initialTerminalId ?? remembered);
  const setSelected = (id: string) => { select(id); remember(id); };
  const [draft, saveDraft, durable] = useDeviceDraft<TerminalDraft>(host.deviceId, `terminal-draft:${agentId}:${repositoryId ?? 'home'}:${selected}`, { text: '', review: false });
  const text = draft.text; const setText = (value: string) => saveDraft((current) => ({ ...current, text: value }));
  const [launchOpen, setLaunchOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(!!draft.text || draft.review);
  const [focused, setFocused] = useState(!!profileIntent);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState('');
  const [responseMs, setResponseMs] = useState<number>();
  const [pending, setPending] = useDeviceDraft<{ command: MobileTerminalCommand; key: string } | null>(host.deviceId, `terminal-command:${agentId}:${repositoryId ?? 'home'}`, null);
  const [uncertain, setUncertain] = useState<MobileTerminalInput | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [choice, setChoice] = useState<SessionLaunchChoice>({ mode: projectEntry ? 'codex' : 'agent' });
  const [projectMode, setProjectMode] = useState<'codex' | 'claude' | 'grok' | 'shell'>('codex');
  const [profileOpening, setProfileOpening] = useState(false);
  const profileLock = useRef(false);
  const [options, setOptions] = useState<SessionLaunchOptions>();
  const [loadingOptions, setLoadingOptions] = useState(false); const [optionsRefresh, setOptionsRefresh] = useState(0);
  const lock = useRef(false); const live = useRef(true); const queryVersion = useRef(0);
  const stateRef = useRef(state); stateRef.current = state;
  const input = useRef<HTMLTextAreaElement>(null);
  const screenRoot = useRef<HTMLElement>(null); const focusTerminal = useRef<Element | null>(null);
  const dimensions = useRef({ cols: 100, rows: 30 }); const resizePending = useRef(false);
  const directSending = useRef(false);
  const refreshNow = useRef<() => void>(() => undefined);
  const clearRevokedState = (reason: unknown) => {
    if (reason instanceof MobileClientError && [401, 403].includes(reason.status)) {
      queryVersion.current++; stateRef.current = { terminals: [] }; setState(stateRef.current);
    }
  };
  const query = useCallback(async (id = selected) => {
    const own = ++queryVersion.current;
    const started = performance.now();
    const result = await host.request<MobileTerminalState>('/api/v1/terminal/query', 'POST', { agentId, repositoryId, ...(id ? { terminalId: id } : {}) });
    if (live.current && own === queryVersion.current) {
      setResponseMs(Math.round(performance.now() - started));
      if (result.leaseId && result.leaseId === stateRef.current.leaseId && (stateRef.current.lastSequence ?? 0) > (result.lastSequence ?? 0)) {
        result.lastSequence = stateRef.current.lastSequence; result.inputUncertain = stateRef.current.inputUncertain;
      }
      setState(result); stateRef.current = result;
    }
    return result;
  }, [host.request, agentId, repositoryId, selected]);
  useEffect(() => { live.current = true; return () => { live.current = false; queryVersion.current++; }; }, []);
  useEffect(() => {
    if (!active || host.status !== 'online') return;
    let stopped = false; setLoadingOptions(true); setOptions(undefined);
    void host.request<MobileTerminalState>('/api/v1/terminal/query', 'POST', { agentId, repositoryId, options: true })
      .then((result) => { if (!stopped) setOptions(result.launchOptions); })
      .catch((reason) => { if (!stopped) { clearRevokedState(reason); setError(terminalError(reason)); } })
      .finally(() => { if (!stopped) setLoadingOptions(false); });
    return () => { stopped = true; };
  }, [active, host.status, host.request, agentId, repositoryId, optionsRefresh]);
  useEffect(() => {
    if (!active || host.status !== 'online') return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>; let refreshing = false; let requested = false;
    const refresh = async () => {
      if (stopped) return;
      if (refreshing) { requested = true; return; }
      if (document.hidden) { timer = setTimeout(() => void refresh(), 1000); return; }
      refreshing = true; requested = false;
      try { await query(); if (!stopped) setReadError(''); }
      catch (reason) { if (!stopped && live.current) {
        if (reason instanceof MobileClientError && [401, 403, 409].includes(reason.status)) {
          setState({ terminals: [] }); stateRef.current = { terminals: [] };
        }
        setReadError(terminalError(reason));
        if (selected && reason instanceof MobileClientError && reason.status === 409) {
          setSelected(''); setLaunchOpen(true); setNotice('Die vorherige Sitzung ist nicht mehr verfügbar. ADE wurde möglicherweise neu gestartet.');
        }
      } }
      refreshing = false;
      if (!stopped) timer = setTimeout(() => void refresh(), requested ? 0 : 100);
    };
    const wake = () => { clearTimeout(timer); void refresh(); };
    refreshNow.current = wake; document.addEventListener('visibilitychange', wake);
    void refresh(); return () => { stopped = true; clearTimeout(timer); queryVersion.current++; refreshNow.current = () => undefined; document.removeEventListener('visibilitychange', wake); };
  }, [active, host.status, query, repositoryId]);
  const command = async (operation: MobileTerminalCommand, retry = false) => {
    if (lock.current || host.status !== 'online') return;
    const request = retry && pending ? pending : { command: operation, key: crypto.randomUUID() };
    if (!setPending(request)) { setError('Browser-Speicher ist nicht verfügbar. Terminalaktion wurde nicht gesendet.'); return; }
    lock.current = true; setBusy(true); setError(''); setNotice('');
    if (operation.operation === 'claim' || operation.operation === 'open') focusTerminal.current = document.activeElement;
    try {
      const result = await host.request<{ terminalId: string }>('/api/v1/terminal/command', 'POST', request.command, request.key);
      if (!live.current) return;
      setPending(null); setUncertain(null); setSelected(request.command.operation === 'close' ? '' : result.terminalId);
      await query(request.command.operation === 'close' ? '' : result.terminalId);
      if (request.command.operation === 'open') { setLaunchOpen(false); setComposeOpen(false); }
      setNotice(request.command.operation === 'release' ? 'Eingabe freigegeben.' : request.command.operation === 'close' ? 'Sitzung beendet.' : 'Terminal ist verbunden.');
    } catch (reason) {
      if (!live.current) return;
      clearRevokedState(reason);
      if (reason instanceof MobileClientError && [400, 403, 404, 409, 422].includes(reason.status)) setPending(null);
      setError(terminalError(reason));
    } finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const transmit = async (data: string, clearText = false): Promise<'accepted' | 'busy' | 'failed'> => {
    const current = stateRef.current;
    // Keep resize/lease heartbeats out of the query-then-open transaction.
    if (lock.current || profileLock.current) return 'busy';
    if (pending || uncertain || draft.review || current.inputUncertain || !current.leaseId || !current.selected || current.selected.owner !== 'self' || host.status !== 'online') return 'failed';
    if (new TextEncoder().encode(data).length > 2048) { setError('Eingabe auf höchstens 2048 Bytes kürzen.'); return 'failed'; }
    const request: MobileTerminalInput = { agentId, repositoryId, terminalId: current.selected.id, leaseId: current.leaseId,
      sequence: (current.lastSequence ?? 0) + 1, data, ...dimensions.current };
    lock.current = true; setBusy(true); setError('');
    try {
      if (data && !saveDraft((value) => ({ ...value, review: true }))) throw new Error('Browser-Speicher nicht verfügbar. Eingabe wurde nicht gesendet.');
      const result = await host.request<{ sequence: number }>('/api/v1/terminal/input', 'POST', request, crypto.randomUUID());
      if (!live.current) return 'failed';
      if (stateRef.current.leaseId === current.leaseId) {
        stateRef.current = { ...stateRef.current, lastSequence: result.sequence, inputUncertain: false }; setState(stateRef.current);
      }
      if (data) saveDraft((value) => ({ text: clearText ? '' : value.text, review: false }));
      if (!directSending.current) await query(current.selected.id); else refreshNow.current();
      return 'accepted';
    } catch (reason) {
      if (live.current) {
        clearRevokedState(reason);
        // A raced resize/heartbeat contains no keystrokes to review. Re-read ownership.
        if (data) { setUncertain(request); setComposeOpen(true); } else void query(current.selected.id).catch(() => undefined);
        setError(terminalError(reason));
      }
      return 'failed';
    }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const pulse = useRef(transmit); pulse.current = transmit;
  const consumedIntent = useRef<string | undefined>(undefined);
  const openProfile = async (mode: 'agent' | 'codex' | 'claude' | 'grok' | 'shell' = 'agent') => {
    if (profileLock.current || lock.current || pending || host.status !== 'online') return;
    profileLock.current = true; setProfileOpening(true); setFocused(true); setComposeOpen(false); setError('');
    focusTerminal.current = document.activeElement;
    try {
      const result = await query('');
      if (!live.current) return;
      const existing = result.terminals.filter((item) => item.status === 'running' && item.launchMode === mode).at(-1);
      if (existing) { setSelected(existing.id); await query(existing.id); }
      else await command({ operation: 'open', mode, agentId, repositoryId });
      if (live.current) setLaunchOpen(false);
    } catch (reason) { if (live.current) setError(terminalError(reason)); }
    finally { profileLock.current = false; if (live.current) setProfileOpening(false); }
  };
  useEffect(() => {
    if (!profileIntent || consumedIntent.current === profileIntent || !active) return;
    consumedIntent.current = profileIntent; onProfileIntentConsumed?.();
    void openProfile();
  }, [profileIntent, active]);
  const [keyboard] = useState(() => new TerminalInputQueue(async (data) => {
    directSending.current = true;
    try { return await pulse.current(data); } finally { directSending.current = false; }
  }, () => setError('Zu viel Tastatureingabe auf einmal. Ungesendete Zeichen wurden verworfen; Ausgabe prüfen.')));
  useEffect(() => { keyboard.clear(); if (state.leaseId) resizePending.current = true; return () => keyboard.clear(); }, [keyboard, selected, state.leaseId, host.status, active]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { if (resizePending.current && !document.hidden) {
      void pulse.current('').then((result) => { if (result === 'accepted') resizePending.current = false; });
    } }, 1000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { if (!document.hidden) void pulse.current(''); }, 10_000);
    return () => clearInterval(timer);
  }, [active]);
  const blocked = busy || profileOpening || !!pending || !!uncertain || !!state.inputUncertain || host.status !== 'online';
  const owning = state.selected?.owner === 'self';
  const inputEnabled = owning && !profileOpening && host.status === 'online' && !pending && !uncertain && !state.inputUncertain
    && (!draft.review || directSending.current) && state.selected?.status === 'running';
  const action = (operation: 'claim' | 'release' | 'close') => command({ operation, agentId, repositoryId, terminalId: selected });
  const agent = host.catalog?.agents.find((item) => item.id === agentId);
  useLayoutEffect(() => {
    if (!focusTerminal.current || !active || !owning || busy || profileOpening) return;
    const target = screenRoot.current?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
    if (target) {
      if (document.activeElement === focusTerminal.current || document.activeElement === document.body) target.focus({ preventScroll: true });
      focusTerminal.current = null;
    }
  }, [active, owning, busy, profileOpening, state.frame]);
  return <section ref={screenRoot} className={`m-remote-terminal ${focused ? 'm-terminal-focused' : ''} ${compactControls && state.selected ? 'm-keyboard-compact' : ''}`} aria-label="Interaktives Terminal">
    <div className="m-terminal-focus-bar" id="workspace-terminal-controls">{projectEntry && <label>Arbeiten mit<select aria-label="Projekt-CLI" disabled={blocked} value={projectMode} onChange={(event) => setProjectMode(event.target.value as typeof projectMode)}>
      {(['codex', 'claude', 'grok', 'shell'] as const).map((mode) => <option key={mode} value={mode} disabled={!canLaunchChoice({ mode }, options)}>
        {SESSION_LAUNCH_LABELS[mode]}{!canLaunchChoice({ mode }, options) ? ' · nicht verfügbar' : ''}</option>)}
    </select></label>}
      <button className="m-primary" disabled={blocked || !!projectEntry && !canLaunchChoice({ mode: projectMode }, options)} onClick={() => void openProfile(projectEntry ? projectMode : 'agent')}>
        {projectEntry ? SESSION_LAUNCH_LABELS[projectMode] : agent?.name ?? 'Agent'} öffnen</button>
      <button aria-pressed={focused} onClick={() => { setFocused(!focused); if (!focused) setComposeOpen(false); }}>{focused ? 'Workspace einblenden' : 'Terminal vergrössern'}</button>
      {state.selected && <span>{state.selected.launchMode === 'agent' ? 'Agent-Profil' : SESSION_LAUNCH_LABELS[state.selected.launchMode ?? 'shell']} · {state.selected.status === 'running' ? 'läuft' : 'beendet'}</span>}
      {focused && <><span role="status">{host.status !== 'online' ? 'Offline · letzter Anzeigestand' : owning ? 'Eingabe: Tablet' : 'Eingabe: PC / anderes Gerät'}</span>
        {state.selected && <>{!owning && <button disabled={blocked || state.selected.owner === 'other' || state.selected.status !== 'running'} onClick={() => void action('claim')}>Eingabe übernehmen</button>}
          {owning && <button disabled={busy || !!pending || host.status !== 'online'} onClick={() => void action('release')}>Eingabe freigeben</button>}
          <button disabled={blocked || !owning} onClick={() => setConfirmClose(true)}>Sitzung beenden</button></>}
        {agent && <DashboardLink agent={agent} />}</>}
    </div>
    <div className="m-terminal-tools">
    {profileOpening && <p role="status">{projectEntry ? SESSION_LAUNCH_LABELS[projectMode] : agent?.name ?? 'Agent'} wird geöffnet…</p>}
    {projectEntry && loadingOptions && <p role="status">Installierte CLIs werden geprüft…</p>}
    {projectEntry && !loadingOptions && options?.choices.find((item) => item.mode === projectMode)?.notice && <p role="status">{options.choices.find((item) => item.mode === projectMode)?.notice}</p>}
    <p>Die Sitzung läuft auf deinem PC weiter. Wähle eine bestehende Sitzung oder starte eine neue im ausgewählten Workspace.</p>
    <details open={launchOpen} onToggle={(event) => setLaunchOpen(event.currentTarget.open)}><summary>Neue Sitzung starten</summary>
    <div className="m-management-actions"><button disabled={blocked} onClick={() => void command({ operation: 'open', mode: 'shell', agentId, repositoryId })}>Shell öffnen</button>
      </div>
    <SessionLaunchFields choice={choice} onChange={setChoice} options={options} disabled={blocked} loading={loadingOptions} />
    <div className="m-management-actions"><button disabled={blocked || !canLaunchChoice(choice, options)}
      onClick={() => void command({ operation: 'open', agentId, repositoryId, ...choice })}>Sitzung starten</button>
      <button disabled={blocked || loadingOptions} onClick={() => setOptionsRefresh((n) => n + 1)}>Startmöglichkeiten aktualisieren</button></div>
    </details>
    <label>Sitzung<select aria-label="Terminal-Sitzung" disabled={blocked} value={selected} onChange={(event) => { setSelected(event.target.value); setError(''); setState({ terminals: state.terminals }); }}>
      <option value="">Sitzung wählen</option>{state.terminals.map((terminal) => <option key={terminal.id} value={terminal.id}>{terminal.title} · {terminal.status === 'running' ? 'läuft' : 'beendet'}</option>)}</select></label>
    {!state.terminals.length && !error && <p>Keine verfügbaren interaktiven Sitzungen. Verwaltete Aufgaben erscheinen in Work.</p>}
    {(error || readError) && <p role="alert" className="m-alert">{error || readError}</p>}{notice && <p role="status" className="m-terminal-notice">{notice}</p>}
    {pending && <button disabled={busy || host.status !== 'online'} onClick={() => void command(pending.command, true)}>Terminalaktion erneut prüfen</button>}
    {uncertain && <div className="m-notice"><p>Die letzte Eingabe ist nicht bestätigt. Sie wird nicht automatisch wiederholt.</p>
      <button disabled={busy || host.status !== 'online'} onClick={() => { void query().then((result) => {
        if (result.leaseId === uncertain.leaseId && !result.inputUncertain && (result.lastSequence ?? 0) >= uncertain.sequence) { setUncertain(null); saveDraft({ text: '', review: false }); setNotice('Eingabe wurde vom PC angenommen.'); }
        else setNotice('Eingabe bleibt unbestätigt. Anzeige prüfen und die Steuerung freigeben, bevor du fortfährst.');
      }).catch((reason) => setError(terminalError(reason))); }}>Eingabestatus prüfen</button></div>}
    {draft.review && !directSending.current && <p role="alert">Eine frühere Eingabe ist noch unbestätigt. Ausgabe prüfen, bevor du den Entwurf erneut verwendest.
      <button disabled={busy || !!uncertain || !!state.inputUncertain || host.status !== 'online'} onClick={() => saveDraft((value) => ({ ...value, review: false }))}>Ausgabe geprüft · Entwurf freigeben</button></p>}
    {state.selected && <><p role="status">{state.selected.status === 'exited' ? 'Prozess beendet. Die Ausgabe bleibt lesbar.' : owning ? 'Du steuerst die Eingabe.' : state.selected.owner === 'other' ? 'Ein anderes Gerät steuert die Eingabe.' : 'Der Desktop steuert die Eingabe.'}</p>
      {state.inputUncertain && <p role="alert">Eine Eingabe konnte nicht sicher an den Prozess übergeben werden. Ausgabe prüfen und die Eingabe freigeben; sie wird nicht wiederholt.</p>}
      <div className="m-management-actions"><button disabled={blocked || owning || state.selected.owner === 'other' || state.selected.status !== 'running'} onClick={() => void action('claim')}>Eingabe übernehmen</button>
        <button disabled={busy || !!pending || !owning || host.status !== 'online'} onClick={() => void action('release')}>Eingabe freigeben</button>
        <button className="m-danger" disabled={blocked || !owning} onClick={() => setConfirmClose(true)}>Sitzung beenden</button></div></>}
    </div>
    {state.selected && <>{state.frame ? <TerminalScreen key={state.selected.id} frame={state.frame} active={active}
      enabled={inputEnabled}
      onData={(data) => keyboard.enqueue(data)} onSize={(cols, rows) => {
        if (dimensions.current.cols !== cols || dimensions.current.rows !== rows) { dimensions.current = { cols, rows }; resizePending.current = true; }
      }} /> : <pre tabIndex={0} className="m-terminal-screen" aria-label="Terminalanzeige">{state.screen || 'Warte auf Terminalausgabe…'}</pre>}
      {state.frame && <details className="m-terminal-transcript"><summary>Textausgabe und Verlauf</summary><pre tabIndex={0} aria-label="Terminal-Textverlauf">{state.screen}</pre></details>}
      <div className="m-terminal-composer"><details open={composeOpen} onToggle={(event) => setComposeOpen(event.currentTarget.open)}><summary>Text verfassen</summary>
      <form onSubmit={(event) => { event.preventDefault(); void transmit(`${text.replace(/\r?\n/g, '\r')}\r`, true); }}>
        <label>Terminal-Eingabe<textarea ref={input} aria-label="Terminal-Eingabe" value={text} maxLength={2000} disabled={!owning || host.status !== 'online'}
          onChange={(event) => setText(event.target.value)} rows={3} spellCheck={false} autoCapitalize="off" autoCorrect="off" /></label>
        <button disabled={blocked || draft.review || !owning || !text || state.selected.status !== 'running'}>Text und Enter senden</button></form></details>
      <div className="m-management-actions"><button aria-label="Tastatur öffnen" disabled={!inputEnabled} onClick={() => openTerminalKeyboard(screenRoot.current?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea'), keyboardOpen)}>Tastatur</button>
      {[['Enter', '\r'], ['Tab', '\t'], ['Esc', '\x1b'], ['Ctrl+C', '\x03'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C']].map(([label, data]) =>
        <button key={label} aria-label={`Terminaltaste ${label}`} disabled={blocked || draft.review || !owning || state.selected?.status !== 'running'} onPointerDown={(event) => event.preventDefault()} onClick={() => void transmit(data!)}>{label}</button>)}</div>
      <p className="m-field-note">{durable ? 'Entwurf auf diesem Gerät gespeichert.' : 'Entwurf nur in dieser geöffneten Seite.'}</p></div>
    </>}
    <p className="m-field-note">{host.status === 'online' && responseMs !== undefined && <span aria-label="Terminal-Antwortzeit">PC-Antwort: {responseMs} ms (Netzwerk und Verarbeitung). </span>}Ins Terminal tippen für direkte Eingabe. Bekannte Zugangsdaten und PC-Pfade werden ausgeblendet. Nach 30 Sekunden ohne Verbindung geht die Eingabe an den Desktop zurück.</p>
    {confirmClose && <Dialog title="Terminalsitzung beenden" onClose={() => setConfirmClose(false)} fallbackId="workspace-refresh">
      <p>Der laufende Prozess dieser Sitzung wird beendet.</p><button onClick={() => setConfirmClose(false)}>Abbrechen</button>
      <button className="m-danger" onClick={() => { setConfirmClose(false); void action('close'); }}>Beenden bestätigen</button></Dialog>}
  </section>;
}
function terminalError(error: unknown): string {
  return error instanceof MobileClientError && error.code === 'scope_not_granted'
    ? 'Terminalzugriff fehlt. In ADE am PC unter Settings → Verbundene Geräte „Interaktive Terminals steuern“ für dieses Gerät freigeben.' : workspaceError(error);
}
