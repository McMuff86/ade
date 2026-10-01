import type { HostOperationChange, HostOperationPreferences, HostOperationStatus } from '../../shared/hostOperation';

export interface LoginStartup {
  supported: boolean;
  enabled(): boolean;
  set(enabled: boolean): void;
}
interface SleepBlocker {
  start(type: 'prevent-app-suspension'): number;
  stop(id: number): boolean;
  isStarted(id: number): boolean;
}

/** One inhibitor per owner. Open PTYs count even while a CLI waits for input:
 * silence is not evidence that the user's work finished. No prompts replay. */
export class HostOperationService {
  private blockerId: number | null = null;
  private failed = false;
  private disposed = false;
  constructor(private readonly deps: {
    preferences(): HostOperationPreferences;
    save(preferences: HostOperationPreferences): void;
    activeSessions(): number;
    otherWorkActive?(): boolean;
    startup: LoginStartup;
    power: SleepBlocker;
    warn(error: unknown): void;
  }) {}

  reconcile(): void {
    if (this.disposed) return;
    try {
      const wanted = this.deps.preferences().keepAwake && (this.deps.activeSessions() > 0 || this.deps.otherWorkActive?.() === true);
      if (this.blockerId !== null && !this.deps.power.isStarted(this.blockerId)) this.blockerId = null;
      if (wanted && this.blockerId === null) this.blockerId = this.deps.power.start('prevent-app-suspension');
      if (!wanted) this.release();
      this.failed = wanted && (this.blockerId === null || !this.deps.power.isStarted(this.blockerId));
    } catch (error) {
      if (!this.failed) this.deps.warn(error);
      this.failed = true;
      // Retain the handle if stop fails, so a later tick/quit can retry.
      try { this.release(); } catch { /* reported by status */ }
    }
  }

  status(): HostOperationStatus {
    this.reconcile();
    let autostart = false; let autostartError: string | null = null;
    try { autostart = this.deps.startup.enabled(); }
    catch { autostartError = 'Autostart could not be read. Check the local desktop configuration.'; }
    const preferences = this.deps.preferences();
    return { ...preferences, autostart, autostartSupported: this.deps.startup.supported, autostartError,
      activeSessions: this.deps.activeSessions(),
      sleepPrevention: this.failed ? 'error' : this.blockerId !== null ? 'requested' : preferences.keepAwake ? 'idle' : 'off' };
  }

  change(input: HostOperationChange): HostOperationStatus {
    if (this.disposed) throw new Error('ADE is shutting down.');
    if (input.setting === 'autostart') {
      if (!this.deps.startup.supported) throw new Error('Login autostart is unavailable in this deployment.');
      this.deps.startup.set(input.enabled);
    } else this.deps.save({ ...this.deps.preferences(), [input.setting]: input.enabled });
    return this.status();
  }

  private release(): void {
    if (this.blockerId === null) return;
    const id = this.blockerId;
    this.deps.power.stop(id);
    if (this.deps.power.isStarted(id)) throw new Error('Sleep prevention could not be released.');
    this.blockerId = null;
  }

  dispose(): void {
    this.disposed = true;
    try { this.release(); } catch (error) { this.deps.warn(error); }
  }
}
