import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { _electron as electron, chromium, type Browser, type ElectronApplication, type Page, type Locator } from 'playwright';
import { expect } from 'playwright/test';
import { mobileTlsProxy } from './helpers/mobileBrowser';

let passed = 0; let app: ElectronApplication | undefined; let browser: Browser | undefined;
let proxy: Awaited<ReturnType<typeof mobileTlsProxy>> | undefined;
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-reply-electron-')));
const evidence = resolve('test-results/reply-speech'); mkdirSync(evidence, { recursive: true });
const check = (name: string, ok: boolean) => { if (!ok) throw new Error(name); passed++; console.log(`  ok ${name}`); };
type RequestBody = { text: string; voice_settings: { speed: number; stability: number } };
const requests = (): RequestBody[] => existsSync(join(root, 'requests.jsonl')) ? readFileSync(join(root, 'requests.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
const answer = 'Die neue Antwort ist bereit. Ein Test bleibt noch offen.';
async function openReply(page: Page, parent: Locator): Promise<Locator> {
  await parent.getByRole('button', { name: 'Antwort anhören', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Antwort anhören', exact: true });
  await dialog.waitFor(); return dialog;
}
async function editReply(dialog: Locator, text = answer): Promise<void> {
  await dialog.getByLabel('Text zum Vorlesen', { exact: true }).fill(text);
  await dialog.getByRole('button', { name: 'Sprechtext prüfen', exact: true }).click();
  await expect(dialog.getByLabel('Sprechtext', { exact: true })).toHaveText(text);
}
async function listen(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Anhören', exact: true }).click();
  await dialog.getByText('Fertig. Du kannst die Antwort erneut anhören.', { exact: true }).waitFor();
}

void (async () => {
  const bin = join(root, 'bin'); mkdirSync(bin); const repo = join(root, 'Reply project'); mkdirSync(repo);
  const compile = join(root, 'compile.ps1');
  writeFileSync(compile, String.raw`param([string]$Target)
Add-Type -OutputAssembly $Target -OutputType ConsoleApplication -TypeDefinition @'
using System; using System.IO; using System.Runtime.InteropServices;
public class Fixture {
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int n);
  [DllImport("kernel32.dll")] static extern bool GetConsoleMode(IntPtr h, out uint mode);
  [DllImport("kernel32.dll")] static extern bool SetConsoleMode(IntPtr h, uint mode);
  public static void Main(string[] args) {
    if (Array.IndexOf(args, "--version") >= 0) { Console.WriteLine("codex 1.0.0"); return; }
    if (Array.IndexOf(args, "app-server") >= 0) return;
    Console.Write("REPLY_CLI_READY\r\nDie Antwort ist fertig. Bitte pruefe den offenen Test.\r\n");
    uint mode; var handle = GetStdHandle(-10); GetConsoleMode(handle, out mode); SetConsoleMode(handle, (mode & ~7u) | 0x200u);
    var stdin = Console.OpenStandardInput();
    while (true) { int value = stdin.ReadByte(); if (value == -1 || value == 4) return; File.AppendAllText("input-proof.txt", value + " "); }
  }
}
'@
`);
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', compile, join(bin, 'codex.exe')], { windowsHide: true, timeout: 30_000 });
  copyFileSync(join(bin, 'codex.exe'), join(bin, 'claude.exe')); copyFileSync(join(bin, 'codex.exe'), join(bin, 'grok.exe'));
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { windowsHide: true });
  git('init', '--initial-branch=main'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-m', 'Fixture');
  const reservation = createServer(); await new Promise<void>(done => reservation.listen(0, '127.0.0.1', done));
  const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('No fixture port');
  const port = address.port; await new Promise<void>(done => reservation.close(() => done()));
  const launcher = join(root, 'launch.cjs');
  writeFileSync(launcher, `const fs = require('node:fs'); const original = global.fetch;
global.fetch = async (url, init) => {
  if (String(url) === 'https://api.elevenlabs.io/v1/voices') return Response.json({voices:[{voice_id:'EXAVITQu4vr4xnSDxMaL',name:'Sarah',labels:{gender:'female'}}]});
  if (!String(url).startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) return original(url, init);
  fs.appendFileSync(${JSON.stringify(join(root, 'requests.jsonl'))}, init.body + '\\n');
  const mode = fs.existsSync(${JSON.stringify(join(root, 'provider-mode'))}) ? fs.readFileSync(${JSON.stringify(join(root, 'provider-mode'))}, 'utf8') : '';
  if (mode === 'wait') await new Promise((_done, fail) => init.signal.addEventListener('abort', () => { fs.writeFileSync(${JSON.stringify(join(root, 'aborted'))}, 'yes'); fail(new Error('aborted')); }, {once:true}));
  if (mode === 'fail') return new Response('private-fixture-secret C:\\\\Users\\\\Private', {status:500});
  return new Response(fs.readFileSync(${JSON.stringify(resolve('scripts/fixtures/speech-silence.mp3'))}), {headers:{'content-type':'audio/mpeg'}});
};
const cp = require('node:child_process'); const originalExec = cp.execFile;
cp.execFile = function(file,args,options,callback) {
  if (!/tailscale(?:\\.exe)?$/i.test(file)) return originalExec.call(this,file,args,options,callback);
  const config = {TCP:{'443':{HTTPS:true}},Web:{'ade-mobile.fixture.ts.net:443':{Handlers:{'/':{Proxy:'http://127.0.0.1:${port}'}}}}};
  queueMicrotask(() => callback(null,JSON.stringify(args[0] === 'status' ? {BackendState:'Running',Self:{DNSName:'ade-mobile.fixture.ts.net.',Online:true}} : config))); return {};
};
cp.execFile[require('node:util').promisify.custom] = (file,args,options) => new Promise((done,fail) => cp.execFile(file,args,options,(error,stdout,stderr) => error ? fail(error) : done({stdout,stderr})));
require(${JSON.stringify(resolve('out/main/index.js'))});`);
  app = await electron.launch({ args: [launcher], cwd: resolve('.'), env: { ...process.env,
    Path: `${bin};${process.env.Path ?? process.env.PATH}`, ADE_USER_DATA_DIR: join(root, 'profile'), ADE_HOST_API_ENABLED: '0', ADE_MOBILE_PORT: String(port), NODE_ENV: 'test',
    CODEX_HOME: join(root, 'codex-home'), CLAUDE_CONFIG_DIR: join(root, 'claude-home'), GROK_HOME: join(root, 'grok-home'),
  } });
  const page = await app.firstWindow(); page.setDefaultTimeout(20_000);
  await page.evaluate(async ({ path, parent }) => {
    await window.ade.invoke('repository:import', { path, name: 'Reply project', executionBackend: 'native' });
    await window.ade.invoke('projectDefaults:save', { rootPath: parent, agentId: null });
    await window.ade.invoke('harness:setServiceKey', { name: 'ELEVENLABS_API_KEY', value: 'reply-fixture-secret', scope: 'all' });
  }, { path: repo, parent: root });
  await page.reload(); await page.getByRole('tab', { name: 'Projekte view', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace öffnen: Reply project', exact: true }).click();
  const terminal = page.getByRole('region', { name: 'Projekt-Terminal', exact: true });
  await terminal.getByRole('button', { name: 'Codex öffnen', exact: true }).click();
  await expect(terminal.locator('.xterm-screen')).toContainText('REPLY_CLI_READY');
  let dialog = await openReply(page, terminal);
  await dialog.getByText('Bereit zum Anhören.', { exact: true }).waitFor();
  check('desktop opens a local preview without a paid synthesis', requests().length === 0 && (await dialog.getByLabel('Text zum Vorlesen', { exact: true }).inputValue()).includes('Bitte pruefe'));
  check('dialog initially focuses its heading', await dialog.getByRole('heading', { name: 'Antwort anhören', exact: true }).evaluate(node => node === document.activeElement));
  await page.keyboard.press('Shift+Tab');
  check('native modal keeps keyboard focus inside', await dialog.evaluate(node => node.contains(document.activeElement)));
  await editReply(dialog); await listen(dialog);
  check('explicit playback speaks exactly the reviewed text with saved slower speed', requests().length === 1 && requests()[0]!.text === answer && requests()[0]!.voice_settings.speed === 0.85);
  await dialog.getByRole('button', { name: 'Erneut abspielen', exact: true }).click();
  await dialog.getByText('Fertig. Du kannst die Antwort erneut anhören.', { exact: true }).waitFor();
  check('replay decodes cached audio without a second provider call', requests().length === 1);
  await dialog.screenshot({ path: join(evidence, 'desktop-reply.png') });
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  check('Escape restores desktop opener focus', await terminal.getByRole('button', { name: 'Antwort anhören', exact: true }).evaluate(node => node === document.activeElement));
  writeFileSync(join(root, 'provider-mode'), 'wait');
  dialog = await openReply(page, terminal); await editReply(dialog);
  await dialog.getByRole('button', { name: 'Anhören', exact: true }).click();
  await expect.poll(() => requests().length).toBe(2);
  await dialog.getByRole('button', { name: 'Stoppen', exact: true }).click();
  await expect.poll(() => existsSync(join(root, 'aborted'))).toBe(true);
  check('Stop aborts in-flight provider work and permits a new reviewed attempt', await dialog.getByRole('button', { name: 'Sprechtext prüfen', exact: true }).isEnabled());
  writeFileSync(join(root, 'provider-mode'), 'fail');
  await dialog.getByRole('button', { name: 'Sprechtext prüfen', exact: true }).click();
  await dialog.getByRole('button', { name: 'Anhören', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('HTTP 500');
  check('provider failure exposes neither credentials nor upstream paths', !(await dialog.innerText()).includes('private-fixture-secret') && !(await dialog.innerText()).includes('Users'));
  await dialog.getByRole('button', { name: 'Anhören', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('HTTP 500');
  check('failed receipt cannot silently charge another synthesis', requests().length === 3);
  writeFileSync(join(root, 'provider-mode'), '');
  await page.keyboard.press('Escape');
  dialog = await openReply(page, terminal);
  await dialog.getByLabel('Text zum Vorlesen', { exact: true }).fill('```sh\nprivate code\n```');
  await dialog.getByRole('button', { name: 'Sprechtext prüfen', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('kein vorlesbarer Text');
  check('code-only source provides an editable error without provider cost', requests().length === 3);
  await editReply(dialog); await listen(dialog);
  check('final desktop positive control follows cancellation and provider failure', requests().length === 4);
  await page.keyboard.press('Escape');
  check('review and playback send no keystrokes to the CLI', !existsSync(join(repo, 'input-proof.txt')));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const mobileSettings = page.getByTestId('mobile-access');
  await mobileSettings.getByRole('button', { name: 'Mit Tailscale aktivieren', exact: true }).click();
  await mobileSettings.getByText('Private Freigabe eingerichtet.', { exact: true }).waitFor();
  await mobileSettings.getByRole('button', { name: 'Tablet oder Smartphone koppeln', exact: true }).click();
  const code = await mobileSettings.getByLabel('Einmaliger Pairing-Code').inputValue();
  proxy = await mobileTlsProxy(); proxy.target(port); proxy.rewriteOrigin('https://ade-mobile.fixture.ts.net');
  browser = await chromium.launch({ channel: 'chromium', args: ['--ignore-certificate-errors', '--host-resolver-rules=MAP ade-mobile.fixture.ts.net 127.0.0.1'] });
  const tablet = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true, ignoreHTTPSErrors: true }); tablet.setDefaultTimeout(25_000);
  await tablet.goto(`${proxy.origin}/#pair=${code}`);
  await tablet.getByLabel('Gerätename', { exact: true }).fill('Reply tablet');
  await tablet.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click();
  await tablet.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await page.evaluate(async () => {
    const device = (await window.ade.invoke('remoteDevices:list')).devices.find(item => item.name === 'Reply tablet')!;
    await window.ade.invoke('remoteDevices:setAdminScopes', { deviceId: device.id, scopes: ['workspace:read', 'projects:write', 'terminal:control'] });
  });
  await tablet.getByRole('tab', { name: 'Projekte', exact: true }).click();
  await tablet.getByRole('button', { name: 'Workspace öffnen: Reply project', exact: true }).click();
  const project = tablet.getByRole('dialog', { name: 'Projekt · Reply project', exact: true });
  await project.getByRole('button', { name: 'Workspace öffnen', exact: true }).click();
  await project.getByRole('button', { name: 'Codex öffnen', exact: true }).click();
  await expect(project.locator('.xterm-screen')).toContainText('REPLY_CLI_READY');
  await project.getByRole('button', { name: 'Eingabe übernehmen', exact: true }).click();
  const promptOpener = project.getByRole('button', { name: 'Prompt / Diktat', exact: true });
  await promptOpener.click();
  const promptDialog = tablet.getByRole('dialog', { name: 'Prompt und Diktat', exact: true });
  await promptDialog.waitFor(); await tablet.keyboard.press('Escape'); await expect(promptOpener).toBeFocused();
  // A delayed resize/lease heartbeat must not blur the restored opener.
  let heartbeatSeen = false; let releaseHeartbeat!: () => void;
  const heartbeatGate = new Promise<void>(done => { releaseHeartbeat = done; });
  let finishHeartbeat!: () => void; const heartbeatFinished = new Promise<void>(done => { finishHeartbeat = done; });
  const inputRoute = '**/api/v1/terminal/input';
  await tablet.route(inputRoute, async route => {
    const held = !heartbeatSeen && route.request().postDataJSON()?.data === '';
    if (held) { heartbeatSeen = true; await heartbeatGate; }
    try { await route.continue(); } finally { if (held) finishHeartbeat(); }
  });
  try {
    await tablet.setViewportSize({ width: 1000, height: 760 });
    await expect.poll(() => heartbeatSeen, { timeout: 15_000 }).toBe(true);
    check('delayed terminal heartbeat preserves focus on the restored prompt opener', await promptOpener.evaluate(node => node === document.activeElement));
    check('busy prompt opener remains focusable while rejecting activation', await promptOpener.getAttribute('aria-disabled') === 'true' && await promptOpener.getAttribute('disabled') === null);
    await tablet.keyboard.press('Enter'); check('heartbeat does not permit opening a second prompt action', await promptDialog.count() === 0);
  } finally { releaseHeartbeat(); if (heartbeatSeen) await heartbeatFinished; await tablet.unroute(inputRoute); }
  await expect(promptOpener).toBeEnabled(); await tablet.setViewportSize({ width: 1024, height: 768 });
  dialog = await openReply(tablet, project);
  await dialog.getByRole('alert').waitFor();
  check('terminal permission alone cannot authorize voice playback', requests().length === 4 && await dialog.getByRole('button', { name: 'Anhören', exact: true }).isDisabled());
  await tablet.keyboard.press('Escape');
  await page.evaluate(async () => {
    const device = (await window.ade.invoke('remoteDevices:list')).devices.find(item => item.name === 'Reply tablet')!;
    await window.ade.invoke('remoteDevices:setAdminScopes', { deviceId: device.id, scopes: ['workspace:read', 'projects:write', 'terminal:control', 'speech:control'] });
  });
  dialog = await openReply(tablet, project); await editReply(dialog, 'Diese Antwort kommt vom Tablet. Bitte den Test noch prüfen.');
  check('tablet preview uses signed HTTP without synthesizing on open', requests().length === 4);
  await listen(dialog);
  check('tablet plays audio from its own browser through the authorized host API', requests().length === 5 && requests()[4]!.text.startsWith('Diese Antwort kommt vom Tablet.'));
  await dialog.getByRole('button', { name: 'Erneut abspielen', exact: true }).click();
  await dialog.getByText('Fertig. Du kannst die Antwort erneut anhören.', { exact: true }).waitFor();
  check('tablet replay has no second provider cost', requests().length === 5);
  await dialog.screenshot({ path: join(evidence, 'tablet-reply.png') });
  await tablet.keyboard.press('Escape');
  check('nested reply Escape leaves the project session open', await project.isVisible() && await project.getByRole('button', { name: 'Antwort anhören', exact: true }).evaluate(node => node === document.activeElement));
  await project.getByRole('button', { name: 'Verlauf', exact: true }).click();
  const history = project.getByLabel('Terminalverlauf lesen', { exact: true });
  await history.evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  });
  dialog = await openReply(tablet, project);
  await dialog.getByText('Bereit zum Anhören.', { exact: true }).waitFor();
  check('tablet history selection reaches the preview through the visible read button', (await dialog.innerText()).includes('Dein markierter Text'));
  await tablet.keyboard.press('Escape');
  check('reply Escape preserves underlying history and project dialog', await history.isVisible() && await project.isVisible());
  await tablet.setViewportSize({ width: 390, height: 844 });
  dialog = await openReply(tablet, project); await editReply(dialog);
  const box = await dialog.boundingBox();
  check('phone dialog stays within the viewport and uses touch-size controls', !!box && box.x >= 0 && box.x + box.width <= 390 && (await dialog.getByRole('button', { name: 'Anhören', exact: true }).boundingBox())!.height >= 44);
  check('phone help text wraps instead of inheriting terminal whitespace and tiny type', await dialog.evaluate(node => node.scrollWidth <= node.clientWidth && getComputedStyle(node).whiteSpace === 'normal' && Number.parseFloat(getComputedStyle(node).fontSize) >= 14));
  await dialog.screenshot({ path: join(evidence, 'phone-reply.png') });
  const storage = await tablet.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
  const receipts = readFileSync(join(root, 'profile', 'ade', 'remote', 'commands.json'), 'utf8');
  check('speech source and audio never enter browser storage or durable command receipts', !storage.includes('Diese Antwort kommt') && !storage.includes(answer) && !receipts.includes('Diese Antwort kommt') && !receipts.includes(answer) && !receipts.includes('audio/mpeg'));
  await listen(dialog);
  check('final phone positive control follows all negative cases', requests().length === 6);
  await tablet.keyboard.press('Escape');
  writeFileSync(join(evidence, 'results.json'), JSON.stringify({ passed, failed: 0, providerRequests: requests().length, actualProviderCalls: 0 }, null, 2));
  console.log(`Reply speech Electron/tablet: ${passed} passed, 0 failed`);
})().catch(async error => {
  console.error(error); process.exitCode = 1;
  for (const [name, page] of [['desktop', app?.windows()[0]], ['tablet', browser?.contexts()[0]?.pages()[0]]] as const) if (page && !page.isClosed()) {
    await page.screenshot({ path: join(evidence, `${name}-failure.png`) }).catch(() => undefined);
    writeFileSync(join(evidence, `${name}-failure.txt`), await page.locator('body').innerText().catch(() => 'Page closed during failure capture.'));
  }
}).finally(async () => {
  await browser?.close(); await proxy?.close(); await app?.close();
  if (dirname(root) !== realpathSync.native(tmpdir()) || !root.includes('ade-reply-electron-')) throw new Error('Unexpected reply fixture path');
  rmSync(root, { recursive: true, force: true });
});
