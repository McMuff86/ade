/** Live activity and trusted token telemetry for `codex exec --json`. */

import type { ActivityLine } from '../../shared/ipc';
import {
  RUNTIME_EVENT_PENDING_CAP_BYTES,
  condenseActivityText,
  extractJsonEventObjects,
  normalizePtyJsonStream,
  parseJsonEventObject,
} from './runtimeEventStream';

export interface CodexUsage {
  inputTokens: number;
  outputTokens: number;
}

interface ActivityParser {
  push(chunk: string): ActivityLine[];
}

/** Incrementally render Codex JSONL without exposing raw tool payloads. */
export class CodexActivityParser implements ActivityParser {
  private pending = '';
  private readonly announcedItems = new Set<string>();
  private readonly textDeltas = new Map<string, string>();

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
    if (type === 'ade.tool_output') return typeof event.text === 'string' && event.text.trim() ? [{ kind: 'tool', text: event.text.slice(0, 8000) }] : [];
    if (type === 'ade.text_delta') {
      const id = String(event.itemId); const value = (this.textDeltas.get(id) ?? '') + String(event.text ?? '');
      if (!this.textDeltas.has(id) && this.textDeltas.size >= 100) this.textDeltas.delete(this.textDeltas.keys().next().value!);
      if (value.includes('\n') || value.length >= 300) { this.textDeltas.set(id, ''); return value.trim() ? [{ kind: 'text', text: value.slice(0, 8000) }] : []; }
      this.textDeltas.set(id, value); return [];
    }
    if (type === 'ade.plan') return [{ kind: 'tool', text: 'Plan: ' + (typeof event.text === 'string' ? event.text.slice(0, 4000) : '')
      + (Array.isArray(event.steps) ? event.steps.slice(0, 20).map((step) => { const item = record(step); return `\n${String(item?.status ?? '')}: ${String(item?.step ?? '').slice(0, 500)}`; }).join('') : ''), mobileText: 'Arbeitsplan aktualisiert' }];
    if (type === 'thread.started') {
      return [{ kind: 'init', text: 'Codex-Session gestartet' }];
    }
    if (type === 'turn.started') {
      return [{ kind: 'thinking', text: 'Bearbeitung gestartet…' }];
    }
    if (type === 'turn.completed') {
      const usage = readCodexUsage(event);
      return [{
        kind: 'result',
        text: usage
          ? `Fertig · ${usage.inputTokens} in / ${usage.outputTokens} out`
          : 'Fertig',
      }];
    }
    if (type === 'turn.failed') {
      return [{ kind: 'error', text: `Abgebrochen${errorDetail(event)}` }];
    }
    if (type === 'error') {
      const message = typeof event['message'] === 'string'
        ? condenseActivityText(event['message'])
        : 'Codex-Laufzeitfehler';
      return [{ kind: 'error', text: message }];
    }
    if (type !== 'item.started' && type !== 'item.completed') return [];

    const item = record(event['item']);
    if (!item) return [];
    const itemType = item['type'];
    const itemId = typeof item['id'] === 'string' ? item['id'] : undefined;
    const started = type === 'item.started';

    if (itemType === 'reasoning' && !started) {
      return textLine('thinking', item['text']);
    }
    if (itemType === 'agent_message' && !started) {
      if (itemId && this.textDeltas.has(itemId)) { const tail = this.textDeltas.get(itemId)!; this.textDeltas.delete(itemId); return textLine('text', tail); }
      return textLine('text', item['text']);
    }

    const tool = describeCodexTool(item);
    if (!tool) return [];
    const key = itemId ? `${itemId}:${started ? 'started' : 'completed'}` : undefined;
    if (key && this.announcedItems.has(key)) return [];
    if (key) { this.announcedItems.add(key); if (this.announcedItems.size > 4000) this.announcedItems.delete(this.announcedItems.values().next().value!); }
    const status = started ? 'Gestartet' : typeof item.exit_code === 'number' ? `Abgeschlossen · Exit ${item.exit_code}` : item.status === 'failed' ? 'Fehlgeschlagen' : 'Abgeschlossen';
    const output = !started && typeof item.aggregated_output === 'string' ? item.aggregated_output.trim().slice(0, 8000) : '';
    return [{ kind: 'tool', text: `${status} · ${tool}${output ? `\n${output}` : ''}`,
      ...(typeof item.accessText === 'string' ? { mobileText: `${status} · ${item.accessText.slice(0, 2000)}` } : {}) }];
  }
}

/** Last trustworthy turn-completed usage event, or null when none survived. */
export function parseCodexUsage(output: string): CodexUsage | null {
  const { objects } = extractJsonEventObjects(normalizePtyJsonStream(output));
  let found: CodexUsage | null = null;
  for (const raw of objects) {
    const event = parseJsonEventObject(raw);
    if (!event || event['type'] !== 'turn.completed') continue;
    const usage = readCodexUsage(event);
    if (usage) found = usage;
  }
  return found;
}

function describeCodexTool(item: Record<string, unknown>): string | null {
  const type = item['type'];
  if (type === 'command_execution') {
    const command = typeof item['command'] === 'string'
      ? condenseActivityText(item['command'], 2000)
      : '';
    return command ? `Shell: ${command}` : 'Shell';
  }
  if (type === 'file_change') {
    const changes = Array.isArray(item['changes']) ? item['changes'] : [];
    const paths = changes
      .map((change) => record(change)?.['path'])
      .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
      .slice(0, 3);
    return paths.length > 0
      ? `Dateien geändert: ${condenseActivityText(paths.join(', '), 120)}`
      : 'Dateien geändert';
  }
  if (type === 'mcp_tool_call') {
    const server = typeof item['server'] === 'string' ? item['server'] : 'MCP';
    const tool = typeof item['tool'] === 'string' ? item['tool'] : 'Tool';
    return `${server}: ${tool}`;
  }
  if (type === 'web_search') {
    const query = typeof item['query'] === 'string'
      ? condenseActivityText(item['query'], 120)
      : '';
    return query ? `Websuche: ${query}` : 'Websuche';
  }
  if (type === 'todo_list') return 'Arbeitsplan aktualisiert';
  return null;
}

function textLine(kind: 'thinking' | 'text', value: unknown): ActivityLine[] {
  if (typeof value !== 'string') return [];
  const text = value.trim().slice(0, 8000);
  return text ? [{ kind, text }] : [];
}

function errorDetail(event: Record<string, unknown>): string {
  const error = record(event['error']);
  const message = typeof error?.['message'] === 'string'
    ? condenseActivityText(error['message'])
    : '';
  return message ? ` · ${message}` : '';
}

function readCodexUsage(event: Record<string, unknown>): CodexUsage | null {
  const usage = record(event['usage']);
  if (!usage) return null;
  const inputTokens = nonNegativeInteger(usage['input_tokens']);
  const outputTokens = nonNegativeInteger(usage['output_tokens']);
  return inputTokens === null || outputTokens === null
    ? null
    : { inputTokens, outputTokens };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 0 ? value as number : null;
}
