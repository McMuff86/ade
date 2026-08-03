/**
 * Shape a pasted workspace-import target for the host that will resolve it.
 *
 * Copying a target out of Windows Explorer while ADE runs inside a WSL
 * distribution is the obvious thing to do, and it produced a path the planner
 * could only reject with "The POSIX target path is not absolute." Both UNC
 * spellings of the WSL share address a POSIX path, and a drive letter addresses
 * the /mnt mount that WSL provides.
 *
 * Deliberately a no-op on Windows: there the very same strings are valid native
 * paths, and rewriting them would break the case they were written for. The
 * result is shown in the field rather than applied on the way out, so what the
 * user sees is what gets sent.
 */
export function shapeImportTargetPath(value: string, hostPlatform: NodeJS.Platform): string {
  if (hostPlatform === 'win32') return value;
  const trimmed = value.trim();

  // \\wsl.localhost\<distro>\home\me\repo  and  \\wsl$\<distro>\...
  const share = /^\\\\(?:wsl\.localhost|wsl\$)\\[^\\]+(\\.*)?$/.exec(trimmed);
  if (share) return (share[1] ?? '').replace(/\\/g, '/') || '/';

  // C:\Users\me\repo -> /mnt/c/Users/me/repo
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(trimmed);
  if (drive) return `/mnt/${drive[1]!.toLowerCase()}/${(drive[2] ?? '').replace(/\\/g, '/')}`;

  return value;
}
