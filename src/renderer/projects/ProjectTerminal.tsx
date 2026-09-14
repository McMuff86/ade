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
  useEffect(() => {
    let stopped = false; setLoading(true); setOptions(undefined); setError('');
    void window.ade.invoke('session:options', { projectWorkspaceId: workspace.id }).then((value) => { if (!stopped) setOptions(value); })
      .catch((reason) => { if (!stopped) setError(String(reason)); }).finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, [workspace.id, retry]);
  const focusTerminal = () => requestAnimationFrame(() => {
    root.current?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden]) .xterm-helper-textarea')?.focus();
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
    if (!active || lock.current || !window.confirm('Diese Terminalsitzung beenden? Dateien bleiben erhalten.')) return;
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
  return <section ref={root} className="project-terminal" aria-label="Projekt-Terminal" onKeyDownCapture={(event) => {
    if (event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey)) return;
    if (!event.shiftKey && ['PageUp', 'PageDown'].includes(event.key) && available.length > 1) {
      event.preventDefault(); event.stopPropagation();
      const index = available.findIndex((session) => session.id === active?.id);
      setSelected(available[(index + (event.key === 'PageUp' ? -1 : 1) + available.length) % available.length]!.id); focusTerminal();
    } else if (event.shiftKey && event.key.toLowerCase() === 't') {
      event.preventDefault(); event.stopPropagation(); if (!event.repeat) void open(true);
    } else if (event.shiftKey && event.key.toLowerCase() === 'w') {
      event.preventDefault(); event.stopPropagation(); if (!event.repeat) void closeActive();
    }
  }}>
    <div className="project-quick-start" role="group" aria-label="CLI direkt im Workspace öffnen">
      {([{ mode: 'codex', label: 'Codex öffnen' }, { mode: 'claude', label: 'Claude Code öffnen' }, { mode: 'shell', label: 'Leeres Terminal öffnen' }] as const)
        .map(({ mode, label }) => <button key={mode} ref={mode === 'shell' ? launcher : undefined} disabled={launchDisabled({ mode })}
          title={options?.choices.find((item) => item.mode === mode)?.notice ?? `${workspace.name} · ${workspace.branch}`}
          onClick={() => void open(false, { mode })}>{label}</button>)}
    </div>
    <p className="project-launch-context">Direkt in {workspace.name} · {workspace.branch}. Ein Agent-Profil ist optional.</p>
    <div className="project-workspace-actions"><label>Arbeiten mit<select aria-label="Projekt-CLI" value={choice.mode} disabled={busy}
      onChange={(event) => { const mode = event.target.value as SessionLaunchChoice['mode']; setChoice(mode === 'ollama' ? { mode, model: options?.models[0] ?? '' } : { mode }); }}>
      {Object.entries(SESSION_LAUNCH_LABELS).map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}
    </select></label>
      {choice.mode === 'ollama' && <label>Modell<select aria-label="Projekt-Ollama-Modell" value={choice.model} disabled={busy || loading}
        onChange={(event) => setChoice({ mode: 'ollama', model: event.target.value })}>
        {!options?.models.includes(choice.model) && <option value={choice.model}>Modell wählen</option>}
        {options?.models.map(model => <option key={model} value={model}>{model}</option>)}
      </select></label>}
      {choice.mode === 'agent' && <label>Startprofil<select aria-label="Startprofil" value={profileId} disabled={busy} onChange={(event) => setProfileId(event.target.value)}>
        <option value="">Profil wählen</option>{options?.profiles?.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.runtime}</option>)}
      </select></label>}
      <button disabled={disabled} onClick={() => void open()}>{busy ? 'Sitzung wird gestartet…' : 'Auswahl öffnen / fortsetzen'}</button>
      <button disabled={disabled} onClick={() => void open(true)} title="Ctrl+Shift+T">Zusätzliche Sitzung starten</button>
      <button disabled={busy || loading} onClick={() => setRetry((value) => value + 1)}>CLIs aktualisieren</button>
    </div>
    {loading && <p role="status">Installierte CLIs werden geprüft…</p>}{error && <p role="alert">{error}</p>}
    {options?.choices.find((item) => item.mode === choice.mode)?.notice && <p role="status">{options.choices.find((item) => item.mode === choice.mode)!.notice}</p>}
    <details><summary>Weitere Startoptionen</summary><SessionLaunchFields choice={choice} onChange={setChoice} options={options} disabled={busy} loading={loading} /></details>
    {available.length ? <>
      <div className="project-session-bar"><div role="tablist" aria-label="Projekt-Terminalsitzungen" className="project-session-tabs">
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
      {active?.status === 'exited' && <button disabled={busy} onClick={() => void restartActive()}>Sitzung neu starten</button>}
      <button disabled={busy || !active} onClick={() => void closeActive()} title="Ctrl+Shift+W">Sitzung beenden</button></div>
      {active && <p role="status" aria-label="CLI- und Terminalstatus">{sessionStateLabel({ ...active, launchMode: active.launchChoice?.mode })} · Branch {active.branch} · {active.launchProfileName ?? 'Ohne Agent-Profil'}</p>}
      <div className="project-terminal-screen">{available.map((session) => <div key={session.id} id={`project-session-panel-${session.id}`}
        role="tabpanel" aria-labelledby={`project-session-tab-${session.id}`} hidden={active?.id !== session.id} style={{ height: '100%' }}>
        <TerminalPane sessionId={session.id} active={active?.id === session.id} /></div>)}</div>
    </> : <p>CLI wählen und öffnen. Die Sitzung startet im angezeigten Workspace und Branch.</p>}
  </section>;
}
