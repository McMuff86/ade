/**
 * Core shared types — per docs/ARCHITECTURE.md "Core types (shared/types.ts)".
 * This file is the contract between main, preload and renderer; phase agents
 * must not change these shapes outside the contract.
 */

export type PermissionMode = 'default' | 'accept-edits' | 'bypass';

/** Codex CLI reasoning levels supported by current config.toml/CLI releases. */
export type CodexReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'ultra';

/** Product defaults for newly created Codex agents. Existing agents migrate explicitly. */
export const DEFAULT_CODEX_MODEL = 'gpt-5.6-sol';
export const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = 'high';

export type RuntimeId =
  | 'claude'
  | 'codex'
  | 'opencode'
  | 'grok'
  | 'gemini'
  | 'ollama'
  | 'shell'
  | 'custom';

export type ExecutionScopeSource = 'explicit' | 'agent-default' | 'plain-home';

/** First-class local Git repository catalog entry (Goal 5). */
export interface Repository {
  id: string;
  name: string;
  /** Canonical main-worktree root chosen for new ADE worktrees. */
  rootPath: string;
  /** Canonical shared Git metadata directory used to deduplicate worktrees. */
  commonGitDir: string;
  /** False only for a legacy record that still needs on-disk verification. */
  verified: boolean;
  createdAt: number;
}

/** One persistent agent/repository worktree pairing. */
export interface WorkspaceBinding {
  id: string;
  agentId: string;
  repositoryId: string;
  workspaceDir: string;
  branch: string;
  status: 'ready' | 'legacy-unverified' | 'invalid';
  createdAt: number;
  lastUsedAt: number;
}

/** Immutable defaults used to spawn an independent agent identity. */
export interface AgentTemplate {
  id: string;
  name: string;
  role?: string;
  photo?: string;
  runtime: RuntimeId;
  permissionMode: PermissionMode;
  customCommand?: string;
  ollamaModel?: string;
  /** Exact Codex CLI model id, e.g. "gpt-5.6-sol". */
  codexModel?: string;
  codexReasoningEffort?: CodexReasoningEffort;
  memorySeed: {
    memory: string;
    user: string;
  };
  createdAt: number;
  updatedAt: number;
}

/** Renderer-safe description of the workspace selected for one execution. */
export interface WorkspaceScopeDescriptor {
  agentId: string;
  source: ExecutionScopeSource;
  repositoryId?: string;
  repositoryName?: string;
  workspaceBindingId?: string;
  workspaceDir: string;
  branch: string;
  isRepo: boolean;
  isDefault: boolean;
  activeLease: boolean;
}

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
  /** Goal 5 replacement for category-owned repoPath; onboarding convenience only. */
  defaultRepositoryId?: string;
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
  /** Exact model pin for the Codex runtime, e.g. "gpt-5.6-sol". */
  codexModel?: string;
  /** Persisted Codex reasoning level passed to every interactive and managed launch. */
  codexReasoningEffort?: CodexReasoningEffort;
  /** resolved absolute path of the agent workspace (worktree when repo-backed) */
  workspaceDir: string;
  /** Plain, repository-independent workspace. Missing only in pre-Goal-5 config. */
  homeWorkspaceDir?: string;
  /** Used for future executions that do not provide an explicit repository. */
  defaultRepositoryId?: string;
  /** absolute path of the agent memory directory (MEMORY.md / USER.md) */
  memoryDir: string;
  /** Graph-mode role; absent = a plain agent (not part of the orchestration). */
  teamRole?: TeamRole;
}

export type SessionKind = 'interactive' | 'task';
export type PtyExitReason = 'exit' | 'cancelled';

export interface SessionMeta {
  id: string;
  agentId: string;
  title: string;
  kind: SessionKind;
  status: 'running' | 'exited';
  createdAt: number;
  endedAt?: number;
  exitCode?: number;
  /** Preserved in the main-owned session snapshot so reloads keep exit semantics. */
  exitReason?: PtyExitReason;
  dispatchId?: string;
  runTaskId?: string;
  /** Immutable execution scope resolved before the PTY was spawned. */
  repositoryId?: string;
  workspaceBindingId?: string;
  workspaceDir?: string;
  scopeSource?: ExecutionScopeSource;
}

