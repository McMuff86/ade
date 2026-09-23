/** Claude account limits (CLI sign-in → percentages only) and the Overview usage projection. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { projectClaudeUsage, readClaudeAccountUsage, readClaudeCredential, cachedClaudeAccountUsage, resetClaudeAccountUsageCache, claudeConfigDir, type UsageFetcher } from '../src/main/settings/ClaudeAccountUsage';
import { UsageOverviewService } from '../src/main/usage/UsageOverviewService';
import { tightestUsageWindow } from '../src/shared/usageOverview';
import { projectTokenTotal, usageRangeSince, validUsageProjectsQuery } from '../src/shared/usageProjects';
import { unknownTokens } from '../src/shared/usage';
import type { SubscriptionUsage } from '../src/shared/remote';

let passed = 0; let failed = 0;
const check = (name: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } };
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-usage-overview-')));
const TOKEN = 'sk-ant-oat01-SECRETSECRETSECRETSECRETSECRET';
const configDir = join(root, 'claude'); mkdirSync(configDir, { recursive: true });
const credentials = (value: unknown) => writeFileSync(join(configDir, '.credentials.json'), JSON.stringify(value));
const fetcher = (status: number, body: unknown, seen: Array<{ url: string; auth: string }> = []): UsageFetcher => async (url, init) => { seen.push({ url, auth: init.headers.Authorization ?? '' }); return { status, json: async () => body }; };
const response = { five_hour: { utilization: 16, resets_at: '2026-09-24T22:00:00.000Z' }, seven_day: { utilization: 37, resets_at: '2026-09-27T18:00:00.000Z' }, seven_day_fable: { utilization: 46.4, resets_at: '2026-09-27T18:00:00.000Z' },
  extra_usage: { enabled: true, amount: 12 }, account: { email: 'private@example.invalid', plan: 'Max (20x)' } };

void (async () => {
  const projected = projectClaudeUsage(response, 5);
  check('the account response projects to three percentage windows with labels, minutes and reset times', projected.status === 'available' && projected.windows.length === 3
    && projected.windows.map(w => `${w.label}:${w.usedPercent}:${w.windowMinutes}`).join('|').includes('16:300') && projected.windows[2]!.label.includes('Fable') && projected.windows[1]!.resetsAt === Date.parse('2026-09-27T18:00:00.000Z'));
  check('identities, plan names and unknown buckets never reach the projection', !/private|Max|extra_usage|email|plan/.test(JSON.stringify(projected)) && projected.command === '/usage');
  for (const bad of [{ five_hour: { utilization: 120, resets_at: '2026-09-24T22:00:00.000Z' } }, { five_hour: { utilization: '16', resets_at: '2026-09-24T22:00:00.000Z' } }, { five_hour: { utilization: 16, resets_at: 'soon' } }, [], null, 'text'])
    check('malformed windows are dropped and leave an honest unavailable state', projectClaudeUsage(bad).status === 'unavailable' && projectClaudeUsage(bad).windows.length === 0);
  check('epoch seconds and milliseconds both parse as reset times', projectClaudeUsage({ seven_day: { utilization: 1, resets_at: 1790000000 } }).windows[0]!.resetsAt === 1790000000000 && projectClaudeUsage({ seven_day: { utilization: 1, resets_at: 1790000000000 } }).windows[0]!.resetsAt === 1790000000000);

  check('no credential file means no sign-in, not an error', readClaudeCredential(configDir).token === null && (readClaudeCredential(configDir) as { reason: string }).reason === 'missing');
  const missing = await readClaudeAccountUsage({ configDir, fetcher: fetcher(200, response) });
  check('without a sign-in ADE points at /login and never calls the account', missing.status === 'unavailable' && /login/.test(missing.message) && missing.command === '/usage');
  credentials({ claudeAiOauth: { accessToken: TOKEN, refreshToken: 'r', expiresAt: Date.now() + 3_600_000, scopes: ['user:inference'], subscriptionType: 'max' } });
  const seen: Array<{ url: string; auth: string }> = [];
  const live = await readClaudeAccountUsage({ configDir, fetcher: fetcher(200, response, seen), now: () => 77 });
  check('the sign-in is sent as a bearer token only to the Anthropic usage endpoint', seen.length === 1 && seen[0]!.url === 'https://api.anthropic.com/api/oauth/usage' && seen[0]!.auth === `Bearer ${TOKEN}`);
  check('the live read yields the projected windows with the probe time', live.status === 'available' && live.windows.length === 3 && live.checkedAt === 77);
  check('the token never appears in any result field', !JSON.stringify(live).includes(TOKEN) && !JSON.stringify(missing).includes(TOKEN));
  const rejected = await readClaudeAccountUsage({ configDir, fetcher: fetcher(401, { error: `token ${TOKEN} invalid` }) });
  check('a rejected sign-in asks for /login without echoing the server body', rejected.status === 'unavailable' && /login/.test(rejected.message) && !JSON.stringify(rejected).includes(TOKEN));
  const failing = await readClaudeAccountUsage({ configDir, fetcher: async () => { throw new Error(`boom ${TOKEN}`); } });
  check('a network failure is an unavailable state without the error text', failing.status === 'unavailable' && !JSON.stringify(failing).includes('boom'));
  const server = await readClaudeAccountUsage({ configDir, fetcher: fetcher(503, {}) });
  check('a server error names the status and the CLI fallback', server.status === 'unavailable' && server.message.includes('503') && server.message.includes('/usage'));
  credentials({ claudeAiOauth: { accessToken: TOKEN, expiresAt: 1 } });
  check('an expired sign-in is reported as expired without a request', (await readClaudeAccountUsage({ configDir, fetcher: fetcher(200, response, seen) })).message.includes('expired') || (await readClaudeAccountUsage({ configDir, fetcher: fetcher(200, response, seen) })).message.includes('abgelaufen'));
  check('an expired sign-in never reached the account', seen.length === 1);
  credentials({ claudeAiOauth: { accessToken: 'short' } });
  check('a malformed token is treated as no sign-in', readClaudeCredential(configDir).token === null);
  writeFileSync(join(configDir, '.credentials.json'), 'x'.repeat(70 * 1024));
  check('an oversized credential file is refused before parsing', readClaudeCredential(configDir).token === null);
  const linked = join(root, 'linked'); mkdirSync(linked);
  try { symlinkSync(join(configDir, '.credentials.json'), join(linked, '.credentials.json'), 'file'); check('a linked credential file is refused by the link discipline', readClaudeCredential(linked).token === null); }
  catch { console.log('  --  symlink not permitted here; link check skipped'); }
  check('CLAUDE_CONFIG_DIR wins only when absolute', claudeConfigDir({ CLAUDE_CONFIG_DIR: configDir }) === configDir && !claudeConfigDir({ CLAUDE_CONFIG_DIR: 'relative/dir' }).includes('relative') && claudeConfigDir({}).endsWith('.claude'));
  credentials({ claudeAiOauth: { accessToken: TOKEN } });
  resetClaudeAccountUsageCache(); const counted: Array<{ url: string; auth: string }> = []; let clock = 1_000_000;
  const first = await cachedClaudeAccountUsage({ configDir, fetcher: fetcher(200, response, counted), now: () => clock });
  clock += 30_000; await cachedClaudeAccountUsage({ configDir, fetcher: fetcher(200, response, counted), now: () => clock });
  clock += 31_000; await cachedClaudeAccountUsage({ configDir, fetcher: fetcher(200, response, counted), now: () => clock });
  check('the account is asked at most once per minute', first.status === 'available' && counted.length === 2);
  resetClaudeAccountUsageCache();

  // Overview projection: providers, today's sums and the consent switch.
  const codex: SubscriptionUsage = { provider: 'codex', source: 'codex-account', status: 'available', checkedAt: 1, message: 'ok', windows: [{ label: 'Woche', usedPercent: 92, remainingPercent: 8, windowMinutes: 10_080, resetsAt: 2 }, { label: '5 h', usedPercent: 40, remainingPercent: 60, windowMinutes: 300, resetsAt: 3 }] };
  const day = { claude: { status: 'recording' as const, sessions: 2, events: 5, tokens: { ...unknownTokens(), input: 1200, output: 300 }, since: 0 } };
  let enabled = false; let claudeCalls = 0;
  const service = new UsageOverviewService({ nativeUsage: () => ({ providerConsumption: (provider, since) => provider === 'claude' ? { ...day.claude, since } : { status: 'unsupported', sessions: 0, events: 0, tokens: unknownTokens(), since }, projectConsumption: () => ({ status: 'ok', projects: [] }) }),
    claudeEnabled: () => enabled, codexAccount: async () => codex, claudeAccount: async () => { claudeCalls++; return live; }, now: () => Date.parse('2026-09-23T18:30:00') });
  const off = await service.overview();
  check('with the switch off the Claude account is never asked and the panel explains the switch', claudeCalls === 0 && !off.claudeAccountEnabled && off.providers[1]!.account.status === 'unavailable' && /Settings|Einstellungen/.test(off.providers[1]!.account.message) && off.providers[1]!.account.command === '/usage');
  check('today starts at local midnight and carries the journal sums per provider', off.providers[1]!.today.since === new Date(2026, 8, 23).getTime() && off.providers[1]!.today.tokens.input === 1200 && off.providers[0]!.today.status === 'unsupported');
  check('the Codex account keeps /status as its CLI counterpart', off.providers[0]!.account.command === '/status' && off.providers[0]!.account.windows.length === 2);
  check('the tile picks the window closest to its limit', tightestUsageWindow(off)?.provider === 'codex' && tightestUsageWindow(off)?.window.usedPercent === 92);
  enabled = true; const on = await service.overview();
  check('with the switch on the Claude windows join the overview', claudeCalls === 1 && on.claudeAccountEnabled && on.providers[1]!.account.windows.length === 3);
  const noon = new Date(2026, 8, 23, 12, 30).getTime();
  check('usage ranges start at local midnight and cover 7 or 30 whole days', usageRangeSince('today', noon) === new Date(2026, 8, 23).getTime() && usageRangeSince('7d', noon) === new Date(2026, 8, 17).getTime() && usageRangeSince('30d', noon) === new Date(2026, 7, 25).getTime());
  check('the projects query accepts only a known range and nothing else', validUsageProjectsQuery({ range: '7d' }) && !validUsageProjectsQuery({ range: 'week' }) && !validUsageProjectsQuery({ range: '7d', extra: 1 }) && !validUsageProjectsQuery(null));
  check('a card total adds input, output and reasoning and stays unknown without figures', projectTokenTotal({ ...unknownTokens(), input: 10, output: 5, reasoning: 1, cacheRead: 999 }) === 16 && projectTokenTotal(unknownTokens()) === null);
  const withProjects = new UsageOverviewService({ nativeUsage: () => ({ providerConsumption: () => ({ status: 'unsupported', sessions: 0, events: 0, tokens: unknownTokens(), since: 0 }), projectConsumption: (since) => ({ status: 'ok', projects: [{ repositoryId: 'r1', status: 'recording', sessions: 1, events: 1, tokens: { ...unknownTokens(), input: since }, cost: null, providers: [], items: [] }] }) }), claudeEnabled: () => false, now: () => noon });
  check('the projects read passes the range start to the journal and stamps the result', withProjects.projects('7d').projects[0]!.tokens.input === new Date(2026, 8, 17).getTime() && withProjects.projects('today').range === 'today' && withProjects.projects('today').checkedAt === noon);
  const empty = new UsageOverviewService({ nativeUsage: () => null, claudeEnabled: () => false, codexAccount: async () => ({ ...codex, status: 'unavailable', windows: [] }) });
  check('without a journal or limits the overview stays honest', tightestUsageWindow(await empty.overview()) === null && (await empty.overview()).providers.every(item => item.today.status === 'unsupported') && empty.projects('7d').projects.length === 0);
})().catch((error) => { failed++; console.error(error); }).finally(() => {
  const absolute = resolve(root); if (dirname(absolute) !== realpathSync.native(tmpdir())) throw new Error('Unsafe cleanup'); rmSync(absolute, { recursive: true, force: true });
  console.log(`Usage overview: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
});
