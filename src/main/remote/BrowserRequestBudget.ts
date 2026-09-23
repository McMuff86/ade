/** High-frequency terminal reads must not consume the budget for user actions. */
export class BrowserRequestBudget {
  private window = { at: Number.NEGATIVE_INFINITY, requests: 0, auth: 0, terminalQueries: 0, diagnostics: 0 };
  constructor(private readonly now = Date.now) {}
  permits(kind: string, method: string): boolean {
    const now = this.now();
    if (now - this.window.at >= 60_000) this.window = { at: now, requests: 0, auth: 0, terminalQueries: 0, diagnostics: 0 };
    if (kind === 'terminalQuery') return ++this.window.terminalQueries <= 1800;
    // Diagnostics spawn CLI probes on the PC: a handful per minute is plenty for a person tapping "Run again".
    if (kind === 'diagnosticsQuery') return ++this.window.requests <= 600 && ++this.window.diagnostics <= 12;
    const auth = kind === 'pair' || kind === 'session' && method === 'POST';
    return ++this.window.requests <= 600 && (!auth || ++this.window.auth <= 30);
  }
}
