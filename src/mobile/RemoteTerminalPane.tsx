import { localizeAppMessage } from '../shared/i18n/appMessages';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
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
  useLocale();
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
          throw new Error(translate("Could not identify the terminal display. Reopen the session."));
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
          setSelected(''); setLaunchOpen(true); setNotice(translate("The previous session is no longer available. ADE may have been restarted."));
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
        if (live.current) setError(translate("Terminal action was not sent. check connection and session and try again."));
        return;
      }
      const request = retry && pending ? pending : { command: operation, key: crypto.randomUUID() };
      if (!setPending(request)) { setError(translate("Browser storage is not available. Terminal action was not sent.")); return; }
      lock.current = true; acquired = true; setBusy(true); queryVersion.current++;
      if (operation.operation === 'claim' || operation.operation === 'open') focusTerminal.current = document.activeElement;
      const result = await host.request<{ terminalId: string }>('/api/v1/terminal/command', 'POST', request.command, request.key);
      if (!live.current) return;
      setPending(null); setUncertain(null); setSelected(request.command.operation === 'close' ? '' : result.terminalId);
      await query(request.command.operation === 'close' ? '' : result.terminalId);
      if (request.command.operation === 'open') { setLaunchOpen(false); setComposeOpen(false); }
      if (request.command.operation === 'close') focusAfterClose.current = true;
      setNotice(request.command.operation === 'release' ? translate("Input released.") : request.command.operation === 'close' ? translate("The session is closed.") : translate("The terminal is connected."));
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
    if (new TextEncoder().encode(data).length > 2048) { setError(translate("Shorten the input to a maximum of 2048 bytes.")); return 'failed'; }
    const request: MobileTerminalInput = { ...selection, terminalId: current.selected.id, leaseId: current.leaseId,
      sequence: (current.lastSequence ?? 0) + 1, data, ...dimensions.current };
    lock.current = true; setBusy(true); setError('');
    try {
      if (data && !saveDraft((value) => ({ ...value, review: true }))) throw new Error(translate("Browser storage not available. Entry was not sent."));
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
      if (lock.current || context !== commandContextRef.current || !context.active || !context.online) throw new Error(translate("Terminal action was not sent. check connection and session and try again."));
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
  }, () => setError(translate("Too much keyboard input at once. Unsent characters were discarded; check output."))));
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
      if (live.current) setError(current => current || translate("Terminal input was not confirmed. Keep draft and check terminal."));
    } finally { explicitLock.current = false; if (live.current) setExplicitPending(false); }
  };
  const sendPrompt = async (text: string, mode: 'insert' | 'submit', key: string, imageIds?: string[]) => {
    const targetId = selected; const leaseId = stateRef.current.leaseId;
    const deadline = performance.now() + 5000;
    while ((!keyboard.idle || lock.current) && performance.now() < deadline) await new Promise(done => setTimeout(done, 8));
    const current = stateRef.current;
    if (!live.current || !keyboard.idle || lock.current || commandLock.current || profileLock.current || pending || uncertain || draft.review || current.inputUncertain
      || current.selected?.id !== targetId || !leaseId || current.leaseId !== leaseId || current.selected.owner !== 'self' || !inputConnection.current.online || !inputConnection.current.ready || inputConnection.current.readError) {
      throw new Error(translate("Terminal is still busy or the input has been taken over. keep draft and check terminal."));
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
  const ownerText = host.status !== 'online' ? translate("Offline") : !state.selected ? translate("No session") : state.selected.status === 'exited' ? translate("Session ended")
    : owning ? translate("Input: You (tablet)") : state.selected.owner === 'other' ? translate("Input: another device") : translate("Input: desktop");
  const compactOwnership = compactControls && state.selected?.status === 'running' && !owning;
  const recover = (button: HTMLButtonElement) => {
    button.focus(); focusTerminal.current = button;
    if (host.status !== 'online') host.reconnect(); else refreshNow.current();
  };
  const statusBar = <div className="m-terminal-status-bar" aria-label={translate("Terminal status")}>
    <span role="status" className="m-terminal-owner" data-state={host.status !== 'online' ? 'offline' : owning && state.selected?.status === 'running' ? 'own' : 'other'}>{ownerText}</span>
    {state.selected && <span role="status" aria-label={translate("CLI and terminal status")}>{sessionStateLabel(state.selected)}</span>}
    {state.selected && <SubscriptionUsagePanel compact key={`usage-${state.selected.id}`} online={host.status === 'online'} load={async () => {
      const result = await host.request<MobileTerminalState>('/api/v1/terminal/query', 'POST', { ...selection, terminalId: state.selected!.id, usage: true });
      if (!result.subscriptionUsage) throw new Error(translate("Usage data is missing.")); return result.subscriptionUsage;
    }} />}
    <SessionSwitchButton />
    <SupervisionButton repositoryId={state?.selected?.projectRepositoryId ?? repositoryId ?? undefined} />
    {state.selected && <button aria-expanded={controlsVisible} aria-controls={controlsId} onClick={() => setControlsExpanded(!controlsExpanded)}>{translate("Session & Workspace")}</button>}
    {focused && <button onClick={() => setFocused(false)}>{translate("Show workspace")}</button>}
  </div>;
  return <section ref={screenRoot} className={`m-remote-terminal ${focused ? 'm-terminal-focused' : ''} ${!controlsVisible ? 'm-controls-collapsed' : ''} ${compactControls && state.selected ? 'm-keyboard-compact' : ''}`} aria-label={translate("Interactive terminal")}>
    {active && (headerSlot ? createPortal(statusBar, headerSlot) : statusBar)}
    {state.selected && (host.status !== 'online' || !displayReady || readError || compactOwnership) && <div className="m-terminal-recovery" aria-label={translate("Terminal connection")}>
      <p role="status">{host.status !== 'online' ? translate("PC not connected. The last display remains visible; input pauses.")
        : readError ? translate("Terminal display not current. Input pauses until the display is loaded again.")
        : !displayReady ? translate("Loading terminal display. Input paused.")
        : state.selected.owner === 'other' ? translate("Another device controls this session.") : translate("The PC controls input. Take control to continue typing.")}</p>
      {host.status !== 'online' ? <button onClick={(event) => recover(event.currentTarget)}>{translate("Reconnect")}</button>
        : readError ? <button onClick={(event) => recover(event.currentTarget)}>{translate("Reload display")}</button>
        : displayReady && state.selected.owner !== 'other' && <button disabled={blocked} onClick={() => void action('claim')}>{translate("Take control of input")}</button>}
    </div>}
    <div className="m-terminal-focus-bar" id={controlsId} hidden={!controlsVisible}>{(projectEntry || terminalHome) && <label>{translate("Open session with")}<select aria-label={terminalHome ? translate("Terminal CLI") : translate("Project CLI")} disabled={blocked} value={projectMode} onChange={(event) => setProjectMode(event.target.value as typeof projectMode)}>
      {(['codex', 'claude', 'grok', 'shell'] as const).map((mode) => <option key={mode} value={mode} disabled={!canLaunchChoice({ mode }, options)}>
        {SESSION_LAUNCH_LABELS[mode]}{!canLaunchChoice({ mode }, options) ? translate(" · Not available") : ''}</option>)}
    </select></label>}
      <button ref={launchButton} className="m-primary" disabled={blocked || !!(projectEntry || terminalHome) && !canLaunchChoice({ mode: projectMode }, options)} onClick={() => void openProfile(projectEntry || terminalHome ? projectMode : 'agent')}>
        {projectEntry || terminalHome ? SESSION_LAUNCH_LABELS[projectMode] : agent?.name ?? 'Agent'} {" "}{translate("Open [c3b66666]")}</button>
      {!focused && <button onClick={() => { setFocused(true); setComposeOpen(false); }}>{translate("Expand terminal")}</button>}
      <label>{translate("Font size")}<select aria-label={translate("Terminal font size")} value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))}>
        {[12, 14, 16, 18, 20].map((size) => <option key={size} value={size}>{size} {" "}{translate("px")}</option>)}
      </select></label>
      {terminalHome && <span>{translate("User directory · Without agent and project")}</span>}
      {projectWorkspaceId && <span>{expectedBranch} · {state.selected?.launchProfileName ?? translate("Without an agent profile")}</span>}
      {state.selected?.profileContext && <SessionProfileContext key={state.selected.id} context={state.selected.profileContext}
        readText={async () => (await host.request<MobileTerminalState>('/api/v1/terminal/query', 'POST', { ...selection, terminalId: state.selected!.id, profileContext: true })).profileContextText ?? null}
        readRevision={async () => (await host.request<{ revision: string }>('/api/v1/profile/behavior/query', 'POST', { agentId: state.selected!.profileContext!.profileId })).revision} />}
      {focused && <><span role="status">{host.status !== 'online' ? translate("Offline · Last display status") : owning ? translate("Input: tablet") : translate("Input: PC / other device")}</span>
        {state.selected && <>{owning && <button disabled={busy || commandPending || !!pending || host.status !== 'online'} onClick={() => void action('release')}>{translate("Release input")}</button>}
          <button disabled={blocked || !owning} onClick={() => setConfirmClose(true)}>{translate("End session")}</button></>}
        {agent && <DashboardLink agent={agent} />}</>}
    </div>
    <div className="m-terminal-tools">
    {profileOpening && <p role="status">{projectEntry || terminalHome ? SESSION_LAUNCH_LABELS[projectMode] : agent?.name ?? 'Agent'} {" "}{translate("opening…")}</p>}
    {(projectEntry || terminalHome) && loadingOptions && <p role="status">{translate("Checking installed CLIs…")}</p>}
    {(projectEntry || terminalHome) && !loadingOptions && options?.choices.find((item) => item.mode === projectMode)?.notice && <p role="status">{localizeAppMessage(options.choices.find((item) => item.mode === projectMode)?.notice)}</p>}
    <p>{state.selected ? state.selected.status === 'running'
      ? translate("The terminal remains open on the PC. The CLI status refers to the call started by ADE.")
      : translate("This terminal is finished. You can watch the output or start a new session.")
      : translate("Select an existing session or start a new one in the selected workspace.")}</p>
    <details open={launchOpen} onToggle={(event) => setLaunchOpen(event.currentTarget.open)}><summary>{translate("Start new session")}</summary>
    <div className="m-management-actions"><button disabled={blocked} onClick={() => void command(launch({ mode: 'shell' }))}>{translate("Open the shell")}</button>
      </div>
    <SessionLaunchFields choice={choice} onChange={setChoice} options={options} disabled={blocked} loading={loadingOptions} />
    {projectWorkspaceId && choice.mode === 'agent' && <label>{translate("Starting profile")}<select aria-label={translate("Starting profile")} disabled={blocked} value={profileId} onChange={(event) => setProfileId(event.target.value)}>
      <option value="">{translate("Select profile")}</option>{options?.profiles?.map((profile) => <option value={profile.id} key={profile.id}>{profile.name} · {profile.runtime}</option>)}</select></label>}
    <div className="m-management-actions"><button disabled={blocked || !canLaunchChoice(choice, options) || !!projectWorkspaceId && choice.mode === 'agent' && !profileId}
      onClick={() => void command(launch(choice))}>{translate("Start session")}</button>
      <button disabled={blocked || loadingOptions} onClick={() => setOptionsRefresh((n) => n + 1)}>{translate("Refresh launch options")}</button></div>
    </details>
    <label>{translate("Session")}<select aria-label={translate("Terminal session")} disabled={blocked} value={selected} onChange={(event) => { setSelected(event.target.value); setError(''); setState({ terminals: state.terminals }); }}>
      <option value="">{translate("Choose session")}</option>{state.terminals.map((terminal) => <option key={terminal.id} value={terminal.id}>{sessionStateLabel(terminal)}</option>)}</select></label>
    {!state.terminals.length && !error && <p>{translate("No interactive sessions available. Managed tasks appear under Jobs.")}</p>}
    {(error || readError) && <p role="alert" className="m-alert">{error || readError}</p>}{notice && notice !== translate("The terminal is connected.") && <p role="status" className="m-terminal-notice">{localizeAppMessage(notice)}</p>}
    {pending && <button disabled={busy || commandPending || host.status !== 'online'} onClick={() => void command(pending.command, true)}>{translate("Check terminal operation again")}</button>}
    {uncertain && <div className="m-notice"><p>{translate("The last input is not confirmed; it is not automatically repeated.")}</p>
      <button disabled={busy || host.status !== 'online'} onClick={() => { void query().then((result) => {
        if (result.leaseId === uncertain.leaseId && !result.inputUncertain && (result.lastSequence ?? 0) >= uncertain.sequence) { setUncertain(null); saveDraft({ text: '', review: false }); setNotice(translate("The PC accepted the input.")); }
        else setNotice(translate("Entry remains unconfirmed. Check display and release control before proceeding."));
      }).catch((reason) => setError(terminalError(reason))); }}>{translate("Check input status")}</button></div>}
    {draft.review && !directSending.current && <p role="alert">{translate("An earlier input is still unconfirmed. Check output before using the draft again.")}<button disabled={busy || !!uncertain || !!state.inputUncertain || host.status !== 'online'} onClick={() => saveDraft((value) => ({ ...value, review: false }))}>{translate("Output reviewed · Unlock draft")}</button></p>}
    {state.selected && <>
      {state.inputUncertain && <p role="alert">{translate("An input could not be safely passed to the process. check output and release the input; it is not repeated.")}</p>}
      <div className="m-management-actions"><button disabled={busy || commandPending || !!pending || !owning || host.status !== 'online'} onClick={() => void action('release')}>{translate("Release input")}</button>
        <button className="m-danger" disabled={blocked || !owning} onClick={() => setConfirmClose(true)}>{translate("End session")}</button></div></>}
    </div>
    {state.selected && <>{state.frame ? <TerminalScreen key={state.selected.id} frame={state.frame} active={active}
      screen={state.screen ?? ''} enabled={inputEnabled} fontSize={fontSize} replyPort={host.status === 'online' && selected ? replyPort : undefined} replyButtonContainer={replySlot} replySheetContainer={replySheetSlot} toolContainer={toolSlot} onReplyOpenChange={setReplyOpen}
      onData={(data) => { typingUntil.current = performance.now() + 500; keyboard.enqueue(data); }} onSize={(cols, rows) => {
        if (dimensions.current.cols !== cols || dimensions.current.rows !== rows) { dimensions.current = { cols, rows }; resizePending.current = true; }
      }} /> : <pre tabIndex={0} className="m-terminal-screen" aria-label={translate("Terminal display")}>{state.screen || translate("Waiting for terminal output…")}</pre>}
      {state.frame && <details className="m-terminal-transcript"><summary>{translate("Text output and history")}</summary><pre tabIndex={0} aria-label={translate("Terminal text history")}>{state.screen}</pre></details>}
      <TerminalVoiceStrip key={`${selected}/${state.leaseId ?? 'no-lease'}`} host={host} fallbackId={fallbackFocusId} send={sendPrompt} sheetOpen={replyOpen} onSheetSlot={setReplySheetSlot}
        sendBlockedReason={readError || !displayReady ? translate("Terminal display is stale · Input paused") : undefined}
        target={{ ...selection, terminalId: selected, leaseId: state.leaseId ?? '' }}
        label={`${state.selected.projectName ?? agent?.name ?? (terminalHome ? translate("Standalone terminal") : translate("Project"))} · ${state.selected.title} · ${state.selected.branch ?? expectedBranch ?? ''}`}
        blocked={state.selected.status !== 'running' ? { reason: translate("Session ended") }
          : !owning || !state.leaseId ? { reason: state.selected.owner === 'other' ? translate("Another device controls input") : translate("PC controls input"),
            action: <button className="m-primary" disabled={blocked || state.selected.owner === 'other'} onClick={() => void action('claim')}>{translate("Take control of input")}</button> } : undefined}
        trailing={<><div ref={setToolSlot} className="m-terminal-tool-slot" /><div ref={setReplySlot} className="voice-strip-reply" />
          <TerminalImageButton key={`${selected}/${state.leaseId ?? ''}`} host={host} target={{ ...selection, terminalId: selected, leaseId: state.leaseId ?? '' }}
            enabled={inputEnabled} capability={state.imageCapability} send={sendPrompt} eventRoot={screenRoot} />
          <button className="voice-icon-button" aria-label={translate("Open the keyboard")} aria-pressed={keysShown} disabled={!inputEnabled}
            onClick={() => { setKeysShown((value) => !value); openTerminalKeyboard(screenRoot.current?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea'), keyboardOpen); }}><KeyboardIcon /></button></>} />
      <div className="m-terminal-composer">
      <div className="m-terminal-keybar">
      <div className="m-management-actions m-terminal-keys" hidden={!(keyboardOpen || keysShown)}>
      {[[translate("Enter"), '\r'], [translate("Tab"), '\t'], [translate("Esc"), '\x1b'], [translate("Ctrl+C"), '\x03'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C']].map(([label, data]) =>
        <button key={label} aria-label={translate("Terminal key {{value1}}", { value1: label })} disabled={blocked || !displayReady || !!readError || draft.review || !owning || state.selected?.status !== 'running'} onPointerDown={(event) => event.preventDefault()} onClick={() => keyboard.enqueue(data!)}>{label}</button>)}</div>
      <button className="m-terminal-end m-danger" disabled={blocked || !owning}
        onClick={(event) => { event.currentTarget.focus(); setConfirmClose(true); }}>
        {state.selected.launchMode === 'shell' ? translate("End shell") : translate("End terminal")}</button>
      </div>
      <details open={composeOpen} onToggle={(event) => setComposeOpen(event.currentTarget.open)}><summary>{translate("Send text directly to the terminal")}</summary>
      <form onSubmit={(event) => { event.preventDefault(); void submitTerminalText(); }}>
        <label>{translate("Terminal input")}<textarea ref={input} aria-label={translate("Terminal input")} value={text} maxLength={2000} disabled={!owning || host.status !== 'online'}
          onFocus={(event) => { const node = event.currentTarget; requestAnimationFrame(() => node.scrollIntoView({ block: 'nearest' })); }}
          onChange={(event) => setText(event.target.value)} rows={3} spellCheck={false} autoCapitalize="off" autoCorrect="off" /></label>
        <button disabled={blocked || !displayReady || !!readError || draft.review || !owning || !text || state.selected.status !== 'running'}>{translate("Send text and enter")}</button></form>
      <p className="m-field-note">{durable ? translate("Draft saved on this device.") : translate("Draft is only available in this open page.")}</p></details></div>
    </>}
    <p className="m-field-note">{host.status === 'online' && responseMs !== undefined && <span aria-label={translate("Terminal response time")}>{translate("PC response:")}{" "}{responseMs} {" "}{translate("ms (network and processing).")}{" "}</span>}{translate("Type into the terminal for direct input. Known access data and PC paths are hidden. After 30 seconds without connection, the input goes back to the desktop.")}</p>
    {confirmClose && <Dialog title={translate("End terminal session")} onClose={() => setConfirmClose(false)} fallbackId={fallbackFocusId}>
      <p>{translate("The running process in this session will be terminated.")}</p><button onClick={() => setConfirmClose(false)}>{translate("Cancel")}</button>
      {busy && <p role="status">{translate("Completing the pending terminal operation…")}</p>}
      <button className="m-danger" disabled={blocked || !owning} onClick={() => {
        // A heartbeat can acquire the lock before React updates the button.
        // Keep the confirmation open instead of silently dropping its command.
        if (lock.current || profileLock.current || blocked || !owning) return;
        setConfirmClose(false); void action('close');
      }}>{translate("Confirm termination")}</button></Dialog>}
  </section>;
}
function terminalError(error: unknown): string {
  return error instanceof MobileClientError && error.code === 'scope_not_granted'
    ? translate("Terminal permission is missing. In ADE on the PC, open Settings → Connected devices and enable “Control interactive terminals” for this device.") : workspaceError(error);
}
