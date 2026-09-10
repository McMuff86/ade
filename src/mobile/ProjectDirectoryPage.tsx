import { useCallback, useContext, useEffect, useRef, useState, type JSX } from 'react';
import type { MobileFileSaveInput, MobileFileSaveResult, MobileHostState, MobileWorkspaceResult, ProjectDirectoryEntry, ProjectDirectoryView, ProjectWorkspaceCommandResult, ProjectWorkspaceQuery, ProjectWorkspaceQueryResult, ProjectWorkspaceView } from '../shared/remote';
import { ProjectDirectory, ProjectWorkspaceSummary } from '../renderer/projects/ProjectDirectory';
import { workspaceError } from './AgentWorkspace';
import { useDeviceDraft } from './deviceDrafts';
import type { MobileHost } from './useMobileHost';
import { Dialog } from './ui';
import { MobileClientError } from './client';
import { ProjectBranches, type PendingBranch } from '../renderer/projects/ProjectBranches';
import { RemoteTerminalPane } from './RemoteTerminalPane';
import { TabletKeyboardContext } from './useTabletViewport';
import { ProjectGitPanel, type PendingProjectFile, type PendingProjectGit } from '../renderer/projects/ProjectGitPanel';
import { ProjectPublishPanel, type PendingProjectPublish } from '../renderer/projects/ProjectPublishPanel';

