import { t as translate } from "../../shared/i18n";
import { randomBytes } from 'node:crypto';
import type { MobileAccessStatus, MobilePairingChallenge } from '../../shared/mobileAccess';
import type { AdeApplicationService } from '../application/AdeApplicationService';
import { redactedErrorDetail } from '../errors';
import { RemoteAuthorizer } from './authorization';
import { BrowserSessions } from './BrowserSessions';
import { HostApiServer } from './HostApiServer';
import type { RemoteDeviceStore } from './RemoteDeviceStore';
import { loadMobileAssets } from './mobileAssets';
import { TailscaleService } from './TailscaleService';
import { probePrivateHttps, type HttpsReadinessProbe } from './httpsReadiness';

/** Desktop-owned lifecycle; remote requests cannot configure the listener or Tailscale. */
export class MobileAccessController {
  private server: HostApiServer | null = null;
  private sessions: BrowserSessions | null = null;
  private origin: string | null = null;
  private busy = false;
  private message = '';
  private monitor: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private https: MobileAccessStatus['https'] = 'pending';
  private probeAbort: AbortController | null = null;
  private lastProbeAt = 0;

  constructor(private readonly application: AdeApplicationService, private readonly devices: RemoteDeviceStore,
    private readonly assetRoot: string, private readonly tailscale = new TailscaleService(),
    private readonly port = 4317, private readonly legacyEnabled = false,
    private readonly probe: HttpsReadinessProbe = probePrivateHttps,
    private readonly monitorEveryMs = 15_000) {}

  async restore(): Promise<void> {
    if (this.devices.mobilePreferences().enabled) await this.setEnabled(true);
  }

  commandsEnabled(): boolean { return this.server !== null && this.devices.activeDevices().length > 0; }
  enabled(): boolean { return this.devices.mobilePreferences().enabled; }

  async status(): Promise<MobileAccessStatus> {
    const tail = await this.tailscale.inspect(this.port);
    const storage = this.devices.inventory();
    const listening = storage.available && this.server !== null && tail.state === 'ready' && tail.serving && tail.origin === this.origin;
    if (listening && tail.origin && this.https === 'unreachable' && Date.now() - this.lastProbeAt > 15_000) this.scheduleProbe(tail.origin);
    const httpsMessage = listening && this.https !== 'verified'
      ? this.https === 'pending' ? translate("HTTPS is tested with certificate verification. The first tailscale certificate provision may take time.")
        : translate("HTTPS from the PC is not yet reachable. Check tailscale certificate provisioning and network; then check connection again.")
      : tail.message;
    return { enabled: this.devices.mobilePreferences().enabled, listening, https: storage.available ? this.https : 'pending',
      url: tail.origin, tailscale: tail.state, message: !storage.available ? storage.error! : this.message || httpsMessage };
  }

  async setEnabled(enabled: boolean): Promise<MobileAccessStatus> {
    if (this.busy || this.disposed) throw new Error(translate("ade: Mobile connection is being changed"));
    this.busy = true;
    this.message = '';
    try {
      if (!enabled) {
        const ownsServe = this.devices.mobilePreferences().ownsServe;
        this.devices.setMobilePreferences(false, ownsServe);
        await this.stopListener();
        if (ownsServe) {
          await this.tailscale.disable(this.port);
          this.devices.setMobilePreferences(false, false);
        }
        this.message = translate("Mobile access is turned off.");
      } else {
        if (this.legacyEnabled) throw new Error(translate("The old ADE_HOST_API_ENABLED mode is active, turning it off before mobile access and restarting ADE."));
        if (!this.devices.inventory().available) throw new Error(translate("Secure device storage is not available."));
        const tail = await this.tailscale.inspect(this.port);
        if (tail.state !== 'ready' || !tail.origin) throw new Error(tail.message);
        // Assets and the listener must work before any network exposure is configured.
        if (!this.server || this.origin !== tail.origin) {
          await this.stopListener();
          await this.startListener(tail.origin);
        }
        const ownsServe = this.devices.mobilePreferences().ownsServe || !tail.serving;
        // Persist ownership before the CLI call, so an interrupted setup can be retried/disabled.
        this.devices.setMobilePreferences(true, ownsServe);
        await this.tailscale.enable(this.port);
        this.scheduleProbe(tail.origin);
        this.message = '';
      }
    } catch (error) {
      await this.stopListener();
      console.warn('[ade] mobile connection setup failed:', redactedErrorDetail(error));
      this.message = error instanceof Error && error.message.startsWith('tailscale_')
        ? translate("Tailscale HTTPS is not yet available. Run tailscale serve --bg --https=443 http://127.0.0.1:{{value1}} in a PC console and, if necessary, confirm HTTPS; then reconnect.", { value1: this.port })
        : redactedErrorDetail(error);
    } finally {
      this.busy = false;
      // A previously enabled host must also recover when its first listen
      // fails (for example, the old ADE instance is still shutting down).
      // Only a persisted opt-in allows unattended retries.
      if (!this.disposed && this.devices.mobilePreferences().enabled && !this.monitor) {
        this.monitor = setInterval(() => { void this.checkConnection(); }, this.monitorEveryMs);
        this.monitor.unref();
      }
      if (!this.devices.mobilePreferences().enabled && this.monitor) {
        clearInterval(this.monitor); this.monitor = null;
      }
    }
    return this.status();
  }

