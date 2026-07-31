/**
 * IPC channel registration (main side).
 * Config, identity/photos (B2), pty (B1) and git/fs (Phase C) handlers are all
 * real; the renderer codes against the full contract in shared/ipc.ts.
 */

import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { IPC, IPC_EVENTS, type IpcInvokeMap, type WorkspaceBundleMappings } from '../shared/ipc';
import type { Agent, GitStatus } from '../shared/types';
import { HARNESS_RUNTIMES, LAUNCH_PROFILES } from '../shared/runtimes';
import { NATIVE_EXECUTION_BACKEND, normalizeExecutionBackendId } from '../shared/executionBackends';
import type { ConfigStore } from './config/store';
import { importPhoto } from './photos';
import {
  createAgent,
  createAgentTemplate,
  createCategory,
  deleteAgent,
  deleteAgentTemplate,
  deleteCategory,
  moveAgent,
  reorderCategories,
  spawnAgentTemplate,
  updateAgent,
  updateCategory,
} from './identity';
import { PtyManager } from './pty/PtyManager';
import { isGitRepo } from './git/GitService';
import { readTaskActivity } from './orchestration/MailboxService';
import { OrchestrationService } from './orchestration/OrchestrationService';
import { RunCoordinator } from './orchestration/RunCoordinator';
import { diagnoseRuntimes } from './diagnostics/RuntimeDiagnostics';
import { assertIpcPayload } from './ipcValidation';
import { isTrustedRendererUrl } from './security';
import { RepositoryScopeService } from './repositories/RepositoryScopeService';
import { ExecutionBackendService } from './execution/ExecutionBackendService';
import { BackendGitService } from './execution/BackendGitService';
import { BackendWorkspaceService } from './execution/BackendWorkspaceService';
import { BackendWorkspaceFs } from './execution/BackendWorkspaceFs';
import { PublicationService } from './publishing/PublicationService';
import { HarnessCredentialService } from './settings/HarnessCredentialService';
import { RepositoryInspectorService } from './repositories/RepositoryInspectorService';
import { DashboardWindows } from './dashboard/DashboardWindows';
import { resolveDashboardUrl } from './dashboard/dashboardUrl';
import { AdeApplicationService } from './application/AdeApplicationService';
import { HostApiServer } from './remote/HostApiServer';
import { consumeHostApiConfig } from './remote/hostApiConfig';
import { TargetPathProbe } from './portability/TargetPathProbe';
import { WorkspaceImportService } from './portability/WorkspaceImportService';
import { ExecutionBackendHomeProvisioner } from './portability/ExecutionBackendHomeProvisioner';
import { WorkspaceBundleController } from './portability/WorkspaceBundleController';
import { exportWorkspaceBundle } from './portability/WorkspaceBundleExporter';
import { exportProfileWorkspaceBundle, openManagedProfileReader } from './portability/ProfileMigrationSource';
import { serializeWorkspaceBundle } from '../shared/workspaceBundle';

/** Live PTY sessions (Phase B1). Created lazily so tests can import this module. */
let ptyManager: PtyManager | null = null;
let orchestration: OrchestrationService | null = null;
let runCoordinator: RunCoordinator | null = null;
let hostApiServer: HostApiServer | null = null;

const packagedRendererUrl = pathToFileURL(join(__dirname, '../renderer/index.html')).toString();

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const frame = event.senderFrame;
  const trusted = owner
    && !owner.isDestroyed()
    && frame === event.sender.mainFrame
    && isTrustedRendererUrl(
      frame.url,
      process.env['ELECTRON_RENDERER_URL'],
      packagedRendererUrl,
    );
  if (!trusted) throw new Error('ade: rejected IPC from an untrusted renderer');
}

/** Typed ipcMain.handle wrapper: payload/result checked against IpcInvokeMap. */
function handle<K extends keyof IpcInvokeMap>(
  channel: K,
  handler: (
    payload: IpcInvokeMap[K]['req'],
  ) => IpcInvokeMap[K]['res'] | Promise<IpcInvokeMap[K]['res']>,
): void {
  ipcMain.handle(channel, (event, payload: unknown) => {
    assertTrustedSender(event);
    assertIpcPayload(channel, payload);
    return handler(payload);
  });
}

function handleWithEvent<K extends keyof IpcInvokeMap>(
  channel: K,
  handler: (
    payload: IpcInvokeMap[K]['req'],
    event: IpcMainInvokeEvent,
  ) => IpcInvokeMap[K]['res'] | Promise<IpcInvokeMap[K]['res']>,
): void {
  ipcMain.handle(channel, (event, payload: unknown) => {
    assertTrustedSender(event);
    assertIpcPayload(channel, payload);
    return handler(payload, event);
  });
}

