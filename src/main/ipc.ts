/**
 * IPC channel registration (main side).
 * Config handlers are real (backed by ConfigStore). Everything else returns
 * stub data for now — clearly marked TODO with the owning phase — so the
 * renderer can already code against the full contract in shared/ipc.ts.
 */

import { ipcMain } from 'electron';
import { IPC, type IpcInvokeMap } from '../shared/ipc';
import type { FsTreeNode, GitStatus, SessionMeta } from '../shared/types';
import type { ConfigStore } from './config/store';
import { importPhoto } from './photos';
import { createAgent, createCategory, deleteAgent, deleteCategory } from './identity';

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

  /* -------------------------------------- stubs below — see owning phase */

  // TODO(Phase B1): PtyManager.spawn per launch profile (shared/runtimes.ts)
  handle(IPC.PtyCreate, ({ agentId }): SessionMeta => {
    return { id: 'stub-session', agentId, title: 'session', status: 'exited', createdAt: Date.now() };
  });

  // TODO(Phase B1): write to the session's pty
  handle(IPC.PtyWrite, () => undefined);

  // TODO(Phase B1): resize the session's pty
  handle(IPC.PtyResize, () => undefined);

  // TODO(Phase B1): kill the session's pty
  handle(IPC.PtyKill, () => undefined);

  // TODO(Phase B1): return ring-buffer replay for (re)attach
  handle(IPC.PtyAttach, () => ({ replayBase64: '' }));

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