interface Opening { key: string; entryId: string; name: string }
export interface ProjectOpenIntent { key: string; workspaceId?: string; repositoryId?: string; terminalId?: string }
/** Persist the receipt before sending; a lost reply is resolved by an explicit replay. */
export function ProjectDirectoryPage({ host, onAgentWorkspace, intent, onIntentConsumed }: { host: MobileHost; onAgentWorkspace: (repositoryId: string) => void; intent?: ProjectOpenIntent; onIntentConsumed?: () => void }): JSX.Element {
  const [directory, setDirectory] = useState<ProjectDirectoryView>(); const [rights, setRights] = useState<MobileHostState>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [selected, setSelected] = useState<ProjectDirectoryEntry>();
  const [opening, saveOpening] = useDeviceDraft<Opening | null>(host.deviceId, 'project-opening', null);
  const [workspaceId, saveWorkspaceId] = useDeviceDraft<string | null>(host.deviceId, 'project-selected', null);
  const [workspace, setWorkspace] = useState<ProjectWorkspaceView>();
  const [terminalId, setTerminalId] = useState<string>();
  const [pendingBranch, savePendingBranch] = useDeviceDraft<PendingBranch | null>(host.deviceId, `project-branch:${workspaceId ?? 'none'}`, null);
  const [pendingGit, savePendingGit] = useDeviceDraft<PendingProjectGit | null>(host.deviceId, `project-git:${workspaceId ?? 'none'}`, null);
  const [pendingFile, savePendingFile] = useDeviceDraft<PendingProjectFile | null>(host.deviceId, `project-file:${workspaceId ?? 'none'}`, null);
  const [pendingPublish, savePendingPublish] = useDeviceDraft<PendingProjectPublish | null>(host.deviceId, `project-publish:${workspaceId ?? 'none'}`, null);
  const [section, setSection] = useState<'terminal' | 'git'>('terminal');
  useEffect(() => { if (pendingGit || pendingFile || pendingPublish) setSection('git'); }, [pendingGit, pendingFile, pendingPublish]);
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
    if (intent.workspaceId) { saveWorkspaceId(intent.workspaceId); setTerminalId(intent.terminalId); if (intent.terminalId) setSection('terminal'); }
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
  const close = () => { setSelected(undefined); saveWorkspaceId(null); setWorkspace(undefined); setTerminalId(undefined); setError(''); };
  const show = !!selected || !!workspaceId;
  const name = workspace?.name ?? selected?.name ?? opening?.name ?? 'Workspace';
  return <>
    {online && rights && !canRead && <p role="alert">Am PC unter Settings → Verbundene Geräte „Workspace-Dateien und Git-Diffs lesen“ freigeben. Danach Projektordner aktualisieren.</p>}
    <ProjectDirectory directory={directory} busy={busy || !!opening} error={show ? '' : error} online={online} onRefresh={() => void refresh()}
      onOpen={(entry, button) => { opener.current = button; setSelected(entry); setError(''); }} />
    {opening && !show && <div role="status"><p>Öffnen von „{opening.name}“ noch nicht bestätigt.</p><button onClick={(event) => {
      opener.current = event.currentTarget; setSelected(directory?.entries.find((entry) => entry.id === opening.entryId)
        ?? { id: opening.entryId, name: opening.name, kind: 'repository', backend: 'native', source: 'root', notice: null });
    }}>Workspace-Öffnung prüfen</button></div>}
    {show && <Dialog title={`Projekt · ${name}`} onClose={close} fallbackId="view-tab-projects" restoreFocusTo={opener.current} className={`m-independent-project ${workspace ? `m-agent-workspace ${section === 'terminal' ? 'm-terminal-workspace' : 'm-project-git-workspace'}` : ''}`}>
      <div className="m-project-context">
      {workspace && canRead ? <ProjectWorkspaceSummary workspace={workspace} /> : <p>Den vorhandenen Projektordner öffnen. Sein Branch und seine Dateien bleiben erhalten.</p>}
      {workspace && <div className="project-workspace-actions" aria-label="Projektbereich"><button aria-pressed={section === 'terminal'} onClick={() => setSection('terminal')}>Terminal</button><button aria-pressed={section === 'git'} onClick={() => setSection('git')}>Git</button></div>}
      {error && <p role="alert">{error}</p>}{!online && <p role="status">PC nicht verbunden. Erneut versuchen, sobald die Verbindung steht.</p>}
      {busy && <p role="status">Workspace wird geprüft…</p>}
      {!workspace && online && rights && !canOpen && <p role="alert">Am PC unter Settings → Verbundene Geräte zusätzlich „Projekt-Workspaces ohne Agent-Profil öffnen“ freigeben. Danach Freigaben aktualisieren.</p>}
      <div className="project-workspace-actions">
        {!workspace && <button className="m-primary" disabled={busy || !online || !canOpen} onClick={() => void open()}>{opening ? 'Workspace-Öffnung erneut prüfen' : 'Workspace öffnen'}</button>}
        <button disabled={busy || !online} onClick={() => void refresh()}>{workspace ? 'Workspace aktualisieren' : 'Freigaben aktualisieren'}</button>
        {opening && <button disabled={busy} onClick={() => { saveOpening(null); close(); }}>Öffnung verwerfen · Workspace behalten</button>}
      </div>
      {workspace && canRead && <ProjectBranches key={workspace.id} workspace={workspace} online={online} canChange={canOpen && !!rights?.capabilities?.includes('projectGit:write')}
        query={branchQuery} apply={branchApply} errorText={workspaceError} pending={pendingBranch} savePending={savePendingBranch}
        onWorkspace={(value) => { saveWorkspaceId(value.id); setWorkspace(value); setTerminalId(undefined); }} />}
      </div>
      {workspace && canRead && (section === 'terminal' ? <div className="m-terminal-slot"><RemoteTerminalPane key={`${workspace.id}:${workspace.branch}`} host={host} projectWorkspaceId={workspace.id}
        expectedBranch={workspace.branch} active projectEntry initialTerminalId={terminalId} compactControls={keyboardOpen} /></div>
        : <div className="m-project-git-body"><ProjectGitPanel key={`${workspace.id}:${workspace.branch}`} workspace={workspace} online={online} canChange={canOpen && !!rights?.capabilities?.includes('projectGit:write')} canEdit={!!rights?.capabilities?.includes('workspace:write')}
          query={branchQuery} apply={gitApply} readFile={readFile} saveFile={saveFile} errorText={workspaceError} pending={pendingGit} savePending={savePendingGit}
          filePending={pendingFile} saveFilePending={savePendingFile} onWorkspace={(value) => { if (value.id !== workspace.id || value.branch !== workspace.branch) { saveWorkspaceId(value.id); setWorkspace(value); } }} />
          <ProjectPublishPanel key={`publish:${workspace.id}:${workspace.branch}`} workspace={workspace} online={online} canPublish={canOpen && !!rights?.capabilities?.includes('projectGit:publish')}
            query={branchQuery} apply={publishApply} errorText={workspaceError} pending={pendingPublish} savePending={savePendingPublish} /></div>)}
      {workspace && <details><summary>Agent-Arbeitskopie</summary><p>Eine bereits eingerichtete Agent-Arbeitskopie über den bisherigen Einstieg verwenden.</p>
        <button onClick={() => { const id = workspace.repositoryId; close(); onAgentWorkspace(id); }}>Agent-Arbeitskopie öffnen</button></details>}
    </Dialog>}
  </>;
}
