/**
 * IPC channel registration (main side).
 * Config, identity/photos (B2) and pty (B1) handlers are real; git/fs
 * handlers are stubs owned by Phase C — the renderer codes against the full
 * contract in shared/ipc.ts either way.
 */

import { ipcMain } from 'electron';
import { IPC, type IpcInvokeMap } from '../shared/ipc';
import type { FsTreeNode, GitStatus } from '../shared/types';
import type { ConfigStore } from './config/store';
import { importPhoto } from './photos';
import { createAgent, createCategory, deleteAgent, deleteCategory } from './identity';
import { PtyManager } from './pty/PtyManager';

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

  /* ------------------------------------------------------- config (real) */

  handle(IPC.ConfigGet, () => store.get());
  handle(IPC.ConfigSave, (partial) => store.save(partial));

  /* ------------------------------------------ identity + photos (Phase B2) */

  // Store photo bytes under userData/ade/photos/, served via ade-photo://
  handle(IPC.PhotoImport, (req) => importPhoto(req));

  // Create category; persists via ConfigStore.
  handle(IPC.CategoryCreate, (input) => createCategory(store, input));

  // Delete category (+ its agents) from config only — never touches user files.
  handle(IPC.CategoryDelete, ({ id }) => deleteCategory(store, id));

  // Create agent — resolves + makes workspaceDir and (empty) memoryDir.
  // TODO(Phase C): git worktree when the category is repo-backed.
  handle(IPC.AgentCreate, (input) => createAgent(store, input));

  // Delete agent from config only — never deletes its workspace/memory files.
  // TODO(Phase B1): also kill any live sessions for this agent.
  handle(IPC.AgentDelete, ({ id }) => deleteAgent(store, id));

  /* --------------------------------------------------- pty (Phase B1) */

  // Spawn the agent's CLI per its launch profile (shared/runtimes.ts)
  handle(IPC.PtyCreate, ({ agentId }) => ptyManager!.create(agentId));

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
  handle(IPC.PtyAttach, ({ sessionId }) => ({
    replayBase64: ptyManager!.attach(sessionId),
  }));

  // TODO(Phase C): simple-git status for the agent's workspaceDir
  handle(IPC.GitStatus, (): GitStatus => {
    return { branch: 'main', ahead: 0, behind: 0, files: [] };
  });

  // TODO(Phase C): unified diff for one file
  handle(IPC.GitDiff, () => '');

  // TODO(Phase C): depth-limited workspace tree with lazy children
  handle(IPC.FsTree, (): FsTreeNode => {
    return { name: '', path: '', kind: 'dir', children: [] };
  });

  // TODO(Phase C): size-capped file read
  handle(IPC.FsRead, () => '');
}

/** Kill every live pty — call on app quit so no orphan ConPTY lingers. */
export function disposePtyManager(): void {
  ptyManager?.disposeAll();
  ptyManager = null;
}
