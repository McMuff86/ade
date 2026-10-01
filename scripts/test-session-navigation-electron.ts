/** Real platform-native shells, Electron and paired tablet; no agent CLI or model required. */
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { _electron as electron, chromium, type ElectronApplication, type Browser, type Page } from 'playwright';
import { mainEntry } from './helpers/buildOutput';
import { mobileTlsProxy } from './helpers/mobileBrowser';
import { sessionNavigationFlow } from './helpers/sessionNavigationFlow';
import { posixProfileFixture } from './helpers/posixProfileFixture';
import { linuxAgentTabletFlow } from './helpers/linuxAgentTabletFlow';
import { runQuestionFlow } from './helpers/runQuestionFlow';
import { DEFAULT_CONFIG } from '../src/shared/types';

let passed = 0; let failed = 0;
const check = (label: string, ok: boolean): void => {
  if (ok) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`FAIL  ${label}`); }
};
const root = mkdtempSync(join(tmpdir(), 'ade-session-navigation-'));
const agentTablet = process.argv.includes('--agent-tablet');
const evidence = resolve(agentTablet ? 'test-results/linux-agent-tablet' : 'test-results/session-navigation'); mkdirSync(evidence, { recursive: true });
const bin = join(root, 'bin'); const proofs = join(root, 'proofs');
if (agentTablet) { posixProfileFixture(bin); mkdirSync(proofs); }
let app: ElectronApplication | undefined; let browser: Browser | undefined;
let desktop: Page | undefined; let tablet: Page | undefined;
let proxy: Awaited<ReturnType<typeof mobileTlsProxy>> | undefined;

