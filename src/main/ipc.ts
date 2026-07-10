/**
 * IPC channel registration (main side).
 * Config, identity/photos (B2), pty (B1) and git/fs (Phase C) handlers are all
 * real; the renderer codes against the full contract in shared/ipc.ts.
 */

import { BrowserWindow, dialog, ipcMain } from 'electron';
import { IPC, type IpcInvokeMap } from '../shared/ipc';
import type { Agent, GitStatus } from '../shared/types';
import type { ConfigStore } from './config/store';
import { importPhoto } from './photos';
import { createAgent, createCategory, deleteAgent, deleteCategory, updateAgent } from './identity';
import { PtyManager } from './pty/PtyManager';
import { gitDiff, gitStatus, isGitRepo } from './git/GitService';
import { agentFiles, fsRead, fsTree } from './git/workspaceFs';

/** Live PTY sessions (Phase B1). Created lazily so tests can import this module. */
let ptyManager: PtyManager | null = null;

/** Typed ipcMain.handle wrapper: payload/result checked against IpcInvokeMap. */
function handle<K extends keyof IpcInvokeMap>(
  channel: K,
  handler: (
    payload: IpcInvokeMap[K]['req'],
  ) => IpcInvokeMap[K]['res'] | Promise<IpcInvokeMap[K]['res']>,
): void {
  ipcMain.handle(channel, (_event, payload) => handler(payload as IpcInvokeMap[K]['req']));
}

export function registerIpcHandlers(store: ConfigStore): void {
  ptyManager = new PtyManager(store);

  /** Resolve an agent by id or throw — every git/fs handler needs its dirs. */
  const requireAgent = (agentId: string): Agent => {
    const agent = store.get().agents.find((a) => a.id === agentId);
    if (!agent) throw new Error(`ade: agent not found "${agentId}"`);
    return agent;
  };

  /* ------------------------------------------------------- config (real) */

  handle(IPC.ConfigGet, () => store.get());
  handle(IPC.ConfigSave, (partial) => store.save(partial));

  /* ------------------------------------------ identity + photos (Phase B2) */

  // Store photo bytes under userData/ade/photos/, served via ade-photo://
  handle(IPC.PhotoImport, (req) => importPhoto(req));

  // Create category; persists via ConfigStore.
  handle(IPC.CategoryCreate, (input) => createCategory(store, input));

  // Stop every owned PTY before removing config entries. User files stay put.
  handle(IPC.CategoryDelete, ({ id }) => {
    const agentIds = store.get().agents
      .filter((agent) => agent.categoryId === id)
      .map((agent) => agent.id);
    for (const agentId of agentIds) ptyManager!.killByAgent(agentId);
    deleteCategory(store, id);
  });

  // Create agent, workspace/worktree and memory scaffold.
  handle(IPC.AgentCreate, (input) => createAgent(store, input));

  // Update runtime/launch configuration and display metadata for an agent.
  handle(IPC.AgentUpdate, (input) => updateAgent(store, input));

  // Stop live/queued work, then remove config only (workspace files remain).
  handle(IPC.AgentDelete, ({ id }) => {
    ptyManager!.killByAgent(id);
    deleteAgent(store, id);
  });

  /* --------------------------------------------------- pty (Phase B1) */

  // Interactive sessions spawn immediately; task sessions wait for a queue slot.
  handle(IPC.PtyCreate, ({ agentId, task, dispatchId }) =>
    ptyManager!.create(agentId, task, dispatchId),
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
  handle(IPC.PtyList, () => ({
    sessions: ptyManager!.list(),
    taskQueue: ptyManager!.queueStatus(),
  }));

  // Cancel active and queued Graph tasks, optionally scoped to selected agents.
  handle(IPC.PtyCancelTasks, (request) => ptyManager!.cancelTasks(request));

  /* ------------------------------------------------- git + fs (Phase C) */

  // Real git status for the agent's workspaceDir (non-repo → isRepo:false).
  handle(IPC.GitStatus, ({ agentId }): Promise<GitStatus> =>
    gitStatus(requireAgent(agentId).workspaceDir),
  );

  // Unified diff for one file (staged+unstaged vs HEAD; untracked = additions).
  handle(IPC.GitDiff, ({ agentId, path }) => gitDiff(requireAgent(agentId).workspaceDir, path));

  // Depth-limited workspace tree; `path` lazily expands one directory level.
  handle(IPC.FsTree, ({ agentId, path }) => fsTree(requireAgent(agentId).workspaceDir, path));

  // Size-capped text read (workspace file, or a pinned file from memoryDir).
  handle(IPC.FsRead, ({ agentId, path }) => {
    const agent = requireAgent(agentId);
    return fsRead(agent.workspaceDir, agent.memoryDir, path);
  });

  // Pinned agent files (MEMORY/USER/CLAUDE/AGENTS) that exist for this agent.
  handle(IPC.FsAgentFiles, ({ agentId }) => {
    const agent = requireAgent(agentId);
    return agentFiles(agent.workspaceDir, agent.memoryDir);
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
}
