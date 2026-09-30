import { prepareProgram } from './InteractiveProgram';

/** A prompt-capable invocation must end with its CLI. Keeping a command-reading
 * shell after CLI exit could turn a delayed prompt into an operating-system command. */
export async function prepareProtectedProgram(command: string, platform: 'win32' | 'posix', backendPath: (path: string) => Promise<string>) {
  const prepared = await prepareProgram(command, platform, backendPath, true);
  if (platform === 'win32') return { ...prepared, args: ['-NoProfile', ...prepared.args!.filter(arg => arg !== '-NoExit')] };
  // Read a private script, never commands from the PTY. No login bootstrap or
  // startup file may replace the resolved CLI after its config was verified.
  return { ...prepared, args: ['--noprofile', '--norc', prepared.scriptPath], initialCommand: undefined };
}
