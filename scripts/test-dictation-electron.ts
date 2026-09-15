import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { _electron as electron, chromium, type Browser, type ElectronApplication } from 'playwright';
import { mobileTlsProxy } from './helpers/mobileBrowser';

let passed = 0; let app: ElectronApplication | undefined; let browser: Browser | undefined; let proxy: Awaited<ReturnType<typeof mobileTlsProxy>> | undefined;
const check = (name: string, ok: boolean) => { if (!ok) throw new Error(name); passed++; console.log(`  ok ${name}`); };
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-dictation-electron-')));
const evidence = resolve('test-results/dictation'); mkdirSync(evidence, { recursive: true });
void (async () => {
  const bin = join(root, 'bin'); mkdirSync(bin); const repo = join(root, 'Dictation project'); mkdirSync(repo);
  const compile = join(root, 'compile.ps1');
  writeFileSync(compile, String.raw`param([string]$Target)
Add-Type -OutputAssembly $Target -OutputType ConsoleApplication -TypeDefinition @'
using System; using System.IO; using System.Text; using System.Runtime.InteropServices;
public class Fixture {
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int n);
  [DllImport("kernel32.dll")] static extern bool GetConsoleMode(IntPtr h, out uint mode);
  [DllImport("kernel32.dll")] static extern bool SetConsoleMode(IntPtr h, uint mode);
  [DllImport("kernel32.dll")] static extern bool SetConsoleCP(uint cp);
  public static void Main(string[] args) {
  if (Array.IndexOf(args, "--version") >= 0) { Console.WriteLine("codex 1.0.0"); return; }
  Console.Write("\x1b[?2004hDICTATION_CLI_READY\r\n");
  uint mode; var handle = GetStdHandle(-10); GetConsoleMode(handle, out mode); SetConsoleMode(handle, (mode & ~7u) | 0x200u); SetConsoleCP(65001);
  var input = new StringBuilder(); var stdin = Console.OpenStandardInput();
  while (true) {
    int value = stdin.ReadByte(); if (value == -1 || value == 4) return;
    input.Append((char)value);
    if (input.ToString().EndsWith("\x1b[201~\r")) {
      File.AppendAllText("prompt-proof.jsonl", Convert.ToBase64String(Encoding.GetEncoding(28591).GetBytes(input.ToString())) + "\n");
      Console.Write("PROMPT_ACCEPTED\r\n"); input.Clear();
    }
  }
} }
'@
`);
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', compile, join(bin, 'codex.exe')], { windowsHide: true, timeout: 30_000 });
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { windowsHide: true });
  git('init', '--initial-branch=main'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-m', 'Fixture');
  const launcher = join(root, 'launch.cjs');
  const reservation = createServer(); await new Promise<void>(done => reservation.listen(0, '127.0.0.1', done));
  const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('No fixture port');
  const port = address.port; await new Promise<void>(done => reservation.close(() => done()));
  writeFileSync(launcher, `const fs = require('node:fs'); const original = global.fetch;
global.fetch = async (url, init) => {
  if (String(url) !== 'https://api.elevenlabs.io/v1/speech-to-text') return original(url, init);
  const file = init.body.get('file');
  fs.appendFileSync(${JSON.stringify(join(root, 'provider.jsonl'))}, JSON.stringify({bytes: file.size, model: init.body.get('model_id'), file: file.name}) + '\\n');
  return Response.json({text:'Bitte prüfe den Code.',language_code:'deu'});
};
const cp = require('node:child_process'); const originalExec = cp.execFile;
cp.execFile = function(file,args,options,callback) {
  if (!/tailscale(?:\\.exe)?$/i.test(file)) return originalExec.call(this,file,args,options,callback);
  const config = {TCP:{'443':{HTTPS:true}},Web:{'ade-mobile.fixture.ts.net:443':{Handlers:{'/':{Proxy:'http://127.0.0.1:${port}'}}}}};
  queueMicrotask(() => callback(null,JSON.stringify(args[0] === 'status' ? {BackendState:'Running',Self:{DNSName:'ade-mobile.fixture.ts.net.',Online:true}} : config))); return {};
};
cp.execFile[require('node:util').promisify.custom] = (file,args,options) => new Promise((done,fail) => cp.execFile(file,args,options,(error,stdout,stderr) => error ? fail(error) : done({stdout,stderr})));
require(${JSON.stringify(resolve('out/main/index.js'))});`);
  app = await electron.launch({ args: [launcher, '--use-fake-device-for-media-stream'], cwd: resolve('.'), env: {
    ...process.env, Path: `${bin};${process.env.Path ?? process.env.PATH}`, ADE_USER_DATA_DIR: join(root, 'profile'), ADE_HOST_API_ENABLED: '0', ADE_MOBILE_PORT: String(port), NODE_ENV: 'test',
  } });
  const page = await app.firstWindow(); page.setDefaultTimeout(20_000);
  await page.evaluate(async ({ path, parent }) => {
    await window.ade.invoke('repository:import', { path, name: 'Dictation project', executionBackend: 'native' });
    await window.ade.invoke('projectDefaults:save', { rootPath: parent, agentId: null });
    await window.ade.invoke('harness:setServiceKey', { name: 'ELEVENLABS_API_KEY', value: 'dictation-fixture-secret', scope: 'all' });
  }, { path: repo, parent: root });
  await page.reload(); await page.getByRole('tab', { name: 'Projekte view', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace öffnen: Dictation project', exact: true }).click();
  const terminal = page.getByRole('region', { name: 'Projekt-Terminal', exact: true });
  await terminal.getByRole('button', { name: 'Codex öffnen', exact: true }).click();
  const microphoneDenied = await page.evaluate(async () => {
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach(track => track.stop()); return false; } catch { return true; }
  });
  check('microphone stays denied before an explicit dictation action', microphoneDenied);
  await terminal.getByRole('button', { name: 'Prompt / Diktat', exact: true }).focus();
  await page.keyboard.press('Enter'); const dialog = page.getByRole('dialog', { name: 'Prompt und Diktat', exact: true });
  const draft = dialog.getByLabel('CLI-Promptentwurf', { exact: true });
  check('dialog identifies project and branch', (await dialog.innerText()).includes('Dictation project') && (await dialog.innerText()).includes('main'));
  await draft.fill('Prüfe zuerst.');
  await dialog.getByRole('button', { name: 'In CLI einfügen', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => { const button = [...document.querySelectorAll('button')].find(node => node.textContent === 'In CLI einfügen'); return button && !button.disabled; });
  check('running protected CLI advertises bracketed prompt delivery', true);
  const sessions = await page.evaluate(() => window.ade.invoke('pty:list')); const session = sessions.sessions.find(item => item.projectWorkspaceId)!;
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  check('Escape restores terminal tool focus', await terminal.getByRole('button', { name: 'Prompt / Diktat', exact: true }).evaluate(node => node === document.activeElement));
  await terminal.getByRole('button', { name: 'Prompt / Diktat', exact: true }).click();
  check('draft survives closing without sending', await draft.inputValue() === 'Prüfe zuerst.' && !existsSync(join(repo, 'prompt-proof.jsonl')));
  await dialog.getByRole('button', { name: 'Diktieren', exact: true }).click();
  await dialog.getByRole('button', { name: /Aufnahme stoppen/ }).waitFor();
  await new Promise(done => setTimeout(done, 650));
  await dialog.getByRole('button', { name: /Aufnahme stoppen/ }).click();
  await dialog.getByText('Transkript eingefügt. Bitte prüfen, dann gezielt übergeben.', { exact: true }).waitFor();
  check('real Chromium microphone/MediaRecorder/decode reaches provider as bounded WAV', JSON.parse(readFileSync(join(root, 'provider.jsonl'), 'utf8').trim()).bytes > 3244);
  check('transcript is appended to editable draft without terminal execution', await draft.inputValue() === 'Prüfe zuerst.\nBitte prüfe den Code.' && !existsSync(join(repo, 'prompt-proof.jsonl')));
  await draft.fill('Prüfe nur diese Datei.');
  await dialog.getByRole('button', { name: 'An CLI absenden', exact: true }).click();
  await dialog.getByText('An die CLI übergeben. Die Verarbeitung durch das Modell ist damit noch nicht bestätigt.', { exact: true }).waitFor();
  for (let attempt = 0; attempt < 100 && !existsSync(join(repo, 'prompt-proof.jsonl')); attempt++) await new Promise(done => setTimeout(done, 20));
  check('edited prompt reaches real ConPTY exactly once with paste markers and Enter', readFileSync(join(repo, 'prompt-proof.jsonl'), 'utf8').trim() === Buffer.from('\x1b[200~Prüfe nur diese Datei.\x1b[201~\r').toString('base64'));
  check('accepted delivery clears only this draft', await draft.inputValue() === '');
  await draft.fill('Dieser Entwurf bleibt erhalten.');
  await page.evaluate(async id => window.ade.invoke('pty:write', { sessionId: id, dataBase64: btoa('\x04') }), session.id);
  await page.waitForFunction(() => { const button = [...document.querySelectorAll('button')].find(node => node.textContent === 'An CLI absenden'); return button?.disabled; });
  check('CLI exit disables delivery and keeps unsent text', await draft.inputValue() === 'Dieser Entwurf bleibt erhalten.');
  await page.setViewportSize({ width: 800, height: 600 });
  check('prompt dialog fits narrow desktop', await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
  check('API key never appears in rendered UI', !(await page.content()).includes('dictation-fixture-secret'));
  await page.screenshot({ path: join(evidence, 'desktop.png') });
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const mobileSettings = page.getByTestId('mobile-access');
  await mobileSettings.getByRole('button', { name: 'Mit Tailscale aktivieren', exact: true }).click();
  await mobileSettings.getByText('Private Freigabe eingerichtet.', { exact: true }).waitFor();
  await mobileSettings.getByRole('button', { name: 'Tablet oder Smartphone koppeln', exact: true }).click();
  const code = await mobileSettings.getByLabel('Einmaliger Pairing-Code').inputValue();
  proxy = await mobileTlsProxy(); proxy.target(port); proxy.rewriteOrigin('https://ade-mobile.fixture.ts.net');
  // Full Chromium: the separate headless-shell build rejects this media request
  // despite a granted microphone permission (verified by a local negative probe).
  browser = await chromium.launch({ channel: 'chromium', args: ['--ignore-certificate-errors', '--use-fake-device-for-media-stream', '--host-resolver-rules=MAP ade-mobile.fixture.ts.net 127.0.0.1'] });
  const tablet = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true, ignoreHTTPSErrors: true }); tablet.setDefaultTimeout(25_000);
  await tablet.context().grantPermissions(['microphone'], { origin: proxy.origin });
  const navigation = await tablet.goto(`${proxy.origin}/#pair=${code}`);
  check('mobile document allows its own microphone but keeps camera disabled', navigation?.headers()['permissions-policy'] === 'camera=(), microphone=(self), geolocation=()');
  await tablet.getByLabel('Gerätename', { exact: true }).fill('Dictation tablet');
  await tablet.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click();
  await tablet.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await page.evaluate(async () => {
    const device = (await window.ade.invoke('remoteDevices:list')).devices.find(item => item.name === 'Dictation tablet')!;
    await window.ade.invoke('remoteDevices:setAdminScopes', { deviceId: device.id, scopes: ['workspace:read', 'projects:write', 'terminal:control', 'dictation:transcribe'] });
  });
  await tablet.getByRole('tab', { name: 'Projekte', exact: true }).click();
  await tablet.getByRole('button', { name: 'Workspace öffnen: Dictation project', exact: true }).click();
  const project = tablet.getByRole('dialog', { name: 'Projekt · Dictation project', exact: true });
  await project.getByRole('button', { name: 'Workspace öffnen', exact: true }).click();
  await project.getByRole('button', { name: 'Codex öffnen', exact: true }).click();
  await project.getByLabel('CLI- und Terminalstatus', { exact: true }).filter({ hasText: 'Codex läuft' }).waitFor();
  await project.getByRole('button', { name: 'Prompt / Diktat', exact: true }).click();
  const mobileDialog = tablet.getByRole('dialog', { name: 'Prompt und Diktat', exact: true });
  const mobileDraft = mobileDialog.getByLabel('CLI-Promptentwurf', { exact: true });
  await mobileDraft.fill('Auf dem Tablet.');
  await mobileDialog.getByRole('button', { name: 'Diktieren', exact: true }).click();
  await mobileDialog.getByRole('button', { name: /Aufnahme stoppen/ }).waitFor();
  await new Promise(done => setTimeout(done, 2200));
  await mobileDialog.getByRole('button', { name: /Aufnahme stoppen/ }).click();
  await mobileDialog.getByText('Transkript eingefügt. Bitte prüfen, dann gezielt übergeben.', { exact: true }).waitFor();
  check('tablet records actual browser audio and appends transcript through signed host API', await mobileDraft.inputValue() === 'Auf dem Tablet.\nBitte prüfe den Code.');
  const requests = readFileSync(join(root, 'provider.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { bytes: number });
  check('tablet uploads audio beyond normal command size without a second desktop charge', requests.length === 2 && requests[1]!.bytes > 64 * 1024);
  await mobileDraft.fill('Aufgabe vom Tablet.');
  await mobileDialog.getByRole('button', { name: 'An CLI absenden', exact: true }).click();
  await mobileDialog.getByText('An die CLI übergeben. Die Verarbeitung durch das Modell ist damit noch nicht bestätigt.', { exact: true }).waitFor();
  check('tablet prompt reaches the selected real PTY exactly once', readFileSync(join(repo, 'prompt-proof.jsonl'), 'utf8').trim().split('\n').at(-1) === Buffer.from('\x1b[200~Aufgabe vom Tablet.\x1b[201~\r').toString('base64'));
  await mobileDraft.fill('Entwurf bleibt bei Verbindungsverlust.');
  proxy.losePromptReplies(true);
  await mobileDialog.getByRole('button', { name: 'An CLI absenden', exact: true }).click();
  await mobileDialog.getByText('Die vorige Übergabe ist nicht bestätigt. Vor erneutem Senden zuerst die CLI prüfen.', { exact: true }).waitFor();
  check('lost prompt receipt retains and locks draft instead of resending', await mobileDraft.inputValue() === 'Entwurf bleibt bei Verbindungsverlust.' && await mobileDraft.getAttribute('readonly') !== null);
  proxy.losePromptReplies(false);
  await tablet.keyboard.press('Escape'); await mobileDialog.waitFor({ state: 'hidden' });
  check('mobile dialog returns focus to prompt opener', await project.getByRole('button', { name: 'Prompt / Diktat', exact: true }).evaluate(node => node === document.activeElement));
  await project.getByRole('button', { name: 'Prompt / Diktat', exact: true }).click();
  check('reopened tablet draft preserves uncertain delivery', await mobileDraft.inputValue() === 'Entwurf bleibt bei Verbindungsverlust.' && await mobileDraft.getAttribute('readonly') !== null);
  await tablet.setViewportSize({ width: 768, height: 600 });
  check('tablet prompt remains usable with reduced keyboard viewport', await mobileDialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
  await tablet.screenshot({ path: join(evidence, 'tablet.png') });
  check('lost receipt never caused automatic repeated PTY writes', readFileSync(join(repo, 'prompt-proof.jsonl'), 'utf8').trim().split('\n').length === 3);
  console.log(`Dictation Electron: ${passed} passed, 0 failed`);
})().catch(async error => { console.error(error); console.log(`Dictation Electron: ${passed} passed, 1 failed`); process.exitCode = 1;
  if (app) { const page = await app.firstWindow(); writeFileSync(join(evidence, 'failure.txt'), await page.locator('body').innerText()); await page.screenshot({ path: join(evidence, 'failure.png') }); }
  const tablet = browser?.contexts()[0]?.pages()[0];
  if (tablet) {
    writeFileSync(join(evidence, 'tablet-failure.txt'), await tablet.locator('body').innerText()); await tablet.screenshot({ path: join(evidence, 'tablet-failure.png') });
    const media = await tablet.evaluate(async () => {
      let stage = 'getUserMedia';
      try { const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true }, video: false });
        stage = `MediaRecorder constructor, supported=${MediaRecorder.isTypeSupported('audio/webm;codecs=opus')}, tracks=${stream.getAudioTracks().length}`;
        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 64_000 });
        stage = 'MediaRecorder start';
        recorder.start(250); recorder.stop(); stream.getTracks().forEach(track => track.stop()); return { started: true };
      } catch (error) { return { stage, name: (error as Error).name, message: (error as Error).message }; }
    }); console.log('Fixture media diagnostic:', media);
  }
}).finally(async () => {
  await browser?.close(); await proxy?.close(); await app?.close();
  if (dirname(root) !== realpathSync.native(tmpdir()) || !root.includes('ade-dictation-electron-')) throw new Error('Unexpected dictation fixture path');
  rmSync(root, { recursive: true, force: true });
});
