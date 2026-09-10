/** Current production UI with isolated demo data. No real Tailscale changes or model calls.
 * Native Windows: pnpm build && pnpm exec tsx scripts/capture-user-guide.ts
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { _electron as electron, chromium, type Browser, type ElectronApplication, type Locator, type Page } from 'playwright';
import { mobileTlsProxy } from './helpers/mobileBrowser';

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-guide-')));
const output = resolve('docs/media/user-guide');
mkdirSync(output, { recursive: true });
let app: ElectronApplication | undefined;
let browser: Browser | undefined;
let proxy: Awaited<ReturnType<typeof mobileTlsProxy>> | undefined;
const captures: string[] = [];
async function capture(name: string, target: Page | Locator): Promise<void> {
  if ('url' in target && target.url().startsWith('https://')) {
    await target.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  }
  await target.screenshot({ path: join(output, name), animations: 'disabled' });
  captures.push(name); console.log(`Captured ${name}`);
}

void (async () => {
  if (process.platform !== 'win32') throw new Error('This capture fixture requires native Windows.');
  const bin = join(root, 'bin'); mkdirSync(bin);
  const compile = join(root, 'compile.ps1');
  writeFileSync(compile, String.raw`param([string]$Target)
$ErrorActionPreference = 'Stop'
Add-Type -OutputAssembly $Target -OutputType ConsoleApplication -TypeDefinition @'
using System;
public class Demo { public static void Main(string[] args) {
  string joined = String.Join(" ", args);
  if (joined.Contains("version")) { Console.WriteLine("ADE documentation fixture 1.0"); return; }
  if (joined.Contains("login") || joined.Contains("auth")) { Console.WriteLine("Logged in using ChatGPT (local fixture)"); return; }
  if (joined.Contains("models")) { Console.WriteLine("Local documentation fixture; no provider models"); return; }
  Console.Write("\u001b[?1049h\u001b[2J\u001b[H\u001b[36mADE | Lokale Terminal-Demo\u001b[0m\r\n\r\n");
  Console.Write("Beispielausgabe fuer den User-Guide. Keine Modellanfrage.\r\n\r\n");
  Console.Write("Beispielaufgabe: Eine kleine App vorbereiten\r\n\r\n1. Ziel beschreiben\r\n2. Vorschlag pruefen\r\n3. Aenderungen testen und sichern\r\n\r\n> ");
  for (;;) { var key = Console.ReadKey(true); if (key.KeyChar == 'q') break; Console.Write(key.KeyChar); }
  Console.Write("\u001b[?1049l");
} }
'@
`);
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', compile, join(bin, 'fixture.exe')], { windowsHide: true, timeout: 30_000 });
  for (const cli of ['codex', 'claude', 'grok', 'hermes']) copyFileSync(join(bin, 'fixture.exe'), join(bin, `${cli}.exe`));
  const reservation = createServer(); await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
  const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const port = address.port; await new Promise<void>((done) => reservation.close(() => done()));
  const repos = join(root, 'repos'); mkdirSync(repos);
  const repository = join(repos, 'gartenplaner'); mkdirSync(repository);
  writeFileSync(join(repository, 'README.md'), '# Gartenplaner\n\nEine kleine App zum Planen von Beeten und Pflanzterminen.\n');
  execFileSync('git', ['init', '--initial-branch=main', repository], { windowsHide: true });
  execFileSync('git', ['-C', repository, 'add', 'README.md'], { windowsHide: true });
  execFileSync('git', ['-C', repository, '-c', 'user.name=ADE Demo', '-c', 'user.email=demo@localhost', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Start Gartenplaner'], { windowsHide: true });
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
    env: { ...process.env, Path: `${bin};${process.env.Path ?? process.env.PATH}`, ADE_USER_DATA_DIR: join(root, 'profile'), ADE_HOST_API_ENABLED: '0', ADE_MOBILE_PORT: String(port), NODE_ENV: 'test' } });
  const desktop = await app.firstWindow(); desktop.setDefaultTimeout(25_000);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1360, 1000));
  await desktop.evaluate(async ({ repository, root, executable }) => {
    const repo = await window.ade.invoke('repository:import', { path: repository, name: 'Gartenplaner', executionBackend: 'native' });
    const category = await window.ade.invoke('category:create', { name: 'Meine Agents' });
    const agent = await window.ade.invoke('agent:create', { categoryId: category.id, name: 'Codex Entwicklung', runtime: 'codex', permissionMode: 'default', defaultRepositoryId: repo.id });
    for (const [name, port] of [['Hermes General', 9443], ['Sentinel', 8443]] as const) {
      const a = await window.ade.invoke('agent:create', { categoryId: category.id, name, runtime: 'custom', permissionMode: 'default', customCommand: `& '${executable.replace(/'/g, "''")}'` });
      await window.ade.invoke('agent:update', { id: a.id, name, runtime: a.runtime, permissionMode: a.permissionMode, customCommand: a.customCommand,
        homeWorkspaceDir: root + '/' + name.replace(/ /g, '-'), dashboardUrl: `https://assistant.fixture.ts.net:${port}/` });
    }
    return { agentId: agent.id, repoId: repo.id };
  }, { repository, root, executable: join(bin, 'fixture.exe') });
  await desktop.reload(); await desktop.getByRole('tab', { name: 'Overview view', exact: true }).click();
  await desktop.getByRole('button', { name: 'Terminal öffnen: Hermes General', exact: true }).waitFor();
  await capture('01-desktop-overview.png', desktop);
  await desktop.getByRole('button', { name: 'Settings', exact: true }).click();
  const defaults = desktop.getByTestId('project-defaults');
  await defaults.getByLabel('Projekt-Stammordner', { exact: true }).fill(repos);
  await defaults.getByRole('button', { name: 'Projektstart speichern', exact: true }).click();
  await defaults.getByRole('status').waitFor();
  // Mask the fixture's transient absolute path, never edit the production DOM to stage screenshots.
  await defaults.screenshot({ path: join(output, '02-project-defaults.png'), mask: [defaults.getByLabel('Projekt-Stammordner', { exact: true })], maskColor: '#353b45' });
  captures.push('02-project-defaults.png');
  const mobile = desktop.getByTestId('mobile-access');
  await mobile.getByRole('button', { name: 'Mit Tailscale aktivieren' }).click();
  await mobile.getByText('Private Freigabe eingerichtet.', { exact: true }).waitFor();
  await capture('03-mobile-access.png', mobile);
  await mobile.getByRole('button', { name: 'Tablet oder Smartphone koppeln' }).click();
  const code = await mobile.getByLabel('Einmaliger Pairing-Code').inputValue();
  await mobile.locator('.st-mobile-pair').screenshot({ path: join(output, '03-pairing.png'), mask: [mobile.locator('canvas'), mobile.getByLabel('Einmaliger Pairing-Code'), mobile.getByLabel('Einmaliger Pairing-Link')], maskColor: '#353b45' });
  captures.push('03-pairing.png');
  proxy = await mobileTlsProxy(); proxy.target(port); proxy.rewriteOrigin('https://ade-mobile.fixture.ts.net');
  browser = await chromium.launch({ args: ['--ignore-certificate-errors', '--host-resolver-rules=MAP ade-mobile.fixture.ts.net 127.0.0.1'] });
  const tablet = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: true, ignoreHTTPSErrors: true }); tablet.setDefaultTimeout(30_000);
  await tablet.goto(`${proxy.origin}/#pair=${code}`);
  await tablet.getByLabel('Gerätename', { exact: true }).fill('Mein Samsung Tablet');
  await tablet.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click();
  await tablet.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await mobile.getByRole('button', { name: 'Pairing schliessen' }).click();
  await desktop.getByRole('button', { name: 'Geräte aktualisieren', exact: true }).click();
  const grants = desktop.getByRole('group', { name: 'Verwaltungsrechte für Mein Samsung Tablet', exact: true });
  for (const name of ['Agents und Projekte erstellen', 'Workspace-Dateien und Git-Diffs lesen', 'Kleine Workspace-Textdateien bearbeiten',
    'Projekt-Workspaces ohne Agent-Profil öffnen', 'Projekt-Branches und lokale Git-Aktionen ausführen', 'Projekt-Branches pushen und GitHub-PRs erstellen']) await grants.getByRole('checkbox', { name, exact: true }).check();
  await grants.getByRole('checkbox', { name: /Interaktive Terminals steuern/ }).check();
  await grants.getByRole('button', { name: 'Verwaltungsrechte speichern', exact: true }).click();
  await capture('04-device-rights.png', grants);
  await capture('05-tablet-overview.png', tablet);
  await tablet.getByRole('tab', { name: 'Projekte', exact: true }).click();
  await tablet.getByRole('button', { name: 'Workspace öffnen: Gartenplaner', exact: true }).waitFor();
  await capture('06-projects.png', tablet);
  await tablet.getByRole('button', { name: 'Neues Projekt', exact: true }).click();
  const start = tablet.getByRole('dialog', { name: 'Neues Projekt', exact: true });
  await start.getByLabel('Projektname (optional)', { exact: true }).fill('Mein Notizbuch');
  await start.getByRole('button', { name: 'Projekt anlegen und öffnen', exact: true }).click({ trial: true });
  await capture('07-new-project.png', tablet);
  await tablet.keyboard.press('Escape');
  await tablet.getByRole('button', { name: 'Workspace öffnen: Gartenplaner', exact: true }).click();
  const workspace = tablet.getByRole('dialog', { name: 'Projekt · Gartenplaner', exact: true });
  await workspace.getByRole('button', { name: 'Workspace öffnen', exact: true }).click();
  await workspace.getByLabel('Projekt-CLI', { exact: true }).waitFor();
  await capture('08-workspace-cli.png', tablet);
  await workspace.getByRole('button', { name: 'Codex öffnen', exact: true }).click();
  await workspace.getByLabel('Terminalanzeige', { exact: true }).getByText('Keine Modellanfrage.', { exact: false }).last().waitFor();
  await capture('09-terminal.png', tablet);
  await workspace.getByLabel('Direkte Terminal-Eingabe', { exact: true }).focus();
  await tablet.evaluate(() => { Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 420 }); window.visualViewport!.dispatchEvent(new Event('resize')); });
  await workspace.locator('.m-keyboard-compact').waitFor();
  await tablet.screenshot({ path: join(output, '10-keyboard-compact.png'), clip: { x: 0, y: 0, width: 1280, height: 420 } }); captures.push('10-keyboard-compact.png');
  await tablet.evaluate(() => { Reflect.deleteProperty(window.visualViewport!, 'height'); window.visualViewport!.dispatchEvent(new Event('resize')); });
  await workspace.getByRole('button', { name: 'Workspace einblenden', exact: true }).click();
  await workspace.getByRole('button', { name: 'Sitzung beenden', exact: true }).click();
  await tablet.getByRole('dialog', { name: 'Terminalsitzung beenden', exact: true }).getByRole('button', { name: 'Beenden bestätigen', exact: true }).click();
  await tablet.getByRole('dialog', { name: 'Terminalsitzung beenden', exact: true }).waitFor({ state: 'hidden' });
  writeFileSync(join(repository, 'README.md'), '# Gartenplaner\n\nEine kleine App zum Planen von Beeten und Pflanzterminen.\n\nErster Plan: Beete und Pflanztermine erfassen.\n');
  await workspace.getByRole('button', { name: 'Git', exact: true }).click();
  await workspace.getByRole('button', { name: 'Datei bearbeiten: README.md', exact: true }).click();
  await workspace.getByLabel('Git-Dateiinhalt', { exact: true }).waitFor();
  await capture('11-workspace-files.png', tablet);
  await workspace.getByRole('button', { name: 'Projekt · Gartenplaner schliessen', exact: true }).click();
  await tablet.getByRole('tab', { name: 'Overview', exact: true }).click();
  await tablet.getByRole('button', { name: 'Terminal öffnen: Hermes General', exact: true }).click();
  const assistant = tablet.getByRole('dialog', { name: 'Workspace · Hermes General', exact: true });
  await assistant.getByLabel('Terminalanzeige', { exact: true }).getByText('Keine Modellanfrage.', { exact: false }).last().waitFor();
  await assistant.getByRole('link', { name: 'Web-Dashboard für Hermes General', exact: true }).waitFor();
  await capture('12-assistant.png', tablet);
  await assistant.getByRole('button', { name: 'Workspace · Hermes General schliessen', exact: true }).click();
  await tablet.getByRole('tab', { name: 'Work', exact: true }).click();
  await tablet.getByRole('button', { name: 'Neue Aufgabe', exact: true }).click();
  await capture('13-task.png', tablet);
  writeFileSync(join(output, 'capture.json'), JSON.stringify({ capturedAt: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), workingTreeDirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
    platform: process.platform, browser: browser.version(), demo: true, physicalTablet: false, keyboard: 'visualViewport geometry simulated; OS keyboard is not pictured',
    isolation: 'Temporary Electron profile, local Git repo, deterministic CLI executable, local TLS proxy; Tailscale CLI stubbed only in fixture process',
    captures, mobileAssets: readFileSync(resolve('out/mobile/index.html'), 'utf8').match(/assets\/[^" ]+/g) }, null, 2) + '\n');
  console.log(`User guide: ${captures.length} screenshots captured.`);
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); await proxy?.close(); await app?.close();
  if (dirname(resolve(root)) !== realpathSync.native(tmpdir())) throw new Error('Unexpected fixture cleanup path');
  rmSync(root, { recursive: true, force: true });
});
