import { useCallback, useContext, useEffect, useId, useRef, useState, type JSX } from 'react';
import type { MobileFileSaveInput, MobileFileSaveResult, MobileHostState, MobileWorkspaceResult, ProjectDirectoryEntry, ProjectDirectoryView, ProjectWorkspaceCommandResult, ProjectWorkspaceQuery, ProjectWorkspaceQueryResult, ProjectWorkspaceView } from '../shared/remote';
import { ProjectDirectory, ProjectWorkspaceSummary } from '../renderer/projects/ProjectDirectory';
import { workspaceError } from './AgentWorkspace';
import { useDeviceDraft } from './deviceDrafts';
import type { MobileHost } from './useMobileHost';
import { Dialog } from './ui';
import { MobileClientError } from './client';
import { ProjectBranches, type PendingBranch } from '../renderer/projects/ProjectBranches';
import { RemoteTerminalPane } from './RemoteTerminalPane';
import { MobileSpeechSettings } from './SpeechSettings';
import { TabletKeyboardContext } from './useTabletViewport';
import { ProjectGitPanel, type PendingProjectFile, type PendingProjectGit } from '../renderer/projects/ProjectGitPanel';
import { ProjectPublishPanel, type PendingProjectPublish } from '../renderer/projects/ProjectPublishPanel';

import { ProjectRunResults } from '../renderer/projects/ProjectRunResults';
import { useRunFilesPort } from './useRunFilesPort';

