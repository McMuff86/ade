/**
 * Bounded interactive-session journal. Task PTYs stay in the run journal.
 * Records are path-free: no workspaceDir, prompts or transcripts.
 */

import type { SessionBookend, SessionBookendExitReason, SessionInterruptionCause } from '../../shared/types';

export const SESSION_BOOKEND_LIMIT = 100;

export function startInteractiveBookend(
  bookends: readonly SessionBookend[],
  record: SessionBookend,
): SessionBookend[] {
  return [...bookends.filter((bookend) => bookend.id !== record.id), record]
    .slice(-SESSION_BOOKEND_LIMIT);
}

export function closeInteractiveBookend(
  bookends: readonly SessionBookend[],
  sessionId: string,
  endedAt: number,
  exitReason: SessionBookendExitReason,
): SessionBookend[] {
  let changed = false;
  const next = bookends.map((bookend) => {
    if (bookend.id !== sessionId || bookend.endedAt !== null) return bookend;
    changed = true;
    return { ...bookend, endedAt, exitReason };
  });
  return changed ? next : (bookends as SessionBookend[]);
}

export function interruptOrphanBookends(
  bookends: readonly SessionBookend[],
  liveSessionIds: ReadonlySet<string>,
  now: number,
  /** Previous owner's end for a session started at `startedAt`; see hostLifecycle.ts. */
  causeFor: (startedAt: number) => SessionInterruptionCause = () => 'unknown',
): SessionBookend[] {
  let changed = false;
  const next = bookends.map((bookend) => {
    if (bookend.endedAt !== null || liveSessionIds.has(bookend.id)) return bookend;
    changed = true;
    return { ...bookend, endedAt: now, exitReason: 'interrupted' as const, interruption: causeFor(bookend.startedAt) };
  });
  return changed ? next : (bookends as SessionBookend[]);
}

/** Close the notice of an interrupted session. Only an interrupted, not yet acknowledged record changes. */
export function acknowledgeInterruptedBookend(bookends: readonly SessionBookend[], sessionId: string, now: number): SessionBookend[] {
  let changed = false;
  const next = bookends.map((bookend) => {
    if (bookend.id !== sessionId || bookend.exitReason !== 'interrupted' || bookend.acknowledgedAt !== undefined) return bookend;
    changed = true;
    return { ...bookend, acknowledgedAt: now };
  });
  return changed ? next : (bookends as SessionBookend[]);
}

export function bookendActivityAt(bookend: SessionBookend): number {
  return bookend.endedAt ?? bookend.startedAt;
}
