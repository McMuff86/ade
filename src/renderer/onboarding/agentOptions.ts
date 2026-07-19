import type { CodexReasoningEffort, PermissionMode, RuntimeId } from '../../shared/types';

export const AGENT_RUNTIMES: ReadonlyArray<{ id: RuntimeId; label: string }> = [
  { id: 'codex', label: 'Codex (recommended)' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'grok', label: 'Grok Build' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'ollama', label: 'Ollama (local model)' },
  { id: 'shell', label: 'Plain shell' },
  { id: 'custom', label: 'Custom command' },
];

export const AGENT_PERMISSION_MODES: ReadonlyArray<{ id: PermissionMode; label: string }> = [
  { id: 'default', label: 'Default (ask each time)' },
  { id: 'accept-edits', label: 'Accept edits' },
  { id: 'bypass', label: 'Bypass approvals (dangerous)' },
];

export const CODEX_REASONING_EFFORTS: ReadonlyArray<{
  id: CodexReasoningEffort;
  label: string;
}> = [
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high' },
  { id: 'max', label: 'Max' },
  { id: 'ultra', label: 'Ultra (multi-agent)' },
  { id: 'low', label: 'Low' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'none', label: 'None' },
];
