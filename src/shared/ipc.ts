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
  RunEvent,
  RunMessage,
  RunPublication,
  RunPublicationPreview,
  RunSummary,
  RunTask,
  RunTaskCreateInput,
  RuntimeDiagnosticsResult,
  SessionMeta,
  TaskQueueStatus,
  ThemeName,
  PtyExitReason,
  Repository,
  RepositoryCommitDiff,
  RepositoryOverview,
  RepositoryPullRequestResult,
  WorkspaceScopeDescriptor,
} from './types';
import type { ExecutionBackendId } from './executionBackends';

/* --------------------------------------------------------------- channels */

/** Invoke channels (renderer -> main via ipcRenderer.invoke). */
export const IPC = {
  ConfigGet: 'config:get',
  ConfigSave: 'config:save',
  PhotoImport: 'photo:import',
  CategoryCreate: 'category:create',
  CategoryDelete: 'category:delete',
  CategoryReorder: 'category:reorder',
  AgentCreate: 'agent:create',
  AgentUpdate: 'agent:update',
  AgentDelete: 'agent:delete',
  AgentMove: 'agent:move',
  AgentSetDefaultRepository: 'agent:setDefaultRepository',
  AgentTemplateCreate: 'agentTemplate:create',
  AgentTemplateDelete: 'agentTemplate:delete',
  AgentTemplateSpawn: 'agentTemplate:spawn',
  RepositoryImport: 'repository:import',
  RepositoryOverview: 'repository:overview',
  RepositoryPullRequests: 'repository:pullRequests',
  RepositoryCommitDiff: 'repository:commitDiff',
  WorkspaceDescribe: 'workspace:describe',
  WorkspaceRemoveBinding: 'workspace:removeBinding',
  ClipboardReadText: 'clipboard:readText',
  ClipboardWriteText: 'clipboard:writeText',
  PtyCreate: 'pty:create',
  PtyWrite: 'pty:write',
  PtyResize: 'pty:resize',
  PtyKill: 'pty:kill',
  PtyAttach: 'pty:attach',
  PtyActivitySnapshot: 'pty:activitySnapshot',
  RunTaskActivity: 'runTask:activity',
  PtyList: 'pty:list',
  PtyCancelTasks: 'pty:cancelTasks',
  RuntimeDiagnose: 'runtime:diagnose',
  RunGet: 'run:get',
  RunGetSummary: 'run:getSummary',
  RunEvents: 'run:events',
  RunApprovalDiff: 'run:approvalDiff',
  RunPublicationPreview: 'run:publicationPreview',
  RunPublish: 'run:publish',
  RunCreate: 'run:create',
  RunDelete: 'run:delete',
  RunStart: 'run:start',
  RunCancel: 'run:cancel',
  RunPauseTeam: 'run:pauseTeam',
  RunResumeTeam: 'run:resumeTeam',
  RunApprovalResolve: 'runApproval:resolve',
  RunTaskCreate: 'runTask:create',
  RunTaskFail: 'runTask:fail',
  RunArtifactCreate: 'runArtifact:create',
  GitStatus: 'git:status',
  GitDiff: 'git:diff',
  FsTree: 'fs:tree',
  FsRead: 'fs:read',
  FsAgentFiles: 'fs:agentFiles',
  FsPathInfo: 'fs:pathInfo',
  FsReveal: 'fs:reveal',
  FsOpenPath: 'fs:openPath',
  FsRename: 'fs:rename',
  FsDelete: 'fs:delete',
  DialogPickFolder: 'dialog:pickFolder',
  WslList: 'wsl:list',
} as const;

