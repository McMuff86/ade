/**
 * Installation checks behind `pnpm doctor` and the postinstall hook.
 *
 * Every check answers one question a new user would otherwise find out the
 * hard way (a blank window, "Electron uninstall", a terminal that never
 * opens), and every failure carries the exact command that fixes it. The
 * probes are injected so the verdict logic is testable without a real
 * toolchain.
 */

export type DoctorLevel = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  id: string;
  label: string;
  level: DoctorLevel;
  detail: string;
  /** Shell command that fixes it, when there is one. */
  fix?: string;
  /** `--fix` may run the fix automatically (idempotent, repo-local). */
  autoFixable?: boolean;
}

export interface DoctorFacts {
  platform: NodeJS.Platform;
  nodeVersion: string;
  /** pnpm version, or undefined when pnpm is not on PATH. */
  pnpmVersion?: string;
  /** `packageManager` pin from package.json, e.g. "pnpm@9.15.9". */
  pnpmPin: string;
  gitVersion?: string;
  /** Whether node_modules/electron/path.txt exists (Electron binary downloaded). */
  electronBinary: boolean;
  /** Result of loading node-pty inside Electron's own Node; undefined = not probed. */
  ptyUnderElectron?: { ok: boolean; detail: string };
  /** Agent CLIs on PATH, name -> version line (undefined = missing). */
  clis: Record<string, string | undefined>;
  /** Linux only: a Secret Service owns org.freedesktop.secrets on the session bus. */
  secretService?: boolean;
}

export const MIN_NODE_MAJOR = 22;

export function nodeMajor(version: string): number {
  return Number.parseInt(version.replace(/^v/, '').split('.')[0] ?? '', 10);
}

export function evaluateDoctor(facts: DoctorFacts): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const major = nodeMajor(facts.nodeVersion);
  checks.push(Number.isFinite(major) && major >= MIN_NODE_MAJOR
    ? { id: 'node', label: 'Node.js', level: 'ok', detail: facts.nodeVersion }
    : {
      id: 'node', label: 'Node.js', level: 'fail',
      detail: `${facts.nodeVersion} is older than ${MIN_NODE_MAJOR}.`,
      fix: `Install Node.js ${MIN_NODE_MAJOR} or newer (e.g. \`mise use -g node@${MIN_NODE_MAJOR}\`).`,
    });

  const pinned = facts.pnpmPin.replace(/^pnpm@/, '');
  if (!facts.pnpmVersion) {
    checks.push({
      id: 'pnpm', label: 'pnpm', level: 'fail', detail: 'pnpm is not on PATH.',
      fix: `corepack enable && corepack prepare pnpm@${pinned} --activate`,
    });
  } else if (facts.pnpmVersion !== pinned) {
    checks.push({
      id: 'pnpm', label: 'pnpm', level: 'warn',
      detail: `${facts.pnpmVersion}, the repository pins ${pinned}; the lockfile may be rewritten.`,
      fix: `corepack prepare pnpm@${pinned} --activate`,
    });
  } else {
    checks.push({ id: 'pnpm', label: 'pnpm', level: 'ok', detail: facts.pnpmVersion });
  }

  checks.push(facts.gitVersion
    ? { id: 'git', label: 'Git', level: 'ok', detail: facts.gitVersion }
    : { id: 'git', label: 'Git', level: 'fail', detail: 'git is not on PATH; projects and runs need it.', fix: 'Install Git.' });

  checks.push(facts.electronBinary
    ? { id: 'electron', label: 'Electron binary', level: 'ok', detail: 'downloaded' }
    : {
      id: 'electron', label: 'Electron binary', level: 'fail',
      detail: 'pnpm skipped Electron\'s download; `pnpm start` would report "Electron uninstall".',
      fix: 'node node_modules/electron/install.js', autoFixable: true,
    });

  if (facts.ptyUnderElectron) {
    checks.push(facts.ptyUnderElectron.ok
      ? { id: 'node-pty', label: 'Terminal (node-pty)', level: 'ok', detail: 'loads inside Electron' }
      : {
        id: 'node-pty', label: 'Terminal (node-pty)', level: 'fail',
        detail: `does not load inside Electron, so no terminal would open: ${facts.ptyUnderElectron.detail}`,
        fix: 'pnpm run rebuild:pty', autoFixable: true,
      });
  }

  const found = Object.entries(facts.clis).filter(([, version]) => version);
  checks.push(found.length > 0
    ? {
      id: 'clis', label: 'Agent CLIs', level: 'ok',
      detail: found.map(([name, version]) => `${name} ${version}`).join(', '),
    }
    : {
      id: 'clis', label: 'Agent CLIs', level: 'warn',
      detail: 'none of claude, codex, grok, gemini, opencode or ollama is on PATH; ADE can open shells but no agent.',
      fix: 'Install at least one, e.g. `npm i -g @anthropic-ai/claude-code` or `npm i -g @openai/codex`.',
    });

  if (facts.platform === 'linux') {
    checks.push(facts.secretService
      ? { id: 'keyring', label: 'Key storage', level: 'ok', detail: 'Secret Service available on the session bus' }
      : {
        id: 'keyring', label: 'Key storage', level: 'warn',
        detail: 'no Secret Service on the session bus; API keys cannot be stored (CLI sign-ins still work).',
        fix: 'Install and start gnome-keyring (or KeePassXC with Secret Service enabled).',
      });
  }
  return checks;
}

export function doctorExitCode(checks: readonly DoctorCheck[]): number {
  return checks.some((check) => check.level === 'fail') ? 1 : 0;
}

const MARK: Record<DoctorLevel, string> = { ok: '  ok ', warn: 'warn ', fail: 'FAIL ' };

export function formatDoctor(checks: readonly DoctorCheck[]): string {
  const width = Math.max(...checks.map((check) => check.label.length));
  const lines = checks.map((check) => {
    const head = `${MARK[check.level]} ${check.label.padEnd(width)}  ${check.detail}`;
    return check.fix && check.level !== 'ok' ? `${head}\n${' '.repeat(width + 8)}-> ${check.fix}` : head;
  });
  const failed = checks.filter((check) => check.level === 'fail').length;
  const warned = checks.filter((check) => check.level === 'warn').length;
  lines.push('', failed === 0
    ? `ADE is ready${warned > 0 ? ` (${warned} warning${warned === 1 ? '' : 's'})` : ''}. Start it with \`pnpm dev\`.`
    : `${failed} problem${failed === 1 ? '' : 's'} to fix. \`pnpm doctor --fix\` repairs the ones marked as automatic.`);
  return lines.join('\n');
}
