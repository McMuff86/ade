/**
 * Typed atomic JSON config store.
 * Location: app.getPath('userData')/ade/config.json
 *
 * Writes are atomic and durable: write a temp file in the same directory,
 * fsync it, then rename.
 *
 * Loading never destroys an existing file. Only a missing file seeds defaults.
 * Anything else — an unreadable/locked file, invalid JSON, or a record that
 * normalization refuses — is preserved under `corrupt/` before defaults are
 * seeded, because that file is the only copy of the agent catalog, the
 * repository bindings, the run journal and the publication audit. When even
 * preservation fails, the store turns read-only and refuses every write
 * instead of overwriting the original.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DEFAULT_CONFIG, type AdeConfig, type ConfigLoadFailure } from '../../shared/types';
import { normalizeConfig } from '../orchestration/migrate';

/** Lazily binds Electron so tests can construct a store with an explicit path. */
function defaultConfigPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron');
  return join(app.getPath('userData'), 'ade', 'config.json');
}

/** Node's fs errors embed the absolute path; keep it out of stored detail. */
function describeError(error: unknown, filePath: string): string {
  const raw = error instanceof Error ? (error.message || error.name) : String(error);
  return raw
    .split(filePath).join('<config.json>')
    .split(dirname(filePath)).join('<configDir>')
    .slice(0, 300);
}

interface LoadOutcome {
  config: AdeConfig;
  failure: ConfigLoadFailure | null;
  /** Whether the loaded state still has to reach disk (seed or migration). */
  persist: boolean;
}

export class ConfigStore {
  private readonly filePath: string;
  private config: AdeConfig;
  private readonly loadFailure: ConfigLoadFailure | null;

  constructor(filePath?: string) {
    this.filePath = filePath ?? defaultConfigPath();
    const loaded = this.load();
    this.config = loaded.config;
    this.loadFailure = loaded.failure;
    if (loaded.persist && !this.readOnly) {
      try {
        this.persist();
      } catch (err) {
        console.error('[ade] failed to write config file:', err);
      }
    }
  }

  get(): AdeConfig {
    return this.config;
  }

  /** Non-null when the previous config file could not be loaded. */
  getLoadFailure(): ConfigLoadFailure | null {
    return this.loadFailure;
  }

  /** True when an unpreservable original must not be overwritten. */
  get readOnly(): boolean {
    return this.loadFailure?.readOnly === true;
  }

  /**
   * Shallow-merge a partial config (settings merged one level deep) and
   * persist atomically. Returns the saved config.
   */
  save(partial: Partial<AdeConfig>): AdeConfig {
    if (this.readOnly) {
      // Fail before touching the in-memory snapshot: a caller that ignores
      // this error must not observe a mutated catalog either.
      throw new Error(
        'ade: the existing configuration could not be read or preserved, so ADE refuses to '
        + 'overwrite it. Move or repair config.json, then restart ADE.',
      );
    }
    // An explicitly-undefined property would shadow the current value and
    // JSON.stringify would then drop the key from disk entirely (observed as
    // a transient catalog loss in Goal 6). Undefined never overwrites.
    const defined = Object.fromEntries(
      Object.entries(partial).filter(([, value]) => value !== undefined),
    ) as Partial<AdeConfig>;
    this.config = {
      ...this.config,
      ...defined,
      settings: { ...this.config.settings, ...(defined.settings ?? {}) },
    };
    this.persist();
    return this.config;
  }

  private load(): LoadOutcome {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // First run only: there is nothing to lose.
        return { config: structuredClone(DEFAULT_CONFIG), failure: null, persist: true };
      }
      return this.recover('unreadable', error);
    }

    let parsed: Partial<AdeConfig>;
    try {
      parsed = JSON.parse(raw) as Partial<AdeConfig>;
    } catch (error) {
      return this.recover('malformed', error);
    }

    try {
      const normalized = normalizeConfig(parsed);
      return { config: normalized.config, failure: null, persist: normalized.migrated };
    } catch (error) {
      return this.recover('incompatible', error);
    }
  }

  /** Preserve the unusable file, then decide whether defaults may be written. */
  private recover(reason: ConfigLoadFailure['reason'], error: unknown): LoadOutcome {
    const detail = describeError(error, this.filePath);
    let quarantinedTo: string | null = null;
    try {
      quarantinedTo = this.quarantine();
    } catch (quarantineError) {
      console.error('[ade] config quarantine failed; the original stays in place:', quarantineError);
    }
    console.error(`[ade] config load failed (${reason}): ${detail}`);
    return {
      config: structuredClone(DEFAULT_CONFIG),
      failure: { reason, detail, quarantinedTo, readOnly: quarantinedTo === null, at: Date.now() },
      persist: quarantinedTo !== null,
    };
  }

  /** Move the unusable file aside. Returns its config-relative location. */
  private quarantine(): string {
    const dir = join(dirname(this.filePath), 'corrupt');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    let target = join(dir, `config-${stamp}.json`);
    for (let attempt = 1; existsSync(target); attempt += 1) {
      target = join(dir, `config-${stamp}-${attempt}.json`);
    }
    renameSync(this.filePath, target);
    return `corrupt/${basename(target)}`;
  }

  private persist(): void {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `config.json.${process.pid}.${Date.now()}.tmp`);
    const body = JSON.stringify(this.config, null, 2) + '\n';
    const handle = openSync(tmp, 'w');
    try {
      writeSync(handle, body, null, 'utf8');
      // Without fsync a power loss can leave a renamed but truncated file,
      // which the next launch would classify as malformed.
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSync(tmp, this.filePath); // atomic on the same volume; replaces existing
  }
}
