/**
 * IPC contract — per docs/ARCHITECTURE.md "IPC contract (shared/ipc.ts)".
 * Stable: renderer and main code against these channel names and payloads.
 * Main also validates every request at runtime in ipcValidation.ts; these
 * TypeScript declarations are not treated as a security boundary.
 */

import type {
  AdeConfig,
  Agent,
  AgentCreateInput,
  AgentTemplate,
  AgentTemplateCreateInput,
  AgentTemplateSpawnInput,
  AgentUpdateInput,
  AgentFile,
  Category,
  CategoryCreateInput,
  FsTreeNode,
  GitStatus,
  OrchestrationSnapshot,
  Run,
  RunArtifact,
  RunCreateInput,
  RunTask,
  RunTaskCreateInput,
  RuntimeDiagnosticsResult,
  SessionMeta,
  TaskQueueStatus,
  ThemeName,
  PtyExitReason,
  Repository,
  WorkspaceScopeDescriptor,
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
  AgentUpdate: 'agent:update',
  AgentDelete: 'agent:delete',
  AgentSetDefaultRepository: 'agent:setDefaultRepository',
  AgentTemplateCreate: 'agentTemplate:create',
  AgentTemplateDelete: 'agentTemplate:delete',
  AgentTemplateSpawn: 'agentTemplate:spawn',
  RepositoryImport: 'repository:import',
  WorkspaceDescribe: 'workspace:describe',
  PtyCreate: 'pty:create',
  PtyWrite: 'pty:write',
  PtyResize: 'pty:resize',
  PtyKill: 'pty:kill',
  PtyAttach: 'pty:attach',
  PtyList: 'pty:list',
  PtyCancelTasks: 'pty:cancelTasks',
  RuntimeDiagnose: 'runtime:diagnose',
  RunGet: 'run:get',
  RunCreate: 'run:create',
  RunDelete: 'run:delete',
  RunStart: 'run:start',
  RunCancel: 'run:cancel',
  RunApprovalResolve: 'runApproval:resolve',
  RunTaskCreate: 'runTask:create',
  RunTaskFail: 'runTask:fail',
  RunArtifactCreate: 'runArtifact:create',
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
  PtyRemoved: 'pty:removed',
  PtyTaskQueue: 'pty:taskQueue',
  OrchestrationChanged: 'orchestration:changed',
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
  /**
   * Optional Graph-mode task. When present, main launches a bounded one-shot
   * task session through the runtime's non-interactive transport.
   */
  task?: string;
  /** Groups all sessions created by one team dispatch for cancellation. */
  dispatchId?: string;
  /** Persisted run task whose lifecycle follows this PTY. */
  runTaskId?: string;
  /** string = explicit repo, null = explicit plain home, omitted = agent default. */
  repositoryId?: string | null;
  /** Internal exact binding used by restart and managed task launch. */
  workspaceBindingId?: string;
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
  /** Last output sequence included in replayBase64. */
  sequence: number;
}

/** Renderer config writes are intentionally narrower than the stored model. */
export interface ConfigSaveRequest {
  settings: {
    theme: ThemeName;
  };
}
export interface PtyListResult {
  sessions: SessionMeta[];
  taskQueue: TaskQueueStatus;
}
export interface PtyCancelTasksRequest {
  /** Omit to cancel every active and queued task session. */
  agentIds?: string[];
  /** Exact persisted tasks to cancel; keeps cancellation scoped to one run. */
  runTaskIds?: string[];
}
export interface PtyCancelTasksResult {
  activeCancelled: number;
  queuedCancelled: number;
}
export interface RuntimeDiagnoseRequest {
  /** Omit to check every configured agent. */
  agentId?: string;
}
export interface RunArtifactCreateRequest {
  runId: string;
  taskId?: string;
  kind: RunArtifact['kind'];
  path?: string;
  content?: string;
}

export interface GitStatusRequest {
  agentId: string;
  sessionId?: string;
}
export interface GitDiffRequest {
  agentId: string;
  sessionId?: string;
  path: string;
}

export interface FsTreeRequest {
  agentId: string;
  sessionId?: string;
  /** Lazy children: relative dir path to expand. Omit/'' for the root level. */
  path?: string;
}
export interface FsReadRequest {
  agentId: string;
  sessionId?: string;
  path: string;
}
export interface FsReadResult {
  text: string;
  /** true when the file exceeded the read cap and `text` is a prefix. */
  truncated: boolean;
}
export interface FsAgentFilesRequest {
  agentId: string;
  sessionId?: string;
}

export interface RepositoryImportRequest {
  path: string;
  name?: string;
}

export interface WorkspaceDescribeRequest {
  agentId: string;
  sessionId?: string;
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
  sequence: number;
}
export interface PtyExitEvent {
  sessionId: string;
  exitCode: number;
  reason: PtyExitReason;
}
export interface PtyRemovedEvent {
  sessionId: string;
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
  'config:save': { req: ConfigSaveRequest; res: AdeConfig };
  'photo:import': { req: PhotoImportRequest; res: PhotoImportResult };
  'category:create': { req: CategoryCreateInput; res: Category };
  'category:delete': { req: { id: string }; res: void };
  'agent:create': { req: AgentCreateInput; res: Agent };
  'agent:update': { req: AgentUpdateInput; res: Agent };
  'agent:delete': { req: { id: string }; res: void };
  'agent:setDefaultRepository': {
    req: { agentId: string; repositoryId: string | null };
    res: Agent;
  };
  'agentTemplate:create': { req: AgentTemplateCreateInput; res: AgentTemplate };
  'agentTemplate:delete': { req: { id: string }; res: void };
  'agentTemplate:spawn': { req: AgentTemplateSpawnInput; res: Agent };
  'repository:import': { req: RepositoryImportRequest; res: Repository };
  'workspace:describe': { req: WorkspaceDescribeRequest; res: WorkspaceScopeDescriptor };
  'pty:create': { req: PtyCreateRequest; res: SessionMeta };
  'pty:write': { req: PtyWriteRequest; res: void };
  'pty:resize': { req: PtyResizeRequest; res: void };
  'pty:kill': { req: PtyKillRequest; res: void };
  'pty:attach': { req: PtyAttachRequest; res: PtyAttachResult };
  'pty:list': { req: void; res: PtyListResult };
  'pty:cancelTasks': { req: PtyCancelTasksRequest; res: PtyCancelTasksResult };
  'runtime:diagnose': { req: RuntimeDiagnoseRequest; res: RuntimeDiagnosticsResult };
  'run:get': { req: void; res: OrchestrationSnapshot };
  'run:create': { req: RunCreateInput; res: Run };
  'run:delete': { req: { runId: string }; res: void };
  'run:start': { req: { runId: string }; res: Run };
  'run:cancel': { req: { runId: string }; res: void };
  'runApproval:resolve': {
    req: { approvalId: string; decision: 'approve' | 'reject' };
    res: void;
  };
  'runTask:create': { req: RunTaskCreateInput; res: RunTask };
  'runTask:fail': { req: { taskId: string; error: string }; res: void };
  'runArtifact:create': { req: RunArtifactCreateRequest; res: RunArtifact };
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
  'pty:removed': PtyRemovedEvent;
  'pty:taskQueue': TaskQueueStatus;
  'orchestration:changed': OrchestrationSnapshot;
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
