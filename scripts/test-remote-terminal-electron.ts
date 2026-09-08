import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { execFileSync } from 'node:child_process';
import { _electron as electron, chromium, type ElectronApplication, type Browser, type Page } from 'playwright';
import { mobileTlsProxy } from './helpers/mobileBrowser';
import { PNG } from 'pngjs';

let passed = 0; let failed = 0;
const check = (label: string, ok: boolean): void => { if (ok) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-terminal-electron-'))); const evidence = resolve('test-results/remote'); mkdirSync(evidence, { recursive: true });
let app: ElectronApplication | undefined; let browser: Browser | undefined; let page: Page | undefined;
let proxy: Awaited<ReturnType<typeof mobileTlsProxy>> | undefined;
void (async () => {
  if (process.platform !== 'win32') throw new Error('Remote terminal runtime evidence currently requires native Windows');
  const reservation = createServer(); await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
  const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('missing port');
  const port = address.port; await new Promise<void>((done) => reservation.close(() => done()));
  const repoPath = join(root, 'repository'); mkdirSync(repoPath);
  execFileSync('git', ['init', '--initial-branch=main', repoPath], { windowsHide: true });
  execFileSync('git', ['-C', repoPath, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-m', 'Fixture'], { windowsHide: true });
  const launcher = join(root, 'launch.cjs');
  writeFileSync(launcher, `
const cp = require('node:child_process'); const original = cp.execFile;
cp.execFile = function(file, args, options, callback) {
  if (!/tailscale(?:\\.exe)?$/i.test(file)) return original.call(this, file, args, options, callback);
  const config = {TCP: {'443': {HTTPS: true}}, Web: {'ade-mobile.fixture.ts.net:443': {Handlers: {'/': {Proxy: 'http://127.0.0.1:${port}'}}}}};
  queueMicrotask(() => callback(null, JSON.stringify(args[0] === 'status' ? {BackendState:'Running',Self:{DNSName:'ade-mobile.fixture.ts.net.',Online:true}} : config))); return {};
};
cp.execFile[require('node:util').promisify.custom] = (file, args, options) => new Promise((done, fail) =>
  cp.execFile(file, args, options, (error, stdout, stderr) => error ? fail(error) : done({stdout, stderr})));
require(${JSON.stringify(resolve('out/main/index.js'))});
`);
  app = await electron.launch({ args: [launcher], cwd: resolve('.'), timeout: 30_000,
    env: { ...process.env, ADE_USER_DATA_DIR: join(root, 'profile'), ADE_HOST_API_ENABLED: '0', ADE_MOBILE_PORT: String(port), NODE_ENV: 'test' } });
  const desktop = await app.firstWindow(); desktop.setDefaultTimeout(30_000);
  const setup = await desktop.evaluate(async (path) => {
    const repo = await window.ade.invoke('repository:import', { path, name: 'Terminal project', executionBackend: 'native' });
    const category = await window.ade.invoke('category:create', { name: 'Remote tests' });
    const agent = await window.ade.invoke('agent:create', { categoryId: category.id, name: 'Terminal Agent', runtime: 'custom', permissionMode: 'default', defaultRepositoryId: repo.id,
      customCommand: "Write-Output 'ADE_CONFIGURED_AGENT_READY'" });
    const session = await window.ade.invoke('pty:create', { agentId: agent.id, repositoryId: repo.id });
    return { agent, repo, session };
  }, repoPath);
  await desktop.reload(); await desktop.getByRole('button', { name: 'Settings', exact: true }).click();
  const mobile = desktop.getByTestId('mobile-access');
  await mobile.getByRole('button', { name: 'Mit Tailscale aktivieren' }).click();
  await mobile.getByText('Private Freigabe eingerichtet.', { exact: true }).waitFor();
  await mobile.getByRole('button', { name: 'Tablet oder Smartphone koppeln' }).click();
  const code = await mobile.getByLabel('Einmaliger Pairing-Code').inputValue();
  proxy = await mobileTlsProxy(); proxy.target(port); proxy.rewriteOrigin('https://ade-mobile.fixture.ts.net');
  browser = await chromium.launch({ args: ['--ignore-certificate-errors', '--host-resolver-rules=MAP ade-mobile.fixture.ts.net 127.0.0.1'] });
  page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true, ignoreHTTPSErrors: true }); page.setDefaultTimeout(60_000);
  await page.goto(`${proxy.origin}/#pair=${code}`); await page.getByLabel('Gerätename', { exact: true }).fill('Terminal tablet');
  await page.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await page.getByRole('button', { name: 'Workspace für Terminal Agent', exact: true }).click();
  const workspace = page.getByRole('dialog', { name: 'Workspace · Terminal Agent', exact: true });
  await workspace.getByRole('button', { name: 'Terminal', exact: true }).click();
  await workspace.getByRole('region', { name: 'Interaktives Terminal', exact: true }).getByRole('alert').waitFor();
  check('paired tablet cannot inspect terminals without dedicated grant', true);
  await desktop.getByRole('button', { name: 'Geräte aktualisieren', exact: true }).click();
  const grants = desktop.getByRole('group', { name: 'Verwaltungsrechte für Terminal tablet', exact: true });
  await grants.getByRole('checkbox', { name: 'Workspace-Dateien und Git-Diffs lesen', exact: true }).check();
  await grants.getByRole('checkbox', { name: /Interaktive Terminals steuern/ }).check();
  check('desktop grant explains actual Windows-user authority', (await grants.innerText()).includes('keine Sandbox'));
  await grants.getByRole('button', { name: 'Verwaltungsrechte speichern', exact: true }).click();
  await workspace.getByLabel('Terminal-Sitzung', { exact: true }).locator('option').filter({ hasText: 'läuft' }).waitFor({ state: 'attached' });
  const terminalId = await workspace.getByLabel('Terminal-Sitzung', { exact: true }).locator('option').nth(1).getAttribute('value');
  await workspace.getByLabel('Terminal-Sitzung', { exact: true }).selectOption(terminalId!);
  await workspace.getByLabel('Terminalanzeige', { exact: true }).getByText('ADE_CONFIGURED_AGENT_READY', { exact: false }).waitFor();
  check('tablet attaches a real desktop-started configured session', true);
  await workspace.getByRole('button', { name: 'Eingabe übernehmen', exact: true }).click();
  await workspace.getByText('Du steuerst die Eingabe.', { exact: true }).waitFor();
  const blocked = await desktop.evaluate(async (id) => {
    try { await window.ade.invoke('pty:write', { sessionId: id, dataBase64: btoa('SHOULD_NOT_RUN\r') }); return false; } catch { return true; }
  }, setup.session.id);
  check('main rejects desktop typing while tablet owns input', blocked);
  await workspace.getByLabel('Terminal-Eingabe', { exact: true }).fill("Set-Content -LiteralPath 'terminal-proof.txt' -Value 'ADE_TABLET_OK'");
  await workspace.getByRole('button', { name: 'Text und Enter senden', exact: true }).click();
  const proof = join(setup.session.workspaceDir!, 'terminal-proof.txt');
  const deadline = Date.now() + 60_000; while (!existsSync(proof) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 200));
  check('real tablet input writes in the exact agent workspace', existsSync(proof) && readFileSync(proof, 'utf8').includes('ADE_TABLET_OK') && !existsSync(join(repoPath, 'terminal-proof.txt')));
  await desktop.keyboard.press('Escape');
  await desktop.getByRole('tab', { name: 'Terminals view', exact: true }).click();
  await desktop.locator('.agent-row', { hasText: 'Terminal Agent' }).click();
  await desktop.getByRole('button', { name: 'Eingabe am Desktop übernehmen', exact: true }).click();
  await workspace.getByText('Der Desktop steuert die Eingabe.', { exact: true }).waitFor();
  check('desktop takeover disables tablet input', await workspace.getByRole('button', { name: 'Text und Enter senden', exact: true }).isDisabled());
  await workspace.getByRole('button', { name: 'Shell öffnen', exact: true }).click();
  await workspace.getByText('Du steuerst die Eingabe.', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.m-terminal-screen')?.textContent?.includes('PS '));
  const newSession = await desktop.evaluate(() => window.ade.invoke('pty:list'));
  check('remote shell opens independently without starting configured agent command', newSession.sessions.length === 2 && newSession.sessions.some((session) => session.title === 'Shell')
    && !(await workspace.getByLabel('Terminalanzeige', { exact: true }).innerText()).includes('ADE_CONFIGURED_AGENT_READY'));
  check('terminal screen removes absolute Windows paths', !/[A-Za-z]:[\\/]/.test(await workspace.getByLabel('Terminalanzeige', { exact: true }).innerText()));
  await page.screenshot({ path: join(evidence, 'terminal-tablet.png') });
  const shellId = await workspace.getByLabel('Terminal-Sitzung', { exact: true }).inputValue();
  await page.reload(); await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await page.getByRole('button', { name: 'Workspace für Terminal Agent', exact: true }).click(); await workspace.getByRole('button', { name: 'Terminal', exact: true }).click();
  await workspace.getByLabel('Terminal-Sitzung', { exact: true }).selectOption(shellId);
  await workspace.getByLabel('Terminalanzeige', { exact: true }).waitFor();
  check('browser reload reconnects without creating a third process', (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.length === 2);
  await page.setViewportSize({ width: 390, height: 844 });
  check('phone terminal controls stay within the workspace width', await workspace.evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
  await page.screenshot({ path: join(evidence, 'terminal-phone.png') });
  await page.setViewportSize({ width: 1024, height: 768 });
  await workspace.getByRole('button', { name: 'Agent starten', exact: true }).click();
  await workspace.getByLabel('Terminalanzeige', { exact: true }).getByText('ADE_CONFIGURED_AGENT_READY', { exact: false }).waitFor();
  const agentTerminal = await workspace.getByLabel('Terminal-Sitzung', { exact: true }).inputValue();
  check('tablet starts the configured agent command in a new real PTY', agentTerminal !== shellId
    && (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.length === 3);
  await workspace.getByRole('button', { name: 'Sitzung beenden', exact: true }).click();
  await page.getByRole('dialog', { name: 'Terminalsitzung beenden', exact: true }).getByRole('button', { name: 'Beenden bestätigen', exact: true }).click();
  await workspace.getByText('Sitzung beendet.', { exact: true }).waitFor();
  check('confirmed tablet close stops only the selected process', (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.filter((session) => session.status === 'running').length === 2);
  await workspace.getByLabel('Terminal-Sitzung', { exact: true }).selectOption(shellId);
  await workspace.getByLabel('Terminalanzeige', { exact: true }).waitFor();
  await desktop.getByRole('button', { name: 'Settings', exact: true }).click();
  await desktop.getByRole('button', { name: 'Geräte aktualisieren', exact: true }).click();
  await grants.getByRole('checkbox', { name: /Interaktive Terminals steuern/ }).uncheck(); await grants.getByRole('button', { name: 'Verwaltungsrechte speichern', exact: true }).click();
  await workspace.getByRole('region', { name: 'Interaktives Terminal', exact: true }).getByRole('alert').waitFor();
  check('revocation removes screen and further tablet control', !await workspace.getByLabel('Terminal-Eingabe', { exact: true }).count());
  await desktop.getByRole('button', { name: 'Geräte aktualisieren', exact: true }).click();
  await grants.getByRole('checkbox', { name: 'Agent-Namen, Rollen und Profilbilder bearbeiten', exact: true }).check();
  await grants.getByRole('button', { name: 'Verwaltungsrechte speichern', exact: true }).click();
  await workspace.getByRole('button', { name: 'Agent-Profil', exact: true }).click();
  const picture = new PNG({ width: 24, height: 24 }); picture.data.fill(170);
  await workspace.getByLabel('Profilbild auswählen', { exact: true }).setInputFiles({ name: 'tablet-photo.png', mimeType: 'image/png', buffer: PNG.sync.write(picture) });
  await workspace.getByRole('img', { name: 'Profilbild-Vorschau', exact: true }).waitFor();
  await workspace.getByLabel('Profil-Rolle', { exact: true }).fill('Tablet operator');
  await workspace.getByRole('button', { name: 'Profil speichern', exact: true }).click();
  await workspace.getByRole('button', { name: 'Profilbild entfernen', exact: true }).waitFor();
  const until = Date.now() + 15_000; let photo = '';
  while (!photo && Date.now() < until) {
    photo = await desktop.evaluate(async (id) => (await window.ade.invoke('config:get')).agents.find((agent) => agent.id === id)?.photo ?? '', setup.agent.id);
    if (!photo) await new Promise((done) => setTimeout(done, 150));
  }
  check('real Electron decoder stores the uploaded profile photo for desktop', !!photo && existsSync(join(root, 'profile/ade/photos', photo)));
  const profileStored = await desktop.evaluate(async (id) => (await window.ade.invoke('config:get')).agents.find((agent) => agent.id === id), setup.agent.id);
  check('shared profile keeps configured runtime while updating role', profileStored?.role === 'Tablet operator' && profileStored.customCommand === setup.agent.customCommand);
  await page.screenshot({ path: join(evidence, 'terminal-grant-revoked.png') });
})().catch(async (error) => {
  failed++; console.error(error); await page?.screenshot({ path: join(evidence, 'terminal-failure.png') }).catch(() => undefined);
  try { console.error(readFileSync(join(root, 'profile/ade/logs/main.log'), 'utf8').slice(-2500)); } catch { /* no log */ }
}).finally(async () => {
  await browser?.close(); await proxy?.close(); await app?.close().catch(() => undefined);
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  console.log(`Remote terminal Electron: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
});
