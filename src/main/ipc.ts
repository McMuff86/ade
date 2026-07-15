/**
 * IPC channel registration (main side).
 * Config, identity/photos (B2), pty (B1) and git/fs (Phase C) handlers are all
 * real; the renderer codes against the full contract in shared/ipc.ts.
 */

import { BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IPC, IPC_EVENTS, type IpcInvokeMap } from '../shared/ipc';
import type { Agent, GitStatus } from '../shared/types';
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
} from './identity';
import { PtyManager } from './pty/PtyManager';
import { gitDiff, gitShowCommit, gitStatus, isGitRepo } from './git/GitService';
import { agentFiles, fsDelete, fsPathInfo, fsRead, fsRename, fsTree } from './git/workspaceFs';
import { OrchestrationService } from './orchestration/OrchestrationService';
import { RunCoordinator } from './orchestration/RunCoordinator';
import { diagnoseRuntimes } from './diagnostics/RuntimeDiagnostics';
import { assertIpcPayload } from './ipcValidation';
import { isTrustedRendererUrl } from './security';
import { RepositoryScopeService } from './repositories/RepositoryScopeService';

/** Live PTY sessions (Phase B1). Created lazily so tests can import this module. */
let ptyManager: PtyManager | null = null;
let orchestration: OrchestrationService | null = null;
let runCoordinator: RunCoordinator | null = null;

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

export function registerIpcHandlers(store: ConfigStore): void {
  const scopes = new RepositoryScopeService(store);
  orchestration = new OrchestrationService(store, (snapshot) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC_EVENTS.OrchestrationChanged, snapshot);
    }
  });
  const recoveredTasks = orchestration.recoverInterruptedTasks();
  if (recoveredTasks > 0) {
    console.warn(`[ade] recovered ${recoveredTasks} interrupted run task(s)`);
  }
  runCoordinator = new RunCoordinator(store, orchestration, undefined, undefined, scopes);
  ptyManager = new PtyManager(store, runCoordinator, scopes);
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
  const workspaceTarget = (agentId: string, sessionId?: string): { agent: Agent; workspaceDir: string } => {
    const agent = requireAgent(agentId);
    if (!sessionId) return { agent, workspaceDir: scopes.describe(agentId).workspaceDir };
    const session = ptyManager!.getSessionMeta(sessionId);
    if (!session || session.agentId !== agentId) {
      throw new Error(`ade: session does not belong to agent "${agentId}"`);
    }
    return { agent, workspaceDir: session.workspaceDir ?? scopes.describe(agentId, session).workspaceDir };
  };

  /* ------------------------------------------------------- config (real) */

  handle(IPC.ConfigGet, () => store.get());
  handle(IPC.ConfigSave, (partial) => store.save(partial));

  /* ------------------------------------------ identity + photos (Phase B2) */

  // Store photo bytes under userData/ade/photos/, served via ade-photo://
  handle(IPC.PhotoImport, (req) => importPhoto(req));

  // Create category; persists via ConfigStore.
  handle(IPC.CategoryCreate, (input) => createCategory(store, input, scopes));

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
  handle(IPC.RepositoryImport, ({ path, name }) => scopes.importRepository(path, name));
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
  handle(IPC.RuntimeDiagnose, ({ agentId }) => diagnoseRuntimes(store.get().agents, agentId));

  /* ----------------------------------------------- runs/tasks (Goal 2) */

  handle(IPC.PtyActivitySnapshot, ({ sessionId }) => ptyManager!.activitySnapshot(sessionId));

  handle(IPC.RunGet, () => orchestration!.snapshot());
  handle(IPC.RunGetSummary, ({ runId }) => orchestration!.summarize(runId));
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
      const commit = await gitShowCommit(lease.workspaceDir, result.commitSha!);
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
    gitStatus(workspaceTarget(agentId, sessionId).workspaceDir),
  );

  // Unified diff for one file (staged+unstaged vs HEAD; untracked = additions).
  handle(IPC.GitDiff, ({ agentId, sessionId, path }) =>
    gitDiff(workspaceTarget(agentId, sessionId).workspaceDir, path),
  );

  // Depth-limited workspace tree; `path` lazily expands one directory level.
  handle(IPC.FsTree, ({ agentId, sessionId, path }) =>
    fsTree(workspaceTarget(agentId, sessionId).workspaceDir, path),
  );

  // Size-capped text read (workspace file, or a pinned file from memoryDir).
  handle(IPC.FsRead, ({ agentId, sessionId, path }) => {
    const { agent, workspaceDir } = workspaceTarget(agentId, sessionId);
    return fsRead(workspaceDir, agent.memoryDir, path);
  });

  // Pinned agent files (MEMORY/USER/CLAUDE/AGENTS) that exist for this agent.
  handle(IPC.FsAgentFiles, ({ agentId, sessionId }) => {
    const { agent, workspaceDir } = workspaceTarget(agentId, sessionId);
    return agentFiles(workspaceDir, agent.memoryDir);
  });

  // Context-menu support: absolute location of a workspace/pinned file.
  handle(IPC.FsPathInfo, ({ agentId, sessionId, path }) => {
    const { agent, workspaceDir } = workspaceTarget(agentId, sessionId);
    return fsPathInfo(workspaceDir, agent.memoryDir, path);
  });

  // Select the file in the OS file manager (workspace-validated path only).
  handle(IPC.FsReveal, ({ agentId, sessionId, path }) => {
    const { agent, workspaceDir } = workspaceTarget(agentId, sessionId);
    const info = fsPathInfo(workspaceDir, agent.memoryDir, path);
    if (info.kind === 'missing') throw new Error(`ade: not found: "${path}"`);
    shell.showItemInFolder(info.absolutePath);
  });

  // Open with the OS default handler; user-initiated from the context menu.
  handle(IPC.FsOpenPath, async ({ agentId, sessionId, path }) => {
    const { agent, workspaceDir } = workspaceTarget(agentId, sessionId);
    const info = fsPathInfo(workspaceDir, agent.memoryDir, path);
    if (info.kind === 'missing') throw new Error(`ade: not found: "${path}"`);
    const error = await shell.openPath(info.absolutePath);
    if (error) throw new Error(`ade: could not open "${path}": ${error}`);
  });

  // Rename inside the workspace only (memoryDir scaffold stays untouchable).
  handle(IPC.FsRename, ({ agentId, sessionId, path, newName }) => {
    assertAgentNotLeased(agentId);
    const { workspaceDir } = workspaceTarget(agentId, sessionId);
    return fsRename(workspaceDir, path, newName);
  });

  // Delete = synchronously quarantine, then move to OS trash (recoverable).
  handle(IPC.FsDelete, async ({ agentId, sessionId, path }) => {
    assertAgentNotLeased(agentId);
    const { workspaceDir } = workspaceTarget(agentId, sessionId);
    await fsDelete(workspaceDir, path, (quarantinedPath) => shell.trashItem(quarantinedPath));
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
  ptyManager?.disposeAll();
  ptyManager = null;
  runCoordinator = null;
  orchestration = null;
}
