import { prepareProgram } from './InteractiveProgram';

/** A prompt-capable invocation must end with its CLI. Keeping a command-reading
 * shell after CLI exit could turn a delayed prompt into an operating-system command. */
export async function prepareProtectedProgram(command: string, platform: 'win32' | 'posix', backendPath: (path: string) => Promise<string>) {
  const prepared = await prepareProgram(command, platform, backendPath);
  if (platform === 'win32') return { ...prepared, args: ['-NoProfile', ...prepared.args!.filter(arg => arg !== '-NoExit')] };
  // Replace the interactive bootstrap shell, rather than sourcing the script
  // into a shell which would return to its prompt when the tracked CLI ends.
  return { ...prepared, initialCommand: prepared.initialCommand!.replace(/^source /, 'exec /bin/bash ') };
}
