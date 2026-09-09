/** Short-lived keyboard buffer. Unacknowledged input is never replayed after a disconnect. */
export class TerminalInputQueue {
  private text = '';
  private timer?: ReturnType<typeof setTimeout>;
  private sending = false;
  private generation = 0;
  constructor(private readonly send: (data: string) => Promise<'accepted' | 'busy' | 'failed'>,
    private readonly overflow: () => void, private readonly delay = 200) {}
  enqueue(data: string): void {
    if (new TextEncoder().encode(this.text + data).length > 8192) { this.clear(); this.overflow(); return; }
    this.text += data; this.schedule();
  }
  clear(): void { this.generation++; this.text = ''; clearTimeout(this.timer); this.timer = undefined; }
  private schedule(): void {
    if (!this.timer && !this.sending && this.text) this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, this.delay);
  }
  private async flush(): Promise<void> {
    let chunk = ''; let bytes = 0;
    for (const char of this.text) { bytes += new TextEncoder().encode(char).length; if (bytes > 2048) break; chunk += char; }
    if (!chunk) return;
    const generation = this.generation; this.sending = true;
    let result: 'accepted' | 'busy' | 'failed' = 'failed';
    try { result = await this.send(chunk); } catch { /* fail closed */ }
    this.sending = false;
    if (generation !== this.generation) { this.schedule(); return; }
    if (result === 'failed') this.clear();
    else { if (result === 'accepted') this.text = this.text.slice(chunk.length); this.schedule(); }
  }
}
