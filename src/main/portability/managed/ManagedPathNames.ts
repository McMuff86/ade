/**
 * The one grammar for a managed profile path component.
 *
 * Both hosts and the agent-home provisioner validate names here so the rules
 * cannot drift apart. The POSIX rules are the ones the descriptor-anchored
 * reader and writer have always enforced; the Windows rules exist because the
 * platform gives a name more ways to mean something other than "a file in this
 * directory":
 *
 * - `x.txt:s1` addresses an alternate data stream. Measured: `realpathSync.native`
 *   returns the path *with* the `:s1` suffix and `path.relative` yields it as a
 *   single component, so a separator-split containment check does not catch it.
 * - a trailing dot or space is silently stripped by Win32 path canonicalization,
 *   so `evil.` and `evil` address the same file while comparing as different.
 * - `CON`, `NUL`, `COM1`… are device names at any directory depth.
 */

export const IMPORT_OWNER_MARKER = '.ade-workspace-import-owner';

/** Parent-level sidecar guarding a two-phase owned-directory removal. */
export function importOwnerSidecar(leaf: string, token: string): string {
  return `.${leaf}.ade-import-owner-${token.slice(0, 16)}`;
}

const WIN32_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/** Throws unless `part` addresses exactly one entry inside its parent. */
export function assertManagedComponent(part: unknown, platform: NodeJS.Platform): asserts part is string {
  if (typeof part !== 'string' || part.length === 0 || part === '.' || part === '..'
      || /[/\\\0]/.test(part)) {
    throw new Error('Invalid managed profile path.');
  }
  if (platform !== 'win32') return;

  if (/[:<>"|?*]/.test(part) || /[\x00-\x1f]/.test(part)) {
    throw new Error('Invalid managed profile path.');
  }
  if (part !== part.trimEnd() || part.endsWith('.') || part.startsWith(' ')) {
    throw new Error('Invalid managed profile path.');
  }
  const stem = (part.split('.')[0] ?? '').toUpperCase();
  if (WIN32_RESERVED.has(stem)) {
    throw new Error('Invalid managed profile path.');
  }
}

/** Throws unless every element of `parts` is a usable component. */
export function assertManagedComponents(parts: readonly unknown[], platform: NodeJS.Platform): void {
  if (parts.length === 0) throw new Error('Invalid managed profile path.');
  for (const part of parts) assertManagedComponent(part, platform);
}

/**
 * Case-folds on Windows only. NTFS is case-insensitive: measured, creating
 * `photos` while `PHOTOS` exists gives EEXIST and `realpathSync.native` returns
 * the `PHOTOS` spelling — so a case-exact comparison would refuse to run on a
 * profile whose directory casing differs from ADE's, for no security gain.
 */
export function sameManagedPath(left: string, right: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}
