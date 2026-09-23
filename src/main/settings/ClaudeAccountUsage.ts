import { t as translate } from "../../shared/i18n";
import { lstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { SubscriptionUsage, SubscriptionWindow } from '../../shared/remote';
import { assertNoLinks } from '../repositories/pathDiscipline';

/**
 * Claude account limits, the numbers `/usage` shows in the Claude Code CLI.
 * Claude Code keeps nothing of them on disk; the CLI asks the Anthropic
 * account each time. ADE does the same with the CLI's own sign-in, and only
 * when the operator switched that on (settings.claudeAccountUsage). The
 * credential file is read once per probe under the link discipline, the
 * token stays inside this module and never reaches a message, a log or the
 * wire; the response is reduced to percentages and reset times.
 */
export const CLAUDE_USAGE_ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const CREDENTIAL_BYTES = 64 * 1024;
export type UsageFetcher = (url: string, init: { method: 'GET'; headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CLAUDE_CONFIG_DIR?.trim();
  return configured && isAbsolute(configured) ? configured : join(homedir(), '.claude');
}

/** Access token of the CLI sign-in, or null when there is none; malformed or oversized files count as none. */
export function readClaudeCredential(configDir: string, now = Date.now()): { token: string } | { token: null; reason: 'missing' | 'expired' | 'invalid' } {
  const file = join(configDir, '.credentials.json');
  try {
    assertNoLinks(file); const stat = lstatSync(file);
    if (!stat.isFile() || stat.nlink > 1 || stat.size > CREDENTIAL_BYTES) return { token: null, reason: 'invalid' };
    const oauth = record(record(JSON.parse(readFileSync(file, 'utf8'))).claudeAiOauth);
    if (typeof oauth.accessToken !== 'string' || !/^[A-Za-z0-9._~+/=-]{20,4096}$/.test(oauth.accessToken)) return { token: null, reason: 'invalid' };
    if (typeof oauth.expiresAt === 'number' && Number.isFinite(oauth.expiresAt) && oauth.expiresAt < now) return { token: null, reason: 'expired' };
    return { token: oauth.accessToken };
  } catch (error) {
    return { token: null, reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'invalid' };
  }
}

const windowLabel = (key: string): { label: string; minutes: number } | null => {
  if (key === 'five_hour') return { label: translate("Current session (5 hours)"), minutes: 300 };
  if (key === 'seven_day') return { label: translate("This week"), minutes: 10_080 };
  const model = /^seven_day_([a-z0-9]+)$/i.exec(key)?.[1];
  if (model) return { label: translate("{{value1}} this week", { value1: model.charAt(0).toUpperCase() + model.slice(1) }), minutes: 10_080 };
  return null;
};
const resetTime = (value: unknown): number | null => {
  const at = typeof value === 'string' ? Date.parse(value) : typeof value === 'number' && Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : NaN;
  return Number.isFinite(at) && at >= 0 && at <= 8_640_000_000_000_000 ? at : null;
};
const unavailable = (message: string, checkedAt = Date.now()): SubscriptionUsage => ({ provider: 'claude', source: 'cli', status: 'unavailable', checkedAt, windows: [], message, command: '/usage' });

/** Strict numeric projection of the account response; unknown keys, identities and plan names are dropped. */
export function projectClaudeUsage(value: unknown, checkedAt = Date.now()): SubscriptionUsage {
  const windows: SubscriptionWindow[] = [];
  for (const [key, item] of Object.entries(record(value))) {
    const shape = windowLabel(key); const bucket = record(item); if (!shape) continue;
    const used = bucket.utilization; const resetsAt = resetTime(bucket.resets_at);
    if (typeof used !== 'number' || !Number.isFinite(used) || used < 0 || used > 100 || resetsAt === null) continue;
    windows.push({ label: shape.label, usedPercent: used, remainingPercent: 100 - used, windowMinutes: shape.minutes, resetsAt });
  }
  return windows.length
    ? { provider: 'claude', source: 'cli', status: 'available', checkedAt, windows, message: translate("Account limits of the Claude sign-in on the PC; the same figures /usage shows in the CLI."), command: '/usage' }
    : unavailable(translate("The Claude account returned no readable limits. In the CLI, /usage shows the current values."), checkedAt);
}

export async function readClaudeAccountUsage(options: { configDir?: string; fetcher?: UsageFetcher; now?: () => number; timeoutMs?: number } = {}): Promise<SubscriptionUsage> {
  const now = options.now ?? Date.now;
  const credential = readClaudeCredential(options.configDir ?? claudeConfigDir(), now());
  if (credential.token === null) {
    return unavailable(credential.reason === 'missing' ? translate("No Claude CLI sign-in was found on the PC. Sign in with /login in Claude Code.")
      : credential.reason === 'expired' ? translate("The Claude CLI sign-in has expired. Open Claude Code once so it renews the sign-in.")
        : translate("The Claude CLI sign-in on the PC could not be read."), now());
  }
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000); timer.unref?.();
  try {
    const response = await (options.fetcher ?? ((url, init) => fetch(url, init)))(CLAUDE_USAGE_ENDPOINT, { method: 'GET', signal: controller.signal,
      headers: { Authorization: `Bearer ${credential.token}`, Accept: 'application/json', 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'ade-usage/0.1' } });
    if (response.status === 401 || response.status === 403) return unavailable(translate("The Claude account did not accept the CLI sign-in. Sign in again with /login in Claude Code."), now());
    if (response.status !== 200) return unavailable(translate("Claude account limits are not reachable right now (HTTP {{value1}}). In the CLI, /usage shows the current values.", { value1: response.status }), now());
    return projectClaudeUsage(await response.json(), now());
  } catch {
    return unavailable(translate("Claude account limits are not reachable right now. Check the connection; in the CLI, /usage shows the current values."), now());
  } finally { clearTimeout(timer); }
}

let cached: SubscriptionUsage | undefined; let pending: Promise<SubscriptionUsage> | undefined;
/** At most one account request per minute, shared by every caller. */
export function cachedClaudeAccountUsage(options: { configDir?: string; fetcher?: UsageFetcher; now?: () => number } = {}): Promise<SubscriptionUsage> {
  const now = options.now ?? Date.now;
  if (cached && now() - cached.checkedAt < 60_000) return Promise.resolve(cached);
  return pending ??= readClaudeAccountUsage(options).then((result) => { cached = result; return result; }).finally(() => { pending = undefined; });
}
export function resetClaudeAccountUsageCache(): void { cached = undefined; pending = undefined; }
