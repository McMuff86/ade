import { t as translate } from "../../shared/i18n";
import { CASUAL_CONVERSATION_CONTRACT, type ConversationMode } from '../../shared/conversation';
import { randomUUID } from 'node:crypto';
import { conversationText, validConversationCommand, type ConversationAdmission, type ConversationCommand, type ConversationDetail, type ConversationReceipt, type ConversationSummary } from '../../shared/conversation';
import { validQuestionItems, type RunQuestionAnswers } from '../../shared/runQuestions';
import { redactedErrorMessage } from '../errors';
import type { CodexConversationIdentity, CodexConversationResult, TaskProcess } from '../pty/CodexAppServerProcess';
import { CONVERSATION_FILE_LIMIT, CONVERSATION_PENDING_RESERVE, ConversationStore, conversationDigest, conversationFingerprint, type ConversationBinding, type ConversationState, type StoredConversation } from './ConversationStore';

export interface ConversationProcess extends TaskProcess {
  sendTurn(text: string): Promise<{ threadId: string; turnId: string }>;
  interruptTurn(): Promise<void>;
}
export interface ConversationLaunch {
  id: string; binding: ConversationBinding; resumeThreadId?: string; prompt: string;
  ready(identity: CodexConversationIdentity): void;
  completed(result: CodexConversationResult): void;
  question(items: unknown, blocking: boolean, deliver: (answers: RunQuestionAnswers) => Promise<void>): { id: string; expire(): void };
}
export interface ConversationDependencies {
  /** Exact current profile, project authority and tool contract, owned by main. */
  binding(profileId: string, mode?: ConversationMode): ConversationBinding;
  launch(input: ConversationLaunch): ConversationProcess;
  changed?(): void;
}
interface Connection {
  process?: ConversationProcess; turnId: string | null; error: string;
  questions: Map<string, (answers: RunQuestionAnswers) => Promise<void>>;
}
const pending = (status: string) => status === 'working' || status === 'interrupting';
const nativeId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
const modeOf = (c: StoredConversation): ConversationMode => c.binding.toolContract === CASUAL_CONVERSATION_CONTRACT ? 'casual' : 'project';

