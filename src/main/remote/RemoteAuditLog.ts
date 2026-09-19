import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoLinks } from '../repositories/pathDiscipline';
import type { DeviceAuditEntry } from './RemoteDeviceStore';

export const REMOTE_AUDIT_MAX_BYTES = 8 * 1024 * 1024;
const CHECKPOINT = 'audit:checkpoint';
interface History { devices: boolean; commands: boolean }
interface Checkpoint extends DeviceAuditEntry { history: History }

function fileSize(file: string): number | null {
  assertNoLinks(file);
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > REMOTE_AUDIT_MAX_BYTES) throw new Error('invalid audit file');
    return stat.size;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

function readLog(file: string): { text: string; history: History } | null {
  if (fileSize(file) === null) return null;
  const text = readFileSync(file, 'utf8');
  if (text && !text.endsWith('\n')) throw new Error('incomplete audit');
  const history: History = { devices: false, commands: false };
  for (const line of text ? text.slice(0, -1).split('\n') : []) {
    const entry = JSON.parse(line) as Checkpoint;
    if (!entry || !Number.isSafeInteger(entry.at) || typeof entry.requestId !== 'string'
      || typeof entry.channel !== 'string' || typeof entry.outcome !== 'string') throw new Error('invalid audit');
    if (entry.channel === CHECKPOINT) {
      if (!entry.history || typeof entry.history.devices !== 'boolean' || typeof entry.history.commands !== 'boolean') throw new Error('invalid audit checkpoint');
      history.devices ||= entry.history.devices; history.commands ||= entry.history.commands;
    }
    history.devices ||= entry.channel.startsWith('device:');
    history.commands ||= /^(?:admin:|terminal:|supervision:|conversation:|project:|integration:)/.test(entry.channel)
      || ['run:delete', 'host:restart', 'workspace:save', 'profile:update'].includes(entry.channel);
  }
  return { text, history };
}

/** Retention never turns lost device state or receipts into a fresh profile. */
export function readRemoteAudit(dir: string): { text: string; history: History } {
  const current = readLog(join(dir, 'audit.jsonl'));
  const previous = readLog(join(dir, 'audit.previous.jsonl'));
  if (!current && previous) throw new Error('current audit missing');
  return { text: current?.text ?? '', history: {
    devices: current?.history.devices === true || previous?.history.devices === true,
    commands: current?.history.commands === true || previous?.history.commands === true,
  } };
}

/** Fsynced appends; atomic retention preserves the previous segment before replacement. */
export class RemoteAuditLog {
  readonly path: string;
  readonly history: History;
  private bytes: number;
  constructor(private readonly dir: string) {
    this.path = join(dir, 'audit.jsonl');
    const loaded = readRemoteAudit(dir);
    this.bytes = Buffer.byteLength(loaded.text); this.history = loaded.history;
  }

  append(line: string): void {
    const size = fileSize(this.path) ?? 0;
    if (size !== this.bytes) throw new Error('audit changed outside ADE');
    if (size) {
      const fd = openSync(this.path, 'r');
      try {
        const last = Buffer.alloc(1);
        if (readSync(fd, last, 0, 1, size - 1) !== 1 || last[0] !== 10) throw new Error('incomplete audit');
      } finally { closeSync(fd); }
    }
    if (Buffer.byteLength(line) > REMOTE_AUDIT_MAX_BYTES / 2) throw new Error('audit entry too large');
    if (size + Buffer.byteLength(line) > REMOTE_AUDIT_MAX_BYTES) this.retain();
    const fd = openSync(this.path, 'a', 0o600);
    try { writeFileSync(fd, line); fsyncSync(fd); } finally { closeSync(fd); }
    this.bytes += Buffer.byteLength(line);
  }

  private retain(): void {
    const current = readRemoteAudit(this.dir);
    if (Buffer.byteLength(current.text) !== this.bytes) throw new Error('audit changed outside ADE');
    const lines = current.text.slice(0, -1).split('\n');
    let bytes = 0; let start = lines.length;
    while (start > 0) {
      const next = Buffer.byteLength(lines[start - 1]!) + 1;
      if (bytes + next > REMOTE_AUDIT_MAX_BYTES / 2) break;
      bytes += next; start--;
    }
    const checkpoint: Checkpoint = { at: Date.now(), principalId: 'host', principalKind: 'host',
      requestId: randomUUID(), channel: CHECKPOINT, target: null, outcome: 'retained', history: current.history };
    const retained = JSON.stringify(checkpoint) + '\n' + lines.slice(start).filter(line => JSON.parse(line).channel !== CHECKPOINT).map(line => line + '\n').join('');
    // A crash leaves either the complete old current file or the complete new one.
    // At most 8 MiB per durable file; temporary writes are bounded by the same limit.
    this.replace(join(this.dir, 'audit.previous.jsonl'), current.text);
    this.replace(this.path, retained);
    this.bytes = Buffer.byteLength(retained);
  }

  private replace(file: string, text: string): void {
    fileSize(file);
    const temp = join(this.dir, `audit-${randomUUID()}.tmp`);
    try {
      assertNoLinks(temp);
      const fd = openSync(temp, 'wx', 0o600);
      try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
      fileSize(file); renameSync(temp, file);
      if (process.platform !== 'win32') {
        const directory = openSync(this.dir, 'r');
        try { fsyncSync(directory); } finally { closeSync(directory); }
      }
    } finally { try { unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
  }
}
