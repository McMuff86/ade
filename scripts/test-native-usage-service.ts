import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { NativeUsageService, type NativeUsageLaunch } from '../src/main/usage/NativeUsageService';
import { UsageJournal } from '../src/main/usage/UsageJournal';

let passed = 0;
const check = (name: string, value: boolean) => { if (!value) throw new Error(name); passed++; console.log(`  ok ${name}`); };
const root = mkdtempSync(join(tmpdir(), 'ade-native-usage-service-')); const file = join(root, 'journal', 'usage.jsonl');
let service = new NativeUsageService(new UsageJournal(file));
const env = { CODEX_HOME: join(root, 'codex'), CLAUDE_CONFIG_DIR: join(root, 'claude'), GROK_HOME: join(root, 'grok') };
const nativeId = (launch: NativeUsageLaunch) => launch.command.match(/--session-id '([a-f0-9-]+)'/)![1]!;
const put = (file: string, records: unknown[]) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, records.map(record => JSON.stringify(record)).join('\n') + '\n'); };
const logs = async (launch: NativeUsageLaunch, name: string, attrs: Record<string, string | number>): Promise<Response> => {
  const endpoint = launch.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ?? launch.command.match(/http:\/\/127\.0\.0\.1:\d+\/v1\/logs/)![0];
  const [header, token] = launch.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS!.split('=');
  return fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', [header!]: token! }, body: JSON.stringify({ resourceLogs: [{ scopeLogs: [{ logRecords: [{ eventName: name,
    attributes: Object.entries(attrs).map(([key, value]) => ({ key, value: typeof value === 'string' ? { stringValue: value } : { doubleValue: value } })) }] }] }] }) });
};
void (async () => {
  const claude = await service.prepare({ provider: 'claude', command: 'claude --model configured', env, terminalSessionId: 'claude-a', repositoryId: 'project-a' });
  check('Claude gets a fresh explicit native session and launch-only telemetry environment', nativeId(claude).length === 36 && claude.env.CLAUDE_CODE_ENABLE_TELEMETRY === '1' && claude.env.OTEL_LOG_RAW_API_BODIES === '0');
  check('telemetry secret is absent from the CLI command', !claude.command.includes(claude.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS!.split('=')[1]!));
  check('a newly opened session waits for measured numbers', service.consumption('claude-a').status === 'waiting' && service.consumption('claude-a').tokens.input === null);
  const attrs = { 'session.id': nativeId(claude), request_id: 'fixture-request', model: 'claude-fixture', input_tokens: 2, output_tokens: 18,
    cache_read_tokens: 13015, cache_creation_tokens: 4208, cost_usd: 0.08833375, prompt: 'PRIVATE_PROMPT' };
  check('authenticated native Claude event reaches the durable journal', (await logs(claude, 'claude_code.api_request', attrs)).status === 200 && service.consumption('claude-a').tokens.input === 17225);
  await logs(claude, 'claude_code.api_request', attrs);
  check('a retried native request is counted once', service.consumption('claude-a').events === 1);
  await logs(claude, 'claude_code.api_request', { ...attrs, request_id: 'fixture-helper', model: 'claude-helper', input_tokens: 913, output_tokens: 18, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: 0.001003 });
  const claudeView = service.consumption('claude-a');
  check('Claude auxiliary model usage and estimated cost join the same session', claudeView.events === 2 && claudeView.models.length === 2 && Math.abs(claudeView.costs[0]!.usd - 0.08933675) < 1e-12);
  check('missing reasoning remains unknown with explicit field coverage', claudeView.tokens.reasoning === null && claudeView.missing.reasoning === 2);
  const other = await service.prepare({ provider: 'claude', command: 'claude', env, terminalSessionId: 'claude-b', repositoryId: 'project-b' });
  await logs(other, 'claude_code.api_request', attrs);
  check('another launch cannot attribute the first native session to its own project', service.consumption('claude-b').events === 0 && service.consumption('claude-b').status === 'incomplete' && service.consumption('claude-a').events === 2);
  check('an untracked terminal never receives another session total', service.consumption('unknown').status === 'unsupported' && service.consumption('unknown').events === 0);

  const grok = await service.prepare({ provider: 'grok', command: 'grok --model configured', env, terminalSessionId: 'grok-a' });
  check('Grok uses its explicit session file without an extra telemetry export', Object.keys(grok.env).length === 0 && nativeId(grok).length === 36);
  const grokFile = join(env.GROK_HOME, 'sessions', 'project', nativeId(grok), 'updates.jsonl');
  const turn = (id: string, sessionId = nativeId(grok)) => ({ params: { sessionId, _meta: { eventId: id }, update: { sessionUpdate: 'turn_completed', usage: {
    inputTokens: 5280, outputTokens: 37, cachedReadTokens: 128, cacheCreationTokens: 0, reasoningTokens: 26, costUsdTicks: 36006000, modelUsage: { 'grok-fixture': {} },
  } } } });
  put(grokFile, [turn('grok-turn-one')]); await service.poll();
  check('Grok exact-session turn counts inclusive input and subset reasoning', service.consumption('grok-a').tokens.input === 5280 && service.consumption('grok-a').tokens.reasoning === 26);
  await service.poll();
  check('repeated file polls do not add another turn', service.consumption('grok-a').events === 1);
  appendFileSync(grokFile, JSON.stringify(turn('foreign-turn', nativeId(other))) + '\n'); await service.poll();
  check('a foreign session embedded in the same pathname is refused', service.consumption('grok-a').events === 1 && service.consumption('grok-a').status === 'incomplete');
  check('Grok provider cost retains unknown billing completeness', service.consumption('grok-a').costs[0]?.complete === false && service.consumption('grok-a').costs[0]?.kind === 'provider-reported');
  const smallerTurn = turn('grok-turn-two'); Object.assign(smallerTurn.params.update.usage, { inputTokens: 320, outputTokens: 5, reasoningTokens: 2, costUsdTicks: 1000000 });
  appendFileSync(grokFile, JSON.stringify(smallerTurn) + '\n'); await service.poll();
  check('a smaller next Grok turn is added independently rather than treated as a cumulative rollback', service.consumption('grok-a').tokens.input === 5600 && service.consumption('grok-a').tokens.output === 42);

  const now = Date.now(); const hex = now.toString(16).padStart(12, '0'); const codexId = `${hex.slice(0, 8)}-${hex.slice(8)}-7123-8123-0123456789ab`;
  const codex = await service.prepare({ provider: 'codex', command: 'codex --model configured', env, terminalSessionId: 'codex-a', now });
  check('Codex telemetry override retains the existing command and disables prompt export', codex.command.startsWith('codex --model configured ') && codex.command.includes('otel.log_user_prompt=false') && !codex.command.includes('"'));
  const codexFile = join(env.CODEX_HOME, 'sessions', ...new Date(now).toISOString().slice(0, 10).split('-'), `rollout-fixture-${codexId}.jsonl`);
  const snapshot = (input: number, output: number) => ({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input,
    cached_input_tokens: 2, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 0 } } } });
  put(codexFile, [{ type: 'session_meta', payload: { id: codexId, source: 'cli', timestamp: new Date(now).toISOString() } }, snapshot(10, 2), snapshot(10, 2), snapshot(20, 4)]);
  await logs(codex, 'codex.conversation_starts', { 'conversation.id': codexId, model: 'codex-fixture' });
  check('Codex binds telemetry identity to a fresh CLI source and subtracts repeated cumulative snapshots', service.consumption('codex-a').tokens.input === 20 && service.consumption('codex-a').events === 2);
  await logs(codex, 'codex.sse_event', { 'conversation.id': codexId, input_tokens: 1000, output_tokens: 20 });
  check('Codex preparation telemetry is not added to rollout totals', service.consumption('codex-a').tokens.input === 20);
  check('Codex missing price is not turned into a free request', service.consumption('codex-a').costs.length === 0 && service.consumption('codex-a').eventsWithoutCost === 2);
  const resumed = await service.prepare({ provider: 'codex', command: 'codex', env, terminalSessionId: 'codex-resumed', now: now + 1 });
  await logs(resumed, 'codex.conversation_starts', { 'conversation.id': codexId, model: 'codex-fixture' });
  check('pre-existing Codex history is not billed to a newly resumed ADE task', service.consumption('codex-resumed').events === 0 && service.consumption('codex-resumed').status === 'incomplete');
  await Promise.all([claude.finish('normal'), claude.finish('normal')]);
  check('concurrent normal finish is idempotent and retains the final numeric view', service.consumption('claude-a').ended && service.consumption('claude-a').status === 'recording' && service.consumption('claude-a').tokens.input === 18138);
  check('released launch cannot send a late new charge', (await logs(claude, 'claude_code.api_request', { ...attrs, request_id: 'late' })).status === 403);
  await codex.finish('interrupted');
  check('an interrupted process preserves known totals while flagging potentially missing final usage', service.consumption('codex-a').ended && service.consumption('codex-a').status === 'incomplete' && service.consumption('codex-a').tokens.input === 20);
  await service.close();
  const journalText = readFileSync(file, 'utf8');
  check('journal contains no prompt, provider home or telemetry credential', !journalText.includes('PRIVATE_PROMPT') && !journalText.includes(root.replace(/\\/g, '\\\\')) && !journalText.includes(claude.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS!.split('=')[1]!));
  service = new NativeUsageService(new UsageJournal(file));
  check('ADE restart retains previously captured session totals and ended state', service.consumption('claude-a').tokens.input === 18138 && service.consumption('claude-a').ended);
  check('final positive other provider totals survive the same restart', service.consumption('grok-a').tokens.output === 42 && service.consumption('codex-a').tokens.output === 4);
  console.log(`Native usage service: ${passed} passed, 0 failed`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await service.close(); const target = resolve(root); const prefix = resolve(tmpdir());
  if (!target.startsWith(`${prefix}\\`) && !target.startsWith(`${prefix}/`)) throw new Error('Invalid test cleanup path');
  rmSync(target, { recursive: true, force: true });
});
