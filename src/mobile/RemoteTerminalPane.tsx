import { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import type { MobileTerminalCommand, MobileTerminalInput, MobileTerminalState, MobileTerminalSelection, SessionLaunchChoice, SessionLaunchOptions } from '../shared/remote';
import { canLaunchChoice, SessionLaunchFields } from '../renderer/sessions/SessionLaunchFields';
import type { MobileHost } from './useMobileHost';
import { MobileClientError } from './client';
import { workspaceError } from './AgentWorkspace';
import { Dialog, DialogHeaderSlot } from './ui';
import { useDeviceDraft } from './deviceDrafts';
import { TerminalScreen } from './TerminalScreen';
import { SubscriptionUsagePanel } from '../renderer/terminal/SubscriptionUsagePanel';
import { SessionProfileContext } from '../renderer/terminal/SessionProfileContext';
import { TerminalInputQueue } from './TerminalInputQueue';
import { DashboardLink } from './DashboardLink';
import { SESSION_LAUNCH_LABELS } from '../shared/sessionLaunch';
import { canReuseLaunch, sessionStateLabel } from '../shared/sessionState';
import { TabletKeyboardContext } from './useTabletViewport';
import { openTerminalKeyboard } from './terminalKeyboard';
import { MobilePromptDialog } from './PromptDialog';
import type { MobileTerminalPrompt } from '../shared/remote';
import { mobileReplyPort } from './replySpeechPort';

interface TerminalDraft { text: string; review: boolean }

export function RemoteTerminalPane({ host, agentId, repositoryId, projectWorkspaceId, terminalHome, expectedBranch, active, initialTerminalId, projectEntry, compactControls, profileIntent, onProfileIntentConsumed, fallbackFocusId = 'workspace-refresh', onSelectionChanged, defaultProfileId }: MobileTerminalSelection & {
  host: MobileHost; active: boolean; expectedBranch?: string;
  fallbackFocusId?: string;
  defaultProfileId?: string;
  onSelectionChanged?: (id: string) => void;
  initialTerminalId?: string;
  projectEntry?: boolean;
  compactControls?: boolean;
  profileIntent?: string; onProfileIntentConsumed?: () => void;
}): JSX.Element {
  const keyboardOpen = useContext(TabletKeyboardContext);
  const headerSlot = useContext(DialogHeaderSlot);
  const controlsId = useId();
  const [controlsExpanded, setControlsExpanded] = useDeviceDraft(host.deviceId, 'terminal-controls-expanded', true);
  const selection = useMemo<MobileTerminalSelection>(() => terminalHome ? { terminalHome: true } : projectWorkspaceId ? { projectWorkspaceId } : { agentId: agentId!, repositoryId: repositoryId! }, [terminalHome, projectWorkspaceId, agentId, repositoryId]);
  const scopeKey = terminalHome ? 'terminal-home' : projectWorkspaceId ? `project/${projectWorkspaceId}` : `${agentId}:${repositoryId ?? 'home'}`;
  const [fontSize, setFontSize] = useDeviceDraft(host.deviceId, 'terminal-font-size', 14);
  const [profileId, setProfileId] = useState(defaultProfileId ?? '');
  const launch = (selectedChoice: SessionLaunchChoice): MobileTerminalCommand => ({ ...selection, operation: 'open', ...selectedChoice,
    ...(projectWorkspaceId ? { expectedBranch, ...(selectedChoice.mode === 'agent' ? { profileId } : {}) } : {}) });
  const [state, setState] = useState<MobileTerminalState>({ terminals: [] });
  const [remembered, remember] = useDeviceDraft(host.deviceId, `terminal-selection:${scopeKey}`, '');
  const [selected, select] = useState(initialTerminalId ?? remembered);
  const replyPort = useMemo(() => mobileReplyPort(host.request, { ...selection, terminalId: selected }), [host.request, selection, selected]);
  const setSelected = (id: string) => { select(id); remember(id); onSelectionChanged?.(id); };
  useEffect(() => { if (initialTerminalId !== undefined && initialTerminalId !== selected) setSelected(initialTerminalId); }, [initialTerminalId]);
  const [draft, saveDraft, durable] = useDeviceDraft<TerminalDraft>(host.deviceId, `terminal-draft:${scopeKey}:${selected}`, { text: '', review: false });
  const text = draft.text; const setText = (value: string) => saveDraft((current) => ({ ...current, text: value }));
  const [launchOpen, setLaunchOpen] = useState(!!terminalHome && !initialTerminalId);
  const [composeOpen, setComposeOpen] = useState(!!draft.text || draft.review);
  const [promptOpen, setPromptOpen] = useState(false);
  const promptOpener = useRef<HTMLButtonElement>(null);
  useEffect(() => { setPromptOpen(false); }, [selected, active]);
  const [focused, setFocused] = useState(!!profileIntent || !!initialTerminalId);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState('');
  const [responseMs, setResponseMs] = useState<number>();
  const [pending, setPending] = useDeviceDraft<{ command: MobileTerminalCommand; key: string } | null>(host.deviceId, `terminal-command:${scopeKey}`, null);
  const [uncertain, setUncertain] = useState<MobileTerminalInput | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [choice, setChoice] = useState<SessionLaunchChoice>({ mode: terminalHome ? 'shell' : projectEntry ? 'codex' : 'agent' });
  const [projectMode, setProjectMode] = useState<'codex' | 'claude' | 'grok' | 'shell'>(terminalHome ? 'shell' : 'codex');
  const [profileOpening, setProfileOpening] = useState(false);
  const profileLock = useRef(false);
  const [options, setOptions] = useState<SessionLaunchOptions>();
  const [loadingOptions, setLoadingOptions] = useState(false); const [optionsRefresh, setOptionsRefresh] = useState(0);
  const lock = useRef(false); const commandLock = useRef(false); const live = useRef(true); const queryVersion = useRef(0);
  const stateRef = useRef(state); stateRef.current = state;
  const input = useRef<HTMLTextAreaElement>(null);
  const screenRoot = useRef<HTMLElement>(null); const focusTerminal = useRef<Element | null>(null);
  const dimensions = useRef({ cols: 100, rows: 30 }); const resizePending = useRef(false);
  const directSending = useRef(false);
  const typingUntil = useRef(0);
  const refreshNow = useRef<() => void>(() => undefined);
  const clearRevokedState = (reason: unknown) => {
    if (reason instanceof MobileClientError && [401, 403].includes(reason.status)) {
      queryVersion.current++; stateRef.current = { terminals: [] }; setState(stateRef.current);
    }
  };
  const query = useCallback(async (id = selected) => {
    const own = ++queryVersion.current;
    const started = performance.now();
    const previous = stateRef.current;
    const knownDisplayRevision = id && previous.selected?.id === id ? previous.displayRevision : undefined;
    let result: MobileTerminalState;
    try { result = await host.request<MobileTerminalState>('/api/v1/terminal/query', 'POST', { ...selection, ...(id ? { terminalId: id } : {}),
      ...(knownDisplayRevision ? { knownDisplayRevision } : {}) }); }
    catch (reason) {
      // A reply for the previous selection must not erase a newer close/open
      // result. Apply the same generation rule to failures as to successful reads.
      if (!live.current || own !== queryVersion.current) return stateRef.current;
      throw reason;
    }
    if (live.current && own === queryVersion.current) {
      if (result.displayUnchanged) {
        if (!knownDisplayRevision || result.displayRevision !== knownDisplayRevision || result.selected?.id !== previous.selected?.id) {
          throw new Error('Terminalanzeige konnte nicht zugeordnet werden. Sitzung erneut öffnen.');
        }
        result.frame = previous.frame; result.screen = previous.screen;
      }
      setResponseMs(Math.round(performance.now() - started));
      if (result.leaseId && result.leaseId === stateRef.current.leaseId && (stateRef.current.lastSequence ?? 0) > (result.lastSequence ?? 0)) {
        result.lastSequence = stateRef.current.lastSequence; result.inputUncertain = stateRef.current.inputUncertain;
      }
      setState(result); stateRef.current = result;
    }
    return result;
  }, [host.request, selection, selected]);
  useEffect(() => { live.current = true; return () => { live.current = false; queryVersion.current++; }; }, []);
  useEffect(() => {
    if (!active || host.status !== 'online') return;
    let stopped = false; setLoadingOptions(true); setOptions(undefined);
    void host.request<MobileTerminalState>('/api/v1/terminal/query', 'POST', { ...selection, options: true })
      .then((result) => { if (!stopped) setOptions(result.launchOptions); })
      .catch((reason) => { if (!stopped) { clearRevokedState(reason); setError(terminalError(reason)); } })
      .finally(() => { if (!stopped) setLoadingOptions(false); });
    return () => { stopped = true; };
  }, [active, host.status, host.request, selection, optionsRefresh]);
  useEffect(() => {
    if (!active || host.status !== 'online') return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>; let refreshing = false; let requested = false;
    const refresh = async () => {
      if (stopped) return;
      if (refreshing) { requested = true; return; }
      if (document.hidden || commandLock.current) { timer = setTimeout(() => void refresh(), document.hidden ? 1000 : 100); return; }
      refreshing = true; requested = false;
      const previousRevision = stateRef.current.frame?.revision;
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
      if (!stopped) timer = setTimeout(() => void refresh(), requested ? 0 : performance.now() < typingUntil.current ? 16 : stateRef.current.frame?.revision !== previousRevision ? 40 : 100);
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
    commandLock.current = true;
    queryVersion.current++;
    if (operation.operation === 'claim' || operation.operation === 'open') focusTerminal.current = document.activeElement;
    try {
      const result = await host.request<{ terminalId: string }>('/api/v1/terminal/command', 'POST', request.command, request.key);
      if (!live.current) return;
      setPending(null); setUncertain(null); setSelected(request.command.operation === 'close' ? '' : result.terminalId);
      await query(request.command.operation === 'close' ? '' : result.terminalId);
      if (request.command.operation === 'open') { setLaunchOpen(false); setComposeOpen(false); }
      if (request.command.operation === 'close') document.getElementById(fallbackFocusId)?.focus();
      setNotice(request.command.operation === 'release' ? 'Eingabe freigegeben.' : request.command.operation === 'close' ? 'Sitzung beendet.' : 'Terminal ist verbunden.');
    } catch (reason) {
      if (!live.current) return;
      clearRevokedState(reason);
      if (reason instanceof MobileClientError && [400, 403, 404, 409, 422].includes(reason.status)) setPending(null);
      setError(terminalError(reason));
    } finally { commandLock.current = false; lock.current = false; if (live.current) setBusy(false); }
  };
  const transmit = async (data: string, clearText = false): Promise<'accepted' | 'busy' | 'failed'> => {
    const current = stateRef.current;
    // Keep resize/lease heartbeats out of the query-then-open transaction.
    if (lock.current || profileLock.current) return 'busy';
    if (pending || uncertain || draft.review || current.inputUncertain || !current.leaseId || !current.selected || current.selected.owner !== 'self' || host.status !== 'online') return 'failed';
    if (new TextEncoder().encode(data).length > 2048) { setError('Eingabe auf höchstens 2048 Bytes kürzen.'); return 'failed'; }
    const request: MobileTerminalInput = { ...selection, terminalId: current.selected.id, leaseId: current.leaseId,
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
      const existing = result.terminals.filter((item) => canReuseLaunch(item, mode) && (!projectWorkspaceId || item.launchProfileId === (mode === 'agent' ? profileId : undefined))).at(-1);
      if (existing) { setSelected(existing.id); await query(existing.id); }
      else await command(launch({ mode }));
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
  const sendPrompt = async (text: string, mode: 'insert' | 'submit', key: string) => {
    const targetId = selected; const leaseId = stateRef.current.leaseId;
    const deadline = performance.now() + 5000;
    while ((!keyboard.idle || lock.current) && performance.now() < deadline) await new Promise(done => setTimeout(done, 8));
    const current = stateRef.current;
    if (!live.current || !keyboard.idle || lock.current || profileLock.current || pending || uncertain || draft.review || current.inputUncertain
      || current.selected?.id !== targetId || !leaseId || current.leaseId !== leaseId || current.selected.owner !== 'self' || host.status !== 'online') {
      throw new Error('Terminal ist noch beschäftigt oder die Eingabe wurde übernommen. Entwurf behalten und Terminal prüfen.');
    }
    const outgoing: MobileTerminalPrompt = { ...selection, terminalId: targetId, leaseId, sequence: (current.lastSequence ?? 0) + 1, text, mode, ...dimensions.current };
    lock.current = true; setBusy(true);
    try {
      const receipt = await host.request<{ sequence: number; replayed: boolean }>('/api/v1/terminal/prompt', 'POST', outgoing, key);
      if (stateRef.current.leaseId === leaseId) {
        stateRef.current = { ...stateRef.current, lastSequence: receipt.sequence, inputUncertain: false }; setState(stateRef.current);
      }
      refreshNow.current(); return { accepted: true as const, replayed: receipt.replayed };
    } catch (reason) {
      if (live.current) { stateRef.current = { ...stateRef.current, inputUncertain: true }; setState(stateRef.current); refreshNow.current(); }
      throw reason;
    } finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const owning = state.selected?.owner === 'self';
  const inputEnabled = owning && !profileOpening && host.status === 'online' && !pending && !uncertain && !state.inputUncertain
    && (!draft.review || directSending.current) && state.selected?.status === 'running';
  const action = (operation: 'claim' | 'release' | 'close') => command({ operation, ...selection, terminalId: selected });
  const agent = host.catalog?.agents.find((item) => item.id === agentId);
  useLayoutEffect(() => {
    if (!focusTerminal.current || !active || !owning || busy || profileOpening) return;
    const target = screenRoot.current?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
    if (target) {
      if (document.activeElement === focusTerminal.current || document.activeElement === document.body) target.focus({ preventScroll: true });
      focusTerminal.current = null;
    }
  }, [active, owning, busy, profileOpening, state.frame]);
  const controlsVisible = !state.selected || controlsExpanded;
  const statusBar = <div className="m-terminal-status-bar" aria-label="Terminalstatus">
    <span role="status">{host.status !== 'online' ? 'Offline' : state.selected?.status === 'exited' ? 'Sitzung beendet' : state.selected ? 'Terminal verbunden' : 'Keine Sitzung'}</span>
    {state.selected && <span role="status" aria-label="CLI- und Terminalstatus">{sessionStateLabel(state.selected)}</span>}
    {state.selected?.status === 'running' && <span role="status">{owning ? 'Eingabe: Du (Tablet)' : state.selected.owner === 'other' ? 'Eingabe: anderes Gerät' : 'Eingabe: Desktop'}</span>}
    {state.selected && <SubscriptionUsagePanel compact key={`usage-${state.selected.id}`} online={host.status === 'online'} load={async () => {
      const result = await host.request<MobileTerminalState>('/api/v1/terminal/query', 'POST', { ...selection, terminalId: state.selected!.id, usage: true });
      if (!result.subscriptionUsage) throw new Error('Nutzungsdaten fehlen.'); return result.subscriptionUsage;
    }} />}
    {state.selected && <button aria-expanded={controlsVisible} aria-controls={controlsId} onClick={() => setControlsExpanded(!controlsExpanded)}>Sitzung &amp; Workspace</button>}
    {/* Native disabled would blur this opener on every short lease heartbeat. */}
    {state.selected && <button ref={promptOpener} aria-haspopup="dialog" disabled={!owning || !state.leaseId} aria-disabled={blocked}
      onClick={event => { if (blocked) return; event.currentTarget.focus(); setPromptOpen(true); }}>Prompt / Diktat</button>}
  </div>;
  return <section ref={screenRoot} className={`m-remote-terminal ${focused ? 'm-terminal-focused' : ''} ${!controlsVisible ? 'm-controls-collapsed' : ''} ${compactControls && state.selected ? 'm-keyboard-compact' : ''}`} aria-label="Interaktives Terminal">
    {active && (headerSlot ? createPortal(statusBar, headerSlot) : statusBar)}
    <div className="m-terminal-focus-bar" id={controlsId} hidden={!controlsVisible}>{(projectEntry || terminalHome) && <label>Sitzung öffnen mit<select aria-label={terminalHome ? 'Terminal-CLI' : 'Projekt-CLI'} disabled={blocked} value={projectMode} onChange={(event) => setProjectMode(event.target.value as typeof projectMode)}>
      {(['codex', 'claude', 'grok', 'shell'] as const).map((mode) => <option key={mode} value={mode} disabled={!canLaunchChoice({ mode }, options)}>
        {SESSION_LAUNCH_LABELS[mode]}{!canLaunchChoice({ mode }, options) ? ' · nicht verfügbar' : ''}</option>)}
    </select></label>}
      <button className="m-primary" disabled={blocked || !!(projectEntry || terminalHome) && !canLaunchChoice({ mode: projectMode }, options)} onClick={() => void openProfile(projectEntry || terminalHome ? projectMode : 'agent')}>
        {projectEntry || terminalHome ? SESSION_LAUNCH_LABELS[projectMode] : agent?.name ?? 'Agent'} öffnen</button>
      <button aria-pressed={focused} onClick={() => { setFocused(!focused); if (!focused) setComposeOpen(false); }}>{focused ? 'Workspace einblenden' : 'Terminal vergrössern'}</button>
      <label>Schriftgrösse<select aria-label="Terminal-Schriftgrösse" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))}>
        {[12, 14, 16, 18, 20].map((size) => <option key={size} value={size}>{size} px</option>)}
      </select></label>
      {terminalHome && <span>Benutzerverzeichnis · Ohne Agent und Projekt</span>}
      {projectWorkspaceId && <span>{expectedBranch} · {state.selected?.launchProfileName ?? 'Ohne Agent-Profil'}</span>}
      {state.selected?.profileContext && <SessionProfileContext key={state.selected.id} context={state.selected.profileContext}
        readText={async () => (await host.request<MobileTerminalState>('/api/v1/terminal/query', 'POST', { ...selection, terminalId: state.selected!.id, profileContext: true })).profileContextText ?? null}
        readRevision={async () => (await host.request<{ revision: string }>('/api/v1/profile/behavior/query', 'POST', { agentId: state.selected!.profileContext!.profileId })).revision} />}
      {focused && <><span role="status">{host.status !== 'online' ? 'Offline · letzter Anzeigestand' : owning ? 'Eingabe: Tablet' : 'Eingabe: PC / anderes Gerät'}</span>
        {state.selected && <>{!owning && <button disabled={blocked || state.selected.owner === 'other' || state.selected.status !== 'running'} onClick={() => void action('claim')}>Eingabe übernehmen</button>}
          {owning && <button disabled={busy || !!pending || host.status !== 'online'} onClick={() => void action('release')}>Eingabe freigeben</button>}
          <button disabled={blocked || !owning} onClick={() => setConfirmClose(true)}>Sitzung beenden</button></>}
        {agent && <DashboardLink agent={agent} />}</>}
    </div>
    <div className="m-terminal-tools">
    {profileOpening && <p role="status">{projectEntry || terminalHome ? SESSION_LAUNCH_LABELS[projectMode] : agent?.name ?? 'Agent'} wird geöffnet…</p>}
    {(projectEntry || terminalHome) && loadingOptions && <p role="status">Installierte CLIs werden geprüft…</p>}
    {(projectEntry || terminalHome) && !loadingOptions && options?.choices.find((item) => item.mode === projectMode)?.notice && <p role="status">{options.choices.find((item) => item.mode === projectMode)?.notice}</p>}
    <p>{state.selected ? state.selected.status === 'running'
      ? 'Das Terminal bleibt auf dem PC offen. Der CLI-Status bezieht sich auf den von ADE gestarteten Aufruf.'
      : 'Dieses Terminal ist beendet. Du kannst die Ausgabe ansehen oder eine neue Sitzung starten.'
      : 'Wähle eine bestehende Sitzung oder starte eine neue im ausgewählten Workspace.'}</p>
    <details open={launchOpen} onToggle={(event) => setLaunchOpen(event.currentTarget.open)}><summary>Neue Sitzung starten</summary>
    <div className="m-management-actions"><button disabled={blocked} onClick={() => void command(launch({ mode: 'shell' }))}>Shell öffnen</button>
      </div>
    <SessionLaunchFields choice={choice} onChange={setChoice} options={options} disabled={blocked} loading={loadingOptions} />
    {projectWorkspaceId && choice.mode === 'agent' && <label>Startprofil<select aria-label="Startprofil" disabled={blocked} value={profileId} onChange={(event) => setProfileId(event.target.value)}>
      <option value="">Profil auswählen</option>{options?.profiles?.map((profile) => <option value={profile.id} key={profile.id}>{profile.name} · {profile.runtime}</option>)}</select></label>}
    <div className="m-management-actions"><button disabled={blocked || !canLaunchChoice(choice, options) || !!projectWorkspaceId && choice.mode === 'agent' && !profileId}
      onClick={() => void command(launch(choice))}>Sitzung starten</button>
      <button disabled={blocked || loadingOptions} onClick={() => setOptionsRefresh((n) => n + 1)}>Startmöglichkeiten aktualisieren</button></div>
    </details>
    <label>Sitzung<select aria-label="Terminal-Sitzung" disabled={blocked} value={selected} onChange={(event) => { setSelected(event.target.value); setError(''); setState({ terminals: state.terminals }); }}>
      <option value="">Sitzung wählen</option>{state.terminals.map((terminal) => <option key={terminal.id} value={terminal.id}>{sessionStateLabel(terminal)}</option>)}</select></label>
    {!state.terminals.length && !error && <p>Keine verfügbaren interaktiven Sitzungen. Verwaltete Aufgaben erscheinen in Work.</p>}
    {(error || readError) && <p role="alert" className="m-alert">{error || readError}</p>}{notice && notice !== 'Terminal ist verbunden.' && <p role="status" className="m-terminal-notice">{notice}</p>}
    {pending && <button disabled={busy || host.status !== 'online'} onClick={() => void command(pending.command, true)}>Terminalaktion erneut prüfen</button>}
    {uncertain && <div className="m-notice"><p>Die letzte Eingabe ist nicht bestätigt. Sie wird nicht automatisch wiederholt.</p>
      <button disabled={busy || host.status !== 'online'} onClick={() => { void query().then((result) => {
        if (result.leaseId === uncertain.leaseId && !result.inputUncertain && (result.lastSequence ?? 0) >= uncertain.sequence) { setUncertain(null); saveDraft({ text: '', review: false }); setNotice('Eingabe wurde vom PC angenommen.'); }
        else setNotice('Eingabe bleibt unbestätigt. Anzeige prüfen und die Steuerung freigeben, bevor du fortfährst.');
      }).catch((reason) => setError(terminalError(reason))); }}>Eingabestatus prüfen</button></div>}
    {draft.review && !directSending.current && <p role="alert">Eine frühere Eingabe ist noch unbestätigt. Ausgabe prüfen, bevor du den Entwurf erneut verwendest.
      <button disabled={busy || !!uncertain || !!state.inputUncertain || host.status !== 'online'} onClick={() => saveDraft((value) => ({ ...value, review: false }))}>Ausgabe geprüft · Entwurf freigeben</button></p>}
    {state.selected && <>
      {state.inputUncertain && <p role="alert">Eine Eingabe konnte nicht sicher an den Prozess übergeben werden. Ausgabe prüfen und die Eingabe freigeben; sie wird nicht wiederholt.</p>}
      <div className="m-management-actions"><button disabled={blocked || owning || state.selected.owner === 'other' || state.selected.status !== 'running'} onClick={() => void action('claim')}>Eingabe übernehmen</button>
        <button disabled={busy || !!pending || !owning || host.status !== 'online'} onClick={() => void action('release')}>Eingabe freigeben</button>
        <button className="m-danger" disabled={blocked || !owning} onClick={() => setConfirmClose(true)}>Sitzung beenden</button></div></>}
    </div>
    {state.selected && <>{state.frame ? <TerminalScreen key={state.selected.id} frame={state.frame} active={active}
      screen={state.screen ?? ''} enabled={inputEnabled} fontSize={fontSize} replyPort={host.status === 'online' && selected ? replyPort : undefined}
      onData={(data) => { typingUntil.current = performance.now() + 500; keyboard.enqueue(data); }} onSize={(cols, rows) => {
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
    {promptOpen && state.selected && state.leaseId && <MobilePromptDialog key={`${selected}/${state.leaseId}`} host={host}
      target={{ ...selection, terminalId: selected, leaseId: state.leaseId }} label={`${state.selected.projectName ?? agent?.name ?? (terminalHome ? 'Freies Terminal' : 'Projekt')} · ${state.selected.title} · ${state.selected.branch ?? expectedBranch ?? ''}`}
      send={sendPrompt} onClose={() => setPromptOpen(false)} fallbackId={fallbackFocusId} restoreFocusTo={() => promptOpener.current} />}
    {confirmClose && <Dialog title="Terminalsitzung beenden" onClose={() => setConfirmClose(false)} fallbackId={fallbackFocusId}>
      <p>Der laufende Prozess dieser Sitzung wird beendet.</p><button onClick={() => setConfirmClose(false)}>Abbrechen</button>
      {busy && <p role="status">Laufende Terminalaktion wird abgeschlossen…</p>}
      <button className="m-danger" disabled={blocked || !owning} onClick={() => {
        // A heartbeat can acquire the lock before React updates the button.
        // Keep the confirmation open instead of silently dropping its command.
        if (lock.current || profileLock.current || blocked || !owning) return;
        setConfirmClose(false); void action('close');
      }}>Beenden bestätigen</button></Dialog>}
  </section>;
}
function terminalError(error: unknown): string {
  return error instanceof MobileClientError && error.code === 'scope_not_granted'
    ? 'Terminalzugriff fehlt. In ADE am PC unter Settings → Verbundene Geräte „Interaktive Terminals steuern“ für dieses Gerät freigeben.' : workspaceError(error);
}