void (async () => {
  const reservation = createServer();
  await new Promise<void>((done, fail) => {
    reservation.once('error', fail);
    reservation.listen(0, '127.0.0.1', done);
  });
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const port = address.port;
  await new Promise<void>(done => reservation.close(() => done()));
  // Replace only the external transport dependency. The real host, device store,
  // authorization, PTYs and UI stay in use. No production test switch.
  const launcher = join(root, 'launch.cjs');
  const routeEvidence = join(root, 'serve.json');
  const home = join(root, 'terminal-home'); mkdirSync(home);
  if (agentTablet) {
    const profile = join(root, 'profile', 'ade'); mkdirSync(profile, { recursive: true });
    const config = structuredClone(DEFAULT_CONFIG);
    config.sessionBookends = [{ id: 'orphan-before-host-restart', agentId: 'removed-profile', agentName: 'Interrupted fixture', runtime: 'codex',
      repositoryId: null, repositoryName: null, startedAt: 1, endedAt: null }];
    writeFileSync(join(profile, 'config.json'), JSON.stringify(config));
  }
  writeFileSync(launcher, `
require('node:os').homedir = () => ${JSON.stringify(home)};
const cp = require('node:child_process'); const original = cp.execFile;
const foreign = {TCP:{'443':{HTTPS:true}},Web:{'ade-mobile.fixture.ts.net:443':{Handlers:{'/':{Proxy:'http://127.0.0.1:35855'}}}}};
let config = {Foreground:{other:foreign},TCP:{},Web:{}};
cp.execFile = function(file, args, options, callback) {
  if (!/tailscale(?:\\.exe)?$/i.test(file)) return original.call(this, file, args, options, callback);
  let output = '';
  if (args[0] === 'status') output = JSON.stringify({BackendState:'Running',Self:{DNSName:'ade-mobile.fixture.ts.net.',Online:true}});
  else if (args[1] === 'status') output = JSON.stringify(config);
  else {
    const selected = args.find(arg => arg.startsWith('--https=')).slice(8);
    if (selected !== '8443') throw new Error('Fixture refuses mutations outside ADE port 8443');
    if (args.includes('off')) { delete config.TCP[selected]; delete config.Web['ade-mobile.fixture.ts.net:' + selected]; }
    else { config.TCP[selected] = {HTTPS:true}; config.Web['ade-mobile.fixture.ts.net:' + selected] = {Handlers:{'/':{Proxy:'http://127.0.0.1:${port}'}}}; }
    require('node:fs').writeFileSync(${JSON.stringify(routeEvidence)}, JSON.stringify(config));
  }
  queueMicrotask(() => callback(null, output)); return {};
};
cp.execFile[require('node:util').promisify.custom] = (file, args, options) => new Promise((done, fail) =>
  cp.execFile(file, args, options, (error, stdout, stderr) => error ? fail(error) : done({stdout, stderr})));
require(${JSON.stringify(mainEntry())});
`);
  app = await electron.launch({ args: [launcher], cwd: resolve('.'), timeout: 30_000,
    env: { ...process.env, ...(agentTablet ? { PATH: `${bin}:${process.env.PATH}`, ADE_PROFILE_FIXTURE_PROOFS: proofs } : {}),
      ADE_USER_DATA_DIR: join(root, 'profile'), ADE_HOST_API_ENABLED: '0', ADE_MOBILE_PORT: String(port), NODE_ENV: 'test' } });
  desktop = await app.firstWindow(); desktop.setDefaultTimeout(30_000);
  // A deliberately hidden/reopened fixture may remain occluded by the test
  // runner on Wayland. Keep its animation clock live for Playwright actions.
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.setBackgroundThrottling(false); });
  await desktop.evaluate(() => window.ade.invoke('category:create', { name: 'Overview fixture' }));
  await desktop.getByRole('tab', { name: 'Übersicht', exact: true }).click();
  const initialDecisions = desktop.getByTestId('attention-panel');
  if (agentTablet) {
    const lost = initialDecisions.locator('[data-attention-group="interrupted"] [data-attention-id="history:orphan-before-host-restart"]');
    await lost.waitFor();
    check('startup recovery marks a lost process interrupted without offering a fabricated resume', await lost.getByRole('button').isDisabled()
      && (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.length === 0);
  } else {
    await initialDecisions.getByText('Noch keine aktuellen Entscheidungen oder aufgezeichnete Arbeit.', { exact: true }).waitFor();
    check('fresh desktop decision overview has a useful empty state', await initialDecisions.locator('[data-attention-id]').count() === 0);
  }
  await desktop.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  const operation = desktop.getByTestId('host-operation');
  const awake = operation.getByRole('checkbox', { name: 'Während offener Sitzungen und aktiver Arbeit Wachhalten anfordern', exact: true });
  await awake.waitFor();
  check('operating settings load with sleep prevention off and isolated autostart unavailable', !await awake.isChecked()
    && await operation.getByRole('checkbox', { name: 'ADE bei der Desktop-Anmeldung öffnen', exact: true }).isDisabled());
  await awake.focus(); await desktop.keyboard.press('Space');
  await operation.getByTestId('sleep-prevention').getByText('Keine aktive Arbeit; Wachhalten freigegeben.', { exact: true }).waitFor();
  check('keyboard opt-in remains idle without sessions', await awake.isChecked());
  await desktop.getByRole('navigation', { name: 'Einstellungsbereiche', exact: true }).getByRole('button', { name: 'Betrieb und Start', exact: true }).click();
  await desktop.waitForFunction(() => document.activeElement?.tagName === 'H3' && document.activeElement.textContent === 'Betrieb und Start');
  await desktop.screenshot({ path: join(evidence, 'operation-settings.png') });
  await operation.getByRole('checkbox', { name: 'ADE beim Schließen des Fensters im Tray behalten', exact: true }).click();
  await desktop.waitForFunction(async () => (await window.ade.invoke('hostOperation:get')).keepInTray);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle().toLowerCase().includes('ade'))?.close());
  check('optional tray keeps Electron alive after desktop close without mobile access', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => !window.isVisible())));
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows().find(window => !window.isVisible()); window?.show(); window?.focus(); });
  await operation.getByRole('checkbox', { name: 'ADE beim Schließen des Fensters im Tray behalten', exact: true }).click();
  await desktop.waitForFunction(async () => !(await window.ade.invoke('hostOperation:get')).keepInTray);
  const mobile = desktop.getByTestId('mobile-access');
  await mobile.getByRole('button', { name: 'Mit Tailscale aktivieren' }).click();
  await mobile.getByText(/HTTPS-Port 443 ist belegt/).waitFor();
  check('occupied default port explains the conflict without a stack trace', !(await mobile.innerText()).includes('MobileAccessController.setEnabled')
    && await mobile.getByRole('button', { name: 'Tablet oder Smartphone koppeln' }).isDisabled());
  await mobile.getByLabel('ADE-HTTPS-Port', { exact: true }).selectOption('8443');
  await mobile.getByRole('button', { name: 'Mit Tailscale aktivieren' }).click();
  await mobile.getByText('Private Freigabe eingerichtet.', { exact: true }).waitFor();
  check('desktop shows the complete alternate address and locks the active port', await mobile.getByLabel('Mobile ADE-Adresse').inputValue() === 'https://ade-mobile.fixture.ts.net:8443'
    && await mobile.getByLabel('ADE-HTTPS-Port', { exact: true }).isDisabled());
  check('activation returns keyboard focus to connection status', await mobile.getByRole('button', { name: 'Verbindung prüfen', exact: true }).evaluate(node => node === document.activeElement));
  await mobile.getByRole('button', { name: 'Tablet oder Smartphone koppeln' }).click();
  const code = await mobile.getByLabel('Einmaliger Pairing-Code').inputValue();
  check('pairing link keeps the selected HTTPS port', (await mobile.getByLabel('Einmaliger Pairing-Link').inputValue()).startsWith('https://ade-mobile.fixture.ts.net:8443/#pair='));
  proxy = await mobileTlsProxy(); proxy.target(port); proxy.rewriteOrigin('https://ade-mobile.fixture.ts.net:8443');
  browser = await chromium.launch({ args: ['--ignore-certificate-errors', '--host-resolver-rules=MAP ade-mobile.fixture.ts.net 127.0.0.1'] });
  tablet = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: true, ignoreHTTPSErrors: true });
  tablet.setDefaultTimeout(30_000);
  await tablet.goto(`${proxy.origin}/#pair=${code}`);
  await tablet.getByLabel('Gerätename', { exact: true }).fill('Session tablet');
  await tablet.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click();
  await tablet.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await desktop.getByRole('button', { name: 'Geräte aktualisieren', exact: true }).click();
  const grants = desktop.getByRole('group', { name: 'Verwaltungsrechte für Session tablet', exact: true });
  await grants.getByRole('checkbox', { name: 'Workspace-Dateien und Git-Diffs lesen', exact: true }).check();
  await grants.getByRole('checkbox', { name: /Interaktive Terminals steuern/ }).check();
  await grants.getByRole('button', { name: 'Verwaltungsrechte speichern', exact: true }).click();
  await desktop.getByText('Verwaltungsrechte gespeichert. Das Gerät verbindet sich erneut.', { exact: true }).waitFor();
  await desktop.keyboard.press('Escape');
  if (agentTablet) {
    await linuxAgentTabletFlow(desktop, tablet, root, proofs, evidence, proxy, check);
    await runQuestionFlow(app, desktop, tablet, root, evidence, check, proofs);
    await desktop.keyboard.press('Escape');
  } else await sessionNavigationFlow(desktop, tablet, root, check, true);
  // kill acknowledges the signal; the PTY exit event removes the session later.
  await desktop.waitForFunction(async () => (await window.ade.invoke('pty:list')).sessions.every(session => session.status !== 'running'));
  check('all fixture shells are stopped after the flow', (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.every(session => session.status !== 'running'));
  check('sleep inhibitor releases after all fixture sessions end', (await desktop.evaluate(() => window.ade.invoke('hostOperation:get'))).sleepPrevention === 'idle');
  await desktop.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await mobile.getByRole('button', { name: 'Mobilen Zugriff ausschalten', exact: true }).click();
  await mobile.getByText('Mobiler Zugriff ist ausgeschaltet.', { exact: true }).first().waitFor();
  const remaining = JSON.parse(readFileSync(routeEvidence, 'utf8'));
  check('desktop opt-out preserves the foreign 443 route and removes only 8443', remaining.Foreground.other.Web['ade-mobile.fixture.ts.net:443'].Handlers['/'].Proxy === 'http://127.0.0.1:35855'
    && !remaining.TCP['8443'] && !remaining.Web['ade-mobile.fixture.ts.net:8443']);
  check('inactive port selection remains persisted and editable', await mobile.getByLabel('ADE-HTTPS-Port', { exact: true }).inputValue() === '8443'
    && await mobile.getByLabel('ADE-HTTPS-Port', { exact: true }).isEnabled());
})().catch(async error => {
  failed++; console.error(error);
  for (const [source, name] of [['logs/main.log', 'failure-main.log'], ['remote/audit.jsonl', 'failure-audit.jsonl']]) {
    try { copyFileSync(join(root, 'profile', 'ade', source), join(evidence, name)); } catch { /* A failed startup may not have created these logs. */ }
  }
  await desktop?.screenshot({ path: join(evidence, 'failure-desktop.png') }).catch(() => undefined);
  await tablet?.screenshot({ path: join(evidence, 'failure-tablet.png') }).catch(() => undefined);
}).finally(async () => {
  await browser?.close().catch(() => undefined);
  await app?.close().catch(() => undefined);
  await proxy?.close();
  await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
  console.log(`Session navigation Electron (${process.platform}): ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
});
