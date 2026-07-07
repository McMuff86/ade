/**
 * MemoryStore — TypeScript port of Hermes' file-based memory tool
 * (`tools/memory_tool.py::MemoryStore`) per docs/reports/hermes-memory.md.
 *
 * Two per-agent files live under an agent's `memoryDir`:
 *   MEMORY.md — the agent's own notes            (cap 2,200 chars)
 *   USER.md   — the user profile                 (cap 1,375 chars)
 *
 * On-disk format has no frontmatter: a flat list of entries joined by the
 * delimiter "\n§\n". Parsing = split + trim + drop-empties + order-preserving
 * dedup. Writes are atomic (temp file in the same dir + rename) under a simple
 * lockfile. A drift guard snapshots a non-round-tripping file to
 * `<file>.bak.<ts>` and refuses destructive ops (add still allowed).
 *
 * Pure Node (fs/path/crypto only) — importable outside Electron so it can be
 * unit-tested with tsx (see scripts/test-memory.ts).
 */

import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';

export type MemoryTarget = 'memory' | 'user';

/** Entries are joined on disk (and in the rendered block) by this delimiter. */
export const ENTRY_DELIMITER = '\n§\n'; // "\n§\n"

/** 46 × U+2550 '═' — the header rule from the report's _render_block. */
const BAR = '═'.repeat(46);
const EM_DASH = '—'; // '—'

export const DEFAULT_MEMORY_LIMIT = 2200;
export const DEFAULT_USER_LIMIT = 1375;

const FILE_NAME: Record<MemoryTarget, string> = {
  memory: 'MEMORY.md',
  user: 'USER.md',
};

const HEADER_LABEL: Record<MemoryTarget, string> = {
  memory: 'MEMORY (your personal notes)',
  user: 'USER PROFILE (who the user is)',
};

/** Lock is considered abandoned after this long (ms). */
const LOCK_STALE_MS = 10_000;
const LOCK_MAX_WAIT_MS = 2_000;

export interface MemoryStoreOptions {
  memoryLimit?: number;
  userLimit?: number;
}

export interface MemoryUsage {
  chars: number;
  limit: number;
  pct: number;
}

/** Uniform result for every mutating operation. */
export interface MemoryResult {
  success: boolean;
  target: MemoryTarget;
  action?: 'add' | 'replace' | 'remove' | 'batch';
  /** short machine-readable failure code when success === false */
  error?: 'empty' | 'over_capacity' | 'not_found' | 'ambiguous' | 'drift';
  /** human-facing note (consolidation / disambiguation guidance) */
  note?: string;
  usage?: MemoryUsage;
  entryCount?: number;
  /** on over_capacity: the current entries so the caller can consolidate */
  currentEntries?: string[];
}

export interface BatchOp {
  action: 'add' | 'replace' | 'remove';
  content?: string;
  old_text?: string;
}

/* --------------------------------------------------------------- helpers */

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

