/** Observed provider usage. Null means unavailable, never zero or free. */
export interface TokenCounts {
  /** Includes the reported cache categories. Do not add them again. */
  input: number | null;
  inputUncached: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  /** Part of output where separately reported, not extra output. */
  reasoning: number | null;
}
export type UsageProvider = 'codex' | 'claude' | 'grok' | 'elevenlabs';
export type UsageCostKind = 'unknown' | 'provider-estimate' | 'provider-reported' | 'configured-estimate';
export type UsageProduct = 'coding' | 'dictation' | 'speech-test' | 'speech-reply';

export const TOKEN_FIELDS = ['input', 'inputUncached', 'output', 'cacheRead', 'cacheWrite', 'reasoning'] as const;
export const unknownTokens = (): TokenCounts => ({ input: null, inputUncached: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null });

export interface UsageAmounts {
  tokens: TokenCounts;
  audioSeconds: number | null;
  characters: number | null;
  credits: number | null;
  costUsd: number | null;
  costKind: UsageCostKind;
  costComplete: boolean | null;
}
