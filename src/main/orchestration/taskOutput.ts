import type { RunTaskOutput } from '../../shared/types';
import { redactSensitiveText } from '../errors';
import { extractJsonEventObjects, normalizePtyJsonStream, parseJsonEventObject } from './runtimeEventStream';

export const TASK_OUTPUT_LIMIT = 64 * 1024;

/** Only structured assistant messages, never user messages, tool input or raw PTY. */
export function taskOutputFromStream(raw: string, prompt: string): RunTaskOutput | undefined {
  const { objects } = extractJsonEventObjects(normalizePtyJsonStream(raw));
  let text = ''; let grok = '';
  for (const object of objects) {
    const event = parseJsonEventObject(object); if (!event) continue;
    if (event.type === 'item.completed' && event.item && typeof event.item === 'object') {
      const item = event.item as Record<string, unknown>;
      if (item.type === 'agent_message' && typeof item.text === 'string') text = item.text;
    }
    if (event.type === 'result' && typeof event.result === 'string') text = event.result;
    if (event.type === 'assistant' && event.message && typeof event.message === 'object') {
      const content = (event.message as Record<string, unknown>).content;
      if (Array.isArray(content)) {
        const parts = content.filter((part) => part && part.type === 'text' && typeof part.text === 'string').map((part) => part.text as string);
        if (parts.length) text = parts.join('\n\n');
      }
    }
    if (event.type === 'text' && typeof event.data === 'string') grok = (grok + event.data).slice(0, TASK_OUTPUT_LIMIT * 2);
    if (event.type === 'end') {
      if (typeof event.text === 'string') text = event.text;
      else if (grok) text = grok;
    }
  }
  if (!text.trim()) return undefined;
  // The task contract itself is never included in the result projection.
  if (prompt.trim()) text = text.split(prompt.trim()).join('[Auftragstext ausgeblendet]');
  text = redactSensitiveText(text).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  return { text: text.slice(0, TASK_OUTPUT_LIMIT), limited: text.length > TASK_OUTPUT_LIMIT, source: 'structured-cli' };
}
