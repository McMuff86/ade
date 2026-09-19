import { t as translate } from "../../shared/i18n";
import { localizedLabels } from "../../shared/i18n/labels";
import type { CodexReasoningEffort, GrokReasoningEffort, PermissionMode, RuntimeId } from '../../shared/types';

export const AGENT_RUNTIMES: ReadonlyArray<{ id: RuntimeId; label: string }> = localizedLabels(() => ([
  { id: 'codex', label: translate("Codex (recommended)") },
  { id: 'claude', label: translate("Claude Code") },
  { id: 'opencode', label: translate("OpenCode") },
  { id: 'grok', label: translate("Grok Build") },
  { id: 'gemini', label: translate("Gemini") },
  { id: 'ollama', label: translate("Ollama (local model)") },
  { id: 'shell', label: translate("Plain shell") },
  { id: 'custom', label: translate("Custom command") },
]));

export const AGENT_PERMISSION_MODES: ReadonlyArray<{ id: PermissionMode; label: string }> = localizedLabels(() => ([
  { id: 'default', label: translate("Default (ask each time)") },
  { id: 'accept-edits', label: translate("Accept edits") },
  { id: 'bypass', label: translate("Bypass approvals (dangerous)") },
]));

export const CODEX_REASONING_EFFORTS: ReadonlyArray<{
  id: CodexReasoningEffort;
  label: string;
}> = localizedLabels(() => ([
  { id: 'medium', label: translate("Medium") },
  { id: 'high', label: translate("High") },
  { id: 'xhigh', label: translate("Extra high") },
  { id: 'max', label: translate("Max") },
  { id: 'ultra', label: translate("Ultra (multi-agent)") },
  { id: 'low', label: translate("Low") },
  { id: 'minimal', label: translate("Minimal") },
  { id: 'none', label: translate("None [4e6f6e65]") },
]));

export const GROK_REASONING_EFFORTS: ReadonlyArray<{
  id: GrokReasoningEffort;
  label: string;
}> = localizedLabels(() => ([
  { id: 'medium', label: translate("Medium") },
  { id: 'high', label: translate("High") },
  { id: 'xhigh', label: translate("Extra high") },
  { id: 'max', label: translate("Max") },
  { id: 'low', label: translate("Low") },
  { id: 'minimal', label: translate("Minimal") },
  { id: 'none', label: translate("None [4e6f6e65]") },
]));
