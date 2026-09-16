import { ClaudeActivityParser, type ClaudeUsage } from './claudeStream';
import { extractJsonEventObjects, normalizePtyJsonStream, parseJsonEventObject } from './runtimeEventStream';

/** Qwen uses the same message envelope, but prompt tokens already include cache reads.
 * Source: Qwen Code 0.23.4 nonInteractiveHelpers.computeUsageFromMetrics(). */
function readQwenUsage(event: Record<string, unknown>): ClaudeUsage | null {
  const usage = event.usage;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const { input_tokens: input, output_tokens: output } = usage as Record<string, unknown>;
  if (!Number.isSafeInteger(input) || (input as number) < 0 || !Number.isSafeInteger(output) || (output as number) < 0) return null;
  return { inputTokens: input as number, outputTokens: output as number, costUsd: null };
}

export class QwenActivityParser extends ClaudeActivityParser {
  constructor() { super(readQwenUsage, ['init', 'session_start']); }
}

/** Only the terminal result envelope is authoritative; partial assistant text is not. */
export function qwenTerminalResult(output: string): { result: unknown; usage: ClaudeUsage | null } {
  const { objects } = extractJsonEventObjects(normalizePtyJsonStream(output));
  let terminal: Record<string, unknown> | null = null;
  for (const raw of objects) {
    const event = parseJsonEventObject(raw);
    if (event?.type === 'result') terminal = event;
  }
  if (!terminal || terminal.is_error !== false || terminal.subtype !== 'success') {
    throw new Error('ade: Qwen Code did not return a successful terminal result.');
  }
  if (typeof terminal.result !== 'string' || Buffer.byteLength(terminal.result, 'utf8') > 1024 * 1024) {
    throw new Error('ade: Qwen Code structured result is missing or too large.');
  }
  const text = terminal.result.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
  let result: unknown;
  try { result = JSON.parse(text); } catch { throw new Error('ade: Qwen Code structured result is not valid JSON.'); }
  return { result, usage: readQwenUsage(terminal) };
}
