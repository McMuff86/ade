import { localizeAppMessage } from '../shared/i18n/appMessages';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useEffect, useRef, useState, type ComponentProps, type JSX } from 'react';
import type { MobileAdministrationResult, MobileHostState, MobileWorkspaceResult } from '../shared/remote';
import type { MobileHost } from './useMobileHost';
import { AgentWorkspace, workspaceError } from './AgentWorkspace';
import { useDeviceDraft } from './deviceDrafts';
import { Dialog } from './ui';
import { ProjectDirectoryPage, type ProjectOpenIntent } from './ProjectDirectoryPage';

export function Projects({ host, onProject, intent, onIntentConsumed }: { host: MobileHost; onProject: (id: string) => void; intent?: ProjectOpenIntent; onIntentConsumed?: () => void }): JSX.Element {
  useLocale();
  return <section className="m-project-entry" aria-label={translate("Projects")}>
    <ProjectDirectoryPage key={host.identityVersion} host={host} onAgentWorkspace={onProject} intent={intent} onIntentConsumed={onIntentConsumed} />
  </section>;
}

interface Preparation { key: string; agentId: string; phase: 'agent' | 'workspace' }
type WorkspaceProps = Pick<ComponentProps<typeof AgentWorkspace>, 'fileDrafts' | 'profileDrafts' | 'onManage'>;
/** Prepare only on an explicit click. Persist command receipts before sending, including across reloads. */
export function ProjectWorkspace({ host, repositoryId, onClose, onTask, ...workspaceProps }: WorkspaceProps & {
  host: MobileHost; repositoryId: string; onClose: () => void; onTask: (agentId: string) => void;
}): JSX.Element {
  useLocale();
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
    if (!save(value)) throw new Error(translate("Browser storage not available. Workspace has not been prepared any further."));
  };
  const prepare = async () => {
    if (lock.current || host.status !== 'online' || !canRead) return;
    lock.current = true; setBusy(true); setError('');
    let current = progress ?? { key: crypto.randomUUID(), agentId: selected, phase: selected ? 'workspace' as const : 'agent' as const };
    try {
      checkpoint(current);
      if (current.phase === 'agent') {
        if (!canPrepare) { setError(translate("Share on the PC for this tablet “Create Agents and Projects” to prepare a workspace profile.")); return; }
        const result = await host.request<MobileAdministrationResult>('/api/v1/admin/commands', 'POST', {
          operation: 'agent-create', input: { name: translate("Codex"), source: { kind: 'runtime', id: 'codex' } },
        }, `${current.key}-agent`);
        current = { ...current, agentId: result.created!.id, phase: 'workspace' }; checkpoint(current);
      }
      if (!live.current) return;
      const existing = await host.request<MobileWorkspaceResult>('/api/v1/workspace/query', 'POST', { operation: 'overview', agentId: current.agentId, repositoryId });
      if (!existing.overview?.ready) {
        if (!canPrepare) { setError(translate("Share on the PC for this tablet “Create Agents and Projects” to prepare the working copy.")); return; }
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
  return <Dialog title={translate("Project · {{value1}}", { value1: repo?.name ?? translate("Not available") })} onClose={onClose} fallbackId="view-tab-projects">
    <p>{translate("Open the ADE working copy of this project, then select the CLI, and no agent will start when you open it.")}</p>
    <details><summary>{translate("Workspace Profile")}</summary><label>{translate("Working copy profile")}<select aria-label={translate("Working copy profile")} value={progress?.agentId ?? selected} disabled={busy || !!progress} onChange={(event) => setSelected(event.target.value)}>
      <option value="" disabled={rights?.resourceSelection === 'selected'}>{translate("New default profile")}</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
    </select></label><p>{translate("This profile determines the working copy. The CLI you choose afterwards independently.")}</p></details>
    {repo && (!repo.verified || repo.executionBackend !== 'native') && <p role="alert">{translate("This project entry requires a PC verified native repository. WSL agents continue to open via Overview.")}</p>}
    {!repo && <p role="alert">{translate("The project is no longer present in ADE. Update project list.")}</p>}
    {host.status !== 'online' && <p role="status">{translate("PC not connected. Once it's available, you can continue.")}</p>}
    {host.status === 'online' && !rights && <p role="status">{translate("Checking device permissions…")}</p>}
    {rights && !canRead && <p role="alert">{translate("Share “Read Workspace Files and Git Diffs” on PC for this tablet.")}</p>}
    {error && <p role="alert">{localizeAppMessage(error)}</p>}
    {busy && <p role="status">{translate("Opening workspace…")}</p>}
    <button className="m-primary" disabled={busy || !canRead || host.status !== 'online' || !repo?.verified || repo.executionBackend !== 'native'} onClick={() => void prepare()}>
      {progress ? translate("Open workspace · Continue") : translate("Open workspace")}</button>
    {progress && !busy && <button onClick={() => { save(null); setError(''); }}>{translate("Reset preparation · Keeping files")}</button>}
  </Dialog>;
}
