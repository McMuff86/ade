/** Disposable native Electron update, busy refusal, rollback and encrypted pairing survival. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { activateLinux, profileOwner, type LinuxActivationOptions } from './helpers/linuxActivation';
import { buildDir } from './helpers/buildOutput';
import { mobileTlsProxy } from './helpers/mobileBrowser';
let passed = 0; let failed = 0;
function check(label: string, ok: boolean) { if (!ok) { failed++; throw new Error(label); } passed++; console.log(`  ok  ${label}`); }
const require = createRequire(import.meta.url); const electron = require('electron') as string;
const parent = resolve('test-results'); mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, 'activation-fixture-'));
const profile = join(root, 'profile'); const staged = join(root, 'staged');
const delay = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
let desktopBrowser: Browser | undefined; let phoneBrowser: Browser | undefined;
async function disconnectDesktop() { await desktopBrowser?.close(); desktopBrowser = undefined; }
let proxy: Awaited<ReturnType<typeof mobileTlsProxy>> | undefined;
async function freePort() {
  const server = createServer(); await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(done => server.close(() => done())); return port;
}
void (async () => {
  const debug = await freePort(); const mobilePort = await freePort();
  cpSync(buildDir(), staged, { recursive: true });
  // Only Tailscale is replaced; real encrypted storage, loopback API and Electron lifecycle.
  const entry = join(staged, 'main/index.js');
  const prefix = `
const fixtureCp = require('node:child_process'); const fixtureExec = fixtureCp.execFile;
fixtureCp.execFile = function(file, args, opts, cb) {
  if (!/tailscale(?:\\.exe)?$/.test(file)) return fixtureExec.call(this,file,args,opts,cb);
  const result = args[0] === 'status' ? {BackendState:'Running',Self:{Online:true,DNSName:'ade-mobile.fixture.ts.net.'}} :
    {TCP:{'8443':{HTTPS:true}},Web:{'ade-mobile.fixture.ts.net:8443':{Handlers:{'/':{Proxy:'http://127.0.0.1:${mobilePort}'}}}}};
  queueMicrotask(() => cb(null, JSON.stringify(result))); return {};
};
`;
  writeFileSync(entry, prefix + readFileSync(entry, 'utf8'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'ade', version: '0.1.0', main: 'out/main/index.js' }));
  cpSync(staged, join(root, 'out'), { recursive: true });
  let gates = 0;
  const options: LinuxActivationOptions = { repo: root, profile, staged, electron, backupRoot: join(root, 'backups'), label: 'Fixture',
    env: { ...process.env, ADE_USER_DATA_DIR: profile, ADE_MOBILE_PORT: String(mobilePort), ADE_REMOTE_DEBUG_PORT: String(debug), ADE_HOST_API_ENABLED: '0' },
    gate: async () => { gates++; }, readyTimeoutMs: 30_000 };
  mkdirSync(join(root, 'out.activate')); writeFileSync(join(root, 'out.activate/recovery'), 'keep');
  let interrupted = '';
  try { await activateLinux(options); } catch (error) { interrupted = String(error); }
  check('interrupted staging is refused and retained for recovery', interrupted.includes('already exists') && readFileSync(join(root, 'out.activate/recovery'), 'utf8') === 'keep');
  rmSync(join(root, 'out.activate'), { recursive: true });
  const first = await activateLinux(options);
  let badGate = '';
  try { await activateLinux({ ...options, gate: async () => { throw new Error('intended failing gate'); } }); } catch (error) { badGate = String(error); }
  check('failed gate leaves the running owner and build unchanged', badGate.includes('intended failing gate') && profileOwner(profile) === first.pid
    && readFileSync(join(root, 'out/main/index.js'), 'utf8') === readFileSync(entry, 'utf8'));
  check('initial activation runs its gate and reports the profile owner', gates === 1 && profileOwner(profile) === first.pid);
  const duplicate = spawn(electron, [root], { env: options.env, stdio: 'ignore' });
  const duplicateExit = await Promise.race([new Promise<'exited'>(done => duplicate.once('exit', () => done('exited'))), delay(15_000).then(() => 'running' as const)]);
  if (duplicateExit === 'running') duplicate.kill('SIGKILL');
  check('a second launch exits and never becomes a second profile owner', duplicateExit === 'exited' && profileOwner(profile) === first.pid);
  const connect = async () => {
    desktopBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${debug}`);
    const page = desktopBrowser.contexts()[0]!.pages()[0]!;
    await page.waitForFunction(() => Boolean(window.ade)); return page;
  };
  let page = await connect();
  await page.evaluate(() => window.ade.invoke('mobileAccess:setEnabled', { enabled: true, httpsPort: 8443 }));
  const challenge = await page.evaluate(() => window.ade.invoke('mobileAccess:pair'));
  proxy = await mobileTlsProxy(); proxy.target(mobilePort); proxy.rewriteOrigin('https://ade-mobile.fixture.ts.net:8443');
  phoneBrowser = await chromium.launch({ args: ['--ignore-certificate-errors', '--host-resolver-rules=MAP ade-mobile.fixture.ts.net 127.0.0.1'] });
  const phone = await phoneBrowser.newPage({ ignoreHTTPSErrors: true });
  await phone.goto(`${proxy.origin}/#pair=${challenge.code}`);
  await phone.getByLabel('Gerätename', { exact: true }).fill('Activation tablet');
  await phone.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click();
  await phone.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  const device = (await page.evaluate(() => window.ade.invoke('remoteDevices:list'))).devices[0]!.id;
  check('real browser pairs into OS-protected profile', Boolean(device));
  const session = await page.evaluate(() => window.ade.invoke('session:launch', { terminalHome: true, mode: 'shell' }));
  let busy = '';
  try { await activateLinux(options); } catch (error) { busy = String(error); }
  check('active shell refuses activation before gate or swap', busy.includes('preserves all sessions') && gates === 1 && profileOwner(profile) === first.pid);
  const requester = spawn(electron, [root, '--ade-activate-quit'], { env: options.env, stdio: 'ignore' });
  await new Promise<void>(done => requester.once('exit', () => done()));
  await delay(400);
  check('owner independently rejects guarded quit with a live session', profileOwner(profile) === first.pid
    && (await page.evaluate(() => window.ade.invoke('pty:list'))).sessions.some(item => item.id === session.id && item.status === 'running'));
  const marker = join(root, 'shell-survived');
  await page.evaluate(({ id, marker }) => window.ade.invoke('pty:write', { sessionId: id, dataBase64: btoa(`printf preserved > '${marker}'\r`) }), { id: session.id, marker });
  for (let i = 0; i < 50 && !existsSync(marker); i++) await delay(100);
  check('refused update leaves the exact shell writable', existsSync(marker) && readFileSync(marker, 'utf8') === 'preserved' && (await page.evaluate(() => window.ade.invoke('pty:list'))).sessions.some(item => item.id === session.id));
  await page.evaluate(id => window.ade.invoke('pty:kill', { sessionId: id }), session.id);
  await page.waitForFunction(async () => (await window.ade.invoke('pty:list')).sessions.every(item => item.status !== 'running'));
  await disconnectDesktop();
  const old = readFileSync(join(root, 'out/main/index.js'), 'utf8');
  writeFileSync(entry, readFileSync(entry, 'utf8') + '\n// updated fixture build\n');
  const second = await activateLinux(options);
  check('idle owner quits gracefully and the checked build starts', second.pid !== first.pid && profileOwner(profile) === second.pid);
  check('previous executable is retained exactly', readFileSync(join(root, 'out.prev/main/index.js'), 'utf8') === old);
  check('both pre-quit and stable profile backups exist', existsSync(join(second.backup, 'before-quit/ade/config.json')) && existsSync(join(second.backup, 'profile/ade/config.json')));
  page = await connect();
  check('device identity and selected port survive update', (await page.evaluate(() => window.ade.invoke('remoteDevices:list'))).devices.some(item => item.id === device)
    && (await page.evaluate(() => window.ade.invoke('mobileAccess:status'))).httpsPort === 8443);
  await phone.reload(); await phone.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  check('paired browser reconnects after host update without pairing again', true);
  await disconnectDesktop();
  const rollback = await activateLinux({ ...options, rollback: true });
  check('explicit rollback restores the previous build without gate', readFileSync(join(root, 'out/main/index.js'), 'utf8') === old && profileOwner(profile) === rollback.pid && gates === 2);
  writeFileSync(entry, 'process.exit(7);\n' + readFileSync(entry, 'utf8'));
  let broken = '';
  try { await activateLinux(options); } catch (error) { broken = String(error); }
  check('failed new startup triggers automatic rollback', broken.includes('exited before reporting ready') && readFileSync(join(root, 'out/main/index.js'), 'utf8') === old && Boolean(profileOwner(profile)));
  page = await connect();
  await phone.reload(); await phone.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  check('final positive control retains pairing and listener after automatic rollback', (await page.evaluate(() => window.ade.invoke('remoteDevices:list'))).devices.some(item => item.id === device));
  // Process loss versus graceful quit: the restarted owner explains each lost
  // shell by how its predecessor ended, and never resumes or replays it.
  const lifecycle = () => JSON.parse(readFileSync(join(profile, 'ade/lifecycle.json'), 'utf8')) as { cleanAt: number | null };
  const restart = async (end: () => Promise<void>) => {
    const session = await page.evaluate(() => window.ade.invoke('session:launch', { terminalHome: true, mode: 'shell' }));
    await disconnectDesktop(); await end();
    for (let i = 0; i < 150 && profileOwner(profile); i++) await delay(100);
    const ended = lifecycle().cleanAt;
    const child = spawn(electron, [root], { env: options.env, detached: true, stdio: 'ignore' }); child.unref();
    for (let i = 0; i < 300 && profileOwner(profile) !== child.pid; i++) await delay(100);
    // The profile lock precedes the debugging endpoint; retry until the window is reachable.
    for (let attempt = 0; ; attempt++) {
      try { page = await connect(); break; } catch (error) { await disconnectDesktop(); if (attempt >= 100) throw error; await delay(300); }
    }
    const row = (await page.evaluate(() => window.ade.invoke('attention:get'))).rows.find(item => item.id === `history:${session.id}`);
    const live = (await page.evaluate(() => window.ade.invoke('pty:list'))).sessions.some(item => item.id === session.id);
    return { session, ended, row, live };
  };
  // A category leaves first-run onboarding so the desktop overview renders.
  await page.evaluate(() => window.ade.invoke('category:create', { name: 'Recovery' }));
  // Interrupted terminal history is visible only to a device allowed to control terminals.
  await page.evaluate(deviceId => window.ade.invoke('remoteDevices:setAdminScopes', { deviceId, scopes: ['terminal:control', 'workspace:read'], resourceAccess: { mode: 'all' } }), device);
  const crashed = await restart(async () => { process.kill(profileOwner(profile)!, 'SIGKILL'); });
  check('killed owner leaves no clean mark and its shell is reported as an ADE crash, not as live', crashed.ended === null && !crashed.live
    && crashed.row?.group === 'interrupted' && crashed.row.interruption === 'app-crash' && crashed.row.actions.length === 0);
  await page.getByRole('tab', { name: 'Übersicht', exact: true }).click();
  await page.getByTestId('attention-panel').locator(`[data-attention-id="history:${crashed.session.id}"]`)
    .getByText('ADE wurde unerwartet beendet; diese Sitzung endete damit. Es wurde nichts wiederholt.', { exact: true }).waitFor();
  check('desktop names the unexpected stop and that nothing was replayed', true);
  await phone.reload(); await phone.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  // Remote history ids are opaque per device, so the tablet row is found by its interrupted group.
  await phone.getByTestId('attention-panel').locator('[data-attention-group="interrupted"]')
    .getByText('ADE wurde unerwartet beendet; diese Sitzung endete damit. Es wurde nichts wiederholt.', { exact: true }).waitFor();
  check('paired tablet keeps its pairing after the crash and shows the same interruption', true);
  const quit = await restart(async () => {
    const child = spawn(electron, [root, '--ade-quit'], { env: options.env, stdio: 'ignore' });
    await new Promise<void>(done => child.once('exit', () => done()));
  });
  check('graceful quit with a live shell writes the clean mark and is reported as quit', typeof quit.ended === 'number' && !quit.live
    && quit.row?.interruption === 'app-quit' && quit.row.group === 'interrupted');
  check('the earlier crash keeps its own cause after the next restart',
    (await page.evaluate(() => window.ade.invoke('attention:get'))).rows.find(item => item.id === `history:${crashed.session.id}`)?.interruption === 'app-crash');
})().catch(error => { failed++; console.error(error); }).finally(async () => {
  await desktopBrowser?.close(); await phoneBrowser?.close(); await proxy?.close();
  if (profileOwner(profile)) {
    const child = spawn(electron, [root, '--ade-quit'], { env: { ...process.env, ADE_USER_DATA_DIR: profile }, stdio: 'ignore' });
    await new Promise<void>(done => child.once('exit', () => done()));
    for (let i = 0; i < 100 && profileOwner(profile); i++) await delay(100);
  }
  if (!profileOwner(profile)) rmSync(root, { recursive: true, force: true });
  console.log(`Linux activation: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
});
