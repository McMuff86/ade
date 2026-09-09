import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { MobileHostState, ProjectDirectoryEntry, ProjectDirectoryView, ProjectWorkspaceCommandResult, ProjectWorkspaceQueryResult, ProjectWorkspaceView } from '../shared/remote';
import { ProjectDirectory, ProjectWorkspaceSummary } from '../renderer/projects/ProjectDirectory';
import { workspaceError } from './AgentWorkspace';
import { useDeviceDraft } from './deviceDrafts';
import type { MobileHost } from './useMobileHost';
import { Dialog } from './ui';
import { MobileClientError } from './client';

interface Opening { key: string; entryId: string; name: string }
/** Persist the receipt before sending; a lost reply is resolved by an explicit replay. */
export function ProjectDirectoryPage({ host, onAgentWorkspace }: { host: MobileHost; onAgentWorkspace: (repositoryId: string) => void }): JSX.Element {
  const [directory, setDirectory] = useState<ProjectDirectoryView>(); const [rights, setRights] = useState<MobileHostState>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [selected, setSelected] = useState<ProjectDirectoryEntry>();
  const [opening, saveOpening] = useDeviceDraft<Opening | null>(host.deviceId, 'project-opening', null);
  const [workspaceId, saveWorkspaceId] = useDeviceDraft<string | null>(host.deviceId, 'project-selected', null);
  const [workspace, setWorkspace] = useState<ProjectWorkspaceView>();
  const live = useRef(true); const lock = useRef(false); const epoch = useRef(0); const opener = useRef<HTMLButtonElement | null>(null);
  const online = host.status === 'online'; const canRead = !!rights?.capabilities?.includes('workspace:read');
  const canOpen = canRead && !!rights?.capabilities?.includes('projects:write');
  useEffect(() => { live.current = true; return () => { live.current = false; epoch.current++; }; }, []);
  const refresh = useCallback(async () => {
    const version = ++epoch.current; if (!online) { setRights(undefined); return; }
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
    } catch (reason) { if (current()) { setError(workspaceError(reason)); setWorkspace(undefined); } }
    finally { if (current()) setBusy(false); }
  }, [host.request, online, workspaceId]);
  useEffect(() => { void refresh(); }, [refresh]);
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
  const close = () => { setSelected(undefined); saveWorkspaceId(null); setWorkspace(undefined); setError(''); };
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
    {show && <Dialog title={`Projekt · ${name}`} onClose={close} fallbackId="view-tab-projects" restoreFocusTo={opener.current}>
      {workspace && canRead ? <ProjectWorkspaceSummary workspace={workspace} /> : <p>Den vorhandenen Projektordner öffnen. Sein Branch und seine Dateien bleiben erhalten.</p>}
      {error && <p role="alert">{error}</p>}{!online && <p role="status">PC nicht verbunden. Erneut versuchen, sobald die Verbindung steht.</p>}
      {busy && <p role="status">Workspace wird geprüft…</p>}
      {!workspace && online && rights && !canOpen && <p role="alert">Am PC unter Settings → Verbundene Geräte zusätzlich „Projekt-Workspaces ohne Agent-Profil öffnen“ freigeben. Danach Freigaben aktualisieren.</p>}
      <div className="project-workspace-actions">
        {!workspace && <button className="m-primary" disabled={busy || !online || !canOpen} onClick={() => void open()}>{opening ? 'Workspace-Öffnung erneut prüfen' : 'Workspace öffnen'}</button>}
        <button disabled={busy || !online} onClick={() => void refresh()}>{workspace ? 'Workspace aktualisieren' : 'Freigaben aktualisieren'}</button>
        {opening && <button disabled={busy} onClick={() => { saveOpening(null); close(); }}>Öffnung verwerfen · Workspace behalten</button>}
      </div>
      {workspace && <details><summary>Agent-Arbeitskopie</summary><p>Eine bereits eingerichtete Agent-Arbeitskopie über den bisherigen Einstieg verwenden.</p>
        <button onClick={() => { const id = workspace.repositoryId; close(); onAgentWorkspace(id); }}>Agent-Arbeitskopie öffnen</button></details>}
    </Dialog>}
  </>;
}
