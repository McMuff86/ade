import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { homedir } from 'node:os';
import { isAbsolute } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { normalizeExecutionBackendId, type ExecutionBackendId } from '../../shared/executionBackends';
import { CLAUDE_MODEL_PATTERN, CODEX_MODEL_PATTERN, OLLAMA_MODEL_PATTERN } from '../../shared/runtimes';
import { MODEL_RUNTIMES, type ModelRuntime, type RuntimeModelCatalog, type RuntimeModelOption, type RuntimeModelRequest } from '../../shared/runtimeModels';
import type { CodexReasoningEffort } from '../../shared/types';
import { redactForWire } from '../errors';
import { ExecutionBackendService } from '../execution/ExecutionBackendService';

const MAX_BYTES = 1024 * 1024;
const MAX_MODELS = 200;
const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const ANSI = /\x1B\[[0-?]*[ -/]*[@-~]/g;
/** C-runtime argument quoting inside a fixed cmd.exe /s /c invocation. */
function windowsArgument(value: string): string {
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}
function stopProbe(child: ChildProcessWithoutNullStreams): void {
  child.stdin.end();
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => { child.kill(); });
  } else child.kill();
}
function collectProbe(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    let done = false; let text = ''; let bytes = 0; const decoder = new StringDecoder('utf8');
    const finish = (error?: string) => {
      if (done) return; done = true; clearTimeout(timer); stopProbe(child);
      if (error) reject(new Error(error)); else resolve(text + decoder.end());
    };
    const timer = setTimeout(() => finish('cli_timeout'), 5000);
    child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_BYTES) finish('catalog_limit'); else text += decoder.write(chunk); });
    child.stderr.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_BYTES) finish('catalog_limit'); });
    child.once('error', () => finish('cli_failed')); child.once('close', (code) => finish(code === 0 ? undefined : 'authentication_required'));
    child.stdin.on('error', () => undefined); child.stdin.end();
  });
}
type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
function clean(value: unknown, limit: number): string | undefined {
  return typeof value === 'string' ? redactForWire(value.replace(ANSI, ''), limit).replace(/[\x00-\x1f\x7f]/g, ' ').trim() || undefined : undefined;
}
function modelId(value: unknown, runtime: ModelRuntime): value is string {
  const pattern = runtime === 'claude' ? CLAUDE_MODEL_PATTERN : runtime === 'ollama' ? OLLAMA_MODEL_PATTERN : CODEX_MODEL_PATTERN;
  return typeof value === 'string' && pattern.test(value) && redactForWire(value, 250) === value;
}
export function parseRuntimeModels(runtime: ModelRuntime, value: unknown): RuntimeModelOption[] {
  let rows: unknown[];
  if (runtime === 'grok') {
    if (typeof value !== 'string' || !/^Available models:\s*$/m.test(value.replace(ANSI, '').replace(/\r/g, ''))) throw new Error('invalid_catalog');
    rows = value.replace(ANSI, '').split(/\r?\n/).map((line) => {
      const match = /^\s*[-*]\s+([A-Za-z0-9][A-Za-z0-9._:/-]{0,99})(?:\s+\(default\))?\s*$/.exec(line);
      return match ? { id: match[1], isDefault: /\(default\)/.test(line) } : null;
    }).filter(Boolean);
  } else if (runtime === 'ollama') {
    if (typeof value !== 'string') throw new Error('invalid_catalog');
    const lines = value.replace(ANSI, '').split(/\r?\n/);
    if (!/^NAME\s+ID\s+SIZE\s+MODIFIED\s*$/.test(lines.shift()?.trim() ?? '')) throw new Error('invalid_catalog');
    rows = lines.filter((line) => line.trim()).map((line) => ({ id: line.trim().split(/\s+/)[0] }));
  } else {
    if (!Array.isArray(value)) throw new Error('invalid_catalog');
    rows = value;
  }
  if (rows.length > MAX_MODELS) throw new Error('catalog_limit');
  const models = new Map<string, RuntimeModelOption>();
  for (const value of rows) {
    const row = object(value); const id = runtime === 'claude' ? row.value : row.model ?? row.id;
    if (row.hidden === true) continue;
    if (!modelId(id, runtime)) throw new Error('invalid_model');
    const rawEfforts = row.supportedReasoningEfforts;
    const efforts = Array.isArray(rawEfforts) ? rawEfforts.map((entry) => object(entry).reasoningEffort)
      .filter((effort): effort is CodexReasoningEffort => typeof effort === 'string' && EFFORTS.has(effort)) : undefined;
    const defaultEffort = typeof row.defaultReasoningEffort === 'string' && efforts?.includes(row.defaultReasoningEffort as CodexReasoningEffort)
      ? row.defaultReasoningEffort as CodexReasoningEffort : undefined;
    models.set(id, { id, name: clean(row.displayName, 150) ?? id, isDefault: row.isDefault === true || runtime === 'claude' && id === 'default',
      ...(clean(row.description, 350) ? { description: clean(row.description, 350) } : {}),
      ...(modelId(row.resolvedModel, runtime) ? { resolvedModel: row.resolvedModel } : {}),
      ...(efforts ? { reasoningEfforts: [...new Set(efforts)] } : {}), ...(defaultEffort ? { defaultReasoningEffort: defaultEffort } : {}) });
  }
  return [...models.values()];
}

