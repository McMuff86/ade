// Deterministic provider peer. Production PCM capture, job ownership, usage
// accounting and host boundaries remain in use; no paid speech request occurs.
const fetchOriginal = global.fetch;
global.fetch = async (url, init) => {
  if (String(url) === 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe') {
    global.adeSpeechStarts = (global.adeSpeechStarts || 0) + 1;
    return Response.json({ token: 'conversation-speech-fixture' });
  }
  return fetchOriginal(url, init);
};
global.WebSocket = class extends EventTarget {
  readyState = 1; bufferedAmount = 0; committed = false;
  constructor(url) {
    super(); const value = new URL(url);
    if (value.origin !== 'wss://api.elevenlabs.io' || value.searchParams.get('token') !== 'conversation-speech-fixture'
      || value.searchParams.get('model_id') !== 'scribe_v2_realtime' || value.searchParams.get('audio_format') !== 'pcm_16000') throw new Error('Unexpected speech endpoint');
    setTimeout(() => this.message({ message_type: 'session_started' }), 5);
  }
  message(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
  send(raw) {
    const value = JSON.parse(raw);
    if (value.message_type !== 'input_audio_chunk' || value.sample_rate !== 16000) throw new Error('Unexpected speech packet');
    const text = 'Wo stehen meine Projekte heute?';
    if (value.commit) { const output = this.committed ? '' : text; this.committed = true; setTimeout(() => this.message({ message_type: 'committed_transcript', text: output }), 5); }
    else this.message({ message_type: 'partial_transcript', text: this.committed ? '' : text });
  }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
};
