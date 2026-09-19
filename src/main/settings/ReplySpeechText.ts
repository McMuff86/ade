import { t as translate } from "../../shared/i18n";
import { redactForWire } from '../errors';
import { MAX_REPLY_SOURCE_CHARS, MAX_REPLY_SPOKEN_CHARS, validReplyInput, type ReplyInput } from '../../shared/terminalSpeech';

/** Local extractive shortening. No model, invented outcome or interpretation of terminal instructions. */
export function replySpeechText(input: ReplyInput, secrets: readonly string[] = []): { text: string; shortened: boolean } {
  if (!validReplyInput(input)) throw new Error(translate("Invalid terminal text. Please select a maximum of 12,000 characters."));
  let safe = input.text;
  for (const secret of [...secrets].filter(value => value.length >= 6).sort((a, b) => b.length - a.length)) safe = safe.split(secret).join('[credential]');
  safe = safe.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, '');
  safe = redactForWire(safe, MAX_REPLY_SOURCE_CHARS).replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '');
  let fenced = false; let codeOmitted = false;
  const lines = safe.split('\n').flatMap(line => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; codeOmitted = true; return []; }
    if (fenced) return [];
    return [line.replace(/^\s*(?:#{1,6}\s+|[-*•]\s+|\d+[.)]\s+)/, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/(?:\*\*|__|`)/g, '').trim()];
  });
  const full = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!full || !/[\p{L}\p{N}]/u.test(full)) throw new Error(translate("There's no readable text here yet. Mark a response in the terminal."));
  if (input.mode === 'full') {
    if (full.length > MAX_REPLY_SPOKEN_CHARS) throw new Error(translate("The text is too long to read aloud. Choose a smaller excerpt or “Read aloud for short”."));
    return { text: full, shortened: codeOmitted };
  }
  // Keep whole source sentences in order. Never take a sentence fragment that
  // might drop a negation or qualify a result incorrectly.
  const sentences = [...new Intl.Segmenter('de', { granularity: 'sentence' }).segment(full)].map(item => item.segment.trim()).filter(Boolean);
  const chosen: string[] = [];
  for (const sentence of sentences) {
    if (chosen.length >= 4 || [...chosen, sentence].join(' ').length > 900) break;
    chosen.push(sentence);
  }
  if (!chosen.length) throw new Error(translate("This section cannot be shortened in any meaningful way. Select “Read everything” or mark a shorter text."));
  return { text: chosen.join(' '), shortened: codeOmitted || chosen.length < sentences.length };
}
