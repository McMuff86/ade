import { t as translate } from "../../shared/i18n";
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { Agent } from '../../shared/types';
import type { RunQuestionAnswers } from '../../shared/runQuestions';
import { redactedErrorDetail } from '../errors';
import { assertNoLinks } from '../repositories/pathDiscipline';
import { CodexDynamicTools, type CodexDynamicTool } from './CodexDynamicTools';
import { assertCoordinatorCodexConfig, assertCoordinatorCodexThread, assertCoordinatorCodexVersion, launchCoordinatorCodex } from './CoordinatorCodexPolicy';

export interface TaskProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(callback: (data: string) => void): { dispose(): void };
  onExit(callback: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
}
export interface CodexAppServerOptions {
  cwd: string;
  env: Record<string, string>;
  agent: Pick<Agent, 'permissionMode' | 'codexModel' | 'codexReasoningEffort'>;
  prompt: string;
  resultPath?: string;
  schemaPath?: string;
  /** An explicitly owned conversation stays alive between turns. Task mode remains one-shot. */
  conversation?: {
    resumeThreadId?: string;
    /** Main-owned coordinator policy; never inherited by project task mode. */
    coordinator?: true;
    tools?: CodexDynamicTool[];
    instructions?: string;
    ready(identity: CodexConversationIdentity): void;
    completed(result: CodexConversationResult): void;
  };
  question(questions: unknown, blocking: boolean, deliver: (answers: RunQuestionAnswers) => Promise<void>): { id: string; expire(): void };
  /** Test transport: production uses only the constant native Codex invocation. */
  launch?: () => ChildProcessWithoutNullStreams;
}
export interface CodexConversationIdentity { threadId: string; sessionId?: string; model?: string; reasoningEffort?: string }
export interface CodexConversationResult { threadId: string; turnId: string; status: 'completed' | 'interrupted'; text: string }
interface Pending { resolve(value: Record<string, unknown>): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
interface QuestionRequest { expire(): void; ack?: Pending }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, cap = 64 * 1024): string => typeof value === 'string' ? value.slice(0, cap) : '';
const MAX_FRAME = 2 * 1024 * 1024;

/** Native Codex transport. Task mode ends after one turn; explicit conversation
 * mode retains its thread and requires a fresh, serialized sendTurn per message. */