export interface TaskQueueStatus {
  active: number;
  queued: number;
  maxActive: number;
}

/* ---------------------------------------------------------- diagnostics */

export type RuntimeDiagnosticStatus = 'ready' | 'warning' | 'error';
export type RuntimeAuthStatus =
  | 'authenticated'
  | 'not-authenticated'
  | 'not-required'
  | 'unknown';

/** One configured agent's non-mutating CLI/auth readiness check. */
export interface RuntimeDiagnostic {
  agentId: string;
  agentName: string;
  runtime: RuntimeId;
  label: string;
  /** Safe display value; custom command text is deliberately never returned. */
  command: string;
  /** null when a custom override is intentionally not executed. */
  installed: boolean | null;
  version?: string;
  authStatus: RuntimeAuthStatus;
  authDetail: string;
  taskTransport: 'argument' | 'stdin' | 'unavailable';
  status: RuntimeDiagnosticStatus;
  message: string;
}

export interface RuntimeDiagnosticsResult {
  checkedAt: number;
  platform: string;
  items: RuntimeDiagnostic[];
}

/* --------------------------------------------------------- orchestration */

export type RunStatus = 'draft' | 'running' | 'completed' | 'failed' | 'cancelled';
export type RunMode = 'manual' | 'managed';
export type RunPhase =
  | 'draft'
  | 'planning'
  | 'working'
  | 'approval'
  | 'integrating'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type RunTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type RunTaskPhase = 'manual' | 'plan' | 'work' | 'integrate' | 'verify';
export type RunParticipantRole = 'orchestrator' | 'lead' | 'worker';
export type RunEventType =
  | 'run.created'
  | 'run.started'
  | 'run.phase_changed'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'participant.added'
  | 'task.queued'
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled'
  | 'task.result_recorded'
  | 'approval.requested'
  | 'approval.resolved'
  | 'workspace.acquired'
  | 'workspace.released'
  | 'message.sent'
  | 'integration.applied'
  | 'budget.exhausted'
  | 'artifact.created'
  | 'team.paused'
  | 'team.resumed';

/** Hard scheduling limits for a managed run. Null means no limit. */
export interface RunBudget {
  maxConcurrentTasks: number;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  maxCostUsd: number | null;
  maxApprovals: number;
}

export const DEFAULT_RUN_BUDGET: RunBudget = {
  maxConcurrentTasks: 2,
  maxInputTokens: null,
  maxOutputTokens: null,
  maxCostUsd: null,
  maxApprovals: 1,
};

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  approvals: number;
  /** Tasks whose adapter did not report monetary cost. */
  unreportedCostTasks: number;
}

export interface Run {
  id: string;
  name: string;
  goal: string;
  status: RunStatus;
  mode: RunMode;
  phase: RunPhase;
  budget: RunBudget;
  createdAt: number;
  updatedAt: number;
  source?: 'native' | 'legacy-graph';
  /** undefined = legacy/default resolution; null = explicit plain workspace. */
  repositoryId?: string | null;
  /**
   * Main-owned SHA-256 of the canonical run-context manifest. Older runs do
   * not have one and intentionally cannot restore context from artifacts.
   */
  contextManifestHash?: string;
  /**
   * Teams whose queued managed work the scheduler must skip. Materialized from
   * the team.paused/team.resumed journal events; running tasks are unaffected.
   */
  pausedTeamIds?: string[];
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
  /** Run-level repository snapshot; binding is resolved per participant later. */
  repositoryId?: string | null;
  createdAt: number;
}

export interface RunTask {
  id: string;
  runId: string;
  participantId: string;
  prompt: string;
  title: string;
  phase: RunTaskPhase;
  managed: boolean;
  dependsOn: string[];
  attempt: number;
  status: RunTaskStatus;
  sessionId?: string;
  /** Immutable repository/worktree snapshot selected when the task was queued. */
  repositoryId?: string | null;
  workspaceBindingId?: string;
  workspaceDir?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  endedAt?: number;
  exitCode?: number;
  error?: string;
}

export interface WorkerAssignment {
  participantId: string;
  title: string;
  prompt: string;
  acceptanceCriteria: string[];
  /** Participant ids whose assignments must complete first. */
  dependsOn: string[];
}

