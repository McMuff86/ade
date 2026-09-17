import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { assertNoLinks } from '../repositories/pathDiscipline';
import { supervisionId, validHandoffText, validSupervisionMode, validSupervisionObjective, validSupervisionTarget, type SupervisedProject, type ProjectHandoff } from '../../shared/supervision';

export interface SupervisionState {
  version: 2; revision: number; profileId: string | null; projects: SupervisedProject[]; handoffs: ProjectHandoff[];
  commands: Array<{ id: string; fingerprint: string; revision: number }>;
}
export const supervisionDigest = (text: string) => createHash('sha256').update(text).digest('hex');
const MAX_BYTES = 2 * 1024 * 1024;
const fields = (v: unknown, keys: string[]): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const unique = (ids: string[]) => new Set(ids).size === ids.length;
export function validSupervisionState(value: unknown): value is SupervisionState {
  if (!fields(value, ['version', 'revision', 'profileId', 'projects', 'commands', 'handoffs']) || value.version !== 2 || !integer(value.revision)
    || !(value.profileId === null || supervisionId(value.profileId)) || !Array.isArray(value.projects) || value.projects.length > 64
    || !Array.isArray(value.commands) || value.commands.length > 512 || !Array.isArray(value.handoffs) || value.handoffs.length > 1024) return false;
  if (!value.projects.every(p => fields(p, ['id', 'repositoryId', 'mode', 'objective', 'links', 'updatedAt']) && supervisionId(p.id) && supervisionId(p.repositoryId)
    && validSupervisionMode(p.mode) && validSupervisionObjective(p.objective) && integer(p.updatedAt) && Array.isArray(p.links) && p.links.length <= 64
    && p.links.every(l => fields(l, ['id', 'target', 'createdAt']) && supervisionId(l.id) && validSupervisionTarget(l.target) && integer(l.createdAt))
    && unique(p.links.map(l => l.id)) && unique(p.links.map(l => `${l.target.kind}:${l.target.id}`)))) return false;
  const projects = value.projects as SupervisedProject[];
  if (!unique(projects.map(p => p.id)) || !unique(projects.map(p => p.repositoryId))) return false;
  if (!value.handoffs.every(h => fields(h, ['id', 'projectId', 'text', 'nextStep', 'source', 'status', 'createdAt', 'updatedAt']) && supervisionId(h.id)
    && projects.some(p => p.id === h.projectId) && validHandoffText(h.text) && !!h.text.trim() && validHandoffText(h.nextStep)
    && (h.source === null || validSupervisionTarget(h.source)) && (h.status === 'open' || h.status === 'done') && integer(h.createdAt) && integer(h.updatedAt))
    || !unique(value.handoffs.map(h => h.id))) return false;
  return value.commands.every(c => fields(c, ['id', 'fingerprint', 'revision']) && supervisionId(c.id) && typeof c.fingerprint === 'string'
    && /^[a-f0-9]{64}$/.test(c.fingerprint) && integer(c.revision) && c.revision <= (value.revision as number))
    && unique(value.commands.map(c => c.id));
}
/** Bounded ADE metadata outside project repositories. Refuses drift, linked
 * files and malformed originals instead of replacing them with empty state. */
export class SupervisionStore {
  private state: SupervisionState;
  private fingerprint: string | null;
  constructor(private readonly path: string) {
    const raw = this.read(); this.fingerprint = raw === null ? null : supervisionDigest(raw);
    let state: unknown = raw === null ? { version: 2, revision: 0, profileId: null, projects: [], commands: [], handoffs: [] } : JSON.parse(raw);
    // Additive migration stays in memory until the next explicit command; the
    // original bytes remain the drift guard and corrupt originals are retained.
    if (fields(state, ['version', 'revision', 'profileId', 'projects', 'commands']) && state.version === 1) state = { ...state, version: 2, handoffs: [] };
    if (!validSupervisionState(state)) throw new Error('ADE-Betreuungsspeicher ist ungültig. Original bleibt erhalten.');
    this.state = state;
  }
  snapshot(): SupervisionState { return structuredClone(this.state); }
  save(next: SupervisionState): void {
    if (!validSupervisionState(next) || next.revision !== this.state.revision + 1) throw new Error('Ungültige Betreuungsrevision.');
    const bytes = JSON.stringify(next); if (Buffer.byteLength(bytes) > MAX_BYTES) throw new Error('ADE-Betreuungsspeicher hat sein Limit erreicht.');
    const verify = () => { const raw = this.read(); if ((raw === null ? null : supervisionDigest(raw)) !== this.fingerprint) throw new Error('ADE-Betreuung wurde ausserhalb dieser Instanz verändert. Neu starten und Stand prüfen.'); };
    verify(); assertNoLinks(dirname(this.path)); mkdirSync(dirname(this.path), { recursive: true }); assertNoLinks(dirname(this.path));
    const temp = `${this.path}.${randomUUID()}.tmp`; const fd = openSync(temp, 'wx', 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); verify(); renameSync(temp, this.path); }
    finally { closeSync(fd); if (existsSync(temp)) unlinkSync(temp); }
    this.fingerprint = supervisionDigest(bytes); this.state = structuredClone(next);
  }
  private read(): string | null {
    assertNoLinks(this.path); if (!existsSync(this.path)) return null;
    const fd = openSync(this.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = fstatSync(fd); if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES) throw new Error('Unsicherer oder zu grosser ADE-Betreuungsspeicher.');
      // Keep allocation and reads bounded even if another process grows the
      // already-open file after fstat. One extra byte detects such growth.
      const bytes = Buffer.alloc(stat.size + 1); let length = 0;
      while (length < bytes.length) { const count = readSync(fd, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
      const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length));
      const after = fstatSync(fd); assertNoLinks(this.path); const named = lstatSync(this.path);
      if (length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || named.dev !== stat.dev || named.ino !== stat.ino || named.nlink !== 1) throw new Error('ADE-Betreuungsspeicher wurde beim Lesen verändert.');
      return raw;
    } finally { closeSync(fd); }
  }
}
