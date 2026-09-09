import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import type { WslListResult } from '../../shared/ipc';
import {
  NATIVE_EXECUTION_BACKEND,
  isWslDistributionName,
  normalizeExecutionBackendId,
  wslDistribution,
  wslExecutionBackend,
  type ExecutionBackendId,
} from '../../shared/executionBackends';
import { hostPathKey } from '../platform';
import { redactSensitiveText } from '../errors';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const WSL_LIST_CACHE_MS = 30_000;
/** Windows' per-variable environment limit; a longer WSLENV would be truncated silently. */
const MAX_WSLENV_CHARS = 32_000;

export interface BackendCommandOptions {
  cwd?: string;
  env?: Record<string, string>;
  input?: string | Buffer;
  timeoutMs?: number;
  maxBuffer?: number;
}

export interface BackendCommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
}

export interface PtyBackendCommand {
  file: string;
  args: string[];
  /** Host cwd used only to start the Windows-side wsl.exe client. */
  hostCwd?: string;
  /**
   * Complete Windows-side environment for the wsl.exe client (host env plus
   * the backend fields routed through WSLENV). Undefined for native launches,
   * whose env the caller assembles itself.
   */
  hostEnv?: Record<string, string>;
}

interface WslLaunch {
  args: string[];
  hostEnv: Record<string, string>;
}

type SpawnProcess = typeof spawn;

/**
 * Build the Windows environment that carries `fields` into a WSL session via
 * WSLENV (`NAME/u` = forwarded only on the Win32→WSL direction, no path
 * translation). Pure so the contract tests can prove the argv stays clean.
 *
 * Windows environment names are case-insensitive; a host variable that
 * differs from a field only by case is removed so the field wins
 * unambiguously. Existing WSLENV entries survive unless they name one of the
 * fields, whose flags ADE controls.
 */
export function wslHostEnvironment(
  hostEnv: NodeJS.ProcessEnv,
  fields: Record<string, string>,
): Record<string, string> {
  const names = Object.keys(fields);
  const seen = new Set<string>();
  for (const name of names) {
    const value = fields[name]!;
    if (!ENV_NAME.test(name) || value.includes('\0')) {
      throw new Error(`ade: invalid backend environment field ${name}`);
    }
    const folded = name.toUpperCase();
    if (folded === 'WSLENV') throw new Error('ade: backend environment must not override WSLENV');
    if (seen.has(folded)) throw new Error(`ade: backend environment field ${name} collides by case`);
    seen.add(folded);
  }

  const out: Record<string, string> = {};
  let inheritedWslenv = '';
  for (const [name, value] of Object.entries(hostEnv)) {
    if (value === undefined) continue;
    const folded = name.toUpperCase();
    if (folded === 'WSLENV') {
      inheritedWslenv = value;
      continue;
    }
    if (seen.has(folded)) continue;
    out[name] = value;
  }
  if (names.length === 0) {
    if (inheritedWslenv) out['WSLENV'] = inheritedWslenv;
    return out;
  }

  const inherited = inheritedWslenv
    .split(':')
    .filter((entry) => entry !== '' && !seen.has(entry.split('/')[0]!.toUpperCase()));
  const wslenv = [...inherited, ...names.map((name) => `${name}/u`)].join(':');
  if (wslenv.length > MAX_WSLENV_CHARS) throw new Error('ade: backend environment exceeds the WSLENV limit');
  for (const name of names) out[name] = fields[name]!;
  out['WSLENV'] = wslenv;
  return out;
}

/**
 * Single argv-only boundary for native and Windows→WSL process execution.
 * No repository path, prompt or distro name is interpolated into a shell
 * command by this layer.
 */
export class ExecutionBackendService {
  private wslListCache?: { at: number; result: WslListResult };

  constructor(
    private readonly hostPlatform: NodeJS.Platform = process.platform,
    private readonly spawnProcess: SpawnProcess = spawn,
  ) {}

