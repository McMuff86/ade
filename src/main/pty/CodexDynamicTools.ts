import { createHash } from 'node:crypto';
import { redactedErrorDetail } from '../errors';

export interface CodexToolContext {
  threadId: string; turnId: string; callId: string; signal: AbortSignal;
}
export interface CodexDynamicTool {
  name: string; description: string; inputSchema: Record<string, unknown>;
  /** Validate arguments and current domain authority here, immediately before
   * each side effect. Abort is a cancellation signal, never a rollback claim. */
  invoke(arguments_: unknown, context: CodexToolContext): Promise<string>;
}
interface ToolResult { success: boolean; contentItems: Array<{ type: 'inputText'; text: string }> }
interface Call { fingerprint: string; turnId: string; abort: AbortController; result: Promise<ToolResult>; settled: boolean }
const result = (success: boolean, text: string): ToolResult => ({ success, contentItems: [{ type: 'inputText', text }] });
const identity = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,256}$/.test(v);
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
};

/** Per-process duplicate suppression and turn correlation. Durable command
 * idempotency belongs to the application service, including after restart. */
export class CodexDynamicTools {
  readonly specifications: Array<{ type: 'function'; name: string; description: string; inputSchema: Record<string, unknown> }>;
  private readonly handlers: Map<string, CodexDynamicTool>;
  private readonly calls = new Map<string, Call>();
  private readonly requests = new Map<string, string>();
  private cachedBytes = 0;
  constructor(tools: CodexDynamicTool[]) {
    if (tools.length > 32 || new Set(tools.map(t => t.name)).size !== tools.length || tools.some(t => !/^ade_[a-z0-9_]{1,60}$/.test(t.name)
      || !t.description || t.description.length > 2000 || !t.inputSchema || Array.isArray(t.inputSchema)
      || Buffer.byteLength(JSON.stringify(t.inputSchema)) > 64 * 1024)) throw new Error('Ungültige ADE-Werkzeugdefinition.');
    this.handlers = new Map(tools.map(t => [t.name, { ...t }]));
    this.specifications = tools.map(({ name, description, inputSchema }) => ({ type: 'function', name, description, inputSchema: structuredClone(inputSchema) }));
  }
  request(requestId: string | number, params: Record<string, unknown>, scope: { threadId: string; turnId: string; active: boolean }): Promise<ToolResult> {
    if (!scope.active || !scope.turnId || params.threadId !== scope.threadId || params.turnId !== scope.turnId
      || !identity(params.callId) || typeof params.tool !== 'string' || params.namespace != null || !Object.hasOwn(params, 'arguments')) {
      return Promise.resolve(result(false, 'Tool request does not belong to the active ADE conversation turn.'));
    }
    if (Buffer.byteLength(JSON.stringify(params.arguments)) > 64 * 1024) return Promise.resolve(result(false, 'Tool arguments exceed the ADE limit.'));
    const fingerprint = createHash('sha256').update(canonical(params)).digest('hex');
    const key = `${typeof requestId}:${requestId}`;
    const request = this.requests.get(key); const previous = this.calls.get(params.callId);
    if (request && request !== fingerprint || previous && previous.fingerprint !== fingerprint) throw new Error('Codex-Werkzeugaufruf wurde mit widersprüchlicher Identität wiederholt.');
    if (this.requests.size >= 2048 && !request) return Promise.resolve(result(false, 'ADE tool request limit reached.'));
    this.requests.set(key, fingerprint);
    if (previous) return previous.result;
    if (this.calls.size >= 512 || this.cachedBytes >= 2 * 1024 * 1024) return Promise.resolve(result(false, 'ADE tool connection limit reached. Resume the conversation explicitly.'));
    const handler = this.handlers.get(params.tool);
    if (!handler) return Promise.resolve(result(false, 'This tool is not registered for this ADE conversation.'));
    // Reserve the maximum result size before dispatch, including concurrent
    // calls, so delayed replies cannot grow the cache beyond two MiB.
    this.cachedBytes += 16 * 1024;
    const abort = new AbortController();
    const call: Call = { fingerprint, turnId: scope.turnId, abort, settled: false, result: Promise.resolve(result(false, 'Not started')) };
    this.calls.set(params.callId, call);
    const context: CodexToolContext = { threadId: scope.threadId, turnId: scope.turnId, callId: params.callId, signal: abort.signal };
    call.result = Promise.resolve().then(() => {
      context.signal.throwIfAborted();
      return handler.invoke(structuredClone(params.arguments), context);
    }).then(text => {
      if (typeof text !== 'string' || Buffer.byteLength(text) > 16 * 1024 || text.includes('\0')) throw new Error('ADE-Werkzeugergebnis ist ungültig oder zu gross. Aktion nicht automatisch wiederholen; Status prüfen.');
      return result(true, text);
    }).catch(error => result(false, redactedErrorDetail(error).slice(0, 2000)))
      .finally(() => { call.settled = true; });
    return call.result;
  }
  pending(turnId: string): boolean { return [...this.calls.values()].some(c => c.turnId === turnId && !c.settled); }
  endTurn(turnId?: string): void { for (const call of this.calls.values()) if (!turnId || call.turnId === turnId) call.abort.abort(); }
}
