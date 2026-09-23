import { t as translate } from "../../shared/i18n";
import { DICTATION_LANGUAGE, DICTATION_MAX_TEXT_CHARS, DICTATION_SAMPLE_RATE, type DictationTranscript } from '../../shared/dictation';
import { LIVE_DICTATION_AUDIO_START_TIMEOUT_MS, LIVE_DICTATION_CHUNK_BYTES, LIVE_DICTATION_MAX_SECONDS, LIVE_DICTATION_SESSION_TIMEOUT_MS } from '../../shared/liveDictation';
import { redactedErrorDetail } from '../errors';
import type { SpeechUsageService, SpeechUsageAttribution } from '../usage/SpeechUsageService';

export interface LiveDictationSession {
  result: Promise<DictationTranscript>;
  push(audio: Uint8Array): void;
  finish(): void;
}

/** One bounded stream, owned by main. Neither the API key nor the single-use
 * socket credential is returned to a renderer or written to a journal. */
export async function openLiveDictation(options: {
  key: string; authorize: () => void; signal: AbortSignal; preview: (text: string) => void;
  usage?: SpeechUsageService; attribution: SpeechUsageAttribution;
  fetcher?: typeof fetch; connect?: (url: string) => WebSocket;
}): Promise<LiveDictationSession> {
  const { authorize, signal } = options;
  const check = () => { authorize(); if (signal.aborted) throw new Error(translate("Live dictation cancelled.")); };
  check();
  // Native WebSocket has no custom header option. Main obtains a scoped token
  // and keeps it in main as well; no dependency or renderer network exception.
  const tokenSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  let token = '';
  try {
    const response = await (options.fetcher ?? fetch)('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe', {
      method: 'POST', headers: { 'xi-api-key': options.key }, signal: tokenSignal, redirect: 'error',
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error('token'); }
    const reader = response.body?.getReader(); if (!reader) throw new Error('token');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.length; if (size > 8192) throw new Error('token'); chunks.push(next.value);
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || !('token' in data) || typeof data.token !== 'string'
      || !/^[A-Za-z0-9_.-]{8,4096}$/.test(data.token)) throw new Error('token');
    token = data.token;
  } catch { throw new Error(translate("Live dictation could not be connected. ElevenLabs-Key, Speech-to-Text sharing and connection check.")); }
  check();
  const attempt = await options.usage?.begin({ ...options.attribution, product: 'dictation', model: 'scribe_v2_realtime', audioSeconds: null });
  let socket: WebSocket | undefined; let bytes = 0; let settled = false; let finishing = false; let connected = false;
  let committedText = ''; let segmentBytes = 0; let pendingCommits = 0;
  const combinedText = (segment: string) => {
    const text = [committedText, segment.trim()].filter(Boolean).join(' ');
    if (text.length > DICTATION_MAX_TEXT_CHARS) throw new Error('transcript length');
    return text;
  };
  let resolveReady!: () => void; let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  let resolveResult!: (value: DictationTranscript) => void; let rejectResult!: (error: Error) => void;
  const result = new Promise<DictationTranscript>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  void result.catch(() => undefined); void ready.catch(() => undefined);
  let deadline: ReturnType<typeof setTimeout>; let monitor: ReturnType<typeof setInterval>;
  const end = (error?: Error, text = '') => {
    if (settled) return; settled = true; clearTimeout(deadline); clearInterval(monitor); signal.removeEventListener('abort', abort);
    if (socket && socket.readyState < 2) socket.close();
    const audioSeconds = bytes / (DICTATION_SAMPLE_RATE * 2);
    void (async () => {
      await attempt?.finish(error ? socket ? 'unconfirmed' : 'not-sent' : 'complete', audioSeconds)
        .catch(failure => console.warn('[ade] live dictation usage finalization failed:', redactedErrorDetail(failure)));
      if (error) { rejectReady(error); rejectResult(error); }
      else resolveResult({ text, audioSeconds, model: 'scribe_v2_realtime', language: null });
    })();
  };
  const abort = () => end(new Error(translate("Live dictation cancelled.")));
  const arm = (milliseconds: number) => { clearTimeout(deadline); deadline = setTimeout(() => end(new Error(translate("Live dictation reached its time limit."))), milliseconds); };
  signal.addEventListener('abort', abort, { once: true });
  monitor = setInterval(() => { try { check(); } catch { abort(); } }, 1000);
  arm(10_000);
  try {
    check();
    const query = new URLSearchParams({ model_id: 'scribe_v2_realtime', language_code: DICTATION_LANGUAGE, audio_format: 'pcm_16000', commit_strategy: 'manual', token });
    socket = (options.connect ?? (url => new WebSocket(url)))(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?${query}`);
    socket.addEventListener('error', () => end(new Error(translate("Connection to live dictation interrupted. No automatic repetition."))));
    socket.addEventListener('close', () => end(new Error(translate("Live dictation was separated without confirmed closure."))));
    socket.addEventListener('message', event => {
      if (settled) return;
      try {
        check();
        if (typeof event.data !== 'string' || event.data.length > 64 * 1024) throw new Error('message');
        const data: unknown = JSON.parse(event.data);
        if (!data || typeof data !== 'object' || !('message_type' in data)) throw new Error('message');
        if (data.message_type === 'session_started') { if (connected) throw new Error('duplicate session'); connected = true; arm(LIVE_DICTATION_AUDIO_START_TIMEOUT_MS); resolveReady(); return; }
        if (data.message_type === 'partial_transcript' || data.message_type === 'committed_transcript') {
          if (!connected || !('text' in data) || typeof data.text !== 'string' || data.text.length > DICTATION_MAX_TEXT_CHARS
            || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(data.text)) throw new Error('transcript');
          if (data.message_type === 'partial_transcript') options.preview(combinedText(data.text));
          else {
            committedText = combinedText(data.text);
            if (pendingCommits > 0) pendingCommits--;
            options.preview(committedText);
            if (finishing && pendingCommits === 0) end(undefined, committedText);
          }
          return;
        }
        // Ignore optional metadata, never expose provider payloads or errors.
        if (data.message_type === 'warning') return;
        end(new Error(translate("ElevenLabs has ended the live dictation checking permission, balance and connection.")));
      } catch { end(new Error(translate("Live dictation did not return a valid transcript. Your existing draft is preserved."))); }
    });
    await ready;
    return {
      result,
      push(audio) {
        check();
        if (settled || finishing || socket?.readyState !== 1) throw new Error(translate("Live dictation is no longer receptive."));
        if (!(audio instanceof Uint8Array) || !audio.length || audio.length % 2 || audio.length > LIVE_DICTATION_CHUNK_BYTES
          || bytes + audio.length > LIVE_DICTATION_MAX_SECONDS * DICTATION_SAMPLE_RATE * 2) throw new Error(translate("Invalid or too long audio stream."));
        if (socket.bufferedAmount > 64 * 1024) { end(new Error(translate("Live dictation connection is too slow. Record again."))); throw new Error(translate("Audio stream stopped.")); }
        // Commit well before the provider's ~36-second automatic segment boundary.
        // Count acknowledgements so Stop cannot mistake a pending segment for the final one.
        // A bounded setup window must not consume recording time. Later packets
        // cannot renew the recording deadline, even if the sender stalls.
        if (bytes === 0) arm(LIVE_DICTATION_SESSION_TIMEOUT_MS);
        bytes += audio.length; segmentBytes += audio.length;
        const commit = segmentBytes >= 20 * DICTATION_SAMPLE_RATE * 2;
        if (commit) { segmentBytes = 0; pendingCommits++; }
        socket.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: Buffer.from(audio).toString('base64'),
          sample_rate: DICTATION_SAMPLE_RATE, ...(commit ? { commit: true } : {}) }));
      },
      finish() {
        check(); if (finishing || settled) return;
        if (bytes < 3200 || socket?.readyState !== 1) { end(new Error(translate("Recording too short. Speak for at least 0.1 seconds."))); return; }
        finishing = true; arm(15_000);
        if (segmentBytes) {
          segmentBytes = 0; pendingCommits++;
          socket.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: '', commit: true, sample_rate: DICTATION_SAMPLE_RATE }));
        } else if (pendingCommits === 0) end(undefined, committedText);
      },
    };
  } catch {
    end(new Error(translate("Live dictation could not be started. Check connection and ElevenLabs permission.")));
    await result; throw new Error(translate("Live dictation not available."));
  }
}
