import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostOperationService } from '../src/main/settings/HostOperationService';
import { LinuxLoginStartup, desktopExecArgument, windowsLoginStartup } from '../src/main/settings/loginStartup';
import { assertIpcPayload } from '../src/main/ipcValidation';
import { CHANNEL_POLICY } from '../src/main/ipcPolicy';
import { validateCompleteConfig } from '../src/main/config/store';
import { DEFAULT_CONFIG } from '../src/shared/types';

let passed = 0; let failed = 0;
function check(name: string, ok: boolean) { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } }
function rejects(name: string, action: () => void) { try { action(); check(name, false); } catch { check(name, true); } }
let preferences = { keepAwake: false, keepInTray: false }; let active = 0; let other = false;
let login = false; let starts = 0; let stops = 0; let brokenStart = false; let brokenStop = false; let live = false;
const service = new HostOperationService({ preferences: () => preferences, save: value => { preferences = value; },
  activeSessions: () => active, otherWorkActive: () => other,
  startup: { supported: true, enabled: () => login, set: value => { login = value; } },
  power: { start: type => { check('only app suspension is blocked; screen may sleep', type === 'prevent-app-suspension'); if (brokenStart) throw Error('fixture'); starts++; live = true; return starts; },
    stop: () => { stops++; if (brokenStop) throw Error('fixture'); live = false; return true; }, isStarted: () => live }, warn: () => {},
});
check('all options default off', !service.status().autostart && service.status().sleepPrevention === 'off');
active = 2; service.reconcile(); check('active sessions do not imply consent', starts === 0);
service.change({ setting: 'keepAwake', enabled: true });
check('active work obtains one blocker', starts === 1 && service.status().sleepPrevention === 'requested');
service.reconcile(); service.reconcile(); check('repeat observation never duplicates blockers', starts === 1);
active = 0; service.reconcile(); check('last session exit releases inhibitor', stops === 1 && service.status().sleepPrevention === 'idle');
other = true; service.reconcile(); check('managed non-PTY work also holds inhibitor', starts === 2);
other = false; service.reconcile(); check('managed completion releases inhibitor', stops === 2);
active = 1; service.reconcile(); service.change({ setting: 'keepAwake', enabled: false });
check('opt-out releases immediately while session remains open', !live && active === 1);
service.change({ setting: 'keepInTray', enabled: true }); check('tray preference persists independently', preferences.keepInTray && !preferences.keepAwake);
service.change({ setting: 'autostart', enabled: true }); check('autostart reflects OS registration', service.status().autostart);
login = false; check('external OS opt-out is observed', !service.status().autostart);
brokenStart = true; service.change({ setting: 'keepAwake', enabled: true }); check('inhibitor failure is explicit', service.status().sleepPrevention === 'error');
brokenStart = false; service.reconcile(); check('subsequent positive recovery obtains inhibitor', live && service.status().sleepPrevention === 'requested');
brokenStop = true; service.change({ setting: 'keepAwake', enabled: false }); check('failed release retains handle and error', live && service.status().sleepPrevention === 'error');
brokenStop = false; service.reconcile(); check('release retries original handle successfully', !live && service.status().sleepPrevention === 'off');
service.change({ setting: 'keepAwake', enabled: true }); service.dispose();
check('quit releases blocker even during active work', !live);
const before = starts; service.reconcile(); check('disposed owner cannot reacquire', starts === before);
rejects('disposed owner refuses mutations', () => service.change({ setting: 'autostart', enabled: true }));

assertIpcPayload('hostOperation:change', { setting: 'autostart', enabled: true }); check('strict local command accepts valid change', true);
for (const payload of [{ setting: 'autostart', enabled: 'true' }, { setting: 'command', enabled: true }, { setting: 'keepAwake', enabled: true, path: '/tmp/evil' }, null]) {
  rejects('local command rejects malformed or expanded payload', () => assertIpcPayload('hostOperation:change', payload));
}
rejects('generic config cannot bypass host settings boundary', () => assertIpcPayload('config:save', { settings: { hostOperation: preferences } }));
check('both operating channels remain desktop-only', CHANNEL_POLICY['hostOperation:get'].surface === 'desktop'
  && CHANNEL_POLICY['hostOperation:change'].surface === 'desktop' && CHANNEL_POLICY['hostOperation:change'].effect === 'host');
