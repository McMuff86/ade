/**
 * Typed atomic JSON config store.
 * Location: app.getPath('userData')/ade/config.json
 * Writes are atomic: write to a temp file in the same directory, then rename.
 */

import { app } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_CONFIG, type AdeConfig } from '../../shared/types';
import { normalizeConfig } from '../orchestration/migrate';

export class ConfigStore {
  private readonly filePath: string;
  private config: AdeConfig;

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(app.getPath('userData'), 'ade', 'config.json');
    const loaded = this.load();
    this.config = loaded.config;
    if (loaded.migrated) {
      try {
        this.persist();
      } catch (err) {
        console.error('[ade] failed to persist migrated config:', err);
      }
    }
  }

  get(): AdeConfig {
    return this.config;
  }

  /**
   * Shallow-merge a partial config (settings merged one level deep) and
   * persist atomically. Returns the saved config.
   */
  save(partial: Partial<AdeConfig>): AdeConfig {
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

  private load(): { config: AdeConfig; migrated: boolean } {
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AdeConfig>;
      return normalizeConfig(parsed);
    } catch {
      // first run (or unreadable file): seed the default config on disk
      const seeded = structuredClone(DEFAULT_CONFIG);
      this.config = seeded;
      try {
        this.persist();
      } catch (err) {
        console.error('[ade] failed to seed config file:', err);
      }
      return { config: seeded, migrated: false };
    }
  }

  private persist(): void {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `config.json.${process.pid}.${Date.now()}.tmp`);
    writeFileSync(tmp, JSON.stringify(this.config, null, 2) + '\n', 'utf8');
    renameSync(tmp, this.filePath); // atomic on the same volume; replaces existing
  }
}
