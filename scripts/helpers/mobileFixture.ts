/** Real application/coordinator with deterministic task launches and disposable workspaces. */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AdeApplicationService, JournalChangeHub } from '../../src/main/application/AdeApplicationService';
import { OrchestrationService } from '../../src/main/orchestration/OrchestrationService';
import { RunCoordinator } from '../../src/main/orchestration/RunCoordinator';
import { RuntimeAdapterRegistry } from '../../src/main/orchestration/runtimeAdapters';
import type { WorkspacePort } from '../../src/main/orchestration/WorkspaceService';
import { RemoteDeviceStore, type DeviceSecretProtection } from '../../src/main/remote/RemoteDeviceStore';
import { DEFAULT_CONFIG, type AdeConfig, type Agent, type SessionMeta } from '../../src/shared/types';

export const fixtureProtection: DeviceSecretProtection = { available: () => true,
  encrypt: (value) => Buffer.from(`fixture:${value}`), decrypt: (value) => value.toString().slice(8) };

export class MobileMemoryStore {
  constructor(public config: AdeConfig) {}
  get(): AdeConfig { return this.config; }
  save(partial: Partial<AdeConfig>): AdeConfig { return this.config = { ...this.config, ...structuredClone(partial) }; }
}
class FixtureWorkspaces implements WorkspacePort {
  async inspect(workspaceDir: string) { return { workspaceDir, isRepo: false, clean: true, branch: '', headSha: '', commonGitDir: '' }; }
  async validateCommit(_dir: string, _base: string, commit: string): Promise<string[]> { return [commit]; }
  async commitChanges(): Promise<string | null> { return null; }
  async integrateCommits(_dir: string, commits: string[]): Promise<number> { return commits.length; }
  async prepareDependencyBase(_dir: string, base: string): Promise<string> { return base; }
  async resetToBase(_dir: string, base: string, archiveRef: string) { return { previousHeadSha: base, headSha: base, archiveRef }; }
}

export function createMobileFixture(root: string) {
  const agents: Agent[] = ['Coordinator', 'Builder', 'Reviewer'].map((name) => ({ id: name.toLowerCase(), name, categoryId: 'category',
    runtime: 'custom', customCommand: 'fixture-agent', permissionMode: 'default', workspaceDir: join(root, name), memoryDir: join(root, 'memory', name) }));
  for (const agent of agents) { mkdirSync(agent.workspaceDir, { recursive: true }); mkdirSync(agent.memoryDir, { recursive: true }); }
  const store = new MobileMemoryStore({ ...structuredClone(DEFAULT_CONFIG), agents,
    categories: [{ id: 'category', name: 'Mobile fixture', agents: agents.map((agent) => agent.id) }],
    repositories: [{ id: 'repo', name: 'Mobile project', rootPath: join(root, 'private-repo'), commonGitDir: join(root, 'private-repo', '.git'),
      executionBackend: 'native', verified: true, createdAt: 1 }] });
  const devices = new RemoteDeviceStore(join(root, 'remote'), fixtureProtection);
  const changes = new JournalChangeHub();
  const orchestration = new OrchestrationService(store, () => changes.publish());
  const coordinator = new RunCoordinator(store, orchestration, new RuntimeAdapterRegistry(), new FixtureWorkspaces());
  const launched: string[] = [];
  coordinator.connect(async (agentId, _prompt, _dispatch, taskId) => {
    launched.push(taskId);
    const session: SessionMeta = { id: `session-${launched.length}`, agentId, title: 'Fixture', kind: 'task', status: 'running',
      createdAt: Date.now(), runTaskId: taskId, workspaceDir: join(root, agentId) };
    coordinator.onTaskStarted(taskId, session); return session;
  }, (ids) => { for (const id of ids) coordinator.onTaskFinished(id, 'cancelled', 130, 'Cancelled by fixture'); });
  const application = new AdeApplicationService(store, orchestration, { status: () => ({ active: 0, queued: 0, maxActive: 4 }) }, {
    commands: { createRun: (input) => orchestration.createRun(input), startRun: (id, key) => coordinator.start(id, key),
      cancelRun: (id, key) => coordinator.cancel(id, undefined, key), submitTask: (input) => coordinator.submitSingleTask(input) },
    changes, commandsEnabled: () => devices.activeDevices().length > 0, audit: (entry) => devices.audit(entry),
    resourceAccess: (id) => devices.resourceAccess(id),
  });
  return { store, devices, application, orchestration, coordinator, launched, changes };
}
