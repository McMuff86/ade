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

export interface Category {
  id: string;
  name: string;
  /** photos/<file> under userData */
  photo?: string;
  /** optional git repo backing this category */
  repoPath?: string;
  /** agent ids, in rail order */
  agents: string[];
}

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
}

export interface SessionMeta {
  id: string;
  agentId: string;
  title: string;
  status: 'running' | 'exited';
  createdAt: number;
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
  settings: Settings;
}

export const DEFAULT_CONFIG: AdeConfig = {
  categories: [],
  agents: [],
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

/* ------------------------------------------------------------ create inputs */

export interface CategoryCreateInput {
  name: string;
  photo?: string;
  repoPath?: string;
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
}
