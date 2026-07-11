/**
 * Core shared types — per docs/ARCHITECTURE.md "Core types (shared/types.ts)".
 * This file is the contract between main, preload and renderer; phase agents
 * must not change these shapes outside the contract.
 */

export type PermissionMode = 'default' | 'accept-edits' | 'bypass';

export type RuntimeId =
  | 'claude'
  | 'codex'
  | 'opencode'
  | 'grok'
  | 'gemini'
  | 'ollama'
  | 'shell'
  | 'custom';

/**
 * Orchestration role of a category in Graph mode.
 * - undefined / 'plain': an ordinary rail category (unchanged behaviour).
 * - 'orchestrator': the single container holding the orchestrator agent.
 * - 'team': a team; its agents carry teamRole 'lead' | 'worker'.
 */
export type CategoryKind = 'plain' | 'orchestrator' | 'team';

export interface Category {
  id: string;
  name: string;
  /** photos/<file> under userData */
  photo?: string;
  /** optional git repo backing this category */
  repoPath?: string;
  /** agent ids, in rail order */
  agents: string[];
  /** Graph-mode role; absent = plain category. */
  kind?: CategoryKind;
}

/** Orchestration role of an agent inside the Graph. */
export type TeamRole = 'orchestrator' | 'lead' | 'worker';

export interface Agent {
  id: string;
  categoryId: string;
  name: string;
  role?: string;
  /** photos/<file> under userData */
  photo?: string;
  runtime: RuntimeId;
  permissionMode: PermissionMode;
  /** overrides the launch profile when set */
  customCommand?: string;
  /** model name for the ollama runtime, e.g. "llama3.3" */
  ollamaModel?: string;
  /** resolved absolute path of the agent workspace (worktree when repo-backed) */
  workspaceDir: string;
  /** absolute path of the agent memory directory (MEMORY.md / USER.md) */
  memoryDir: string;
  /** Graph-mode role; absent = a plain agent (not part of the orchestration). */
  teamRole?: TeamRole;
}

export type SessionKind = 'interactive' | 'task';

export interface SessionMeta {
  id: string;
  agentId: string;
  title: string;
  kind: SessionKind;
  status: 'running' | 'exited';
  createdAt: number;
  endedAt?: number;
  exitCode?: number;
  dispatchId?: string;
  runTaskId?: string;
}

export interface TaskQueueStatus {
  active: number;
  queued: number;
  maxActive: number;
}

/* --------------------------------------------------------- orchestration */

export type RunStatus = 'draft' | 'running' | 'completed' | 'failed' | 'cancelled';
export type RunTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type RunParticipantRole = 'orchestrator' | 'lead' | 'worker';
export type RunEventType =
  | 'run.created'
  | 'participant.added'
  | 'task.queued'
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled'
  | 'artifact.created';

export interface Run {
  id: string;
  name: string;
  goal: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  source?: 'native' | 'legacy-graph';
}

export interface RunParticipant {
  id: string;
  runId: string;
  agentId: string;
  /** Snapshot fields keep historical runs readable after an agent is deleted. */
  agentName: string;
  runtime: RuntimeId;
  role: RunParticipantRole;
  teamId?: string;
  teamName?: string;
  createdAt: number;
}

export interface RunTask {
  id: string;
  runId: string;
  participantId: string;
  prompt: string;
  status: RunTaskStatus;
  sessionId?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  endedAt?: number;
  exitCode?: number;
  error?: string;
}

export interface RunEvent {
  id: string;
  runId: string;
  type: RunEventType;
  createdAt: number;
  taskId?: string;
  participantId?: string;
  data?: Record<string, string | number | boolean | null>;
}

export interface RunArtifact {
  id: string;
  runId: string;
  taskId?: string;
  kind: 'file' | 'patch' | 'message' | 'result';
  path?: string;
  content?: string;
  createdAt: number;
}

