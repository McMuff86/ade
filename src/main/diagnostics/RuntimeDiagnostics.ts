/** Non-mutating CLI availability, version, auth and task-transport diagnostics. */

import { execFile, spawn } from 'node:child_process';
import type { Agent, RuntimeAuthStatus, RuntimeDiagnostic, RuntimeDiagnosticsResult, RuntimeId } from '../../shared/types';
import { LAUNCH_PROFILES, resolveTaskLaunchCommand } from '../../shared/runtimes';
import { resolveHostShell } from '../platform';

const COMMAND_TIMEOUT_MS = 5_000;
const OUTPUT_CAP = 64 * 1024;

const BINARIES: Partial<Record<RuntimeId, string>> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  grok: 'grok',
  gemini: 'gemini',
  ollama: 'ollama',
};

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface AuthProbe {
  status: RuntimeAuthStatus;
  detail: string;
  serviceReady?: boolean;
}

function compactLine(value: string): string | undefined {
  const line = value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  return line?.slice(0, 180);
}

export function runDiagnosticCommand(
  executable: string,
  args: string[],
  timeoutMs = COMMAND_TIMEOUT_MS,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const isWindowsShim = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable);
    // Windows cannot CreateProcess a .cmd/.bat directly. The resolved path and
    // every argument here come from ADE's fixed runtime probe table, never from
    // renderer/custom-command input, so using the system shell is bounded.
    const child = spawn(executable, args, {
      shell: isWindowsShim,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const append = (current: string, chunk: Buffer): string =>
      (current + chunk.toString('utf8')).slice(0, OUTPUT_CAP);
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });

    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      finish(null);
    }, timeoutMs);
    timer.unref?.();
    child.once('error', () => finish(null));
    child.once('close', (code) => finish(code));
  });
}

function locate(binary: string): Promise<string | null> {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  return new Promise((resolve) => {
    execFile(locator, [binary], { timeout: 3_000, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const paths = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (process.platform === 'win32') {
        resolve(paths.find((path) => /\.(?:exe|com|cmd|bat)$/i.test(path)) ?? paths[0] ?? null);
      } else {
        resolve(paths[0] ?? null);
      }
    });
  });
}

async function authProbe(runtime: RuntimeId, executable: string): Promise<AuthProbe> {
  if (runtime === 'claude') {
    const result = await runDiagnosticCommand(executable, ['auth', 'status', '--json']);
    if (result.timedOut) return { status: 'unknown', detail: 'Authentication check timed out.' };
    try {
      const parsed = JSON.parse(result.stdout) as { loggedIn?: unknown; authMethod?: unknown };
      if (parsed.loggedIn === true) {
        const method = typeof parsed.authMethod === 'string' ? ` (${parsed.authMethod})` : '';
        return { status: 'authenticated', detail: `Signed in${method}.` };
      }
    } catch {
      // A non-JSON/non-zero response is handled as signed out below.
    }
    return { status: 'not-authenticated', detail: 'Run `claude auth login` in a terminal.' };
  }

  if (runtime === 'codex') {
    const result = await runDiagnosticCommand(executable, ['login', 'status']);
    return result.code === 0
      ? { status: 'authenticated', detail: 'Signed in.' }
      : { status: 'not-authenticated', detail: 'Run `codex login` in a terminal.' };
  }

  if (runtime === 'ollama') {
    const result = await runDiagnosticCommand(executable, ['list']);
    return result.code === 0
      ? { status: 'not-required', detail: 'Local Ollama service is reachable.', serviceReady: true }
      : { status: 'not-required', detail: 'CLI found, but the local Ollama service is unavailable.', serviceReady: false };
  }

  if (runtime === 'grok' && process.env['XAI_API_KEY']) {
    return { status: 'authenticated', detail: 'XAI_API_KEY is available to ADE.' };
  }
  if (runtime === 'gemini' && (process.env['GEMINI_API_KEY'] || process.env['GOOGLE_API_KEY'])) {
    return { status: 'authenticated', detail: 'A Gemini API key is available to ADE.' };
  }

  return {
    status: 'unknown',
    detail: 'This CLI does not expose a stable, non-interactive auth status check.',
  };
}

function taskTransport(agent: Agent): RuntimeDiagnostic['taskTransport'] {
  const task = resolveTaskLaunchCommand(agent, process.platform === 'win32' ? 'win32' : 'posix');
  return task?.transport ?? 'unavailable';
}

async function diagnoseAgent(agent: Agent): Promise<RuntimeDiagnostic> {
  const label = LAUNCH_PROFILES[agent.runtime].label;
  const transport = taskTransport(agent);

  if (agent.customCommand?.trim()) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      runtime: agent.runtime,
      label,
      command: 'Custom override',
      installed: null,
      authStatus: 'unknown',
      authDetail: 'Custom commands are never executed by diagnostics.',
      taskTransport: transport,
      status: 'warning',
      message: 'Launch the session to validate this custom command.',
    };
  }

  if (agent.runtime === 'shell') {
    return {
      agentId: agent.id,
      agentName: agent.name,
      runtime: agent.runtime,
      label,
      command: resolveHostShell(),
      installed: true,
      authStatus: 'not-required',
      authDetail: 'Authentication is not required.',
      taskTransport: transport,
      status: 'ready',
      message: 'Interactive shell is ready.',
    };
  }

  const binary = BINARIES[agent.runtime];
  if (!binary) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      runtime: agent.runtime,
      label,
      command: agent.runtime,
      installed: null,
      authStatus: 'unknown',
      authDetail: 'No command is configured.',
      taskTransport: transport,
      status: 'warning',
      message: 'Configure a custom command for this agent.',
    };
  }

  const executable = await locate(binary);
  if (!executable) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      runtime: agent.runtime,
      label,
      command: binary,
      installed: false,
      authStatus: 'unknown',
      authDetail: 'Authentication was not checked.',
      taskTransport: transport,
      status: 'error',
      message: `Command \`${binary}\` is not on PATH.`,
    };
  }

  const [versionResult, auth] = await Promise.all([
    runDiagnosticCommand(executable, ['--version']),
    authProbe(agent.runtime, executable),
  ]);
  const version = compactLine(versionResult.stdout) ?? compactLine(versionResult.stderr);
  const versionReady = versionResult.code === 0 && !versionResult.timedOut;
  const ready = versionReady
    && auth.status !== 'not-authenticated'
    && auth.serviceReady !== false;
  const warning = ready && auth.status === 'unknown';
  const message = !versionReady
    ? 'The command was found but did not answer `--version`.'
    : auth.status === 'not-authenticated'
      ? 'Sign-in is required before launch.'
      : auth.serviceReady === false
        ? 'Start the Ollama service before launch.'
        : warning
          ? 'CLI is installed; verify sign-in on first launch.'
          : 'CLI and authentication are ready.';

  return {
    agentId: agent.id,
    agentName: agent.name,
    runtime: agent.runtime,
    label,
    command: binary,
    installed: true,
    version,
    authStatus: auth.status,
    authDetail: auth.detail,
    taskTransport: transport,
    status: ready ? (warning ? 'warning' : 'ready') : 'error',
    message,
  };
}

export async function diagnoseRuntimes(agents: Agent[], agentId?: string): Promise<RuntimeDiagnosticsResult> {
  const selected = agentId ? agents.filter((agent) => agent.id === agentId) : agents;
  if (agentId && selected.length === 0) throw new Error(`ade: agent not found "${agentId}"`);
  return {
    checkedAt: Date.now(),
    platform: process.platform,
    items: await Promise.all(selected.map(diagnoseAgent)),
  };
}