export interface ModelProbeTransport {
  run(runtime: ModelRuntime, backend: ExecutionBackendId, env: Record<string, string>): Promise<RuntimeModelOption[]>;
}

/** Only fixed discovery commands. No user prompts, sessions, model inference or renderer-supplied argv. */
export class CliModelProbe implements ModelProbeTransport {
  constructor(private readonly execution = new ExecutionBackendService(), private readonly spawnProcess = spawn,
    private readonly platform = process.platform, private readonly timeoutMs = 20_000) {}

  async run(runtime: ModelRuntime, backend: ExecutionBackendId, env: Record<string, string>): Promise<RuntimeModelOption[]> {
    const windows = backend === 'native' && this.platform === 'win32';
    const location = await this.execution.run(backend, windows ? 'where.exe' : '/bin/bash', windows ? [runtime]
      : ['-lc', `command -v ${runtime}`], { timeoutMs: 4000, maxBuffer: 16 * 1024 });
    if (location.code !== 0 || location.timedOut) throw new Error('cli_missing');
    const paths = location.stdout.toString('utf8').trim().split(/\r?\n/);
    const executable = windows ? paths.find((path) => /\.(exe|cmd|bat)$/i.test(path)) : paths[0];
    if (!executable || (windows ? !isAbsolute(executable) : !executable.startsWith('/'))) throw new Error('cli_missing');
    const cwd = backend === 'native' ? homedir() : (await this.execution.text(backend, '/bin/bash', ['-lc', 'printf %s "$HOME"'], { timeoutMs: 4000, maxBuffer: 4096 })).trim();
    const args = runtime === 'codex' ? ['app-server'] : runtime === 'grok' ? ['models'] : runtime === 'ollama' ? ['list']
      : ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
        '--strict-mcp-config', '--tools', '', '--settings', '{"disableAllHooks":true}'];
    const environment = { ...env, NO_COLOR: '1', FORCE_COLOR: '0', DISABLE_AUTOUPDATER: '1' };
    // npm's Windows shims need cmd.exe. Only the locator's absolute path is inserted;
    // reject shell metacharacters, and keep the command/arguments fixed by runtime.
    const shim = windows && /\.(cmd|bat)$/i.test(executable);
    if (shim && /["%\r\n!^&|<>]/.test(executable)) throw new Error('unsafe_cli_path');
    const start = (commandArgs: string[]) => {
      const launch = this.execution.ptyCommand(backend, executable, commandArgs, cwd, environment);
      const file = shim ? process.env['ComSpec'] ?? 'cmd.exe' : launch.file;
      const argv = shim ? ['/d', '/s', '/c', `"${[executable, ...commandArgs].map(windowsArgument).join(' ')}"`] : launch.args;
      return this.spawnProcess(file, argv, { cwd: backend === 'native' ? cwd : undefined,
        env: launch.hostEnv ?? { ...process.env, ...environment }, shell: false, windowsVerbatimArguments: shim,
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    };
    if (runtime === 'claude') {
      const auth = await collectProbe(start(['auth', 'status', '--json']));
      if (object(JSON.parse(auth)).loggedIn !== true) throw new Error('authentication_required');
    }
    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try { child = start(args); }
      catch { reject(new Error('cli_failed')); return; }
      let settled = false; let output = ''; let buffer = ''; let bytes = 0; let expectedId = 1;
      const rows: unknown[] = []; const cursors = new Set<string>(); const decoder = new StringDecoder('utf8');
      const finish = (error?: string, models?: RuntimeModelOption[]) => {
        if (settled) return; settled = true; clearTimeout(timer); stopProbe(child);
        if (error) reject(new Error(error)); else resolve(models ?? []);
      };
      const timer = setTimeout(() => finish('cli_timeout'), this.timeoutMs);
      const send = (message: unknown) => { if (!settled) child.stdin.write(`${JSON.stringify(message)}\n`); };
      const read = (line: string) => {
        if (!line.trim()) return;
        const msg = object(JSON.parse(line));
        if (runtime === 'claude') {
          if (msg.type !== 'control_response') return;
          const response = object(msg.response);
          if (response.request_id !== 'ade-models') return;
          if (response.subtype !== 'success') throw new Error('catalog_failed');
          finish(undefined, parseRuntimeModels(runtime, object(response.response).models)); return;
        }
        if (msg.id !== expectedId) return;
        if (msg.error) throw new Error('catalog_failed');
        const result = object(msg.result);
        if (expectedId === 1) {
          send({ method: 'initialized', params: {} }); expectedId = 2;
          send({ id: expectedId, method: 'account/read', params: {} });
        } else if (expectedId === 2) {
          if (result.requiresOpenaiAuth === true && !result.account && !env['OPENAI_API_KEY']) throw new Error('authentication_required');
          expectedId = 3; send({ id: expectedId, method: 'model/list', params: { limit: 100, includeHidden: false } });
        } else {
          if (!Array.isArray(result.data)) throw new Error('invalid_catalog');
          rows.push(...result.data);
          if (rows.length > MAX_MODELS) throw new Error('catalog_limit');
          if (result.nextCursor != null) {
            if (typeof result.nextCursor !== 'string' || result.nextCursor.length > 2048 || cursors.has(result.nextCursor)) throw new Error('invalid_cursor');
            cursors.add(result.nextCursor); expectedId++;
            send({ id: expectedId, method: 'model/list', params: { limit: 100, includeHidden: false, cursor: result.nextCursor } });
          } else finish(undefined, parseRuntimeModels(runtime, rows));
        }
      };
      child.stdin.on('error', () => { if (!settled) finish('cli_failed'); });
      child.stdout.on('data', (chunk: Buffer) => {
        if (settled) return; bytes += chunk.length;
        if (bytes > MAX_BYTES) return finish('catalog_limit');
        const text = decoder.write(chunk);
        if (runtime === 'grok' || runtime === 'ollama') { output += text; return; }
        buffer += text; let at: number;
        try { while (!settled && (at = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, at); buffer = buffer.slice(at + 1); read(line); } }
        catch (error) { finish(error instanceof Error ? error.message : 'catalog_failed'); }
      });
      child.stderr.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_BYTES) finish('catalog_limit'); });
      child.once('error', () => finish('cli_failed'));
      child.once('close', (code) => {
        if (settled) return;
        try {
          if (code !== 0 || runtime === 'codex' || runtime === 'claude') return finish('cli_failed');
          finish(undefined, parseRuntimeModels(runtime, output + decoder.end()));
        } catch { finish('invalid_catalog'); }
      });
      if (runtime === 'codex') send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'ade_model_picker', version: '0.1.0' } } });
      else if (runtime === 'claude') send({ type: 'control_request', request_id: 'ade-models', request: { subtype: 'initialize' } });
      else child.stdin.end();
    });
  }
}