  async beginPairing(): Promise<MobilePairingChallenge> {
    const storage = this.devices.inventory();
    if (!storage.available) throw new Error(storage.error!);
    const status = await this.status();
    if (!status.listening || !this.sessions || !this.origin) throw new Error(translate("ade: first activate the mobile connection"));
    return this.sessions.beginPairing(this.origin);
  }
  cancelPairing(): void { this.sessions?.cancelPairing(); }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.monitor) clearInterval(this.monitor);
    this.monitor = null;
    await this.stopListener();
  }

  private async startListener(origin: string): Promise<void> {
    const assets = loadMobileAssets(this.assetRoot);
    const sessions = new BrowserSessions(this.devices);
    const server = new HostApiServer(this.application, { port: this.port, requireDeviceReads: true,
      authorizer: new RemoteAuthorizer(randomBytes(32).toString('base64url'), [], undefined, this.devices),
      browser: { origin, sessions, assets }, audit: (entry) => this.devices.audit(entry) });
    try { await server.start(); }
    catch (error) { sessions.dispose(); throw error; }
    this.server = server; this.sessions = sessions; this.origin = origin;
  }

  private async stopListener(): Promise<void> {
    this.probeAbort?.abort(); this.probeAbort = null; this.https = 'pending'; this.lastProbeAt = 0;
    const server = this.server;
    this.server = null;
    this.sessions?.dispose(); this.sessions = null; this.origin = null;
    await server?.stop();
  }

  private async checkConnection(): Promise<void> {
    if (this.busy || this.disposed || !this.devices.mobilePreferences().enabled) return;
    this.busy = true;
    try {
      const storage = this.devices.inventory();
      if (!storage.available) { await this.stopListener(); this.message = storage.error!; return; }
      const tail = await this.tailscale.inspect(this.port);
      if (tail.state !== 'ready' || !tail.serving || !tail.origin) {
        await this.stopListener();
        this.message = tail.state === 'ready' ? translate("Tailscale sharing is missing. Re-enable connection.") : tail.message;
      } else if (!this.server || tail.origin !== this.origin) {
        await this.stopListener(); await this.startListener(tail.origin); this.message = '';
      }
      if (this.server && tail.origin && Date.now() - this.lastProbeAt > 60_000) this.scheduleProbe(tail.origin);
    } catch { await this.stopListener(); this.message = translate("Mobile connection interrupted. Reconnect."); }
    finally { this.busy = false; }
  }

  private scheduleProbe(origin: string): void {
    if (this.probeAbort) return;
    const controller = new AbortController();
    this.probeAbort = controller; this.https = 'pending'; this.lastProbeAt = Date.now();
    void this.probe(origin, controller.signal).catch(() => false).then((verified) => {
      if (!controller.signal.aborted && this.origin === origin) this.https = verified ? 'verified' : 'unreachable';
    }).finally(() => { if (this.probeAbort === controller) this.probeAbort = null; });
  }
}
