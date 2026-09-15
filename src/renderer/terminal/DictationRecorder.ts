import { DICTATION_MAX_SECONDS, DICTATION_SAMPLE_RATE } from '../../shared/dictation';
import { encodeDictationPcm } from '../../shared/dictationAudio';

const MAX_ENCODED_BYTES = 4 * 1024 * 1024;

/** Shared by desktop and mobile. Records only after an explicit user action;
 * cancellation also stops streams delivered by a late permission response. */
export class DictationRecorder {
  private cancelled = false;
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private timer?: ReturnType<typeof setTimeout>;
  private chunks: Blob[] = [];
  private size = 0;
  private failure?: Error;
  private started = false;

  async start(onStop: (audio: Promise<Uint8Array>) => void): Promise<void> {
    if (this.started || this.cancelled) throw new Error('Diese Aufnahme ist nicht mehr verfügbar.');
    this.started = true;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error('Mikrofonaufnahme ist in diesem Browser nicht verfügbar. ADE über HTTPS öffnen.');
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true }, video: false });
      if (this.cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']
        .find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64_000 });
      this.recorder = recorder;
      recorder.ondataavailable = event => {
        if (this.cancelled || this.failure || !event.data.size) return;
        this.size += event.data.size;
        if (this.size > MAX_ENCODED_BYTES) { this.failure = new Error('Die Aufnahme ist zu gross. Bitte kürzer diktieren.'); this.stop(); }
        else this.chunks.push(event.data);
      };
      recorder.onerror = () => { this.failure = new Error('Mikrofonaufnahme fehlgeschlagen. Bitte erneut versuchen.'); this.stop(); };
      recorder.onstop = () => {
        this.releaseMicrophone();
        const chunks = this.chunks; this.chunks = [];
        if (this.cancelled) return;
        const audio = this.failure ? Promise.reject(this.failure) : this.decode(new Blob(chunks, { type: recorder.mimeType }));
        // The consumer handles the same rejection; avoid an unhandled microtask
        // if it unmounts between the native stop event and its own callback.
        void audio.catch(() => undefined);
        onStop(audio);
      };
      recorder.start(250);
      this.timer = setTimeout(() => this.stop(), DICTATION_MAX_SECONDS * 1000);
    } catch (error) {
      this.releaseMicrophone();
      if (this.cancelled) return;
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
        throw new Error('Mikrofonzugriff wurde nicht erlaubt. Die Freigabe in ADE beziehungsweise im Browser prüfen.');
      }
      throw new Error('Mikrofon konnte nicht gestartet werden. Gerät und Browserfreigabe prüfen.');
    }
  }

  stop(): void {
    clearTimeout(this.timer);
    if (this.recorder?.state === 'recording' || this.recorder?.state === 'paused') this.recorder.stop();
    this.releaseMicrophone();
  }

  cancel(): void { this.cancelled = true; this.chunks = []; this.stop(); }

  private releaseMicrophone(): void {
    clearTimeout(this.timer); this.timer = undefined;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined;
  }

  private async decode(blob: Blob): Promise<Uint8Array> {
    if (!blob.size || blob.size > MAX_ENCODED_BYTES || this.cancelled) throw new Error('Aufnahme leer oder abgebrochen.');
    const decoder = new AudioContext();
    try {
      const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
      if (this.cancelled) throw new Error('Aufnahme abgebrochen.');
      if (!Number.isFinite(decoded.duration) || decoded.duration < 0.1 || decoded.duration > DICTATION_MAX_SECONDS + 5) {
        throw new Error('Die Aufnahme muss zwischen 0,1 und 60 Sekunden lang sein.');
      }
      // Timers may run late in background tabs; the submitted file still has
      // a hard sixty-second sample boundary independently checked by main.
      const samples = Math.min(Math.floor(decoded.duration * DICTATION_SAMPLE_RATE), DICTATION_MAX_SECONDS * DICTATION_SAMPLE_RATE);
      const resampler = new OfflineAudioContext(1, samples, DICTATION_SAMPLE_RATE);
      const source = resampler.createBufferSource(); source.buffer = decoded; source.connect(resampler.destination); source.start();
      const mono = await resampler.startRendering();
      if (this.cancelled) throw new Error('Aufnahme abgebrochen.');
      return encodeDictationPcm(mono.getChannelData(0));
    } finally { await decoder.close().catch(() => undefined); }
  }
}