interface Opening { key: string; entryId: string; name: string }
interface MembershipChange { key: string; entryId: string; included: boolean; name: string }
export interface ProjectOpenIntent { key: string; workspaceId?: string; repositoryId?: string; terminalId?: string }
/** Persist the receipt before sending; a lost reply is resolved by an explicit replay. */
export function ProjectDirectoryPage({ host, onAgentWorkspace, intent, onIntentConsumed }: { host: MobileHost; onAgentWorkspace: (repositoryId: string) => void; intent?: ProjectOpenIntent; onIntentConsumed?: () => void }): JSX.Element {
  const [directory, setDirectory] = useState<ProjectDirectoryView>(); const [rights, setRights] = useState<MobileHostState>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [selected, setSelected] = useState<ProjectDirectoryEntry>();
  const [opening, saveOpening] = useDeviceDraft<Opening | null>(host.deviceId, 'project-opening', null);
  const [membershipChange, saveMembershipChange] = useDeviceDraft<MembershipChange | null>(host.deviceId, 'project-membership', null);
  const [membershipNotice, setMembershipNotice] = useState('');
  const [workspaceId, saveWorkspaceId] = useDeviceDraft<string | null>(host.deviceId, 'project-selected', null);
  const [workspace, setWorkspace] = useState<ProjectWorkspaceView>();
  const [workspaceInfo, setWorkspaceInfo] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(() => {
    try { return localStorage.getItem('ade-mobile-project-context-collapsed') === 'true'; } catch { return false; }
  });
  const contextId = useId();
  const toggleContext = (button: HTMLButtonElement) => {
    button.focus();
    setContextCollapsed(!contextCollapsed);
    try { localStorage.setItem('ade-mobile-project-context-collapsed', String(!contextCollapsed)); } catch { /* Layout remains usable without storage. */ }
  };
  const infoButton = useRef<HTMLButtonElement>(null);
  const [terminalId, setTerminalId] = useState<string>();
  const [pendingBranch, savePendingBranch] = useDeviceDraft<PendingBranch | null>(host.deviceId, `project-branch:${workspaceId ?? 'none'}`, null);
  const [pendingGit, savePendingGit] = useDeviceDraft<PendingProjectGit | null>(host.deviceId, `project-git:${workspaceId ?? 'none'}`, null);
  const [pendingFile, savePendingFile] = useDeviceDraft<PendingProjectFile | null>(host.deviceId, `project-file:${workspaceId ?? 'none'}`, null);
  const [pendingPublish, savePendingPublish] = useDeviceDraft<PendingProjectPublish | null>(host.deviceId, `project-publish:${workspaceId ?? 'none'}`, null);
  const [section, setSection] = useState<'terminal' | 'git' | 'results' | 'settings'>('terminal');
  useEffect(() => { if (pendingGit || pendingFile || pendingPublish) setSection('git'); }, [pendingGit, pendingFile, pendingPublish]);
  const filePort = useRunFilesPort(host);
  const keyboardOpen = useContext(TabletKeyboardContext);
  const branchQuery = useCallback((input: ProjectWorkspaceQuery) => host.request<ProjectWorkspaceQueryResult>('/api/v1/projects/query', 'POST', input), [host.request]);
  const branchApply = useCallback(async (previewId: string, key: string) => (await host.request<ProjectWorkspaceCommandResult>('/api/v1/projects/command', 'POST', { operation: 'branch-apply', previewId }, key)).workspace, [host.request]);
  const gitApply = useCallback(async (previewId: string, key: string) => (await host.request<ProjectWorkspaceCommandResult>('/api/v1/projects/command', 'POST', { operation: 'git-apply', previewId }, key)).git!, [host.request]);
  const publishApply = useCallback((previewId: string, key: string) => host.request<ProjectWorkspaceCommandResult>('/api/v1/projects/command', 'POST', { operation: 'publish-apply', previewId }, key), [host.request]);
  const readFile = useCallback((path: string) => host.request<MobileWorkspaceResult>('/api/v1/workspace/query', 'POST', { projectWorkspaceId: workspaceId, operation: 'file', path }), [host.request, workspaceId]);
  const saveFile = useCallback((input: MobileFileSaveInput, key: string) => host.request<MobileFileSaveResult>('/api/v1/workspace/save', 'POST', input, key), [host.request]);
  const live = useRef(true); const lock = useRef(false); const epoch = useRef(0); const opener = useRef<HTMLButtonElement | null>(null);
  const online = host.status === 'online'; const canRead = !!rights?.capabilities?.includes('workspace:read');
  const canOpen = canRead && !!rights?.capabilities?.includes('projects:write');
  useEffect(() => { live.current = true; return () => { live.current = false; epoch.current++; }; }, []);
  const refresh = useCallback(async () => {
    const version = ++epoch.current; if (!online) return;
    setBusy(true); setError('');
    const current = () => live.current && version === epoch.current;
    try {
      const permissions = await host.request<MobileHostState>('/api/v1/host'); if (!current()) return; setRights(permissions);
      if (!permissions.capabilities?.includes('workspace:read')) { setDirectory(undefined); setWorkspace(undefined); return; }
      const result = await host.request<ProjectWorkspaceQueryResult>('/api/v1/projects/query', 'POST', { operation: 'directory' });
      if (!current()) return; setDirectory(result.directory);
      if (workspaceId) {
        const detail = await host.request<ProjectWorkspaceQueryResult>('/api/v1/projects/query', 'POST', { operation: 'workspace', workspaceId });
        if (current()) setWorkspace(detail.workspace);
      }
    } catch (reason) { if (current()) { setError(workspaceError(reason));
      if (!(reason instanceof MobileClientError) || reason.status > 0 && reason.status < 500) setWorkspace(undefined);
    } }
    finally { if (current()) setBusy(false); }
  }, [host.request, online, workspaceId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!intent || !directory) return;
    if (intent.workspaceId) {
      if (intent.workspaceId !== workspaceId) setWorkspace(undefined);
      setError(''); saveWorkspaceId(intent.workspaceId); setTerminalId(intent.terminalId); if (intent.terminalId) setSection('terminal');
    }
    else if (intent.repositoryId) {
      const entry = directory.entries.find((item) => item.repositoryId === intent.repositoryId);
      if (entry) { setSelected(entry); saveWorkspaceId(null); setWorkspace(undefined); setTerminalId(undefined); }
      else setError('Projekt ist in der aktuellen Übersicht nicht verfügbar. Projektordner aktualisieren.');
    }
    onIntentConsumed?.();
  }, [intent, directory, saveWorkspaceId, onIntentConsumed]);
  const open = async () => {
    if (lock.current || !online || !canOpen || (!selected && !opening)) return;
    lock.current = true; setBusy(true); setError('');
    const command = opening ?? { key: crypto.randomUUID(), entryId: selected!.id, name: selected!.name };
    try {
      if (!saveOpening(command)) throw new Error('Browser-Speicher nicht verfügbar. Workspace wurde nicht geöffnet. Speicher freigeben und erneut versuchen.');
      const result = await host.request<ProjectWorkspaceCommandResult>('/api/v1/projects/command', 'POST', { operation: 'open', entryId: command.entryId }, command.key);
      if (!live.current) return;
      // Keep the receipt if selection persistence fails; next attempt safely replays.
      if (!saveWorkspaceId(result.workspace.id)) throw new Error('Workspace ist geöffnet. Browser-Speicher nicht verfügbar; mit derselben Aktion erneut prüfen.');
      saveOpening(null); setSelected(undefined); setWorkspace(result.workspace);
      void host.refresh().catch(() => undefined);
    } catch (reason) { if (live.current) setError(reason instanceof Error && !(reason instanceof MobileClientError) ? reason.message : workspaceError(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const close = () => { setWorkspaceInfo(false); setSelected(undefined); saveWorkspaceId(null); setWorkspace(undefined); setTerminalId(undefined); setError(''); };
  const membership = async (entry: ProjectDirectoryEntry, included: boolean) => {
    if (lock.current || !online) return;
    lock.current = true; setBusy(true); setError(''); setMembershipNotice('');
    const command = membershipChange ?? { key: crypto.randomUUID(), entryId: entry.id, included, name: entry.name };
    try {
      if (!saveMembershipChange(command)) throw new Error('Browser-Speicher nicht verfügbar. Projekt-Auswahl wurde nicht geändert.');
      await host.request('/api/v1/projects/membership', 'POST', { entryId: command.entryId, included: command.included }, command.key);
      if (!live.current) return;
      saveMembershipChange(null);
      const result = await host.request<ProjectWorkspaceQueryResult>('/api/v1/projects/query', 'POST', { operation: 'directory' });
      if (live.current) { setDirectory(result.directory); setMembershipNotice(`${command.name}: ${command.included ? 'Zu meinen ADE Projekten hinzugefügt.' : 'Aus meiner ADE-Auswahl entfernt. Dateien und Verlauf bleiben erhalten.'}`); }
      await host.refresh();
    } catch (reason) { if (live.current) {
      if (reason instanceof MobileClientError && reason.status >= 400 && reason.status < 500) saveMembershipChange(null);
      setError(reason instanceof Error && !(reason instanceof MobileClientError) ? reason.message : workspaceError(reason));
    } throw reason; }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const show = !!selected || !!workspaceId;
  const name = workspace?.name ?? selected?.name ?? opening?.name ?? 'Workspace';
  // A receipt awaiting recovery must remain visible even with a saved compact layout.
  const contextHidden = !!workspace && canRead && contextCollapsed && !pendingBranch;
  return <>
    {online && rights && !canRead && <p role="alert">Am PC unter Einstellungen → Verbundene Geräte „Workspace-Dateien und Git-Diffs lesen“ freigeben. Danach Projektordner aktualisieren.</p>}
    {membershipNotice && <p role="status">{membershipNotice}</p>}
    {membershipChange && <p role="status">Projekt-Auswahl für {membershipChange.name} noch nicht bestätigt. <button disabled={busy || !online} onClick={() => void membership({ id: membershipChange.entryId, name: membershipChange.name, kind: 'repository', backend: 'native', source: 'catalog', notice: null }, membershipChange.included).catch(() => undefined)}>Projekt-Auswahl erneut prüfen</button></p>}
    {canRead && !rights?.capabilities?.includes('catalog:write') && <p>Zum Hinzufügen und Entfernen am PC unter Verbundene Geräte die Projektverwaltung freigeben.</p>}
    <ProjectDirectory directory={directory} busy={busy || !!opening || !!membershipChange} error={show ? '' : error} online={online} onRefresh={() => void refresh()}
      onMembership={membership} canManage={!!rights?.capabilities?.includes('catalog:write') && rights?.resourceSelection !== 'selected'}
      onOpen={(entry, button) => { opener.current = button; setSelected(entry); setError(''); }} />
    {opening && !show && <div role="status"><p>Öffnen von „{opening.name}“ noch nicht bestätigt.</p><button onClick={(event) => {
      opener.current = event.currentTarget; setSelected(directory?.entries.find((entry) => entry.id === opening.entryId)
        ?? { id: opening.entryId, name: opening.name, kind: 'repository', backend: 'native', source: 'root', notice: null });
    }}>Workspace-Öffnung prüfen</button></div>}
    {show && <Dialog title={`Projekt · ${name}`} onClose={close} fallbackId="view-tab-projects" restoreFocusTo={opener.current} className={`m-independent-project ${workspace ? `m-agent-workspace ${section === 'terminal' ? 'm-terminal-workspace' : 'm-project-git-workspace'}` : ''}`}
      headerActions={workspace && canRead && <div className="m-project-header-actions">
        <button ref={infoButton} className="m-workspace-info-button" onClick={(event) => { event.currentTarget.focus(); setWorkspaceInfo(true); }}>Workspace-Info</button>
        <button className="m-project-context-toggle" aria-expanded={!contextHidden} aria-controls={contextId} disabled={!!pendingBranch}
          aria-label={`Projektbereich ${contextHidden ? 'einblenden' : 'einklappen'}`} onClick={(event) => toggleContext(event.currentTarget)}>
          <svg className="m-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={contextHidden ? 'm6 9 6 6 6-6' : 'm6 15 6-6 6 6'} /></svg>
          Projektbereich
        </button>
      </div>}>
      {error && <p className="m-project-notice" role="alert">{error}</p>}{!online && <p className="m-project-notice" role="status">PC nicht verbunden. Erneut versuchen, sobald die Verbindung steht.</p>}
      {busy && <p className="m-project-notice" role="status">Workspace wird geprüft…</p>}
      <div id={contextId} className="m-project-context" hidden={contextHidden}>
      {workspace && canRead ? <ProjectWorkspaceSummary workspace={workspace} /> : <p>Den vorhandenen Projektordner öffnen. Sein Branch und seine Dateien bleiben erhalten.</p>}
      {!workspace && online && rights && !canOpen && <p role="alert">Am PC unter Einstellungen → Verbundene Geräte zusätzlich „Projekt-Workspaces ohne Agent-Profil öffnen“ freigeben. Danach Freigaben aktualisieren.</p>}
      <div className="m-project-toolbar">
        {workspace && <div className="project-workspace-actions" aria-label="Projektbereich"><button aria-pressed={section === 'terminal'} onClick={() => setSection('terminal')}>Terminal</button><button aria-pressed={section === 'git'} onClick={() => setSection('git')}>Git</button><button aria-pressed={section === 'results'} onClick={() => setSection('results')}>Ergebnisse</button><button aria-pressed={section === 'settings'} onClick={() => setSection('settings')}>Projekt-Einstellungen</button></div>}
        {!workspace && <button className="m-primary" disabled={busy || !online || !canOpen} onClick={() => void open()}>{opening ? 'Workspace-Öffnung erneut prüfen' : 'Workspace öffnen'}</button>}
        <button disabled={busy || !online} onClick={() => void refresh()}>{workspace ? 'Workspace aktualisieren' : 'Freigaben aktualisieren'}</button>
        {opening && <button disabled={busy} onClick={() => { saveOpening(null); close(); }}>Öffnung verwerfen · Workspace behalten</button>}
      {workspace && canRead && <ProjectBranches key={workspace.id} workspace={workspace} online={online} canChange={canOpen && !!rights?.capabilities?.includes('projectGit:write')}
        query={branchQuery} apply={branchApply} errorText={workspaceError} pending={pendingBranch} savePending={savePendingBranch}
        onWorkspace={(value) => { saveWorkspaceId(value.id); setWorkspace(value); setTerminalId(undefined); }} />}
      </div>
      </div>
      {workspace && canRead && (section === 'terminal' ? <div className="m-terminal-slot"><RemoteTerminalPane key={`${workspace.id}:${workspace.branch}`} host={host} projectWorkspaceId={workspace.id}
        expectedBranch={workspace.branch} active projectEntry initialTerminalId={terminalId} compactControls={keyboardOpen} /></div>
        : section === 'results' ? <div className="m-project-git-body"><ProjectRunResults key={workspace.id} workspaceId={workspace.id} query={branchQuery} port={filePort} online={online} identity={host.identityVersion} errorText={workspaceError} /></div>
        : section === 'settings' ? <div className="m-project-git-body"><MobileSpeechSettings host={host} target={{ kind: 'project', repositoryId: workspace.repositoryId }} title="Projekt-Stimme" /></div>
        : <div className="m-project-git-body"><ProjectGitPanel key={`${workspace.id}:${workspace.branch}`} workspace={workspace} online={online} canChange={canOpen && !!rights?.capabilities?.includes('projectGit:write')} canEdit={!!rights?.capabilities?.includes('workspace:write')}
          query={branchQuery} apply={gitApply} readFile={readFile} saveFile={saveFile} errorText={workspaceError} pending={pendingGit} savePending={savePendingGit}
          filePending={pendingFile} saveFilePending={savePendingFile} onWorkspace={(value) => { if (value.id !== workspace.id || value.branch !== workspace.branch) { saveWorkspaceId(value.id); setWorkspace(value); } }} />
          <ProjectPublishPanel key={`publish:${workspace.id}:${workspace.branch}`} workspace={workspace} online={online} canPublish={canOpen && !!rights?.capabilities?.includes('projectGit:publish')}
            query={branchQuery} apply={publishApply} errorText={workspaceError} pending={pendingPublish} savePending={savePendingPublish} /></div>)}
      {workspace && <details hidden={contextHidden}><summary>Agent-Arbeitskopie</summary><p>Eine bereits eingerichtete Agent-Arbeitskopie über den bisherigen Einstieg verwenden.</p>
        <button onClick={() => { const id = workspace.repositoryId; close(); onAgentWorkspace(id); }}>Agent-Arbeitskopie öffnen</button></details>}
      {workspaceInfo && workspace && canRead && <Dialog title="Workspace-Info" onClose={() => setWorkspaceInfo(false)} restoreFocusTo={() => infoButton.current} fallbackId="view-tab-projects">
        <ProjectWorkspaceSummary workspace={workspace} />
        <p>Der vollständige Workspace-Pfad ist in ADE am PC aufklappbar. Auf dem Tablet werden PC-Pfade als [path] maskiert.</p>
        <p>Die Shell kann in einen Unterordner gewechselt sein; diese Angaben beschreiben den geöffneten Workspace.</p>
        {!online && <p role="status">PC nicht verbunden. Die Angaben können veraltet sein.</p>}
      </Dialog>}
    </Dialog>}
  </>;
}
