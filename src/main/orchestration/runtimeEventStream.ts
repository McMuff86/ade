/**
 * Shared, bounded parsing primitives for machine-readable CLI event streams.
 *
 * ConPTY hard-wraps long JSONL records and can reprint the character at a wrap
 * boundary after moving the cursor. Runtime activity and telemetry consumers
 * therefore parse complete top-level objects instead of trusting line breaks.
 */

const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const EVENT_START = /\{\s*"type"\s*:\s*"/g;
const MARKER_SPLIT_GUARD = 64;
const WRAP_REPRINT = /([\s\S])\r\n\u001b\[\d+;\d+H\1/g;

export const RUNTIME_EVENT_PENDING_CAP_BYTES = 2 * 1024 * 1024;

/** Collapse whitespace and cap free text before it reaches the activity UI. */
export function condenseActivityText(value: string, cap = 160): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > cap ? `${flat.slice(0, cap - 1)}…` : flat;
}

/**
 * Normalize a PTY transcript without changing JSON string escapes. Literal
 * newlines only delimit JSONL records or come from a terminal wrap; real JSON
 * newlines are escaped by the emitting CLI.
 */
export function normalizePtyJsonStream(text: string): string {
  return text.replace(WRAP_REPRINT, '$1').replace(ANSI, '').replace(/[\r\n]/g, '');
}

/** Split a transcript into complete top-level event objects and an incomplete tail. */
export function extractJsonEventObjects(buffer: string): { objects: string[]; rest: string } {
  const objects: string[] = [];
  let consumed = 0;
  EVENT_START.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = EVENT_START.exec(buffer)) !== null) {
    const start = match.index;
    if (start < consumed) continue;
    const end = objectEnd(buffer, start);
    if (end < 0) return { objects, rest: buffer.slice(start) };
    objects.push(buffer.slice(start, end));
    consumed = end;
    EVENT_START.lastIndex = end;
  }

  const rest = consumed === 0 && objects.length === 0
    ? buffer.slice(Math.max(0, buffer.length - MARKER_SPLIT_GUARD))
    : buffer.slice(consumed);
  return { objects, rest };
}

export function parseJsonEventObject(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function objectEnd(buffer: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < buffer.length; index += 1) {
    const char = buffer[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}
