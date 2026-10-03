import type { HostSecretVault, KeyringProbe, VaultStatus, WrappingKeyStore } from './HostSecretVault';

export interface ObservedKeyStore extends WrappingKeyStore {
  generation(): string | null;
  close(): void;
}
/**
 * Bounded polling avoids an unbounded native signal subscription. A ready
 * probe must match the previous service/collection/item generation before the
 * cached key can remain usable. Failure invalidates it before a refresh.
 * Changes are detected within pollMs plus the provider's bounded call time;
 * credential-dependent launch sites must call checkNow before launching (H2c).
 */
export class SecretVaultMonitor {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<void> | null = null;
  private stopped = false;
  private started = false;
  private generation: string | null = null;
  private failures = 0;
  constructor(private readonly vault: HostSecretVault, private readonly keyring: ObservedKeyStore,
    private readonly changed: (status: VaultStatus) => void = () => undefined,
    private readonly pollMs = 2000, private readonly maxRetryMs = 30_000) {
    if (!Number.isSafeInteger(pollMs) || pollMs < 50 || !Number.isSafeInteger(maxRetryMs) || maxRetryMs < pollMs) throw new Error('ade: invalid vault monitor interval');
  }
  start(): Promise<void> { this.started = true; return this.checkNow(); }
  checkNow(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.pending) return this.pending;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.pending = this.check().finally(() => {
      this.pending = null;
      if (this.started && !this.stopped) {
        const delay = Math.min(this.maxRetryMs, this.pollMs * 2 ** Math.min(this.failures, 8));
        this.timer = setTimeout(() => { void this.checkNow(); }, delay); this.timer.unref();
      }
    });
    return this.pending;
  }
  close(): void {
    this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null;
    this.keyring.close(); this.vault.close();
  }
  private async check(): Promise<void> {
    const previous = JSON.stringify(this.vault.status());
    let probe: KeyringProbe;
    try { probe = await this.keyring.probe(); } catch { probe = { state: 'unavailable' }; }
    if (this.stopped) return;
    const generation = this.keyring.generation();
    if (probe.state !== 'ready' || !generation || generation !== this.generation || !this.vault.available() || JSON.stringify(probe) !== previous) {
      this.vault.invalidate(); await this.vault.refresh();
      if (this.stopped) return;
      this.generation = this.keyring.generation();
    }
    this.failures = this.vault.available() ? 0 : this.failures + 1;
    if (JSON.stringify(this.vault.status()) !== previous) {
      try { this.changed(this.vault.status()); } catch { console.warn('[ade] secret state listener failed'); }
    }
  }
}
