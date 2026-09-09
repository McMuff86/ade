import type { SessionLaunchChoice } from './remote';
import { OLLAMA_MODEL_PATTERN } from './runtimes';

export const SESSION_LAUNCH_LABELS: Record<SessionLaunchChoice['mode'], string> = {
  shell: 'Leeres Terminal', agent: 'Gespeichertes Agent-Profil', codex: 'Codex', claude: 'Claude CLI', grok: 'Grok CLI', hermes: 'Hermes', ollama: 'Ollama',
};
export function validSessionChoice(value: Record<string, unknown>): boolean {
  return ['shell', 'agent', 'codex', 'claude', 'grok', 'hermes', 'ollama'].includes(String(value.mode))
    && (value.mode === 'ollama' ? typeof value.model === 'string' && OLLAMA_MODEL_PATTERN.test(value.model) : value.model === undefined);
}
