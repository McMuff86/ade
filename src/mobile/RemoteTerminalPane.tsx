import { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import type { MobileTerminalCommand, MobileTerminalInput, MobileTerminalState, MobileTerminalSelection, SessionLaunchChoice, SessionLaunchOptions } from '../shared/remote';
import { canLaunchChoice, SessionLaunchFields } from '../renderer/sessions/SessionLaunchFields';
import type { MobileHost } from './useMobileHost';
import { MobileClientError } from './client';
import { workspaceError } from './AgentWorkspace';
import { Dialog, DialogHeaderSlot } from './ui';
import { useDeviceDraft } from './deviceDrafts';
import { LazyTerminalScreen as TerminalScreen } from './LazyTerminalScreen';
import { SubscriptionUsagePanel } from '../renderer/terminal/SubscriptionUsagePanel';
import { SessionProfileContext } from '../renderer/terminal/SessionProfileContext';
import { TerminalInputQueue } from './TerminalInputQueue';
import { DashboardLink } from './DashboardLink';
import { SESSION_LAUNCH_LABELS } from '../shared/sessionLaunch';
import { canReuseLaunch, sessionStateLabel } from '../shared/sessionState';
import { TabletKeyboardContext } from './useTabletViewport';
import { openTerminalKeyboard } from './terminalKeyboard';
import type { MobileTerminalPrompt } from '../shared/remote';
import { mobileReplyPort } from './replySpeechPort';
import { TerminalVoiceStrip } from './TerminalVoiceStrip';
import { TerminalImageButton } from './TerminalImageButton';
import { KeyboardIcon } from '../renderer/terminal/VoiceStrip';
import { SessionSwitchButton } from '../renderer/sessions/SessionSwitcher';
import { SupervisionButton } from '../renderer/supervision/SupervisionGraph';

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
  // A running session shows terminal and voice strip; launch and session
  // management stay one tap away behind "Sitzung & Workspace".
  const [controlsExpanded, setControlsExpanded] = useDeviceDraft(host.deviceId, 'terminal-controls-expanded', false);
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
  const [replySlot, setReplySlot] = useState<HTMLElement | null>(null);
  const [replySheetSlot, setReplySheetSlot] = useState<HTMLElement | null>(null);
  const [toolSlot, setToolSlot] = useState<HTMLElement | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [keysShown, setKeysShown] = useState(false);
  const [focused, setFocused] = useState(!!profileIntent || !!initialTerminalId);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState('');
  const [displayReady, setDisplayReady] = useState(false);
  const [explicitPending, setExplicitPending] = useState(false);
  const [commandPending, setCommandPending] = useState(false);
  const explicitLock = useRef(false);
  const inputConnection = useRef({ online: host.status === 'online', ready: displayReady, readError });
  inputConnection.current = { online: host.status === 'online', ready: displayReady, readError };
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
  const commandContext = useMemo(() => ({ active, online: host.status === 'online' }), [active, host.status, scopeKey, selected]);
  const commandContextRef = useRef(commandContext); commandContextRef.current = commandContext;
  const stateRef = useRef(state); stateRef.current = state;
  const input = useRef<HTMLTextAreaElement>(null);
  const launchButton = useRef<HTMLButtonElement>(null);
  const focusAfterClose = useRef(false);
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
    inputConnection.current.ready = false; setDisplayReady(false);
    if (!active || host.status !== 'online') return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>; let refreshing = false; let requested = false;
    const refresh = async () => {
      if (stopped) return;
      if (refreshing) { requested = true; return; }
      if (document.hidden || commandLock.current) { timer = setTimeout(() => void refresh(), document.hidden ? 1000 : 100); return; }
      refreshing = true; requested = false;
      const previousRevision = stateRef.current.frame?.revision;
      try { await query(); if (!stopped) { inputConnection.current.readError = ''; inputConnection.current.ready = true; setReadError(''); setDisplayReady(true); } }
      catch (reason) { if (!stopped && live.current) {
        if (reason instanceof MobileClientError && [401, 403, 409].includes(reason.status)) {
          setState({ terminals: [] }); stateRef.current = { terminals: [] };
        }
        inputConnection.current.readError = terminalError(reason);
        inputConnection.current.ready = false; setDisplayReady(false); setReadError(inputConnection.current.readError);
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
    if (commandLock.current || host.status !== 'online') return;
    const context = commandContextRef.current;
    const current = () => live.current && context === commandContextRef.current && context.active && context.online;
    let acquired = false;
    commandLock.current = true; setCommandPending(true); setError(''); setNotice('');
    try {
      // A dispatched tap can precede React's disabled paint. Reserve the command
      // before waiting, so another heartbeat cannot starve it. Never retry a POST.
      const deadline = performance.now() + 5000;
      while (lock.current && current() && performance.now() < deadline) await new Promise(done => setTimeout(done, 8));
      if (!current() || lock.current) {
        if (live.current) setError('Terminalaktion wurde nicht gesendet. Verbindung und Sitzung prüfen und erneut versuchen.');
        return;
      }
      const request = retry && pending ? pending : { command: operation, key: crypto.randomUUID() };
      if (!setPending(request)) { setError('Browser-Speicher ist nicht verfügbar. Terminalaktion wurde nicht gesendet.'); return; }
      lock.current = true; acquired = true; setBusy(true); queryVersion.current++;
      if (operation.operation === 'claim' || operation.operation === 'open') focusTerminal.current = document.activeElement;
      const result = await host.request<{ terminalId: string }>('/api/v1/terminal/command', 'POST', request.command, request.key);
      if (!live.current) return;
      setPending(null); setUncertain(null); setSelected(request.command.operation === 'close' ? '' : result.terminalId);
      await query(request.command.operation === 'close' ? '' : result.terminalId);
      if (request.command.operation === 'open') { setLaunchOpen(false); setComposeOpen(false); }
      if (request.command.operation === 'close') focusAfterClose.current = true;
      setNotice(request.command.operation === 'release' ? 'Eingabe freigegeben.' : request.command.operation === 'close' ? 'Sitzung beendet.' : 'Terminal ist verbunden.');
    } catch (reason) {
      if (!live.current) return;
      clearRevokedState(reason);
      if (reason instanceof MobileClientError && [400, 403, 404, 409, 422].includes(reason.status)) setPending(null);
      setError(terminalError(reason));
    } finally {
      commandLock.current = false; if (acquired) lock.current = false;
      if (live.current) { setCommandPending(false); if (acquired) setBusy(false); }
    }
  };
  const transmit = async (data: string, clearText?: string): Promise<'accepted' | 'busy' | 'failed'> => {
    const current = stateRef.current;
    // Keep resize/lease heartbeats out of the query-then-open transaction.
    if (lock.current || profileLock.current || commandLock.current) return 'busy';
    if (data && (!inputConnection.current.ready || inputConnection.current.readError)) return 'failed';
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
      if (data) saveDraft((value) => ({ text: value.text === clearText ? '' : value.text, review: false }));
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
    if (profileLock.current || commandLock.current || pending || host.status !== 'online') return;
    const context = commandContextRef.current;
    profileLock.current = true; setProfileOpening(true); setFocused(true); setComposeOpen(false); setError('');
    focusTerminal.current = document.activeElement;
    try {
      const deadline = performance.now() + 5000;
      while (lock.current && live.current && context === commandContextRef.current && performance.now() < deadline) await new Promise(done => setTimeout(done, 8));
      if (!live.current) return;
      if (lock.current || context !== commandContextRef.current || !context.active || !context.online) throw new Error('Terminalaktion wurde nicht gesendet. Verbindung und Sitzung prüfen und erneut versuchen.');
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
  useEffect(() => { if (readError) keyboard.clear(); }, [keyboard, readError]);
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
  const blocked = busy || commandPending || explicitPending || profileOpening || !!pending || !!uncertain || !!state.inputUncertain || host.status !== 'online';
  const submitTerminalText = async () => {
    if (explicitLock.current || !text) return;
    const captured = text; const terminalId = stateRef.current.selected?.id; const leaseId = stateRef.current.leaseId;
    explicitLock.current = true; setExplicitPending(true);
    const deadline = performance.now() + 5000;
    try {
      while (live.current && performance.now() < deadline) {
        // A heartbeat may take the lock before React paints disabled controls.
        // Wait only before dispatch, and never carry input across owners or reconnects.
        if (!terminalId || !leaseId || stateRef.current.selected?.id !== terminalId || stateRef.current.leaseId !== leaseId
          || !inputConnection.current.online || !inputConnection.current.ready || inputConnection.current.readError) break;
        const result = keyboard.idle ? await pulse.current(`${captured.replace(/\r?\n/g, '\r')}\r`, captured) : 'busy';
        if (result === 'accepted') return;
        if (result === 'failed') break;
        await new Promise(done => setTimeout(done, 8));
      }
      if (live.current) setError(current => current || 'Terminaleingabe wurde nicht bestätigt. Entwurf behalten und Terminal prüfen.');
    } finally { explicitLock.current = false; if (live.current) setExplicitPending(false); }
  };
  const sendPrompt = async (text: string, mode: 'insert' | 'submit', key: string, imageIds?: string[]) => {
    const targetId = selected; const leaseId = stateRef.current.leaseId;
    const deadline = performance.now() + 5000;
    while ((!keyboard.idle || lock.current) && performance.now() < deadline) await new Promise(done => setTimeout(done, 8));
    const current = stateRef.current;
    if (!live.current || !keyboard.idle || lock.current || commandLock.current || profileLock.current || pending || uncertain || draft.review || current.inputUncertain
      || current.selected?.id !== targetId || !leaseId || current.leaseId !== leaseId || current.selected.owner !== 'self' || !inputConnection.current.online || !inputConnection.current.ready || inputConnection.current.readError) {
      throw new Error('Terminal ist noch beschäftigt oder die Eingabe wurde übernommen. Entwurf behalten und Terminal prüfen.');
    }
    const outgoing: MobileTerminalPrompt = { ...selection, terminalId: targetId, leaseId, sequence: (current.lastSequence ?? 0) + 1, text, mode, ...(imageIds?.length ? { imageIds } : {}), ...dimensions.current };
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
  const inputEnabled = owning && !commandPending && !explicitPending && !profileOpening && host.status === 'online' && displayReady && !readError && !pending && !uncertain && !state.inputUncertain
    && (!draft.review || directSending.current) && state.selected?.status === 'running';
  const action = (operation: 'claim' | 'release' | 'close') => command({ operation, ...selection, terminalId: selected });
  const agent = host.catalog?.agents.find((item) => item.id === agentId);
  useLayoutEffect(() => {
    // Wait for React to reveal and enable the launcher after the close receipt.
    // A single animation frame may still see the previous disabled controls.
    if (!focusAfterClose.current || busy || pending || profileOpening || state.selected) return;
    const targets = [launchButton.current, document.getElementById(fallbackFocusId), screenRoot.current?.closest('dialog')?.querySelector<HTMLElement>('[data-dialog-heading]')];
    const target = targets.find((node) => node && !node.matches(':disabled') && node.getClientRects().length);
    if (target) { target.focus(); focusAfterClose.current = false; }
  }, [busy, pending, profileOpening, state.selected, fallbackFocusId]);
  useLayoutEffect(() => {
    if (!focusTerminal.current || !active || !owning || busy || profileOpening || !displayReady || readError || host.status !== 'online') return;
    const target = screenRoot.current?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
    if (target) {
      if (document.activeElement === focusTerminal.current || document.activeElement === document.body) target.focus({ preventScroll: true });
      focusTerminal.current = null;
    }
  }, [active, owning, busy, profileOpening, state.frame, displayReady, readError, host.status]);
  // Collapsed only while there is a live CLI to talk to. An exited CLI and an
  // explicit "Bedienung" request need the launch row.
  const cliIdle = !!state.selected && (state.selected.status !== 'running' || state.selected.program?.status === 'exited');
  const controlsVisible = !state.selected || controlsExpanded || cliIdle || (keyboardOpen && !compactControls);
  // One statement about who may type; the CLI label carries the process state.
  const ownerText = host.status !== 'online' ? 'Offline' : !state.selected ? 'Keine Sitzung' : state.selected.status === 'exited' ? 'Sitzung beendet'
    : owning ? 'Eingabe: Du (Tablet)' : state.selected.owner === 'other' ? 'Eingabe: anderes Gerät' : 'Eingabe: Desktop';
  const compactOwnership = compactControls && state.selected?.status === 'running' && !owning;
  const recover = (button: HTMLButtonElement) => {
    button.focus(); focusTerminal.current = button;
    if (host.status !== 'online') host.reconnect(); else refreshNow.current();
  };
  const statusBar = <div className="m-terminal-status-bar" aria-label="Terminalstatus">
    <span role="status" className="m-terminal-owner" data-state={host.status !== 'online' ? 'offline' : owning && state.selected?.status === 'running' ? 'own' : 'other'}>{ownerText}</span>
    {state.selected && <span role="status" aria-label="CLI- und Terminalstatus">{sessionStateLabel(state.selected)}</span>}
    {state.selected && <SubscriptionUsagePanel compact key={`usage-${state.selected.id}`} online={host.status === 'online'} load={async () => {
      const result = await host.request<MobileTerminalState>('/api/v1/terminal/query', 'POST', { ...selection, terminalId: state.selected!.id, usage: true });
      if (!result.subscriptionUsage) throw new Error('Nutzungsdaten fehlen.'); return result.subscriptionUsage;
    }} />}
    <SessionSwitchButton />
    <SupervisionButton repositoryId={state?.selected?.projectRepositoryId ?? repositoryId ?? undefined} />
    {state.selected && <button aria-expanded={controlsVisible} aria-controls={controlsId} onClick={() => setControlsExpanded(!controlsExpanded)}>Sitzung &amp; Workspace</button>}
    {focused && <button onClick={() => setFocused(false)}>Workspace einblenden</button>}
  </div>;
  return <section ref={screenRoot} className={`m-remote-terminal ${focused ? 'm-terminal-focused' : ''} ${!controlsVisible ? 'm-controls-collapsed' : ''} ${compactControls && state.selected ? 'm-keyboard-compact' : ''}`} aria-label="Interaktives Terminal">
    {active && (headerSlot ? createPortal(statusBar, headerSlot) : statusBar)}
    {state.selected && (host.status !== 'online' || !displayReady || readError || compactOwnership) && <div className="m-terminal-recovery" aria-label="Terminalverbindung">
      <p role="status">{host.status !== 'online' ? 'PC nicht verbunden. Die letzte Anzeige bleibt sichtbar; Eingabe pausiert.'
        : readError ? 'Terminalanzeige nicht aktuell. Eingabe pausiert, bis die Anzeige wieder geladen ist.'
        : !displayReady ? 'Terminalanzeige wird geladen. Eingabe pausiert.'
        : state.selected.owner === 'other' ? 'Ein anderes Gerät steuert diese Sitzung.' : 'Die Eingabe liegt beim PC. Zum Weiterschreiben übernehmen.'}</p>
      {host.status !== 'online' ? <button onClick={(event) => recover(event.currentTarget)}>Erneut verbinden</button>
        : readError ? <button onClick={(event) => recover(event.currentTarget)}>Anzeige erneut laden</button>
        : displayReady && state.selected.owner !== 'other' && <button disabled={blocked} onClick={() => void action('claim')}>Eingabe übernehmen</button>}
    </div>}
    <div className="m-terminal-focus-bar" id={controlsId} hidden={!controlsVisible}>{(projectEntry || terminalHome) && <label>Sitzung öffnen mit<select aria-label={terminalHome ? 'Terminal-CLI' : 'Projekt-CLI'} disabled={blocked} value={projectMode} onChange={(event) => setProjectMode(event.target.value as typeof projectMode)}>
      {(['codex', 'claude', 'grok', 'shell'] as const).map((mode) => <option key={mode} value={mode} disabled={!canLaunchChoice({ mode }, options)}>
        {SESSION_LAUNCH_LABELS[mode]}{!canLaunchChoice({ mode }, options) ? ' · nicht verfügbar' : ''}</option>)}
    </select></label>}
      <button ref={launchButton} className="m-primary" disabled={blocked || !!(projectEntry || terminalHome) && !canLaunchChoice({ mode: projectMode }, options)} onClick={() => void openProfile(projectEntry || terminalHome ? projectMode : 'agent')}>
        {projectEntry || terminalHome ? SESSION_LAUNCH_LABELS[projectMode] : agent?.name ?? 'Agent'} öffnen</button>
      {!focused && <button onClick={() => { setFocused(true); setComposeOpen(false); }}>Terminal vergrössern</button>}
      <label>Schriftgrösse<select aria-label="Terminal-Schriftgrösse" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))}>
        {[12, 14, 16, 18, 20].map((size) => <option key={size} value={size}>{size} px</option>)}
      </select></label>
      {terminalHome && <span>Benutzerverzeichnis · Ohne Agent und Projekt</span>}
      {projectWorkspaceId && <span>{expectedBranch} · {state.selected?.launchProfileName ?? 'Ohne Agent-Profil'}</span>}
      {state.selected?.profileContext && <SessionProfileContext key={state.selected.id} context={state.selected.profileContext}
        readText={async () => (await host.request<MobileTerminalState>('/api/v1/terminal/query', 'POST', { ...selection, terminalId: state.selected!.id, profileContext: true })).profileContextText ?? null}
        readRevision={async () => (await host.request<{ revision: string }>('/api/v1/profile/behavior/query', 'POST', { agentId: state.selected!.profileContext!.profileId })).revision} />}
      {focused && <><span role="status">{host.status !== 'online' ? 'Offline · letzter Anzeigestand' : owning ? 'Eingabe: Tablet' : 'Eingabe: PC / anderes Gerät'}</span>
        {state.selected && <>{owning && <button disabled={busy || commandPending || !!pending || host.status !== 'online'} onClick={() => void action('release')}>Eingabe freigeben</button>}
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
    {pending && <button disabled={busy || commandPending || host.status !== 'online'} onClick={() => void command(pending.command, true)}>Terminalaktion erneut prüfen</button>}
    {uncertain && <div className="m-notice"><p>Die letzte Eingabe ist nicht bestätigt. Sie wird nicht automatisch wiederholt.</p>
      <button disabled={busy || host.status !== 'online'} onClick={() => { void query().then((result) => {
        if (result.leaseId === uncertain.leaseId && !result.inputUncertain && (result.lastSequence ?? 0) >= uncertain.sequence) { setUncertain(null); saveDraft({ text: '', review: false }); setNotice('Eingabe wurde vom PC angenommen.'); }
        else setNotice('Eingabe bleibt unbestätigt. Anzeige prüfen und die Steuerung freigeben, bevor du fortfährst.');
      }).catch((reason) => setError(terminalError(reason))); }}>Eingabestatus prüfen</button></div>}
    {draft.review && !directSending.current && <p role="alert">Eine frühere Eingabe ist noch unbestätigt. Ausgabe prüfen, bevor du den Entwurf erneut verwendest.
      <button disabled={busy || !!uncertain || !!state.inputUncertain || host.status !== 'online'} onClick={() => saveDraft((value) => ({ ...value, review: false }))}>Ausgabe geprüft · Entwurf freigeben</button></p>}
    {state.selected && <>
      {state.inputUncertain && <p role="alert">Eine Eingabe konnte nicht sicher an den Prozess übergeben werden. Ausgabe prüfen und die Eingabe freigeben; sie wird nicht wiederholt.</p>}
      <div className="m-management-actions"><button disabled={busy || commandPending || !!pending || !owning || host.status !== 'online'} onClick={() => void action('release')}>Eingabe freigeben</button>
        <button className="m-danger" disabled={blocked || !owning} onClick={() => setConfirmClose(true)}>Sitzung beenden</button></div></>}
    </div>
    {state.selected && <>{state.frame ? <TerminalScreen key={state.selected.id} frame={state.frame} active={active}
      screen={state.screen ?? ''} enabled={inputEnabled} fontSize={fontSize} replyPort={host.status === 'online' && selected ? replyPort : undefined} replyButtonContainer={replySlot} replySheetContainer={replySheetSlot} toolContainer={toolSlot} onReplyOpenChange={setReplyOpen}
      onData={(data) => { typingUntil.current = performance.now() + 500; keyboard.enqueue(data); }} onSize={(cols, rows) => {
        if (dimensions.current.cols !== cols || dimensions.current.rows !== rows) { dimensions.current = { cols, rows }; resizePending.current = true; }
      }} /> : <pre tabIndex={0} className="m-terminal-screen" aria-label="Terminalanzeige">{state.screen || 'Warte auf Terminalausgabe…'}</pre>}
      {state.frame && <details className="m-terminal-transcript"><summary>Textausgabe und Verlauf</summary><pre tabIndex={0} aria-label="Terminal-Textverlauf">{state.screen}</pre></details>}
      <TerminalVoiceStrip key={`${selected}/${state.leaseId ?? 'no-lease'}`} host={host} fallbackId={fallbackFocusId} send={sendPrompt} sheetOpen={replyOpen} onSheetSlot={setReplySheetSlot}
        sendBlockedReason={readError || !displayReady ? 'Terminalanzeige nicht aktuell · Eingabe pausiert' : undefined}
        target={{ ...selection, terminalId: selected, leaseId: state.leaseId ?? '' }}
        label={`${state.selected.projectName ?? agent?.name ?? (terminalHome ? 'Freies Terminal' : 'Projekt')} · ${state.selected.title} · ${state.selected.branch ?? expectedBranch ?? ''}`}
        blocked={state.selected.status !== 'running' ? { reason: 'Sitzung beendet' }
          : !owning || !state.leaseId ? { reason: state.selected.owner === 'other' ? 'Eingabe bei einem anderen Gerät' : 'Eingabe beim PC',
            action: <button className="m-primary" disabled={blocked || state.selected.owner === 'other'} onClick={() => void action('claim')}>Eingabe übernehmen</button> } : undefined}
        trailing={<><div ref={setToolSlot} className="m-terminal-tool-slot" /><div ref={setReplySlot} className="voice-strip-reply" />
          <TerminalImageButton key={`${selected}/${state.leaseId ?? ''}`} host={host} target={{ ...selection, terminalId: selected, leaseId: state.leaseId ?? '' }}
            enabled={inputEnabled} capability={state.imageCapability} send={sendPrompt} eventRoot={screenRoot} />
          <button className="voice-icon-button" aria-label="Tastatur öffnen" aria-pressed={keysShown} disabled={!inputEnabled}
            onClick={() => { setKeysShown((value) => !value); openTerminalKeyboard(screenRoot.current?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea'), keyboardOpen); }}><KeyboardIcon /></button></>} />
      <div className="m-terminal-composer">
      <div className="m-terminal-keybar">
      <div className="m-management-actions m-terminal-keys" hidden={!(keyboardOpen || keysShown)}>
      {[['Enter', '\r'], ['Tab', '\t'], ['Esc', '\x1b'], ['Ctrl+C', '\x03'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C']].map(([label, data]) =>
        <button key={label} aria-label={`Terminaltaste ${label}`} disabled={blocked || !displayReady || !!readError || draft.review || !owning || state.selected?.status !== 'running'} onPointerDown={(event) => event.preventDefault()} onClick={() => keyboard.enqueue(data!)}>{label}</button>)}</div>
      <button className="m-terminal-end m-danger" disabled={blocked || !owning}
        onClick={(event) => { event.currentTarget.focus(); setConfirmClose(true); }}>
        {state.selected.launchMode === 'shell' ? 'Shell beenden' : 'Terminal beenden'}</button>
      </div>
      <details open={composeOpen} onToggle={(event) => setComposeOpen(event.currentTarget.open)}><summary>Text direkt ans Terminal senden</summary>
      <form onSubmit={(event) => { event.preventDefault(); void submitTerminalText(); }}>
        <label>Terminal-Eingabe<textarea ref={input} aria-label="Terminal-Eingabe" value={text} maxLength={2000} disabled={!owning || host.status !== 'online'}
          onFocus={(event) => { const node = event.currentTarget; requestAnimationFrame(() => node.scrollIntoView({ block: 'nearest' })); }}
          onChange={(event) => setText(event.target.value)} rows={3} spellCheck={false} autoCapitalize="off" autoCorrect="off" /></label>
        <button disabled={blocked || !displayReady || !!readError || draft.review || !owning || !text || state.selected.status !== 'running'}>Text und Enter senden</button></form>
      <p className="m-field-note">{durable ? 'Entwurf auf diesem Gerät gespeichert.' : 'Entwurf nur in dieser geöffneten Seite.'}</p></details></div>
    </>}
    <p className="m-field-note">{host.status === 'online' && responseMs !== undefined && <span aria-label="Terminal-Antwortzeit">PC-Antwort: {responseMs} ms (Netzwerk und Verarbeitung). </span>}Ins Terminal tippen für direkte Eingabe. Bekannte Zugangsdaten und PC-Pfade werden ausgeblendet. Nach 30 Sekunden ohne Verbindung geht die Eingabe an den Desktop zurück.</p>
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
    ? 'Terminalzugriff fehlt. In ADE am PC unter Einstellungen → Verbundene Geräte „Interaktive Terminals steuern“ für dieses Gerät freigeben.' : workspaceError(error);
}
