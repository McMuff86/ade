import { localizeAppMessage } from '../shared/i18n/appMessages';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
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
  useLocale();
  const [progress, save] = useDeviceDraft<StartProgress | null>(host.deviceId, 'project-start', null);
  const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const lock = useRef(false);
  const [rights, setRights] = useState<MobileHostState>(); const owner = useRef(host.deviceId); owner.current = host.deviceId;
  useEffect(() => {
    if (!open || host.status !== 'online') return; let live = true; setRights(undefined);
    void Promise.all([host.request<MobileHostState>('/api/v1/host'), host.refresh()]).then(([value]) => { if (live) setRights(value); })
      .catch((reason) => { if (live) setError(workspaceError(reason)); }); return () => { live = false; };
  }, [open, host.status, host.request, host.refresh]);
  const permitted = rights?.resourceSelection !== 'selected' && (['catalog:write', 'workspace:read', 'projects:write'] as const).every((scope) => rights?.capabilities?.includes(scope));
  const checkpoint = (next: StartProgress) => { if (!save(next)) throw new Error(translate("The browser cannot save launch progress. Free up device storage and check again.")); };
  const start = async () => {
    if (lock.current || host.status !== 'online' || !permitted || !host.catalog?.projectStart?.configured) return;
    lock.current = true; setBusy(true); setError(''); const deviceId = host.deviceId;
    let current: StartProgress = progress ?? { key: crypto.randomUUID(), name: name.trim() || `idee-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 4)}`, repositoryId: '', phase: 'project' };
    const assertOwner = () => { if (owner.current !== deviceId) throw new Error(translate("Device pairing has changed.")); };
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
        if (!entry) throw new Error(translate("The created project is currently unreachable. Update project folders and re-check them."));
        const result = await host.request<ProjectWorkspaceCommandResult>('/api/v1/projects/command', 'POST', { operation: 'open', entryId: entry.id }, `${current.key}-open-project`);
        assertOwner(); current = { ...current, projectWorkspaceId: result.workspace.id, phase: 'done' }; checkpoint(current);
      }
      await host.refresh(); assertOwner();
      onStarted({ projectWorkspaceId: current.projectWorkspaceId!, repositoryId: current.repositoryId }); save(null); setName('');
    } catch (reason) { if (owner.current === deviceId) setError(reason instanceof Error && !(reason instanceof MobileClientError) ? reason.message : workspaceError(reason)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <>
    {progress && !open && <p className="m-notice">{translate("Project start “")}{progress.name}{translate("” is still pending.")}{" "}<button onClick={onOpen}>{translate("Continue project start")}</button></p>}
    {open && <Dialog title={translate("New project")} onClose={onClose} fallbackId="mobile-title" className="m-project-start">
      <p>{translate("Create the project folder in the set root folder, then select Branch and CLI in the project, and an agent profile is optional.")}</p>
      {!host.catalog?.projectStart?.configured && <p role="alert">{translate("On the PC, first select and save the project root folder under Settings.")}</p>}
      <form onSubmit={(event) => { event.preventDefault(); void start(); }}>
        <label>{translate("Project name (optional)")}<input value={progress?.name ?? name} maxLength={80} disabled={busy || !!progress}
          placeholder={translate("For example, garden-planner")} onChange={(event) => setName(event.target.value)} /></label>
        <p>{translate("The new Git workspace starts with the branch main. All project files remain there.")}</p>
        {progress && <p role="status">{progress.repositoryId ? translate("Project is created; open workspace.") : translate("Create project.")} · {progress.name}</p>}
        {error && <p role="alert">{localizeAppMessage(error)}</p>}{host.status !== 'online' && <p role="status">{translate("PC not connected. Continue the stored process after the connection.")}</p>}
        {!rights && host.status === 'online' && <p role="status">{translate("Checking device permissions…")}</p>}
        {rights?.resourceSelection === 'selected' && <p>{translate("This device uses selected projects. Create new projects on the PC and share them with the tablet.")}</p>}
    {rights && !permitted && rights.resourceSelection !== 'selected' && <p role="alert">{translate("On the PC for this tablet, share “Create agents and projects”, “Read workspace files and git diffs” and “Open project workspaces without an agent profile”.")}</p>}
        <button className="m-primary" disabled={busy || host.status !== 'online' || !permitted || !host.catalog?.projectStart?.configured}>{busy ? translate("Opening project…") : progress ? translate("Continue start") : translate("Create and Open Project")}</button>
      </form>
      {progress && !busy && <button onClick={() => { save(null); setError(''); }}>{translate("Close start sequence · Keep created work")}</button>}
    </Dialog>}
  </>;
}
