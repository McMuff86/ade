import { t as translate } from "../../shared/i18n";
import type { DictationJobState } from '../../shared/dictation';
import type { ConversationDrafts, ConversationRecordingDraft } from './conversationDrafts';

export interface ConversationRecordingPort {
  microphone(allow: boolean): Promise<void>;
  prepare(conversationId: string): Promise<{ jobId: string }>;
  start(jobId: string): Promise<void>;
  chunk(jobId: string, sequence: number, audioBase64: string): Promise<void>;
  finish(jobId: string): Promise<void>;
  query(jobId: string): Promise<DictationJobState>;
  cancel(jobId: string): Promise<void>;
}
export interface ConversationCapture {
  prepare(): Promise<void>;
  start(push: (bytes: Uint8Array) => Promise<unknown>, stopped: (flushed: Promise<void>) => void): Promise<void>;
  stop(): void;
  cancel(): void;
}
export interface ConversationRecordingView {
  phase: 'idle' | 'preparing' | 'recording' | 'transcribing' | 'checking' | 'preview';
  value?: ConversationRecordingDraft; error: string;
}
const message = (e: unknown) => e instanceof Error ? e.message : String(e);

/** One mounted conversation owns one capture. It never sends a model message.
 * Only text and the host ticket survive navigation; audio remains ephemeral. */
