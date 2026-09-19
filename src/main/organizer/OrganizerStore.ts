import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { assertNoLinks } from '../repositories/pathDiscipline';
import { ORGANIZER_LIMITS, organizerCount, organizerId, organizerKeys, organizerRecord, organizerSummary, validOrganizerDocument, validOrganizerMutation,
  type OrganizerEntry, type OrganizerIndex, type OrganizerMutation, type OrganizerReceipt } from '../../shared/organizer';

interface Writer { id: string; owner: string; sequence: number; fingerprint: string; receipt: OrganizerReceipt }
interface State { version: 1; revision: number; entries: OrganizerEntry[]; writers: Writer[] }
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const isDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function validState(value: unknown): value is State {
  if (!organizerRecord(value) || !organizerKeys(value, ['version', 'revision', 'entries', 'writers']) || value.version !== 1 || !organizerCount(value.revision)
    || !Array.isArray(value.entries) || value.entries.length > ORGANIZER_LIMITS.documents || !Array.isArray(value.writers) || value.writers.length > ORGANIZER_LIMITS.writers) return false;
  if (!value.entries.every(entry => organizerRecord(entry) && organizerKeys(entry, ['document', 'revision', 'createdAt', 'updatedAt', 'deleted', 'conflictOf'])
    && validOrganizerDocument(entry.document) && organizerCount(entry.revision) && entry.revision > 0 && entry.revision <= (value.revision as number)
    && organizerCount(entry.createdAt) && organizerCount(entry.updatedAt) && entry.updatedAt >= entry.createdAt && typeof entry.deleted === 'boolean'
    && (entry.conflictOf === null || organizerId(entry.conflictOf)))) return false;
  if (!value.writers.every(writer => organizerRecord(writer) && organizerKeys(writer, ['id', 'owner', 'sequence', 'fingerprint', 'receipt'])
    && organizerId(writer.id) && isDigest(writer.owner) && organizerCount(writer.sequence) && writer.sequence > 0 && isDigest(writer.fingerprint)
    && organizerRecord(writer.receipt) && organizerKeys(writer.receipt, ['id', 'revision', 'createdAt', 'updatedAt', 'conflict', 'deleted', 'replayed']) && organizerId(writer.receipt.id)
    && organizerCount(writer.receipt.createdAt) && organizerCount(writer.receipt.updatedAt) && writer.receipt.updatedAt >= writer.receipt.createdAt
    && organizerCount(writer.receipt.revision) && writer.receipt.revision <= (value.revision as number)
    && typeof writer.receipt.conflict === 'boolean' && typeof writer.receipt.deleted === 'boolean' && writer.receipt.replayed === false)) return false;
  return new Set(value.entries.map(entry => (entry as OrganizerEntry).document.id)).size === value.entries.length
    && new Set(value.writers.map(writer => (writer as Writer).id)).size === value.writers.length;
}
export class OrganizerError extends Error {
  constructor(readonly code: 'invalid' | 'unavailable' | 'writer_owner' | 'sequence_old' | 'sequence_gap' | 'key_reused' | 'changed' | 'missing' | 'limit', message: string) { super(message); }
}
/** Single main-process owner; atomic documents + latest writer receipts, bounded independently of edit count. */
export class OrganizerStore {
  private state: State;
  private fingerprint: string | null;
  constructor(private readonly path: string, private readonly now = Date.now) {
    const raw = this.read(); this.fingerprint = raw === null ? null : digest(raw);
    let value: unknown;
    try { value = raw === null ? { version: 1, revision: 0, entries: [], writers: [] } : JSON.parse(raw); }
    catch { throw new OrganizerError('unavailable', 'Aufgaben und Notizen konnten nicht gelesen werden. Die Originaldatei bleibt erhalten.'); }
    if (!validState(value)) throw new OrganizerError('unavailable', 'Aufgaben und Notizen haben ein ungültiges Format. Die Originaldatei bleibt erhalten.');
    this.state = value;
  }
  index(): OrganizerIndex { return { revision: this.state.revision, entries: this.state.entries.map(organizerSummary) }; }
  detail(id: string): OrganizerEntry | null { const entry = this.state.entries.find(item => item.document.id === id); return entry ? structuredClone(entry) : null; }
  writerSequence(writerId: string, owner: string): number {
    const writer = this.state.writers.find(item => item.id === writerId);
    if (writer && writer.owner !== digest(owner)) throw new OrganizerError('writer_owner', 'Dieser Entwurf gehört zu einem anderen Gerätezugang.');
    return writer?.sequence ?? 0;
  }
  mutate(input: OrganizerMutation, owner: string): OrganizerReceipt {
    if (!validOrganizerMutation(input) || Buffer.byteLength(JSON.stringify(input)) > ORGANIZER_LIMITS.documentBytes) throw new OrganizerError('invalid', 'Aufgabe oder Notiz ist ungültig oder zu gross.');
    const sequence = this.writerSequence(input.writerId, owner);
    const fingerprint = digest(JSON.stringify(input));
    const previous = this.state.writers.find(writer => writer.id === input.writerId);
    if (input.sequence === sequence && previous) {
      if (previous.fingerprint !== fingerprint) throw new OrganizerError('key_reused', 'Die wiederholte Änderung hat einen anderen Inhalt.');
      return { ...previous.receipt, replayed: true };
    }
    if (input.sequence < sequence) throw new OrganizerError('sequence_old', 'Diese Änderung wurde bereits durch eine spätere Änderung abgelöst.');
    if (input.sequence !== sequence + 1) throw new OrganizerError('sequence_gap', 'Eine frühere Änderung muss zuerst synchronisiert werden.');
    const id = input.operation === 'put' ? input.document.id : input.id;
    const current = this.state.entries.find(entry => entry.document.id === id);
    if (!current && input.baseRevision > 0) throw new OrganizerError('missing', 'Der ursprüngliche Eintrag ist nicht mehr vorhanden. Der lokale Entwurf bleibt erhalten.');
    if (current && input.operation === 'put' && current.document.kind !== input.document.kind) throw new OrganizerError('invalid', 'Aufgaben und Notizen behalten ihren Typ.');
    const stale = (current?.revision ?? 0) !== input.baseRevision;
    if (input.operation === 'delete' && (!current || stale)) throw new OrganizerError('changed', 'Der Eintrag wurde inzwischen geändert. Vor dem Löschen neu laden.');
    if (this.state.revision === Number.MAX_SAFE_INTEGER) throw new OrganizerError('limit', 'Der Versionsspeicher ist voll.');
    const revision = this.state.revision + 1;
    const at = Math.max(this.now(), current?.updatedAt ?? 0);
    let entry: OrganizerEntry;
    if (input.operation === 'delete') {
      // Keep the tombstone/version so an old offline edit cannot silently resurrect a deletion.
      entry = { ...structuredClone(current!), revision, updatedAt: at, deleted: true };
    } else {
      const document = structuredClone(input.document);
      if (stale || current?.deleted) document.id = randomUUID();
      entry = { document, revision, createdAt: document.id === current?.document.id ? current.createdAt : at, updatedAt: at,
        deleted: false, conflictOf: stale || current?.deleted ? id : current?.conflictOf ?? null };
    }
    const receipt: OrganizerReceipt = { id: entry.document.id, revision, createdAt: entry.createdAt, updatedAt: entry.updatedAt, conflict: entry.document.id !== id, deleted: entry.deleted, replayed: false };
    const next = structuredClone(this.state); next.revision = revision;
    const index = next.entries.findIndex(item => item.document.id === entry.document.id);
    if (index < 0) next.entries.push(entry); else next.entries[index] = entry;
    const writer: Writer = { id: input.writerId, owner: digest(owner), sequence: input.sequence, fingerprint, receipt };
    const writerIndex = next.writers.findIndex(item => item.id === writer.id);
    if (writerIndex < 0) next.writers.push(writer); else next.writers[writerIndex] = writer;
    if (next.entries.length > ORGANIZER_LIMITS.documents || next.writers.length > ORGANIZER_LIMITS.writers) throw new OrganizerError('limit', 'Der Aufgaben- und Notizspeicher ist voll. Bestehende Daten bleiben erhalten.');
    this.save(next); return structuredClone(receipt);
  }
  private save(next: State): void {
    if (!validState(next)) throw new OrganizerError('invalid', 'Ungültiger Aufgaben- und Notizstand.');
    const bytes = JSON.stringify(next);
    if (Buffer.byteLength(bytes) > ORGANIZER_LIMITS.storeBytes) throw new OrganizerError('limit', 'Der Aufgaben- und Notizspeicher ist voll. Bestehende Daten bleiben erhalten.');
    const verify = () => { const raw = this.read(); if ((raw === null ? null : digest(raw)) !== this.fingerprint) throw new OrganizerError('changed', 'Die Ablage wurde ausserhalb von ADE verändert. Entwürfe behalten und ADE neu starten.'); };
    verify(); assertNoLinks(dirname(this.path)); mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 }); assertNoLinks(dirname(this.path));
    const temporary = `${this.path}.${randomUUID()}.tmp`; const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); verify(); renameSync(temporary, this.path);
      if (process.platform !== 'win32') { const directory = openSync(dirname(this.path), 'r'); try { fsyncSync(directory); } finally { closeSync(directory); } }
    } catch (error) { try { closeSync(fd); } catch { /* Already closed before Windows rename. */ } throw error; }
    finally { if (existsSync(temporary)) unlinkSync(temporary); }
    this.fingerprint = digest(bytes); this.state = next;
  }
  private read(): string | null {
    assertNoLinks(this.path); if (!existsSync(this.path)) return null;
    const fd = openSync(this.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = fstatSync(fd);
      if (!before.isFile() || before.nlink !== 1 || before.size > ORGANIZER_LIMITS.storeBytes) throw new OrganizerError('unavailable', 'Unsichere oder zu grosse Aufgaben- und Notizablage.');
      const bytes = Buffer.alloc(before.size + 1); let length = 0;
      while (length < bytes.length) { const count = readSync(fd, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
      const after = fstatSync(fd); assertNoLinks(this.path); const named = lstatSync(this.path);
      if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.ino !== named.ino || before.dev !== named.dev || named.nlink !== 1)
        throw new OrganizerError('changed', 'Die Aufgaben- und Notizablage wurde beim Lesen verändert.');
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length));
    } finally { closeSync(fd); }
  }
}
