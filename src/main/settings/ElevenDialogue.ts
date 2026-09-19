import { t as translate } from "../../shared/i18n";
import { currentLocale } from '../../shared/i18n';
import type { AppLocale } from '../../shared/i18n/locales';
import type { SpeechTuning } from '../../shared/speech';

export const SPEECH_MODEL = 'eleven_v3';
export type DialogueConnect = (url: string) => WebSocket;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

/** Provider-only pronunciation: display and previews retain ordinary spelling. */
export const speechPronunciation = (text: string): string => {
  // English “agent”, first-syllable stress and an explicit syllable boundary.
  // Apply at whole words in read-aloud replies too, without changing visible text.
  const spoken = text.replace(/(?<![\p{L}\p{N}_])Agent(?![\p{L}\p{N}_])/giu, '"/ˈeɪ.dʒənt/"');
  return spoken.replace(/(?<![\p{L}\p{N}_])Adi(?![\p{L}\p{N}_])/gu, '"/ˈadi/"');
};

/** One bounded utterance. Only a final receipt completes it; never replay an interrupted paid request. */
export function dialogueAudio(input: { key: string; voiceId: string; text: string; tuning: SpeechTuning;
  language?: AppLocale | 'auto';
  authorize: () => void; dispatched: () => void; signal?: AbortSignal; connect?: DialogueConnect; timeoutMs?: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let socket: WebSocket | undefined; let settled = false; let size = 0;
    const chunks: Buffer[] = [];
    const failure = translate("ElevenLabs voice output interrupted. Check connection, credit and text-to-speech sharing. No automatic repetition.");
    const end = (error?: string) => {
      if (settled) return; settled = true;
      clearTimeout(deadline); clearInterval(monitor); input.signal?.removeEventListener('abort', abort);
      if (socket && socket.readyState < 2) { try { socket.close(); } catch { /* Already disconnected. */ } }
      if (error) reject(new Error(error)); else resolve(Buffer.concat(chunks));
    };
    const abort = () => end(translate("ElevenLabs speech cancelled."));
    const allowed = () => { input.signal?.throwIfAborted(); input.authorize(); };
    const deadline = setTimeout(() => end(translate("ElevenLabs voice output has reached the time limit. No automatic repetition.")), input.timeoutMs ?? 30_000);
    const monitor = setInterval(() => { try { allowed(); } catch { abort(); } }, 1000);
    input.signal?.addEventListener('abort', abort, { once: true });
    try {
      allowed();
      const query = new URLSearchParams({ model_id: SPEECH_MODEL, output_format: 'mp3_44100_128' });
      if (input.language !== 'auto') query.set('language_code', input.language ?? currentLocale());
      socket = (input.connect ?? (url => new WebSocket(url)))(`wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?${query}`);
      socket.addEventListener('open', () => {
        if (settled) return;
        try {
          allowed();
          // TTD consumes stability only. Old TTS speed/style/boost preferences remain stored, but are not sent.
          socket!.send(JSON.stringify({ voices: [input.voiceId], xi_api_key: input.key, voice_settings: { stability: input.tuning.stability } }));
          allowed(); input.dispatched();
          socket!.send(JSON.stringify({ inputs: [{ text: input.text, voice_id: input.voiceId }] }));
          socket!.send(JSON.stringify({ close_socket: true }));
        } catch { end(failure); }
      });
      socket.addEventListener('error', () => end(failure));
      socket.addEventListener('close', () => end(failure));
      socket.addEventListener('message', event => {
        if (settled) return;
        try {
          allowed();
          if (typeof event.data !== 'string' || event.data.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 65536) throw Error('frame');
          const data: unknown = JSON.parse(event.data);
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('frame');
          const frame = data as Record<string, unknown>;
          if (frame.error || frame.type === 'error') { end(failure); return; }
          if (frame.audio !== undefined && frame.audio !== null && frame.audio !== '') {
            if (typeof frame.audio !== 'string' || frame.audio.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(frame.audio)) throw Error('audio');
            const bytes = Buffer.from(frame.audio, 'base64'); size += bytes.length;
            if (bytes.toString('base64') !== frame.audio) throw Error('audio');
            if (size > MAX_AUDIO_BYTES) throw Error('limit'); chunks.push(bytes);
          }
          if (frame.is_final === true) {
            if (size < 100) throw Error('empty');
            end();
          }
        } catch { end(translate("ElevenLabs audio is incomplete, invalid or too large. Please try again.")); }
      });
    } catch { end(failure); }
  });
}
