/**
 * Typed atomic JSON config store.
 * Location: app.getPath('userData')/ade/config.json
 * Writes are atomic: write to a temp file in the same directory, then rename.
 */

import { app } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_CONFIG, type AdeConfig } from '../../shared/types';

export class ConfigStore {
  private readonly filePath: string;
  private config: AdeConfig;

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(app.getPath('userData'), 'ade', 'config.json');
    this.config = this.load();
  }

  get(): AdeConfig {
    return this.config;
  }

  /**
   * Shallow-merge a partial config (settings merged one level deep) and
   * persist atomically. Returns the saved config.
   */
  save(partial: Partial<AdeConfig>): AdeConfig {
    this.config = {
      ...this.config,
      ...partial,
      settings: { ...this.config.settings, ...(partial.settings ?? {}) },
    };
    this.persist();
    return this.config;
  }

  private load(): AdeConfig {
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AdeConfig>;
      // tolerate missing keys from older/hand-edited files
      return {
        categories: Array.isArray(parsed.categories) ? parsed.categories : [],
        agents: Array.isArray(parsed.agents) ? parsed.agents : [],
        settings: { ...DEFAULT_CONFIG.settings, ...(parsed.settings ?? {}) },
      };
    } catch {
      // first run (or unreadable file): seed the default config on disk
      const seeded = structuredClone(DEFAULT_CONFIG);
      this.config = seeded;
      try {
        this.persist();
      } catch (err) {
        console.error('[ade] failed to seed config file:', err);
      }
      return seeded;
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
