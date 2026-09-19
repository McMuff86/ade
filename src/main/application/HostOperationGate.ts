import { t as translate } from "../../shared/i18n";
/** Count admitted operations and fence new mutations during a graceful restart. */
export class HostOperationGate {
  private active = 0;
  private restarting = false;
  busy(): boolean { return this.active > 0; }
  pending(): boolean { return this.restarting; }
  async use<T>(operation: () => T | Promise<T>, allowDuringRestart = false): Promise<T> {
    if (this.restarting && !allowDuringRestart) throw new Error(translate("ade: ADE is restarting. Try again afterwards."));
    this.active++;
    try { return await operation(); } finally { this.active--; }
  }
  reserve(): void {
    if (this.active || this.restarting) throw new Error(translate("ade: A host operation is running. Try again afterwards."));
    this.restarting = true;
  }
  release(): void { this.restarting = false; }
}
