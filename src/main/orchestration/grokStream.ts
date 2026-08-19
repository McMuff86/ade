/**
 * Live activity and trusted telemetry for `grok --output-format streaming-json`.
 *
 * The stream is NDJSON of typed ACP-derived events (`thought`, `tool_call`,
 * `text`, `end`, …). ConPTY can wrap objects, so both the incremental parser
 * and the completion readers reassemble by brace depth. The older single
 * `--output-format json` envelope remains readable so a mixed transcript
 * still yields a result.
 */

import type { ActivityLine } from '../../shared/ipc';
import {
  RUNTIME_EVENT_PENDING_CAP_BYTES,
  condenseActivityText,
  extractBalancedJsonObjects,
  extractJsonEventObjects,
  normalizePtyJsonStream,
  parseJsonEventObject,
} from './runtimeEventStream';

export interface GrokUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

/** Incremental renderer: feed PTY chunks, receive readable activity lines. */
export class GrokActivityParser {
  private pending = '';
  private pendingKind: 'thinking' | 'text' | null = null;
  private pendingText = '';
  private readonly announcedTools = new Set<string>();

  push(chunk: string): ActivityLine[] {
    this.pending += normalizePtyJsonStream(chunk);
    if (this.pending.length > RUNTIME_EVENT_PENDING_CAP_BYTES) {
      this.pending = this.pending.slice(-RUNTIME_EVENT_PENDING_CAP_BYTES);
    }
    const { objects, rest } = extractJsonEventObjects(this.pending);
    this.pending = rest;
    const lines: ActivityLine[] = [];
    for (const raw of objects) {
      const event = parseJsonEventObject(raw);
      if (event) lines.push(...this.render(event));
    }
    return lines;
  }

  private render(event: Record<string, unknown>): ActivityLine[] {
    const type = event['type'];
    if (type === 'thought') return this.appendPending('thinking', event['data']);
    if (type === 'text') return this.appendPending('text', event['data']);
    const flushed = this.flushPending();
    if (type === 'plan') return [...flushed, { kind: 'thinking', text: 'Plan aktualisiert' }];
    if (type === 'error') {
      const message = typeof event['message'] === 'string'
        ? condenseActivityText(event['message'])
        : 'Grok-Laufzeitfehler';
      return [...flushed, { kind: 'error', text: message }];
    }
    if (type === 'end') {
      const usage = readGrokUsage(event);
      const failed = event['stopReason'] === 'error' || event['stopReason'] === 'refusal';
      const turns = typeof event['num_turns'] === 'number' ? `${event['num_turns']} Turns` : null;
      const tokens = usage ? `${usage.inputTokens} in / ${usage.outputTokens} out` : null;
      const cost = usage?.costUsd !== null && usage?.costUsd !== undefined
        ? `$${usage.costUsd.toFixed(4)}`
        : null;
      const detail = [turns, tokens, cost].filter(Boolean).join(' · ');
      return [...flushed, {
        kind: failed ? 'error' : 'result',
        text: failed
          ? `Abgebrochen${detail ? ` · ${detail}` : ''}`
          : `Fertig${detail ? ` · ${detail}` : ''}`,
      }];
    }
    if (type === 'tool_call') {
      const id = typeof event['toolCallId'] === 'string' ? event['toolCallId'] : undefined;
      if (id && this.announcedTools.has(id)) return flushed;
      if (id) this.announcedTools.add(id);
      return [...flushed, { kind: 'tool', text: describeGrokTool(event) }];
    }
    if (type === 'tool_call_update') {
      const id = typeof event['toolCallId'] === 'string' ? event['toolCallId'] : undefined;
      if (id && this.announcedTools.has(id)) return flushed;
      if (id) this.announcedTools.add(id);
      return [...flushed, { kind: 'tool', text: describeGrokTool(event) }];
    }
    return flushed;
  }

  private appendPending(kind: 'thinking' | 'text', data: unknown): ActivityLine[] {
    if (typeof data !== 'string' || !data) return [];
    const flushed = this.pendingKind && this.pendingKind !== kind ? this.flushPending() : [];
    this.pendingKind = kind;
    this.pendingText += data;
    return flushed;
  }

  private flushPending(): ActivityLine[] {
    const kind = this.pendingKind;
    const raw = this.pendingText;
    this.pendingKind = null;
    this.pendingText = '';
    if (!kind || !raw) return [];
    const text = condenseActivityText(raw);
    return text ? [{ kind, text }] : [];
  }
}

