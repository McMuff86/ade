import type { ExecutionBackendId } from './executionBackends';
import type { CodexReasoningEffort } from './types';

export const MODEL_RUNTIMES = ['codex', 'grok', 'claude', 'ollama'] as const;
export type ModelRuntime = typeof MODEL_RUNTIMES[number];
export interface RuntimeModelRequest { runtime: ModelRuntime; backend?: ExecutionBackendId }
export interface RuntimeModelOption {
  id: string;
  name: string;
  description?: string;
  resolvedModel?: string;
  isDefault: boolean;
  reasoningEfforts?: CodexReasoningEffort[];
  defaultReasoningEffort?: CodexReasoningEffort;
}
export interface RuntimeModelCatalog {
  runtime: ModelRuntime;
  backend: ExecutionBackendId;
  status: 'ready' | 'empty' | 'unavailable';
  models: RuntimeModelOption[];
  checkedAt: number;
  message: string;
}
