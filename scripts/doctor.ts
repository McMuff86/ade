/**
 * `pnpm doctor` — checks that this checkout can run ADE and says how to fix
 * what cannot. `--fix` runs the repairs marked automatic (Electron download,
 * node-pty rebuild). `--postinstall` is the install hook: it repairs, prints
 * the report and never fails the install, so a missing CLI does not abort
 * `pnpm install`.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  doctorExitCode, evaluateDoctor, formatDoctor, type DoctorCheck, type DoctorFacts,
} from './helpers/doctor';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const postinstall = args.has('--postinstall');
const fix = args.has('--fix') || postinstall;
const isWindows = process.platform === 'win32';

function versionOf(command: string, commandArgs: string[] = ['--version']): string | undefined {
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8', timeout: 5_000, shell: isWindows, windowsHide: true,
  });
  if (result.status !== 0) return undefined;
  const line = `${result.stdout}${result.stderr}`.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
  return line?.replace(/^(git version|v)\s*/i, '').slice(0, 60);
}

function electronExecutable(): string | undefined {
  const pathFile = join(ROOT, 'node_modules', 'electron', 'path.txt');
  if (!existsSync(pathFile)) return undefined;
  const executable = join(ROOT, 'node_modules', 'electron', 'dist', readFileSync(pathFile, 'utf8').trim());
  return existsSync(executable) ? executable : undefined;
}

function probePty(): DoctorFacts['ptyUnderElectron'] {
  const electron = electronExecutable();
  if (!electron) return undefined;
  // Electron's own Node, not this one: the question is whether the addon loads
  // where ADE actually runs it.
  const result = spawnSync(electron, ['-e', "if (typeof require('node-pty').spawn !== 'function') process.exit(3)"], {
    cwd: ROOT, encoding: 'utf8', timeout: 20_000, windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  if (result.status === 0) return { ok: true, detail: '' };
  // Node prints the throwing source line before the message; the message is
  // the line that starts with the error class.
  const lines = `${result.stderr}${result.stdout}`.split(/\r?\n/).map((line) => line.trim());
  const detail = lines.find((line) => /^[A-Za-z]*Error\b|NODE_MODULE_VERSION/.test(line))
    ?? lines.find(Boolean) ?? `exit ${result.status ?? result.signal}`;
  return { ok: false, detail: detail.slice(0, 200) };
}

function secretService(): boolean {
  if (process.platform !== 'linux') return false;
  const result = spawnSync('busctl', ['--user', 'status', 'org.freedesktop.secrets'], {
    encoding: 'utf8', timeout: 3_000,
  });
  if (result.error === undefined) return result.status === 0;
  // No busctl (non-systemd distro): ask the bus directly.
  const fallback = spawnSync('dbus-send', [
    '--session', '--print-reply', '--dest=org.freedesktop.DBus', '/org/freedesktop/DBus',
    'org.freedesktop.DBus.NameHasOwner', 'string:org.freedesktop.secrets',
  ], { encoding: 'utf8', timeout: 3_000 });
  return /boolean true/.test(fallback.stdout ?? '');
}

function gatherFacts(): DoctorFacts {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { packageManager: string };
  return {
    platform: process.platform,
    nodeVersion: process.version,
    pnpmVersion: versionOf('pnpm'),
    pnpmPin: pkg.packageManager,
    gitVersion: versionOf('git'),
    electronBinary: electronExecutable() !== undefined,
    ptyUnderElectron: probePty(),
    clis: Object.fromEntries(['claude', 'codex', 'grok', 'gemini', 'opencode', 'ollama']
      .map((name) => [name, versionOf(name)])),
    secretService: process.platform === 'linux' ? secretService() : undefined,
  };
}

function runFix(check: DoctorCheck): void {
  console.log(`\n-> ${check.label}: ${check.fix}`);
  if (check.id === 'electron') {
    execFileSync(process.execPath, [join(ROOT, 'node_modules', 'electron', 'install.js')], {
      cwd: join(ROOT, 'node_modules', 'electron'), stdio: 'inherit',
    });
  } else if (check.id === 'node-pty') {
    execFileSync('pnpm', ['run', 'rebuild:pty'], { cwd: ROOT, stdio: 'inherit', shell: isWindows });
  }
}

function main(): void {
  // CI installs to run Node-side tests and packages with its own rebuild step;
  // rebuilding node-pty for Electron there would only cost time.
  if (postinstall && (process.env['CI'] || process.env['ADE_SKIP_POSTINSTALL'])) return;
  let checks = evaluateDoctor(gatherFacts());
  if (fix) {
    // Electron first: the node-pty probe needs the binary to exist.
    for (const id of ['electron', 'node-pty']) {
      const check = checks.find((item) => item.id === id);
      if (!check || check.level !== 'fail' || !check.autoFixable) continue;
      try {
        runFix(check);
      } catch (error) {
        console.error(`   failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      checks = evaluateDoctor(gatherFacts());
    }
  }
  console.log(`\nADE doctor (${process.platform})\n${formatDoctor(checks)}`);
  if (!postinstall) process.exitCode = doctorExitCode(checks);
}

main();
