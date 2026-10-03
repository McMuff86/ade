import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assertNoLinks } from '../../repositories/pathDiscipline';

export const MAX_VAULT_BYTES = 2 * 1024 * 1024;
export const fingerprint = (bytes: Buffer | null): string | null => bytes === null ? null : createHash('sha256').update(bytes).digest('hex');

/** Bounded, link-safe reads, including detection of replacement during the read. */
export function readVaultFile(file: string): Buffer | null {
  assertNoLinks(file);
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > MAX_VAULT_BYTES) throw new Error('Invalid vault file');
    const bytes = Buffer.alloc(before.size + 1); let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    const after = fstatSync(fd); assertNoLinks(file); const named = lstatSync(file);
    if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || before.ino !== named.ino || before.dev !== named.dev || named.nlink !== 1) throw new Error('Vault changed during read');
    return bytes.subarray(0, length);
  } finally { closeSync(fd); }
}

/** Caller holds the profile's exclusive ownership lock; fingerprint is a second fence. */
export function writeVaultFile(file: string, bytes: Buffer, expected: string | null): void {
  if (bytes.length > MAX_VAULT_BYTES) throw new Error('Vault full');
  const verify = () => { if (fingerprint(readVaultFile(file)) !== expected) throw new Error('Vault changed'); };
  verify(); assertNoLinks(dirname(file)); mkdirSync(dirname(file), { recursive: true, mode: 0o700 }); assertNoLinks(dirname(file));
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    verify(); renameSync(temporary, file);
    if (process.platform !== 'win32') {
      const directory = openSync(dirname(file), 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
  } finally { try { unlinkSync(temporary); } catch { /* Renamed or already absent. */ } }
}
