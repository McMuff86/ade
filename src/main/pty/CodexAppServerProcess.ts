import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative } from 'node:path';
import type { Agent } from '../../shared/types';
import type { RunQuestionAnswers } from '../../shared/runQuestions';
import { redactedErrorDetail } from '../errors';
import { assertNoLinks } from '../repositories/pathDiscipline';

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
  question(questions: unknown, blocking: boolean, deliver: (answers: RunQuestionAnswers) => Promise<void>): { id: string; expire(): void };
  /** Test transport: production uses only the constant native Codex invocation. */
  launch?: () => ChildProcessWithoutNullStreams;
}
interface Pending { resolve(value: Record<string, unknown>): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
interface QuestionRequest { expire(): void; ack?: Pending }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, cap = 64 * 1024): string => typeof value === 'string' ? value.slice(0, cap) : '';
const MAX_FRAME = 2 * 1024 * 1024;

/** One native Codex thread/turn. Only projected notifications become task output. */
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

  constructor(private readonly options: CodexAppServerOptions) {
    this.child = options.launch?.() ?? (process.platform === 'win32'
      ? spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '& codex app-server --listen stdio://'],
        { cwd: options.cwd, env: options.env, windowsHide: true, stdio: 'pipe' })
      : spawn('codex', ['app-server', '--listen', 'stdio://'], { cwd: options.cwd, env: options.env, stdio: 'pipe' }));
    this.child.stdout.setEncoding('utf8'); this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.received += chunk;
      if (Buffer.byteLength(this.received) > MAX_FRAME) { this.fail(new Error('Codex-Protokoll überschreitet das Nachrichtenlimit.')); return; }
      const frames = this.received.split('\n'); this.received = frames.pop()!;
      for (const frame of frames) {
        if (!frame.trim()) continue;
        const bytes = Buffer.byteLength(frame); this.queuedBytes += bytes;
        if (this.queuedBytes > 4 * MAX_FRAME) { this.fail(new Error('Codex-Protokoll überlastet die Verarbeitung.')); return; }
        this.incoming = this.incoming.then(async () => { if (this.ended === undefined) await this.receive(JSON.parse(frame)); })
          .catch((error) => this.fail(error)).finally(() => { this.queuedBytes -= bytes; });
      }
    });
    this.child.stderr.on('data', (chunk: string) => this.emit({ type: 'error', message: redactedErrorDetail(chunk.slice(0, 8000)) }));
    this.child.on('error', (error) => this.fail(error));
    this.child.on('close', (code) => {
      void this.incoming.then(() => {
        if (this.ended === undefined) this.fail(new Error(`Codex-Verbindung vor Abschluss beendet (${code ?? 'unbekannt'}).`));
        this.notifyExit();
      });
    });
    // Let PtyManager register lifecycle/output listeners before initialization.
    setImmediate(() => { void this.initialize().catch((error) => this.fail(error)); });
  }

  private async initialize(): Promise<void> {
    await this.rpc('initialize', { clientInfo: { name: 'ade', title: 'ADE', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized' });
    const thread = await this.rpc('thread/start', { cwd: this.options.cwd,
      model: this.options.agent.codexModel || undefined, approvalPolicy: 'never',
      sandbox: this.options.agent.permissionMode === 'bypass' ? 'danger-full-access' : this.options.agent.permissionMode === 'accept-edits' ? 'workspace-write' : 'read-only',
      config: { 'features.default_mode_request_user_input': true,
        ...(this.options.schemaPath && this.options.agent.permissionMode === 'accept-edits'
          ? { 'sandbox_workspace_write.writable_roots': [dirname(this.options.schemaPath)] } : {}) },
      developerInstructions: 'When a decision or missing information is needed from the user, use request_user_input. ADE presents the question and delivers the user answer. Do not invent an answer or use shell stdin for questions.',
    });
    this.threadId = text(record(thread.thread).id, 128);
    if (!this.threadId) throw new Error('Codex hat keine Thread-Identität geliefert.');
    this.emit({ type: 'thread.started', thread_id: this.threadId });
    let outputSchema: unknown;
    if (this.options.schemaPath) { assertNoLinks(this.options.schemaPath); outputSchema = JSON.parse(readFileSync(this.options.schemaPath, 'utf8')); }
    const turn = await this.rpc('turn/start', { threadId: this.threadId,
      input: [{ type: 'text', text: this.options.prompt, text_elements: [] }],
      effort: this.options.agent.codexReasoningEffort || undefined, outputSchema });
    this.turnId = text(record(turn.turn).id, 128);
  }

  private rpc(method: string, params: unknown): Promise<Record<string, unknown>> {
    const id = `ade-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex bestätigt ${method} nicht.`)); }, 30_000); timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch (error) { this.pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  private send(value: unknown): void {
    if (this.ended !== undefined || this.child.stdin.destroyed) throw new Error('Codex-Verbindung ist beendet.');
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
    if (method === 'serverRequest/resolved') {
      if (params.threadId !== this.threadId) return;
      const key = String(params.requestId); const question = this.questions.get(key); if (!question) return;
      if (question.ack) { clearTimeout(question.ack.timer); question.ack.resolve({}); }
      else question.expire();
      this.questions.delete(key); await Promise.resolve(); return;
    }
    if (id !== undefined && typeof method === 'string') {
      if (method !== 'item/tool/requestUserInput' || params.threadId !== this.threadId
        || this.turnId && params.turnId !== this.turnId || typeof params.isBlocking !== 'boolean') {
        this.send({ id, error: { code: -32601, message: 'ADE does not support this server request.' } });
        throw new Error('Codex fordert eine nicht unterstützte Interaktion an.');
      }
      const key = String(id);
      if (this.questions.has(key)) throw new Error('Codex-Rückfrage wurde doppelt gesendet.');
      const question: QuestionRequest = { expire: () => undefined };
      const registration = this.options.question(params.questions, params.isBlocking, (answers) => new Promise<void>((resolve, reject) => {
        if (this.questions.get(key) !== question || question.ack) { reject(new Error('Codex-Rückfrage ist nicht mehr offen.')); return; }
        const timer = setTimeout(() => { reject(new Error('Codex hat die Antwort nicht bestätigt.')); this.fail(new Error('Antwortbestätigung von Codex fehlt.')); }, 15_000); timer.unref();
        question.ack = { resolve: () => resolve(), reject, timer };
        try { this.send({ id, result: { answers } }); } catch (error) { clearTimeout(timer); reject(error); }
      }));
      question.expire = registration.expire; this.questions.set(key, question);
      this.emit({ type: 'item.completed', item: { type: 'agent_message', id: `question-${registration.id}`, text: 'Rückfrage wartet auf deine Antwort in ADE.' } });
      return;
    }
    if (params.threadId && params.threadId !== this.threadId) return;
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
      if (turn.status !== 'completed') throw new Error(text(record(turn.error).message, 2000) || 'Codex-Auftrag wurde unterbrochen.');
      if (this.questions.size) throw new Error('Codex hat den Auftrag mit einer unbestätigten Rückfrage beendet.');
      if (this.options.resultPath) {
        if (!this.finalMessage) throw new Error('Codex hat kein strukturiertes Ergebnis geliefert.');
        assertNoLinks(this.options.resultPath); writeFileSync(this.options.resultPath, this.finalMessage, 'utf8');
      }
      this.emit({ type: 'turn.completed', ...(this.usage ? { usage: this.usage } : {}) }); this.finish(0);
    }
    if (method === 'error') this.emit({ type: 'error', message: redactedErrorDetail(text(record(params.error).message, 4000)) });
  }

  private item(item: Record<string, unknown>, started: boolean): void {
    const id = text(item.id, 128); let projected: Record<string, unknown> | undefined;
    if (item.type === 'agentMessage' && !started) {
      const message = text(item.text, MAX_FRAME);
      if (Buffer.byteLength(message) > 1024 * 1024) throw new Error('Codex-Ergebnis überschreitet das Ergebnislimit.');
      this.finalMessage = message; projected = { type: 'agent_message', text: message };
    } else if (item.type === 'reasoning' && !started) {
      // Public reasoning summaries only. Raw reasoning content never enters ADE activity.
      projected = { type: 'reasoning', text: Array.isArray(item.summary) ? item.summary.filter((part) => typeof part === 'string').join('\n').slice(0, 8000) : '' };
    } else if (item.type === 'commandExecution') projected = { type: 'command_execution', command: redactedErrorDetail(text(item.command, 8000)),
      aggregated_output: redactedErrorDetail(text(item.aggregatedOutput, 8000)), exit_code: item.exitCode, status: item.status,
      accessText: (Array.isArray(item.commandActions) ? item.commandActions.slice(0, 10).map((action) => {
        const value = record(action); const path = this.accessPath(text(value.path, 1000));
        return `${value.type === 'read' ? 'Datei lesen' : value.type === 'search' ? 'Suchen' : value.type === 'listFiles' ? 'Dateien auflisten' : 'Befehl ausführen'}${path ? `: ${path}` : ''}`;
      }).join(' · ') : '') || 'Befehl ausführen' };
    else if (item.type === 'fileChange') projected = { type: 'file_change', changes: Array.isArray(item.changes)
      ? item.changes.slice(0, 100).map((change) => ({ path: text(record(change).path, 1000), kind: record(change).kind })) : [], status: item.status,
      accessText: 'Dateien bearbeiten: ' + (Array.isArray(item.changes) ? item.changes.slice(0, 10).map((change) => this.accessPath(text(record(change).path, 1000))).filter(Boolean).join(', ') : '') };
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
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Codex-Verbindung beendet.')); } this.pending.clear();
    for (const question of this.questions.values()) { if (question.ack) { clearTimeout(question.ack.timer); question.ack.reject(new Error('Codex-Verbindung beendet.')); } question.expire(); } this.questions.clear();
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
  write(data: string): void { if (data.includes('\x03')) this.kill(); else throw new Error('ade: Antworten im Rückfragenbereich senden.'); }
  resize(_cols: number, _rows: number): void { /* Structured task transport has no terminal geometry. */ }
  kill(): void { this.finish(130); }
  onData(callback: (data: string) => void): { dispose(): void } { this.dataListeners.add(callback); return { dispose: () => { this.dataListeners.delete(callback); } }; }
  onExit(callback: (event: { exitCode: number }) => void): { dispose(): void } { this.exitListeners.add(callback); return { dispose: () => { this.exitListeners.delete(callback); } }; }
}
