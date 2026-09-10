import { useEffect, useRef, useState } from 'react';
import type { ProjectWorkspaceView, SessionLaunchChoice, SessionLaunchOptions } from '../../shared/remote';
import { SESSION_LAUNCH_LABELS } from '../../shared/sessionLaunch';
import { canReuseLaunch, sessionStateLabel } from '../../shared/sessionState';
import { useSessions } from '../stores/sessions';
import { TerminalPane } from '../terminal/TerminalPane';
import { canLaunchChoice, SessionLaunchFields } from '../sessions/SessionLaunchFields';
import '../terminal/terminal.css';

export function ProjectTerminal({ workspace, initialSessionId }: { workspace: ProjectWorkspaceView; initialSessionId?: string }) {
  const sessions = useSessions((state) => state.sessions);
  const available = Object.values(sessions).filter((session) => session.projectWorkspaceId === workspace.id && session.branch === workspace.branch && session.kind === 'interactive');
  const [selected, setSelected] = useState(initialSessionId ?? ''); const active = available.find((session) => session.id === selected) ?? available.at(-1);
  const [choice, setChoice] = useState<SessionLaunchChoice>({ mode: 'codex' }); const [profileId, setProfileId] = useState('');
  const [options, setOptions] = useState<SessionLaunchOptions>(); const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const live = useRef(true); const lock = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    let stopped = false; setLoading(true); setOptions(undefined); setError('');
    void window.ade.invoke('session:options', { projectWorkspaceId: workspace.id }).then((value) => { if (!stopped) setOptions(value); })
      .catch((reason) => { if (!stopped) setError(String(reason)); }).finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, [workspace.id, retry]);
  const open = async (fresh = false) => {
    if (lock.current) return;
    const existing = !fresh && available.filter((session) => canReuseLaunch({ ...session, launchMode: session.launchChoice?.mode }, choice.mode)
      && session.launchProfileId === (choice.mode === 'agent' ? profileId : undefined)).at(-1);
    if (existing) { setSelected(existing.id); return; }
    lock.current = true; setBusy(true); setError('');
    try { const session = await useSessions.getState().createProjectSession(workspace.id, workspace.branch, choice, choice.mode === 'agent' ? profileId : undefined); if (live.current) setSelected(session.id); }
    catch (reason) { if (live.current) setError(String(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const disabled = busy || loading || !canLaunchChoice(choice, options) || choice.mode === 'agent' && !profileId;
  return <section className="project-terminal" aria-label="Projekt-Terminal">
    <div className="project-workspace-actions"><label>Arbeiten mit<select aria-label="Projekt-CLI" value={choice.mode} disabled={busy}
      onChange={(event) => { const mode = event.target.value as SessionLaunchChoice['mode']; setChoice(mode === 'ollama' ? { mode, model: options?.models[0] ?? '' } : { mode }); }}>
      {(['codex', 'claude', 'grok', 'shell', 'agent'] as const).map((mode) => <option key={mode} value={mode}>{SESSION_LAUNCH_LABELS[mode]}</option>)}
      {(choice.mode === 'hermes' || choice.mode === 'ollama') && <option value={choice.mode}>{SESSION_LAUNCH_LABELS[choice.mode]}</option>}
    </select></label>
      {choice.mode === 'agent' && <label>Startprofil<select aria-label="Startprofil" value={profileId} disabled={busy} onChange={(event) => setProfileId(event.target.value)}>
        <option value="">Profil wählen</option>{options?.profiles?.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.runtime}</option>)}
      </select></label>}
      <button disabled={disabled} onClick={() => void open()}>{busy ? 'Sitzung wird gestartet…' : `${SESSION_LAUNCH_LABELS[choice.mode]} öffnen`}</button>
      <button disabled={busy || loading} onClick={() => setRetry((value) => value + 1)}>CLIs aktualisieren</button>
    </div>
    {loading && <p role="status">Installierte CLIs werden geprüft…</p>}{error && <p role="alert">{error}</p>}
    {options?.choices.find((item) => item.mode === choice.mode)?.notice && <p role="status">{options.choices.find((item) => item.mode === choice.mode)!.notice}</p>}
    <details><summary>Weitere Startoptionen</summary><SessionLaunchFields choice={choice} onChange={setChoice} options={options} disabled={busy} loading={loading} />
      <button disabled={disabled} onClick={() => void open(true)}>Zusätzliche Sitzung starten</button></details>
    {available.length ? <>
      <div className="project-workspace-actions"><label>Sitzung<select aria-label="Projekt-Terminalsitzung" value={active?.id ?? ''} onChange={(event) => setSelected(event.target.value)}>
        {available.map((session) => <option key={session.id} value={session.id}>{sessionStateLabel({ ...session, launchMode: session.launchChoice?.mode })} · {session.launchProfileName ?? 'Ohne Agent-Profil'}</option>)}
      </select></label>
      <button disabled={busy || !active} onClick={() => {
        if (!active || !window.confirm('Diese Terminalsitzung beenden? Dateien bleiben erhalten.')) return;
        void useSessions.getState().closeSession(active.id).catch((reason) => setError(String(reason)));
      }}>Sitzung beenden</button></div>
      {active && <p role="status" aria-label="CLI- und Terminalstatus">{sessionStateLabel({ ...active, launchMode: active.launchChoice?.mode })} · Branch {active.branch} · {active.launchProfileName ?? 'Ohne Agent-Profil'}</p>}
      <div className="project-terminal-screen">{available.map((session) => <div key={session.id} style={{ height: '100%', display: active?.id === session.id ? 'block' : 'none' }}>
        <TerminalPane sessionId={session.id} active={active?.id === session.id} /></div>)}</div>
    </> : <p>CLI wählen und öffnen. Die Sitzung startet im angezeigten Workspace und Branch.</p>}
  </section>;
}
