import { t as translate } from "../../shared/i18n";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isAbsolute } from 'node:path';

export const CODEX_PROFILE_CONFIG_TIMEOUT_MS = 12_000;
export const CODEX_PROFILE_CONFIG_STDOUT_BYTES = 512 * 1024;
export const CODEX_PROFILE_CONFIG_STDERR_BYTES = 64 * 1024;
const MAX_DEVELOPER_INSTRUCTIONS_CHARS = 32_000;

export type CodexProfileConfigResult =
  | { status: 'verified'; developerInstructions: string | null }
  | { status: 'unavailable'; message: string };

export interface CodexProfileConfigOptions {
  /** Same actual project cwd and environment as the forthcoming CLI launch. */
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Test-only owned process transport. Never derive this from renderer input. */
  launch?: () => ChildProcessWithoutNullStreams;
  /** Bounded test seam; production default is 12 seconds. */
  timeoutMs?: number;
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const unavailable = (): CodexProfileConfigResult => ({ status: 'unavailable',
  message: translate("Could not safely read existing Codex instructions for this workspace. Try starting with the profile again.") });

/** Schema inspected from installed Codex app-server generate-json-schema:
 * v2/ConfigReadResponse requires config + origins; developer_instructions is an
 * optional string|null. Never return config layers, credentials, origins or errors. */
export function projectCodexProfileConfig(value: unknown): CodexProfileConfigResult {
  if (!record(value) || !record(value.config) || !record(value.origins)) return unavailable();
  const instructions = value.config.developer_instructions;
  if (instructions === undefined) {
    // A provenance entry without its effective value is ambiguous, not absence.
    return Object.hasOwn(value.origins, 'developer_instructions') ? unavailable()
      : { status: 'verified', developerInstructions: null };
  }
  if (instructions === null) return { status: 'verified', developerInstructions: null };
  if (typeof instructions !== 'string' || instructions.length > MAX_DEVELOPER_INSTRUCTIONS_CHARS || instructions.includes('\0')) return unavailable();
  return { status: 'verified', developerInstructions: instructions };
}

/** Read-only per-launch probe. No thread, turn, account request, config write,
 * model invocation or cache. The caller must still revalidate launch context:
 * a read-only probe cannot lock Codex's configuration against external changes. */
export function readCodexProfileConfig(options: CodexProfileConfigOptions): Promise<CodexProfileConfigResult> {
  if (!isAbsolute(options.cwd) || (!options.launch && process.platform !== 'win32')) return Promise.resolve(unavailable());
  const timeoutMs = options.timeoutMs ?? CODEX_PROFILE_CONFIG_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > CODEX_PROFILE_CONFIG_TIMEOUT_MS) return Promise.resolve(unavailable());
  // Freeze the caller's launch environment; do not merge in a different ambient home/key.
  const env = { ...options.env };
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = options.launch?.() ?? spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '& codex app-server --listen stdio://'],
        { cwd: options.cwd, env, windowsHide: true, stdio: 'pipe' });
    } catch { resolve(unavailable()); return; }
    let finished = false;
    let received = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let phase: 'initialize' | 'config' = 'initialize';
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: CodexProfileConfigResult): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      received = '';
      // EOF normally ends the app-server and its foreground launcher. If it
      // ignores EOF, terminate only the owned process tree while its PID lives.
      cleanupTimer = setTimeout(() => {
        if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
        if (process.platform === 'win32') execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true, timeout: 3000 }, () => undefined);
        else child.kill('SIGKILL');
      }, 500);
      cleanupTimer.unref();
      try { child.stdin.end(); } catch { /* The owned process may have already exited. */ }
      resolve(result);
    };
    const timer = setTimeout(() => finish(unavailable()), timeoutMs);
    timer.unref();
    const send = (message: unknown): void => {
      if (finished) return;
      try { child.stdin.write(`${JSON.stringify(message)}\n`, 'utf8', (error) => { if (error) finish(unavailable()); }); }
      catch { finish(unavailable()); }
    };
    child.on('error', () => finish(unavailable()));
    child.stdin.on('error', () => finish(unavailable()));
    child.on('close', () => { finish(unavailable()); if (cleanupTimer) clearTimeout(cleanupTimer); });
    child.stderr.on('data', (chunk: Buffer | string) => {
      if (finished) return;
      stderrBytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      if (stderrBytes > CODEX_PROFILE_CONFIG_STDERR_BYTES) finish(unavailable());
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (finished) return;
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes > CODEX_PROFILE_CONFIG_STDOUT_BYTES) { finish(unavailable()); return; }
      received += chunk;
      const frames = received.split('\n'); received = frames.pop()!;
      for (const frame of frames) {
        if (finished) break;
        if (!frame.trim()) continue;
        let message: unknown;
        try { message = JSON.parse(frame); } catch { finish(unavailable()); break; }
        if (!record(message)) { finish(unavailable()); break; }
        if (typeof message.method === 'string') {
          // Notifications cannot change the result. Interactive server requests
          // have no place in a configuration-only probe and fail closed.
          if (message.id !== undefined) finish(unavailable());
          continue;
        }
        if (Object.hasOwn(message, 'error') || !record(message.result)) { finish(unavailable()); break; }
        if (message.id === 1 && phase === 'initialize') {
          phase = 'config';
          send({ method: 'initialized' });
          send({ id: 2, method: 'config/read', params: { cwd: options.cwd, includeLayers: false } });
        } else if (message.id === 2 && phase === 'config') {
          finish(projectCodexProfileConfig(message.result));
        } else { finish(unavailable()); break; }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'ade_profile_config', title: translate("ADE profile configuration"), version: '0.1.0' } } });
  });
}