/** Event channels (main -> renderer via webContents.send). */
export const IPC_EVENTS = {
  PtyData: 'pty:data',
  PtyActivity: 'pty:activity',
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

/**
 * Readable activity derived from a runtime's machine-readable event stream.
 * Print-mode CLIs buffer their human output until exit, so this is the only
 * live view of a managed task — and, being text-only, the shape a future
 * mobile client can consume without a raw terminal.
 */
export type ActivityKind = 'init' | 'thinking' | 'text' | 'tool' | 'result' | 'error';
export interface ActivityLine {
  kind: ActivityKind;
  text: string;
}
export interface PtyActivityResult {
  lines: ActivityLine[];
}
export interface PtyActivityEvent {
  sessionId: string;
  lines: ActivityLine[];
}

/** Renderer config writes are intentionally narrower than the stored model. */
export interface ConfigSaveRequest {
  settings: {
    theme: ThemeName;
  };
}
export interface WorkspaceRemoveBindingRequest {
  workspaceBindingId: string;
}
export interface WorkspaceRemoveBindingResult {
  /** ADE branch the removed worktree was on. */
  branch: string;
  /** false = the branch had unmerged commits and was kept for safety. */
  branchDeleted: boolean;
}
export interface ClipboardWriteTextRequest {
  text: string;
}
export interface ClipboardReadTextResult {
  text: string;
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
  /** Optional immutable session scope; requires agentId. */
  sessionId?: string;
}
export interface RunArtifactCreateRequest {
  runId: string;
  taskId?: string;
  kind: RunArtifact['kind'];
  path?: string;
  content?: string;
}

/** Cursor-paged journal window; the Goal 7 SSE stream serves the same shape. */
export interface RunEventsRequest {
  /** Return only records with seq greater than this cursor. Default 0. */
  sinceSeq?: number;
  /** 1..500 merged records per page. Default 200. */
  limit?: number;
}
export interface RunEventsResult {
  events: RunEvent[];
  messages: RunMessage[];
  /** Highest seq in this page; pass back as sinceSeq to resume. */
  nextCursor: number;
}

/* Sanitized validated-commit diffs backing an integration approval. Paths are
 * repo-relative; no absolute host path crosses this DTO. */
export interface ApprovalDiffFile {
  path: string;
  additions: number;
  deletions: number;
}
export interface ApprovalDiffEntry {
  participantName: string;
  branch: string;
  commitSha: string;
  /** Commit subject of the ADE-authored validated commit. */
  title: string;
  files: ApprovalDiffFile[];
  /** Unified diff of the whole commit, capped at ~1 MB. */
  diff: string;
}
export interface ApprovalDiffResult {
  runId: string;
  entries: ApprovalDiffEntry[];
}

export interface RunSummaryRequest {
  /** Omit for every run; set to project exactly one run. */
  runId?: string;
}

export interface RunLifecycleRequest {
  runId: string;
  /** Optional idempotency key; replay returns the original outcome. */
  commandId?: string;
}

export interface RunTeamPauseRequest {
  runId: string;
  teamId: string;
  /** Optional idempotency key; replay returns the original outcome. */
  commandId?: string;
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

export interface CategoryReorderRequest {
  /** Every category id exactly once, in the new rail order. */
  orderedIds: string[];
}

export interface AgentMoveRequest {
  agentId: string;
  /** Target category; may equal the agent's current category for a reorder. */
  categoryId: string;
  /**
   * Insertion index into the target category's agent list, counted with the
   * moved agent already removed from it. Main clamps to the valid range.
   */
  index: number;
}

export interface FsPathInfoResult {
  absolutePath: string;
  kind: 'file' | 'dir' | 'missing';
  /** Pinned agent files may resolve to the agent's memoryDir. */
  location: 'workspace' | 'memory';
}

export interface FsRenameRequest {
  agentId: string;
  sessionId?: string;
  path: string;
  /** Bare filename (no path separators); the file stays in its directory. */
  newName: string;
}

export interface FsRenameResult {
  /** New workspace-relative path of the renamed entry. */
  path: string;
}

export interface RepositoryImportRequest {
  path: string;
  name?: string;
  /** Omitted only for compatibility with pre-WSL renderer builds. */
  executionBackend?: ExecutionBackendId;
}

export interface RepositoryInspectRequest {
  repositoryId: string;
}

export interface RepositoryCommitDiffRequest extends RepositoryInspectRequest {
  /** Full lowercase SHA-1/SHA-256 object id returned by repository:overview. */
  commitSha: string;
}

export interface WslDistributionInfo {
  name: string;
  backend: ExecutionBackendId;
  available: boolean;
  error?: string;
}

export interface WslListResult {
  supported: boolean;
  distributions: WslDistributionInfo[];
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
  'category:reorder': { req: CategoryReorderRequest; res: void };
  'agent:create': { req: AgentCreateInput; res: Agent };
  'agent:update': { req: AgentUpdateInput; res: Agent };
  'agent:delete': { req: { id: string }; res: void };
  'agent:move': { req: AgentMoveRequest; res: void };
  'agent:setDefaultRepository': {
    req: { agentId: string; repositoryId: string | null };
    res: Agent;
  };
  'agentTemplate:create': { req: AgentTemplateCreateInput; res: AgentTemplate };
  'agentTemplate:delete': { req: { id: string }; res: void };
  'agentTemplate:spawn': { req: AgentTemplateSpawnInput; res: Agent };
  'repository:import': { req: RepositoryImportRequest; res: Repository };
  'repository:overview': { req: RepositoryInspectRequest; res: RepositoryOverview };
  'repository:pullRequests': {
    req: RepositoryInspectRequest;
    res: RepositoryPullRequestResult;
  };
  'repository:commitDiff': { req: RepositoryCommitDiffRequest; res: RepositoryCommitDiff };
  'workspace:describe': { req: WorkspaceDescribeRequest; res: WorkspaceScopeDescriptor };
  'workspace:removeBinding': { req: WorkspaceRemoveBindingRequest; res: WorkspaceRemoveBindingResult };
  'clipboard:readText': { req: void; res: ClipboardReadTextResult };
  'clipboard:writeText': { req: ClipboardWriteTextRequest; res: void };
  'pty:create': { req: PtyCreateRequest; res: SessionMeta };
  'pty:write': { req: PtyWriteRequest; res: void };
  'pty:resize': { req: PtyResizeRequest; res: void };
  'pty:kill': { req: PtyKillRequest; res: void };
  'pty:attach': { req: PtyAttachRequest; res: PtyAttachResult };
  'pty:activitySnapshot': { req: PtyAttachRequest; res: PtyActivityResult };
  'runTask:activity': { req: { taskId: string }; res: PtyActivityResult };
  'pty:list': { req: void; res: PtyListResult };
  'pty:cancelTasks': { req: PtyCancelTasksRequest; res: PtyCancelTasksResult };
  'runtime:diagnose': { req: RuntimeDiagnoseRequest; res: RuntimeDiagnosticsResult };
  'run:get': { req: void; res: OrchestrationSnapshot };
  'run:getSummary': { req: RunSummaryRequest; res: RunSummary[] };
  'run:events': { req: RunEventsRequest; res: RunEventsResult };
  'run:approvalDiff': { req: { runId: string }; res: ApprovalDiffResult };
  'run:publicationPreview': { req: { runId: string }; res: RunPublicationPreview };
  'run:publish': {
    req: {
      runId: string;
      expectedHeadSha: string;
      expectedHeadBranch: string;
      commandId?: string;
    };
    res: RunPublication;
  };
  'run:create': { req: RunCreateInput; res: Run };
  'run:delete': { req: { runId: string }; res: void };
  'run:start': { req: RunLifecycleRequest; res: Run };
  'run:cancel': { req: RunLifecycleRequest; res: void };
  'run:pauseTeam': { req: RunTeamPauseRequest; res: Run };
  'run:resumeTeam': { req: RunTeamPauseRequest; res: Run };
  'runApproval:resolve': {
    req: { approvalId: string; decision: 'approve' | 'reject'; commandId?: string };
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
  'fs:pathInfo': { req: FsReadRequest; res: FsPathInfoResult };
  'fs:reveal': { req: FsReadRequest; res: void };
  'fs:openPath': { req: FsReadRequest; res: void };
  'fs:rename': { req: FsRenameRequest; res: FsRenameResult };
  'fs:delete': { req: FsReadRequest; res: void };
  'dialog:pickFolder': { req: void; res: DialogPickFolderResult };
  'wsl:list': { req: void; res: WslListResult };
}

/** Payload map for every main -> renderer event channel. */
export interface IpcEventMap {
  'pty:data': PtyDataEvent;
  'pty:activity': PtyActivityEvent;
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
