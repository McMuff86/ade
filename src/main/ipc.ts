import { t as translate } from "../shared/i18n";
import { desktopNotifier } from './notifications';
import type { HostClient, HostEvents, ProfilePaths } from './host/ports';
import { DesktopClients } from './desktop/DesktopClients';
import { composeHost, type Host } from './host/composeHost';
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
import { IPC, type IpcInvokeMap } from '../shared/ipc';
import { NATIVE_EXECUTION_BACKEND } from '../shared/executionBackends';
import type { ConfigStore } from './config/store';
import { deleteAgent } from './identity';
import { isGitRepo } from './git/GitService';
import { assertIpcPayload } from './ipcValidation';
import { assertChannelPolicy } from './ipcPolicy';
import { broadcastToRenderers, isRendererWindow, rendererWindows } from './rendererWindows';
import { isTrustedRendererUrl } from './security';
import { DashboardWindows } from './dashboard/DashboardWindows';
import { resolveDashboardUrl } from './dashboard/dashboardUrl';
import { listClones, matchClones } from './portability/CloneFinder';
import { exportWorkspaceBundle } from './portability/WorkspaceBundleExporter';
import { openManagedProfileReader } from './portability/ProfileMigrationSource';
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
 * Typed ipcMain.handle wrapper for the Electron-bound desktop handlers. Every
 * call passes sender trust and payload validation here, then the host's guard
 * (privilege policy, operation fence, catalog event, redaction funnel).
 */
function handleWithEvent<K extends keyof IpcInvokeMap>(
  channel: K,
  handler: (
    payload: IpcInvokeMap[K]['req'],
    event: IpcMainInvokeEvent,
  ) => IpcInvokeMap[K]['res'] | Promise<IpcInvokeMap[K]['res']>,
): void {
  assertChannelPolicy(channel);
  ipcMain.handle(channel, async (event, payload: unknown) => {
    assertTrustedSender(event);
    assertIpcPayload(channel, payload);
    return host!.guard(channel, () => handler(payload, event));
  });
}

/** Host channels: the same trust and validation, then the host's dispatch (generic, by channel). */
function registerHostChannel(channel: keyof IpcInvokeMap): void {
  assertChannelPolicy(channel);
  ipcMain.handle(channel, async (event, payload: unknown) => {
    assertTrustedSender(event);
    assertIpcPayload(channel, payload);
    return host!.dispatch(channel, payload, desktopClients.for(event.sender));
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
    assertAgentNotLeased,
    backendFs,
    execution,
    importSelectionTtlMs,
    importSelections,
    mappingAuthorizations,
    portabilityProfileDir,
    previewOwners,
    requireAgent,
    workspaceBundles,
    workspaceTarget,
  } = host;
  for (const channel of host.channels()) registerHostChannel(channel);
  // Resolve the agent dashboard (fixed URL or freshly minted by its command)
  // and open it origin-locked in an ADE window or the system browser.
  const dashboardWindows = new DashboardWindows();


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
  handleWithEvent(IPC.DictationMicrophone, ({ allow }, event) => {
    if (allow) desktopMicrophone.grant(event.sender.id); else desktopMicrophone.revoke(event.sender.id);
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