export interface RunTaskTestResult {
  command: string;
  status: 'passed' | 'failed' | 'skipped';
  output: string;
}

export interface TaskUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

/** Runtime-neutral, schema-validated result produced by every managed task. */
export interface StructuredTaskResult {
  version: 1;
  outcome: 'succeeded' | 'failed' | 'blocked';
  summary: string;
  assignments: WorkerAssignment[];
  filesChanged: string[];
  tests: RunTaskTestResult[];
  commitSha: string | null;
  risks: string[];
  usage: TaskUsage;
}

export interface RunTaskResult extends StructuredTaskResult {
  id: string;
  runId: string;
  taskId: string;
  participantId: string;
  adapterId: string;
  resultPath: string;
  createdAt: number;
}

export type RunApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface RunApproval {
  id: string;
  runId: string;
  type: 'integration';
  status: RunApprovalStatus;
  reason: string;
  requestedAt: number;
  resolvedAt?: number;
}

export interface RunWorkspaceLease {
  id: string;
  runId: string;
  participantId: string;
  agentId: string;
  workspaceDir: string;
  isRepo: boolean;
  branch: string;
  baseSha: string;
  commonGitDir: string;
  repositoryId?: string;
  workspaceBindingId?: string;
  status: 'active' | 'released';
  acquiredAt: number;
  releasedAt?: number;
}

export interface RunMessage {
  id: string;
  runId: string;
  taskId?: string;
  fromParticipantId?: string;
  toParticipantId: string;
  kind: 'plan' | 'assignment' | 'result' | 'integration' | 'verification';
  text: string;
  createdAt: number;
  /** Globally monotonic journal cursor shared with RunEvent (run:events). */
  seq: number;
}

export interface RunEvent {
  id: string;
  runId: string;
  type: RunEventType;
  createdAt: number;
  taskId?: string;
  participantId?: string;
  data?: Record<string, string | number | boolean | null>;
  /** Globally monotonic journal cursor shared with RunMessage (run:events). */
  seq: number;
}

export interface RunArtifact {
  id: string;
  runId: string;
  taskId?: string;
  kind: 'file' | 'patch' | 'message' | 'result';
  path?: string;
  content?: string;
  /** Execution scope inherited from the owning task/run at creation time. */
  repositoryId?: string | null;
  workspaceBindingId?: string;
  workspaceDir?: string;
  createdAt: number;
}

/* ------------------------------------------------ sanitized run summaries */

export interface RunSummaryTeam {
  id: string;
  name: string;
  paused: boolean;
}

export interface RunSummaryParticipant {
  id: string;
  agentName: string;
  role: RunParticipantRole;
  teamId?: string;
  teamName?: string;
}

export interface RunSummaryTask {
  id: string;
  participantId: string;
  title: string;
  phase: RunTaskPhase;
  status: RunTaskStatus;
  attempt: number;
  managed: boolean;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
}

/**
 * Bounded, transport-safe projection of one run. Deliberately excludes
 * absolute paths, prompts, mailbox texts, artifact contents and lease paths
 * (REMOTE_CONTROL_PLAN exclusions) so the Graph canvas and the future mobile
 * DTO can consume the same shape.
 */
export interface RunSummary {
  id: string;
  name: string;
  goal: string;
  status: RunStatus;
  mode: RunMode;
  phase: RunPhase;
  repositoryId?: string | null;
  repositoryName?: string;
  branch?: string;
  teams: RunSummaryTeam[];
  participants: RunSummaryParticipant[];
  tasks: RunSummaryTask[];
  budget: RunBudget;
  usage: RunUsage;
  pendingApprovalId: string | null;
  pausedTeamIds: string[];
  createdAt: number;
  updatedAt: number;
  /** Highest journal seq at snapshot time; resume deltas via run:events. */
  seqCursor: number;
}

/** One recorded mutating command; the same commandId replays resultJson. */
export interface CommandLogEntry {
  commandId: string;
  channel: string;
  createdAt: number;
  /** JSON-serialized successful result. Failed commands are never recorded. */
  resultJson: string;
}

