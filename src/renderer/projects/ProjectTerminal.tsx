import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useEffect, useRef, useState } from 'react';
import type { ProjectWorkspaceView, SessionLaunchChoice, SessionLaunchOptions } from '../../shared/remote';
import { SESSION_LAUNCH_LABELS } from '../../shared/sessionLaunch';
import { sessionStateLabel } from '../../shared/sessionState';
import { useSessions } from '../stores/sessions';
import { TerminalPane } from '../terminal/TerminalPane';
import { canLaunchChoice, SessionLaunchFields } from '../sessions/SessionLaunchFields';
import { reusableProjectSession } from './projectSessions';
import '../terminal/terminal.css';

export function ProjectTerminal({ workspace, initialSessionId }: { workspace: ProjectWorkspaceView; initialSessionId?: string }) {
  useLocale();
  const sessions = useSessions((state) => state.sessions);
  const available = Object.values(sessions).filter((session) => session.projectWorkspaceId === workspace.id && session.branch === workspace.branch && session.kind === 'interactive');
  const selected = useSessions((state) => state.activeByProject[workspace.id]);
  const setSelected = (id: string) => useSessions.getState().setActiveProject(workspace.id, id);
  const active = available.find((session) => session.id === selected) ?? available.at(-1);
  const [choice, setChoice] = useState<SessionLaunchChoice>(active?.launchChoice ?? { mode: 'codex' });
  const [profileId, setProfileId] = useState(active?.launchProfileId ?? '');
  const [options, setOptions] = useState<SessionLaunchOptions>(); const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const live = useRef(true); const lock = useRef(false);
  const root = useRef<HTMLElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (initialSessionId && !useSessions.getState().activeByProject[workspace.id]) useSessions.getState().setActiveProject(workspace.id, initialSessionId);
  }, [initialSessionId, workspace.id]);
  const initialAvailable = available.some(session => session.id === initialSessionId);
  useEffect(() => {
    if (!initialSessionId || !initialAvailable) return;
    const frame = requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [initialSessionId, initialAvailable]);
  useEffect(() => {
    let stopped = false; setLoading(true); setOptions(undefined); setError('');
    void window.ade.invoke('session:options', { projectWorkspaceId: workspace.id }).then((value) => { if (!stopped) setOptions(value); })
      .catch((reason) => { if (!stopped) setError(String(reason)); }).finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, [workspace.id, retry]);
  const focusTerminal = () => requestAnimationFrame(() => {
    const panel = root.current?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])');
    // Only explicit open/switch actions reveal the terminal. Live output never
    // moves the project scroll position, and the global header stays outside it.
    panel?.scrollIntoView({ block: 'nearest' });
    panel?.querySelector<HTMLElement>('.xterm-helper-textarea')?.focus();
  });
  const launchDisabled = (value: SessionLaunchChoice) => busy || loading || !canLaunchChoice(value, options)
    || value.mode === 'agent' && !options?.profiles?.some((profile) => profile.id === profileId);
  const open = async (fresh = false, value = choice) => {
    if (lock.current || launchDisabled(value)) return;
    setChoice(value);
    const existing = !fresh && reusableProjectSession(available, workspace.id, workspace.branch, value, profileId);
    if (existing) { setSelected(existing.id); focusTerminal(); return; }
    lock.current = true; setBusy(true); setError('');
    try { const session = await useSessions.getState().createProjectSession(workspace.id, workspace.branch, value, value.mode === 'agent' ? profileId : undefined); if (live.current) { setSelected(session.id); focusTerminal(); } }
    catch (reason) { if (live.current) setError(String(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const closeActive = async () => {
    if (!active || lock.current || !window.confirm(translate("End this terminal session? files remain."))) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await useSessions.getState().closeSession(active.id);
      if (live.current) requestAnimationFrame(() => {
        const next = root.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
        (next ?? launcher.current)?.focus();
      });
    } catch (reason) { if (live.current) setError(String(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const restartActive = async () => {
    if (!active || active.status !== 'exited' || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await useSessions.getState().restartSession(active.id); if (live.current) focusTerminal(); }
    catch (reason) { if (live.current) setError(String(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const disabled = launchDisabled(choice);
  return <section ref={root} className="project-terminal" aria-label={translate("Project terminal")} onKeyDownCapture={(event) => {
    if ((event.target as Element).closest('[role="dialog"], dialog')) return;
    if (event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey)) return;
    if (!event.shiftKey && [translate("PageUp"), translate("PageDown")].includes(event.key) && available.length > 1) {
      event.preventDefault(); event.stopPropagation();
      const index = available.findIndex((session) => session.id === active?.id);
      setSelected(available[(index + (event.key === 'PageUp' ? -1 : 1) + available.length) % available.length]!.id); focusTerminal();
    } else if (event.shiftKey && event.key.toLowerCase() === 't') {
      event.preventDefault(); event.stopPropagation(); if (!event.repeat) void open(true);
    } else if (event.shiftKey && event.key.toLowerCase() === 'w') {
      event.preventDefault(); event.stopPropagation(); if (!event.repeat) void closeActive();
    }
  }}>
    <div className="project-quick-start" role="group" aria-label={translate("Open CLI directly in the workspace")}>
      {([{ mode: 'codex', label: translate("Open Codex") }, { mode: 'claude', label: translate("Open the Claude Code") }, { mode: 'shell', label: translate("Open empty terminal") }] as const)
        .map(({ mode, label }) => <button key={mode} ref={mode === 'shell' ? launcher : undefined} disabled={launchDisabled({ mode })}
          title={options?.choices.find((item) => item.mode === mode)?.notice ?? `${workspace.name} · ${workspace.branch}`}
          onClick={() => void open(false, { mode })}>{label}</button>)}
    </div>
    <p className="project-launch-context">{translate("Directly to")}{" "}{workspace.name} · {workspace.branch}{translate("An agent profile is optional.")}</p>
    <div className="project-workspace-actions"><label>{translate("Working with:")}<select aria-label={translate("Project CLI")} value={choice.mode} disabled={busy}
      onChange={(event) => { const mode = event.target.value as SessionLaunchChoice['mode']; setChoice(mode === 'ollama' ? { mode, model: options?.models[0] ?? '' } : { mode }); }}>
      {Object.entries(SESSION_LAUNCH_LABELS).map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}
    </select></label>
      {choice.mode === 'ollama' && <label>{translate("Model")}<select aria-label={translate("Project-Ollama model")} value={choice.model} disabled={busy || loading}
        onChange={(event) => setChoice({ mode: 'ollama', model: event.target.value })}>
        {!options?.models.includes(choice.model) && <option value={choice.model}>{translate("Choose model")}</option>}
        {options?.models.map(model => <option key={model} value={model}>{model}</option>)}
      </select></label>}
      {choice.mode === 'agent' && <label>{translate("Starting profile")}<select aria-label={translate("Starting profile")} value={profileId} disabled={busy} onChange={(event) => setProfileId(event.target.value)}>
        <option value="">{translate("Select profile [50726f66]")}</option>{options?.profiles?.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.runtime}</option>)}
      </select></label>}
      <button disabled={disabled} onClick={() => void open()}>{busy ? translate("Starting session…") : translate("Open/Resume selection")}</button>
      <button disabled={disabled} onClick={() => void open(true)} title={translate("Ctrl+Shift+T")}>{translate("Start an additional session")}</button>
      <button disabled={busy || loading} onClick={() => setRetry((value) => value + 1)}>{translate("Refresh CLIs")}</button>
    </div>
    {loading && <p role="status">{translate("Checking installed CLIs…")}</p>}{error && <p role="alert">{localizeAppMessage(error)}</p>}
    {options?.choices.find((item) => item.mode === choice.mode)?.notice && <p role="status">{localizeAppMessage(options.choices.find((item) => item.mode === choice.mode)!.notice)}</p>}
    <details><summary>{translate("Other Start Options")}</summary><SessionLaunchFields choice={choice} onChange={setChoice} options={options} disabled={busy} loading={loading} /></details>
    {available.length ? <>
      <div className="project-session-bar"><div role="tablist" aria-label={translate("Project terminal sessions")} className="project-session-tabs">
        {available.map((session, index) => <button key={session.id} id={`project-session-tab-${session.id}`} role="tab"
          aria-selected={active?.id === session.id} aria-controls={`project-session-panel-${session.id}`} tabIndex={active?.id === session.id ? 0 : -1}
          title={sessionStateLabel({ ...session, launchMode: session.launchChoice?.mode })} onClick={() => { setSelected(session.id); focusTerminal(); }}
          onKeyDown={(event) => {
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1
              : event.key === 'ArrowLeft' ? (index - 1 + available.length) % available.length : event.key === 'ArrowRight' ? (index + 1) % available.length : -1;
            if (next < 0) return;
            event.preventDefault(); setSelected(available[next]!.id);
            requestAnimationFrame(() => document.getElementById(`project-session-tab-${available[next]!.id}`)?.focus());
          }}><span aria-hidden="true">{session.status === 'exited' || session.program?.status === 'exited' ? '○' : '●'}</span> {session.title} {index + 1}
          {session.launchProfileName && <span className="project-session-profile">{session.launchProfileName}</span>}</button>)}
      </div>
      {active?.status === 'exited' && <button disabled={busy} onClick={() => void restartActive()}>{translate("Restart session")}</button>}
      <button disabled={busy || !active} onClick={() => void closeActive()} title={translate("Ctrl+Shift+W")}>{translate("End session")}</button></div>
      {active && <p role="status" aria-label={translate("CLI and terminal status")}>{sessionStateLabel({ ...active, launchMode: active.launchChoice?.mode })}{" "}{translate("· Branch")}{" "}{active.branch} · {active.launchProfileName ?? translate("Without an agent profile")}</p>}
      <div className="project-terminal-screen">{available.map((session) => <div key={session.id} id={`project-session-panel-${session.id}`}
        role="tabpanel" aria-labelledby={`project-session-tab-${session.id}`} hidden={active?.id !== session.id} style={{ height: '100%' }}>
        <TerminalPane sessionId={session.id} active={active?.id === session.id} /></div>)}</div>
    </> : <p>{translate("Select and open CLI. The session starts in the displayed workspace and branch.")}</p>}
  </section>;
}
