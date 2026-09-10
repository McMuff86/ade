import { useEffect, useRef, useState, type ComponentProps, type JSX } from 'react';
import type { MobileAdministrationResult, MobileHostState, MobileWorkspaceResult } from '../shared/remote';
import type { MobileHost } from './useMobileHost';
import { AgentWorkspace, workspaceError } from './AgentWorkspace';
import { useDeviceDraft } from './deviceDrafts';
import { Dialog } from './ui';
import { ProjectDirectoryPage, type ProjectOpenIntent } from './ProjectDirectoryPage';

export function Projects({ host, onProject, intent, onIntentConsumed }: { host: MobileHost; onProject: (id: string) => void; intent?: ProjectOpenIntent; onIntentConsumed?: () => void }): JSX.Element {
  return <section className="m-project-entry" aria-label="Projekte">
    <ProjectDirectoryPage key={host.identityVersion} host={host} onAgentWorkspace={onProject} intent={intent} onIntentConsumed={onIntentConsumed} />
  </section>;
}

interface Preparation { key: string; agentId: string; phase: 'agent' | 'workspace' }
type WorkspaceProps = Pick<ComponentProps<typeof AgentWorkspace>, 'fileDrafts' | 'profileDrafts' | 'onManage'>;
/** Prepare only on an explicit click. Persist command receipts before sending, including across reloads. */
export function ProjectWorkspace({ host, repositoryId, onClose, onTask, ...workspaceProps }: WorkspaceProps & {
  host: MobileHost; repositoryId: string; onClose: () => void; onTask: (agentId: string) => void;
}): JSX.Element {
  const repo = host.catalog?.repositories.find((item) => item.id === repositoryId);
  const agents = host.catalog?.agents.filter((agent) => !agent.homeExecutionBackend || agent.homeExecutionBackend === 'native') ?? [];
  const preferred = agents.find((agent) => agent.defaultRepositoryId === repositoryId)
    ?? agents.find((agent) => agent.id === host.catalog?.projectStart?.agentId && agent.runtime === 'codex')
    ?? agents.find((agent) => agent.runtime === 'codex');
  const [selected, setSelected] = useState(preferred?.id ?? '');
  const [progress, save] = useDeviceDraft<Preparation | null>(host.deviceId, `project-workspace:${repositoryId}`, null);
  const [ready, setReady] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [rights, setRights] = useState<MobileHostState>(); const lock = useRef(false); const live = useRef(true);
  const canRead = rights?.capabilities?.includes('workspace:read') === true;
  const canPrepare = rights?.capabilities?.includes('catalog:write') === true;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    let current = true; setRights(undefined);
    if (host.status === 'online') void host.request<MobileHostState>('/api/v1/host').then((value) => { if (current) setRights(value); })
      .catch((reason) => { if (current) setError(workspaceError(reason)); });
    return () => { current = false; };
  }, [host.status, host.request]);
  const checkpoint = (value: Preparation) => {
    if (!save(value)) throw new Error('Browser-Speicher nicht verfügbar. Workspace wurde nicht weiter vorbereitet.');
  };
  const prepare = async () => {
    if (lock.current || host.status !== 'online' || !canRead) return;
    lock.current = true; setBusy(true); setError('');
    let current = progress ?? { key: crypto.randomUUID(), agentId: selected, phase: selected ? 'workspace' as const : 'agent' as const };
    try {
      checkpoint(current);
      if (current.phase === 'agent') {
        if (!canPrepare) { setError('Am PC für dieses Tablet „Agents und Projekte erstellen“ freigeben, um ein Workspace-Profil vorzubereiten.'); return; }
        const result = await host.request<MobileAdministrationResult>('/api/v1/admin/commands', 'POST', {
          operation: 'agent-create', input: { name: 'Codex', source: { kind: 'runtime', id: 'codex' } },
        }, `${current.key}-agent`);
        current = { ...current, agentId: result.created!.id, phase: 'workspace' }; checkpoint(current);
      }
      if (!live.current) return;
      const existing = await host.request<MobileWorkspaceResult>('/api/v1/workspace/query', 'POST', { operation: 'overview', agentId: current.agentId, repositoryId });
      if (!existing.overview?.ready) {
        if (!canPrepare) { setError('Am PC für dieses Tablet „Agents und Projekte erstellen“ freigeben, um die Arbeitskopie vorzubereiten.'); return; }
        await host.request('/api/v1/admin/commands', 'POST', {
          operation: 'workspace-prepare', input: { agentId: current.agentId, repositoryId },
        }, `${current.key}-workspace`);
      }
      await host.refresh();
      if (live.current) { setReady(current.agentId); save(null); }
    } catch (reason) { if (live.current) setError(workspaceError(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  if (ready) return <AgentWorkspace {...workspaceProps} host={host} agentId={ready} initialRepositoryId={repositoryId} initialTab="terminal"
    projectEntry onClose={onClose} onTask={() => onTask(ready)} />;
  return <Dialog title={`Projekt · ${repo?.name ?? 'Nicht verfügbar'}`} onClose={onClose} fallbackId="view-tab-projects">
    <p>Öffne die ADE-Arbeitskopie dieses Projekts. Anschliessend wählst du das CLI. Beim Öffnen startet noch kein Agent.</p>
    <details><summary>Workspace-Profil</summary><label>Profil für die Arbeitskopie<select aria-label="Profil für die Arbeitskopie" value={progress?.agentId ?? selected} disabled={busy || !!progress} onChange={(event) => setSelected(event.target.value)}>
      <option value="">Neues Standardprofil</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
    </select></label><p>Dieses Profil bestimmt die Arbeitskopie. Das CLI wählst du danach unabhängig davon.</p></details>
    {repo && (!repo.verified || repo.executionBackend !== 'native') && <p role="alert">Dieser Projekteinstieg benötigt ein am PC verifiziertes natives Repository. WSL-Agenten weiterhin über Overview öffnen.</p>}
    {!repo && <p role="alert">Das Projekt ist nicht mehr in ADE vorhanden. Projektliste aktualisieren.</p>}
    {host.status !== 'online' && <p role="status">PC nicht verbunden. Sobald er erreichbar ist, kannst du fortsetzen.</p>}
    {host.status === 'online' && !rights && <p role="status">Gerätefreigaben werden geprüft…</p>}
    {rights && !canRead && <p role="alert">Am PC für dieses Tablet „Workspace-Dateien und Git-Diffs lesen“ freigeben.</p>}
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">Workspace wird geöffnet…</p>}
    <button className="m-primary" disabled={busy || !canRead || host.status !== 'online' || !repo?.verified || repo.executionBackend !== 'native'} onClick={() => void prepare()}>
      {progress ? 'Workspace öffnen · fortsetzen' : 'Workspace öffnen'}</button>
    {progress && !busy && <button onClick={() => { save(null); setError(''); }}>Vorbereitung zurücksetzen · Dateien behalten</button>}
  </Dialog>;
}
