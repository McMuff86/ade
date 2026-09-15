import { _electron as electron, type ElectronApplication } from 'playwright';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
let app: ElectronApplication | undefined; let passed = 0;
const check = (name: string, ok: boolean) => { if (!ok) throw new Error(name); passed++; console.log(`ok ${name}`); };
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-cli-package-smoke-')));
const executable = resolve(process.argv[2] ?? 'dist/win-unpacked/ADE.exe');
void (async () => {
  if (process.platform !== 'win32') throw new Error('Packaged CLI smoke currently requires native Windows.');
  const projects = join(root, 'projects'); const repo = join(projects, 'Package review'); mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '--initial-branch=main', repo], { windowsHide: true });
  execFileSync('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-m', 'Package fixture'], { windowsHide: true });
  app = await electron.launch({ executablePath: executable, args: [], env: { ...process.env, ADE_USER_DATA_DIR: join(root, 'profile'), ADE_HOST_API_ENABLED: '0' }, timeout: 30000 });
  const page = await app.firstWindow(); page.setDefaultTimeout(25000);
  check('Windows package launches sandboxed and context-isolated', await app.evaluate(({ BrowserWindow }) => {
    // Electron exposes this inspection helper at runtime but omits it from its public typings.
    const contents = BrowserWindow.getAllWindows()[0]!.webContents as unknown as {
      getLastWebPreferences?: () => { sandbox?: boolean; contextIsolation?: boolean; nodeIntegration?: boolean };
    };
    const pref = contents.getLastWebPreferences?.(); return !!pref?.sandbox && !!pref.contextIsolation && !pref.nodeIntegration;
  }));
  await page.evaluate(path => window.ade.invoke('projectDefaults:save', { rootPath: path, agentId: null }), projects);
  await page.getByRole('tab', { name: 'Projekte view', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace öffnen: Package review', exact: true }).click();
  const terminal = page.getByRole('region', { name: 'Projekt-Terminal', exact: true });
  await terminal.getByRole('button', { name: 'Leeres Terminal öffnen', exact: true }).click();
  await terminal.getByLabel('CLI- und Terminalstatus', { exact: true }).filter({ hasText: 'Terminal offen' }).waitFor();
  let sessions = (await page.evaluate(() => window.ade.invoke('pty:list'))).sessions;
  const session = sessions.find(item => item.workspaceDir === repo)!;
  check('packaged ConPTY opens exact original fixture checkout', !!session && session.status === 'running' && session.workspaceKind === 'checkout' && !session.agentId);
  await page.evaluate(({ sessionId, dataBase64 }) => window.ade.invoke('pty:write', { sessionId, dataBase64 }), { sessionId: session.id, dataBase64: Buffer.from("Write-Output ('ADE_PACKAGED_'+'CLI_OK')\r").toString('base64') });
  let found = false;
  for (let i = 0; i < 50; i++) {
    const data = await page.evaluate(sessionId => window.ade.invoke('pty:attach', { sessionId }), session.id);
    if (Buffer.from(data.replayBase64, 'base64').toString().includes('ADE_PACKAGED_CLI_OK')) { found = true; break; }
    await new Promise(done => setTimeout(done, 100));
  }
  check('packaged terminal executes the inert output probe', found);
  await page.getByRole('tab', { name: 'Work view', exact: true }).click();
  const work = page.getByRole('region', { name: 'CLI-Arbeit', exact: true });
  const row = work.locator(`li[data-session-id="${session.id}"]`); await row.waitFor();
  check('packaged Work shows original workspace and native shell', (await row.innerText()).includes('Originalordner') && (await row.innerText()).includes('Package review'));
  await page.screenshot({ path: resolve('test-results/cli-work-package.png') });
  await row.getByRole('button', { name: /^Sitzung öffnen:/ }).click(); await terminal.waitFor();
  sessions = (await page.evaluate(() => window.ade.invoke('pty:list'))).sessions;
  check('return from Work reuses exact packaged session without duplicate', sessions.length === 1 && sessions[0]!.id === session.id);
  await page.getByRole('tab', { name: 'Overview view', exact: true }).click();
  check('packaged Overview contains the same live CLI row', await page.getByRole('region', { name: 'CLI-Arbeit', exact: true }).locator(`li[data-session-id="${session.id}"]`).isVisible());
  const config = await page.evaluate(() => window.ade.invoke('config:get'));
  check('package smoke uses isolated config and creates no agent binding', config.agents.length === 0 && config.workspaceBindings.length === 0 && config.repositories.every(item => item.rootPath === repo));
  await page.evaluate(sessionId => window.ade.invoke('pty:kill', { sessionId }), session.id);
  writeFileSync(resolve('test-results/cli-work-package-smoke.json'), JSON.stringify({ at: new Date().toISOString(), executable, sha256: createHash('sha256').update(readFileSync(executable)).digest('hex'), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), passed }, null, 2));
  console.log(`Packaged CLI smoke: ${passed} passed, 0 failed`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await app?.close();
  const log = join(root, 'profile', 'ade', 'logs', 'main.log'); if (existsSync(log)) copyFileSync(log, resolve('test-results/cli-work-package-main.log'));
  if (dirname(root) !== realpathSync.native(tmpdir()) || !root.includes('ade-cli-package-smoke-')) throw new Error('Unexpected smoke root'); rmSync(root, { recursive: true, force: true });
});
