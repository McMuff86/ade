import { terminalComposer, terminalLauncher } from './helpers/terminalControls';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { execFileSync } from 'node:child_process';
import { _electron as electron, chromium, type ElectronApplication, type Browser, type Page } from 'playwright';
import { mobileTlsProxy } from './helpers/mobileBrowser';
import { projectStartFlow } from './helpers/projectStartFlow';
import { projectEntryFlow } from './helpers/projectEntryFlow';
import { assistantAccessFlow } from './helpers/assistantAccessFlow';
import { terminalEchoLatency } from './helpers/terminalLatency';
import { PNG } from 'pngjs';
import { randomUUID } from 'node:crypto';
import { ExecutionBackendService } from '../src/main/execution/ExecutionBackendService';

let passed = 0; let failed = 0;
const check = (label: string, ok: boolean): void => { if (ok) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-terminal-electron-'))); const evidence = resolve('test-results/remote'); mkdirSync(evidence, { recursive: true });
let app: ElectronApplication | undefined; let browser: Browser | undefined; let page: Page | undefined;
let proxy: Awaited<ReturnType<typeof mobileTlsProxy>> | undefined;
let wslHome: string | undefined;
void (async () => {
  if (process.platform !== 'win32') throw new Error('Remote terminal runtime evidence currently requires native Windows');
  // Real PTYs execute deterministic local CLI fixtures, never a paid model or the operator's agent.
  const bin = join(root, 'bin'); mkdirSync(bin);
  const compile = join(root, 'compile.ps1');
  writeFileSync(compile, `param([string]$Target)\nAdd-Type -OutputAssembly $Target -OutputType ConsoleApplication -TypeDefinition @'\nusing System; using System.IO;\npublic class Fixture { public static void Main(string[] args) {\n  string cli = Path.GetFileNameWithoutExtension(System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName).ToUpperInvariant();\n  if (cli == "OLLAMA" && args.Length == 1 && args[0] == "list") { Console.WriteLine("NAME ID SIZE MODIFIED\\nfixture:small abc 1GB today\\nfixture:large def 2GB today"); return; }\n  string result = "ADE_SESSION_" + cli + "_READY " + String.Join(" ", args);\n  if (args.Length == 0 || (cli == "OLLAMA" && args.Length > 0 && args[0] == "run")) File.WriteAllText("session-launch-proof.txt", result); Console.WriteLine(result);\n} }\n'@\n`);
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', compile, join(bin, 'fixture.exe')], { windowsHide: true, timeout: 30_000 });
  for (const cli of ['hermes', 'codex', 'claude', 'grok', 'ollama']) copyFileSync(join(bin, 'fixture.exe'), join(bin, `${cli}.exe`));
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
    env: { ...process.env, Path: `${bin};${process.env.Path ?? process.env.PATH}`, ADE_USER_DATA_DIR: join(root, 'profile'), ADE_HOST_API_ENABLED: '0', ADE_MOBILE_PORT: String(port), NODE_ENV: 'test' } });
  const desktop = await app.firstWindow(); desktop.setDefaultTimeout(30_000);
  const setup = await desktop.evaluate(async ({ path, home }) => {
    const repo = await window.ade.invoke('repository:import', { path, name: 'Terminal project', executionBackend: 'native' });
    const category = await window.ade.invoke('category:create', { name: 'Remote tests' });
    const agent = await window.ade.invoke('agent:create', { categoryId: category.id, name: 'Terminal Agent', runtime: 'custom', permissionMode: 'default', defaultRepositoryId: repo.id,
      customCommand: "Write-Output 'ADE_CONFIGURED_AGENT_READY'" });
    await window.ade.invoke('agent:update', { id: agent.id, name: agent.name, runtime: agent.runtime, permissionMode: agent.permissionMode, customCommand: agent.customCommand, homeWorkspaceDir: home });
    const session = await window.ade.invoke('pty:create', { agentId: agent.id, repositoryId: repo.id });
    return { agent, repo, session };
  }, { path: repoPath, home: join(root, 'home') });
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
  await workspace.getByRole('region', { name: 'Interaktives Terminal', exact: true }).getByRole('alert').filter({ hasText: 'Terminalzugriff fehlt.' }).waitFor();
  check('paired tablet cannot inspect terminals without dedicated grant', true);
  await desktop.getByRole('button', { name: 'Geräte aktualisieren', exact: true }).click();
  const grants = desktop.getByRole('group', { name: 'Verwaltungsrechte für Terminal tablet', exact: true });
  await grants.getByRole('checkbox', { name: 'Workspace-Dateien und Git-Diffs lesen', exact: true }).check();
  await grants.getByRole('checkbox', { name: /Interaktive Terminals steuern/ }).check();
  check('desktop grant explains actual Windows-user authority', (await grants.innerText()).includes('keine Sandbox'));
  await grants.getByRole('button', { name: 'Verwaltungsrechte speichern', exact: true }).click();
  if (!process.argv.includes('--wsl-only')) {
  if (process.argv.includes('--project-only')) {
    await projectStartFlow(desktop, page, proxy, root, setup.agent.categoryId, evidence, check);
    await projectEntryFlow(desktop, page, evidence, check, proxy); return;
  }
  if (process.argv.includes('--assistant-only')) {
    await assistantAccessFlow(desktop, page, root, setup.agent.categoryId, evidence, check); return;
  }
  await workspace.getByLabel('Terminal-Sitzung', { exact: true }).locator('option').filter({ hasText: 'läuft' }).waitFor({ state: 'attached' });
  const terminalId = await workspace.getByLabel('Terminal-Sitzung', { exact: true }).locator('option').nth(1).getAttribute('value');
  await workspace.getByLabel('Terminal-Sitzung', { exact: true }).selectOption(terminalId!);
  await workspace.getByLabel('Terminalanzeige', { exact: true }).getByText('ADE_CONFIGURED_AGENT_READY', { exact: false }).last().waitFor();
  check('tablet attaches a real desktop-started configured session', true);
  await workspace.getByRole('button', { name: 'Eingabe übernehmen', exact: true }).click();
  await workspace.getByText('Du steuerst die Eingabe.', { exact: true }).waitFor();
  const blocked = await desktop.evaluate(async (id) => {
    try { await window.ade.invoke('pty:write', { sessionId: id, dataBase64: btoa('SHOULD_NOT_RUN\r') }); return false; } catch { return true; }
  }, setup.session.id);
  check('main rejects desktop typing while tablet owns input', blocked);
  await (await terminalComposer(workspace)).fill("Set-Content -LiteralPath 'terminal-proof.txt' -Value 'ADE_TABLET_OK'");
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
  await terminalLauncher(workspace);
    await workspace.getByRole('button', { name: 'Shell öffnen', exact: true }).click();
  await workspace.getByText('Du steuerst die Eingabe.', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.m-terminal-screen')?.textContent?.includes('PS '));
  const newSession = await desktop.evaluate(() => window.ade.invoke('pty:list'));
  check('remote shell opens independently without starting configured agent command', newSession.sessions.length === 2 && newSession.sessions.some((session) => session.title === 'Shell')
    && !(await workspace.getByLabel('Terminalanzeige', { exact: true }).innerText()).includes('ADE_CONFIGURED_AGENT_READY'));
  check('terminal screen removes absolute Windows paths', !/[A-Za-z]:[\\/]/.test(await workspace.getByLabel('Terminalanzeige', { exact: true }).innerText()));
  await page.screenshot({ path: join(evidence, 'terminal-tablet.png') });
  const shellId = await workspace.getByLabel('Terminal-Sitzung', { exact: true }).inputValue();
  await (await terminalComposer(workspace)).fill('Unsent tablet draft');
  await page.reload(); await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await workspace.waitFor();
  await workspace.getByLabel('Terminalanzeige', { exact: true }).waitFor();
  check('reload restores the workspace, selected terminal and unsent draft', await workspace.getByLabel('Terminal-Sitzung', { exact: true }).inputValue() === shellId
    && await workspace.getByLabel('Terminal-Eingabe', { exact: true }).inputValue() === 'Unsent tablet draft');
  await (await terminalComposer(workspace)).fill('');
  check('browser reload reconnects without creating a third process', (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.length === 2);
  await page.setViewportSize({ width: 390, height: 844 });
  check('phone terminal controls stay within the workspace width', await workspace.evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
  await page.screenshot({ path: join(evidence, 'terminal-phone.png') });
  await page.setViewportSize({ width: 1024, height: 768 });
  await terminalLauncher(workspace);
  await workspace.getByLabel('Sitzung starten mit', { exact: true }).selectOption('agent');
  await workspace.getByRole('button', { name: 'Sitzung starten', exact: true }).click();
  await workspace.getByLabel('Terminalanzeige', { exact: true }).getByText('ADE_CONFIGURED_AGENT_READY', { exact: false }).last().waitFor();
  const agentTerminal = await workspace.getByLabel('Terminal-Sitzung', { exact: true }).inputValue();
  check('tablet starts the configured agent command in a new real PTY', agentTerminal !== shellId
    && (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.length === 3);
  await workspace.getByRole('button', { name: 'Sitzung beenden', exact: true }).click();
  await page.getByRole('dialog', { name: 'Terminalsitzung beenden', exact: true }).getByRole('button', { name: 'Beenden bestätigen', exact: true }).click();
  await workspace.getByText('Sitzung beendet.', { exact: true }).waitFor();
  check('confirmed tablet close stops only the selected process', (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.filter((session) => session.status === 'running').length === 2);
  await workspace.getByLabel('Terminal-Sitzung', { exact: true }).selectOption(shellId);
  await workspace.getByLabel('Terminalanzeige', { exact: true }).waitFor();
  await desktop.getByRole('button', { name: 'New session', exact: true }).click();
  const launchDialog = desktop.getByRole('dialog', { name: 'Neue Terminalsitzung', exact: true });
  await launchDialog.waitFor();
  check('desktop plus opens focused shared launch dialog', await launchDialog.evaluate((node) => node.contains(document.activeElement)));
  await desktop.keyboard.press('Escape');
  check('cancel launch restores focus to plus', await desktop.getByRole('button', { name: 'New session', exact: true }).evaluate((node) => node === document.activeElement));
  await desktop.keyboard.press('Control+Shift+T');
  await launchDialog.getByLabel('Sitzungsprojekt', { exact: true }).selectOption('');
  await launchDialog.getByLabel('Sitzung starten mit', { exact: true }).selectOption('hermes');
  await launchDialog.getByRole('button', { name: 'Sitzung starten', exact: true }).click();
  await launchDialog.waitFor({ state: 'hidden' });
  const hermes = (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.find((s) => s.launchChoice?.mode === 'hermes')!;
  await desktop.waitForFunction(async (id) => {
    const replay = await window.ade.invoke('pty:attach', { sessionId: id }); return atob(replay.replayBase64).includes('ADE_SESSION_HERMES_READY');
  }, hermes.id, { timeout: 60_000 });
  check('desktop Hermes choice runs in explicit home despite default project', hermes.scopeSource === 'plain-home' && !hermes.repositoryId && hermes.workspaceDir === join(root, 'home'));
  await desktop.evaluate(async (id) => window.ade.invoke('pty:write', { sessionId: id, dataBase64: btoa('exit 7\r') }), hermes.id);
  await desktop.getByRole('button', { name: 'Restart', exact: true }).click();
  const restartDeadline = Date.now() + 60_000; let restarted = false;
  while (!restarted && Date.now() < restartDeadline) {
    restarted = (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.some((s) => s.id !== hermes.id && s.launchChoice?.mode === 'hermes' && !s.repositoryId);
    if (!restarted) await new Promise((done) => setTimeout(done, 200));
  }
  check('restart retains per-session Hermes choice and explicit home', restarted);
  await workspace.getByLabel('Workspace-Projekt', { exact: true }).selectOption('');
  await workspace.getByRole('button', { name: 'Terminal', exact: true }).click();
  await terminalLauncher(workspace);
  await workspace.getByLabel('Sitzung starten mit', { exact: true }).selectOption('ollama');
  await workspace.getByLabel('Ollama-Modell', { exact: true }).selectOption('fixture:large');
  await workspace.getByRole('button', { name: 'Sitzung starten', exact: true }).click();
  await workspace.getByLabel('Terminalanzeige', { exact: true }).getByText('ADE_SESSION_OLLAMA_READY run fixture:large', { exact: false }).last().waitFor();
  const ollamaSessions = (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions;
  check('tablet starts selected Ollama model in real home PTY', ollamaSessions.some((s) => s.launchChoice?.mode === 'ollama' && s.launchChoice.model === 'fixture:large' && !s.repositoryId));
  await terminalLauncher(workspace);
  await workspace.getByLabel('Sitzung starten mit', { exact: true }).selectOption('codex');
  await workspace.getByRole('button', { name: 'Sitzung starten', exact: true }).click();
  await workspace.getByLabel('Terminalanzeige', { exact: true }).getByText('ADE_SESSION_CODEX_READY', { exact: false }).last().waitFor();
  check('tablet starts fresh Codex without changing configured profile', (await desktop.evaluate(async (id) => (await window.ade.invoke('config:get')).agents.find((a) => a.id === id), setup.agent.id))?.customCommand === setup.agent.customCommand);
  await page.setViewportSize({ width: 390, height: 844 });
  check('phone launch controls fit and Git is disabled without project', await workspace.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
    && await workspace.getByRole('button', { name: 'Git-Änderungen', exact: true }).isDisabled());
  await page.screenshot({ path: join(evidence, 'session-launch-phone.png') });
  await page.setViewportSize({ width: 1024, height: 768 });
  await desktop.getByRole('button', { name: 'Settings', exact: true }).click();
  await desktop.getByRole('button', { name: 'Geräte aktualisieren', exact: true }).click();
  await grants.getByRole('checkbox', { name: /Interaktive Terminals steuern/ }).uncheck(); await grants.getByRole('button', { name: 'Verwaltungsrechte speichern', exact: true }).click();
  await workspace.getByRole('region', { name: 'Interaktives Terminal', exact: true }).getByRole('alert').filter({ hasText: 'Terminalzugriff fehlt.' }).waitFor();
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
  await projectStartFlow(desktop, page, proxy, root, setup.agent.categoryId, evidence, check);
  await projectEntryFlow(desktop, page, evidence, check, proxy);
  await assistantAccessFlow(desktop, page, root, setup.agent.categoryId, evidence, check);
  }
  if (process.argv.includes('--wsl') || process.argv.includes('--wsl-only')) {
    wslHome = `/tmp/ade-session-${randomUUID()}`;
    if (!await grants.isVisible()) await desktop.getByRole('button', { name: 'Settings', exact: true }).click();
    await desktop.getByRole('button', { name: 'Geräte aktualisieren', exact: true }).click();
    await grants.getByRole('checkbox', { name: /Interaktive Terminals steuern/ }).check();
    await grants.getByRole('checkbox', { name: 'Kleine Workspace-Textdateien bearbeiten', exact: true }).check();
    await grants.getByRole('button', { name: 'Verwaltungsrechte speichern', exact: true }).click();
    const wslAgent = await desktop.evaluate(async ({ categoryId, home }) => {
      const a = await window.ade.invoke('agent:create', { categoryId, name: 'WSL Home Agent', runtime: 'custom', permissionMode: 'default',
        customCommand: `python3 -u -c 'import os,tty; tty.setraw(0); print("ADE_WSL_"+"CONFIGURED_READY"); [os.write(1,b"\\r\\nKEY_"+os.read(0,1)+b"_ACK\\r\\n") for _ in range(10)]'` });
      return window.ade.invoke('agent:update', { id: a.id, name: a.name, runtime: a.runtime, permissionMode: a.permissionMode, customCommand: a.customCommand, homeExecutionBackend: 'wsl:Ubuntu', homeWorkspaceDir: home });
    }, { categoryId: setup.agent.categoryId, home: wslHome });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Workspace für WSL Home Agent', exact: true }).click();
    const ws = page.getByRole('dialog', { name: 'Workspace · WSL Home Agent', exact: true });
    await ws.getByText('Der eigene Ordner ist noch nicht vorhanden.', { exact: false }).waitFor();
    check('WSL home opens without choosing or creating a project', await ws.getByLabel('Workspace-Projekt', { exact: true }).inputValue() === '');
    await ws.getByRole('button', { name: 'Terminal', exact: true }).click();
    await terminalLauncher(ws);
    await ws.getByRole('button', { name: 'Shell öffnen', exact: true }).click();
    await ws.getByText('Du steuerst die Eingabe.', { exact: true }).waitFor();
    await page.waitForFunction(() => /[$#]/.test(document.querySelector('.m-terminal-screen')?.textContent ?? ''), { timeout: 60_000 });
    await (await terminalComposer(ws)).fill("printf 'ADE_WSL_HOME_READY\\n' > tablet-wsl.txt; printf '\\101DE_WSL_WRITE_DONE\\n'");
    await ws.getByRole('button', { name: 'Text und Enter senden', exact: true }).click();
    await ws.getByLabel('Terminalanzeige', { exact: true }).getByText('ADE_WSL_WRITE_DONE', { exact: false }).last().waitFor();
    await ws.getByRole('button', { name: 'Dateien', exact: true }).click();
    await ws.getByRole('button', { name: 'Workspace aktualisieren', exact: true }).click();
    await ws.getByRole('button', { name: 'tablet-wsl.txt', exact: true }).click();
    await ws.getByLabel('Dateivorschau', { exact: true }).getByText('ADE_WSL_HOME_READY', { exact: false }).waitFor();
    check('real WSL PTY and tablet files share the configured home', (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.some((s) => s.agentId === wslAgent.id && s.executionBackend === 'wsl:Ubuntu' && s.workspaceDir === wslHome));
    await ws.getByRole('button', { name: 'Terminal', exact: true }).click();
    await ws.getByRole('button', { name: 'Sitzung beenden', exact: true }).click();
    await page.getByRole('dialog', { name: 'Terminalsitzung beenden', exact: true }).getByRole('button', { name: 'Beenden bestätigen', exact: true }).click();
    await ws.getByText('Sitzung beendet.', { exact: true }).waitFor();
    await ws.getByRole('button', { name: 'Dateien', exact: true }).click();
    await ws.getByRole('button', { name: 'Workspace aktualisieren', exact: true }).click();
    await ws.getByRole('button', { name: 'tablet-wsl.txt', exact: true }).click();
    await ws.getByRole('button', { name: 'Datei bearbeiten', exact: true }).click();
    await ws.getByRole('textbox', { name: 'Datei bearbeiten', exact: true }).fill('ADE_WSL_TABLET_EDIT\n');
    await ws.getByRole('button', { name: 'Datei speichern', exact: true }).click();
    await ws.getByRole('textbox', { name: 'Datei bearbeiten', exact: true }).waitFor({ state: 'hidden' });
    await ws.getByRole('button', { name: 'tablet-wsl.txt', exact: true }).click();
    await ws.getByLabel('Dateivorschau', { exact: true }).getByText('ADE_WSL_TABLET_EDIT', { exact: false }).waitFor();
    check('tablet saves and reopens a real WSL home file', true);
    await ws.getByRole('button', { name: 'Terminal', exact: true }).click();
    await ws.getByRole('button', { name: 'WSL Home Agent öffnen', exact: true }).click();
    await ws.getByLabel('Terminalanzeige', { exact: true }).getByText('ADE_WSL_CONFIGURED_READY', { exact: false }).last().waitFor();
    check('saved profile starts inside WSL home from tablet', true);
    for (const key of ['x', 'y', 'z']) {
      const echoMs = await terminalEchoLatency(page, ws, key, `KEY_${key}_ACK`);
      check(`WSL keydown to visible PTY acknowledgement stays below 500 ms (${echoMs} ms)`, echoMs < 500);
    }
    await page.screenshot({ path: join(evidence, 'session-wsl-tablet.png') });
  }
  await page.screenshot({ path: join(evidence, 'terminal-grant-revoked.png') });
})().catch(async (error) => {
  failed++; console.error(error); await page?.screenshot({ path: join(evidence, 'terminal-failure.png') }).catch(() => undefined);
  try { console.error(readFileSync(join(root, 'profile/ade/logs/main.log'), 'utf8').slice(-2500)); } catch { /* no log */ }
}).finally(async () => {
  await browser?.close(); await proxy?.close(); await app?.close().catch(() => undefined);
  if (wslHome && /^\/tmp\/ade-session-[a-f0-9-]+$/.test(wslHome)) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await new ExecutionBackendService().checked('wsl:Ubuntu', 'python3', ['-I', '-c',
          'import sys,json,shutil; shutil.rmtree(json.load(sys.stdin),ignore_errors=True)'], { input: JSON.stringify(wslHome) });
        break;
      } catch (error) {
        if (attempt === 2) { failed++; console.error('WSL fixture cleanup failed', error); }
        else await new Promise((done) => setTimeout(done, 1000));
      }
    }
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  console.log(`Remote terminal Electron: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
});
