import { t as translate } from "../shared/i18n";
import { changeLocale } from '../shared/i18n';
import { OrganizerError } from './organizer/OrganizerStore';
import { ORGANIZER_REJECTED } from '../shared/organizer';
import { desktopNotifier } from './notifications';
import type { HostClient, HostEvents, ProfilePaths } from './host/ports';
import { DesktopClients } from './desktop/DesktopClients';
import { composeHost, type Host } from './host/composeHost';
import { photosDir } from './host/profilePaths';
import { desktopMicrophone } from './settings/desktopMicrophone';
import { desktopAppInfo, desktopImages, desktopPower, desktopRelaunch, desktopSecrets, desktopStartup } from './desktop/desktopPorts';
/**
 * IPC channel registration (main side).
 * Config, identity/photos (B2), pty (B1) and git/fs (Phase C) handlers are all
 * real; the renderer codes against the full contract in shared/ipc.ts.
 */

import { BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { IPC, IPC_EVENTS, type IpcInvokeMap } from '../shared/ipc';
import type { Agent, GitStatus } from '../shared/types';
import { HARNESS_RUNTIMES, LAUNCH_PROFILES } from '../shared/runtimes';
import { NATIVE_EXECUTION_BACKEND, normalizeExecutionBackendId } from '../shared/executionBackends';
import type { ConfigStore } from './config/store';
import { CONVERSATION_NOT_ACCEPTED } from '../shared/conversation';
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
import { isGitRepo } from './git/GitService';
import { readTaskActivity } from './orchestration/MailboxService';
import { diagnoseRuntimes } from './diagnostics/RuntimeDiagnostics';
import { assertIpcPayload } from './ipcValidation';
import { assertChannelPolicy } from './ipcPolicy';
import { redactedErrorDetail, toIpcError } from './errors';
import { broadcastToRenderers, isRendererWindow, rendererWindows } from './rendererWindows';
import { isTrustedRendererUrl } from './security';
import { DashboardWindows } from './dashboard/DashboardWindows';
import { resolveDashboardUrl } from './dashboard/dashboardUrl';
import { validateFileSave } from './application/RemoteWorkbenchService';
import { projectOverview } from './overview/projectOverview';
import { attentionOverview } from './overview/attentionOverview';
import { listClones, matchClones } from './portability/CloneFinder';
import { exportWorkspaceBundle } from './portability/WorkspaceBundleExporter';
import { openManagedProfileReader } from './portability/ProfileMigrationSource';
import { buildProfileImportBundle } from './portability/ProfileImportPreview';
import { managedProfileSupport } from './portability/managed/ManagedHost';
import { serializeWorkspaceBundle } from '../shared/workspaceBundle';

/** The host composed for this desktop; null before startup. */
let host: Host | null = null;

const packagedRendererUrl = pathToFileURL(join(__dirname, '../renderer/index.html')).toString();
/** The desktop's HostEvents: main→renderer only through rendererWindows.ts. */
const rendererEvents: HostEvents = { emit: broadcastToRenderers };

/**
 * A sender is trusted only when it is the main frame of a *registered* ADE
 * renderer window on the trusted URL. Dashboard windows (arbitrary https
 * origins, no preload) fail the registry check regardless of their URL.
 */
function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const frame = event.senderFrame;
  const trusted = isRendererWindow(owner)
    && frame === event.sender.mainFrame
    && isTrustedRendererUrl(
      frame.url,
      process.env['ELECTRON_RENDERER_URL'],
      packagedRendererUrl,
    );
  if (!trusted) throw new Error('ade: rejected IPC from an untrusted renderer');
}

/**
 * Typed ipcMain.handle wrapper. Every call passes sender trust, payload
 * validation, the channel's privilege policy (audit line for launch/shell/host
 * effects) and — on failure — the redaction funnel, so a handler error never
 * carries backend stderr or a credential verbatim into the renderer.
 */
