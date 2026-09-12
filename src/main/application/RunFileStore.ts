import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertNoLinks } from '../repositories/pathDiscipline';

/** Content-addressed result bytes; task metadata and run archives hold the references. */
export class RunFileStore {
  constructor(private readonly directory: string, private readonly maxBytes = 2 * 1024 * 1024 * 1024) {}
  private path(sha: string): string {
    if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error('ade: Ungültiger Ergebnisdatei-Beleg.');
    const path = join(this.directory, `${sha}.bin`); assertNoLinks(path); return path;
  }
  put(sha: string, bytes: Buffer): void {
    if (bytes.length > 16 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== sha) throw new Error('ade: Ergebnisdatei wurde während der Sicherung verändert.');
    const path = this.path(sha); if (existsSync(path)) { this.read(sha, bytes.length); return; }
    assertNoLinks(this.directory); mkdirSync(this.directory, { recursive: true }); assertNoLinks(this.directory);
    let total = 0;
    for (const name of readdirSync(this.directory)) {
      if (!/^[a-f0-9]{64}\.bin$/.test(name)) continue;
      const stat = lstatSync(this.path(name.slice(0, 64))); if (!stat.isFile() || stat.nlink !== 1) throw new Error('ade: Unsicherer Ergebnisdatei-Speicher.');
      total += stat.size;
    }
    if (total + bytes.length > this.maxBytes) throw new Error('ade: Ergebnisdatei-Speicher hat sein Limit erreicht.');
    const tmp = `${path}.${randomUUID()}.tmp`; const fd = openSync(tmp, 'wx', 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); assertNoLinks(path); renameSync(tmp, path); }
    finally { closeSync(fd); if (existsSync(tmp)) unlinkSync(tmp); }
  }
  read(sha: string, size: number): Buffer {
    const path = this.path(sha); const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size !== size || size > 16 * 1024 * 1024) throw new Error('ade: Ergebnisdatei ist nicht mehr unverändert verfügbar.');
      const bytes = Buffer.alloc(size); let read = 0;
      while (read < size) { const count = readSync(fd, bytes, read, size - read, read); if (!count) break; read += count; }
      const named = lstatSync(this.path(sha)); const after = fstatSync(fd);
      if (read !== size || after.size !== size || after.mtimeMs !== stat.mtimeMs || named.dev !== stat.dev || named.ino !== stat.ino
        || named.nlink !== 1 || named.size !== size || createHash('sha256').update(bytes).digest('hex') !== sha) throw new Error('ade: Ergebnisdatei ist nicht mehr unverändert verfügbar.');
      return bytes;
    } finally { closeSync(fd); }
  }
}
