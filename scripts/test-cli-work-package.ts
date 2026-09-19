import { _electron as electron, type ElectronApplication } from 'playwright';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { nativeUsageFixtureSource } from './helpers/nativeUsageFixture';
let app: ElectronApplication | undefined; let passed = 0;
const check = (name: string, ok: boolean) => { if (!ok) throw new Error(name); passed++; console.log(`ok ${name}`); };
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-cli-package-smoke-')));
const executable = resolve(process.argv[2] ?? 'dist/win-unpacked/ADE.exe');
void (async () => {
  if (process.platform !== 'win32') throw new Error('Packaged CLI smoke currently requires native Windows.');
  const projects = join(root, 'projects'); const repo = join(projects, 'Package review'); mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '--initial-branch=main', repo], { windowsHide: true });
  execFileSync('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-m', 'Package fixture'], { windowsHide: true });
  const bin = join(root, 'bin'); mkdirSync(bin); const compile = join(root, 'compile.ps1');
  writeFileSync(compile, String.raw`param([string]$Target)
Add-Type -OutputAssembly $Target -OutputType ConsoleApplication -TypeDefinition @'
using System;
public class Fixture {
  public static void Main(string[] args) {
    if (Array.IndexOf(args, "--version") >= 0) { Console.WriteLine("codex 1.0.0"); return; }
    if (Array.IndexOf(args, "app-server") >= 0) return;
    NativeUsageFixture.Report(args);
    Console.WriteLine("PACKAGED_USAGE_READY"); Console.ReadLine();
  }
}
${nativeUsageFixtureSource}
'@
`);
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', compile, join(bin, 'codex.exe')], { windowsHide: true, timeout: 30_000 });
  app = await electron.launch({ executablePath: executable, args: [], env: { ...process.env, Path: `${bin};${process.env.Path ?? process.env.PATH}`,
    CODEX_HOME: join(root, 'codex-home'), ADE_USER_DATA_DIR: join(root, 'profile'), ADE_HOST_API_ENABLED: '0' }, timeout: 30000 });
  const page = await app.firstWindow(); page.setDefaultTimeout(25000);
  check('Windows package launches sandboxed and context-isolated', await app.evaluate(({ BrowserWindow }) => {
    // Electron exposes this inspection helper at runtime but omits it from its public typings.
    const contents = BrowserWindow.getAllWindows()[0]!.webContents as unknown as {
      getLastWebPreferences?: () => { sandbox?: boolean; contextIsolation?: boolean; nodeIntegration?: boolean };
    };
    const pref = contents.getLastWebPreferences?.(); return !!pref?.sandbox && !!pref.contextIsolation && !pref.nodeIntegration;
  }));
  await page.evaluate(path => window.ade.invoke('projectDefaults:save', { rootPath: path, agentId: null }), projects);
  await page.getByRole('tab', { name: 'Projekte', exact: true }).click();
  await page.getByRole('button', { name: 'Alle', exact: true }).click();
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
  const promptButton = terminal.getByRole('button', { name: 'Prompt / Diktat', exact: true });
  await promptButton.click();
  const prompt = page.getByRole('dialog', { name: 'Prompt und Diktat', exact: true });
  const draft = prompt.getByLabel('CLI-Promptentwurf', { exact: true });
  await draft.fill('Paketprobe\nEntwurf erhalten.');
  const capability = await page.evaluate(sessionId => window.ade.invoke('terminal:promptQuery', { sessionId }), session.id);
  check('packaged prompt editor refuses shell delivery', !capability.available
    && await prompt.getByRole('button', { name: 'In CLI einfügen', exact: true }).isDisabled()
    && await prompt.getByRole('button', { name: 'An CLI absenden', exact: true }).isDisabled());
  await page.keyboard.press('Escape'); await prompt.waitFor({ state: 'hidden' });
  check('packaged prompt close returns focus to its opener', await promptButton.evaluate(node => node === document.activeElement));
  await promptButton.click();
  check('packaged prompt draft survives closing without delivery', await draft.inputValue() === 'Paketprobe\nEntwurf erhalten.');
  await prompt.getByRole('button', { name: 'Entwurf löschen', exact: true }).click();
  await page.keyboard.press('Escape'); await prompt.waitFor({ state: 'hidden' });
  await page.getByRole('tab', { name: 'Aufträge', exact: true }).click();
  const work = page.getByRole('region', { name: 'CLI-Arbeit', exact: true });
  const row = work.locator(`li[data-session-id="${session.id}"]`); await row.waitFor();
  check('packaged Work shows original workspace and native shell', (await row.innerText()).includes('Originalordner') && (await row.innerText()).includes('Package review'));
  await page.screenshot({ path: resolve('test-results/cli-work-package.png') });
  await row.getByRole('button', { name: /^Sitzung öffnen:/ }).click(); await terminal.waitFor();
  sessions = (await page.evaluate(() => window.ade.invoke('pty:list'))).sessions;
  check('return from Work reuses exact packaged session without duplicate', sessions.length === 1 && sessions[0]!.id === session.id);
  await page.getByRole('tab', { name: 'Übersicht', exact: true }).click();
  check('packaged Overview contains the same live CLI row', await page.getByRole('region', { name: 'CLI-Arbeit', exact: true }).locator(`li[data-session-id="${session.id}"]`).isVisible());
  const config = await page.evaluate(() => window.ade.invoke('config:get'));
  check('package smoke uses isolated config and creates no agent binding', config.agents.length === 0 && config.workspaceBindings.length === 0 && config.repositories.every(item => item.rootPath === repo));
  await page.getByRole('region', { name: 'CLI-Arbeit', exact: true }).locator(`li[data-session-id="${session.id}"]`).getByRole('button', { name: /^Sitzung öffnen:/ }).click();
  await terminal.getByRole('button', { name: 'Codex öffnen', exact: true }).click();
  await terminal.getByLabel('CLI- und Terminalstatus', { exact: true }).filter({ hasText: 'Codex läuft' }).waitFor();
  await terminal.locator('summary[aria-label="Abo-Nutzung"]:visible').click();
  const usageView = terminal.getByRole('region', { name: 'Sitzungsverbrauch', exact: true });
  await usageView.getByText('codex-usage-fixture', { exact: false }).waitFor();
  const usage = await page.evaluate(async () => {
    const item = (await window.ade.invoke('pty:list')).sessions.find(item => item.runtime === 'codex')!;
    return { id: item.id, view: (await window.ade.invoke('terminal:usage', { sessionId: item.id })).consumption };
  });
  check('packaged collector receives authenticated native fixture and counts repeated snapshots once', usage.view?.tokens.input === 15731 && usage.view.events === 1);
  check('packaged usage view labels unknown prices without exposing source paths', (await usageView.innerText()).includes('ohne Kostenangabe') && !JSON.stringify(usage.view).includes(root));
  await page.evaluate(id => window.ade.invoke('pty:kill', { sessionId: id }), usage.id);
  const journal = readFileSync(join(root, 'profile', 'ade', 'usage', 'events.jsonl'), 'utf8');
  check('packaged usage persists numeric facts in its isolated journal', journal.includes('"input":15731') && !journal.includes('PACKAGED_USAGE_READY'));
  await page.evaluate(sessionId => window.ade.invoke('pty:kill', { sessionId }), session.id);
  writeFileSync(resolve('test-results/cli-work-package-smoke.json'), JSON.stringify({ at: new Date().toISOString(), executable,
    sha256: createHash('sha256').update(readFileSync(executable)).digest('hex'),
    asarSha256: createHash('sha256').update(readFileSync(join(dirname(executable), 'resources', 'app.asar'))).digest('hex'),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceDirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), passed }, null, 2));
  console.log(`Packaged CLI smoke: ${passed} passed, 0 failed`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await app?.close();
  const log = join(root, 'profile', 'ade', 'logs', 'main.log'); if (existsSync(log)) copyFileSync(log, resolve('test-results/cli-work-package-main.log'));
  if (dirname(root) !== realpathSync.native(tmpdir()) || !root.includes('ade-cli-package-smoke-')) throw new Error('Unexpected smoke root'); rmSync(root, { recursive: true, force: true });
});
