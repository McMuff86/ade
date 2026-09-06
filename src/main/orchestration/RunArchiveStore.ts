/**
 * Durable archive for runs that history retention removes from the journal.
 *
 * One file per run under `<dir>/<runId>.json`, written tmp+rename+fsync like
 * the config itself, compact JSON. `write` returns only after the bytes are
 * durable, which is what lets `applyRetention` prune in the same tick. A run
 * id is a UUID by construction; anything else is rejected so the archive path
 * can never be steered.
 */

import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { RunArchive, RunArchivePort } from './OrchestrationService';

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class RunArchiveStore implements RunArchivePort {
  constructor(private readonly dir: string) {}

  pathFor(runId: string): string {
    if (!RUN_ID.test(runId)) throw new Error('ade: run archive requires a UUID run id');
    return join(this.dir, `${runId}.json`);
  }

  write(archive: RunArchive): void {
    const target = this.pathFor(archive.run.id);
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const fd = openSync(tmp, 'w');
    try {
      writeSync(fd, JSON.stringify(archive) + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      renameSync(tmp, target);
    } catch (error) {
      try {
        unlinkSync(tmp);
      } catch {
        // The rename failed; the stray tmp file is cosmetic.
      }
      throw error;
    }
  }
}
