/** Native Windows Electron/IPC/ConPTY evidence with deterministic local CLI fixtures. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { DEFAULT_CONFIG } from '../src/shared/types';

let passed = 0;
const check = (label: string, condition: unknown): void => { assert.ok(condition, label); passed++; console.log(`  ok  ${label}`); };
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-ollama-electron-')));
const bin = join(root, 'bin'); mkdirSync(bin);
const modelFile = join(bin, 'models.txt'); writeFileSync(modelFile, 'coder:small\ncoder:large\n');
const proof = join(root, 'launch.txt'); const userData = join(root, 'profile'); mkdirSync(join(userData, 'ade'), { recursive: true });
const configPath = join(userData, 'ade', 'config.json');
writeFileSync(configPath, JSON.stringify({ ...DEFAULT_CONFIG,
  settings: { ...DEFAULT_CONFIG.settings, memory: { enabled: false, userProfileEnabled: false, memoryCharLimit: 2200, userCharLimit: 1375 } },
  categories: [{ id: 'coding', name: 'Coding', agents: ['shell'] }],
  agents: [{ id: 'shell', categoryId: 'coding', name: 'Fixture Shell', runtime: 'shell', permissionMode: 'default', workspaceDir: root, memoryDir: root }] }));
const compile = join(root, 'fixture.ps1');
writeFileSync(compile, `param([string]$Target)
Add-Type -OutputAssembly $Target -OutputType ConsoleApplication -TypeDefinition @'
using System; using System.IO;
public class Fixture { public static void Main(string[] args) {
  string exe = System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName;
  if (args.Length == 1 && args[0] == "--version") { Console.WriteLine("fixture 1.0"); return; }
  if (args.Length == 1 && args[0] == "app-server") return;
  if (args.Length == 1 && args[0] == "list") {
    string models = File.ReadAllText(Path.Combine(Path.GetDirectoryName(exe), "models.txt"));
    if (models == "offline") { Console.Error.WriteLine("fixture service unavailable"); Environment.Exit(1); }
    Console.WriteLine("NAME ID SIZE MODIFIED");
    foreach (string model in models.Split(new char[] {'\\r', '\\n'}, StringSplitOptions.RemoveEmptyEntries)) Console.WriteLine(model + " abc 1GB today");
    return;
  }
  File.WriteAllText(Environment.GetEnvironmentVariable("ADE_OLLAMA_PROOF"), Path.GetFileName(exe) + "\\n" + String.Join("\\n", args));
  Console.WriteLine("ADE_OLLAMA_READY " + String.Join(" ", args));
  while(true) System.Threading.Thread.Sleep(100);
} }
'@
`);
let app: ElectronApplication | undefined;
void (async () => {
  try {
    assert.equal(process.platform, 'win32');
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', compile, join(bin, 'codex.exe')], { windowsHide: true, timeout: 30_000 });
    copyFileSync(join(bin, 'codex.exe'), join(bin, 'ollama.exe'));
    app = await electron.launch({ args: [resolve('out/main/index.js')], cwd: resolve('.'), env: { ...process.env,
      Path: `${bin};${process.env.Path ?? process.env.PATH}`, ADE_OLLAMA_PROOF: proof, ADE_USER_DATA_DIR: userData, ADE_HOST_API_ENABLED: '0', NODE_ENV: 'test' } });
    const page = await app.firstWindow(); page.setDefaultTimeout(20_000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.locator('.add-agent').first().click();
    let dialog = page.getByRole('dialog', { name: 'New agent', exact: true }); await dialog.waitFor();
    await dialog.locator('#agent-name').fill('Ollama Fixture'); await dialog.locator('#agent-rt').selectOption('ollama');
    await dialog.locator('#agent-ollama-model option[value="coder:large"]').waitFor({ state: 'attached' });
    check('new Ollama profile offers coding and direct chat modes', await dialog.getByLabel('Ollama verwenden als').inputValue() === 'coding'
      && await dialog.getByLabel('Ollama verwenden als').locator('option').count() === 2);
    check('installed models are visible in a native keyboard accessible select', await dialog.locator('#agent-ollama-model').locator('option').count() === 2);
    await dialog.locator('#agent-ollama-model').selectOption('coder:large');
    await dialog.getByRole('button', { name: 'Create agent', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    let config = await page.evaluate(() => window.ade.invoke('config:get'));
    const agent = config.agents.find(item => item.name === 'Ollama Fixture')!;
    check('UI creation durably stores the mode and selected model', agent.ollamaMode === 'coding' && agent.ollamaModel === 'coder:large'
      && JSON.parse(readFileSync(configPath, 'utf8')).agents.find((item: { id: string }) => item.id === agent.id).ollamaMode === 'coding');
    await page.getByRole('button', { name: 'Agent settings for Ollama Fixture', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Agent settings', exact: true }); await dialog.waitFor();
    await dialog.locator('#edit-agent-ollama-model option[value="coder:small"]').waitFor({ state: 'attached' });
    check('reopened settings preserve the coding model and preview the local provider', await dialog.locator('#edit-agent-ollama-model').inputValue() === 'coder:large'
      && (await dialog.locator('#edit-agent-cmd').getAttribute('placeholder'))?.includes('--oss --local-provider ollama --model coder:large'));
    await dialog.getByLabel('Ollama verwenden als').focus(); await page.keyboard.press('Tab');
    check('keyboard navigation reaches the model selector', await dialog.locator('#edit-agent-ollama-model').evaluate(node => node === document.activeElement));
    writeFileSync(modelFile, ''); await dialog.getByRole('button', { name: 'Modelle aktualisieren', exact: true }).click();
    await dialog.getByText('Ollama ist erreichbar, hat aber keine Modelle gemeldet.', { exact: false }).waitFor();
    check('empty catalogs explain recovery and retain the saved model', await dialog.locator('#edit-agent-ollama-model').inputValue() === 'coder:large');
    writeFileSync(modelFile, 'offline'); await dialog.getByRole('button', { name: 'Modelle aktualisieren', exact: true }).click();
    await dialog.getByText('Ollama-Modelle konnten nicht geladen werden.', { exact: false }).waitFor();
    check('service failures offer a refresh path in the dialog', await dialog.getByRole('button', { name: 'Modelle aktualisieren', exact: true }).isEnabled());
    writeFileSync(modelFile, 'coder:new\ncoder:large\n'); await dialog.getByRole('button', { name: 'Modelle aktualisieren', exact: true }).click();
    await dialog.locator('#edit-agent-ollama-model option[value="coder:new"]').waitFor({ state: 'attached' });
    await dialog.locator('#edit-agent-ollama-model').selectOption('coder:new');
    check('model refresh discovers a newly installed model', (await dialog.locator('#edit-agent-cmd').getAttribute('placeholder'))?.includes('--model coder:new'));
    await dialog.getByLabel('Ollama verwenden als').selectOption('chat');
    check('direct chat previews the existing Ollama command', await dialog.locator('#edit-agent-cmd').getAttribute('placeholder') === 'ollama run coder:new');
    await dialog.getByLabel('Ollama verwenden als').selectOption('coding');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    check('saving settings returns focus to the opener', await page.getByRole('button', { name: 'Agent settings for Ollama Fixture', exact: true }).evaluate(node => node === document.activeElement));
    const template = await page.evaluate(id => window.ade.invoke('agentTemplate:create', { sourceAgentId: id, name: 'Ollama Template' }), agent.id);
    const copy = await page.evaluate(templateId => window.ade.invoke('agentTemplate:spawn', { templateId, categoryId: 'coding', name: 'Ollama Copy', defaultRepositoryId: null }), template.id);
    check('templates preserve the coding mode and refreshed model', template.ollamaMode === 'coding' && copy.ollamaMode === 'coding' && copy.ollamaModel === 'coder:new');
    const session = await page.evaluate(agentId => window.ade.invoke('session:launch', { agentId, repositoryId: null, mode: 'agent' }), agent.id);
    for (let attempt = 0; attempt < 100 && !existsSync(proof); attempt++) await new Promise(done => setTimeout(done, 100));
    const launched = readFileSync(proof, 'utf8');
    check('real ConPTY launches the coding CLI with the selected Ollama model', launched.startsWith('codex.exe\n') && launched.includes('--oss\n--local-provider\nollama\n--model\ncoder:new'));
    check('session metadata reports Ollama and its actual model', session.runtime === 'ollama' && session.launchModel === 'coder:new');
    await page.evaluate(sessionId => window.ade.invoke('pty:kill', { sessionId }), session.id);
    writeFileSync(modelFile, 'coder:large\n');
    const rejected = await page.evaluate(async agentId => {
      try { await window.ade.invoke('session:launch', { agentId, repositoryId: null, mode: 'agent' }); return false; }
      catch (error) { return String(error).includes('Modell ist nicht verfügbar'); }
    }, agent.id);
    check('a removed model is rejected by main before another PTY starts', rejected);
    writeFileSync(modelFile, 'coder:new\n');
    const positive = await page.evaluate(agentId => window.ade.invoke('session:launch', { agentId, repositoryId: null, mode: 'agent' }), agent.id);
    check('restoring the model permits a new session', positive.launchModel === 'coder:new');
    await page.evaluate(sessionId => window.ade.invoke('pty:kill', { sessionId }), positive.id);
    config = await page.evaluate(() => window.ade.invoke('config:get'));
    check('existing identities are unchanged', config.agents.find(item => item.id === 'shell')?.runtime === 'shell');
    check('Ollama flows have no renderer errors', errors.length === 0);
    mkdirSync(resolve('test-results/ollama'), { recursive: true });
    await page.getByRole('button', { name: 'Agent settings for Ollama Fixture', exact: true }).click(); await dialog.waitFor();
    await dialog.getByLabel('Ollama verwenden als').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve('test-results/ollama/settings.png') });
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    check('Escape closes settings and restores keyboard focus', await page.getByRole('button', { name: 'Agent settings for Ollama Fixture', exact: true }).evaluate(node => node === document.activeElement));
    console.log(`Ollama Electron: ${passed} passed, 0 failed`);
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
