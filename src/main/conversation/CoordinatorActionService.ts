import { t as translate } from "../../shared/i18n";
import { randomUUID } from 'node:crypto';
import type { AdeConfig, RunReport, RunTaskSubmission, RunTaskSubmitInput } from '../../shared/types';
import { validCoordinatorActionCommand, validCoordinatorActionInput, type CoordinatorActionCommand, type CoordinatorActionDetail, type CoordinatorActionInput, type CoordinatorActionReceipt, type CoordinatorActionSummary, type CoordinatorActionWork } from '../../shared/coordinatorActions';
import type { RunQuestionsView } from '../../shared/runQuestions';
import { redactedErrorMessage } from '../errors';
import type { SupervisionService } from '../supervision/SupervisionService';
import type { CodexToolContext } from '../pty/CodexDynamicTools';
import { conversationDigest, conversationFingerprint, type ConversationBinding } from './ConversationStore';
import { CoordinatorActionStore, type StoredCoordinatorAction } from './CoordinatorActionStore';

export interface CoordinatorActionSource { conversationId: string; turnId: string; binding: ConversationBinding }
export interface CoordinatorActionDependencies {
  config: { get(): AdeConfig }; supervision: SupervisionService;
  authorize(conversationId: string, binding: ConversationBinding, requireOpen: boolean): void;
  submit(input: RunTaskSubmitInput, authorize: () => void, reserved: (submission: RunTaskSubmission) => void): Promise<RunTaskSubmission>;
  report(runId: string): RunReport;
  questions(runId: string): RunQuestionsView;
  changed?(): void;
}
/** A model proposes bounded domain actions. Only a user's exact action ID can
 * confirm them. The durable parent and command key precede every side effect. */