export function parseGrokJsonEnvelope(output: string): Record<string, unknown> | null {
  const normalized = normalizePtyJsonStream(output);
  const typed = extractJsonEventObjects(normalized);
  let found: Record<string, unknown> | null = null;
  for (const raw of typed.objects) {
    const value = parseJsonEventObject(raw);
    if (value?.['type'] === 'end') found = value;
  }
  if (found) return found;
  const { objects } = extractBalancedJsonObjects(normalized);
  for (const raw of objects) {
    const value = parseJsonEventObject(raw);
    if (value && isGrokEnvelope(value) && value['type'] !== 'usage') found = value;
  }
  return found;
}

/**
 * Token/cost fields from the headless envelope. Missing or partial cost stays
 * null — never a fabricated zero. Input is the billed prompt: uncached plus
 * both cache buckets, matching Claude's budget accounting.
 */
export function parseGrokUsage(output: string): GrokUsage | null {
  const envelope = parseGrokJsonEnvelope(output);
  return envelope ? readGrokUsage(envelope) : null;
}

export function structuredResultFromGrokEnvelope(envelope: Record<string, unknown>): unknown | null {
  const structured = envelope['structured_output'];
  if (typeof structured === 'object' && structured !== null) return structured;
  const text = envelope['text'];
  if (typeof text === 'object' && text !== null && !Array.isArray(text)) return text;
  if (typeof text === 'string') return parseJsonPayload(text);
  return null;
}

/** Concatenate streamed `text` events, then fall back to an `end`/json envelope. */
export function structuredResultFromGrokStream(output: string): unknown | null {
  const normalized = normalizePtyJsonStream(output);
  const { objects } = extractJsonEventObjects(normalized);
  let text = '';
  let fromEnd: unknown | null = null;
  for (const raw of objects) {
    const event = parseJsonEventObject(raw);
    if (!event) continue;
    if (event['type'] === 'text' && typeof event['data'] === 'string') text += event['data'];
    if (event['type'] === 'end') fromEnd = structuredResultFromGrokEnvelope(event);
  }
  if (fromEnd !== null) return fromEnd;
  if (text) {
    const parsed = parseJsonPayload(text);
    if (parsed !== null) return parsed;
  }
  const envelope = parseGrokJsonEnvelope(output);
  return envelope ? structuredResultFromGrokEnvelope(envelope) : null;
}

function isGrokEnvelope(value: Record<string, unknown>): boolean {
  return 'text' in value || 'stopReason' in value || 'sessionId' in value
    || 'usage' in value || 'total_cost_usd' in value || 'structured_output' in value;
}

function readGrokUsage(envelope: Record<string, unknown>): GrokUsage | null {
  const usage = envelope['usage'];
  if (typeof usage !== 'object' || usage === null) return null;
  const record = usage as Record<string, unknown>;
  const hasInput = Number.isInteger(record['input_tokens']);
  const hasOutput = Number.isInteger(record['output_tokens']);
  if (!hasInput && !hasOutput) return null;
  const inputTokens = integer(record['input_tokens'])
    + integer(record['cache_read_input_tokens'])
    + integer(record['cache_creation_input_tokens']);
  const outputTokens = integer(record['output_tokens']);
  const partial = envelope['cost_is_partial'] === true || envelope['usage_is_incomplete'] === true;
  const cost = envelope['total_cost_usd'];
  return {
    inputTokens,
    outputTokens,
    costUsd: !partial && typeof cost === 'number' && Number.isFinite(cost) && cost >= 0
      ? cost
      : null,
  };
}

function parseJsonPayload(text: string): unknown | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // Token-chunked streams prepend prose; take the last object that parses.
    for (let index = trimmed.lastIndexOf('{'); index >= 0; ) {
      try {
        const value = JSON.parse(trimmed.slice(index)) as unknown;
        if (typeof value === 'object' && value !== null) return value;
      } catch {
        // try the previous opening brace
      }
      index = index === 0 ? -1 : trimmed.lastIndexOf('{', index - 1);
    }
    return null;
  }
}

function describeGrokTool(event: Record<string, unknown>): string {
  const name = typeof event['toolName'] === 'string' && event['toolName'].trim()
    ? event['toolName']
    : (typeof event['title'] === 'string' && event['title'].trim() ? event['title'] : 'Tool');
  const input = event['rawInput'];
  if (typeof input !== 'object' || input === null) return name;
  const record = input as Record<string, unknown>;
  const detail = ['command', 'path', 'target_file', 'target_directory', 'query', 'pattern', 'prompt', 'url', 'file_path']
    .map((key) => record[key])
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return detail ? `${name}: ${condenseActivityText(detail, 120)}` : name;
}

function integer(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}
