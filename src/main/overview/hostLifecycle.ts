/**
 * How the previous ADE owner of this profile ended. Evidence only: a cause
 * explains why a session or task stopped; it never resumes a process, replays
 * input or repeats a privileged action.
 */

import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { uptime } from 'node:os';
import { dirname } from 'node:path';
import type { SessionInterruptionCause } from '../../shared/types';

/** Linux exposes a per-boot id. Elsewhere the boot instant (now − uptime) is
 * compared with a tolerance, because clock adjustments move it slightly. */
export type BootIdentity = { kind: 'id'; value: string } | { kind: 'time'; at: number };
const BOOT_TIME_TOLERANCE_MS = 5 * 60_000;
/** Heartbeat bound: a session started after the last heartbeat plus this slack
 * cannot be attributed to the recorded owner. */
export const LIFECYCLE_HEARTBEAT_MS = 60_000;
const HEARTBEAT_SLACK_MS = 2 * LIFECYCLE_HEARTBEAT_MS;

interface LifecycleRecord { version: 1; boot: BootIdentity; startedAt: number; lastSeenAt: number; cleanAt: number | null }

/** Previous owner's end. `window` bounds the sessions it can explain. */
export interface PreviousEnd { cause: SessionInterruptionCause; window: { from: number; to: number } | null }

export function currentBootIdentity(platform = process.platform, now = Date.now()): BootIdentity {
  if (platform === 'linux') {
    try {
      const value = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
      if (/^[0-9a-f-]{36}$/.test(value)) return { kind: 'id', value };
    } catch { /* fall back to boot time */ }
  }
  return { kind: 'time', at: Math.round(now - uptime() * 1000) };
}

function sameBoot(left: BootIdentity, right: BootIdentity): boolean | null {
  if (left.kind !== right.kind) return null;
  return left.kind === 'id' ? left.value === (right as { value: string }).value
    : Math.abs(left.at - (right as { at: number }).at) <= BOOT_TIME_TOLERANCE_MS;
}

function parse(raw: string): LifecycleRecord | null {
  try {
    const value = JSON.parse(raw) as Partial<LifecycleRecord>;
    const time = (input: unknown): input is number => typeof input === 'number' && Number.isSafeInteger(input) && input >= 0;
    const boot = value.boot as BootIdentity | undefined;
    const bootValid = boot?.kind === 'id' ? typeof boot.value === 'string' && /^[0-9a-f-]{36}$/.test(boot.value)
      : boot?.kind === 'time' && time(boot.at);
    if (value.version !== 1 || !bootValid || !time(value.startedAt) || !time(value.lastSeenAt)
      || value.lastSeenAt < value.startedAt || (value.cleanAt !== null && !time(value.cleanAt))) return null;
    return value as LifecycleRecord;
  } catch { return null; }
}

/** A host restart wins over a clean quit: the operator's machine restarted and
 * every process is gone either way. A same-boot clean quit is an app quit; a
 * same-boot record without a clean mark means ADE itself stopped unexpectedly. */
export function classifyPreviousEnd(previous: LifecycleRecord | null, boot: BootIdentity): PreviousEnd {
  if (!previous) return { cause: 'unknown', window: null };
  const same = sameBoot(previous.boot, boot);
  const cause: SessionInterruptionCause = same === false ? 'host-restart' : same === null ? 'unknown'
    : previous.cleanAt !== null ? 'app-quit' : 'app-crash';
  return { cause, window: { from: previous.startedAt, to: previous.cleanAt ?? previous.lastSeenAt + HEARTBEAT_SLACK_MS } };
}

/** Attribute a cause only to work that started during the recorded owner. Older
 * or later records (another build, a rollback) stay `unknown`. */
export function causeFor(previous: PreviousEnd, startedAt: number): SessionInterruptionCause {
  return previous.window && startedAt >= previous.window.from && startedAt <= previous.window.to ? previous.cause : 'unknown';
}

/** Journal reason for tasks the previous owner left active. Never a retry. */
export const TASK_INTERRUPTION_REASON: Record<SessionInterruptionCause, string> = {
  'host-restart': 'The computer restarted before task completion',
  'app-crash': 'ADE stopped unexpectedly before task completion',
  'app-quit': 'ADE was quit before task completion',
  unknown: 'ADE restarted before task completion',
};

/** Single profile owner (the Electron single-instance lock guarantees it). */
export class HostLifecycle {
  private record: LifecycleRecord | null = null;
  readonly previous: PreviousEnd;

  constructor(private readonly file: string, private readonly deps: { now?: () => number; boot?: () => BootIdentity } = {}) {
    const now = this.now();
    let raw: string | null = null;
    try {
      if (!lstatSync(file).isFile()) throw new Error('lifecycle record is not a file');
      raw = readFileSync(file, 'utf8');
    } catch { raw = null; }
    const boot = deps.boot?.() ?? currentBootIdentity();
    this.previous = classifyPreviousEnd(raw === null ? null : parse(raw), boot);
    this.record = { version: 1, boot, startedAt: now, lastSeenAt: now, cleanAt: null };
    this.write();
  }

  heartbeat(): void {
    if (!this.record || this.record.cleanAt !== null) return;
    this.record.lastSeenAt = Math.max(this.record.lastSeenAt, this.now());
    this.write();
  }

  /** Called after every PTY, task and listener has been stopped on a graceful quit. */
  markClean(): void {
    if (!this.record || this.record.cleanAt !== null) return;
    const now = this.now();
    this.record.lastSeenAt = Math.max(this.record.lastSeenAt, now);
    this.record.cleanAt = Math.max(this.record.lastSeenAt, now);
    this.write();
  }

  private now(): number { return this.deps.now?.() ?? Date.now(); }

  /** Failure is reported, never fatal: a missing record only degrades the next
   * classification to `unknown`. */
  private write(): void {
    const temp = `${this.file}.${process.pid}.tmp`;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      try { unlinkSync(temp); } catch { /* absent */ }
      const fd = openSync(temp, 'wx', 0o600);
      try { writeFileSync(fd, JSON.stringify(this.record)); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, this.file);
    } catch (error) {
      try { unlinkSync(temp); } catch { /* absent */ }
      console.warn('[ade] lifecycle record unavailable:', error instanceof Error ? error.name : 'error');
    }
  }
}
