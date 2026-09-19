import { t as translate } from "../../shared/i18n";
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { SubscriptionUsage, SubscriptionWindow } from '../../shared/remote';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
let cached: SubscriptionUsage | undefined;
let pending: Promise<SubscriptionUsage> | undefined;
export function cachedCodexAccountUsage(): Promise<SubscriptionUsage> {
  if (cached && Date.now() - cached.checkedAt < 60_000) return Promise.resolve(cached);
  return pending ??= readCodexAccountUsage().then((result) => { cached = result; return result; }).finally(() => { pending = undefined; });
}
function window(value: unknown, label: string): SubscriptionWindow | null {
  const item = record(value);
  if (typeof item.usedPercent !== 'number' || !Number.isFinite(item.usedPercent) || item.usedPercent < 0 || item.usedPercent > 100
    || !Number.isSafeInteger(item.windowDurationMins) || (item.windowDurationMins as number) < 1
    || !Number.isSafeInteger(item.resetsAt) || (item.resetsAt as number) < 0 || (item.resetsAt as number) > 8_640_000_000_000) return null;
  return { label, usedPercent: item.usedPercent, remainingPercent: 100 - item.usedPercent,
    windowMinutes: item.windowDurationMins as number, resetsAt: (item.resetsAt as number) * 1000 };
}

/** Strict numeric projection: account identities, credentials and server errors never leave this adapter. */
export function projectCodexUsage(value: unknown, checkedAt = Date.now()): SubscriptionUsage {
  const response = record(value); const byId = record(response.rateLimitsByLimitId);
  const limits = record(byId.codex ?? response.rateLimits);
  const windows = [window(limits.primary, translate("Primary limit")), window(limits.secondary, translate('Secondary limit'))].filter((item): item is SubscriptionWindow => item !== null);
  return { provider: 'codex', source: 'codex-account', checkedAt, status: windows.length ? 'available' : 'unavailable', windows,
    message: windows.length ? translate("Subscription limits for the locally signed-in Codex account.") : translate("Codex does not provide any evaluable subscription limits for this account.") };
}

/** Account-only stdio probe. It never starts a thread, sends a prompt or consumes a reset/credit. */
export function readCodexAccountUsage(launch?: () => ChildProcessWithoutNullStreams): Promise<SubscriptionUsage> {
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    const unavailable = (): SubscriptionUsage => ({ provider: 'codex', source: 'codex-account', checkedAt: Date.now(), status: 'unavailable', windows: [],
      message: translate("Subscription limits unavailable. Check local codex sign-in and connection.") });
    try { child = launch?.() ?? (process.platform === 'win32'
      ? spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '& codex app-server --listen stdio://'], { cwd: tmpdir(), windowsHide: true, stdio: 'pipe' })
      : spawn('codex', ['app-server', '--listen', 'stdio://'], { cwd: tmpdir(), stdio: 'pipe' })); }
    catch { resolve(unavailable()); return; }
    let ended = false; let received = ''; let bytes = 0; let phase = 0;
    const finish = (result: SubscriptionUsage) => {
      if (ended) return; ended = true; clearTimeout(timer); child.stdin.end(); resolve(result);
      const stop = setTimeout(() => {
        if (child.exitCode !== null || !child.pid) return;
        if (process.platform === 'win32') execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => undefined);
        else child.kill();
      }, 1000); stop.unref(); child.once('close', () => clearTimeout(stop));
    };
    const timer = setTimeout(() => finish(unavailable()), 12_000); timer.unref();
    const send = (value: unknown) => child.stdin.write(`${JSON.stringify(value)}\n`, (error) => { if (error) finish(unavailable()); });
    child.on('error', () => finish(unavailable())); child.on('close', () => finish(unavailable()));
    child.stdin.on('error', () => finish(unavailable())); child.stderr.on('data', () => undefined);
    child.stdout.setEncoding('utf8'); child.stdout.on('data', (chunk: string) => {
      if (ended) return; bytes += Buffer.byteLength(chunk); received += chunk;
      if (bytes > 512 * 1024) { finish(unavailable()); return; }
      const lines = received.split('\n'); received = lines.pop()!;
      for (const line of lines) {
        if (!line.trim() || ended) continue;
        let item: Record<string, unknown>;
        try { item = record(JSON.parse(line)); } catch { finish(unavailable()); return; }
        if (item.method && item.id !== undefined) { send({ id: item.id, error: { code: -32601, message: translate("Account read only.") } }); continue; }
        if (item.id === 1 && phase === 0) {
          if (item.error) { finish(unavailable()); return; }
          phase = 1; send({ method: 'initialized' }); send({ id: 2, method: 'account/rateLimits/read', params: {} });
        } else if (item.id === 2 && phase === 1) finish(item.error ? unavailable() : projectCodexUsage(item.result));
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'ade_usage', title: translate("ADE usage"), version: '0.1.0' } } });
  });
}