export async function registerIpcHandlers(store: ConfigStore): Promise<void> {
  const execution = new ExecutionBackendService();
  const portabilityProfileDir = join(app.getPath('userData'), 'ade');
  const portabilityProbe = new TargetPathProbe({ hostPlatform: process.platform }, execution);
  const workspaceImport = new WorkspaceImportService({
    profileDir: portabilityProfileDir,
    store,
    probe: portabilityProbe,
    hostPlatform: process.platform,
    homeProvisioner: new ExecutionBackendHomeProvisioner(execution),
  });
  await workspaceImport.recoverPending();
  const workspaceBundles = new WorkspaceBundleController({
    store,
    probe: portabilityProbe,
    importer: workspaceImport,
    hostPlatform: process.platform,
  });
  const importSelections = new Map<string, {
    path: string;
    kind: 'bundle' | 'profile';
    ownerId: number;
    createdAt: number;
  }>();
  const mappingAuthorizations = new Map<string, {
    mappings: WorkspaceBundleMappings;
    ownerId: number;
    createdAt: number;
  }>();
  const previewOwners = new Map<string, number>();
  const importSelectionTtlMs = 10 * 60 * 1_000;
  const backendGit = new BackendGitService(execution);
  const backendWorkspaces = new BackendWorkspaceService(store, execution);
  const backendFs = new BackendWorkspaceFs(execution);
  const scopes = new RepositoryScopeService(store, { execution, git: backendGit, backendWorkspaces });
  const repositoryInspector = new RepositoryInspectorService(store, {
    commands: execution,
    git: backendGit,
  });
  orchestration = new OrchestrationService(store, (snapshot) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC_EVENTS.OrchestrationChanged, snapshot);
    }
  });
  const recoveredTasks = orchestration.recoverInterruptedTasks();
  if (recoveredTasks > 0) {
    console.warn(`[ade] recovered ${recoveredTasks} interrupted run task(s)`);
  }
  const recoveredPublications = orchestration.recoverInterruptedPublications();
  if (recoveredPublications > 0) {
    console.warn(`[ade] recovered ${recoveredPublications} interrupted publication(s)`);
  }
  runCoordinator = new RunCoordinator(store, orchestration, undefined, backendWorkspaces, scopes);
  const publications = new PublicationService(store, orchestration, backendWorkspaces, execution);
  const harnessCredentials = new HarnessCredentialService(app.getPath('userData'));
  ptyManager = new PtyManager(store, runCoordinator, scopes, execution, harnessCredentials);
  const application = new AdeApplicationService(
    store,
    orchestration,
    { status: () => ptyManager!.queueStatus() },
  );
  const hostApiConfig = consumeHostApiConfig(process.env);
  if (hostApiConfig.enabled) {
    hostApiServer = new HostApiServer(application, hostApiConfig.token, hostApiConfig.port);
    void hostApiServer.start()
      .then((address) => {
        console.log(`[ade] host API listening on ${address.host}:${address.port}`);
      })
      .catch((error) => {
        hostApiServer = null;
        console.error('[ade] host API failed to start:', error);
      });
  }
  runCoordinator.connect(
    (agentId, prompt, dispatchId, runTaskId, repositoryId, workspaceBindingId) =>
      ptyManager!.create(
        agentId,
        prompt,
        dispatchId,
        runTaskId,
        repositoryId,
        workspaceBindingId,
      ),
    (runTaskIds) => { ptyManager!.cancelTasks({ runTaskIds }); },
  );

  /** Resolve an agent by id or throw — every git/fs handler needs its dirs. */
  const requireAgent = (agentId: string): Agent => {
    const agent = store.get().agents.find((a) => a.id === agentId);
    if (!agent) throw new Error(`ade: agent not found "${agentId}"`);
    return agent;
  };
  const assertAgentNotLeased = (agentId: string): void => {
    const lease = orchestration!.snapshot().workspaceLeases.find(
      (candidate) => candidate.agentId === agentId && candidate.status === 'active',
    );
    if (lease) throw new Error(`ade: agent workspace is owned by active run ${lease.runId}`);
  };
  const workspaceTarget = (agentId: string, sessionId?: string): {
    agent: Agent;
    workspaceDir: string;
    executionBackend: ReturnType<typeof normalizeExecutionBackendId>;
  } => {
    const agent = requireAgent(agentId);
    if (!sessionId) {
      const descriptor = scopes.describe(agentId);
      return {
        agent,
        workspaceDir: descriptor.workspaceDir,
        executionBackend: descriptor.executionBackend,
      };
    }
    const session = ptyManager!.getSessionMeta(sessionId);
    if (!session || session.agentId !== agentId) {
      throw new Error(`ade: session does not belong to agent "${agentId}"`);
    }
    const descriptor = scopes.describe(agentId, session);
    return {
      agent,
      workspaceDir: session.workspaceDir ?? descriptor.workspaceDir,
      executionBackend: normalizeExecutionBackendId(
        session.executionBackend ?? descriptor.executionBackend,
      ),
    };
  };

  /* ------------------------------------------------------- config (real) */

  handle(IPC.ConfigGet, () => store.get());
  handle(IPC.ConfigSave, (partial) => store.save(partial));

  handleWithEvent(IPC.WorkspaceBundlePickImport, async (_payload, event) => {
    const e2eFixture = join(app.getPath('userData'), 'portable-e2e-workspace.json');
    let selectedPath: string | undefined;
    let kind: 'bundle' | 'profile' = 'bundle';
    if (process.env.NODE_ENV === 'test' && existsSync(e2eFixture)) {
      selectedPath = e2eFixture;
    } else {
      const source = await dialog.showMessageBox({
        type: 'question',
        title: 'Importquelle wählen',
        message: 'Möchtest du ein Workspace-Bundle oder ein vorhandenes ADE-Profil importieren?',
        buttons: ['Workspace-Bundle', 'ADE-Profilordner', 'Abbrechen'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });
      if (source.response === 2) return null;
      kind = source.response === 1 ? 'profile' : 'bundle';
      const result = await dialog.showOpenDialog({
        properties: kind === 'profile' ? ['openDirectory'] : ['openFile'],
        ...(kind === 'bundle' ? {
          filters: [{ name: 'ADE Workspace Bundle', extensions: ['json', 'ade-workspace'] }],
        } : {}),
      });
      if (!result.canceled) selectedPath = result.filePaths[0];
    }
    if (!selectedPath) return null;
    const now = Date.now();
    for (const [id, selection] of Array.from(importSelections.entries())) {
      if (selection.ownerId === event.sender.id || now - selection.createdAt > importSelectionTtlMs) {
        importSelections.delete(id);
      }
    }
    const selectionId = randomUUID();
    importSelections.set(selectionId, { path: selectedPath, kind, ownerId: event.sender.id, createdAt: now });
    return { selectionId, displayName: basename(selectedPath) };
  });
  handleWithEvent(IPC.WorkspaceBundleAuthorizeMappings, async ({ mappings }, event) => {
    const targets = [
      ...Object.entries(mappings.repositories).flatMap(([id, target]) => (
        target ? [`Repository ${id}: [${target.backend}] ${target.path}`] : []
      )),
      ...Object.entries(mappings.agentHomes).flatMap(([id, target]) => (
        target ? [`Agent home ${id}: [${target.backend}] ${target.path}`] : []
      )),
    ];
    if (process.env.NODE_ENV !== 'test') {
      const confirmation = await dialog.showMessageBox({
        type: 'warning',
        title: 'Importziele autorisieren',
        message: 'ADE darf bei diesem Import ausschließlich die folgenden Ziele verwenden:',
        detail: targets.length > 0 ? targets.join('\n') : 'Keine Dateisystemziele ausgewählt.',
        buttons: ['Abbrechen', 'Ziele autorisieren'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (confirmation.response !== 1) return null;
    }
    const now = Date.now();
    for (const [id, authorization] of Array.from(mappingAuthorizations.entries())) {
      if (authorization.ownerId === event.sender.id || now - authorization.createdAt > importSelectionTtlMs) {
        mappingAuthorizations.delete(id);
      }
    }
    const authorizationId = randomUUID();
    mappingAuthorizations.set(authorizationId, {
      mappings: structuredClone(mappings), ownerId: event.sender.id, createdAt: now,
    });
    return { authorizationId };
  });
  handleWithEvent(IPC.WorkspaceBundlePreview, ({ selectionId, mappingAuthorizationId }, event) => {
    const selection = importSelections.get(selectionId);
    if (!selection || selection.ownerId !== event.sender.id
        || Date.now() - selection.createdAt > importSelectionTtlMs) {
      importSelections.delete(selectionId);
      throw new Error('workspace import: selected bundle is missing or expired');
    }
    const authorization = mappingAuthorizations.get(mappingAuthorizationId);
    if (!authorization || authorization.ownerId !== event.sender.id
        || Date.now() - authorization.createdAt > importSelectionTtlMs) {
      mappingAuthorizations.delete(mappingAuthorizationId);
      throw new Error('workspace import: target authorization is missing or expired');
    }
    const mappings = structuredClone(authorization.mappings);
    const previewPromise = selection.kind === 'profile'
      ? workspaceBundles.previewBundle(exportProfileWorkspaceBundle(selection.path, {
        sourcePlatform: process.platform === 'win32' ? 'win32'
          : process.platform === 'darwin' ? 'darwin' : 'linux',
        includeMemory: false,
        includePhotos: false,
        repositoryRemote: () => null,
      }).bundle, mappings)
      : workspaceBundles.previewFile(selection.path, mappings);
    return previewPromise.then((preview) => {
      previewOwners.set(preview.sessionId, event.sender.id);
      while (previewOwners.size > 16) {
        previewOwners.delete(previewOwners.keys().next().value!);
      }
      return preview;
    });
  });
  handleWithEvent(IPC.WorkspaceBundleApply, async ({ sessionId, token }, event) => {
    if (previewOwners.get(sessionId) !== event.sender.id) {
      throw new Error('workspace import: preview session is not owned by this renderer');
    }
    try {
      return await workspaceBundles.apply(sessionId, token);
    } finally {
      previewOwners.delete(sessionId);
    }
  });
  handle(IPC.WorkspaceBundleExport, async ({ includeMemory, includePhotos }) => {
    if (process.platform !== 'linux' && (includeMemory || includePhotos)) {
      throw new Error('Memory and photo export is unavailable on this host because descriptor-safe managed-resource reads are not supported.');
    }
    const result = await dialog.showSaveDialog({
      defaultPath: `ade-workspace-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'ADE Workspace Bundle', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const config = store.get();
    const remotes = new Map<string, string>();
    for (const repository of config.repositories) {
      const remote = await execution.run(repository.executionBackend, 'git', [
        '-C', repository.rootPath, 'remote', 'get-url', 'origin',
      ], { timeoutMs: 15_000, maxBuffer: 64 * 1024 });
      if (remote.code === 0) remotes.set(repository.id, Buffer.from(remote.stdout).toString('utf8').trim());
    }
    const managedReader = process.platform === 'linux' && (includeMemory || includePhotos)
      ? openManagedProfileReader(portabilityProfileDir)
      : null;
    let exported: ReturnType<typeof exportWorkspaceBundle>;
    try {
      exported = exportWorkspaceBundle(config, {
      sourcePlatform: process.platform === 'win32' || process.platform === 'darwin' ? process.platform : 'linux',
      includeMemory,
      includePhotos,
      resources: {
        repositoryRemote: (repository) => remotes.get(repository.id) ?? null,
        photo: (file, maxBytes) => {
          const bytes = managedReader?.read(['photos', file], maxBytes) ?? null;
          if (!bytes) return null;
          const extension = extname(file).toLowerCase();
          const mime = extension === '.png' ? 'image/png'
            : extension === '.webp' ? 'image/webp'
              : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : null;
          return mime ? { bytes, mime } : null;
        },
        memory: (agentId, target, maxBytes) => {
          const agent = config.agents.find((candidate) => candidate.id === agentId);
          if (!agent) return null;
          const managedDir = resolve(portabilityProfileDir, 'agents', agent.id, 'memory');
          const configuredDir = resolve(agent.memoryDir);
          if (configuredDir !== managedDir || !configuredDir.startsWith(`${resolve(portabilityProfileDir)}${sep}`)) {
            return null;
          }
          return managedReader?.read(
            ['agents', agent.id, 'memory', target === 'memory' ? 'MEMORY.md' : 'USER.md'],
            maxBytes,
          ) ?? null;
        },
      },
      });
    } finally {
      managedReader?.close();
    }
    const serialized = serializeWorkspaceBundle(exported.bundle);
    const temporary = join(dirname(result.filePath), `.${Date.now()}-${process.pid}.workspace.tmp`);
    writeFileSync(temporary, serialized, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, result.filePath);
    return { path: result.filePath, notices: exported.warnings };
  });

  /* ------------------------------------------ identity + photos (Phase B2) */

  // Store photo bytes under userData/ade/photos/, served via ade-photo://
  handle(IPC.PhotoImport, (req) => importPhoto(req));

  // Create category; persists via ConfigStore.
  handle(IPC.CategoryCreate, (input) => createCategory(store, input, scopes));

  // Rename a category or set/remove its photo.
  handle(IPC.CategoryUpdate, (input) => updateCategory(store, input));

  // Stop every owned PTY before removing config entries. User files stay put.
  handle(IPC.CategoryDelete, ({ id }) => {
    const agentIds = store.get().agents
      .filter((agent) => agent.categoryId === id)
      .map((agent) => agent.id);
    for (const agentId of agentIds) assertAgentNotLeased(agentId);
    for (const agentId of agentIds) ptyManager!.killByAgent(agentId);
    deleteCategory(store, id);
  });

  // Rail drag & drop: persist the new category order.
  handle(IPC.CategoryReorder, ({ orderedIds }) => { reorderCategories(store, orderedIds); });

  // Rail drag & drop: reorder within a category or move across categories.
  handle(IPC.AgentMove, (request) => {
    const agent = requireAgent(request.agentId);
    if (agent.categoryId !== request.categoryId) assertAgentNotLeased(request.agentId);
    moveAgent(store, request);
  });

  // Create agent, workspace/worktree and memory scaffold.
  handle(IPC.AgentCreate, (input) => createAgent(store, input, scopes));

  // Resolve the agent dashboard (fixed URL or freshly minted by its command)
  // and open it origin-locked in an ADE window or the system browser.
  const dashboardWindows = new DashboardWindows();
  handle(IPC.AgentOpenDashboard, async ({ agentId }) => {
    const agent = requireAgent(agentId);
    const url = await resolveDashboardUrl(agent, execution);
    if (agent.dashboardTarget === 'external') {
      await shell.openExternal(url.toString());
      return { target: 'external' as const, origin: url.origin };
    }
    dashboardWindows.open(agent.id, agent.name, url);
    return { target: 'window' as const, origin: url.origin };
  });

  // Update runtime/launch configuration and display metadata for an agent.
  handle(IPC.AgentUpdate, (input) => {
    assertAgentNotLeased(input.id);
    return updateAgent(store, input, scopes);
  });

  handle(IPC.AgentSetDefaultRepository, ({ agentId, repositoryId }) =>
    scopes.setAgentDefault(agentId, repositoryId),
  );

  handle(IPC.AgentTemplateCreate, (input) => createAgentTemplate(store, input));
  handle(IPC.AgentTemplateDelete, ({ id }) => deleteAgentTemplate(store, id));
  handle(IPC.AgentTemplateSpawn, (input) => spawnAgentTemplate(store, input, scopes));
  handle(IPC.RepositoryImport, ({ path, name, executionBackend }) =>
    scopes.importRepository(path, name, executionBackend),
  );
  handle(IPC.RepositoryOverview, ({ repositoryId }) =>
    repositoryInspector.overview(repositoryId),
  );
  handle(IPC.RepositoryPullRequests, ({ repositoryId }) =>
    repositoryInspector.pullRequests(repositoryId),
  );
  handle(IPC.RepositoryPullRequestChecks, ({ repositoryId, pullRequestNumber }) =>
    repositoryInspector.pullRequestChecks(repositoryId, pullRequestNumber),
  );
  handle(IPC.HarnessStatus, () => ({
    keyStorageAvailable: harnessCredentials.available(),
    items: harnessCredentials.status(),
    serviceKeys: harnessCredentials.serviceKeyStatus(),
  }));
  handle(IPC.HarnessSetKey, ({ runtime, apiKey }) => {
    harnessCredentials.set(runtime, apiKey);
  });
  handle(IPC.HarnessClearKey, ({ runtime }) => {
    harnessCredentials.clear(runtime);
  });
  handle(IPC.HarnessSetServiceKey, ({ name, value, scope }) => {
    harnessCredentials.setServiceKey(name, value, scope);
  });
  handle(IPC.HarnessClearServiceKey, ({ name }) => {
    harnessCredentials.clearServiceKey(name);
  });
  handle(IPC.HarnessLogin, ({ agentId, runtime }) =>
    ptyManager!.createHarnessLogin(agentId, runtime),
  );
  // Harness-level readiness reuses the agent diagnostics with one synthetic
  // probe identity per first-class CLI; nothing is executed beyond the safe
  // version/auth commands and nothing is persisted.
  handle(IPC.HarnessDiagnose, () => diagnoseRuntimes(
    HARNESS_RUNTIMES.map((runtime): Agent => ({
      id: `harness-${runtime}`,
      categoryId: 'harness-probe',
      name: LAUNCH_PROFILES[runtime].label,
      runtime,
      permissionMode: 'default',
      workspaceDir: '',
      memoryDir: '',
    })),
    undefined,
    () => NATIVE_EXECUTION_BACKEND,
    execution,
  ));
  handle(IPC.RepositoryCommitDiff, ({ repositoryId, commitSha }) =>
    repositoryInspector.commitDiff(repositoryId, commitSha),
  );
  handle(IPC.WorkspaceDescribe, ({ agentId, sessionId }) => {
    const session = sessionId ? ptyManager!.getSessionMeta(sessionId) : undefined;
    if (sessionId && (!session || session.agentId !== agentId)) {
      throw new Error(`ade: session does not belong to agent "${agentId}"`);
    }
    return scopes.describe(agentId, session);
  });
  handle(IPC.WorkspaceRemoveBinding, ({ workspaceBindingId }) =>
    scopes.removeBinding(workspaceBindingId, {
      busyWorkspaceDirs: ptyManager!.list()
        .filter((session) => session.status === 'running' && session.workspaceDir)
        .map((session) => session.workspaceDir!),
    }));

  // Clipboard bridge: the renderer's navigator.clipboard is blocked by the
  // deny-all permission handlers, so terminal copy/paste goes through main.
  handle(IPC.ClipboardReadText, () => ({ text: clipboard.readText() }));
  handle(IPC.ClipboardWriteText, ({ text }) => { clipboard.writeText(text); });

  // Stop live/queued work, then remove config only (workspace files remain).
  handle(IPC.AgentDelete, ({ id }) => {
    assertAgentNotLeased(id);
    ptyManager!.killByAgent(id);
    deleteAgent(store, id);
  });

  /* --------------------------------------------------- pty (Phase B1) */

  // Interactive sessions spawn immediately; task sessions wait for a queue slot.
  handle(IPC.PtyCreate, ({
    agentId,
    task,
    dispatchId,
    runTaskId,
    repositoryId,
    workspaceBindingId,
  }) => ptyManager!.create(
    agentId,
    task,
    dispatchId,
    runTaskId,
    repositoryId,
    workspaceBindingId,
  ),
  );
  handle(IPC.WslList, () => execution.listWslDistributions());

  // Forward keystrokes to the session's pty
  handle(IPC.PtyWrite, ({ sessionId, dataBase64 }) => {
    ptyManager!.write(sessionId, Buffer.from(dataBase64, 'base64'));
  });

  // Phase B1: resize the session's pty to the fitted cols/rows
  handle(IPC.PtyResize, ({ sessionId, cols, rows }) => {
    ptyManager!.resize(sessionId, cols, rows);
  });

  // Phase B1: kill the session's pty (SIGHUP semantics via pty.kill())
  handle(IPC.PtyKill, ({ sessionId }) => ptyManager!.kill(sessionId));

  // Phase B1: ring-buffer replay so scrollback survives (re)attach
  handle(IPC.PtyAttach, ({ sessionId }) => ptyManager!.attach(sessionId));

  // Reconcile renderer state after a reload without losing main-owned PTYs.
  handle(IPC.PtyList, async () => {
    const snapshot = {
      sessions: ptyManager!.list(),
      taskQueue: ptyManager!.queueStatus(),
    };
    // E2E-only: hold a deliberately stale snapshot while exit/removal events
    // continue, proving renderer hydration merges those events before commit.
    const requestedDelay = Number(process.env['ADE_E2E_PTY_LIST_SNAPSHOT_DELAY_MS'] ?? 0);
    const delay = Number.isFinite(requestedDelay) ? Math.min(Math.max(requestedDelay, 0), 2_000) : 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    return snapshot;
  });

  // Cancel active and queued Graph tasks, optionally scoped to selected agents.
  handle(IPC.PtyCancelTasks, (request) => ptyManager!.cancelTasks(request));

  // Safe readiness checks only: version/auth commands never modify credentials.
  handle(IPC.RuntimeDiagnose, ({ agentId, sessionId }) => {
    const session = sessionId ? ptyManager!.getSessionMeta(sessionId) : undefined;
    if (sessionId && (!session || session.agentId !== agentId)) {
      throw new Error('ade: diagnostic session does not belong to the requested agent');
    }
    return diagnoseRuntimes(
      store.get().agents,
      agentId,
      (agent) => session && session.agentId === agent.id
        ? normalizeExecutionBackendId(session.executionBackend)
        : normalizeExecutionBackendId(
            agent.defaultRepositoryId
              ? store.get().repositories.find((repository) => repository.id === agent.defaultRepositoryId)
                ?.executionBackend
              : undefined,
          ),
      execution,
    );
  });

  /* ----------------------------------------------- runs/tasks (Goal 2) */

  handle(IPC.PtyActivitySnapshot, ({ sessionId }) => ptyManager!.activitySnapshot(sessionId));

  // Persisted feed of a managed task — readable after its session ended.
  handle(IPC.RunTaskActivity, ({ taskId }) => {
    const snapshot = orchestration!.snapshot();
    const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`ade: run task not found "${taskId}"`);
    const participant = snapshot.participants.find(
      (candidate) => candidate.id === task.participantId,
    );
    if (!participant) throw new Error(`ade: no participant for task "${taskId}"`);
    return { lines: readTaskActivity(requireAgent(participant.agentId), task.runId, task.id) };
  });

  handle(IPC.RunGet, () => orchestration!.snapshot());
  handle(IPC.RunGetSummary, ({ runId }) => application.runs(runId));
  handle(IPC.RunEvents, ({ sinceSeq, limit }) => orchestration!.eventsSince(sinceSeq, limit));
  handle(IPC.RunApprovalDiff, async ({ runId }) => {
    // Validated work commits behind the pending integration approval, read
    // from the leased worktrees; the DTO stays free of absolute host paths.
    const snapshot = orchestration!.snapshot();
    const participantName = new Map(snapshot.participants
      .filter((participant) => participant.runId === runId)
      .map((participant) => [participant.id, participant.agentName]));
    const workResults = snapshot.results
      .filter((result) => result.runId === runId && result.commitSha)
      .filter((result) => snapshot.tasks.some((task) =>
        task.id === result.taskId && task.phase === 'work'));
    const entries = [];
    for (const result of workResults) {
      const lease = snapshot.workspaceLeases
        .filter((candidate) => candidate.runId === runId
          && candidate.participantId === result.participantId)
        .sort((a, b) => b.acquiredAt - a.acquiredAt)[0];
      if (!lease?.isRepo) continue;
      const binding = lease.workspaceBindingId
        ? store.get().workspaceBindings.find((candidate) => candidate.id === lease.workspaceBindingId)
        : undefined;
      const commit = await backendGit.showCommit(
        normalizeExecutionBackendId(binding?.executionBackend),
        lease.workspaceDir,
        result.commitSha!,
      );
      entries.push({
        participantName: participantName.get(result.participantId) ?? 'Unbekannt',
        branch: lease.branch,
        commitSha: result.commitSha!,
        title: commit.title,
        files: commit.files,
        diff: commit.diff,
      });
    }
    return { runId, entries };
  });
  handle(IPC.RunPublicationPreview, ({ runId }) => publications.preview(runId));
  handle(IPC.RunPublish, (request) => publications.publish(request));
  handle(IPC.RunCreate, (input) => orchestration!.createRun(input));
  handle(IPC.RunDelete, ({ runId }) => runCoordinator!.deleteRun(runId));
  handle(IPC.RunTaskCreate, (input) => orchestration!.createTask(input));
  handle(IPC.RunStart, ({ runId, commandId }) => runCoordinator!.start(runId, commandId));
  handle(IPC.RunCancel, ({ runId, commandId }) =>
    runCoordinator!.cancel(runId, undefined, commandId),
  );
  handle(IPC.RunPauseTeam, ({ runId, teamId, commandId }) =>
    runCoordinator!.pauseTeam(runId, teamId, commandId),
  );
  handle(IPC.RunResumeTeam, ({ runId, teamId, commandId }) =>
    runCoordinator!.resumeTeam(runId, teamId, commandId),
  );
  handle(IPC.RunApprovalResolve, ({ approvalId, decision, commandId }) =>
    runCoordinator!.resolveApproval(approvalId, decision, commandId),
  );
  handle(IPC.RunTaskFail, ({ taskId, error }) => orchestration!.failTask(taskId, error));
  handle(IPC.RunArtifactCreate, (input) => orchestration!.createArtifact(input));

  /* ------------------------------------------------- git + fs (Phase C) */

  // Real git status for the agent's workspaceDir (non-repo → isRepo:false).
  handle(IPC.GitStatus, ({ agentId, sessionId }): Promise<GitStatus> =>
    (() => {
      const target = workspaceTarget(agentId, sessionId);
      return backendGit.status(target.executionBackend, target.workspaceDir);
    })(),
  );

  // Unified diff for one file (staged+unstaged vs HEAD; untracked = additions).
  handle(IPC.GitDiff, ({ agentId, sessionId, path }) => {
    const target = workspaceTarget(agentId, sessionId);
    return backendGit.diff(target.executionBackend, target.workspaceDir, path);
  });

  // Depth-limited workspace tree; `path` lazily expands one directory level.
  handle(IPC.FsTree, ({ agentId, sessionId, path }) => {
    const target = workspaceTarget(agentId, sessionId);
    return backendFs.tree(target.executionBackend, target.workspaceDir, path);
  });

  // Size-capped text read (workspace file, or a pinned file from memoryDir).
  handle(IPC.FsRead, ({ agentId, sessionId, path }) => {
    const { agent, workspaceDir, executionBackend } = workspaceTarget(agentId, sessionId);
    return backendFs.read(executionBackend, workspaceDir, agent.memoryDir, path);
  });

  // Pinned agent files (MEMORY/USER/CLAUDE/AGENTS) that exist for this agent.
  handle(IPC.FsAgentFiles, ({ agentId, sessionId }) => {
    const { agent, workspaceDir, executionBackend } = workspaceTarget(agentId, sessionId);
    return backendFs.agentFiles(executionBackend, workspaceDir, agent.memoryDir);
  });

  // Context-menu support: absolute location of a workspace/pinned file.
  handle(IPC.FsPathInfo, ({ agentId, sessionId, path }) => {
    const { agent, workspaceDir, executionBackend } = workspaceTarget(agentId, sessionId);
    return backendFs.pathInfo(executionBackend, workspaceDir, agent.memoryDir, path);
  });

  // Select the file in the OS file manager (workspace-validated path only).
  handle(IPC.FsReveal, async ({ agentId, sessionId, path }) => {
    const { agent, workspaceDir, executionBackend } = workspaceTarget(agentId, sessionId);
    const info = await backendFs.pathInfo(executionBackend, workspaceDir, agent.memoryDir, path);
    if (info.kind === 'missing') throw new Error(`ade: not found: "${path}"`);
    const hostPath = info.location === 'workspace' && executionBackend !== NATIVE_EXECUTION_BACKEND
      ? await execution.toHostPath(executionBackend, info.absolutePath)
      : info.absolutePath;
    shell.showItemInFolder(hostPath);
  });

  // Open with the OS default handler; user-initiated from the context menu.
  handle(IPC.FsOpenPath, async ({ agentId, sessionId, path }) => {
    const { agent, workspaceDir, executionBackend } = workspaceTarget(agentId, sessionId);
    const info = await backendFs.pathInfo(executionBackend, workspaceDir, agent.memoryDir, path);
    if (info.kind === 'missing') throw new Error(`ade: not found: "${path}"`);
    const hostPath = info.location === 'workspace' && executionBackend !== NATIVE_EXECUTION_BACKEND
      ? await execution.toHostPath(executionBackend, info.absolutePath)
      : info.absolutePath;
    const error = await shell.openPath(hostPath);
    if (error) throw new Error(`ade: could not open "${path}": ${error}`);
  });

  // Rename inside the workspace only (memoryDir scaffold stays untouchable).
  handle(IPC.FsRename, ({ agentId, sessionId, path, newName }) => {
    assertAgentNotLeased(agentId);
    const { workspaceDir, executionBackend } = workspaceTarget(agentId, sessionId);
    return backendFs.rename(executionBackend, workspaceDir, path, newName);
  });

  // Delete = synchronously quarantine, then move to OS trash (recoverable).
  handle(IPC.FsDelete, async ({ agentId, sessionId, path }) => {
    assertAgentNotLeased(agentId);
    const { workspaceDir, executionBackend } = workspaceTarget(agentId, sessionId);
    await backendFs.delete(
      executionBackend,
      workspaceDir,
      path,
      (quarantinedPath) => shell.trashItem(quarantinedPath),
    );
  });

  // Folder picker for repo-backed categories; validates the pick is a git repo.
  handle(IPC.DialogPickFolder, async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    const path = result.canceled ? null : (result.filePaths[0] ?? null);
    if (!path) return { path: null, isRepo: false };
    return { path, isRepo: await isGitRepo(path) };
  });
}

/** Kill every live pty — call on app quit so no orphan ConPTY lingers. */
export function disposePtyManager(): void {
  void hostApiServer?.stop().catch((error) => {
    console.warn('[ade] host API failed to stop cleanly:', error);
  });
  hostApiServer = null;
  ptyManager?.disposeAll();
  ptyManager = null;
  runCoordinator = null;
  orchestration = null;
}
