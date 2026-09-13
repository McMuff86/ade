import type { RuntimeId } from './types';
/** Only the chosen provider's key is evidence; unrelated service/provider keys do not count. */
export function providerApiKeyPresent(runtime: RuntimeId, ...environments: Array<Record<string, string | undefined>>): boolean {
  const names = runtime === 'codex' ? ['OPENAI_API_KEY', 'CODEX_API_KEY'] : runtime === 'claude' ? ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] : runtime === 'grok' ? ['XAI_API_KEY'] : [];
  return environments.some(env => names.some(name => !!env[name]));
}
