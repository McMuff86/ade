/** Real Electron relaunch with preserved private browser identity. Only the fixture's Tailscale CLI is replaced. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { _electron as electron, chromium, type ElectronApplication, type Browser, type Page } from 'playwright';
import { mobileTlsProxy } from './helpers/mobileBrowser';

let passed = 0; let failed = 0;
const check = (label: string, ok: boolean): void => { if (ok) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
const root = mkdtempSync(join(tmpdir(), 'ade-restart-electron-'));
const evidence = resolve('test-results/remote'); mkdirSync(evidence, { recursive: true });
let app: ElectronApplication | undefined; let browser: Browser | undefined; let page: Page | undefined;
let proxy: Awaited<ReturnType<typeof mobileTlsProxy>> | undefined;
let originalPid = 0;
void (async () => {
  if (process.platform !== 'win32') throw new Error('Remote relaunch is currently measured on native Windows only');
  const reservation = createServer(); await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
  const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('missing fixture port');
  const port = address.port; await new Promise<void>((done) => reservation.close(() => done()));
  const launcher = join(root, 'launch.cjs'); const pidFile = join(root, 'pids.jsonl');
  // This entry is inherited by Electron relaunch, so both processes use the
  // same simulated private route without touching the operator's Tailscale.
  writeFileSync(launcher, `
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(pidFile)}, JSON.stringify({pid: process.pid, argv: process.argv, execArgv: process.execArgv}) + '\\n');
process.on('uncaughtException', error => fs.appendFileSync(${JSON.stringify(join(root, 'launcher-error.txt'))}, String(error.stack)));
const cp = require('node:child_process'); const original = cp.execFile;
cp.execFile = function(file, args, options, callback) {
  if (!/tailscale(?:\\.exe)?$/i.test(file)) return original.call(this, file, args, options, callback);
  const config = { TCP: {'443': {HTTPS: true}}, Web: {'ade-mobile.fixture.ts.net:443': {Handlers: {'/': {Proxy: 'http://127.0.0.1:${port}'}}}} };
  const output = args[0] === 'status' ? {BackendState: 'Running', Self: {DNSName: 'ade-mobile.fixture.ts.net.', Online: true}} : config;
  queueMicrotask(() => callback(null, JSON.stringify(output))); return {};
};
require(${JSON.stringify(resolve('out/main/index.js'))});
`);
  app = await electron.launch({ args: [launcher], cwd: resolve('.'), timeout: 30_000,
    env: { ...process.env, ADE_USER_DATA_DIR: join(root, 'profile'), ADE_HOST_API_ENABLED: '0', ADE_MOBILE_PORT: String(port), NODE_ENV: 'test' } });
  originalPid = await app.evaluate(() => process.pid);
  const desktop = await app.firstWindow(); desktop.setDefaultTimeout(25_000);
  const duplicateLauncher = join(root, 'duplicate.cjs');
  writeFileSync(duplicateLauncher, `require(${JSON.stringify(resolve('out/main/index.js'))});`);
  const duplicate = spawn(app.process().spawnfile, [duplicateLauncher], { cwd: resolve('.'), windowsHide: true, stdio: 'ignore',
    env: { ...process.env, ADE_USER_DATA_DIR: join(root, 'profile'), ADE_HOST_API_ENABLED: '0', ADE_MOBILE_PORT: String(port), NODE_ENV: 'test' } });
  const duplicateExit = await new Promise<number | null>((done, reject) => {
    const timeout = setTimeout(() => { duplicate.kill(); reject(new Error('duplicate ADE did not relinquish the profile')); }, 15_000);
    duplicate.once('error', (error) => { clearTimeout(timeout); reject(error); });
    duplicate.once('exit', (code) => { clearTimeout(timeout); done(code); });
  });
  check('second Electron launch relinquishes an already-owned profile', duplicateExit === 0);
  check('original owner retains one desktop and its process', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 1 && process.pid) === originalPid);
  await desktop.getByRole('button', { name: 'Settings', exact: true }).click();
  const mobile = desktop.getByTestId('mobile-access');
  await mobile.getByRole('button', { name: 'Mit Tailscale aktivieren' }).click();
  await mobile.getByText('Private Freigabe eingerichtet.', { exact: true }).waitFor();
  await mobile.getByRole('button', { name: 'Tablet oder Smartphone koppeln' }).click();
  const code = await mobile.getByLabel('Einmaliger Pairing-Code').inputValue();
  proxy = await mobileTlsProxy(); proxy.target(port); proxy.rewriteOrigin('https://ade-mobile.fixture.ts.net');
  browser = await chromium.launch({ args: ['--ignore-certificate-errors', '--host-resolver-rules=MAP ade-mobile.fixture.ts.net 127.0.0.1'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  page = await context.newPage(); page.setDefaultTimeout(30_000);
  await page.goto(`${proxy.origin}/#pair=${code}`);
  await page.getByLabel('Gerätename', { exact: true }).fill('Restart phone');
  await page.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByText('Zum Neustarten dieses Gerät am PC unter Settings → Verbundene Geräte freigeben.', { exact: true }).waitFor();
  check('paired browser cannot restart without desktop permission', await page.getByRole('button', { name: 'ADE neu starten', exact: true }).isDisabled());
  await desktop.getByRole('button', { name: 'Geräte aktualisieren', exact: true }).click();
  const permissions = desktop.getByRole('group', { name: 'Verwaltungsrechte für Restart phone', exact: true });
  await permissions.getByRole('checkbox', { name: 'ADE neu starten', exact: true }).check();
  await permissions.getByRole('button', { name: 'Verwaltungsrechte speichern', exact: true }).click();
  await desktop.getByText('Verwaltungsrechte gespeichert. Das Gerät verbindet sich erneut.', { exact: true }).waitFor();
  check('desktop grant restores keyboard focus to a stable control', await desktop.getByRole('button', { name: 'Geräte aktualisieren', exact: true }).evaluate((node) => node === document.activeElement));
  await page.waitForFunction(() => !(Array.from(document.querySelectorAll('button')).find((item) => item.textContent === 'ADE neu starten') as HTMLButtonElement | undefined)?.disabled);
  check('same paired browser regains its session after permission change', await page.getByRole('button', { name: 'ADE neu starten', exact: true }).isEnabled());
  await page.getByRole('button', { name: 'ADE neu starten', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'ADE auf dem PC neu starten?', exact: true });
  check('restart confirmation takes focus', await confirmation.evaluate((node) => node.contains(document.activeElement)));
  await confirmation.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  check('cancel returns focus to restart opener without restarting', await page.getByRole('button', { name: 'ADE neu starten', exact: true }).evaluate((node) => node === document.activeElement)
    && readFileSync(pidFile, 'utf8').trim().split('\n').length === 1);
  await page.getByRole('button', { name: 'ADE neu starten', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Neustart bestätigen', exact: true }).click();
  await page.getByText('ADE wurde neu gestartet und ist wieder erreichbar.', { exact: true }).waitFor({ timeout: 60_000 });
  const processes = readFileSync(pidFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { pid: number });
  check('real Electron relaunch replaces the process exactly once', processes.length === 2 && processes[0]!.pid === originalPid && processes[1]!.pid !== originalPid);
  check('browser confirms a new authenticated host instance', await page.getByText('ADE wurde neu gestartet und ist wieder erreichbar.', { exact: true }).isVisible());
  await page.keyboard.press('Escape');
  await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  check('event stream reconnects after the actual process restart', true);
  await page.reload(); await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  check('page reload keeps the original paired identity', await page.getByRole('button', { name: 'Neue Aufgabe', exact: true }).isVisible());
  const vault = JSON.parse(readFileSync(join(root, 'profile', 'ade', 'remote', 'devices.json'), 'utf8')) as { devices: Array<{ adminScopes?: string[] }> };
  check('same profile keeps one device and its granted permission', vault.devices.length === 1 && vault.devices[0]!.adminScopes?.includes('host:restart') === true);
  await page.screenshot({ path: join(evidence, 'restart-reconnected.png'), fullPage: true });
})().catch(async (error) => {
  failed++; console.error(error);
  for (const file of ['pids.jsonl', 'launcher-error.txt', 'profile/ade/logs/main.log']) {
    try { console.error(file, readFileSync(join(root, file), 'utf8').slice(-6000)); } catch { /* Missing diagnostic. */ }
  }
  await page?.screenshot({ path: join(evidence, 'restart-failure.png') }).catch(() => undefined);
})
  .finally(async () => {
    await browser?.close(); await proxy?.close(); await app?.close().catch(() => undefined);
    try {
      for (const line of readFileSync(join(root, 'pids.jsonl'), 'utf8').trim().split('\n')) {
        const { pid } = JSON.parse(line) as { pid: number };
        if (Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid) try {
          execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        } catch { /* Already exited. */ }
      }
    } catch { /* Launcher did not start. */ }
    if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('unexpected fixture root');
    // The relaunch helper may still be releasing handles after process exit.
    try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
    catch { failed++; console.error('FAIL  fixture cleanup left locked files at its temporary root'); }
    console.log(`\nRemote restart Electron: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
  });
