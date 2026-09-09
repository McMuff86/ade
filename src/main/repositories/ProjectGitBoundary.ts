import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hostNullDevice } from '../platform';
import { redactedErrorDetail } from '../errors';
import { assertNoLinks } from './pathDiscipline';

const execute = promisify(execFile);

/** Fixed argv only. Callers resolve and revalidate the pinned project identity. */
export async function projectGit(path: string, args: string[], timeout = 15_000): Promise<string> {
  assertNoLinks(path);
  // A caller's GIT_DIR/index/config environment must never redirect this operation.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  try {
    return (await execute('git', ['-C', path, '-c', `core.hooksPath=${hostNullDevice()}`, '-c', 'core.fsmonitor=false',
      '-c', 'submodule.recurse=false', '-c', 'protocol.ext.allow=never', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', ...args], {
      windowsHide: true, timeout, maxBuffer: 512 * 1024, encoding: 'utf8',
      env: { ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GCM_INTERACTIVE: 'Never' },
    })).stdout;
  } catch (error) {
    console.warn('[ade] project Git action failed:', redactedErrorDetail((error as { stderr?: string }).stderr ?? error));
    throw new Error('ade: Git-Aktion konnte nicht bestätigt werden. Aktuellen Workspace-Zustand prüfen; es wird nichts automatisch zurückgesetzt.');
  }
}
