import { useEffect, useRef, useState, type JSX } from 'react';
import type { MobileAdministrationResult, MobileHostState, ProjectWorkspaceCommandResult, ProjectWorkspaceQueryResult } from '../shared/remote';
import type { MobileHost } from './useMobileHost';
import { useDeviceDraft } from './deviceDrafts';
import { Dialog } from './ui';
import { workspaceError } from './AgentWorkspace';
import { MobileClientError } from './client';

export interface ProjectSession { projectWorkspaceId: string; repositoryId: string }
interface StartProgress {
  key: string; name: string; repositoryId: string; projectWorkspaceId?: string;
  // Older pending starts remain recoverable without repeating their CLI launch.
  agentId?: string; terminalId?: string;
  phase: 'agent' | 'project' | 'workspace' | 'terminal' | 'done';
}
export function ProjectStart({ host, open, onClose, onOpen, onStarted }: {
  host: MobileHost; open: boolean; onClose: () => void; onOpen: () => void; onStarted: (session: ProjectSession) => void;
}): JSX.Element {
  const [progress, save] = useDeviceDraft<StartProgress | null>(host.deviceId, 'project-start', null);
  const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const lock = useRef(false);
  const [rights, setRights] = useState<MobileHostState>(); const owner = useRef(host.deviceId); owner.current = host.deviceId;
  useEffect(() => {
    if (!open || host.status !== 'online') return; let live = true; setRights(undefined);
    void Promise.all([host.request<MobileHostState>('/api/v1/host'), host.refresh()]).then(([value]) => { if (live) setRights(value); })
      .catch((reason) => { if (live) setError(workspaceError(reason)); }); return () => { live = false; };
  }, [open, host.status, host.request, host.refresh]);
  const permitted = rights?.resourceSelection !== 'selected' && (['catalog:write', 'workspace:read', 'projects:write'] as const).every((scope) => rights?.capabilities?.includes(scope));
  const checkpoint = (next: StartProgress) => { if (!save(next)) throw new Error('Der Browser kann den Startfortschritt nicht speichern. Gerätespeicher freigeben und erneut prüfen.'); };
  const start = async () => {
    if (lock.current || host.status !== 'online' || !permitted || !host.catalog?.projectStart?.configured) return;
    lock.current = true; setBusy(true); setError(''); const deviceId = host.deviceId;
    let current: StartProgress = progress ?? { key: crypto.randomUUID(), name: name.trim() || `idee-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 4)}`, repositoryId: '', phase: 'project' };
    const assertOwner = () => { if (owner.current !== deviceId) throw new Error('Gerätekopplung hat sich geändert.'); };
    try {
      checkpoint(current);
      if (!current.repositoryId) {
        assertOwner();
        const result = await host.request<MobileAdministrationResult>('/api/v1/admin/commands', 'POST', { operation: 'project-create', input: { name: current.name } }, `${current.key}-project`);
        assertOwner(); current = { ...current, repositoryId: result.created!.id, phase: 'workspace' }; checkpoint(current);
      }
      if (!current.projectWorkspaceId) {
        const directory = await host.request<ProjectWorkspaceQueryResult>('/api/v1/projects/query', 'POST', { operation: 'directory' }); assertOwner();
        const entry = directory.directory?.entries.find((item) => item.repositoryId === current.repositoryId);
        if (!entry) throw new Error('Das angelegte Projekt ist gerade nicht erreichbar. Projektordner aktualisieren und erneut prüfen.');
        const result = await host.request<ProjectWorkspaceCommandResult>('/api/v1/projects/command', 'POST', { operation: 'open', entryId: entry.id }, `${current.key}-open-project`);
        assertOwner(); current = { ...current, projectWorkspaceId: result.workspace.id, phase: 'done' }; checkpoint(current);
      }
      await host.refresh(); assertOwner();
      onStarted({ projectWorkspaceId: current.projectWorkspaceId!, repositoryId: current.repositoryId }); save(null); setName('');
    } catch (reason) { if (owner.current === deviceId) setError(reason instanceof Error && !(reason instanceof MobileClientError) ? reason.message : workspaceError(reason)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <>
    {progress && !open && <p className="m-notice">Projektstart „{progress.name}“ ist noch offen. <button onClick={onOpen}>Projektstart fortsetzen</button></p>}
    {open && <Dialog title="Neues Projekt" onClose={onClose} fallbackId="mobile-title" className="m-project-start">
      <p>Projektordner im eingestellten Stammordner anlegen. Danach Branch und CLI im Projekt wählen. Ein Agent-Profil ist optional.</p>
      {!host.catalog?.projectStart?.configured && <p role="alert">Am PC zuerst unter Settings den Projekt-Stammordner auswählen und speichern.</p>}
      <form onSubmit={(event) => { event.preventDefault(); void start(); }}>
        <label>Projektname (optional)<input value={progress?.name ?? name} maxLength={80} disabled={busy || !!progress}
          placeholder="Zum Beispiel gartenplaner" onChange={(event) => setName(event.target.value)} /></label>
        <p>Der neue Git-Workspace beginnt mit dem Branch main. Alle Projektdateien bleiben dort erhalten.</p>
        {progress && <p role="status">{progress.repositoryId ? 'Projekt ist angelegt; Workspace öffnen.' : 'Projekt anlegen.'} · {progress.name}</p>}
        {error && <p role="alert">{error}</p>}{host.status !== 'online' && <p role="status">PC nicht verbunden. Den gespeicherten Vorgang nach der Verbindung fortsetzen.</p>}
        {!rights && host.status === 'online' && <p role="status">Gerätefreigaben werden geprüft…</p>}
        {rights?.resourceSelection === 'selected' && <p>Dieses Gerät nutzt ausgewählte Projekte. Neue Projekte am PC erstellen und für das Tablet freigeben.</p>}
    {rights && !permitted && rights.resourceSelection !== 'selected' && <p role="alert">Am PC für dieses Tablet „Agents und Projekte erstellen“, „Workspace-Dateien und Git-Diffs lesen“ und „Projekt-Workspaces ohne Agent-Profil öffnen“ freigeben.</p>}
        <button className="m-primary" disabled={busy || host.status !== 'online' || !permitted || !host.catalog?.projectStart?.configured}>{busy ? 'Projekt wird geöffnet…' : progress ? 'Start fortsetzen' : 'Projekt anlegen und öffnen'}</button>
      </form>
      {progress && !busy && <button onClick={() => { save(null); setError(''); }}>Startablauf schliessen · erstellte Arbeit behalten</button>}
    </Dialog>}
  </>;
}
