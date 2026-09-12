import type { AdeConfig } from '../../shared/types';
import type { DeviceResourceAccess } from '../../shared/remoteDevices';
import type { MobileCatalog, MobileWorkspaceSelection } from '../../shared/remote';
import type { RemotePrincipal } from '../remote/authorization';
import { RemoteApiError } from './AdeApplicationService';

/** Read current grants on every check, including after asynchronous work. */
export class DeviceResourceService {
  constructor(private readonly store: { get(): AdeConfig },
    private readonly grants?: (deviceId: string) => DeviceResourceAccess) {}

  access(principal?: RemotePrincipal | string): DeviceResourceAccess {
    if (!principal || typeof principal !== 'string' && principal.kind !== 'device' || !this.grants) return { mode: 'all' };
    try { return this.grants(typeof principal === 'string' ? principal : principal.id); }
    catch { throw new RemoteApiError(401, 'unknown_device'); }
  }
  agent(principal: RemotePrincipal | string | undefined, id: string): boolean {
    const access = this.access(principal); return access.mode === 'all' || access.agentIds.includes(id);
  }
  repository(principal: RemotePrincipal | string | undefined, id: string): boolean {
    const access = this.access(principal); return access.mode === 'all' || access.repositoryIds.includes(id);
  }
  assertAgent(principal: RemotePrincipal | string, id: string): void { if (!this.agent(principal, id)) this.denied(); }
  assertRepository(principal: RemotePrincipal | string, id: string): void { if (!this.repository(principal, id)) this.denied(); }
  assertWorkspace(principal: RemotePrincipal | string, id: string): void {
    if (this.access(principal).mode === 'all') return;
    const workspace = this.store.get().projectWorkspaces.find((item) => item.id === id);
    if (!workspace) throw new RemoteApiError(404, 'not_found');
    this.assertRepository(principal, workspace.repositoryId);
  }
  assertSelection(principal: RemotePrincipal | string, selection: Partial<MobileWorkspaceSelection> & { profileId?: string }): void {
    if (selection.projectWorkspaceId) this.assertWorkspace(principal, selection.projectWorkspaceId);
    if (selection.agentId) this.assertAgent(principal, selection.agentId);
    if (selection.profileId) this.assertAgent(principal, selection.profileId);
    const repositoryId = selection.repositoryId === undefined && selection.agentId
      ? this.store.get().agents.find((item) => item.id === selection.agentId)?.defaultRepositoryId : selection.repositoryId;
    if (repositoryId) this.assertRepository(principal, repositoryId);
  }
  run(principal: RemotePrincipal | string | undefined, runId: string): boolean {
    if (this.access(principal).mode === 'all') return true;
    const config = this.store.get(); const run = config.runs.find((item) => item.id === runId);
    if (!run) return false;
    return (!run.repositoryId || this.repository(principal, run.repositoryId))
      && config.runParticipants.filter((item) => item.runId === runId).every((item) => this.agent(principal, item.agentId))
      && config.runTasks.filter((item) => item.runId === runId).every((item) => !item.repositoryId || this.repository(principal, item.repositoryId));
  }
  assertRun(principal: RemotePrincipal | string, runId: string): void { if (!this.run(principal, runId)) this.denied(); }
  assertAll(principal: RemotePrincipal | string): void { if (this.access(principal).mode !== 'all') this.denied(); }

  catalog(principal: RemotePrincipal | undefined, catalog: MobileCatalog): MobileCatalog {
    if (this.access(principal).mode === 'all') return catalog;
    const agents = catalog.agents.filter((item) => this.agent(principal, item.id)).map((item) => {
      const { defaultRepositoryId, ...rest } = item;
      return { ...rest, ...(defaultRepositoryId && this.repository(principal, defaultRepositoryId) ? { defaultRepositoryId } : {}) };
    });
    const categoryIds = new Set(this.store.get().agents.filter((item) => this.agent(principal, item.id)).map((item) => item.categoryId));
    return { ...catalog, agents, repositories: catalog.repositories.filter((item) => this.repository(principal, item.id)),
      categories: catalog.categories?.filter((item) => categoryIds.has(item.id)),
      agentSources: catalog.agentSources?.filter((item) => item.kind === 'runtime' || item.kind === 'agent' && this.agent(principal, item.id)),
      projectStart: catalog.projectStart ? { configured: catalog.projectStart.configured,
        ...(catalog.projectStart.agentId && this.agent(principal, catalog.projectStart.agentId) ? { agentId: catalog.projectStart.agentId } : {}) } : undefined };
  }
  private denied(): never { throw new RemoteApiError(403, 'scope_not_granted', 'Dieses Projekt oder dieser Agent ist für das Gerät nicht freigegeben. Am PC die Projektauswahl prüfen.'); }
}
