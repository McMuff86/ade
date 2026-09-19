import { t as translate } from "../../shared/i18n";
import { execFile } from 'node:child_process';
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, type Stats } from 'node:fs';
import { hostNullDevice } from '../platform';
import { redactedErrorDetail } from '../errors';
import { assertNoLinks } from './pathDiscipline';

/** Main-only Git plumbing. Callers pin workspace identity; clients never supply argv or index paths. */
export function integrationGit(cwd: string, args: string[], options: { input?: Buffer | string; index?: string; accept?: number[]; timeout?: number } = {}): Promise<{ stdout: Buffer; code: number }> {
  assertNoLinks(cwd); if (options.index) assertNoLinks(options.index);
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  return new Promise((resolve, reject) => {
    const child = execFile('git', ['-C', cwd, '-c', `core.hooksPath=${hostNullDevice()}`, '-c', 'core.fsmonitor=false',
      '-c', 'submodule.recurse=false', '-c', 'protocol.ext.allow=never', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0',
      '-c', 'commit.gpgSign=false', '-c', 'filter.lfs.clean=', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.required=false', ...args], {
      windowsHide: true, timeout: options.timeout ?? 30_000, maxBuffer: 8 * 1024 * 1024, encoding: 'buffer',
      env: { ...inherited, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GCM_INTERACTIVE: 'Never',
        ...(options.index ? { GIT_INDEX_FILE: options.index } : {}) },
    }, (error, stdout, stderr) => {
      const code = !error ? 0 : typeof error.code === 'number' ? error.code : -1;
      if (code !== 0 && !options.accept?.includes(code)) {
        console.warn('[ade] integration Git failed:', redactedErrorDetail(stderr.length ? stderr.toString('utf8') : error));
        reject(new Error(translate("ade: Git check failed. source and integration working copy remain for checking."))); return;
      }
      resolve({ stdout: Buffer.from(stdout), code });
    });
    child.stdin?.on('error', () => undefined); child.stdin?.end(options.input);
  });
}

/** Same descriptor and link discipline as project file/Git operations, also for review artifacts. */
export function readIntegrationFile(path: string, limit = 2 * 1024 * 1024): Buffer | null {
  assertNoLinks(path); if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit) throw new Error(translate("ade: File is linked, no regular entry or exceeds the check limit."));
  const same = (other: Stats) => stat.ino === other.ino && stat.dev === other.dev && stat.size === other.size && stat.mtimeMs === other.mtimeMs && other.nlink === 1;
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!same(fstatSync(fd))) throw new Error(translate("ade: File changed before reading."));
    const body = readFileSync(fd); assertNoLinks(path);
    if (body.length > limit || !same(fstatSync(fd)) || !same(lstatSync(path))) throw new Error(translate("ade: File changed during the check."));
    return body;
  } finally { closeSync(fd); }
}
