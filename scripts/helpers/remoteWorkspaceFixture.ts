import { join } from 'node:path';
import { createMobileFixture } from './mobileFixture';
import { AdeApplicationService } from '../../src/main/application/AdeApplicationService';
import { RemoteWorkspaceService } from '../../src/main/application/RemoteWorkspaceService';
import { RemoteWorkbenchService } from '../../src/main/application/RemoteWorkbenchService';
import { RemoteProfileService } from '../../src/main/application/RemoteProfileService';
import { PNG } from 'pngjs';
import { RemoteCommandLedger } from '../../src/main/application/RemoteCommandLedger';
import { HostRestartController } from '../../src/main/application/HostRestartController';
import { HostOperationGate } from '../../src/main/application/HostOperationGate';
import { RepositoryScopeService } from '../../src/main/repositories/RepositoryScopeService';
import { ProjectWorkspaceService } from '../../src/main/repositories/ProjectWorkspaceService';
import { ProjectBranchService } from '../../src/main/repositories/ProjectBranchService';
import { ProjectGitService } from '../../src/main/repositories/ProjectGitService';
import { RepositorySyncService } from '../../src/main/repositories/RepositorySyncService';
import { BackendWorkspaceService } from '../../src/main/execution/BackendWorkspaceService';
import { ExecutionBackendService } from '../../src/main/execution/ExecutionBackendService';
import { RunCoordinator } from '../../src/main/orchestration/RunCoordinator';
import { RuntimeAdapterRegistry } from '../../src/main/orchestration/runtimeAdapters';
import type { SessionMeta } from '../../src/shared/types';
import type { ActivityLine } from '../../src/shared/ipc';
import { RunInspectionService } from '../../src/main/application/RunInspectionService';

/** Real native Git scopes/domain/HTTP; runtime processes alone are deterministic fixtures. */
export function createRemoteWorkspaceFixture(root: string) {
  const fixture = createMobileFixture(root); const { store, devices, orchestration, changes } = fixture;
  store.save({ repositories: [] });
  const sessions: SessionMeta[] = [];
  const execution = new ExecutionBackendService(); const workspaces = new BackendWorkspaceService(store, execution);
  const scopes = new RepositoryScopeService(store, { baseDir: join(root, 'managed'), backendWorkspaces: workspaces, execution });
  const coordinator = new RunCoordinator(store, orchestration, new RuntimeAdapterRegistry(), workspaces, scopes);
  coordinator.connect(async (agentId, _prompt, _dispatch, taskId, repositoryId, workspaceBindingId) => {
    const scope = await scopes.resolve(agentId, { repositoryId, workspaceBindingId });
    const session: SessionMeta = { id: `session-${sessions.length + 1}`, agentId, title: 'Fixture', kind: 'task', status: 'running', createdAt: Date.now(),
      runTaskId: taskId, repositoryId: scope.repositoryId, workspaceBindingId: scope.workspaceBindingId,
      workspaceDir: scope.workspaceDir, executionBackend: scope.executionBackend };
    sessions.push(session); coordinator.onTaskStarted(taskId, session); return session;
  }, (ids) => { for (const id of ids) {
    const session = sessions.find((item) => item.runTaskId === id); if (session) session.status = 'exited';
    coordinator.onTaskFinished(id, 'cancelled', 130, 'Cancelled by fixture');
  } });
  const gate = new HostOperationGate();
  const ledger = new RemoteCommandLedger(join(root, 'remote', 'commands.json'), (entry) => devices.audit(entry),
    (id, scope) => devices.activeDevices().some((item) => item.id === id && item.scopes.includes(scope)));
  const projects = new ProjectWorkspaceService(store);
  const projectBranches = new ProjectBranchService(store, projects, () => sessions);
  const projectGit = new ProjectGitService(store, projects, () => sessions);
  const workbench = new RemoteWorkbenchService(store, () => sessions, execution, projects);
  const observations = new Map<string, { lines: ActivityLine[]; lastOutputAt?: number; outputBytes: number; structured: boolean }>();
  const inspection = new RunInspectionService(store, workbench, { getSessionMeta: (id) => sessions.find((item) => item.id === id),
    activitySnapshot: (id) => observations.get(id) ?? { lines: [], outputBytes: 0, structured: false } }, (id) => orchestration.report(id));
  const application = new AdeApplicationService(store, orchestration, { status: () => ({ active: sessions.filter((item) => item.status === 'running').length, queued: 0, maxActive: 4 }) }, {
    commands: { createRun: (input) => orchestration.createRun(input), startRun: (id, key) => coordinator.start(id, key),
      cancelRun: (id, key) => coordinator.cancel(id, undefined, key), submitTask: (input) => coordinator.submitSingleTask(input) },
    commandsEnabled: () => true, activity: gate, changes, audit: (entry) => devices.audit(entry),
    workbench, runInspection: inspection, projects, projectBranches, projectGit,
    deviceActive: (id) => devices.activeDevices().some((device) => device.id === id),
    profiles: new RemoteProfileService(store, join(root, 'photos'), (bytes) => PNG.sync.write(PNG.sync.read(bytes))),
    administration: { ledger, restart: new HostRestartController(gate, () => [], () => undefined, 'fixture', true),
      workspaces: new RemoteWorkspaceService(store, scopes, join(root, 'managed'), () => sessions, execution),
      git: new RepositorySyncService(store, () => sessions, execution) },
  });
  return { ...fixture, application, sessions, coordinator, workbench, ledger, gate, observations, inspection, projects, projectBranches, projectGit };
}
