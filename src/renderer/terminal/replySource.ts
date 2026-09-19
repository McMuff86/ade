import { t as translate } from "../../shared/i18n";
import type { Terminal } from '@xterm/xterm';
import { MAX_REPLY_SOURCE_CHARS, type ReplySource } from '../../shared/terminalSpeech';

/** Capture what the operator actually sees, joining wrapped display lines. */
export function terminalReplySource(term: Terminal | null | undefined): ReplySource {
  if (!term) return { source: 'screen', text: '' };
  const selection = term.getSelection();
  if (selection) return { source: 'selection', text: selection };
  const buffer = term.buffer.active; const lines: string[] = [];
  for (let row = buffer.viewportY; row < Math.min(buffer.length, buffer.viewportY + term.rows); row++) {
    const line = buffer.getLine(row); if (!line) continue;
    const text = line.translateToString(true);
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  const text = lines.join('\n').trim();
  if (text.length > MAX_REPLY_SOURCE_CHARS) throw new Error(translate("This clip is too long. Please mark a shorter text."));
  return { source: 'screen', text };
}
