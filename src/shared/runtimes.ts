/**
 * Launch profiles — per docs/ARCHITECTURE.md "Launch profiles (shared/runtimes.ts)".
 * Command per runtime x permission mode. Every profile is user-overridable via
 * Agent.customCommand. `null` = mode not supported for that runtime (falls back
 * to the default command).
 */

import type { Agent, PermissionMode, RuntimeId } from './types';

export interface LaunchProfile {
  label: string;
  /**
   * Command line per permission mode. May contain the `${model}` placeholder
   * (ollama). `null` means the runtime has no distinct command for that mode.
   * An empty string means "the user's default shell" (resolved at spawn time).
   */
  commands: Record<PermissionMode, string | null>;
}

export interface TaskLaunchCommand {
  command: string;
  transport: 'argument' | 'stdin';
}

export const LAUNCH_PROFILES: Record<RuntimeId, LaunchProfile> = {
  claude: {
    label: 'Claude Code',
    commands: {
      'default': 'claude',
      'accept-edits': 'claude --permission-mode acceptEdits',
      'bypass': 'claude --dangerously-skip-permissions',
    },
  },
  codex: {
    label: 'Codex',
    commands: {
      'default': 'codex',
      'accept-edits': 'codex --sandbox workspace-write --ask-for-approval on-request',
      'bypass': 'codex --dangerously-bypass-approvals-and-sandbox',
    },
  },
  opencode: {
    label: 'OpenCode',
    commands: {
      'default': 'opencode',
      'accept-edits': null,
      'bypass': null,
    },
  },
  grok: {
    label: 'Grok Build',
    // flags configurable; CLI naming varies — override via customCommand
    commands: {
      'default': 'grok',
      'accept-edits': null,
      'bypass': null,
    },
  },
  gemini: {
    label: 'Gemini CLI',
    commands: {
      'default': 'gemini',
      'accept-edits': 'gemini --approval-mode=auto_edit',
      'bypass': 'gemini --yolo',
    },
  },
  ollama: {
    label: 'Ollama',
    commands: {
      'default': 'ollama run ${model}',
      'accept-edits': null,
      'bypass': null,
    },
  },
  shell: {
    label: 'Shell',
    // empty string = user's default shell (PowerShell on Windows), resolved at spawn
    commands: {
      'default': '',
      'accept-edits': null,
      'bypass': null,
    },
  },
  custom: {
    label: 'Custom',
    // custom runtime always uses Agent.customCommand
    commands: {
      'default': '',
      'accept-edits': null,
      'bypass': null,
    },
  },
};

/**
 * Resolve the command line to launch for an agent.
 * - customCommand always wins.
 * - unsupported permission modes fall back to the runtime's default command.
 * - `${model}` is substituted with Agent.ollamaModel.
 * - empty string means "spawn the user's default shell" (PtyManager decides:
 *   powershell.exe on Windows, $SHELL on POSIX).
 */
export function resolveLaunchCommand(
  agent: Pick<Agent, 'runtime' | 'permissionMode' | 'customCommand' | 'ollamaModel'>,
): string {
  if (agent.customCommand && agent.customCommand.trim().length > 0) {
    return agent.customCommand.trim();
  }
  const profile = LAUNCH_PROFILES[agent.runtime];
  const command = profile.commands[agent.permissionMode] ?? profile.commands['default'] ?? '';
  return command.replace('${model}', agent.ollamaModel ?? '');
}

/**
 * Build a one-shot command for Graph task sessions. The task itself lives in
 * ADE_TASK_PROMPT, so arbitrary user text never has to be shell-escaped into
 * the command line. Supported CLIs receive their documented non-interactive
 * form; generic/custom CLIs receive the prompt over stdin.
 */
export function resolveTaskLaunchCommand(
  agent: Pick<Agent, 'runtime' | 'permissionMode' | 'customCommand' | 'ollamaModel'>,
  platform: 'win32' | 'posix',
): TaskLaunchCommand | null {
  const base = resolveLaunchCommand(agent).trim();
  if (!base || agent.runtime === 'shell') return null;

  const prompt = platform === 'win32' ? '"$env:ADE_TASK_PROMPT"' : '"$ADE_TASK_PROMPT"';
  if (agent.customCommand) {
    const pipe = platform === 'win32'
      ? `$env:ADE_TASK_PROMPT | ${base}`
      : `printf '%s\\n' "$ADE_TASK_PROMPT" | ${base}`;
    return { command: pipe, transport: 'stdin' };
  }

  switch (agent.runtime) {
    case 'claude': {
      // Windows PowerShell 5.1 (ADE's task shell) does not escape embedded
      // double quotes when building native command lines, so an argument
      // prompt truncates at its first quote. stdin survives verbatim.
      const pipe = platform === 'win32'
        ? `$env:ADE_TASK_PROMPT | ${base} -p`
        : `printf '%s\\n' "$ADE_TASK_PROMPT" | ${base} -p`;
      return { command: pipe, transport: 'stdin' };
    }
    case 'codex':
      return {
        command: `${resolveCodexExecCommand(agent.permissionMode)} --skip-git-repo-check -- ${prompt}`,
        transport: 'argument',
      };
    case 'opencode':
      return { command: `${base} run ${prompt}`, transport: 'argument' };
    case 'gemini':
      return { command: `${base} -p ${prompt}`, transport: 'argument' };
    case 'ollama':
      return { command: `${base} ${prompt}`, transport: 'argument' };
    case 'grok': {
      const pipe = platform === 'win32'
        ? `$env:ADE_TASK_PROMPT | ${base}`
        : `printf '%s\\n' "$ADE_TASK_PROMPT" | ${base}`;
      return { command: pipe, transport: 'stdin' };
    }
    case 'custom':
    default:
      return null;
  }
}

/** Build the current non-interactive Codex command for ADE's permission mode. */
export function resolveCodexExecCommand(permissionMode: PermissionMode): string {
  switch (permissionMode) {
    case 'accept-edits':
      return 'codex exec --sandbox workspace-write';
    case 'bypass':
      return 'codex exec --dangerously-bypass-approvals-and-sandbox';
    default:
      return 'codex exec';
  }
}
