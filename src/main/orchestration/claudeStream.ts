/**
 * Claude `--output-format stream-json` support.
 *
 * Two consumers, one format:
 *  - `ClaudeActivityParser` turns the live event stream into short, readable
 *    activity lines ("Denkt nach…", "Bash: pnpm test", "Edit: …") for the
 *    Graph live view. Print mode buffers its human output until exit, so the
 *    JSON stream is the only way to see a managed task work in real time.
 *  - `parseClaudeUsage` extracts trusted token and cost telemetry from the
 *    terminal transcript at task completion.
 *
 * ConPTY hard-wraps long lines, so neither may assume one JSON object per
 * line: objects are reassembled by brace depth, and literal newlines inside a
 * candidate object are dropped (a raw newline inside a JSON string is always a
 * wrap artifact — a real one would be escaped).
 */

import type { ActivityLine } from '../../shared/ipc';

const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const PENDING_CAP_BYTES = 2 * 1024 * 1024;
const ACTIVITY_TEXT_CAP = 160;

export type { ActivityKind, ActivityLine } from '../../shared/ipc';

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

/** Collapse whitespace and cap a free-text fragment for one activity line. */
function condense(value: string, cap = ACTIVITY_TEXT_CAP): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > cap ? `${flat.slice(0, cap - 1)}…` : flat;
}

/** The one field that best describes a tool call, without dumping its input. */
function describeTool(name: string, input: unknown): string {
  if (typeof input !== 'object' || input === null) return name;
  const record = input as Record<string, unknown>;
  const detail = ['command', 'file_path', 'path', 'pattern', 'prompt', 'url', 'description']
    .map((key) => record[key])
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return detail ? `${name}: ${condense(detail, 120)}` : name;
}

/**
 * Split a raw transcript into complete top-level JSON objects. Text outside an
 * object (ordinary CLI logging) is ignored, as are the newlines ConPTY injects
 * inside one.
 */
function extractObjects(buffer: string): { objects: string[]; rest: string } {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  let consumed = 0;

  for (let index = 0; index < buffer.length; index += 1) {
    const char = buffer[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(buffer.slice(start, index + 1));
        consumed = index + 1;
        start = -1;
      }
    }
  }

  // An unterminated object stays pending; anything before it is spent.
  const rest = depth > 0 && start >= 0 ? buffer.slice(start) : buffer.slice(consumed);
  return { objects, rest };
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    // Literal newlines can only be ConPTY wraps: JSON escapes real ones.
    return JSON.parse(text.replace(/[\r\n]/g, '')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Incremental renderer: feed PTY chunks, receive readable activity lines. */
export class ClaudeActivityParser {
  private pending = '';

  push(chunk: string): ActivityLine[] {
    this.pending += chunk.replace(ANSI, '');
    if (this.pending.length > PENDING_CAP_BYTES) {
      // Never grow without bound on non-JSON noise; drop the stale head.
      this.pending = this.pending.slice(-PENDING_CAP_BYTES);
    }
    const { objects, rest } = extractObjects(this.pending);
    this.pending = rest;
    const lines: ActivityLine[] = [];
    for (const raw of objects) {
      const event = parseObject(raw);
      if (event) lines.push(...this.render(event));
    }
    return lines;
  }

  private render(event: Record<string, unknown>): ActivityLine[] {
    const type = event['type'];

    if (type === 'system' && event['subtype'] === 'init') {
      const model = typeof event['model'] === 'string' ? event['model'] : 'unbekannt';
      return [{ kind: 'init', text: `Session gestartet · ${model}` }];
    }

    if (type === 'assistant') {
      const message = event['message'];
      if (typeof message !== 'object' || message === null) return [];
      const content = (message as Record<string, unknown>)['content'];
      if (!Array.isArray(content)) return [];
      const lines: ActivityLine[] = [];
      for (const item of content) {
        if (typeof item !== 'object' || item === null) continue;
        const block = item as Record<string, unknown>;
        if (block['type'] === 'thinking' && typeof block['thinking'] === 'string') {
          const text = condense(block['thinking']);
          if (text) lines.push({ kind: 'thinking', text });
        } else if (block['type'] === 'text' && typeof block['text'] === 'string') {
          const text = condense(block['text']);
          if (text) lines.push({ kind: 'text', text });
        } else if (block['type'] === 'tool_use' && typeof block['name'] === 'string') {
          lines.push({ kind: 'tool', text: describeTool(block['name'], block['input']) });
        }
      }
      return lines;
    }

    if (type === 'result') {
      const usage = readUsage(event);
      const failed = event['is_error'] === true || event['subtype'] !== 'success';
      const turns = typeof event['num_turns'] === 'number' ? `${event['num_turns']} Turns` : null;
      const tokens = usage ? `${usage.inputTokens} in / ${usage.outputTokens} out` : null;
      const cost = usage?.costUsd !== null && usage?.costUsd !== undefined
        ? `$${usage.costUsd.toFixed(4)}`
        : null;
      const detail = [turns, tokens, cost].filter(Boolean).join(' · ');
      return [{
        kind: failed ? 'error' : 'result',
        text: failed
          ? `Abgebrochen${detail ? ` · ${detail}` : ''}`
          : `Fertig${detail ? ` · ${detail}` : ''}`,
      }];
    }

    return [];
  }
}

function integer(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/**
 * Billed input is what the model actually processed: fresh input plus cache
 * writes plus cache reads. Reporting only `input_tokens` (often a handful)
 * would make budgets meaningless.
 */
function readUsage(event: Record<string, unknown>): ClaudeUsage | null {
  const usage = event['usage'];
  if (typeof usage !== 'object' || usage === null) return null;
  const record = usage as Record<string, unknown>;
  const inputTokens = integer(record['input_tokens'])
    + integer(record['cache_creation_input_tokens'])
    + integer(record['cache_read_input_tokens']);
  const outputTokens = integer(record['output_tokens']);
  const cost = event['total_cost_usd'];
  return {
    inputTokens,
    outputTokens,
    costUsd: typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null,
  };
}

/**
 * Trusted telemetry from the final `result` event of a completed task. Returns
 * null when the transcript carries no parseable result event, so the caller can
 * fail closed instead of inventing zeros.
 */
export function parseClaudeUsage(output: string): ClaudeUsage | null {
  const { objects } = extractObjects(output.replace(ANSI, ''));
  let found: ClaudeUsage | null = null;
  for (const raw of objects) {
    const event = parseObject(raw);
    if (!event || event['type'] !== 'result') continue;
    const usage = readUsage(event);
    if (usage) found = usage;
  }
  return found;
}
