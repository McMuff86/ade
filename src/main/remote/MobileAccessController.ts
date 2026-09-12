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
    const listening = this.server !== null && tail.state === 'ready' && tail.serving && tail.origin === this.origin;
    if (listening && tail.origin && this.https === 'unreachable' && Date.now() - this.lastProbeAt > 15_000) this.scheduleProbe(tail.origin);
    const httpsMessage = listening && this.https !== 'verified'
      ? this.https === 'pending' ? 'HTTPS wird mit Zertifikatsprüfung getestet. Die erste Tailscale-Zertifikatsbereitstellung kann dauern.'
        : 'HTTPS vom PC ist noch nicht erreichbar. Tailscale-Zertifikatsbereitstellung und Netzwerk prüfen; danach Verbindung erneut prüfen.'
      : tail.message;
    return { enabled: this.devices.mobilePreferences().enabled, listening, https: this.https,
      url: tail.origin, tailscale: tail.state, message: this.message || httpsMessage };
  }

  async setEnabled(enabled: boolean): Promise<MobileAccessStatus> {
    if (this.busy || this.disposed) throw new Error('ade: mobile Verbindung wird gerade geändert');
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
        this.message = 'Mobiler Zugriff ist ausgeschaltet.';
      } else {
        if (this.legacyEnabled) throw new Error('Der alte ADE_HOST_API_ENABLED-Modus ist aktiv. Diesen vor dem mobilen Zugriff ausschalten und ADE neu starten.');
        if (!this.devices.inventory().available) throw new Error('Sichere Geräteablage ist nicht verfügbar.');
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
        ? `Tailscale HTTPS ist noch nicht verfügbar. In einer PC-Konsole „tailscale serve --bg --https=443 http://127.0.0.1:${this.port}“ ausführen und gegebenenfalls HTTPS bestätigen; danach erneut verbinden.`
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
    const status = await this.status();
    if (!status.listening || !this.sessions || !this.origin) throw new Error('ade: zuerst die mobile Verbindung aktivieren');
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
      const tail = await this.tailscale.inspect(this.port);
      if (tail.state !== 'ready' || !tail.serving || !tail.origin) {
        await this.stopListener();
        this.message = tail.state === 'ready' ? 'Tailscale-Freigabe fehlt. Verbindung erneut aktivieren.' : tail.message;
      } else if (!this.server || tail.origin !== this.origin) {
        await this.stopListener(); await this.startListener(tail.origin); this.message = '';
      }
      if (this.server && tail.origin && Date.now() - this.lastProbeAt > 60_000) this.scheduleProbe(tail.origin);
    } catch { await this.stopListener(); this.message = 'Mobile Verbindung unterbrochen. Erneut verbinden.'; }
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