  pathKey(backendValue: ExecutionBackendId | undefined, value: string): string {
    const backend = normalizeExecutionBackendId(backendValue);
    if (backend === NATIVE_EXECUTION_BACKEND) return hostPathKey(value, this.hostPlatform);
    const normalized = posix.normalize(value.replace(/\\/g, '/'));
    return normalized === '/' ? normalized : normalized.replace(/\/+$/, '');
  }

  samePath(backend: ExecutionBackendId | undefined, left: string, right: string): boolean {
    return this.pathKey(backend, left) === this.pathKey(backend, right);
  }

  /** Internal streaming helper. Its owner must bound I/O, enforce timeouts and dispose it. */
  start(backendValue: ExecutionBackendId, executable: string, args: string[]): ChildProcessWithoutNullStreams {
    const backend = normalizeExecutionBackendId(backendValue);
    if (backend === NATIVE_EXECUTION_BACKEND) throw new Error('ade: streaming workspace helper requires WSL');
    this.assertWslHost();
    const launch = this.wslLaunch(wslDistribution(backend)!, executable, args, '/');
    return this.spawnProcess('wsl.exe', launch.args, { env: launch.hostEnv, shell: false, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'] });
  }

  async run(
    backendValue: ExecutionBackendId | undefined,
    executable: string,
    args: string[],
    options: BackendCommandOptions = {},
  ): Promise<BackendCommandResult> {
    const backend = normalizeExecutionBackendId(backendValue);
    if (backend === NATIVE_EXECUTION_BACKEND) {
      return this.spawnAndCollect(executable, args, {
        ...options,
        env: { ...process.env, ...(options.env ?? {}) } as Record<string, string>,
      });
    }
    this.assertWslHost();
    const distro = wslDistribution(backend)!;
    const launch = this.wslLaunch(distro, executable, args, options.cwd, options.env);
    return this.spawnAndCollect('wsl.exe', launch.args, {
      input: options.input,
      timeoutMs: options.timeoutMs,
      maxBuffer: options.maxBuffer,
      env: launch.hostEnv,
    });
  }

  async checked(
    backend: ExecutionBackendId | undefined,
    executable: string,
    args: string[],
    options: BackendCommandOptions = {},
  ): Promise<BackendCommandResult> {
    const result = await this.run(backend, executable, args, options);
    if (result.code === 0 && !result.timedOut) return result;
    // Backend stderr is untrusted text (Git remotes echo URLs with embedded
    // credentials, CLIs print the key they rejected); redact before it
    // becomes an error message that IPC or a journal may carry onward.
    const detail = redactSensitiveText(
      decodeOutput(result.stderr).trim() || decodeOutput(result.stdout).trim(),
    ).slice(0, 2_000);
    const reason = result.timedOut ? 'timed out' : `exited with code ${result.code ?? 'unknown'}`;
    throw new Error(`ade: backend command ${reason}${detail ? `: ${detail}` : ''}`);
  }

  async text(
    backend: ExecutionBackendId | undefined,
    executable: string,
    args: string[],
    options: BackendCommandOptions = {},
  ): Promise<string> {
    return decodeOutput((await this.checked(backend, executable, args, options)).stdout);
  }

  /** Canonicalize one user-supplied repository path inside its backend. */
  async canonicalPath(backendValue: ExecutionBackendId | undefined, input: string): Promise<string> {
    const backend = normalizeExecutionBackendId(backendValue);
    if (backend === NATIVE_EXECUTION_BACKEND) {
      const absolute = resolve(input);
      if (!existsSync(absolute)) throw new Error(`ade: path does not exist: ${input}`);
      return realpathSync.native(absolute);
    }
    let linuxPath = this.wslUncPath(backend, input);
    if (!linuxPath) {
      linuxPath = input.startsWith('/') ? input : await this.toBackendPath(backend, input);
    }
    if (!posix.isAbsolute(linuxPath)) throw new Error('ade: WSL repository path must be absolute');
    return (await this.text(backend, 'realpath', ['--canonicalize-existing', '--', linuxPath])).trim();
  }

  /** Convert a Windows-owned control-plane path for use by one WSL distro. */
  async toBackendPath(backendValue: ExecutionBackendId, hostPath: string): Promise<string> {
    const backend = normalizeExecutionBackendId(backendValue);
    if (backend === NATIVE_EXECUTION_BACKEND) return resolve(hostPath);
    const unc = this.wslUncPath(backend, hostPath);
    if (unc) return posix.normalize(unc);
    if (hostPath.startsWith('/')) return posix.normalize(hostPath);
    const converted = await this.text(backend, 'wslpath', ['-a', '-u', hostPath]);
    const path = converted.trim();
    if (!posix.isAbsolute(path)) throw new Error(`ade: WSL could not translate host path: ${hostPath}`);
    return posix.normalize(path);
  }

  /** Convert a Linux path only when Windows UI integration requires one. */
  async toHostPath(backendValue: ExecutionBackendId, linuxPath: string): Promise<string> {
    const backend = normalizeExecutionBackendId(backendValue);
    if (backend === NATIVE_EXECUTION_BACKEND) return resolve(linuxPath);
    return (await this.text(backend, 'wslpath', ['-a', '-w', linuxPath])).trim();
  }

  async mkdir(backend: ExecutionBackendId, path: string): Promise<void> {
    if (backend === NATIVE_EXECUTION_BACKEND) {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(path, { recursive: true });
      return;
    }
    await this.checked(backend, 'mkdir', ['-p', '--', path]);
  }

  /** argv for node-pty. WSL cwd is handled by wsl.exe, not Windows node-pty. */
  ptyCommand(
    backendValue: ExecutionBackendId | undefined,
    executable: string,
    args: string[],
    backendCwd: string,
    env?: Record<string, string>,
  ): PtyBackendCommand {
    const backend = normalizeExecutionBackendId(backendValue);
    if (backend === NATIVE_EXECUTION_BACKEND) return { file: executable, args };
    this.assertWslHost();
    const launch = this.wslLaunch(wslDistribution(backend)!, executable, args, backendCwd, env);
    return { file: 'wsl.exe', args: launch.args, hostEnv: launch.hostEnv };
  }

  async listWslDistributions(): Promise<WslListResult> {
    if (this.hostPlatform !== 'win32') return { supported: false, distributions: [] };
    // Every scope header / agent modal asks on mount; probing distros each
    // time churns the WSL VM for no new information.
    const cached = this.wslListCache;
    if (cached && Date.now() - cached.at < WSL_LIST_CACHE_MS) return cached.result;
    const result = await this.spawnAndCollect('wsl.exe', ['--list', '--quiet'], {
      timeoutMs: 5_000,
      maxBuffer: 256 * 1024,
      env: process.env as Record<string, string>,
    });
    if (result.code !== 0) return { supported: false, distributions: [] };
    const names = decodeWslOutput(result.stdout)
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean);
    const distributions = await Promise.all([...new Set(names)]
      .filter(isWslDistributionName)
      .map(async (name) => {
        const backend = wslExecutionBackend(name);
        try {
          const probe = await this.run(backend, 'true', [], { timeoutMs: 5_000, maxBuffer: 64 * 1024 });
          // A timed-out probe usually means a cold VM still booting, not a
          // broken distro — availability is advisory, so assume the best.
          if (probe.timedOut || probe.code === 0) return { name, backend, available: true } as const;
          return {
            name,
            backend,
            available: false,
            error: decodeOutput(probe.stderr).trim().slice(0, 500) || `exit code ${probe.code ?? 'unknown'}`,
          } as const;
        } catch (error) {
          return {
            name,
            backend,
            available: false,
            error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
          } as const;
        }
      }));
    const listResult: WslListResult = { supported: true, distributions };
    this.wslListCache = { at: Date.now(), result: listResult };
    return listResult;
  }

  /**
   * argv plus the Windows-side environment for one wsl.exe launch. Backend
   * environment fields never enter argv: they travel through WSLENV, so a
   * stored API key is visible neither in the long-lived wsl.exe command line
   * (Task Manager, `Get-CimInstance Win32_Process`) nor in ADE's argv log.
   */
  private wslLaunch(
    distro: string,
    executable: string,
    args: string[],
    cwd?: string,
    env?: Record<string, string>,
  ): WslLaunch {
    const prefix = ['--distribution', distro];
    if (cwd) prefix.push('--cd', cwd);
    return {
      args: [...prefix, '--exec', executable, ...args],
      hostEnv: wslHostEnvironment(process.env, env ?? {}),
    };
  }

  private wslUncPath(backend: ExecutionBackendId, value: string): string | null {
    const normalized = value.replace(/\//g, '\\');
    const match = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(?:\\(.*))?$/i.exec(normalized);
    if (!match) return null;
    const expected = wslDistribution(backend)!;
    if (match[1]!.toLocaleLowerCase('en-US') !== expected.toLocaleLowerCase('en-US')) {
      throw new Error(`ade: WSL UNC path belongs to ${match[1]}, not ${expected}`);
    }
    const rest = (match[2] ?? '').replace(/\\/g, '/');
    return posix.normalize(`/${rest}`);
  }

  private assertWslHost(): void {
    if (this.hostPlatform !== 'win32') {
      throw new Error('ade: the Windows GUI→WSL backend is available only in the Windows build');
    }
  }

  private spawnAndCollect(
    executable: string,
    args: string[],
    options: BackendCommandOptions,
  ): Promise<BackendCommandResult> {
    return new Promise((resolveResult, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = this.spawnProcess(executable, args, {
          cwd: options.cwd,
          env: options.env,
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error) {
        reject(error);
        return;
      }
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let timedOut = false;
      let settled = false;
      const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
      const append = (target: Buffer[], chunk: Buffer, stream: 'stdout' | 'stderr'): void => {
        if (settled) return;
        const bytes = stream === 'stdout' ? stdoutBytes + chunk.byteLength : stderrBytes + chunk.byteLength;
        if (bytes > maxBuffer) {
          settled = true;
          clearTimeout(timer);
          child.kill();
          reject(new Error(`ade: backend ${stream} exceeded ${maxBuffer} bytes`));
          return;
        }
        target.push(chunk);
        if (stream === 'stdout') stdoutBytes = bytes;
        else stderrBytes = bytes;
      };
      child.stdout.on('data', (chunk: Buffer) => append(stdout, chunk, 'stdout'));
      child.stderr.on('data', (chunk: Buffer) => append(stderr, chunk, 'stderr'));
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      timer.unref?.();
      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveResult({
          code,
          signal,
          stdout: Buffer.concat(stdout, stdoutBytes),
          stderr: Buffer.concat(stderr, stderrBytes),
          timedOut,
        });
      });
      // A backend can fail before consuming stdin (missing executable/distro).
      // Ignore that expected pipe close; command exit/stderr remains the
      // authoritative result and must not become an unhandled main-process error.
      child.stdin.on('error', () => undefined);
      if (options.input !== undefined) child.stdin.end(options.input);
      else child.stdin.end();
    });
  }
}

export function decodeOutput(buffer: Buffer): string {
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

/** wsl.exe list output is UTF-16LE on some Windows releases and UTF-8 on others. */
export function decodeWslOutput(buffer: Buffer): string {
  const utf16 = buffer.length >= 2
    && [...buffer.subarray(1, Math.min(buffer.length, 80)).filter((_, index) => index % 2 === 0)]
      .filter((byte) => byte === 0).length >= 4;
  return (utf16 ? buffer.toString('utf16le') : buffer.toString('utf8'))
    .replace(/^\uFEFF/, '')
    .replace(/\0/g, '');
}