export interface OrchestrationSnapshot {
  runs: Run[];
  participants: RunParticipant[];
  tasks: RunTask[];
  events: RunEvent[];
  artifacts: RunArtifact[];
}

/* ---------------------------------------------------------------- settings */

export type ThemeName = 'dark' | 'light';

/** Per-agent Hermes-style memory knobs (main/memory/*). */
export interface MemorySettings {
  /** Master switch: when false, scaffold + CLAUDE.md/AGENTS.md injection skip. */
  enabled: boolean;
  /** Whether the USER.md profile block is maintained and injected. */
  userProfileEnabled: boolean;
  /** Hard cap for MEMORY.md, in chars. */
  memoryCharLimit: number;
  /** Hard cap for USER.md, in chars. */
  userCharLimit: number;
}

export interface Settings {
  theme: ThemeName;
  /**
   * Optional so existing partial `config:save({ settings: { theme } })` calls
   * keep compiling; the store always fills it from DEFAULT_CONFIG on load.
   */
  memory?: MemorySettings;
}

/** Persisted app config (main/config/store.ts, userData/ade/config.json). */
export interface AdeConfig {
  categories: Category[];
  agents: Agent[];
  runs: Run[];
  runParticipants: RunParticipant[];
  runTasks: RunTask[];
  runEvents: RunEvent[];
  runArtifacts: RunArtifact[];
  settings: Settings;
}

export const DEFAULT_CONFIG: AdeConfig = {
  categories: [],
  agents: [],
  runs: [],
  runParticipants: [],
  runTasks: [],
  runEvents: [],
  runArtifacts: [],
  settings: {
    theme: 'dark',
    memory: {
      enabled: true,
      userProfileEnabled: true,
      memoryCharLimit: 2200,
      userCharLimit: 1375,
    },
  },
};

/* ------------------------------------------------------------ git & files */

export type GitFileState = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';

export interface GitFileChange {
  path: string;
  additions: number;
  deletions: number;
  state: GitFileState;
}

export interface GitStatus {
  /**
   * Whether the agent's workspaceDir is inside a git repo/worktree. Non-repo
   * workspaces return isRepo:false (branch '', no files) rather than throwing.
   */
  isRepo: boolean;
  branch: string;
  ahead: number;
  behind: number;
  files: GitFileChange[];
}

/** Workspace file-tree node (depth-limited; children lazy — undefined = not loaded). */
export interface FsTreeNode {
  name: string;
  path: string; // relative to workspaceDir
  kind: 'file' | 'dir';
  children?: FsTreeNode[];
}

/**
 * A pinned "agent file" (MEMORY.md / USER.md / CLAUDE.md / AGENTS.md) that
 * exists either in the agent's workspaceDir or its memoryDir. `path` is what to
 * pass to fs:read (a bare filename; main resolves workspace-first, memory-next).
 */
export interface AgentFile {
  name: string;
  path: string;
  location: 'workspace' | 'memory';
}

/* ------------------------------------------------------------ create inputs */

export interface CategoryCreateInput {
  name: string;
  photo?: string;
  repoPath?: string;
  kind?: CategoryKind;
}

export interface AgentCreateInput {
  categoryId: string;
  name: string;
  role?: string;
  photo?: string;
  runtime: RuntimeId;
  permissionMode: PermissionMode;
  customCommand?: string;
  ollamaModel?: string;
  teamRole?: TeamRole;
}

export interface AgentUpdateInput {
  id: string;
  name: string;
  role?: string;
  runtime: RuntimeId;
  permissionMode: PermissionMode;
  customCommand?: string;
  ollamaModel?: string;
}

export interface RunCreateInput {
  name: string;
  goal?: string;
  participants: Array<{
    agentId: string;
    role: RunParticipantRole;
    teamId?: string;
    teamName?: string;
  }>;
}

export interface RunTaskCreateInput {
  runId: string;
  participantId: string;
  prompt: string;
}