/** split + trim + drop-empties + order-preserving dedup. */
function parseEntries(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(ENTRY_DELIMITER)) {
    const entry = part.trim();
    if (!entry) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

/** Millisecond sleep without a busy loop (Atomics.wait on a throwaway buffer). */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/* --------------------------------------------------------------- class */

export class MemoryStore {
  private readonly limits: Record<MemoryTarget, number>;

  constructor(
    private readonly memoryDir: string,
    opts: MemoryStoreOptions = {},
  ) {
    this.limits = {
      memory: opts.memoryLimit ?? DEFAULT_MEMORY_LIMIT,
      user: opts.userLimit ?? DEFAULT_USER_LIMIT,
    };
  }

  limit(target: MemoryTarget): number {
    return this.limits[target];
  }

  filePath(target: MemoryTarget): string {
    return join(this.memoryDir, FILE_NAME[target]);
  }

  /* ------------------------------------------------------------- render */

  /** Read entries with no drift side effects (safe for the read path). */
  readEntries(target: MemoryTarget): string[] {
    return parseEntries(this.readRaw(target));
  }

  usage(target: MemoryTarget): MemoryUsage {
    return this.usageFor(target, this.readEntries(target));
  }

  /**
   * The exact block format from the report (`_render_block`):
   *   ═×46
   *   MEMORY (your personal notes) [67% — 1,474/2,200 chars]
   *   ═×46
   *   <entry>
   *   §
   *   <entry>
   */
  renderBlock(target: MemoryTarget): string {
    const entries = this.readEntries(target);
    const { chars, limit, pct } = this.usageFor(target, entries);
    const header = `${HEADER_LABEL[target]} [${pct}% ${EM_DASH} ${fmt(chars)}/${fmt(limit)} chars]`;
    const lines = [BAR, header, BAR];
    if (entries.length > 0) lines.push(entries.join(ENTRY_DELIMITER));
    return lines.join('\n');
  }

  /* --------------------------------------------------------------- add */

  /** Append-only. Empty rejected; exact duplicate is a success no-op. */
  add(target: MemoryTarget, content: string): MemoryResult {
    const value = content.trim();
    if (!value) {
      return { success: false, target, action: 'add', error: 'empty', note: 'refusing to add an empty entry' };
    }

    return this.withLock(target, () => {
      const { entries, drift } = this.loadState(target);
      if (drift) this.snapshot(target); // add is still allowed after a drift snapshot

      if (entries.includes(value)) {
        return {
          success: true,
          target,
          action: 'add',
          note: 'no duplicate added',
          entryCount: entries.length,
          usage: this.usageFor(target, entries),
        };
      }

      const next = [...entries, value];
      const projected = this.usageFor(target, next);
      if (projected.chars > this.limits[target]) {
        return {
          success: false,
          target,
          action: 'add',
          error: 'over_capacity',
          note:
            'Over the char limit. Reissue as ONE batch that removes or shortens ' +
            'enough stale entries and adds the new one together.',
          currentEntries: entries,
          usage: this.usageFor(target, entries),
        };
      }

      this.write(target, next);
      return {
        success: true,
        target,
        action: 'add',
        entryCount: next.length,
        usage: projected,
      };
    });
  }

  /* ----------------------------------------------------------- replace */

  /** old_text = short unique substring; >1 matching entry → ambiguous error. */
  replace(target: MemoryTarget, oldText: string, newText: string): MemoryResult {
    return this.withLock(target, () => {
      const guard = this.refuseIfDrift(target, 'replace');
      if (guard) return guard;

      const { entries } = this.loadState(target);
      const idxs = this.matchIndices(entries, oldText);
      const found = this.disambiguate(target, 'replace', idxs);
      if (found.error) return found.error;

      const idx = found.index;
      const replaced = entries[idx].split(oldText).join(newText).trim();
      const next = [...entries];
      if (replaced) next[idx] = replaced;
      else next.splice(idx, 1); // replacing with empty removes the entry
      const deduped = parseEntries(next.join(ENTRY_DELIMITER));

      const projected = this.usageFor(target, deduped);
      if (projected.chars > this.limits[target]) {
        return {
          success: false,
          target,
          action: 'replace',
          error: 'over_capacity',
          note: 'Replacement pushes over the char limit — shorten it or remove another entry.',
          currentEntries: entries,
          usage: this.usageFor(target, entries),
        };
      }

      this.write(target, deduped);
      return { success: true, target, action: 'replace', entryCount: deduped.length, usage: projected };
    });
  }

  /* ------------------------------------------------------------ remove */

  /** Same substring matching as replace; removes the whole matched entry. */
  remove(target: MemoryTarget, oldText: string): MemoryResult {
    return this.withLock(target, () => {
      const guard = this.refuseIfDrift(target, 'remove');
      if (guard) return guard;

      const { entries } = this.loadState(target);
      const idxs = this.matchIndices(entries, oldText);
      const found = this.disambiguate(target, 'remove', idxs);
      if (found.error) return found.error;

      const next = entries.filter((_, i) => i !== found.index);
      this.write(target, next);
      return { success: true, target, action: 'remove', entryCount: next.length, usage: this.usageFor(target, next) };
    });
  }

  /* ------------------------------------------------------------- batch */

  /**
   * All-or-nothing. Every op is applied to an in-memory working set; the char
   * budget is checked only on the FINAL state — so one call can remove/shorten
   * stale entries to free room AND add a new one that alone would overflow.
   */
  batch(target: MemoryTarget, operations: BatchOp[]): MemoryResult {
    return this.withLock(target, () => {
      const guard = this.refuseIfDrift(target, 'batch');
      if (guard) return guard;

      const { entries } = this.loadState(target);
      let working = [...entries];

      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        const where = `operation ${i + 1} (${op.action})`;

        if (op.action === 'add') {
          const value = (op.content ?? '').trim();
          if (!value) {
            return { success: false, target, action: 'batch', error: 'empty', note: `${where}: empty content` };
          }
          if (!working.includes(value)) working.push(value);
          continue;
        }

        const oldText = op.old_text ?? '';
        const idxs = this.matchIndices(working, oldText);
        if (idxs.length === 0) {
          return { success: false, target, action: 'batch', error: 'not_found', note: `${where}: no entry matches "${oldText}"` };
        }
        if (idxs.length > 1) {
          return { success: false, target, action: 'batch', error: 'ambiguous', note: `${where}: "${oldText}" matches ${idxs.length} entries — be more specific` };
        }
        const idx = idxs[0];
        if (op.action === 'remove') {
          working.splice(idx, 1);
        } else {
          const replaced = (working[idx].split(oldText).join(op.content ?? '')).trim();
          if (replaced) working[idx] = replaced;
          else working.splice(idx, 1);
        }
      }

      working = parseEntries(working.join(ENTRY_DELIMITER));
      const projected = this.usageFor(target, working);
      if (projected.chars > this.limits[target]) {
        return {
          success: false,
          target,
          action: 'batch',
          error: 'over_capacity',
          note: 'Batch final state is over the char limit — remove or shorten more entries in the same call.',
          currentEntries: entries,
          usage: this.usageFor(target, entries),
        };
      }

      this.write(target, working);
      return { success: true, target, action: 'batch', entryCount: working.length, usage: projected };
    });
  }

  /* -------------------------------------------------------- internal */

  private usageFor(target: MemoryTarget, entries: string[]): MemoryUsage {
    const chars = entries.join(ENTRY_DELIMITER).length;
    const limit = this.limits[target];
    const pct = limit > 0 ? Math.round((chars / limit) * 100) : 0;
    return { chars, limit, pct };
  }

  private readRaw(target: MemoryTarget): string {
    try {
      return readFileSync(this.filePath(target), 'utf8');
    } catch {
      return '';
    }
  }

  /** Parse + detect drift (file would not round-trip, or an entry over cap). */
  private loadState(target: MemoryTarget): { raw: string; entries: string[]; drift: boolean } {
    const raw = this.readRaw(target);
    const entries = parseEntries(raw);
    const normalized = entries.join(ENTRY_DELIMITER);
    const overLong = entries.some((e) => e.length > this.limits[target]);
    const drift = raw.trim() !== normalized || overLong;
    return { raw, entries, drift };
  }

  /** For destructive ops: snapshot + refuse when the on-disk file has drifted. */
  private refuseIfDrift(target: MemoryTarget, action: 'replace' | 'remove' | 'batch'): MemoryResult | null {
    const { drift } = this.loadState(target);
    if (!drift) return null;
    const bak = this.snapshot(target);
    return {
      success: false,
      target,
      action,
      error: 'drift',
      note:
        `${FILE_NAME[target]} was edited into a non-round-tripping state; ` +
        `refusing ${action} and snapshotting to ${bak ?? '<backup>'}. ` +
        'Re-run after the file is normalized (an add will heal it).',
    };
  }

  private matchIndices(entries: string[], needle: string): number[] {
    if (!needle) return [];
    const out: number[] = [];
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].includes(needle)) out.push(i);
    }
    return out;
  }

  private disambiguate(
    target: MemoryTarget,
    action: 'replace' | 'remove',
    idxs: number[],
  ): { index: number; error?: undefined } | { index: -1; error: MemoryResult } {
    if (idxs.length === 0) {
      return { index: -1, error: { success: false, target, action, error: 'not_found', note: 'no entry matches old_text' } };
    }
    if (idxs.length > 1) {
      return {
        index: -1,
        error: { success: false, target, action, error: 'ambiguous', note: `old_text matches ${idxs.length} entries — be more specific` },
      };
    }
    return { index: idxs[0] };
  }

  /** Copy the current file to `<file>.bak.<ts>`. Returns the backup path. */
  private snapshot(target: MemoryTarget): string | null {
    const src = this.filePath(target);
    if (!existsSync(src)) return null;
    const bak = `${src}.bak.${Date.now()}`;
    try {
      copyFileSync(src, bak);
      return bak;
    } catch {
      return null;
    }
  }

  /** Atomic write: temp file in the same dir + rename over the target. */
  private write(target: MemoryTarget, entries: string[]): void {
    mkdirSync(this.memoryDir, { recursive: true });
    const dest = this.filePath(target);
    const tmp = join(this.memoryDir, `.${FILE_NAME[target]}.${process.pid}.${Date.now()}.tmp`);
    const body = entries.join(ENTRY_DELIMITER);
    writeFileSync(tmp, body, 'utf8');
    renameSync(tmp, dest);
  }

  /* ---------------------------------------------------------- locking */

  private withLock<T>(target: MemoryTarget, fn: () => T): T {
    mkdirSync(this.memoryDir, { recursive: true });
    const lockPath = join(this.memoryDir, `${FILE_NAME[target]}.lock`);
    const waited = this.acquireLock(lockPath);
    try {
      return fn();
    } finally {
      if (waited) {
        try {
          unlinkSync(lockPath);
        } catch {
          /* already released */
        }
      }
    }
  }

  /** Returns true when the lock was acquired by this call (must be released). */
  private acquireLock(lockPath: string): boolean {
    const deadline = Date.now() + LOCK_MAX_WAIT_MS;
    for (;;) {
      try {
        const fd = openSync(lockPath, 'wx'); // O_CREAT | O_EXCL
        writeSync(fd, String(process.pid));
        closeSync(fd);
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        // Steal a stale lock, otherwise spin briefly.
        try {
          const age = Date.now() - statSync(lockPath).mtimeMs;
          if (age > LOCK_STALE_MS) {
            unlinkSync(lockPath);
            continue;
          }
        } catch {
          continue; // lock vanished between stat and now — retry
        }
        if (Date.now() > deadline) return false; // give up waiting; proceed unlocked
        sleep(25);
      }
    }
  }
}
