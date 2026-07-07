/**
 * Memory scaffold — create an agent's empty-but-valid MEMORY.md / USER.md.
 *
 * Called once from identity.ts on agent creation. Idempotent: existing files
 * are left untouched. An empty file is a valid store (parses to zero entries,
 * no drift). Skipped when memory is disabled in settings.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MEMORY_FILES = ['MEMORY.md', 'USER.md'] as const;

export interface ScaffoldOptions {
  /** When false, no files are created. Defaults to true. */
  enabled?: boolean;
}

/** Create the two memory files (empty) if missing. */
export function createMemoryScaffold(memoryDir: string, opts: ScaffoldOptions = {}): void {
  if (opts.enabled === false) return;
  mkdirSync(memoryDir, { recursive: true });
  for (const name of MEMORY_FILES) {
    const path = join(memoryDir, name);
    if (!existsSync(path)) {
      writeFileSync(path, '', 'utf8');
    }
  }
}