export class CodexAppServerProcess implements TaskProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: { exitCode: number }) => void>();
  private readonly pending = new Map<string, Pending>();
  private readonly questions = new Map<string, QuestionRequest>();
  private sequence = 0;
  private threadId = '';
  private turnId = '';
  private finalMessage = '';
  private usage: { input_tokens: number; output_tokens: number } | undefined;
  private ended: number | undefined;
  private notified = false;
  private received = '';
  private incoming: Promise<void> = Promise.resolve();
  private queuedBytes = 0;
  private turnActive = false;
  private readonly finishedTurns = new Set<string>();
  private readonly dynamicTools?: CodexDynamicTools;

  constructor(private readonly options: CodexAppServerOptions) {
    if (options.conversation) { if (!isAbsolute(options.cwd)) throw new Error(translate("Conversation needs an absolute workspace.")); assertNoLinks(options.cwd); }
    if (options.conversation?.tools) this.dynamicTools = new CodexDynamicTools(options.conversation.tools);
    if (options.conversation?.instructions && (options.conversation.instructions.length > 32 * 1024 || options.conversation.instructions.includes('\0'))) throw new Error(translate("Invalid ADE conversation instruction."));
    this.child = options.launch?.() ?? (options.conversation?.coordinator ? launchCoordinatorCodex(options.cwd, options.env) : process.platform === 'win32'
      ? spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '& codex app-server --listen stdio://'],
        { cwd: options.cwd, env: options.env, windowsHide: true, stdio: 'pipe' })
      : spawn('codex', ['app-server', '--listen', 'stdio://'], { cwd: options.cwd, env: options.env, stdio: 'pipe' }));
    this.child.stdout.setEncoding('utf8'); this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.received += chunk;
      if (Buffer.byteLength(this.received) > MAX_FRAME) { this.fail(new Error(translate("Codex protocol exceeds the message limit."))); return; }
      const frames = this.received.split('\n'); this.received = frames.pop()!;
      for (const frame of frames) {
        if (!frame.trim()) continue;
        const bytes = Buffer.byteLength(frame); this.queuedBytes += bytes;
        if (this.queuedBytes > 4 * MAX_FRAME) { this.fail(new Error(translate("Codex protocol overloads processing."))); return; }
        this.incoming = this.incoming.then(async () => { if (this.ended === undefined) await this.receive(JSON.parse(frame)); })
          .catch((error) => this.fail(error)).finally(() => { this.queuedBytes -= bytes; });
      }
    });
    this.child.stderr.on('data', (chunk: string) => this.emit({ type: 'error', message: redactedErrorDetail(chunk.slice(0, 8000)) }));
    this.child.on('error', (error) => this.fail(error));
    this.child.on('close', (code) => {
      void this.incoming.then(() => {
        if (this.ended === undefined) this.fail(new Error(translate("Codex connection ended before completion ({{value1}}).", { value1: code ?? translate("unknown") })));
        this.notifyExit();
      });
    });
    // Let PtyManager register lifecycle/output listeners before initialization.
    setImmediate(() => { void this.initialize().catch((error) => this.fail(error)); });
  }

  private async initialize(): Promise<void> {
    const initialized = await this.rpc('initialize', { clientInfo: { name: 'ade', title: 'ADE', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    const coordinator = this.options.conversation?.coordinator;
    if (coordinator) assertCoordinatorCodexVersion(initialized);
    this.send({ method: 'initialized' });
    if (coordinator) assertCoordinatorCodexConfig(await this.rpc('config/read', { cwd: this.options.cwd, includeLayers: false }));
    const resumeThreadId = this.options.conversation?.resumeThreadId;
    if (resumeThreadId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(resumeThreadId)) throw new Error(translate("Invalid Codex Conversation Identity."));
    if (resumeThreadId) {
      const previous = record((await this.rpc('thread/read', { threadId: resumeThreadId, includeTurns: false })).thread);
      if (previous.id !== resumeThreadId || typeof previous.cwd !== 'string' || relative(resolve(this.options.cwd), resolve(previous.cwd)) !== '') {
        throw new Error(translate("Saved Codex conversation does not belong to the expected workspace."));
      }
    }
    const thread = await this.rpc(resumeThreadId ? 'thread/resume' : 'thread/start', { cwd: this.options.cwd,
      ...(resumeThreadId ? { threadId: resumeThreadId } : {}),
      // 0.154's resume schema restores tools from its rollout; it does not
      // accept replacements. The owner must pin its tool contract per thread.
      ...(!resumeThreadId && this.dynamicTools ? { dynamicTools: this.dynamicTools.specifications } : {}),
      model: this.options.agent.codexModel || undefined, approvalPolicy: 'never',
      sandbox: coordinator ? 'read-only' : this.options.agent.permissionMode === 'bypass' ? 'danger-full-access' : this.options.agent.permissionMode === 'accept-edits' ? 'workspace-write' : 'read-only',
      config: { 'features.default_mode_request_user_input': true,
        ...(this.options.agent.codexReasoningEffort ? { model_reasoning_effort: this.options.agent.codexReasoningEffort } : {}),
        ...(!coordinator && this.options.schemaPath && this.options.agent.permissionMode === 'accept-edits'
          ? { 'sandbox_workspace_write.writable_roots': [dirname(this.options.schemaPath)] } : {}) },
      developerInstructions: ['When a decision or missing information is needed from the user, use request_user_input. ADE presents the question and delivers the user answer. Do not invent an answer or use shell stdin for questions.', this.options.conversation?.instructions].filter(Boolean).join('\n\n'),
    });
    if (coordinator) assertCoordinatorCodexThread(thread);
    this.threadId = text(record(thread.thread).id, 128);
    if (!this.threadId) throw new Error(translate("Codex did not provide a thread identity."));
    if (this.options.conversation) {
      const native = record(thread.thread); const cwd = text(native.cwd, 8192);
      if (resumeThreadId && this.threadId !== resumeThreadId || !cwd || relative(resolve(this.options.cwd), resolve(cwd)) !== '') {
        throw new Error(translate("Codex conversation is not part of the expected workspace."));
      }
      this.options.conversation.ready({ threadId: this.threadId, ...(typeof native.sessionId === 'string' ? { sessionId: text(native.sessionId, 128) } : {}),
        ...(typeof thread.model === 'string' ? { model: text(thread.model, 128) } : {}),
        ...(typeof thread.reasoningEffort === 'string' ? { reasoningEffort: text(thread.reasoningEffort, 32) } : {}) });
    }
    this.emit({ type: 'thread.started', thread_id: this.threadId });
    await this.startTurn(this.options.prompt);
  }

  /** No automatic replay: a failed acknowledgement leaves this process closed. */
  async sendTurn(prompt: string): Promise<{ threadId: string; turnId: string }> {
    if (!this.options.conversation) throw new Error(translate("This Codex task is not a resumable conversation."));
    return this.startTurn(prompt);
  }
  async interruptTurn(): Promise<void> {
    if (!this.options.conversation || !this.turnActive || !this.turnId || this.ended !== undefined) throw new Error(translate("No confirmed conversation step to interrupt."));
    try { await this.rpc('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }); }
    catch (error) { this.fail(error); throw error; }
  }
  private async startTurn(prompt: string): Promise<{ threadId: string; turnId: string }> {
    if (!this.threadId || this.ended !== undefined || this.turnActive) throw new Error(translate("Codex conversation is not ready for another message."));
    if (this.options.conversation && (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 64 * 1024 || prompt.includes('\0'))) throw new Error(translate("Invalid conversation message."));
    if (this.finishedTurns.size >= 512) throw new Error(translate("The conversation connection reached its message limit. Resume the conversation explicitly."));
    this.turnActive = true; this.turnId = ''; this.finalMessage = ''; this.usage = undefined;
    try {
      let outputSchema: unknown;
      if (this.options.schemaPath) { assertNoLinks(this.options.schemaPath); outputSchema = JSON.parse(readFileSync(this.options.schemaPath, 'utf8')); }
      const turn = await this.rpc('turn/start', { threadId: this.threadId,
      input: [{ type: 'text', text: prompt, text_elements: [] }],
      effort: this.options.agent.codexReasoningEffort || undefined, outputSchema });
      const id = text(record(turn.turn).id, 128);
      if (!id || this.finishedTurns.has(id) || this.turnId && this.turnId !== id) throw new Error(translate("Codex has confirmed a contradictory step in the conversation."));
      this.turnId = id;
      return { threadId: this.threadId, turnId: id };
    } catch (error) { this.fail(error); throw error; }
  }

  private rpc(method: string, params: unknown): Promise<Record<string, unknown>> {
    const id = `ade-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(translate("Codex does not confirm {{value1}}.", { value1: method }))); }, 30_000); timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch (error) { this.pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  private send(value: unknown): void {
    if (this.ended !== undefined || this.child.stdin.destroyed) throw new Error(translate("Codex connection is terminated."));
    this.child.stdin.write(`${JSON.stringify(value)}\n`, 'utf8', (error) => { if (error) this.fail(error); });
  }
  private async receive(value: unknown): Promise<void> {
    const message = record(value); const id = message.id;
    if (!message.method && (typeof id === 'string' || typeof id === 'number')) {
      const pending = this.pending.get(String(id)); if (!pending) return;
      this.pending.delete(String(id)); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(redactedErrorDetail(text(record(message.error).message, 2000))));
      else pending.resolve(record(message.result));
      return;
    }
    const method = message.method; const params = record(message.params);
    if (method === 'item/tool/call' && (typeof id === 'string' || typeof id === 'number') && this.dynamicTools) {
      const turnId = this.turnId;
      // Do not await inside the input queue: a tool may need a native RPC
      // acknowledgement (for example interruption) while it is running.
      void this.dynamicTools.request(id, params, { threadId: this.threadId, turnId, active: this.turnActive && this.ended === undefined })
        .then(result => { if (this.ended === undefined && this.turnActive && this.turnId === turnId) this.send({ id, result }); })
        .catch(error => this.fail(error));
      return;
    }
    if (method === 'serverRequest/resolved') {
      if (params.threadId !== this.threadId) return;
      const key = String(params.requestId); const question = this.questions.get(key); if (!question) return;
      if (question.ack) { clearTimeout(question.ack.timer); question.ack.resolve({}); }
      else question.expire();
      this.questions.delete(key); await Promise.resolve(); return;
    }
    if (id !== undefined && typeof method === 'string') {
      if (this.options.conversation && !this.turnActive || method !== 'item/tool/requestUserInput' || params.threadId !== this.threadId
        || this.turnId && params.turnId !== this.turnId || typeof params.isBlocking !== 'boolean') {
        this.send({ id, error: { code: -32601, message: translate("ADE does not support this server request.") } });
        throw new Error(translate("Codex requests an unsupported interaction."));
      }
      const key = String(id);
      if (this.questions.has(key)) throw new Error(translate("Codex query was sent twice."));
      const question: QuestionRequest = { expire: () => undefined };
      const registration = this.options.question(params.questions, params.isBlocking, (answers) => new Promise<void>((resolve, reject) => {
        if (this.questions.get(key) !== question || question.ack) { reject(new Error(translate("Codex question is no longer open."))); return; }
        const timer = setTimeout(() => { reject(new Error(translate("Codex did not confirm the answer."))); this.fail(new Error(translate("Response from Codex is missing."))); }, 15_000); timer.unref();
        question.ack = { resolve: () => resolve(), reject, timer };
        try { this.send({ id, result: { answers } }); } catch (error) { clearTimeout(timer); reject(error); }
      }));
      question.expire = registration.expire; this.questions.set(key, question);
      this.emit({ type: 'item.completed', item: { type: 'agent_message', id: `question-${registration.id}`, text: translate("Question is waiting for your answer in ADE.") } });
      return;
    }
    if (params.threadId && params.threadId !== this.threadId) return;
    if (this.options.conversation) {
      // Late and duplicate events cannot enter the next turn's answer.
      const eventTurn = text(params.turnId || record(params.turn).id, 128);
      if (!this.turnActive || eventTurn && (this.finishedTurns.has(eventTurn) || this.turnId && eventTurn !== this.turnId)) return;
      if (typeof method === 'string' && method.startsWith('item/') && !eventTurn) return;
      if ((method === 'turn/started' || method === 'turn/completed') && !eventTurn) throw new Error(translate("Codex event without conversation step."));
    }
    if (method === 'turn/started') { this.turnId = text(record(params.turn).id, 128); this.emit({ type: 'turn.started' }); }
    if (method === 'thread/tokenUsage/updated') {
      const usage = record(record(params.tokenUsage).total);
      if (typeof usage.inputTokens === 'number' && typeof usage.outputTokens === 'number' && Number.isSafeInteger(usage.inputTokens)
        && Number.isSafeInteger(usage.outputTokens) && usage.inputTokens >= 0 && usage.outputTokens >= 0) {
        this.usage = { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens };
      }
    }
    if (method === 'item/started' || method === 'item/completed') this.item(record(params.item), method === 'item/started');
    if (method === 'item/commandExecution/outputDelta') this.emit({ type: 'ade.tool_output', text: text(params.delta, 8000) });
    if (method === 'item/agentMessage/delta') this.emit({ type: 'ade.text_delta', itemId: text(params.itemId, 128), text: text(params.delta, 8000) });
    if (method === 'turn/plan/updated') this.emit({ type: 'ade.plan', text: text(params.explanation, 4000), steps: params.plan });
    if (method === 'turn/completed') {
      const turn = record(params.turn);
      if (turn.status !== 'completed' && !(this.options.conversation && turn.status === 'interrupted')) throw new Error(text(record(turn.error).message, 2000) || translate("Codex job was interrupted."));
      if (turn.status === 'completed' && this.dynamicTools?.pending(this.turnId)) throw new Error(translate("Codex has completed the conversation step before completing an ADE tool."));
      this.dynamicTools?.endTurn(this.turnId);
      if (this.questions.size) {
        if (this.options.conversation && turn.status === 'interrupted') {
          for (const question of this.questions.values()) { if (question.ack) { clearTimeout(question.ack.timer); question.ack.reject(new Error(translate("The conversation step was interrupted."))); } question.expire(); }
          this.questions.clear();
        } else throw new Error(translate("Codex has ended the job with an unconfirmed query."));
      }
      if (this.options.resultPath) {
        if (!this.finalMessage) throw new Error(translate("Codex did not provide a structured result."));
        assertNoLinks(this.options.resultPath); writeFileSync(this.options.resultPath, this.finalMessage, 'utf8');
      }
      this.emit({ type: turn.status === 'interrupted' ? 'ade.turn.interrupted' : 'turn.completed', ...(this.usage ? { usage: this.usage } : {}) });
      if (this.options.conversation) {
        const result: CodexConversationResult = { threadId: this.threadId, turnId: this.turnId, status: turn.status as 'completed' | 'interrupted', text: this.finalMessage };
        this.finishedTurns.add(this.turnId); this.turnActive = false;
        this.options.conversation.completed(result);
      } else this.finish(0);
    }
    if (method === 'error') this.emit({ type: 'error', message: redactedErrorDetail(text(record(params.error).message, 4000)) });
  }

  private item(item: Record<string, unknown>, started: boolean): void {
    if (this.options.conversation?.coordinator && ['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch', 'imageGeneration', 'computerUse'].includes(String(item.type))) {
      throw new Error(translate("Codex reports a native tool action outside of the tested ADE coordinator connection. Connection terminated; check status."));
    }
    const id = text(item.id, 128); let projected: Record<string, unknown> | undefined;
    if (item.type === 'agentMessage' && !started) {
      const message = text(item.text, MAX_FRAME);
      if (Buffer.byteLength(message) > 1024 * 1024) throw new Error(translate("Codex result exceeds the result limit."));
      this.finalMessage = message; projected = { type: 'agent_message', text: message };
    } else if (item.type === 'reasoning' && !started) {
      // Public reasoning summaries only. Raw reasoning content never enters ADE activity.
      projected = { type: 'reasoning', text: Array.isArray(item.summary) ? item.summary.filter((part) => typeof part === 'string').join('\n').slice(0, 8000) : '' };
    } else if (item.type === 'commandExecution') projected = { type: 'command_execution', command: redactedErrorDetail(text(item.command, 8000)),
      aggregated_output: redactedErrorDetail(text(item.aggregatedOutput, 8000)), exit_code: item.exitCode, status: item.status,
      accessText: (Array.isArray(item.commandActions) ? item.commandActions.slice(0, 10).map((action) => {
        const value = record(action); const path = this.accessPath(text(value.path, 1000));
        return `${value.type === 'read' ? translate("Read the file") : value.type === 'search' ? translate("Search") : value.type === 'listFiles' ? translate("List files") : translate("Run command")}${path ? `: ${path}` : ''}`;
      }).join(' · ') : '') || translate("Run command") };
    else if (item.type === 'fileChange') projected = { type: 'file_change', changes: Array.isArray(item.changes)
      ? item.changes.slice(0, 100).map((change) => ({ path: text(record(change).path, 1000), kind: record(change).kind })) : [], status: item.status,
      accessText: translate("Edit files: ") + (Array.isArray(item.changes) ? item.changes.slice(0, 10).map((change) => this.accessPath(text(record(change).path, 1000))).filter(Boolean).join(', ') : '') };
    else if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') projected = { type: 'mcp_tool_call', server: text(item.server, 100) || 'Tool', tool: text(item.tool, 200), status: item.status };
    else if (item.type === 'webSearch') projected = { type: 'web_search', query: text(item.query, 1000) };
    else if (item.type === 'plan') projected = { type: 'agent_message', text: text(item.text, 8000) };
    if (projected) this.emit({ type: started ? 'item.started' : 'item.completed', item: { id, ...projected } });
  }
  private accessPath(value: string): string {
    const path = isAbsolute(value) ? relative(this.options.cwd, value) : value;
    return path && !path.startsWith('..') && !isAbsolute(path) && !/[\r\n\0]/.test(path) ? path.replace(/\\/g, '/').slice(0, 500) : '';
  }
  private emit(value: unknown): void { if (this.ended === undefined) for (const callback of this.dataListeners) callback(`${JSON.stringify(value)}\n`); }
  private fail(error: unknown): void {
    if (this.ended !== undefined) return;
    this.emit({ type: 'turn.failed', error: { message: redactedErrorDetail(error) } }); this.finish(1);
  }
  private finish(exitCode: number): void {
    if (this.ended !== undefined) return;
    this.ended = exitCode;
    this.dynamicTools?.endTurn();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(translate("Codex connection terminated."))); } this.pending.clear();
    for (const question of this.questions.values()) { if (question.ack) { clearTimeout(question.ack.timer); question.ack.reject(new Error(translate("Codex connection terminated."))); } question.expire(); } this.questions.clear();
    if (this.child.exitCode === null && this.child.pid) {
      if (process.platform === 'win32') execFile('taskkill.exe', ['/pid', String(this.child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, (error) => { if (error) this.child.kill(); });
      else this.child.kill('SIGTERM');
    }
    if (!this.child.pid || this.child.exitCode !== null || this.child.signalCode !== null) this.notifyExit();
  }
  private notifyExit(): void {
    if (this.notified || this.ended === undefined) return;
    this.notified = true;
    for (const callback of this.exitListeners) callback({ exitCode: this.ended });
  }
  write(data: string): void { if (data.includes('\x03')) this.kill(); else throw new Error(translate("ade: Send answers in the query area.")); }
  resize(_cols: number, _rows: number): void { /* Structured task transport has no terminal geometry. */ }
  kill(): void { this.finish(130); }
  onData(callback: (data: string) => void): { dispose(): void } { this.dataListeners.add(callback); return { dispose: () => { this.dataListeners.delete(callback); } }; }
  onExit(callback: (event: { exitCode: number }) => void): { dispose(): void } { this.exitListeners.add(callback); return { dispose: () => { this.exitListeners.delete(callback); } }; }
}