export class ConversationRecording {
  private view: ConversationRecordingView = { phase: 'idle', error: '' };
  private alive = true;
  private capture?: ConversationCapture;
  private jobId?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private querying = false;
  private finishing = false;
  constructor(private readonly id: string, private readonly drafts: ConversationDrafts,
    private readonly port: ConversationRecordingPort, private readonly makeCapture: () => ConversationCapture,
    private readonly changed: (view: ConversationRecordingView) => void) {
    try { const value = drafts.recording(id); if (value) { this.jobId = value.jobId; this.view = { phase: 'preview', value, error: '' }; } }
    catch (e) { this.view.error = message(e); }
  }
  snapshot(): ConversationRecordingView { return structuredClone(this.view); }
  private notify(): void { if (this.alive) this.changed(this.snapshot()); }
  private store(text: string, complete: boolean): void {
    const jobId = this.jobId ?? this.view.value?.jobId;
    if (!jobId) throw new Error(translate("Recording has no confirmed target."));
    const value = { id: this.id, jobId, text, complete };
    this.view.value = value; // Keep visible text for copying even if storage fails.
    this.drafts.saveRecording(value);
  }
  private cancelJob(id = this.jobId): void { if (id) void this.port.cancel(id).catch(() => undefined); }
  private failure(error: unknown): void {
    if (!this.alive) return;
    clearTimeout(this.timer); this.capture?.cancel(); this.cancelJob();
    this.view.phase = this.view.value ? 'preview' : 'idle'; this.view.error = message(error); this.notify();
  }
  async start(): Promise<void> {
    if (!this.alive || this.view.phase !== 'idle' || this.view.value) return;
    this.view = { phase: 'preparing', error: '' }; this.notify();
    const capture = this.makeCapture(); this.capture = capture;
    try {
      if (this.drafts.recording(this.id)) throw new Error(translate("First check the existing dictation."));
      await this.port.microphone(true);
      if (!this.alive) return;
      try { await capture.prepare(); } finally { await this.port.microphone(false); }
      if (!this.alive) return;
      const { jobId } = await this.port.prepare(this.id); this.jobId = jobId;
      if (!this.alive) { this.cancelJob(); return; }
      const value = { id: this.id, jobId, text: '', complete: false };
      // Reserve recovery identity before the first paid provider operation.
      this.drafts.saveRecording(value, true); this.view.value = value;
      await this.port.start(jobId);
      if (!this.alive) { this.cancelJob(); return; }
      let sequence = 0;
      this.view.phase = 'recording'; this.notify();
      await capture.start(async bytes => {
        if (!this.alive || this.view.phase !== 'recording') throw new Error(translate("Recording was terminated."));
        let raw = ''; for (const byte of bytes) raw += String.fromCharCode(byte);
        await this.port.chunk(jobId, sequence++, btoa(raw));
      }, flushed => { void this.finish(flushed); });
      if (this.alive && this.view.phase === 'recording') void this.poll();
    } catch (error) { this.failure(error); }
    finally { if (!this.alive) capture.cancel(); void this.port.microphone(false).catch(() => undefined); }
  }
  stop(): void { if (this.view.phase === 'recording') this.capture?.stop(); }
  private async finish(flushed: Promise<void>): Promise<void> {
    if (this.finishing || !this.alive) { void flushed.catch(() => undefined); return; }
    this.finishing = true;
    try {
      await flushed; if (!this.alive) return;
      this.view.phase = 'transcribing'; this.notify();
      await this.port.finish(this.jobId!); if (this.alive) void this.poll();
    } catch (error) { this.failure(error); }
  }
  private async poll(): Promise<void> {
    if (this.querying || !this.alive || !this.jobId || !['recording', 'transcribing'].includes(this.view.phase)) return;
    clearTimeout(this.timer); this.querying = true;
    try {
      const state = await this.port.query(this.jobId); if (!this.alive || !['recording', 'transcribing'].includes(this.view.phase)) return;
      if (state.status === 'recording') this.store(state.text, false);
      else if (state.status === 'complete') { this.store(state.transcript.text, true); this.view.phase = 'preview'; this.capture?.cancel(); }
      else if (state.status === 'failed' || state.status === 'cancelled') throw new Error(state.status === 'failed' ? state.message : translate("Recording ended. The text captured so far remains incomplete."));
      this.notify();
    } catch (error) { this.failure(error); }
    finally {
      this.querying = false;
      if (this.alive && ['recording', 'transcribing'].includes(this.view.phase)) this.timer = setTimeout(() => { void this.poll(); }, 350);
    }
  }
  async recover(): Promise<void> {
    if (!this.alive || this.view.phase !== 'preview' || !this.view.value) return;
    const { jobId } = this.view.value; this.view.phase = 'checking'; this.view.error = ''; this.notify();
    try {
      const state = await this.port.query(jobId); if (!this.alive) return;
      if (state.status === 'complete') this.store(state.transcript.text, true);
      else {
        if (state.status === 'recording') this.store(state.text, false);
        this.cancelJob(jobId);
        this.view.error = state.status === 'failed' ? state.message : translate("This recording has been interrupted. Check the previous part before the takeover.");
      }
    } catch (error) { if (this.alive) this.view.error = message(error); }
    finally { if (this.alive) { this.view.phase = 'preview'; this.notify(); } }
  }
  apply(): string | undefined {
    if (!this.alive || this.view.phase !== 'preview' || !this.view.value) return;
    try {
      if (JSON.stringify(this.drafts.recording(this.id)) !== JSON.stringify(this.view.value)) throw new Error(translate("The displayed dictation text could not be saved or was changed. copy text or check the dictation again."));
      const text = this.drafts.consumeRecording(this.id, this.view.value.jobId);
      this.cancelJob(this.view.value.jobId); this.jobId = undefined; this.view = { phase: 'idle', error: '' }; this.finishing = false; this.notify(); return text;
    } catch (e) { this.view.error = message(e); this.notify(); return; }
  }
  discard(): void {
    if (!this.alive || this.view.phase !== 'preview' || !this.view.value) return;
    try {
      this.drafts.discardRecording(this.id, this.view.value.jobId); this.cancelJob(this.view.value.jobId);
      this.jobId = undefined; this.view = { phase: 'idle', error: '' }; this.finishing = false; this.notify();
    } catch (e) { this.view.error = message(e); this.notify(); }
  }
  dispose(): void {
    this.alive = false; clearTimeout(this.timer); this.capture?.cancel(); this.cancelJob();
    void this.port.microphone(false).catch(() => undefined);
  }
}