const CATALOG_MUTATIONS = new Set<keyof IpcInvokeMap>([
  'config:save', 'category:create', 'category:update', 'category:delete', 'category:reorder',
  'agent:create', 'agent:update', 'agent:delete', 'agent:move', 'agent:setDefaultRepository',
  'agentTemplate:create', 'agentTemplate:delete', 'agentTemplate:spawn', 'repository:import',
  'workspace:removeBinding', 'workspaceBundle:apply',
]);
function handleWithEvent<K extends keyof IpcInvokeMap>(
  channel: K,
  handler: (
    payload: IpcInvokeMap[K]['req'],
    event: IpcMainInvokeEvent,
  ) => IpcInvokeMap[K]['res'] | Promise<IpcInvokeMap[K]['res']>,
): void {
  const policy = assertChannelPolicy(channel);
  ipcMain.handle(channel, async (event, payload: unknown) => {
    assertTrustedSender(event);
    assertIpcPayload(channel, payload);
    if (policy.audit) console.log(`[ade] ipc ${channel} effect=${policy.effect}`);
    try {
      const result = policy.effect === 'read' ? await handler(payload, event)
        : await host!.hostOperations.use(() => handler(payload, event), channel === IPC.RemoteDevicesRevoke || channel === IPC.RemoteDevicesSetAdminScopes);
      if (CATALOG_MUTATIONS.has(channel)) broadcastToRenderers(IPC_EVENTS.CatalogChanged, { revision: Date.now() });
      return result;
    } catch (error) {
      console.error(`[ade] ipc ${channel} failed:`, redactedErrorDetail(error));
      throw toIpcError(error);
    }
  });
}

/** Desktop renderers as host clients: client-bound state is owned by a random id, not sender.id. */
const desktopClients = new DesktopClients();
function handleWithClient<K extends keyof IpcInvokeMap>(
  channel: K,
  handler: (
    payload: IpcInvokeMap[K]['req'],
    client: HostClient,
  ) => IpcInvokeMap[K]['res'] | Promise<IpcInvokeMap[K]['res']>,
): void {
  handleWithEvent(channel, (payload, event) => handler(payload, desktopClients.for(event.sender)));
}

function handle<K extends keyof IpcInvokeMap>(
  channel: K,
  handler: (
    payload: IpcInvokeMap[K]['req'],
  ) => IpcInvokeMap[K]['res'] | Promise<IpcInvokeMap[K]['res']>,
): void {
  handleWithEvent(channel, (payload) => handler(payload));
}

