/**
 * Rotating main-process log file (Thema 3).
 *
 * A packaged NSIS build has no console: every `console.error`/`warn` in
 * `src/main` used to vanish. The sink tees console output into
 * `userData/ade/logs/main.log`, rotating by size so the directory stays
 * bounded (`main.log`, `main.1.log`, … `main.<maxFiles-1>.log`).
 *
 * Rules: every line goes through the credential redactor and is bounded;
 * writes are synchronous appends (console output in main is rare and a lost
 * last line after a crash is worse than a few microseconds); a failing sink
 * never throws into the caller — it disables itself and says so once on the
 * original console.
 */

import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { isSecretEnvName, redactSensitiveText } from '../errors';

export type MainLogLevel = 'log' | 'info' | 'warn' | 'error';

export interface MainLogSinkOptions {
  /** Directory the log files live in; created on first write. */
  dir: string;
  fileName?: string;
  /** Rotate once the current file would exceed this many bytes. */
  maxBytes?: number;
  /** Total files kept including the current one; oldest is deleted. */
  maxFiles?: number;
  /** Longest single line written; longer text is cut and marked. */
  maxLineChars?: number;
  now?: () => Date;
}

export const MAIN_LOG_DEFAULTS = {
  fileName: 'main.log',
  maxBytes: 2 * 1024 * 1024,
  maxFiles: 5,
  maxLineChars: 8 * 1024,
} as const;

const CONSOLE_LEVELS: MainLogLevel[] = ['log', 'info', 'warn', 'error'];

export class MainLogSink {
  private readonly dir: string;
  private readonly fileName: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly maxLineChars: number;
  private readonly now: () => Date;
  private disabled: string | null = null;
  /** Cached size of the current file to avoid a stat per line. */
  private currentBytes: number | null = null;

  constructor(options: MainLogSinkOptions) {
    this.dir = options.dir;
    this.fileName = options.fileName ?? MAIN_LOG_DEFAULTS.fileName;
    this.maxBytes = Math.max(1024, options.maxBytes ?? MAIN_LOG_DEFAULTS.maxBytes);
    this.maxFiles = Math.max(1, Math.floor(options.maxFiles ?? MAIN_LOG_DEFAULTS.maxFiles));
    this.maxLineChars = Math.max(256, options.maxLineChars ?? MAIN_LOG_DEFAULTS.maxLineChars);
    this.now = options.now ?? (() => new Date());
  }

  /** Path of the current (newest) log file. */
  path(): string {
    return join(this.dir, this.fileName);
  }

  /** Why the sink stopped writing, or null while healthy. */
  disabledReason(): string | null {
    return this.disabled;
  }

  /** Formats and appends one line; never throws. */
  write(level: MainLogLevel, args: readonly unknown[]): void {
    if (this.disabled) return;
    const line = formatLogLine(this.now(), level, args, this.maxLineChars);
    try {
      mkdirSync(this.dir, { recursive: true });
      const bytes = Buffer.byteLength(line);
      if (this.sizeOfCurrent() + bytes > this.maxBytes) this.rotate();
      appendFileSync(this.path(), line);
      this.currentBytes = (this.currentBytes ?? 0) + bytes;
    } catch (error) {
      this.disabled = error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * Tees `console.log/info/warn/error` into the file while leaving the
   * original console behaviour intact. Returns the restore function.
   */
  install(target: Console = console): () => void {
    const originals = new Map<MainLogLevel, (...args: unknown[]) => void>();
    for (const level of CONSOLE_LEVELS) {
      const original = target[level].bind(target) as (...args: unknown[]) => void;
      originals.set(level, original);
      target[level] = (...args: unknown[]) => {
        original(...args);
        const before = this.disabled;
        this.write(level, args);
        if (!before && this.disabled) {
          original(`[ade] main log disabled: ${this.disabled} (${this.path()})`);
        }
      };
    }
    return () => {
      for (const [level, original] of originals) target[level] = original;
    };
  }

  private sizeOfCurrent(): number {
    if (this.currentBytes !== null) return this.currentBytes;
    try {
      this.currentBytes = statSync(this.path()).size;
    } catch {
      this.currentBytes = 0;
    }
    return this.currentBytes;
  }

  private rotate(): void {
    const stem = this.fileName.replace(/\.log$/, '');
    const rotated = (index: number): string => join(this.dir, `${stem}.${index}.log`);
    try {
      unlinkSync(rotated(this.maxFiles - 1));
    } catch {
      // Oldest slot may be empty.
    }
    for (let index = this.maxFiles - 2; index >= 1; index -= 1) {
      try {
        renameSync(rotated(index), rotated(index + 1));
      } catch {
        // Slot not filled yet.
      }
    }
    if (this.maxFiles > 1) {
      try {
        renameSync(this.path(), rotated(1));
      } catch {
        // Nothing to rotate yet.
      }
    } else {
      try {
        unlinkSync(this.path());
      } catch {
        // Nothing to drop.
      }
    }
    this.currentBytes = 0;
  }
}

/** `2026-09-06T10:11:12.345Z WARN message` — redacted, single line, bounded. */
export function formatLogLine(
  at: Date,
  level: MainLogLevel,
  args: readonly unknown[],
  maxLineChars = MAIN_LOG_DEFAULTS.maxLineChars,
): string {
  const body = args.map(formatArg).join(' ');
  const text = redactSensitiveText(body).replace(/\r?\n/g, '\\n');
  const bounded = text.length > maxLineChars ? `${text.slice(0, maxLineChars - 12)} [truncated]` : text;
  return `${at.toISOString()} ${level.toUpperCase().padEnd(5)} ${bounded}\n`;
}

function formatArg(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (value === undefined) return 'undefined';
  if (typeof value === 'bigint') return `${value}n`;
  try {
    // Secret-named fields (API keys, tokens) show only their name; the text
    // redactor afterwards catches `NAME=value` shapes inside strings.
    return JSON.stringify(value, (key, entry: unknown) =>
      (key && isSecretEnvName(key) ? '[credential]' : entry)) ?? String(value);
  } catch {
    return String(value);
  }
}
