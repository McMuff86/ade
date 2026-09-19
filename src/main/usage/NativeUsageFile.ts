import { t as translate } from "../../shared/i18n";
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { assertNoLinks } from '../repositories/pathDiscipline';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_CHUNK = 128 * 1024;
const MAX_LINE = 512 * 1024;
interface JsonLine { offset: number; value: unknown }

function names(directory: string, limit: number): string[] {
  assertNoLinks(directory); const result: string[] = []; const handle = opendirSync(directory);
  try {
    for (let next = handle.readSync(); next; next = handle.readSync()) {
      if (result.length >= limit) throw new Error(translate("Too many native session files for unambiguous usage matching."));
      result.push(next.name);
    }
  } finally { handle.closeSync(); }
  return result;
}
function regular(file: string): boolean {
  try { assertNoLinks(file); return lstatSync(file).isFile(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/** Find an exact native identity, never the latest file or a guessed project.
 * The caller supplies the native provider home from its captured launch env. */
export function findNativeUsageFile(home: string, provider: 'codex' | 'claude' | 'grok', nativeId: string): string | undefined {
  if (!isAbsolute(home) || !UUID.test(nativeId)) throw new Error(translate("Invalid native usage identity."));
  try {
    const root = join(home, provider === 'claude' ? 'projects' : 'sessions');
    const matches: string[] = [];
    if (provider === 'codex') {
      // Codex 0.154 uses UUIDv7 conversation IDs. Its timestamp selects only
      // candidate date buckets; the full UUID still has to match the file.
      if (nativeId[14] !== '7') throw new Error(translate("Codex session format for balancing is not yet supported."));
      const epoch = parseInt(nativeId.replace(/-/g, '').slice(0, 12), 16);
      if (epoch < Date.UTC(2020, 0, 1) || epoch > Date.now() + 86400000) throw new Error(translate("Invalid Codex session time."));
      for (const days of [-1, 0, 1]) {
        const date = new Date(epoch + days * 86400000); const directory = join(root, String(date.getUTCFullYear()), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0'));
        let entries: string[]; try { entries = names(directory, 4096); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
        for (const name of entries) if (name.startsWith('rollout-') && name.endsWith(`-${nativeId}.jsonl`) && regular(join(directory, name))) matches.push(join(directory, name));
      }
    } else {
      for (const name of names(root, 1024)) {
        const candidate = provider === 'claude' ? join(root, name, `${nativeId}.jsonl`) : join(root, name, nativeId, 'updates.jsonl');
        try { if (regular(candidate)) matches.push(candidate); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error; }
      }
    }
    if (matches.length > 1) throw new Error(translate("The native session is ambiguous. Usage will not be guessed."));
    return matches[0];
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

/** Bounded append-only JSONL tail. Prompt/image lines are parsed transiently
 * and never logged or persisted; consumers project only known usage fields. */
export class NativeUsageTail {
  private offset = 0;
  private pendingOffset = 0;
  private pending = Buffer.alloc(0);
  private skipping = false;
  private identity?: { dev: number; ino: number };
  constructor(private readonly home: string, private readonly file: string) {
    const inside = relative(resolve(home), resolve(file));
    if (!isAbsolute(home) || !isAbsolute(file) || !inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error(translate("Native usage file is outside its provider directory."));
  }

  read(): { lines: JsonLine[]; gap: boolean; more: boolean } {
    assertNoLinks(this.home); assertNoLinks(this.file);
    const fd = openSync(this.file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = fstatSync(fd); const current = lstatSync(this.file);
      if (!stat.isFile() || stat.dev !== current.dev || stat.ino !== current.ino || stat.size < this.offset
        || this.identity && (this.identity.dev !== stat.dev || this.identity.ino !== stat.ino)) throw new Error(translate("Native usage file has been replaced or shortened."));
      this.identity ??= { dev: stat.dev, ino: stat.ino };
      if (this.pending.indexOf(10) < 0) {
        const bytes = Buffer.alloc(Math.min(MAX_CHUNK, stat.size - this.offset));
        const read = bytes.length ? readSync(fd, bytes, 0, bytes.length, this.offset) : 0;
        this.offset += read; this.pending = Buffer.concat([this.pending, bytes.subarray(0, read)]);
      }
      const lines: JsonLine[] = []; let gap = false; let consumed = 0; let scanned = 0;
      while (scanned < 256) {
        const end = this.pending.indexOf(10, consumed); if (end < 0) break;
        scanned++; const length = end - consumed;
        if (this.skipping || length > MAX_LINE) { gap = true; this.skipping = false; }
        else {
          try {
            const text = new TextDecoder('utf-8', { fatal: true }).decode(this.pending.subarray(consumed, end));
            if (text.trim()) lines.push({ offset: this.pendingOffset + consumed, value: JSON.parse(text) });
          } catch { gap = true; }
        }
        consumed = end + 1;
      }
      this.pending = this.pending.subarray(consumed); this.pendingOffset += consumed;
      if (this.pending.length > MAX_LINE && this.pending.indexOf(10) < 0) {
        this.pendingOffset += this.pending.length; this.pending = Buffer.alloc(0); this.skipping = true; gap = true;
      }
      assertNoLinks(this.file); const after = lstatSync(this.file);
      if (after.dev !== stat.dev || after.ino !== stat.ino || after.size < this.offset) throw new Error(translate("Native usage file has changed during reading."));
      return { lines, gap, more: after.size > this.offset || this.pending.indexOf(10) >= 0 };
    } finally { closeSync(fd); }
  }
}
