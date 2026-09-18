// Offline provider peer for UI/service fixtures. It consumes the real TTD frames,
// then passes an assembled request to the fixture's response/failure controller.
// No HTTP synthesis is used by production and this peer never contacts ElevenLabs.
function connect(fetcher) {
  return url => new class extends EventTarget {
    readyState = 0; controller = new AbortController(); init; inputs = [];
    constructor() {
      super(); this.url = new URL(url);
      if (this.url.origin !== 'wss://api.elevenlabs.io' || this.url.pathname !== '/v1/text-to-dialogue/stream-input'
        || this.url.searchParams.get('model_id') !== 'eleven_v3') throw Error('Unexpected dialogue endpoint');
      queueMicrotask(() => { if (this.readyState !== 0) return; this.readyState = 1; this.dispatchEvent(new Event('open')); });
    }
    send(raw) {
      const frame = JSON.parse(raw);
      if (!this.init) {
        if (!Array.isArray(frame.voices) || frame.voices.length !== 1 || !frame.xi_api_key) throw Error('Invalid dialogue init');
        this.init = frame; return;
      }
      if (frame.inputs) { this.inputs.push(...frame.inputs); return; }
      if (frame.close_socket !== true) throw Error('Unexpected dialogue control');
      void this.respond();
    }
    async respond() {
      try {
        const response = await fetcher('https://api.elevenlabs.io/v1/text-to-dialogue/stream-input', {
          method: 'POST', redirect: 'error', signal: this.controller.signal,
          headers: { 'xi-api-key': this.init.xi_api_key },
          body: JSON.stringify({ text: this.inputs.map(item => item.text).join(''), inputs: this.inputs, voices: this.init.voices,
            voice_settings: this.init.voice_settings, model_id: this.url.searchParams.get('model_id'), language_code: this.url.searchParams.get('language_code') }),
        });
        if (!response.ok) { this.message({ error: 'fixture-rejection' }); return; }
        if (response.headers.get('content-type') !== 'audio/mpeg') { this.message({ audio: '!invalid-base64!' }); return; }
        const bytes = Buffer.from(await response.arrayBuffer());
        for (let i = 0; i < bytes.length; i += 32768) this.message({ audio: bytes.subarray(i, i + 32768).toString('base64') });
        this.message({ is_final: true });
      } catch { this.dispatchEvent(new Event('error')); }
    }
    message(value) { if (this.readyState === 1) this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
    close() { this.readyState = 3; this.controller.abort(); this.dispatchEvent(new Event('close')); }
  }();
}
function install(fetcher = global.fetch) {
  const Native = global.WebSocket; const create = connect(fetcher);
  global.WebSocket = class extends Native {
    constructor(url, ...args) {
      if (String(url).startsWith('wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?')) return create(url);
      super(url, ...args);
    }
  };
}
module.exports = { connect, install };
