/**
 * IPC channel registration (main side).
 * Config handlers are real (backed by ConfigStore). Everything else returns
 * stub data for now — clearly marked TODO with the owning phase — so the
 * renderer can already code against the full contract in shared/ipc.ts.
 */

import { ipcMain } from 'electron';
import { IPC, type IpcInvokeMap } from '../shared/ipc';
import type { Agent, Category, FsTreeNode, GitStatus, SessionMeta } from '../shared/types';
import type { ConfigStore } from './config/store';

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

  /* -------------------------------------- stubs below — see owning phase */

  // TODO(Phase B2): store photo bytes under userData/photos/, serve via ade-photo://
  handle(IPC.PhotoImport, () => ({ file: 'stub-photo.png' }));

  // TODO(Phase B2): create category (and repo wiring); persists via ConfigStore
  handle(IPC.CategoryCreate, (input): Category => {
    return { id: `stub-category`, name: input.name, photo: input.photo, repoPath: input.repoPath, agents: [] };
  });

  // TODO(Phase B2): delete category + owned agents/workspaces
  handle(IPC.CategoryDelete, () => undefined);

  // TODO(Phase B2): create agent — workspaceDir, memory scaffold, worktree when repo-backed
  handle(IPC.AgentCreate, (input): Agent => {
    return {
      id: 'stub-agent',
      categoryId: input.categoryId,
      name: input.name,
      role: input.role,
      photo: input.photo,
      runtime: input.runtime,
      permissionMode: input.permissionMode,
      customCommand: input.customCommand,
      ollamaModel: input.ollamaModel,
      workspaceDir: '',
      memoryDir: '',
    };
  });

  // TODO(Phase B2): delete agent + kill sessions + remove worktree
  handle(IPC.AgentDelete, () => undefined);

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
