/** Host-platform semantics shared by main-process services. */

import { accessSync, constants } from 'node:fs';
import { isAbsolute, parse, resolve } from 'node:path';

export type HostPlatform = 'win32' | 'posix';

export function hostPlatform(platform: NodeJS.Platform = process.platform): HostPlatform {
  return platform === 'win32' ? 'win32' : 'posix';
}

/**
 * Stable key for host paths. Windows is case-insensitive for ADE's supported
 * worktree contract; POSIX preserves case so `/repo/A` and `/repo/a` cannot
 * steal one another's lease.
 */
export function hostPathKey(
  value: string,
  platform: NodeJS.Platform | HostPlatform = process.platform,
): string {
  const absolute = resolve(value);
  const rootLength = parse(absolute).root.length;
  const withoutTrailing = absolute.length > rootLength
    ? absolute.replace(/[\\/]+$/, '')
    : absolute;
  const normalized = withoutTrailing.replace(/\\/g, '/');
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function sameHostPath(
  left: string,
  right: string,
  platform: NodeJS.Platform | HostPlatform = process.platform,
): boolean {
  return hostPathKey(left, platform) === hostPathKey(right, platform);
}

export function hostNullDevice(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'NUL' : '/dev/null';
}

/**
 * Pick a deterministic shell even when Electron was launched from a desktop
 * environment with a sparse PATH/SHELL. Only an absolute, executable SHELL is
 * trusted; standard absolute fallbacks keep task transport predictable.
 */
export function resolveHostShell(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  executable: (path: string) => boolean = isExecutable,
): string {
  if (platform === 'win32') return 'powershell.exe';
  const configured = env['SHELL']?.trim();
  const candidates = [configured, '/bin/bash', '/bin/zsh', '/bin/sh', '/usr/bin/bash', '/usr/bin/zsh']
    .filter((candidate): candidate is string => Boolean(candidate && isAbsolute(candidate)));
  return candidates.find(executable) ?? '/bin/sh';
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
