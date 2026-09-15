import type { TokenCounts } from '../../shared/usage';

export interface UsageSample {
  kind: 'cumulative' | 'request' | 'turn';
  key: string;
  model: string | null;
  tokens: TokenCounts;
  costUsd: number | null;
  costKind: 'unknown' | 'provider-estimate' | 'provider-reported';
  costComplete: boolean | null;
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const modelName = (value: unknown): string | null => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(value) ? value : null;
const identifier = (value: unknown): string | null => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(value) ? value : null;
const dollars = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9 ? value : null;
const completeSum = (...values: Array<number | null>): number | null => values.every(value => value !== null) ? count(values.reduce<number>((sum, value) => sum + value!, 0)) : null;
function sane(tokens: TokenCounts): boolean {
  if (tokens.input === null && tokens.inputUncached === null && tokens.output === null) return false;
  if (tokens.reasoning !== null && tokens.output !== null && tokens.reasoning > tokens.output) return false;
  if (tokens.input === null) return true;
  if (tokens.cacheRead !== null && tokens.cacheRead > tokens.input) return false;
  if (tokens.cacheWrite !== null && tokens.cacheWrite > tokens.input) return false;
  const cached = completeSum(tokens.cacheRead, tokens.cacheWrite);
  return cached === null || cached <= tokens.input;
}

/** Reads ONLY the already identified rollout's token_count event, never raw
 * OTLP response.completed events (which also include preparation excluded
 * from the CLI's final usage; its billing cannot be inferred from that). */
export function codexSnapshot(value: unknown, model: string | null, key: string): UsageSample | null {
  const item = record(value); const payload = record(item.payload);
  if (item.type !== 'event_msg' || payload.type !== 'token_count' || !identifier(key)) return null;
  const usage = record(record(payload.info).total_token_usage);
  const tokens: TokenCounts = { input: count(usage.input_tokens), inputUncached: null, output: count(usage.output_tokens),
    cacheRead: count(usage.cached_input_tokens), cacheWrite: count(usage.cache_write_input_tokens), reasoning: count(usage.reasoning_output_tokens) };
  tokens.inputUncached = uncached(tokens);
  return sane(tokens) ? { kind: 'cumulative', key, model: modelName(model), tokens, costUsd: null, costKind: 'unknown', costComplete: null } : null;
}

/** Attributes have already been decoded from bounded OTLP by the trusted
 * launch-bound receiver. Claude's input excludes BOTH cache categories. */
export function claudeRequest(attributes: Record<string, unknown>, key: string): UsageSample | null {
  if (!identifier(key)) return null;
  const cacheRead = count(attributes.cache_read_tokens); const cacheWrite = count(attributes.cache_creation_tokens);
  const input = completeSum(count(attributes.input_tokens), cacheRead, cacheWrite);
  const tokens: TokenCounts = { input, inputUncached: count(attributes.input_tokens), output: count(attributes.output_tokens), cacheRead, cacheWrite, reasoning: null };
  if (!sane(tokens)) return null;
  const costUsd = dollars(attributes.cost_usd);
  return { kind: 'request', key, model: modelName(attributes.model), tokens, costUsd,
    costKind: costUsd === null ? 'unknown' : 'provider-estimate', costComplete: costUsd === null ? null : true };
}

/** Grok ACP turn totals already include cache reads; reasoning is part of
 * output. Ticks are 10^10 per USD. Cost coverage is not inferred from zero. */
export function grokTurn(value: unknown): UsageSample | null {
  const params = record(record(value).params); const update = record(params.update);
  if (update.sessionUpdate !== 'turn_completed') return null;
  const key = identifier(record(params._meta).eventId); if (!key) return null;
  const usage = record(update.usage);
  const tokens: TokenCounts = { input: count(usage.inputTokens), inputUncached: null, output: count(usage.outputTokens),
    cacheRead: count(usage.cachedReadTokens), cacheWrite: count(usage.cacheCreationTokens), reasoning: count(usage.reasoningTokens) };
  tokens.inputUncached = uncached(tokens);
  if (!sane(tokens)) return null;
  const ticks = count(usage.costUsdTicks); const costUsd = ticks === null ? null : dollars(ticks / 1e10);
  const models = Object.keys(record(usage.modelUsage));
  return { kind: 'turn', key, model: models.length === 1 ? modelName(models[0]) : null, tokens, costUsd,
    costKind: costUsd === null ? 'unknown' : 'provider-reported', costComplete: null };
}

/** A cumulative counter rollback is a coverage gap, never negative usage.
 * Null fields remain unknown even when the other fields have a known delta. */
export function tokenDelta(next: TokenCounts, previous: TokenCounts): TokenCounts | null {
  const delta = {} as TokenCounts;
  for (const field of ['input', 'inputUncached', 'output', 'cacheRead', 'cacheWrite', 'reasoning'] as const) {
    const current = next[field]; const old = previous[field];
    if (current !== null && old !== null && current < old) return null;
    delta[field] = current === null || old === null ? null : current - old;
  }
  return sane(delta) ? delta : null;
}

function uncached(tokens: TokenCounts): number | null {
  const cached = completeSum(tokens.cacheRead, tokens.cacheWrite);
  return tokens.input !== null && cached !== null ? count(tokens.input - cached) : null;
}
