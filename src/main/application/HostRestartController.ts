import { randomUUID } from 'node:crypto';
import type { MobileHostState, MobileRestartResult } from '../../shared/remote';
import { HostOperationGate } from './HostOperationGate';
import { RemoteApiError } from './AdeApplicationService';

/** Process-local lifecycle; executable, arguments and profile never come from remote input. */
export class HostRestartController {
  readonly instanceId = randomUUID();
  private pending: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(readonly gate: HostOperationGate, private readonly blockers: () => string[],
    private readonly relaunch: () => void, private readonly version: string, private readonly supported: boolean) {}

  state(canRestart: boolean): MobileHostState {
    return { instanceId: this.instanceId, version: this.version, restart: this.pending ? 'pending' : 'ready',
      canRestart: canRestart && this.supported,
      blockers: [...(!this.supported ? ['Neustart ist für diesen Startmodus noch nicht verfügbar.'] : []),
        ...this.blockers(), ...(this.gate.busy() ? ['Eine Host-Aktion läuft.'] : [])] };
  }
  reserve(instanceId: string): MobileRestartResult {
    if (instanceId !== this.instanceId) throw new RemoteApiError(409, 'host_changed', 'ADE wurde bereits neu gestartet. Host-Zustand aktualisieren.');
    const state = this.state(true);
    if (!state.canRestart || state.blockers.length) throw new RemoteApiError(409, 'host_busy', 'Laufende Arbeit abschliessen, bevor ADE neu gestartet wird.');
    this.gate.reserve(); this.pending = randomUUID();
    return { operationId: this.pending, instanceId: this.instanceId, accepted: true, replayed: false };
  }
  commit(operationId: string, stillAuthorized: () => boolean): void {
    if (this.pending !== operationId || this.timer) return;
    // Allow the bounded receipt to leave the HTTP response before closing listeners.
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!stillAuthorized() || this.blockers().length) { this.cancel(operationId); return; }
      try { this.relaunch(); }
      catch { console.warn('[ade] relaunch failed; existing host retained'); this.cancel(operationId); }
    }, 1000);
  }
  cancel(operationId: string): void {
    if (this.pending !== operationId) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null; this.pending = null; this.gate.release();
  }
}
