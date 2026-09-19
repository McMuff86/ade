import { t as translate } from "../../shared/i18n";
/** Fence an explicit Git update against asynchronous launch/scope preparation.
 * Existing PTYs and persisted leases are checked separately at the target.
 * Refusal is immediate: no command waits behind a mutation with stale intent.
 */
export class WorkspaceOperationBusyError extends Error {}

export class WorkspaceOperationGate {
  private readers = 0;
  private writing = false;
  busy(): boolean { return this.writing || this.readers > 0; }
  async use<T>(operation: () => Promise<T>): Promise<T> {
    if (this.writing) throw new WorkspaceOperationBusyError(translate("ade: Git update is running. Then restart."));
    this.readers++;
    try { return await operation(); } finally { this.readers--; }
  }
  async mutate<T>(operation: () => Promise<T>): Promise<T> {
    if (this.writing || this.readers > 0) throw new Error(translate("ade: Workspace preparation is running. Update again afterwards."));
    this.writing = true;
    try { return await operation(); } finally { this.writing = false; }
  }
}
export const workspaceOperations = new WorkspaceOperationGate();
