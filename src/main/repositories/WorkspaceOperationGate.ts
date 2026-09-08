/** Fence an explicit Git update against asynchronous launch/scope preparation.
 * Existing PTYs and persisted leases are checked separately at the target.
 * Refusal is immediate: no command waits behind a mutation with stale intent.
 */
export class WorkspaceOperationBusyError extends Error {}

export class WorkspaceOperationGate {
  private readers = 0;
  private writing = false;
  async use<T>(operation: () => Promise<T>): Promise<T> {
    if (this.writing) throw new WorkspaceOperationBusyError('ade: Git-Aktualisierung läuft. Danach erneut starten.');
    this.readers++;
    try { return await operation(); } finally { this.readers--; }
  }
  async mutate<T>(operation: () => Promise<T>): Promise<T> {
    if (this.writing || this.readers > 0) throw new Error('ade: Workspace-Vorbereitung läuft. Danach erneut aktualisieren.');
    this.writing = true;
    try { return await operation(); } finally { this.writing = false; }
  }
}
export const workspaceOperations = new WorkspaceOperationGate();
