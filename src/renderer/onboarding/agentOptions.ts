import type { PermissionMode, RuntimeId } from '../../shared/types';

export const AGENT_RUNTIMES: ReadonlyArray<{ id: RuntimeId; label: string }> = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
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
