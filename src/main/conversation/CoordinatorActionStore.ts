import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { conversationId } from '../../shared/conversation';
import { exactActionKeys, validCoordinatorActionInput, type CoordinatorActionInput, type CoordinatorActionState } from '../../shared/coordinatorActions';
import { supervisionId, type SupervisionCommand } from '../../shared/supervision';
import { assertNoLinks } from '../repositories/pathDiscipline';
import { conversationDigest, type ConversationBinding } from './ConversationStore';

export interface StoredCoordinatorAction {
  id: string; conversationId: string; turnId: string; binding: ConversationBinding;
  sourceKey: string; sourceDigest: string; input: CoordinatorActionInput; repositoryId: string;
  workerDigest: string | null; state: CoordinatorActionState; createdAt: number; updatedAt: number;
  commandId: string; handoffCommand: SupervisionCommand | null; runId: string | null; taskId: string | null; error: string;
}
export interface CoordinatorActionStateFile { version: 1; revision: number; actions: StoredCoordinatorAction[]; commands: Array<{ id: string; digest: string; actionId: string }> }
export const COORDINATOR_ACTION_LIMIT = 4 * 1024 * 1024;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const digest = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const count = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
export function validCoordinatorActionState(v: unknown): v is CoordinatorActionStateFile {
  if (!record(v) || !exactActionKeys(v, ['version', 'revision', 'actions', 'commands']) || v.version !== 1 || !count(v.revision) || !Array.isArray(v.actions) || v.actions.length > 256
    || !Array.isArray(v.commands) || v.commands.length > 1024) return false;
  if (!v.actions.every(a => record(a) && exactActionKeys(a, ['id', 'conversationId', 'turnId', 'binding', 'sourceKey', 'sourceDigest', 'input', 'repositoryId', 'workerDigest', 'state', 'createdAt', 'updatedAt', 'commandId', 'handoffCommand', 'runId', 'taskId', 'error'])
    && conversationId(a.id) && conversationId(a.conversationId) && conversationId(a.turnId)
    && record(a.binding) && exactActionKeys(a.binding, ['profileId', 'authoritySha256', 'toolContract']) && supervisionId(a.binding.profileId) && supervisionId(a.binding.toolContract) && digest(a.binding.authoritySha256)
    && digest(a.sourceKey) && digest(a.sourceDigest) && validCoordinatorActionInput(a.input) && supervisionId(a.repositoryId)
    && (a.input.kind === 'task' ? digest(a.workerDigest) : a.workerDigest === null)
    && ['proposed', 'dismissed', 'dispatching', 'applied', 'uncertain'].includes(String(a.state)) && count(a.createdAt) && count(a.updatedAt)
    && a.commandId === `coordinator:${a.id}` && (a.runId === null || conversationId(a.runId)) && (a.taskId === null || conversationId(a.taskId))
    && (a.runId === null) === (a.taskId === null) && typeof a.error === 'string' && a.error.length <= 2000
    && (a.input.kind === 'task' ? a.handoffCommand === null : a.runId === null && (a.handoffCommand === null || record(a.handoffCommand)
      && exactActionKeys(a.handoffCommand, ['operation', 'commandId', 'revision', 'projectId', 'text', 'nextStep', 'linkId'])
      && a.handoffCommand.operation === 'remember' && a.handoffCommand.commandId === a.commandId && count(a.handoffCommand.revision)
      && a.handoffCommand.projectId === a.input.projectId && a.handoffCommand.text === a.input.text && a.handoffCommand.nextStep === a.input.nextStep && a.handoffCommand.linkId === null))
    && (!['proposed', 'dismissed'].includes(String(a.state)) || a.runId === null && a.handoffCommand === null)
    && (a.state !== 'applied' || (a.input.kind === 'task' ? a.runId !== null : a.handoffCommand !== null)))) return false;
  const actions = v.actions as StoredCoordinatorAction[];
  return new Set(actions.map(a => a.id)).size === actions.length && new Set(actions.map(a => a.sourceKey)).size === actions.length
    && v.commands.every(c => record(c) && exactActionKeys(c, ['id', 'digest', 'actionId']) && supervisionId(c.id) && digest(c.digest) && actions.some(a => a.id === c.actionId))
    && new Set(v.commands.map(c => c.id)).size === v.commands.length;
}
/** Bounded parent/dispatch ledger, outside leased repositories. No silent pruning. */
export class CoordinatorActionStore {
  private state: CoordinatorActionStateFile;
  private fingerprint: string | null;
  constructor(private readonly path: string) {
    const raw = this.read(); this.fingerprint = raw === null ? null : conversationDigest(raw);
    const value: unknown = raw === null ? { version: 1, revision: 0, actions: [], commands: [] } : JSON.parse(raw);
    if (!validCoordinatorActionState(value)) throw new Error('ADE-Auftragsspeicher ist ungültig. Original bleibt erhalten.');
    this.state = value;
  }
  snapshot(): CoordinatorActionStateFile { return structuredClone(this.state); }
  save(next: CoordinatorActionStateFile): void {
    if (!validCoordinatorActionState(next) || next.revision !== this.state.revision + 1) throw new Error('Ungültige ADE-Auftragsrevision.');
    const bytes = JSON.stringify(next);
    if (Buffer.byteLength(bytes) > COORDINATOR_ACTION_LIMIT) throw new Error('ADE-Auftragsspeicher hat sein Limit erreicht. Bestehende Aufträge bleiben erhalten.');
    const verify = () => { const raw = this.read(); if ((raw === null ? null : conversationDigest(raw)) !== this.fingerprint) throw new Error('ADE-Aufträge wurden ausserhalb dieser Instanz verändert. Neu starten und Stand prüfen.'); };
    verify(); assertNoLinks(dirname(this.path)); mkdirSync(dirname(this.path), { recursive: true }); assertNoLinks(dirname(this.path));
    const temp = `${this.path}.${randomUUID()}.tmp`; const fd = openSync(temp, 'wx', 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); verify(); renameSync(temp, this.path); }
    finally { closeSync(fd); if (existsSync(temp)) unlinkSync(temp); }
    this.fingerprint = conversationDigest(bytes); this.state = structuredClone(next);
  }
  private read(): string | null {
    assertNoLinks(this.path); if (!existsSync(this.path)) return null;
    const fd = openSync(this.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > COORDINATOR_ACTION_LIMIT) throw new Error('Unsicherer oder zu grosser ADE-Auftragsspeicher.');
      const bytes = Buffer.alloc(stat.size + 1); let length = 0;
      while (length < bytes.length) { const n = readSync(fd, bytes, length, bytes.length - length, null); if (!n) break; length += n; }
      const after = fstatSync(fd); assertNoLinks(this.path); const named = lstatSync(this.path);
      if (length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || named.dev !== stat.dev || named.ino !== stat.ino || named.nlink !== 1) throw new Error('ADE-Auftragsspeicher wurde beim Lesen verändert.');
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length));
    } finally { closeSync(fd); }
  }
}
