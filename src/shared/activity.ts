import type { ActivityLine } from './ipc';

/** Snapshot and subscription can overlap; a sequence identifies a line within one session. */
export function mergeActivityLines(first: ActivityLine[], second: ActivityLine[], cap = 2000): ActivityLine[] {
  const sequenced = new Map<number, ActivityLine>(); const legacy: ActivityLine[] = [];
  for (const line of [...first, ...second]) {
    if (line.sequence !== undefined && Number.isSafeInteger(line.sequence)) sequenced.set(line.sequence, line);
    else legacy.push(line);
  }
  return [...legacy, ...[...sequenced.values()].sort((a, b) => a.sequence! - b.sequence!)].slice(-cap);
}