/** Fresh CLI catalogs with in-flight deduplication; credentials and raw output never leave main. */
export class RuntimeModelService {
  private readonly pending = new Map<string, Promise<RuntimeModelCatalog>>();
  constructor(private readonly credentials: { envFor(runtime: ModelRuntime): Record<string, string> }, private readonly probe: ModelProbeTransport = new CliModelProbe()) {}
  async list(request: RuntimeModelRequest): Promise<RuntimeModelCatalog> {
    if (!MODEL_RUNTIMES.includes(request.runtime)) throw new Error('ade: Unsupported model runtime.');
    const backend = normalizeExecutionBackendId(request.backend); const key = `${request.runtime}:${backend}`;
    const pending = this.pending.get(key); if (pending) return pending;
    const operation = this.load(request.runtime, backend); this.pending.set(key, operation);
    try { return await operation; } finally { this.pending.delete(key); }
  }
  private async load(runtime: ModelRuntime, backend: ExecutionBackendId): Promise<RuntimeModelCatalog> {
    try {
      const models = await this.probe.run(runtime, backend, this.credentials.envFor(runtime));
      return { runtime, backend, status: models.length ? 'ready' : 'empty', models, checkedAt: Date.now(),
        message: models.length ? 'Von der installierten CLI gemeldete Modelle. Die Liste verwendet deren Anmeldung und Konfiguration.' : 'Die CLI hat keine auswählbaren Modelle gemeldet.' };
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      const message = code === 'cli_missing' ? 'CLI in dieser Umgebung nicht gefunden. Installation unter Settings → Harnesses prüfen.'
        : code === 'authentication_required' ? 'Anmeldung fehlt. Unter Settings → Harnesses anmelden und die Modelle aktualisieren.'
          : code === 'cli_timeout' ? 'Modellabfrage hat zu lange gedauert. Verbindung und Anmeldung prüfen, danach aktualisieren.'
            : 'Modelle konnten nicht bestätigt werden. CLI-Version, Anmeldung und Verbindung unter Settings → Harnesses prüfen.';
      return { runtime, backend, status: 'unavailable', models: [], checkedAt: Date.now(), message };
    }
  }
}
