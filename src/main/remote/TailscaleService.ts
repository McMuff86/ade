import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MobileAccessStatus } from '../../shared/mobileAccess';
import { parseMobileOrigin } from './hostApiConfig';

export type TailscaleCommand = (args: readonly string[]) => Promise<string>;
export interface TailscaleInspection {
  state: MobileAccessStatus['tailscale'];
  origin: string | null;
  serving: boolean;
  message: string;
}

/** Fixed executable/argv only. CLI stderr/status can contain identities and paths; never return it. */
export const runTailscale: TailscaleCommand = (args) => new Promise((resolve, reject) => {
  const installed = join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe');
  const executable = process.platform === 'win32' && existsSync(installed) ? installed : 'tailscale';
  execFile(executable, [...args], { windowsHide: true, timeout: 15_000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
    if (error) { reject(new Error((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'tailscale_missing' : 'tailscale_unavailable')); return; }
    resolve(stdout);
  });
});

type ServeConfig = { TCP?: Record<string, { HTTPS?: boolean }>; Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
  AllowFunnel?: Record<string, boolean>; Foreground?: Record<string, ServeConfig> };

function hasFunnel(config: ServeConfig): boolean {
  return Object.values(config.AllowFunnel ?? {}).some(Boolean) || Object.values(config.Foreground ?? {}).some(hasFunnel);
}

export class TailscaleService {
  constructor(private readonly execute: TailscaleCommand = runTailscale) {}

  async inspect(port: number): Promise<TailscaleInspection> {
    try {
      const status = JSON.parse(await this.execute(['status', '--json'])) as { BackendState?: string; Self?: { DNSName?: string; Online?: boolean } };
      if (status.BackendState !== 'Running' || status.Self?.Online !== true) {
        return { state: 'offline', origin: null, serving: false, message: 'Tailscale ist offline. Auf diesem PC anmelden und verbinden.' };
      }
      const origin = parseMobileOrigin(`https://${status.Self?.DNSName?.replace(/\.$/, '')}`);
      const config = JSON.parse(await this.execute(['serve', 'status', '--json'])) as ServeConfig;
      const host = new URL(origin).hostname;
      const web = config.Web?.[`${host}:443`];
      const handlers = web?.Handlers;
      const serving = config.TCP?.['443']?.HTTPS === true && !!handlers && Object.keys(handlers).length === 1
        && handlers['/']?.Proxy === `http://127.0.0.1:${port}`;
      const foregroundConflict = Object.values(config.Foreground ?? {}).some((item) => item.TCP?.['443'] || item.Web?.[`${host}:443`]);
      if (hasFunnel(config) || foregroundConflict || ((!serving) && (config.TCP?.['443'] || web))) {
        return { state: 'conflict', origin, serving: false, message: 'Tailscale-Konflikt: Funnel oder eine andere Freigabe nutzt HTTPS. Bestehende Freigaben in Tailscale prüfen.' };
      }
      return { state: 'ready', origin, serving, message: serving ? 'Private Tailscale-Serve-Freigabe ist eingerichtet.' : 'Tailscale verbunden. Mobiler Zugriff kann aktiviert werden.' };
    } catch (error) {
      const missing = error instanceof Error && error.message === 'tailscale_missing';
      return { state: missing ? 'missing' : 'unavailable', origin: null, serving: false,
        message: missing ? 'Tailscale auf diesem PC installieren und anmelden.' : 'Tailscale konnte nicht geprüft werden. Anmeldung, MagicDNS und HTTPS in Tailscale prüfen.' };
    }
  }

  async enable(port: number): Promise<void> {
    // Recheck immediately before mutation; never reset global Serve configuration.
    const before = await this.inspect(port);
    if (before.state !== 'ready') throw new Error(before.message);
    if (!before.serving) await this.execute(['serve', '--bg', '--https=443', `http://127.0.0.1:${port}`]);
    const after = await this.inspect(port);
    if (after.state !== 'ready' || !after.serving) throw new Error('ade: Tailscale HTTPS konnte nicht bestätigt werden');
  }

  async disable(port: number): Promise<void> {
    const before = await this.inspect(port);
    if (before.state === 'ready' && before.serving) await this.execute(['serve', '--https=443', 'off']);
  }
}
