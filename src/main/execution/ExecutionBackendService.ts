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

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
}

type SpawnProcess = typeof spawn;

/**
 * Single argv-only boundary for native and Windows→WSL process execution.
 * No repository path, prompt or distro name is interpolated into a shell
 * command by this layer.
 */
export class ExecutionBackendService {
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
    const command = this.wslArgs(distro, executable, args, options.cwd, options.env);
    return this.spawnAndCollect('wsl.exe', command, {
      input: options.input,
      timeoutMs: options.timeoutMs,
      maxBuffer: options.maxBuffer,
      env: process.env as Record<string, string>,
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
    const detail = decodeOutput(result.stderr).trim() || decodeOutput(result.stdout).trim();
    const reason = result.timedOut ? 'timed out' : `exited with code ${result.code ?? 'unknown'}`;
    throw new Error(`ade: backend command ${reason}${detail ? `: ${detail.slice(0, 2_000)}` : ''}`);
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
    return {
      file: 'wsl.exe',
      args: this.wslArgs(wslDistribution(backend)!, executable, args, backendCwd, env),
    };
  }

  async listWslDistributions(): Promise<WslListResult> {
    if (this.hostPlatform !== 'win32') return { supported: false, distributions: [] };
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
          await this.checked(backend, 'true', [], { timeoutMs: 5_000, maxBuffer: 64 * 1024 });
          return { name, backend, available: true } as const;
        } catch (error) {
          return {
            name,
            backend,
            available: false,
            error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
          } as const;
        }
      }));
    return { supported: true, distributions };
  }

  private wslArgs(
    distro: string,
    executable: string,
    args: string[],
    cwd?: string,
    env?: Record<string, string>,
  ): string[] {
    const prefix = ['--distribution', distro];
    if (cwd) prefix.push('--cd', cwd);
    prefix.push('--exec');
    const environment = Object.entries(env ?? {});
    if (environment.length === 0) return [...prefix, executable, ...args];
    const assignments = environment.map(([name, value]) => {
      if (!ENV_NAME.test(name) || value.includes('\0')) throw new Error(`ade: invalid backend environment field ${name}`);
      return `${name}=${value}`;
    });
    return [...prefix, '/usr/bin/env', ...assignments, executable, ...args];
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
