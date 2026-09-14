import { useEffect, useRef, useState } from 'react';
import type { ProjectDirectoryView, ProjectWorkspaceView, SessionLaunchChoice, SessionLaunchOptions } from '../../shared/remote';
import { Modal } from '../onboarding/Modal';
import { useAppData } from '../stores/appdata';
import { useSessions } from '../stores/sessions';
import { useSessionLaunch } from '../stores/sessionLaunch';
import { canLaunchChoice, SessionLaunchFields } from './SessionLaunchFields';
import { useSelection } from '../stores/selection';
import { useMode } from '../stores/mode';

export function SessionLaunchDialog() {
  const agentId = useSessionLaunch((s) => s.agentId);
  const terminalHome = useSessionLaunch((s) => s.terminalHome);
  return agentId || terminalHome ? <LaunchDialog key={agentId ?? 'home'} agentId={agentId} /> : null;
}
function LaunchDialog({ agentId }: { agentId: string | null }) {
  const agent = useAppData((s) => agentId ? s.agents[agentId] : undefined); const repos = useAppData((s) => s.repositories);
  const [repositoryId, setRepositoryId] = useState(agent?.defaultRepositoryId ?? '');
  const [directory, setDirectory] = useState<ProjectDirectoryView>();
  const [directoryError, setDirectoryError] = useState('');
  const [directoryLoading, setDirectoryLoading] = useState(!agentId);
  const [entryId, setEntryId] = useState('');
  const [workspace, setWorkspace] = useState<ProjectWorkspaceView>();
  const [profileId, setProfileId] = useState('');
  const [choice, setChoice] = useState<SessionLaunchChoice>({ mode: 'shell' });
  const [options, setOptions] = useState<SessionLaunchOptions>();
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(''); const lock = useRef(false);
  const close = useSessionLaunch((s) => s.close);
  useEffect(() => {
    if (agentId) return;
    let live = true; setDirectoryLoading(true); setDirectoryError('');
    void window.ade.invoke('project:query', { operation: 'directory' })
      .then((result) => { if (live) setDirectory(result.directory); })
      .catch(() => { if (live) setDirectoryError('Projektliste konnte nicht geladen werden. Startmöglichkeiten aktualisieren.'); })
      .finally(() => { if (live) setDirectoryLoading(false); });
    return () => { live = false; };
  }, [agentId, refresh]);
  useEffect(() => {
    let live = true; setLoading(true); setOptions(undefined); setWorkspace(undefined); setError('');
    void (async () => {
      const selected = !agentId && entryId
        ? (await window.ade.invoke('project:command', { operation: 'open', entryId })).workspace : undefined;
      if (!live) return;
      setWorkspace(selected);
      const result = await window.ade.invoke('session:options', selected ? { projectWorkspaceId: selected.id }
        : agentId ? { agentId, repositoryId: repositoryId || null } : { terminalHome: true });
      if (live) setOptions(result);
    })()
      .catch((reason) => { if (live) setError(reason instanceof Error ? reason.message : 'Startmöglichkeiten konnten nicht geprüft werden.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [agentId, repositoryId, entryId, refresh]);
  useEffect(() => { if (agentId && !agent) close(); }, [agentId, agent, close]);
  const launch = async () => {
    if (lock.current || loading || !canLaunchChoice(choice, options) || !agentId && entryId && !workspace
      || workspace && choice.mode === 'agent' && !options?.profiles?.some((profile) => profile.id === profileId)) return;
    lock.current = true; setBusy(true); setError('');
    try {
      if (workspace) {
        const session = await useSessions.getState().createProjectSession(workspace.id, workspace.branch, choice, choice.mode === 'agent' ? profileId : undefined);
        useSelection.getState().openProjectSession(workspace.id, session.id);
        useMode.getState().setMode('projects');
      } else if (agentId) await useSessions.getState().createSession(agentId, undefined, undefined, undefined, repositoryId || null, undefined, choice);
      else { await useSessions.getState().createHomeSession(choice); useSelection.getState().setSelectedAgent(null); }
      close();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Sitzung konnte nicht gestartet werden.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <Modal title="Neue Terminalsitzung" subtitle={agent?.name ?? 'CLI direkt im Workspace öffnen · Agent-Profil optional'} onClose={() => { if (!lock.current) close(); }}
    fallbackFocus={() => document.querySelector<HTMLElement>('.project-terminal .xterm-helper-textarea') ?? document.getElementById('new-session') ?? document.getElementById('mode-tab-terminals')}>
    <form onSubmit={(event) => { event.preventDefault(); void launch(); }}>
      {!agentId && <div className="session-launch-fields"><label>Workspace<select aria-label="Terminal-Workspace" value={entryId} disabled={busy}
        onChange={(event) => { setEntryId(event.target.value); setWorkspace(undefined); setOptions(undefined); setLoading(true); setProfileId(''); if (choice.mode === 'agent') setChoice({ mode: 'shell' }); }}>
        <option value="">Benutzerverzeichnis · Ohne Projekt</option>
        {directory?.entries.map((entry) => <option key={entry.id} value={entry.id} disabled={entry.kind !== 'repository'}>{entry.name} · {entry.backend}{entry.kind !== 'repository' ? ' · Nicht verfügbar' : ''}</option>)}
      </select></label>
        {directoryLoading && <p role="status">Workspaces werden geladen…</p>}
        {directoryError && <p role="alert">{directoryError}</p>}
        {directory && !directory.entries.length && <p>Unter Projekte einen bestehenden Git-Ordner hinzufügen.</p>}
        {directory?.notice && <p>{directory.notice}</p>}
        {workspace && <p role="status">{workspace.name} · Branch {workspace.branch} · Vorhandener Projekt-Workspace</p>}
      </div>}
      {agentId && <div className="field"><label>Projekt<select aria-label="Sitzungsprojekt" value={repositoryId} disabled={busy} onChange={(event) => setRepositoryId(event.target.value)}>
        <option value="">Ohne Projekt · Eigener Workspace</option>{repos.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label></div>}
      <SessionLaunchFields choice={choice} onChange={setChoice} options={options} disabled={busy} loading={loading} />
      {workspace && choice.mode === 'agent' && <div className="session-launch-fields"><label>Startprofil<select aria-label="Startprofil" value={profileId} disabled={busy} onChange={(event) => setProfileId(event.target.value)}>
        <option value="">Profil wählen</option>{options?.profiles?.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.runtime}</option>)}
      </select></label><p>Das Profil liefert die Start-Einstellungen für den oben gewählten Workspace.</p></div>}
      {error && <p role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="btn" disabled={busy} onClick={close}>Abbrechen</button>
        <button type="button" className="btn" disabled={busy || loading} onClick={() => setRefresh((n) => n + 1)}>Startmöglichkeiten aktualisieren</button>
        <button className="btn primary" disabled={busy || loading || !canLaunchChoice(choice, options) || !!entryId && !workspace || !!workspace && choice.mode === 'agent' && !options?.profiles?.some((profile) => profile.id === profileId)}>{busy ? 'Startet…' : 'Sitzung starten'}</button></div>
    </form>
  </Modal>;
}
