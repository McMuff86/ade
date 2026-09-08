/** Count admitted operations and fence new mutations during a graceful restart. */
export class HostOperationGate {
  private active = 0;
  private restarting = false;
  busy(): boolean { return this.active > 0; }
  pending(): boolean { return this.restarting; }
  async use<T>(operation: () => T | Promise<T>, allowDuringRestart = false): Promise<T> {
    if (this.restarting && !allowDuringRestart) throw new Error('ade: ADE wird neu gestartet. Danach erneut versuchen.');
    this.active++;
    try { return await operation(); } finally { this.active--; }
  }
  reserve(): void {
    if (this.active || this.restarting) throw new Error('ade: Eine Host-Aktion läuft. Danach erneut versuchen.');
    this.restarting = true;
  }
  release(): void { this.restarting = false; }
}
