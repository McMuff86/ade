import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoLinks } from '../repositories/pathDiscipline';
import type { LoginStartup } from './HostOperationService';

const OWNER = 'X-ADE-Managed-Autostart=true';
// Desktop Entry escaping has two layers (string, then Exec argument), and
// percent signs are field codes even inside quotes. No shell is involved.
export function desktopExecArgument(value: string): string {
  if (!value || /[\0-\x1f\x7f]/.test(value)) throw new Error('Invalid autostart argument.');
  return '"' + value.replace(/[%\\"`$]/g, char => char === '%' ? '%%' : char === '\\' ? '\\\\\\\\' : '\\\\' + char) + '"';
}

/** Only ADE's own marked file may be changed; links and foreign entries fail
 * closed. Autostart is observed from the OS, not an optimistic config flag. */
export class LinuxLoginStartup implements LoginStartup {
  readonly supported = true;
  private readonly file: string;
  private readonly content: string;
  constructor(private readonly directory: string, executable: string, args: string[]) {
    if (!isAbsolute(directory) || !isAbsolute(executable)) throw new Error('Autostart requires absolute native paths.');
    this.file = join(directory, 'com.adimuff.ade.autostart.desktop');
    this.content = `[Desktop Entry]\nType=Application\nName=ADE\nComment=Open ADE after desktop login\nTerminal=false\n${OWNER}\nExec=${[executable, ...args].map(desktopExecArgument).join(' ')}\n`;
  }
  private read(file = this.file): string | null {
    if (file === this.file) assertNoLinks(this.file);
    let fd: number;
    try { fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16384) throw new Error('Invalid ADE autostart entry.');
      const text = readFileSync(fd, 'utf8');
      if (!text.split('\n').includes(OWNER)) throw new Error('Autostart entry belongs to another application.');
      return text;
    } finally { closeSync(fd); }
  }
  enabled(): boolean {
    const text = this.read();
    if (text === null || /^Hidden=true\s*$/m.test(text)) return false;
    if (text !== this.content) throw new Error('ADE autostart entry no longer matches this installation.');
    return true;
  }
  set(enabled: boolean): void {
    this.read();
    assertNoLinks(this.directory);
    if (enabled) mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    let directoryFd: number;
    try { directoryFd = openSync(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); }
    catch (error) { if (!enabled && (error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    const identity = fstatSync(directoryFd);
    const anchored = `/proc/self/fd/${directoryFd}`;
    const target = join(anchored, 'com.adimuff.ade.autostart.desktop');
    const temp = join(anchored, `.ade-${randomUUID()}.tmp`);
    try {
      this.read(target);
      if (enabled) writeFileSync(temp, this.content, { flag: 'wx', mode: 0o600 });
      assertNoLinks(this.directory);
      const current = lstatSync(this.directory);
      if (identity.dev !== current.dev || identity.ino !== current.ino) throw new Error('Autostart directory changed.');
      this.read(target);
      if (enabled) renameSync(temp, target);
      else { try { unlinkSync(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
    } finally {
      try { unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      finally { closeSync(directoryFd); }
    }
  }
}

export function windowsLoginStartup(app: {
  getLoginItemSettings(options: { path: string; args: string[] }): { openAtLogin: boolean; executableWillLaunchAtLogin?: boolean };
  setLoginItemSettings(options: { openAtLogin: boolean; path: string; args: string[]; name: string }): void;
}, executable: string, args: string[]): LoginStartup {
  return { supported: true,
    enabled: () => { const state = app.getLoginItemSettings({ path: executable, args }); return state.openAtLogin && state.executableWillLaunchAtLogin !== false; },
    set: enabled => app.setLoginItemSettings({ openAtLogin: enabled, path: executable, args, name: 'ADE' }),
  };
}
