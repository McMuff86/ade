import { DICTATION_MAX_SECONDS, DICTATION_SAMPLE_RATE } from './dictation';

/** The recorder resamples to mono before encoding; the host rechecks this exact envelope. */
export function encodeDictationPcm(samples: Float32Array): Uint8Array {
  if (samples.length < DICTATION_SAMPLE_RATE / 10 || samples.length > DICTATION_SAMPLE_RATE * DICTATION_MAX_SECONDS) {
    throw new Error('Die Aufnahme muss zwischen 0,1 und 60 Sekunden lang sein.');
  }
  const bytes = new Uint8Array(44 + samples.length * 2); const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, DICTATION_SAMPLE_RATE, true); view.setUint32(28, DICTATION_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, bytes.length - 44, true);
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) throw new Error('Ungültige Audiodaten. Bitte erneut aufnehmen.');
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true);
  }
  return bytes;
}