const config = structuredClone(DEFAULT_CONFIG); config.settings.hostOperation = preferences;
validateCompleteConfig(config); check('persisted preferences accepted', true);
rejects('persisted operating settings reject unexpected fields', () => validateCompleteConfig({ ...config, settings: { ...config.settings, hostOperation: { ...preferences, command: 'bad' } } } as typeof config));

let windows: { openAtLogin: boolean; executableWillLaunchAtLogin?: boolean } = { openAtLogin: false }; let args: unknown;
const win = windowsLoginStartup({ getLoginItemSettings: input => { args = input; return windows; },
  setLoginItemSettings: input => { args = input; windows = { openAtLogin: input.openAtLogin }; } }, 'C:\\ADE Folder\\ADE.exe', ['C:\\ADE repo']);
win.set(true); check('Windows adapter registers fixed executable and arguments', JSON.stringify(args).includes('ADE Folder') && win.enabled());
windows.executableWillLaunchAtLogin = false; check('Windows user startup override is respected', !win.enabled());
win.set(false); check('Windows disable removes ADE registration', !win.enabled());
rejects('desktop Exec rejects injected lines', () => desktopExecArgument('/tmp/ade\nExec=evil'));
check('desktop Exec escapes percent field codes', desktopExecArgument('/tmp/100% ADE') === '"/tmp/100%% ADE"');
check('desktop Exec quotes spaces and shell substitutions as data', desktopExecArgument('/tmp/$x`y"z\\') === '"/tmp/\\\\$x\\\\`y\\\\"z\\\\\\\\"');

if (process.platform === 'linux') {
  const root = mkdtempSync(join(tmpdir(), 'ade-login-startup-'));
  try {
    const dir = join(root, 'autostart'); const file = join(dir, 'com.adimuff.ade.autostart.desktop');
    const linux = new LinuxLoginStartup(dir, '/opt/ADE app/electron', ['/opt/ADE app', '--flag']);
    check('Linux absent registration is off', !linux.enabled());
    linux.set(true); check('Linux registration is enabled after atomic save', linux.enabled());
    const content = readFileSync(file, 'utf8');
    check('Linux uses an absolute quoted executable and app argument', content.includes('Exec="/opt/ADE app/electron" "/opt/ADE app" "--flag"'));
    linux.set(true); check('repeated Linux enable is idempotent', readFileSync(file, 'utf8') === content);
    writeFileSync(file, content + 'Hidden=true\n'); check('Linux explicit desktop opt-out is observed', !linux.enabled());
    linux.set(true); writeFileSync(file, content.replace('ADE app/electron', 'wrong/electron'));
    rejects('moved installation is not reported as active', () => linux.enabled());
    linux.set(false); check('Linux disable removes own stale entry', !linux.enabled());
    linux.set(false); check('Linux disable is idempotent', !linux.enabled());
    writeFileSync(file, '[Desktop Entry]\nExec=foreign\n');
    rejects('foreign entry cannot be overwritten', () => linux.set(true));
    rejects('foreign entry cannot be removed', () => linux.set(false));
    rmSync(file); const target = join(root, 'target'); writeFileSync(target, content); symlinkSync(target, file);
    rejects('linked entry cannot be read as enabled', () => linux.enabled());
    rejects('linked entry cannot be replaced', () => linux.set(true));
    check('link target remains untouched', readFileSync(target, 'utf8') === content);
    rmSync(file); rmSync(dir, { recursive: true }); symlinkSync(root, dir);
    rejects('linked parent is rejected on enable', () => linux.set(true));
  } finally { rmSync(root, { recursive: true, force: true }); }
}
console.log(`\n${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
