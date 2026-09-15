import { claudeRequest, codexSnapshot, grokTurn, tokenDelta } from '../src/main/usage/normalize';
let passed = 0;
const check = (name: string, value: boolean) => { if (!value) throw new Error(name); passed++; console.log(`  ok ${name}`); };
// Numeric fixtures from the native probes documented in USAGE_SOURCE_RESULTS.
// No provider prompts, credentials or personal request/session IDs are retained.
const codexEvent = { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: {
  input_tokens: 15731, cached_input_tokens: 12288, cache_write_input_tokens: 0, output_tokens: 9, reasoning_output_tokens: 0,
} } } };
const claudeAttrs = { input_tokens: 2, output_tokens: 18, cache_read_tokens: 13015, cache_creation_tokens: 4208,
  cost_usd: 0.08833375, model: 'claude-fable-5-1' };
const grokEvent = { params: { _meta: { eventId: 'fixture-event' }, update: { sessionUpdate: 'turn_completed', usage: {
  inputTokens: 5280, outputTokens: 37, cachedReadTokens: 128, cacheCreationTokens: 0, reasoningTokens: 26,
  costUsdTicks: 36006000, modelUsage: { 'grok-4.6-build': {} },
} } } };
void (async () => {
  const codex = codexSnapshot(codexEvent, 'gpt-6-astra', 'fixture')!;
  check('Codex rollout preserves inclusive input rather than adding cached input', codex.tokens.input === 15731 && codex.tokens.inputUncached === 3443);
  check('Codex explicitly reported zero reasoning stays distinct from missing data', codex.tokens.reasoning === 0 && codex.tokens.cacheWrite === 0);
  check('Codex token counts do not invent a price or billing mode', codex.costUsd === null && codex.costKind === 'unknown');
  check('Codex prewarm response.completed is not a usage snapshot', codexSnapshot({ type: 'codex.sse_event', input_token_count: 12439 }, 'gpt-6-astra', 'fixture') === null);
  check('Codex rate-limit-only token event is not counted', codexSnapshot({ type: 'event_msg', payload: { type: 'token_count', info: null } }, null, 'fixture') === null);
  const claude = claudeRequest(claudeAttrs, 'fixture')!;
  check('Claude inclusive input combines three disjoint reported input categories', claude.tokens.input === 17225 && claude.tokens.inputUncached === 2);
  check('Claude cache creation and reading remain separately reported', claude.tokens.cacheRead === 13015 && claude.tokens.cacheWrite === 4208);
  check('Claude OTel missing reasoning stays unknown', claude.tokens.reasoning === null);
  check('Claude API price is labelled as an estimate', claude.costUsd === 0.08833375 && claude.costKind === 'provider-estimate');
  const auxiliary = claudeRequest({ input_tokens: 913, output_tokens: 18, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: 0.001003, model: 'claude-haiku-4-5-20251001' }, 'auxiliary')!;
  check('Claude main plus auxiliary request matches the real CLI cost total', Math.abs(claude.costUsd! + auxiliary.costUsd! - 0.08933675) < 1e-12);
  const partial = claudeRequest({ input_tokens: 2, output_tokens: 18 }, 'fixture')!;
  check('missing Claude cache fields leave inclusive input unknown', partial.tokens.input === null && partial.tokens.cacheRead === null && partial.tokens.cacheWrite === null);
  check('partial usage retains separately known input and output', partial.tokens.inputUncached === 2 && partial.tokens.output === 18);
  const grok = grokTurn(grokEvent)!;
  check('Grok ACP inclusive input does not add cached input again', grok.tokens.input === 5280 && grok.tokens.inputUncached === 5152);
  check('Grok reported reasoning stays inside output', grok.tokens.output === 37 && grok.tokens.reasoning === 26);
  check('Grok cost ticks use the documented 10^10 denominator', grok.costUsd === 0.0036006 && grok.costKind === 'provider-reported');
  check('Grok cost completeness is not inferred from a reported amount', grok.costComplete === null);
  check('Grok preserves the reported billing model', grok.model === 'grok-4.6-build');
  check('Grok requires a durable native event identity', grokTurn({ params: { ...grokEvent.params, _meta: {} } }) === null);
  check('unknown Messages-stream cost zero is not imported as free usage', grokTurn({ type: 'result', total_cost_usd: 0 }) === null);
  check('identical cumulative snapshots have a zero delta', tokenDelta(codex.tokens, codex.tokens)?.input === 0);
  check('counter rollback cannot produce negative usage', tokenDelta({ ...codex.tokens, input: 1 }, codex.tokens) === null);
  check('unknown fields do not become known zero in deltas', tokenDelta(partial.tokens, partial.tokens)?.cacheRead === null);
  check('unsafe event identifiers are not propagated', claudeRequest(claudeAttrs, '../event') === null);
  check('provider model strings cannot carry absolute host paths', claudeRequest({ ...claudeAttrs, model: 'C:/private/model' }, 'fixture')?.model === null);
  check('non-numeric token fields do not become zeros', claudeRequest({ input_tokens: -1, output_tokens: NaN }, 'fixture') === null);
  check('a supplied prompt is absent from the projected numeric sample', !JSON.stringify(claudeRequest({ ...claudeAttrs, prompt: 'PRIVATE_PROMPT' }, 'fixture')).includes('PRIVATE_PROMPT'));
  check('final positive native source normalizes after negative controls', grokTurn(grokEvent)?.tokens.input === 5280);
  console.log(`Usage normalization: ${passed} passed, 0 failed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