export async function registerIpcHandlers(store: ConfigStore, paths: ProfilePaths): Promise<void> {
  host = await composeHost(store, { events: rendererEvents, notifier: desktopNotifier, images: desktopImages, secrets: desktopSecrets,
    power: desktopPower, startup: desktopStartup(), relaunch: desktopRelaunch, app: desktopAppInfo(), paths });
  const live = host;
  const {
    actionService,
    agentBehavior,
    application,
    assertAgentNotLeased,
    backendFs,
    backendGit,
    conversationService,
    diagnoseConfigured,
    execution,
    harnessCredentials,
    hostOperations,
    importRecoveryFailure,
    importSelectionTtlMs,
    importSelections,
    integration,
    mappingAuthorizations,
    organizer,
    portabilityProfileDir,
    previewOwners,
    projectBranches,
    projectDefaults,
    projectGitActions,
    projectPublish,
    projects,
    publications,
    recordings,
    remoteDevices,
    replies,
    replyOwners,
    repositoryInspector,
    repositorySync,
    requireAgent,
    runInspection,
    runQuestions,
    runtimeModels,
    scopes,
    speech,
    speechPreferences,
    supervisionService,
    workbench,
    workspaceBundles,
    workspaceProvision,
    workspaceTarget,
  } = host;
  // Resolve the agent dashboard (fixed URL or freshly minted by its command)
  // and open it origin-locked in an ADE window or the system browser.
  const dashboardWindows = new DashboardWindows();

  handle(IPC.HostOperationGet, () => live.hostOperation!.status());
  handle(IPC.HostOperationChange, input => live.hostOperation!.change(input));
  handleWithClient(IPC.SpeechReply, (input, client) => {
    const owner = `desktop:${client.id}`;
    if (input.operation === 'prepare') {
      if (!replyOwners.has(client.id)) {
        const id = client.id; replyOwners.add(id);
        client.onClose(() => { replies.revoke(owner); replyOwners.delete(id); });
      }
      const session = live.ptyManager?.getSessionMeta(input.sessionId);
      const authorize = () => {
        const current = live.ptyManager?.getSessionMeta(input.sessionId);
        if (!client.alive() || !session || !current || current.kind !== 'interactive' || current.runTaskId || current.remoteAccessBlocked
          || current.agentId !== session.agentId || current.repositoryId !== session.repositoryId) throw new Error(translate("This terminal session is no longer available."));
      };
      return replies.prepare(owner, { text: input.text, source: input.source, mode: input.mode }, Object.assign(authorize, {
        usage: { terminalSessionId: session?.id, agentId: session?.agentId, repositoryId: session?.repositoryId ?? undefined },
      }));
    }
    if (input.operation === 'read') return replies.read(owner, input.replyId);
    if (input.operation === 'cancel') return replies.cancel(owner, input.replyId);
    return hostOperations.use(() => replies.speak(owner, input.replyId));
  });
  handle(IPC.OrganizerQuery, input => organizer.query(input, 'desktop'));
  handle(IPC.OrganizerCommand, input => {
    try { return organizer.command(input, 'desktop'); }
    catch (error) {
      if (error instanceof OrganizerError && error.code !== 'unavailable') throw new Error(ORGANIZER_REJECTED + redactedErrorDetail(error));
      throw error;
    }
  });
  handle(IPC.SupervisionGet, () => supervisionService().query());
  handle(IPC.SupervisionDetail, ({ projectId }) => supervisionService().detail(projectId));
  handle(IPC.SupervisionCommand, input => supervisionService().command(input));
  handle(IPC.SupervisionBriefing, () => supervisionService().briefing());
  handle(IPC.SupervisionHandoff, ({ projectId, handoffId }) => supervisionService().handoff(projectId, handoffId));
  handle(IPC.ConversationGet, () => conversationService().query());
  handle(IPC.ConversationDetail, ({ conversationId }) => conversationService().detail(conversationId));
  handle(IPC.ConversationActionsQuery, input => {
    conversationService().detail(input.conversationId);
    return input.operation === 'list' ? actionService().list(input.conversationId)
      : input.operation === 'detail' ? actionService().detail(input.conversationId, input.actionId) : actionService().work(input.conversationId, input.actionId);
  });
  handle(IPC.ConversationActionsCommand, input => actionService().command(input));
  handle(IPC.ConversationCommand, input => {
    const result = conversationService().admit(input);
    if (!result.accepted) throw new Error(`${result.uncertain ? '' : CONVERSATION_NOT_ACCEPTED}${result.error}`);
    return result.receipt;
  });
  handle(IPC.AgentBehaviorGet, ({ agentId }) => agentBehavior.query(agentId));
  handle(IPC.AgentBehaviorSet, (input) => agentBehavior.update(input));
  handle(IPC.HarnessModels, (request) => runtimeModels.list(request));
  handle(IPC.RemoteDevicesList, () => remoteDevices.inventory());
  handle(IPC.RemoteDevicesRename, ({ deviceId, name }) => remoteDevices.rename(deviceId, name));
  handle(IPC.RemoteDevicesRevoke, ({ deviceId }) => remoteDevices.revoke(deviceId));
  handle(IPC.RemoteDevicesSetAdminScopes, ({ deviceId, scopes: grants, resourceAccess }) => remoteDevices.setAdminScopes(deviceId, grants, resourceAccess));
  handle(IPC.ProjectCreate, async (input) => {
    if (!store.get().settings.projectDefaults) throw new Error(translate("ade: Under Settings, save the project root folder first."));
    const result = await workspaceProvision.execute({ operation: 'project-create', input });
    broadcastToRenderers(IPC_EVENTS.CatalogChanged, { revision: Date.now() });
    return { repositoryId: result.created!.id };
  });
  handle(IPC.IntegrationQuery, (input) => integration.query(input, 'desktop'));
  handle(IPC.IntegrationCommand, (input) => integration.command(input, 'desktop'));
  handle(IPC.ProjectFileRead, (input) => workbench.query({ ...input, operation: 'file' }));
  handle(IPC.ProjectFileSave, async (input) => ({ ...await workbench.save(validateFileSave(input), () => undefined), replayed: false }));
  handle(IPC.ProjectWorkspaceQuery, async (input) => input.operation === 'directory'
    ? { directory: await projects.directory() }
      : input.operation === 'run-results' ? { runResults: runInspection.projectRuns((await projects.overview(input.workspaceId)).repositoryId, input.cursor) }
      : input.operation === 'publish-status' ? { publish: await projectPublish.status(input.workspaceId, input.remote) }
      : input.operation === 'publish-preview' ? { publishPreview: await projectPublish.preview(input.workspaceId, input.action, 'desktop') }
      : input.operation === 'git' ? { git: await projectGitActions.overview(input.workspaceId) }
      : input.operation === 'git-diff' ? { gitDiff: await projectGitActions.diff(input.workspaceId, input.path) }
        : input.operation === 'git-preview' ? { gitPreview: await projectGitActions.preview(input.workspaceId, input.action, 'desktop') }
    : input.operation === 'branches' ? { branches: await projectBranches.overview(input.workspaceId) }
      : input.operation === 'branch-preview' ? { preview: await projectBranches.preview(input.workspaceId, input.action, 'desktop') } : { workspace: await projects.overview(input.workspaceId) });
  handle(IPC.ProjectWorkspaceCommand, async (input) => {
    if (input.operation === 'git-apply') { const git = await projectGitActions.apply(input.previewId, 'desktop'); return { workspace: git.workspace, git, replayed: false }; }
    if (input.operation === 'publish-apply') return { ...await projectPublish.apply(input.previewId, 'desktop'), replayed: false };
    return { workspace: input.operation === 'open' ? await projects.open(input.entryId) : await projectBranches.apply(input.previewId, 'desktop'), replayed: false };
  });
  handle(IPC.ProjectMembership, (input) => projects.membership(input.entryId, input.included));
  handle(IPC.ProjectRemoveMissing, (input) => projects.removeMissing(input.repositoryId));
  handle(IPC.MobileAccessStatus, () => live.mobileAccess!.status());
  handle(IPC.MobileAccessSetEnabled, ({ enabled, httpsPort }) => live.mobileAccess!.setEnabled(enabled, httpsPort));
  handle(IPC.MobileAccessPair, () => live.mobileAccess!.beginPairing());
  handle(IPC.MobileAccessCancelPair, () => live.mobileAccess!.cancelPairing());

  /* ------------------------------------------------------- config (real) */

  handle(IPC.ConfigGet, () => store.get());

  // Startup integrity of the persisted config. The renderer must be able to
  // tell an empty catalog apart from a quarantined one.
  handle(IPC.ConfigHealth, () => ({ loadFailure: store.getLoadFailure(), importRecoveryFailure }));
  handle(IPC.ConfigSave, (partial) => { const config = store.save(partial); if (config.settings.language) changeLocale(config.settings.language); return config; });
  handle(IPC.ProjectDefaultsGet, () => projectDefaults.get());
  handle(IPC.ProjectDefaultsSave, (input) => projectDefaults.save(input));

  handleWithClient(IPC.WorkspaceBundlePickImport, async (_payload, client) => {
    const e2eFixture = join(paths.userData, 'portable-e2e-workspace.json');
    let selectedPath: string | undefined;
    let kind: 'bundle' | 'profile' = 'bundle';
    if (process.env.NODE_ENV === 'test' && existsSync(e2eFixture)) {
      selectedPath = e2eFixture;
    } else {
      const source = await dialog.showMessageBox({
        type: 'question',
        title: translate("Choose import source"),
        message: translate("Do you want to import a workspace bundle or an existing ADE profile?"),
        buttons: ['Workspace-Bundle', 'ADE-Profilordner', translate("Cancel")],
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
      if (selection.ownerId === client.id || now - selection.createdAt > importSelectionTtlMs) {
        importSelections.delete(id);
      }
    }
    const selectionId = randomUUID();
    importSelections.set(selectionId, { path: selectedPath, kind, ownerId: client.id, createdAt: now });
    return { selectionId, displayName: basename(selectedPath) };
  });
  handleWithClient(IPC.WorkspaceBundleAuthorizeMappings, async ({ mappings }, client) => {
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
        title: translate("Authorize import targets"),
        message: translate("ADE may use only the following destinations for this import:"),
        detail: targets.length > 0 ? targets.join('\n') : translate("No file system destinations selected."),
        buttons: [translate("Cancel"), translate("Authorize targets")],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (confirmation.response !== 1) return null;
    }
    const now = Date.now();
    for (const [id, authorization] of Array.from(mappingAuthorizations.entries())) {
      if (authorization.ownerId === client.id || now - authorization.createdAt > importSelectionTtlMs) {
        mappingAuthorizations.delete(id);
      }
    }
    const authorizationId = randomUUID();
    mappingAuthorizations.set(authorizationId, {
      mappings: structuredClone(mappings), ownerId: client.id, createdAt: now,
    });
    return { authorizationId };
  });
  handleWithClient(IPC.WorkspaceBundlePreview, ({ selectionId, mappingAuthorizationId }, client) => {
    const selection = importSelections.get(selectionId);
    if (!selection || selection.ownerId !== client.id
        || Date.now() - selection.createdAt > importSelectionTtlMs) {
      importSelections.delete(selectionId);
      throw new Error('workspace import: selected bundle is missing or expired');
    }
    const authorization = mappingAuthorizations.get(mappingAuthorizationId);
    if (!authorization || authorization.ownerId !== client.id
        || Date.now() - authorization.createdAt > importSelectionTtlMs) {
      mappingAuthorizations.delete(mappingAuthorizationId);
      throw new Error('workspace import: target authorization is missing or expired');
    }
    const mappings = structuredClone(authorization.mappings);
    const previewPromise = selection.kind === 'profile'
      ? buildProfileImportBundle(selection.path, {
        sourcePlatform: process.platform === 'win32' ? 'win32'
          : process.platform === 'darwin' ? 'darwin' : 'linux',
        resolveRemote: async (repository) => {
          const remote = await execution.run(repository.executionBackend, 'git', [
            '-C', repository.rootPath, 'remote', 'get-url', 'origin',
          ], { timeoutMs: 15_000, maxBuffer: 64 * 1024 });
          // A profile copied from another machine names paths this host may
          // not have; that costs the origin check for one repository rather
          // than the import.
          return remote.code === 0 ? Buffer.from(remote.stdout).toString('utf8').trim() : null;
        },
      }).then((exported) => workspaceBundles.previewBundle(exported.bundle, mappings))
      : workspaceBundles.previewFile(selection.path, mappings);
    return previewPromise.then((preview) => {
      // Sliding expiry: the selection lapses 10 minutes after the last
      // successful preview, not after the pick. Assigning seven repositories
      // by hand took longer than that and lost every typed path.
      selection.createdAt = Date.now();
      previewOwners.set(preview.sessionId, client.id);
      while (previewOwners.size > 16) {
        previewOwners.delete(previewOwners.keys().next().value!);
      }
      return preview;
    });
  });
  handleWithClient(IPC.WorkspaceBundleFindClones, async ({ sessionId }, client) => {
    if (previewOwners.get(sessionId) !== client.id) {
      throw new Error('workspace import: preview session is not owned by this renderer');
    }
    const candidates = workspaceBundles.repositoryCandidates(sessionId);
    const e2eRoot = process.env.NODE_ENV === 'test' ? process.env['ADE_E2E_CLONE_ROOT'] : undefined;
    let root = e2eRoot;
    if (!root) {
      const focused = BrowserWindow.getFocusedWindow();
      const win = (isRendererWindow(focused) ? focused : null) ?? rendererWindows()[0] ?? null;
      const options: Electron.OpenDialogOptions = {
        title: translate("Folder with your clones"),
        properties: ['openDirectory'],
        ...(store.get().settings.projectDefaults?.rootPath
          ? { defaultPath: store.get().settings.projectDefaults!.rootPath } : {}),
      };
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      root = result.canceled ? undefined : result.filePaths[0];
    }
    if (!root) return null;
    const clones = await listClones(root, async (path) => {
      const remote = await execution.run(NATIVE_EXECUTION_BACKEND, 'git', [
        '-C', path, 'remote', 'get-url', 'origin',
      ], { timeoutMs: 15_000, maxBuffer: 64 * 1024 });
      return remote.code === 0 ? Buffer.from(remote.stdout).toString('utf8').trim() : null;
    });
    return { root, clonesFound: clones.length, matches: matchClones(candidates, clones) };
  });
  handleWithClient(IPC.WorkspaceBundleApply, async ({ sessionId, token }, client) => {
    if (previewOwners.get(sessionId) !== client.id) {
      throw new Error('workspace import: preview session is not owned by this renderer');
    }
    try {
      return await workspaceBundles.apply(sessionId, token);
    } finally {
      previewOwners.delete(sessionId);
    }
  });
  handle(IPC.WorkspaceBundleExport, async ({ includeMemory, includePhotos }) => {
    if (!managedProfileSupport(process.platform).managedAssets && (includeMemory || includePhotos)) {
      throw new Error('Memory and photo export is unavailable on this host because ADE cannot address managed profile resources safely here.');
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
    const managedReader = managedProfileSupport(process.platform).managedAssets && (includeMemory || includePhotos)
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
  handle(IPC.PhotoImport, (req) => importPhoto(req, photosDir(paths)));

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
    for (const agentId of agentIds) live.ptyManager!.killByAgent(agentId);
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
  handle(IPC.AgentCreate, (input) => createAgent(store, input, scopes, { baseDir: paths.profileDir }));
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
  handle(IPC.AgentTemplateSpawn, (input) => spawnAgentTemplate(store, input, scopes, { baseDir: paths.profileDir }));
  handle(IPC.RepositoryImport, ({ path, name, executionBackend }) =>
    scopes.importRepository(path, name, executionBackend),
  );
  handle(IPC.RepositoryOverview, ({ repositoryId }) =>
    repositoryInspector.overview(repositoryId),
  );
  handle(IPC.RepositorySyncOverview, (input) => repositorySync.overview(input));
  handle(IPC.RepositoryFetch, ({ repositoryId }) => repositorySync.fetch(repositoryId));
  handle(IPC.RepositorySyncPreview, (input) => repositorySync.preview(input));
  handle(IPC.RepositorySyncApply, ({ previewId }) => repositorySync.apply(previewId));
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
  handle(IPC.SpeechVoices, () => speech.catalog(true));
  handle(IPC.SpeechSelect, ({ voiceId }) => speech.select(voiceId));
  handle(IPC.SpeechTest, ({ voiceId, preset, tuning, studio }) => speech.test(voiceId, undefined, undefined, preset, tuning, studio));
  handle(IPC.SpeechPreferences, (target) => speechPreferences.query(target, true));
  handle(IPC.SpeechConfigure, (input) => speechPreferences.select(input));
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
    live.ptyManager!.createHarnessLogin(agentId, runtime),
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
    {
      hasStoredKey: (runtime) => harnessCredentials.status()
        .some((item) => item.runtime === runtime && item.hasStoredKey),
    },
  ));
  handle(IPC.RepositoryCommitDiff, ({ repositoryId, commitSha }) =>
    repositoryInspector.commitDiff(repositoryId, commitSha),
  );
  handle(IPC.WorkspaceDescribe, ({ agentId, sessionId }) => {
    const session = sessionId ? live.ptyManager!.getSessionMeta(sessionId) : undefined;
    if (sessionId && (!session || session.agentId !== agentId)) {
      throw new Error(`ade: session does not belong to agent "${agentId}"`);
    }
    return scopes.describe(agentId, session);
  });
  handle(IPC.WorkspaceRemoveBinding, ({ workspaceBindingId }) =>
    scopes.removeBinding(workspaceBindingId, {
      busyWorkspaceDirs: live.ptyManager!.list()
        .filter((session) => session.status === 'running' && session.workspaceDir)
        .map((session) => session.workspaceDir!),
    }));

  // Clipboard bridge: the renderer's navigator.clipboard is blocked by the
  // deny-all permission handlers, so terminal copy/paste goes through main.
  handle(IPC.ClipboardReadText, () => ({ text: clipboard.readText() }));
  handle(IPC.ClipboardWriteText, ({ text }) => { clipboard.writeText(text); });

  // Stop live/queued work, then remove config only (workspace files remain).
  handle(IPC.AgentDelete, async ({ id }) => {
    assertAgentNotLeased(id);
    live.ptyManager!.killByAgent(id);
    deleteAgent(store, id);
    // The dashboard partition (cookies, storage, cache) belongs to the agent
    // identity; it must not outlive it on disk.
    await dashboardWindows.forget(id);
  });

  /* --------------------------------------------------- pty (Phase B1) */
  handle(IPC.SessionOptions, (selection) => live.ptyManager!.sessionOptions(selection));
  handle(IPC.SessionLaunch, (input) => input.terminalHome
    ? live.ptyManager!.createHomeInteractive(input.mode === 'ollama' ? { mode: input.mode, model: input.model } : { mode: input.mode })
    : input.projectWorkspaceId
    ? live.ptyManager!.createProjectInteractive(input.projectWorkspaceId, input.expectedBranch!, input.mode === 'ollama' ? { mode: input.mode, model: input.model } : { mode: input.mode }, input.profileId)
    : live.ptyManager!.createRemoteInteractive(input.agentId!, input.repositoryId!, input.workspaceBindingId, input.mode, input.mode === 'ollama' ? input.model : undefined));

  // Interactive sessions spawn immediately; task sessions wait for a queue slot.
  handle(IPC.PtyCreate, ({
    agentId,
    task,
    dispatchId,
    runTaskId,
    repositoryId,
    workspaceBindingId,
  }) => live.ptyManager!.create(
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
    if (!live.remoteTerminals!.desktopMayWrite(sessionId)) throw new Error(translate("ade: This terminal is controlled remotely. Take control of input on the desktop first."));
    live.ptyManager!.write(sessionId, Buffer.from(dataBase64, 'base64'));
  });

  // Phase B1: resize the session's pty to the fitted cols/rows
  handle(IPC.PtyResize, ({ sessionId, cols, rows }) => {
    if (!live.remoteTerminals!.desktopMayWrite(sessionId)) return;
    live.ptyManager!.resize(sessionId, cols, rows);
  });

  // Phase B1: kill the session's pty (SIGHUP semantics via pty.kill())
  handle(IPC.PtyKill, ({ sessionId }) => live.ptyManager!.kill(sessionId));

  // Phase B1: ring-buffer replay so scrollback survives (re)attach
  handle(IPC.PtyAttach, ({ sessionId }) => live.ptyManager!.attach(sessionId));
  handle(IPC.TerminalControl, ({ sessionId }) => live.remoteTerminals!.desktopState(sessionId));
  handle(IPC.TerminalUsage, ({ sessionId }) => live.ptyManager!.subscriptionUsage(sessionId));
  handle(IPC.UsageOverview, () => live.usageOverview!.overview());
  handle(IPC.UsageProjects, ({ range }) => live.usageOverview!.projects(range));
  handle(IPC.TerminalProfileContext, ({ sessionId }) => live.ptyManager!.profileContextText(sessionId));
  handle(IPC.TerminalReclaim, ({ sessionId }) => live.remoteTerminals!.reclaim(sessionId));
  handle(IPC.TerminalPromptQuery, ({ sessionId }) => live.remoteTerminals!.desktopPromptCapability(sessionId));
  handle(IPC.TerminalPromptSend, request => live.remoteTerminals!.desktopPrompt(request));
  handleWithClient(IPC.DictationPrepare, async ({ sessionId }, client) => {
    const checkTarget = await live.remoteTerminals!.desktopRecordingTarget(sessionId);
    return recordings.prepare(`desktop:${client.id}`, () => {
      if (!client.alive()) throw new Error(translate("The ADE window recording audio was closed."));
      checkTarget();
    }, checkTarget.usage);
  });
  handleWithClient(IPC.ConversationDictationPrepare, ({ conversationId }, client) => {
    const checkTarget = conversationService().recordingTarget(conversationId);
    return recordings.prepare(`desktop:${client.id}`, () => {
      if (!client.alive()) throw new Error(translate("The ADE window recording audio was closed."));
      checkTarget();
    }, checkTarget.usage);
  });
  handleWithClient(IPC.OrganizerDictationPrepare, ({ documentId }, client) => {
    const check = () => {
      if (!client.alive() || !organizer.store.detail(documentId) || organizer.store.detail(documentId)?.deleted) throw new Error(translate("The task or note is no longer open."));
    };
    check(); const repositoryId = organizer.store.detail(documentId)!.document.repositoryId;
    return recordings.prepare(`desktop:${client.id}`, check, repositoryId ? { repositoryId } : {});
  });
  handleWithClient(IPC.DictationSubmit, ({ jobId, key, audioBase64 }, client) => {
    const audio = Buffer.from(audioBase64, 'base64');
    if (audio.toString('base64') !== audioBase64) throw new Error(translate("Invalid audio data."));
    return recordings.submit(`desktop:${client.id}`, jobId, key, audio);
  });
  handleWithClient(IPC.DictationQuery, ({ jobId }, client) => recordings.read(`desktop:${client.id}`, jobId));
  handleWithClient(IPC.DictationCancel, ({ jobId }, client) => recordings.cancel(`desktop:${client.id}`, jobId));
  handleWithClient(IPC.DictationStreamStart, ({ jobId }, client) => recordings.startLive(`desktop:${client.id}`, jobId));
  handleWithClient(IPC.DictationStreamChunk, ({ jobId, sequence, audioBase64 }, client) => {
    const audio = Buffer.from(audioBase64, 'base64');
    if (audio.toString('base64') !== audioBase64) throw new Error(translate("Invalid audio data."));
    recordings.pushLive(`desktop:${client.id}`, jobId, sequence, audio);
  });
  handleWithClient(IPC.DictationStreamFinish, ({ jobId }, client) => recordings.finishLive(`desktop:${client.id}`, jobId));
  handleWithEvent(IPC.DictationMicrophone, ({ allow }, event) => {
    if (allow) desktopMicrophone.grant(event.sender.id); else desktopMicrophone.revoke(event.sender.id);
  });

  // Reconcile renderer state after a reload without losing main-owned PTYs.
  handle(IPC.PtyList, async () => {
    const snapshot = {
      sessions: live.ptyManager!.list(),
      taskQueue: live.ptyManager!.queueStatus(),
    };
    // E2E-only: hold a deliberately stale snapshot while exit/removal events
    // continue, proving renderer hydration merges those events before commit.
    const requestedDelay = Number(process.env['ADE_E2E_PTY_LIST_SNAPSHOT_DELAY_MS'] ?? 0);
    const delay = Number.isFinite(requestedDelay) ? Math.min(Math.max(requestedDelay, 0), 2_000) : 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    return snapshot;
  });

  // Cancel active and queued Graph tasks, optionally scoped to selected agents.
  handle(IPC.PtyCancelTasks, (request) => live.ptyManager!.cancelTasks(request));
  handle(IPC.RuntimeDiagnose, ({ agentId, sessionId }) => diagnoseConfigured(agentId, sessionId));

  /* ----------------------------------------------- runs/tasks (Goal 2) */

  handle(IPC.PtyActivitySnapshot, ({ sessionId }) => live.ptyManager!.activitySnapshot(sessionId));

  // Persisted feed of a managed task — readable after its session ended.
  handle(IPC.RunTaskActivity, ({ taskId }) => {
    const snapshot = live.orchestration!.snapshot();
    const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`ade: run task not found "${taskId}"`);
    const participant = snapshot.participants.find(
      (candidate) => candidate.id === task.participantId,
    );
    if (!participant) throw new Error(`ade: no participant for task "${taskId}"`);
    return { lines: readTaskActivity(requireAgent(participant.agentId), task.runId, task.id) };
  });

  handle(IPC.OverviewGet, () => projectOverview(store.get(), live.ptyManager!.list()));
  handle(IPC.AttentionGet, () => attentionOverview(store.get(), live.orchestration!.summarize(), live.ptyManager!.list(), supervisionService().briefing(), Date.now(), {
    runsWrite: true, terminalWrite: true, prompt: (sessionId) => {
      if (!live.remoteTerminals!.desktopMayWrite(sessionId)) return 'other-device';
      const capability = live.remoteTerminals!.desktopPromptCapability(sessionId);
      return capability.available ? 'available' : capability.unsupported ? 'unsupported' : 'not-ready';
    },
  }));
  handle(IPC.RunGet, () => live.orchestration!.view());
  handle(IPC.RunReport, ({ runId }) => live.orchestration!.report(runId));
  handle(IPC.RunQuestions, ({ runId }) => runQuestions.view(runId));
  handle(IPC.RunAnswer, (input) => runQuestions.answer(input));
  handle(IPC.RunFiles, ({ runId, taskId }) => runInspection.files(runId, taskId, () => undefined));
  handle(IPC.RunFileRead, async ({ runId, taskId, fileId }) => {
    const file = await runInspection.file(runId, taskId, fileId, () => undefined);
    return { base64: file.bytes.toString('base64'), type: file.type, name: file.name };
  });
  handle(IPC.RunGetSummary, ({ runId }) => application.runs(runId));
  handle(IPC.RunEvents, ({ sinceSeq, limit }) => live.orchestration!.eventsSince(sinceSeq, limit));
  handle(IPC.RunApprovalDiff, async ({ runId }) => {
    // Validated work commits behind the pending integration approval, read
    // from the leased worktrees; the DTO stays free of absolute host paths.
    const snapshot = live.orchestration!.snapshot();
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
        participantName: participantName.get(result.participantId) ?? translate("Unknown"),
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
  handle(IPC.RunCreate, (input) => live.orchestration!.createRun(input));
  handle(IPC.RunDelete, ({ runId }) => live.runCoordinator!.deleteRun(runId));
  handle(IPC.RunTaskCreate, (input) => live.orchestration!.createTask(input));
  // One bounded task for an explicit agent/repository pair: run, participant
  // and task commit atomically, then the task session launches main-owned.
  handle(IPC.RunTaskSubmit, (input) => live.runCoordinator!.submitSingleTask(input));
  handle(IPC.RunStart, ({ runId, commandId }) => live.runCoordinator!.start(runId, commandId));
  handle(IPC.RunCancel, ({ runId, commandId }) =>
    live.runCoordinator!.cancel(runId, undefined, commandId),
  );
  handle(IPC.RunPauseTeam, ({ runId, teamId, commandId }) =>
    live.runCoordinator!.pauseTeam(runId, teamId, commandId),
  );
  handle(IPC.RunResumeTeam, ({ runId, teamId, commandId }) =>
    live.runCoordinator!.resumeTeam(runId, teamId, commandId),
  );
  handle(IPC.RunApprovalResolve, ({ approvalId, decision, commandId }) =>
    live.runCoordinator!.resolveApproval(approvalId, decision, commandId),
  );
  handle(IPC.RunTaskFail, ({ taskId, error }) => live.orchestration!.failTask(taskId, error));
  handle(IPC.RunArtifactCreate, (input) => live.orchestration!.createArtifact(input));

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
    // Parent the dialog to an ADE window only; a focused dashboard window
    // must not become the owner of a native file picker.
    const focused = BrowserWindow.getFocusedWindow();
    const win = (isRendererWindow(focused) ? focused : null) ?? rendererWindows()[0] ?? null;
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    const path = result.canceled ? null : (result.filePaths[0] ?? null);
    if (!path) return { path: null, isRepo: false };
    return { path, isRepo: await isGitRepo(path) };
  });
}

/** Local activation only: reserve the same mutation fence as host restart. */
export function reserveActivationQuit(): boolean { return host?.reserveActivationQuit() === true; }
export function mobileHostEnabled(): boolean { return host?.mobileHostEnabled() === true; }
/** Graceful quit only, after every PTY, task and listener has been stopped. */
export function markCleanShutdown(): void { host?.markCleanShutdown(); }
export function keepDesktopInTray(): boolean { return host?.keepDesktopInTray() === true; }
/** Kill every live pty — call on app quit so no orphan ConPTY lingers. */
export async function disposePtyManager(): Promise<void> { await host?.dispose(); }