export class CoordinatorActionService {
  private readonly inFlight = new Map<string, Promise<CoordinatorActionReceipt>>();
  constructor(private readonly store: CoordinatorActionStore, private readonly deps: CoordinatorActionDependencies, private readonly now = Date.now) {}
  private notify(): void {
    try { this.deps.changed?.(); } catch (error) { console.warn('[ade] coordinator action notification failed:', redactedErrorMessage(error)); }
  }
  private save(action: StoredCoordinatorAction, command?: CoordinatorActionCommand): void {
    const state = this.store.snapshot(); const index = state.actions.findIndex(a => a.id === action.id);
    if (index < 0) state.actions.push(action); else state.actions[index] = action;
    if (command && !state.commands.some(c => c.id === command.commandId)) {
      if (state.commands.length >= 1024) throw new Error(translate("ADE action receipts have reached their storage limit."));
      state.commands.push({ id: command.commandId, digest: conversationFingerprint(command), actionId: action.id });
    }
    state.revision++; this.store.save(state); this.notify();
  }
  private find(conversationId: string, actionId: string): StoredCoordinatorAction {
    const action = this.store.snapshot().actions.find(a => a.id === actionId && a.conversationId === conversationId);
    if (!action) throw new Error(translate("This job is not part of the chosen ADE conversation.")); return action;
  }
  private project(input: CoordinatorActionInput) {
    const project = this.deps.supervision.query().projects.find(p => p.id === input.projectId && p.available);
    if (!project) throw new Error(translate("Assisted project is not available."));
    if (input.kind === 'task' && project.mode !== 'coordinate') throw new Error(translate("For project jobs, set this project's ADE supervision mode to Coordinate and start a new conversation."));
    return project;
  }
  private worker(input: CoordinatorActionInput): string | null {
    if (input.kind !== 'task') return null;
    const agent = this.deps.config.get().agents.find(a => a.id === input.agentId);
    if (!agent || agent.runtime !== 'codex' || agent.customCommand?.trim() || agent.homeExecutionBackend && agent.homeExecutionBackend !== 'native'
      || !agent.codexModel || !agent.codexReasoningEffort) throw new Error(translate("Project job requires a native Codex profile with model and reasoning."));
    return conversationFingerprint(agent);
  }
  private authorize(action: StoredCoordinatorAction, requireOpen: boolean): void {
    this.deps.authorize(action.conversationId, action.binding, requireOpen);
    const project = this.project(action.input);
    const repo = this.deps.config.get().repositories.find(r => r.id === project.repositoryId && r.verified);
    if (project.repositoryId !== action.repositoryId || !repo || action.input.kind === 'task' && repo.executionBackend !== 'native'
      || this.worker(action.input) !== action.workerDigest) throw new Error(translate("Project or Codex profile has been changed. Prepare a new job."));
  }
  propose(input: unknown, source: CoordinatorActionSource, context: CodexToolContext): CoordinatorActionSummary {
    if (!validCoordinatorActionInput(input)) throw new Error(translate("Invalid ADE Action Proposal."));
    context.signal.throwIfAborted(); this.deps.authorize(source.conversationId, source.binding, true);
    const project = this.project(input); const workerDigest = this.worker(input);
    const sourceKey = conversationFingerprint({ conversationId: source.conversationId, turnId: source.turnId, thread: context.threadId, nativeTurn: context.turnId, call: context.callId });
    const sourceDigest = conversationFingerprint(input);
    const previous = this.store.snapshot().actions.find(a => a.sourceKey === sourceKey);
    if (previous) { if (previous.sourceDigest !== sourceDigest) throw new Error(translate("ADE tool call was repeated with altered content.")); return this.summary(previous); }
    if (this.store.snapshot().actions.length >= 256) throw new Error(translate("ADE job storage is full. Existing jobs are retained."));
    const id = randomUUID(); const action: StoredCoordinatorAction = { ...structuredClone(source), id, input: structuredClone(input), sourceKey, sourceDigest,
      repositoryId: project.repositoryId, workerDigest, state: 'proposed', createdAt: this.now(), updatedAt: this.now(), commandId: `coordinator:${id}`,
      handoffCommand: null, runId: null, taskId: null, error: '' };
    this.authorize(action, true); this.save(action); return this.summary(action);
  }
  /** Recovery only reads an existing command receipt; missing/pruned receipts
   * never authorize another launch, even after a crash before the native start. */
  private recovered(action: StoredCoordinatorAction): StoredCoordinatorAction {
    if (!['dispatching', 'uncertain'].includes(action.state)) return action;
    const unavailable = (): StoredCoordinatorAction => ({ ...action, state: 'uncertain', error: translate("Saved assignment receipt is no longer available or contradictory; nothing restarts.") });
    if (action.input.kind === 'handoff') {
      if (action.handoffCommand && this.deps.supervision.recall(action.handoffCommand)) return { ...action, state: 'applied', error: '' };
    } else {
      const config = this.deps.config.get(); const receipt = config.commandLog.find(c => c.commandId === action.commandId && c.channel === 'runTask:submit');
      if (receipt || action.runId && action.taskId) {
        let ref: { runId?: unknown; taskId?: unknown }; try { ref = action.runId ? { runId: action.runId, taskId: action.taskId } : JSON.parse(receipt!.resultJson); } catch { return unavailable(); }
        if (!ref || typeof ref !== 'object') return unavailable();
        const task = config.runTasks.find(t => t.id === ref.taskId && t.runId === ref.runId && t.repositoryId === action.repositoryId);
        const participant = task && config.runParticipants.find(p => p.id === task.participantId && p.runId === task.runId);
        if (!task || participant?.agentId !== action.input.agentId || task.prompt !== action.input.prompt.trim()) return unavailable();
        return { ...action, state: 'applied', runId: task.runId, taskId: task.id, error: '' };
      }
    }
    return this.inFlight.has(action.id) ? action : { ...action, state: 'uncertain', error: action.error || translate("Job execution not confirmed. Nothing restarts.") };
  }
  private summary(stored: StoredCoordinatorAction): CoordinatorActionSummary {
    const a = this.recovered(stored); const config = this.deps.config.get();
    const task = a.taskId ? config.runTasks.find(t => t.id === a.taskId && t.runId === a.runId) : undefined;
    const text = a.input.kind === 'task' ? a.input.prompt : a.input.text + '\n' + a.input.nextStep;
    return { id: a.id, conversationId: a.conversationId, turnId: a.turnId, kind: a.input.kind, projectId: a.input.projectId,
      projectName: config.repositories.find(r => r.id === a.repositoryId)?.name ?? translate("Unavailable project"),
      agentName: a.input.kind === 'task' ? config.agents.find(p => p.id === (a.input as { agentId: string }).agentId)?.name ?? translate("Removed profile") : null,
      state: a.state, createdAt: a.createdAt, updatedAt: a.updatedAt, content: { sha256: conversationDigest(text), chars: text.length },
      runId: a.runId, taskId: a.taskId, taskStatus: task?.status ?? null, pendingQuestions: task?.questions?.filter(q => q.status === 'pending' || q.status === 'answering').length ?? 0,
      error: redactedErrorMessage(a.error) };
  }
  list(conversationId: string): CoordinatorActionSummary[] { return this.store.snapshot().actions.filter(a => a.conversationId === conversationId).map(a => this.summary(a)); }
  detail(conversationId: string, actionId: string): CoordinatorActionDetail {
    const a = this.find(conversationId, actionId);
    return { action: this.summary(a), text: a.input.kind === 'handoff' ? a.input.text : null, nextStep: a.input.kind === 'handoff' ? a.input.nextStep : null };
  }
  work(conversationId: string, actionId: string): CoordinatorActionWork {
    const a = this.recovered(this.find(conversationId, actionId));
    if (a.input.kind !== 'task' || !a.runId || !a.taskId) throw new Error(translate("This job does not yet have a confirmed run."));
    const task = this.deps.report(a.runId).tasks.find(t => t.id === a.taskId);
    return { task: task ? { id: task.id, status: task.status, error: task.error ? redactedErrorMessage(task.error) : undefined, output: task.output, result: task.result } : null,
      questions: this.deps.questions(a.runId) };
  }
  /** The stored parent is the graph relation, so no fallible post-launch link
   * write can hide a child. This projection does not authorize execution. */
  links(projectId: string): Array<{ id: string; target: { kind: 'run'; id: string }; createdAt: number }> {
    return this.store.snapshot().actions.filter(a => a.input.projectId === projectId).map(a => this.recovered(a))
      .flatMap(a => a.runId ? [{ id: a.id, target: { kind: 'run' as const, id: a.runId }, createdAt: a.createdAt }] : []);
  }
  command(input: CoordinatorActionCommand, callerAuthorize: () => void = () => undefined): Promise<CoordinatorActionReceipt> {
    if (!validCoordinatorActionCommand(input)) return Promise.reject(new Error(translate("Invalid ADE action command.")));
    const receipt = this.store.snapshot().commands.find(c => c.id === input.commandId);
    if (receipt && receipt.digest !== conversationFingerprint(input)) return Promise.reject(new Error(translate("ADE action command was repeated with changed input.")));
    callerAuthorize(); const action = this.find(input.conversationId, input.actionId);
    const existing = this.inFlight.get(action.id);
    if (existing) {
      if (input.operation !== 'confirm') return Promise.reject(new Error(translate("This task is already being carried out.")));
      return existing.then(receipt => { callerAuthorize(); return { ...receipt, replayed: true }; });
    }
    // Set the lock before any asynchronous handler or launch can be entered.
    const execution = Promise.resolve().then(() => this.execute(input, callerAuthorize)).finally(() => this.inFlight.delete(action.id));
    this.inFlight.set(action.id, execution); return execution;
  }
  private async execute(input: CoordinatorActionCommand, callerAuthorize: () => void): Promise<CoordinatorActionReceipt> {
    const receipt = this.store.snapshot().commands.find(c => c.id === input.commandId);
    if (receipt && receipt.digest !== conversationFingerprint(input)) throw new Error(translate("ADE action command was repeated with changed input."));
    const stored = this.find(input.conversationId, input.actionId); let action = this.recovered(stored);
    callerAuthorize(); this.deps.authorize(action.conversationId, action.binding, false);
    if (action.state !== 'proposed') {
      if (input.operation === 'dismiss' && action.state !== 'dismissed' || input.operation === 'confirm' && action.state === 'dismissed') throw new Error(translate("This proposal has already been decided differently."));
      if (action.state === 'dispatching' || action.state === 'uncertain') throw new Error(translate("Execution remains unconfirmed. No automatic repetition."));
      this.save(action, input); return { actionId: action.id, state: action.state, replayed: true };
    }
    this.authorize(action, true);
    if (input.operation === 'dismiss') { action.state = 'dismissed'; action.updatedAt = this.now(); this.save(action, input); return { actionId: action.id, state: action.state, replayed: false }; }
    const authorize = () => { callerAuthorize(); this.authorize(action, false); };
    action.state = 'dispatching'; action.updatedAt = this.now();
    if (action.input.kind === 'handoff') action.handoffCommand = { operation: 'remember', commandId: action.commandId, revision: this.deps.supervision.query().revision,
      projectId: action.input.projectId, text: action.input.text, nextStep: action.input.nextStep, linkId: null };
    this.save(action, input);
    try {
      authorize();
      if (action.input.kind === 'handoff') this.deps.supervision.command(action.handoffCommand!);
      else {
        const submission = await this.deps.submit({ agentId: action.input.agentId, repositoryId: action.repositoryId, prompt: action.input.prompt,
          name: translate("Codex project job"), allowQuestions: true, commandId: action.commandId }, authorize, child => {
          action.runId = child.run.id; action.taskId = child.task.id; action.updatedAt = this.now(); this.save(action);
        });
        action.runId = submission.run.id; action.taskId = submission.task.id;
      }
      action.state = 'applied'; action.updatedAt = this.now(); this.save(action);
      return { actionId: action.id, state: action.state, replayed: false };
    } catch (error) {
      action = { ...action, state: 'uncertain', updatedAt: this.now(), error: redactedErrorMessage(error) };
      try { this.save(action); } catch (failure) { console.warn('[ade] coordinator dispatch receipt could not be saved:', redactedErrorMessage(failure)); }
      // The command receipt can still identify a child if the parent write
      // failed after launch. Query/recovery reads it without submitting again.
      throw error;
    }
  }
}
