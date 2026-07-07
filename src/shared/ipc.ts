/**
 * IPC contract — per docs/ARCHITECTURE.md "IPC contract (shared/ipc.ts)".
 * Stable: all build agents code against these channel names and payloads.
 * Channels whose main-side handlers are stubs in Phase A are still declared
 * here in full so Phase B/C/D only implement, never re-shape.
 */

import type {
  AdeConfig,
  Agent,
  AgentCreateInput,
  AgentFile,
  Category,
  CategoryCreateInput,
  FsTreeNode,
  GitStatus,
  SessionMeta,
} from './types';

/* --------------------------------------------------------------- channels */

/** Invoke channels (renderer -> main via ipcRenderer.invoke). */
export const IPC = {
  ConfigGet: 'config:get',
  ConfigSave: 'config:save',
  PhotoImport: 'photo:import',
  CategoryCreate: 'category:create',
  CategoryDelete: 'category:delete',
  AgentCreate: 'agent:create',
  AgentDelete: 'agent:delete',
  PtyCreate: 'pty:create',
  PtyWrite: 'pty:write',
  PtyResize: 'pty:resize',
  PtyKill: 'pty:kill',
  PtyAttach: 'pty:attach',
  GitStatus: 'git:status',
  GitDiff: 'git:diff',
  FsTree: 'fs:tree',
  FsRead: 'fs:read',
  FsAgentFiles: 'fs:agentFiles',
  DialogPickFolder: 'dialog:pickFolder',
} as const;

/** Event channels (main -> renderer via webContents.send). */
export const IPC_EVENTS = {
  PtyData: 'pty:data',
  PtyExit: 'pty:exit',
  GitChanged: 'git:changed',
} as const;

export type InvokeChannel = (typeof IPC)[keyof typeof IPC];
export type EventChannel = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS];

export const INVOKE_CHANNELS: readonly InvokeChannel[] = Object.values(IPC);
export const EVENT_CHANNELS: readonly EventChannel[] = Object.values(IPC_EVENTS);

/* ----------------------------------------------------------- payload types */

export interface PhotoImportRequest {
  bytesBase64: string;
  mime: string; // image/png | image/jpeg
}
export interface PhotoImportResult {
  /** stored filename under userData/photos/ */
  file: string;
}

export interface PtyCreateRequest {
  agentId: string;
}
export interface PtyWriteRequest {
  sessionId: string;
  dataBase64: string;
}
export interface PtyResizeRequest {
  sessionId: string;
  cols: number;
  rows: number;
}
export interface PtyKillRequest {
  sessionId: string;
}
export interface PtyAttachRequest {
  sessionId: string;
}
export interface PtyAttachResult {
  /** ring-buffer replay of raw output since spawn (base64) */
  replayBase64: string;
}

export interface GitStatusRequest {
  agentId: string;
}
export interface GitDiffRequest {
  agentId: string;
  path: string;
}

export interface FsTreeRequest {
  agentId: string;
  /** Lazy children: relative dir path to expand. Omit/'' for the root level. */
  path?: string;
}
export interface FsReadRequest {
  agentId: string;
  path: string;
}
export interface FsReadResult {
  text: string;
  /** true when the file exceeded the read cap and `text` is a prefix. */
  truncated: boolean;
}
export interface FsAgentFilesRequest {
  agentId: string;
}

export interface DialogPickFolderResult {
  /** Chosen absolute path, or null when the dialog was cancelled. */
  path: string | null;
  /** true when the chosen folder is (inside) a git repo. false when cancelled. */
  isRepo: boolean;
}

/* -------------------------------------------------------------- event payloads */

export interface PtyDataEvent {
  sessionId: string;
  dataBase64: string;
}
export interface PtyExitEvent {
  sessionId: string;
  exitCode: number;
}
export interface GitChangedEvent {
  agentId: string;
}

/* ------------------------------------------------------------- typed maps */

/**
 * Request/response map for every invoke channel.
 * `req: void` means the channel takes no payload.
 */
export interface IpcInvokeMap {
  'config:get': { req: void; res: AdeConfig };
  'config:save': { req: Partial<AdeConfig>; res: AdeConfig };
  'photo:import': { req: PhotoImportRequest; res: PhotoImportResult };
  'category:create': { req: CategoryCreateInput; res: Category };
  'category:delete': { req: { id: string }; res: void };
  'agent:create': { req: AgentCreateInput; res: Agent };
  'agent:delete': { req: { id: string }; res: void };
  'pty:create': { req: PtyCreateRequest; res: SessionMeta };
  'pty:write': { req: PtyWriteRequest; res: void };
  'pty:resize': { req: PtyResizeRequest; res: void };
  'pty:kill': { req: PtyKillRequest; res: void };
  'pty:attach': { req: PtyAttachRequest; res: PtyAttachResult };
  'git:status': { req: GitStatusRequest; res: GitStatus };
  'git:diff': { req: GitDiffRequest; res: string };
  'fs:tree': { req: FsTreeRequest; res: FsTreeNode };
  'fs:read': { req: FsReadRequest; res: FsReadResult };
  'fs:agentFiles': { req: FsAgentFilesRequest; res: AgentFile[] };
  'dialog:pickFolder': { req: void; res: DialogPickFolderResult };
}

/** Payload map for every main -> renderer event channel. */
export interface IpcEventMap {
  'pty:data': PtyDataEvent;
  'pty:exit': PtyExitEvent;
  'git:changed': GitChangedEvent;
}

/* ------------------------------------------------- preload-exposed surface */

/**
 * The exact API exposed on `window.ade` by src/preload/index.ts.
 * No raw ipcRenderer crosses the bridge.
 */
export interface AdeApi {
  invoke<K extends keyof IpcInvokeMap>(
    channel: K,
    ...args: IpcInvokeMap[K]['req'] extends void ? [] : [IpcInvokeMap[K]['req']]
  ): Promise<IpcInvokeMap[K]['res']>;
  /** Subscribe to a main-process event. Returns an unsubscribe function. */
  on<K extends keyof IpcEventMap>(
    channel: K,
    listener: (payload: IpcEventMap[K]) => void,
  ): () => void;
}
