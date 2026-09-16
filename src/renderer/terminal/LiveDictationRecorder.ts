import { DICTATION_SAMPLE_RATE } from '../../shared/dictation';
import { LIVE_DICTATION_MAX_SECONDS, LIVE_DICTATION_PACKET_SAMPLES } from '../../shared/liveDictation';
const workletUrl = new URL('./dictation-worklet.js?no-inline', import.meta.url).href;

/** PCM packets use the existing authenticated bridge. No provider credentials
 * or outbound network connection are needed in the renderer. */
export class LiveDictationRecorder {
  private cancelled = false;
  private stopping = false;
  private ended = false;
  private stream?: MediaStream;
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private timer?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setTimeout>;
  private queue = Promise.resolve();
  private queuedBytes = 0;
  private onStop?: (done: Promise<void>) => void;

  /** Ask for the microphone before opening the provider stream. No audio is
   * captured or queued until start connects the prepared worklet graph. */
  async prepare(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true }, video: false });
      if (this.cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      const context = new AudioContext({ sampleRate: DICTATION_SAMPLE_RATE }); this.context = context;
      if (context.sampleRate !== DICTATION_SAMPLE_RATE) throw new Error('sample rate');
      await context.audioWorklet.addModule(workletUrl);
      if (this.cancelled) return;
    } catch {
      this.release();
      if (!this.cancelled) throw new Error('Live-Mikrofon konnte nicht vorbereitet werden. Gerät und Mikrofonfreigabe prüfen.');
    }
  }
  async start(push: (bytes: Uint8Array) => Promise<unknown>, onStop: (done: Promise<void>) => void): Promise<void> {
    this.onStop = onStop;
    if (this.cancelled) return;
    try {
      const { stream, context } = this;
      if (!stream || !context) throw new Error('microphone not prepared');
      const node = new AudioWorkletNode(context, 'ade-dictation-pcm', { processorOptions: {
        maxSamples: LIVE_DICTATION_MAX_SECONDS * DICTATION_SAMPLE_RATE, packetSamples: LIVE_DICTATION_PACKET_SAMPLES,
      } }); this.node = node;
      node.port.onmessage = event => {
        if (this.cancelled || this.ended) return;
        if (event.data.type === 'end') { this.complete(); return; }
        const bytes = new Uint8Array(event.data.bytes as ArrayBuffer);
        this.queuedBytes += bytes.length;
        if (this.queuedBytes > 128 * 1024) { this.fail(new Error('Live-Diktat ist zu langsam verbunden. Aufnahme gestoppt.')); return; }
        this.queue = this.queue.then(async () => { if (!this.cancelled) await push(bytes); this.queuedBytes -= bytes.length; });
        void this.queue.catch(() => this.fail(new Error('Live-Audio konnte nicht übertragen werden. Keine automatische Wiederholung.')));
      };
      node.onprocessorerror = () => this.fail(new Error('Live-Mikrofonaufnahme unterbrochen.'));
      context.createMediaStreamSource(stream).connect(node); node.connect(context.destination);
      await context.resume();
      if (this.cancelled) return;
      this.timer = setTimeout(() => this.stop(), LIVE_DICTATION_MAX_SECONDS * 1000);
    } catch {
      this.release();
      if (!this.cancelled) throw new Error('Live-Mikrofon konnte nicht gestartet werden. Gerät und Mikrofonfreigabe prüfen.');
    }
  }
  stop(): void {
    if (this.stopping || this.ended) return; this.stopping = true; clearTimeout(this.timer);
    this.stream?.getTracks().forEach(track => track.stop());
    this.node?.port.postMessage('stop');
    this.watchdog = setTimeout(() => this.fail(new Error('Mikrofonabschluss nicht bestätigt.')), 2000);
  }
  cancel(): void { this.cancelled = true; this.release(); }
  private complete(): void {
    if (this.ended || this.cancelled) return; this.ended = true; this.release(); this.onStop?.(this.queue);
  }
  private fail(error: Error): void {
    if (this.ended || this.cancelled) return; this.ended = true; this.cancelled = true; this.release();
    const failed = Promise.reject(error); void failed.catch(() => undefined); this.onStop?.(failed);
  }
  private release(): void {
    clearTimeout(this.timer); clearTimeout(this.watchdog);
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined;
    this.node?.disconnect(); this.node?.port.close(); this.node = undefined;
    if (this.context) void this.context.close().catch(() => undefined); this.context = undefined;
  }
}