/** Receipts reach disk before native dispatch. Uncertain delivery is never replayed. */
export class ConversationService {
  private readonly connections = new Map<string, Connection>();
  private readonly closing = new Set<Promise<void>>();
  private fault = '';
  private disposed = false;
  constructor(private readonly store: ConversationStore, private readonly deps: ConversationDependencies, private readonly now = Date.now) {
    const state = store.snapshot(); let recovered = false;
    for (const c of state.conversations) for (const t of c.turns) {
      if (pending(t.status)) { t.status = 'uncertain'; t.error = translate("ADE was terminated during this message. Check delivery; nothing will be sent again."); t.updatedAt = c.updatedAt = this.now(); recovered = true; }
      for (const q of t.questions) if (q.status === 'pending' || q.status === 'answering') { q.status = 'expired'; q.resolvedAt = this.now(); recovered = true; }
    }
    if (recovered) { state.revision++; store.save(state); }
  }
  private assertHealthy(): void {
    if (this.fault) throw new Error(this.fault);
    if (this.disposed) throw new Error(translate("The ADE conversation service is closed."));
  }
  private current(c: StoredConversation): boolean {
    try { return conversationFingerprint(this.deps.binding(c.binding.profileId, modeOf(c))) === conversationFingerprint(c.binding); } catch { return false; }
  }
  private editable(c: StoredConversation): void {
    if (c.closed) throw new Error(translate("This ADE conversation is closed. A new conversation begins."));
    if (!this.current(c)) throw new Error(translate("Profile or project rights have been changed. Start a new ADE conversation."));
  }
  private find(state: ConversationState, id: string): StoredConversation {
    const c = state.conversations.find(c => c.id === id); if (!c) throw new Error(translate("There is no ADE conversation.")); return c;
  }
  private save(state: ConversationState): void {
    try { state.revision++; this.store.save(state); }
    catch (error) {
      this.fault = redactedErrorMessage(error);
      const all = [...this.connections.values()]; this.connections.clear(); for (const c of all) c.process?.kill();
      throw new Error(this.fault);
    }
    try { this.deps.changed?.(); } catch (error) { console.warn('[ade] conversation notification failed:', redactedErrorMessage(error)); }
  }
  /** Main-only source identity for a tool proposal; never supplied by the model. */
  actionSource(id: string): { conversationId: string; turnId: string; binding: ConversationBinding } {
    this.assertHealthy(); const c = this.find(this.store.snapshot(), id); this.editable(c);
    if (modeOf(c) !== 'project') throw new Error(translate('Project actions are unavailable in casual conversations.'));
    const turn = c.turns.at(-1);
    if (!turn || turn.status !== 'working' || this.connections.get(id)?.turnId !== turn.id) throw new Error(translate("No active ADE talk step for this proposal."));
    return { conversationId: id, turnId: turn.id, binding: c.binding };
  }
  assertActionAuthority(id: string, binding: ConversationBinding, requireOpen: boolean): void {
    this.assertHealthy(); const c = this.find(this.store.snapshot(), id);
    if (modeOf(c) !== 'project') throw new Error(translate('Project actions are unavailable in casual conversations.'));
    if (!this.current(c) || conversationFingerprint(c.binding) !== conversationFingerprint(binding) || requireOpen && c.closed) throw new Error(translate("ADE talk or project scope is no longer valid for this job."));
  }
  query(): ConversationSummary[] {
    this.assertHealthy(); return this.store.snapshot().conversations.map(c => {
      const t = c.turns.at(-1); const answer = t?.output ?? '';
      return { id: c.id, mode: modeOf(c), profileId: c.binding.profileId, available: this.current(c), closed: c.closed, createdAt: c.createdAt, updatedAt: c.updatedAt,
        turns: c.turns.length, lastTurnId: t?.id ?? null, status: t?.status ?? 'ready',
        pendingQuestions: t?.questions.filter(q => q.status === 'pending').length ?? 0,
        lastAnswer: { sha256: conversationDigest(answer), chars: answer.length } };
    });
  }
  detail(id: string): ConversationDetail {
    this.assertHealthy(); const c = this.find(this.store.snapshot(), id);
    return { id: c.id, mode: modeOf(c), profileId: c.binding.profileId, closed: c.closed, available: this.current(c), model: c.model, reasoningEffort: c.reasoningEffort,
      turns: c.turns.map(({ nativeTurnId: _private, ...t }) => t) };
  }
  /** A recording belongs to this exact conversation authority, never a PTY.
   * Recheck the saved binding before every packet and private result read. */
  recordingTarget(id: string): (() => void) & { usage: { agentId: string } } {
    this.assertHealthy(); const original = this.find(this.store.snapshot(), id);
    const fingerprint = conversationFingerprint(original.binding);
    const check = () => {
      this.assertHealthy(); const current = this.find(this.store.snapshot(), id); this.editable(current);
      if (conversationFingerprint(current.binding) !== fingerprint || current.turns.at(-1)?.status === 'uncertain') throw new Error(translate("Discussion binding is no longer available for recording."));
    };
    check(); return Object.assign(check, { usage: { agentId: original.binding.profileId } });
  }
  /** Distinguish a confirmed refusal from a lost reply or a storage fault.
   * The synchronous command has finished before checking its durable receipt. */
  admit(input: ConversationCommand): ConversationAdmission {
    try { return { accepted: true, receipt: this.command(input) }; }
    catch (error) {
      const message = redactedErrorMessage(error);
      if (this.fault || this.disposed) return { accepted: false, uncertain: true, error: message };
      const receipt = this.store.snapshot().commands.find(c => c.id === input.commandId && c.sha256 === conversationFingerprint(input));
      if (receipt) return { accepted: true, receipt: { conversationId: receipt.conversationId, turnId: receipt.turnId, replayed: true } };
      return { accepted: false, uncertain: false, error: message };
    }
  }
  command(input: ConversationCommand): ConversationReceipt {
    this.assertHealthy(); if (!validConversationCommand(input)) throw new Error(translate("Invalid ADE conversation request."));
    const state = this.store.snapshot(); const sha256 = conversationFingerprint(input);
    const old = state.commands.find(r => r.id === input.commandId);
    if (old) { if (old.sha256 !== sha256) throw new Error(translate("The conversation request was repeated with different input.")); return { conversationId: old.conversationId, turnId: old.turnId, replayed: true }; }
    if (state.commands.length >= 8192) throw new Error(translate("Conversation receipts reached their storage limit. Existing histories are preserved."));
    let c: StoredConversation;
    if (input.operation === 'create') {
      if (state.conversations.length >= 64) throw new Error(translate("Store a maximum of 64 ADE conversations."));
      c = { id: randomUUID(), binding: this.deps.binding(input.profileId, input.mode ?? 'project'), closed: false, createdAt: this.now(), updatedAt: this.now(),
        nativeThreadId: null, model: null, reasoningEffort: null, turns: [] };
      if (c.binding.profileId !== input.profileId) throw new Error(translate("Profile binding does not match."));
      state.conversations.push(c);
    } else c = this.find(state, input.conversationId);
    let turnId: string | null = null;
    const connection = this.connections.get(c.id);
    let action: (() => void) | undefined;
    if (input.operation === 'send') {
      this.editable(c); const previous = c.turns.at(-1);
      if ((previous?.id ?? null) !== input.afterTurnId) throw new Error(translate("The conversation has continued. Load the current history."));
      if (previous && !['completed', 'interrupted'].includes(previous.status)) throw new Error(translate("Previous message is still open or unconfirmed; no re-delivery."));
      if (c.turns.length >= 128) throw new Error(translate("Conversation has reached its message limit. Start a new conversation."));
      if (!connection && this.closing.size >= 4) throw new Error(translate("Four ADE talks are connected or are still being ended, closing an unneeded conversation and waiting for its end."));
      turnId = randomUUID(); c.turns.push({ id: turnId, nativeTurnId: null, input: input.text, output: '', error: '', status: 'working', createdAt: this.now(), updatedAt: this.now(), questions: [] });
      const id = turnId; action = () => this.dispatch(c.id, id, input.text);
    } else if (input.operation === 'interrupt' || input.operation === 'answer') {
      const t = c.turns.at(-1); turnId = input.turnId;
      if (!t || t.id !== turnId || !pending(t.status) || !connection?.process || connection.turnId !== turnId) throw new Error(translate("The conversation step is no longer connected."));
      if (input.operation === 'interrupt') {
        if (t.status === 'interrupting') throw new Error(translate("Interruption is already waiting for confirmation."));
        t.status = 'interrupting';
        action = () => { void connection.process!.interruptTurn().catch(error => this.fail(c.id, connection, error)); };
      } else {
        this.editable(c);
        const q = t.questions.find(q => q.id === input.questionId); const deliver = connection.questions.get(input.questionId);
        if (!q || q.status !== 'pending' || !deliver) throw new Error(translate("Questioning is no longer open."));
        const ids = q.questions.map(q => q.id);
        if (Object.keys(input.answers).length !== ids.length || !ids.every(id => Object.hasOwn(input.answers, id))) throw new Error(translate("Answer is not exactly part of this query."));
        q.status = 'answering'; q.answerDigest = conversationFingerprint(input.answers);
        action = () => { void deliver(input.answers).then(() => this.answerAcknowledged(c.id, connection, input.questionId)).catch(error => this.fail(c.id, connection, error)); };
      }
      t.updatedAt = this.now();
    } else if (input.operation === 'close') {
      c.closed = true; const t = c.turns.at(-1);
      if (t && pending(t.status)) { t.status = 'uncertain'; t.error = translate("Conversation connection closed. The last step is unconfirmed."); t.updatedAt = this.now(); }
      if (t) for (const q of t.questions) if (q.status === 'pending' || q.status === 'answering') { q.status = 'expired'; q.resolvedAt = this.now(); }
      action = () => { this.connections.delete(c.id); connection?.process?.kill(); };
    }
    c.updatedAt = this.now();
    state.commands.push({ id: input.commandId, sha256, conversationId: c.id, turnId });
    // Leave enough disk space for every in-flight response. Refuse before effect,
    // without faulting the service or removing any existing conversation.
    const reserve = state.conversations.filter(c => pending(c.turns.at(-1)?.status ?? '')).length * CONVERSATION_PENDING_RESERVE;
    if ((input.operation === 'send' || input.operation === 'create') && Buffer.byteLength(JSON.stringify(state)) + reserve > CONVERSATION_FILE_LIMIT) throw new Error(translate("Not enough space for a complete conversation response. Existing histories are preserved."));
    this.save(state);
    try { action?.(); } catch (error) { const active = this.connections.get(c.id); if (active) this.fail(c.id, active, error); else throw error; }
    return { conversationId: c.id, turnId, replayed: false };
  }
  private live(id: string, connection: Connection): boolean { return !this.disposed && !this.fault && this.connections.get(id) === connection; }
  private dispatch(id: string, turnId: string, prompt: string): void {
    const selected = this.find(this.store.snapshot(), id);
    let connection = this.connections.get(id);
    if (connection) {
      connection.turnId = turnId; connection.error = ''; connection.questions.clear();
      this.editable(selected);
      const current = connection;
      void connection.process!.sendTurn(prompt).catch(error => this.fail(id, current, error)); return;
    }
    connection = { turnId, error: '', questions: new Map() }; this.connections.set(id, connection); const current = connection;
    try {
      const c = selected; this.editable(c);
      const process = this.deps.launch({ id, binding: c.binding, prompt, ...(c.nativeThreadId ? { resumeThreadId: c.nativeThreadId } : {}),
        ready: identity => this.ready(id, current, identity), completed: result => this.completed(id, current, result),
        question: (items, blocking, deliver) => this.question(id, current, items, blocking, deliver) });
      current.process = process;
      let closed!: () => void;
      const exit = new Promise<void>(resolve => { closed = resolve; }); this.closing.add(exit);
      process.onExit(() => {
        this.closing.delete(exit); closed();
        if (!this.live(id, current)) return;
        if (current.turnId) this.fail(id, current, new Error(current.error || translate("Call without confirmation of completion terminated.")));
        else this.connections.delete(id);
      });
      if (!this.live(id, current)) { process.kill(); return; }
      process.onData(data => {
        if (!this.live(id, current)) return;
        try { const event = JSON.parse(data); if (event.type === 'turn.failed') current.error = redactedErrorMessage(event.error?.message ?? translate("The conversational connection failed.")); } catch { /* Non-JSON output is not a result. */ }
      });
    } catch (error) { this.fail(id, current, error); }
  }
  private ready(id: string, connection: Connection, identity: CodexConversationIdentity): void {
    if (!this.live(id, connection)) return;
    const state = this.store.snapshot(); const c = this.find(state, id); this.editable(c);
    if (!nativeId(identity.threadId) || c.nativeThreadId && c.nativeThreadId !== identity.threadId
      || state.conversations.some(other => other.id !== id && other.nativeThreadId === identity.threadId)) throw new Error(translate("Native conversational identity is not clearly assigned to this ADE conversation."));
    c.nativeThreadId = identity.threadId; c.model = identity.model ?? null; c.reasoningEffort = identity.reasoningEffort ?? null; this.save(state);
  }
  private completed(id: string, connection: Connection, result: CodexConversationResult): void {
    if (!this.live(id, connection) || !connection.turnId) return;
    const state = this.store.snapshot(); const c = this.find(state, id); const t = c.turns.at(-1)!;
    if (result.threadId !== c.nativeThreadId || !nativeId(result.turnId) || t.id !== connection.turnId
      || c.turns.slice(0, -1).some(previous => previous.nativeTurnId === result.turnId)
      || !['completed', 'interrupted'].includes(result.status) || !conversationText(result.text)) throw new Error(translate("Invalid or too large an ADE-conversation response."));
    if (result.status === 'completed' && t.questions.some(q => q.status === 'pending' || q.status === 'answering')) throw new Error(translate("Response has unconfirmed questions."));
    t.nativeTurnId = result.turnId; t.status = result.status; t.output = result.text; t.updatedAt = c.updatedAt = this.now();
    for (const q of t.questions) if (q.status === 'pending' || q.status === 'answering') { q.status = 'expired'; q.resolvedAt = this.now(); }
    this.save(state); connection.turnId = null; connection.questions.clear();
  }
  private question(id: string, connection: Connection, items: unknown, blocking: boolean, deliver: (answers: RunQuestionAnswers) => Promise<void>) {
    if (!this.live(id, connection) || !connection.turnId || !validQuestionItems(items) || typeof blocking !== 'boolean') throw new Error(translate("Invalid ADE follow-up question."));
    const state = this.store.snapshot(); const c = this.find(state, id); this.editable(c); const t = c.turns.at(-1)!;
    if (t.id !== connection.turnId || t.questions.length >= 20) throw new Error(translate("ADE query does not fit the open step."));
    const questionId = randomUUID(); t.questions.push({ id: questionId, questions: structuredClone(items), blocking, status: 'pending', createdAt: this.now() });
    if (Buffer.byteLength(JSON.stringify(t.questions)) > 128 * 1024) throw new Error(translate("ADE queries exceed the content limit."));
    t.updatedAt = c.updatedAt = this.now(); this.save(state); connection.questions.set(questionId, deliver);
    return { id: questionId, expire: () => {
      if (!this.live(id, connection)) return;
      const state = this.store.snapshot(); const c = this.find(state, id); const q = c.turns.at(-1)?.questions.find(q => q.id === questionId);
      if (q && (q.status === 'pending' || q.status === 'answering')) { q.status = 'expired'; q.resolvedAt = this.now(); this.save(state); }
      connection.questions.delete(questionId);
    } };
  }
  private answerAcknowledged(id: string, connection: Connection, questionId: string): void {
    if (!this.live(id, connection)) return;
    const state = this.store.snapshot(); const c = this.find(state, id); const q = c.turns.at(-1)?.questions.find(q => q.id === questionId);
    if (!q || q.status !== 'answering') return;
    q.status = 'answered'; q.resolvedAt = this.now(); c.updatedAt = this.now(); this.save(state); connection.questions.delete(questionId);
  }
  private fail(id: string, connection: Connection, error: unknown): void {
    if (!this.live(id, connection)) return;
    this.connections.delete(id); connection.process?.kill();
    const state = this.store.snapshot(); const c = this.find(state, id); const t = c.turns.at(-1);
    if (!t || t.id !== connection.turnId || !pending(t.status)) return;
    t.status = 'uncertain'; t.error = redactedErrorMessage(error); t.updatedAt = c.updatedAt = this.now();
    for (const q of t.questions) if (q.status === 'pending' || q.status === 'answering') { q.status = 'expired'; q.resolvedAt = this.now(); }
    try { this.save(state); } catch (failure) { console.warn('[ade] conversation failure could not be persisted:', redactedErrorMessage(failure)); }
  }
  dispose(): void {
    if (this.disposed) return;
    for (const [id, c] of [...this.connections]) { if (c.turnId) this.fail(id, c, new Error(translate("ADE was terminated during the message. No automatic repetition."))); else { this.connections.delete(id); c.process?.kill(); } }
    this.disposed = true;
  }
  /** App exit and native probes wait for actual child close, not an assumed delay. */
  async shutdown(): Promise<void> {
    this.dispose(); if (!this.closing.size) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([Promise.all([...this.closing]), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(translate("ADE talks have not confirmed their end."))), 10_000);
    })]); } finally { if (timer) clearTimeout(timer); }
  }
}
