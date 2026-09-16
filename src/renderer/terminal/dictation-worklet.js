// Runs off the UI thread. AudioContext resamples the microphone to 16 kHz.
class DictationPcmProcessor extends AudioWorkletProcessor {
  used = 0;
  total = 0;
  ended = false;
  constructor({ processorOptions: { maxSamples, packetSamples } }) {
    super();
    if (!Number.isSafeInteger(maxSamples) || maxSamples < 1 || !Number.isSafeInteger(packetSamples) || packetSamples < 1) throw new Error('Invalid PCM limits');
    this.maxSamples = maxSamples; this.buffer = new Int16Array(packetSamples);
    this.port.onmessage = event => { if (event.data === 'stop') this.finish(); };
  }
  flush() {
    if (!this.used) return;
    const bytes = new ArrayBuffer(this.used * 2);
    const view = new DataView(bytes);
    for (let i = 0; i < this.used; i++) view.setInt16(i * 2, this.buffer[i], true);
    this.port.postMessage({ type: 'pcm', bytes }, [bytes]); this.used = 0;
  }
  finish() {
    if (this.ended) return;
    this.ended = true; this.flush(); this.port.postMessage({ type: 'end' });
  }
  process(inputs) {
    if (this.ended) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0; for (const channel of channels) sample += channel[i];
      sample = Math.max(-1, Math.min(1, sample / channels.length));
      this.buffer[this.used++] = Math.round(sample < 0 ? sample * 32768 : sample * 32767);
      this.total++;
      if (this.used === this.buffer.length) this.flush();
      if (this.total >= this.maxSamples) { this.finish(); return false; }
    }
    return true;
  }
}
registerProcessor('ade-dictation-pcm', DictationPcmProcessor);
