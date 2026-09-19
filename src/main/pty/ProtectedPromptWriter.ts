/** Codex's Windows paste detector suppresses Enter for 120 ms after a burst.
 * Keep the submit key separate, holding a per-PTY input lock throughout. This
 * acknowledges transport only; the CLI remains responsible for its input UI. */
export class ProtectedPromptWriter {
  private readonly pending = new Set<string>();
  constructor(private readonly port: { check(id: string): void; write(id: string, bytes: string): void },
    private readonly settle: () => Promise<void> = () => new Promise(done => setTimeout(done, 500))) {}

  busy(id: string): boolean { return this.pending.has(id); }

  async write(id: string, payload: string | readonly string[], authorize: () => void | Promise<void>): Promise<void> {
    if (this.pending.has(id)) throw new Error('Promptübergabe läuft. Bitte kurz warten.');
    this.pending.add(id);
    try {
      const parts = typeof payload === 'string' ? [payload] : payload;
      for (let index = 0; index < parts.length; index++) {
        const bytes = parts[index]!;
        await authorize(); this.port.check(id);
        const submit = bytes.endsWith('\x1b[201~\r');
        this.port.write(id, submit ? bytes.slice(0, -1) : bytes);
        // Each image path is its own paste, so Codex recognizes it as an image.
        // Keep the same input lock across attachments, message and final Enter.
        if (submit || index < parts.length - 1) await this.settle();
        if (submit) {
          await authorize(); this.port.check(id);
          this.port.write(id, '\r');
        }
      }
    } finally { this.pending.delete(id); }
  }
}