/**
 * Version/provenance metadata stamped into every managed task's context packet
 * (P0a observability). Fields that an adapter cannot report reliably stay
 * absent — unknown telemetry remains unknown, never fabricated.
 */
export interface TaskProvenance {
  promptVersion: number;
  resultSchemaVersion: number;
  adapterId: string;
  contextBuilderVersion?: number;
  contextManifestHash?: string;
  modelId?: string;
  reasoningEffort?: CodexReasoningEffort;
}

export interface OrchestrationSnapshot {
  runs: Run[];
  participants: RunParticipant[];
  tasks: RunTask[];
  events: RunEvent[];
  artifacts: RunArtifact[];
  results: RunTaskResult[];
  approvals: RunApproval[];
  workspaceLeases: RunWorkspaceLease[];
  messages: RunMessage[];
  usageByRun: Record<string, RunUsage>;
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
   * Optional for migration compatibility; the store fills it from
   * DEFAULT_CONFIG when older config files are loaded.
   */
  memory?: MemorySettings;
  /**
   * Optional override for where ADE creates agent worktrees. When absent,
   * new worktrees land in `.ade-worktrees` next to the repository root.
   * Existing bindings keep their recorded absolute paths either way.
   */
  worktreeBaseDir?: string;
}

/** Persisted app config (main/config/store.ts, userData/ade/config.json). */
export interface AdeConfig {
  categories: Category[];
  agents: Agent[];
  repositories: Repository[];
  workspaceBindings: WorkspaceBinding[];
  agentTemplates: AgentTemplate[];
  runs: Run[];
  runParticipants: RunParticipant[];
  runTasks: RunTask[];
  runEvents: RunEvent[];
  runArtifacts: RunArtifact[];
  runTaskResults: RunTaskResult[];
  runApprovals: RunApproval[];
  runWorkspaceLeases: RunWorkspaceLease[];
  runMessages: RunMessage[];
  /** Bounded FIFO idempotency journal for mutating orchestration commands. */
  commandLog: CommandLogEntry[];
  settings: Settings;
}

export const DEFAULT_CONFIG: AdeConfig = {
  categories: [],
  agents: [],
  repositories: [],
  workspaceBindings: [],
  agentTemplates: [],
  runs: [],
  runParticipants: [],
  runTasks: [],
  runEvents: [],
  runArtifacts: [],
  runTaskResults: [],
  runApprovals: [],
  runWorkspaceLeases: [],
  runMessages: [],
  commandLog: [],
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
  defaultRepositoryId?: string;
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
  codexModel?: string;
  codexReasoningEffort?: CodexReasoningEffort;
  teamRole?: TeamRole;
  /** null creates a portable agent; undefined inherits the category default. */
  defaultRepositoryId?: string | null;
}

export interface AgentUpdateInput {
  id: string;
  name: string;
  role?: string;
  runtime: RuntimeId;
  permissionMode: PermissionMode;
  customCommand?: string;
  ollamaModel?: string;
  codexModel?: string;
  codexReasoningEffort?: CodexReasoningEffort;
  /** Optional topology repair/administration field; omitted updates preserve the role. */
  teamRole?: TeamRole;
  /** null clears the default; undefined preserves it. */
  defaultRepositoryId?: string | null;
}

export interface AgentTemplateCreateInput {
  sourceAgentId: string;
  name: string;
}

export interface AgentTemplateSpawnInput {
  templateId: string;
  categoryId: string;
  name?: string;
  role?: string;
  photo?: string;
  runtime?: RuntimeId;
  permissionMode?: PermissionMode;
  customCommand?: string;
  ollamaModel?: string;
  codexModel?: string;
  codexReasoningEffort?: CodexReasoningEffort;
  defaultRepositoryId?: string | null;
}

export interface RunCreateInput {
  name: string;
  goal?: string;
  /** null forces plain workspaces; undefined preserves legacy/default behavior. */
  repositoryId?: string | null;
  participants: Array<{
    agentId: string;
    role: RunParticipantRole;
    teamId?: string;
    teamName?: string;
  }>;
  budget?: Partial<RunBudget>;
  /** Optional idempotency key; a replay returns the originally created run. */
  commandId?: string;
}

export interface RunTaskCreateInput {
  runId: string;
  participantId: string;
  prompt: string;
}
