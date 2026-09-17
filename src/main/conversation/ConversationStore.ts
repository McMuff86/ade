import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { assertNoLinks } from '../repositories/pathDiscipline';
import { conversationId, conversationText, type ConversationTurnDetail } from '../../shared/conversation';
import { validRunQuestions } from '../../shared/runQuestions';
import { supervisionId } from '../../shared/supervision';

export interface ConversationBinding { profileId: string; authoritySha256: string; toolContract: string }
export interface StoredConversation {
  id: string; binding: ConversationBinding; closed: boolean; createdAt: number; updatedAt: number;
  nativeThreadId: string | null; model: string | null; reasoningEffort: string | null;
  turns: Array<ConversationTurnDetail & { nativeTurnId: string | null }>;
}
export interface ConversationState {
  version: 1; revision: number; conversations: StoredConversation[];
  commands: Array<{ id: string; sha256: string; conversationId: string; turnId: string | null }>;
}
export const conversationDigest = (text: string) => createHash('sha256').update(text).digest('hex');
export function conversationFingerprint(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, item]) => [k, canonical(item)])) : v;
  return conversationDigest(JSON.stringify(canonical(value)));
}
export const CONVERSATION_FILE_LIMIT = 8 * 1024 * 1024;
// Reserve room for a full answer, questions and diagnostics before dispatch.
export const CONVERSATION_PENDING_RESERVE = 1024 * 1024;
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const nativeId = (v: unknown) => v === null || typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const label = (v: unknown) => v === null || typeof v === 'string' && v.length <= 128 && !/[\0\r\n]/.test(v);
const unique = (ids: string[]) => new Set(ids).size === ids.length;
export function validConversationState(v: unknown): v is ConversationState {
  if (!exact(v, ['version', 'revision', 'conversations', 'commands']) || v.version !== 1 || !count(v.revision)
    || !Array.isArray(v.conversations) || v.conversations.length > 64 || !Array.isArray(v.commands) || v.commands.length > 8192) return false;
  if (!v.conversations.every(c => exact(c, ['id', 'binding', 'closed', 'createdAt', 'updatedAt', 'nativeThreadId', 'model', 'reasoningEffort', 'turns'])
    && conversationId(c.id) && exact(c.binding, ['profileId', 'authoritySha256', 'toolContract']) && supervisionId(c.binding.profileId)
    && digest(c.binding.authoritySha256) && supervisionId(c.binding.toolContract) && typeof c.closed === 'boolean'
    && count(c.createdAt) && count(c.updatedAt) && nativeId(c.nativeThreadId) && label(c.model) && label(c.reasoningEffort)
    && Array.isArray(c.turns) && c.turns.length <= 128 && c.turns.every(t => exact(t, ['id', 'input', 'output', 'status', 'error', 'createdAt', 'updatedAt', 'questions', 'nativeTurnId'])
      && conversationId(t.id) && conversationText(t.input) && !!t.input.trim() && conversationText(t.output) && typeof t.error === 'string' && t.error.length <= 2000
      && ['working', 'interrupting', 'completed', 'interrupted', 'uncertain'].includes(String(t.status)) && count(t.createdAt) && count(t.updatedAt)
      && validRunQuestions(t.questions) && Buffer.byteLength(JSON.stringify(t.questions)) <= 128 * 1024 && nativeId(t.nativeTurnId))
    && unique(c.turns.map(t => t.id)))) return false;
  const conversations = v.conversations as StoredConversation[];
  if (!unique(conversations.map(c => c.id))) return false;
  if (!unique(conversations.flatMap(c => c.nativeThreadId ? [c.nativeThreadId] : []))) return false;
  for (const c of conversations) {
    // A native transcript can only be extended after acknowledged completion.
    if (c.turns.slice(0, -1).some(t => !['completed', 'interrupted'].includes(t.status))) return false;
    if (c.turns.some(t => ['completed', 'interrupted'].includes(t.status) && (!c.nativeThreadId || !t.nativeTurnId))) return false;
    if (c.closed && c.turns.some(t => t.status === 'working' || t.status === 'interrupting')) return false;
  }
  return unique(v.commands.map(c => c?.id)) && v.commands.every(r => exact(r, ['id', 'sha256', 'conversationId', 'turnId']) && supervisionId(r.id) && digest(r.sha256)
    && conversations.some(c => c.id === r.conversationId && (r.turnId === null || c.turns.some(t => t.id === r.turnId))));
}
/** Explicit conversation history lives outside repositories and never resets on corruption. */
export class ConversationStore {
  private state: ConversationState;
  private fingerprint: string | null;
  constructor(private readonly path: string) {
    const raw = this.read(); this.fingerprint = raw === null ? null : conversationDigest(raw);
    const value: unknown = raw === null ? { version: 1, revision: 0, conversations: [], commands: [] } : JSON.parse(raw);
    if (!validConversationState(value)) throw new Error('ADE-Gesprächsspeicher ist ungültig. Original bleibt erhalten.');
    this.state = value;
  }
  snapshot(): ConversationState { return structuredClone(this.state); }
  save(next: ConversationState): void {
    if (!validConversationState(next) || next.revision !== this.state.revision + 1) throw new Error('Ungültige Gesprächsrevision.');
    const bytes = JSON.stringify(next);
    if (Buffer.byteLength(bytes) > CONVERSATION_FILE_LIMIT) throw new Error('ADE-Gesprächsspeicher hat sein Limit erreicht.');
    const verify = () => { const raw = this.read(); if ((raw === null ? null : conversationDigest(raw)) !== this.fingerprint) throw new Error('ADE-Gespräche wurden ausserhalb dieser Instanz verändert. Neu starten und Stand prüfen.'); };
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
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > CONVERSATION_FILE_LIMIT) throw new Error('Unsicherer oder zu grosser ADE-Gesprächsspeicher.');
      const bytes = Buffer.alloc(stat.size + 1); let length = 0;
      while (length < bytes.length) { const n = readSync(fd, bytes, length, bytes.length - length, null); if (!n) break; length += n; }
      const after = fstatSync(fd); assertNoLinks(this.path); const named = lstatSync(this.path);
      if (length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || named.dev !== stat.dev || named.ino !== stat.ino || named.nlink !== 1) throw new Error('ADE-Gesprächsspeicher wurde beim Lesen verändert.');
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length));
    } finally { closeSync(fd); }
  }
}
