import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { _electron as electron, chromium, type Browser, type ElectronApplication } from 'playwright';
import { mobileTlsProxy } from './helpers/mobileBrowser';
import { nativeUsageFixtureSource } from './helpers/nativeUsageFixture';

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
  if (Array.IndexOf(args, "app-server") >= 0) return;
  NativeUsageFixture.Report(args);
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
${nativeUsageFixtureSource}
'@
`);
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', compile, join(bin, 'codex.exe')], { windowsHide: true, timeout: 30_000 });
  copyFileSync(join(bin, 'codex.exe'), join(bin, 'claude.exe')); copyFileSync(join(bin, 'codex.exe'), join(bin, 'grok.exe'));
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { windowsHide: true });
  git('init', '--initial-branch=main'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-m', 'Fixture');
  const launcher = join(root, 'launch.cjs');
  const reservation = createServer(); await new Promise<void>(done => reservation.listen(0, '127.0.0.1', done));
  const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('No fixture port');
  const port = address.port; await new Promise<void>(done => reservation.close(() => done()));
  writeFileSync(launcher, `const fs = require('node:fs'); const original = global.fetch;
global.fetch = async (url, init) => {
  if (String(url) === 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe') return Response.json({token:'fixture-live-token'});
  if (String(url) !== 'https://api.elevenlabs.io/v1/speech-to-text') return original(url, init);
  const file = init.body.get('file');
  fs.appendFileSync(${JSON.stringify(join(root, 'provider.jsonl'))}, JSON.stringify({bytes: file.size, model: init.body.get('model_id'), file: file.name}) + '\\n');
  return Response.json({text:'Bitte prüfe den Code.',language_code:'deu'});
};
global.WebSocket = class extends EventTarget {
  readyState = 1; bufferedAmount = 0; bytes = 0; chunks = 0;
  constructor(url) {
    super(); const parsed = new URL(url);
    if (parsed.origin !== 'wss://api.elevenlabs.io' || parsed.searchParams.get('model_id') !== 'scribe_v2_realtime'
      || parsed.searchParams.get('audio_format') !== 'pcm_16000' || parsed.searchParams.get('token') !== 'fixture-live-token') throw new Error('Unexpected live endpoint');
    setTimeout(() => this.message({message_type:'session_started'}), 5);
  }
  message(data) { this.dispatchEvent(new MessageEvent('message', {data:JSON.stringify(data)})); }
  send(raw) {
    const data = JSON.parse(raw);
    if (data.message_type !== 'input_audio_chunk' || data.sample_rate !== 16000) throw new Error('Unexpected audio format');
    this.bytes += Buffer.from(data.audio_base_64, 'base64').length;
    if (data.commit) {
      fs.appendFileSync(${JSON.stringify(join(root, 'provider.jsonl'))}, JSON.stringify({bytes:this.bytes,model:'scribe_v2_realtime'}) + '\\n');
      setTimeout(() => this.message({message_type:'committed_transcript',text:'Bitte prüfe den Code.'}), 5);
    } else {
      this.chunks++;
      this.message({message_type:'partial_transcript',text:this.chunks === 1 ? 'Bitte prüfe' : 'Bitte prüfe den Code.'});
    }
  }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
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
    CODEX_HOME: join(root, 'codex-home'), CLAUDE_CONFIG_DIR: join(root, 'claude-home'), GROK_HOME: join(root, 'grok-home'),
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
  await terminal.getByLabel('Abo-Nutzung', { exact: true }).click();
  const consumption = terminal.getByRole('region', { name: 'Sitzungsverbrauch', exact: true });
  await consumption.getByText('codex-usage-fixture', { exact: false }).waitFor();
  check('desktop usage receives native Codex fixture through real launch argv and authenticated collector', (await consumption.innerText()).includes('15') && (await consumption.innerText()).includes('Input gesamt'));
  check('desktop usage labels unknown prices and cache subsets', (await consumption.innerText()).includes('ohne Kostenangabe') && (await consumption.innerText()).includes('Davon Cache gelesen'));
  await terminal.locator('summary[aria-label="Abo-Nutzung"]:visible').click();
  const microphoneDenied = await page.evaluate(async () => {
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach(track => track.stop()); return false; } catch { return true; }
  });
  check('microphone stays denied before an explicit dictation action', microphoneDenied);
  await terminal.getByRole('button', { name: 'Prompt / Diktat', exact: true }).focus();
  await page.keyboard.press('Enter'); const dialog = page.getByRole('dialog', { name: 'Prompt und Diktat', exact: true });
  const draft = dialog.getByLabel('CLI-Promptentwurf', { exact: true });
  check('opening the dock focuses its draft and exposes its expanded state', await draft.evaluate(node => node === document.activeElement)
    && await terminal.getByRole('button', { name: 'Prompt / Diktat', exact: true }).getAttribute('aria-expanded') === 'true');
  check('prompt dock leaves the terminal non-modal', await dialog.getAttribute('aria-modal') !== 'true'
    && await page.locator('.overlay:visible').count() === 0);
  const host = terminal.locator('.terminal-host:visible');
  const checkLayout = async (placement: 'right' | 'below') => {
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('.terminal-host')]
      .filter(node => node.clientWidth > 0).every(node => node.scrollWidth <= node.clientWidth + 1));
    const output = await host.boundingBox(); const prompt = await dialog.boundingBox();
    check(`prompt dock stays ${placement} without covering the terminal`, !!output && !!prompt && output.width >= 200 && output.height >= 150
      && (placement === 'right' ? output.x + output.width <= prompt.x + 1 : output.y + output.height <= prompt.y + 1));
    check(`prompt dock and terminal fit their ${placement} layout`, await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)
      && await host.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
  };
  await page.setViewportSize({ width: 1600, height: 1000 });
  await checkLayout('right');
  await dialog.getByRole('button', { name: 'Zum Terminal', exact: true }).click();
  check('terminal can receive focus while the prompt stays open', await terminal.getByLabel('Terminal-Eingabe', { exact: true }).evaluate(node => node === document.activeElement)
    && await dialog.isVisible());
  await terminal.getByRole('button', { name: 'Suchen', exact: true }).click();
  check('terminal tools remain usable beside the prompt', await terminal.getByLabel('Im Terminal suchen', { exact: true }).evaluate(node => node === document.activeElement));
  await page.keyboard.press('Escape');
  check('terminal search Escape leaves the prompt open', await dialog.isVisible());
  await terminal.getByRole('button', { name: 'Prompt / Diktat', exact: true }).click();
  check('prompt action returns focus to the existing draft', await draft.evaluate(node => node === document.activeElement));
  await dialog.getByRole('button', { name: 'Zum Terminal', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  check('Tab navigation can leave the non-modal prompt dock', !await dialog.evaluate(node => node.contains(document.activeElement)));
  await draft.focus();
  await terminal.locator('.project-terminal-screen').screenshot({ path: join(evidence, 'desktop-dock-wide.png') });
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
  await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('[aria-label="CLI-Promptentwurf"]')?.value.includes('Bitte prüfe'));
  check('desktop live transcript appears before Stop without executing the prompt', (await draft.inputValue()).startsWith('Prüfe zuerst.\nBitte prüfe')
    && !existsSync(join(repo, 'prompt-proof.jsonl')) && await draft.getAttribute('readonly') !== null);
  await terminal.locator('.project-terminal-screen').screenshot({ path: join(evidence, 'desktop-live.png') });
  await dialog.getByRole('button', { name: /Aufnahme stoppen/ }).click();
  await dialog.getByText('Transkript eingefügt. Bitte prüfen, dann gezielt übergeben.', { exact: true }).waitFor();
  const liveRequest = JSON.parse(readFileSync(join(root, 'provider.jsonl'), 'utf8').trim());
  check('real Chromium microphone and AudioWorklet stream bounded PCM to the live provider fixture', liveRequest.bytes >= 3200 && liveRequest.bytes <= 1_920_000 && liveRequest.model === 'scribe_v2_realtime');
  check('transcript is appended to editable draft without terminal execution', await draft.inputValue() === 'Prüfe zuerst.\nBitte prüfe den Code.' && !existsSync(join(repo, 'prompt-proof.jsonl')));
  check('committed live transcript is editable again', await draft.getAttribute('readonly') === null);
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  await terminal.locator('summary[aria-label="Abo-Nutzung"]:visible').click();
  const desktopSpeech = consumption.getByRole('region', { name: 'Diktatverbrauch', exact: true });
  await desktopSpeech.getByText('Antwort erhalten', { exact: true }).waitFor();
  check('desktop dictation appears as measured audio with unknown cost', (await desktopSpeech.innerText()).includes('Sek. Audio') && (await desktopSpeech.innerText()).includes('Kosten pro Auftrag sind unbekannt'));
  const measured = await page.evaluate(async id => (await window.ade.invoke('terminal:usage', { sessionId: id })).consumption?.speech?.[0], session.id);
  check('desktop speech usage is exactly one completed request on its target', measured?.requests.complete === 1 && measured.amounts.complete > 0 && measured.requests.unconfirmed === 0);
  await terminal.locator('summary[aria-label="Abo-Nutzung"]:visible').click();
  await terminal.getByRole('button', { name: 'Prompt / Diktat', exact: true }).click();
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
  await checkLayout('below');
  check('draft survives responsive dock changes', await draft.inputValue() === 'Dieser Entwurf bleibt erhalten.');
  await dialog.getByRole('button', { name: 'Schliessen', exact: true }).click();
  check('close button restores prompt opener focus', await terminal.getByRole('button', { name: 'Prompt / Diktat', exact: true }).evaluate(node => node === document.activeElement));
  await terminal.getByRole('button', { name: 'Prompt / Diktat', exact: true }).click();
  check('API key never appears in rendered UI', !(await page.content()).includes('dictation-fixture-secret'));
  await page.screenshot({ path: join(evidence, 'desktop.png') });
  await page.keyboard.press('Escape');
  for (const [runtime, model, expected] of [['claude', 'claude-usage-fixture', 17225], ['grok', 'grok-usage-fixture', 5280]] as const) {
    if (runtime === 'claude') await terminal.getByRole('button', { name: 'Claude Code öffnen', exact: true }).click();
    else {
      await terminal.getByLabel('Projekt-CLI', { exact: true }).selectOption('grok');
      await terminal.getByRole('button', { name: 'Auswahl öffnen / fortsetzen', exact: true }).click();
    }
    await terminal.getByLabel('CLI- und Terminalstatus', { exact: true }).filter({ hasText: runtime === 'claude' ? 'Claude Code läuft' : 'Grok Build läuft' }).waitFor();
    await terminal.locator('summary[aria-label="Abo-Nutzung"]:visible').click();
    const current = terminal.getByRole('region', { name: 'Sitzungsverbrauch', exact: true });
    await current.getByText(model, { exact: false }).waitFor();
    const usage = await page.evaluate(async model => {
      const sessions = (await window.ade.invoke('pty:list')).sessions;
      const runtime = model.startsWith('claude') ? 'claude' : 'grok'; const session = sessions.find(item => item.runtime === runtime)!;
      return (await window.ade.invoke('terminal:usage', { sessionId: session.id })).consumption;
    }, model);
    check(`${model} is counted from its own native source after the actual ADE start`, usage?.tokens.input === expected && usage.events === 1);
    await terminal.locator('summary[aria-label="Abo-Nutzung"]:visible').click();
  }
  const projectTabs = terminal.getByRole('tablist', { name: 'Projekt-Terminalsitzungen', exact: true }).getByRole('tab');
  await terminal.getByRole('button', { name: 'Prompt / Diktat', exact: true }).click();
  await draft.fill('Nur für die Grok-Sitzung.');
  await projectTabs.first().click(); await dialog.waitFor({ state: 'hidden' });
  check('session switching closes the dock and keeps focus in the newly selected terminal', await host.getByLabel('Terminal-Eingabe', { exact: true }).evaluate(node => node === document.activeElement));
  await terminal.getByRole('button', { name: 'Prompt / Diktat', exact: true }).click();
  check('switching sessions shows that session’s own draft', await draft.inputValue() === 'Dieser Entwurf bleibt erhalten.');
  await page.keyboard.press('Escape');
  await projectTabs.last().click();
  await terminal.getByRole('button', { name: 'Prompt / Diktat', exact: true }).click();
  check('returning to a session preserves its unsent dock draft', await draft.inputValue() === 'Nur für die Grok-Sitzung.');
  await dialog.getByRole('button', { name: 'Diktieren', exact: true }).click();
  await dialog.getByRole('button', { name: /Aufnahme stoppen/ }).waitFor();
  await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('[aria-label="CLI-Promptentwurf"]')?.value.includes('Bitte prüfe'));
  await dialog.getByRole('button', { name: 'Schliessen', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const microphoneAfterClose = await page.evaluate(async () => {
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach(track => track.stop()); return false; } catch { return true; }
  });
  check('closing the recording dock revokes its microphone permission', microphoneAfterClose);
  await terminal.getByRole('button', { name: 'Prompt / Diktat', exact: true }).click();
  check('closing during live dictation keeps the old draft and permits a fresh recording', await draft.inputValue() === 'Nur für die Grok-Sitzung.'
    && !await dialog.getByRole('button', { name: 'Diktieren', exact: true }).isDisabled());
  const cancelledUsage = await page.evaluate(async () => {
    const grok = (await window.ade.invoke('pty:list')).sessions.find(item => item.runtime === 'grok')!;
    return (await window.ade.invoke('terminal:usage', { sessionId: grok.id })).consumption?.speech?.[0];
  });
  check('cancelled live recording is retained as one unconfirmed usage attempt', cancelledUsage?.requests.unconfirmed === 1 && cancelledUsage.requests.complete === 0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
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
  await project.locator('summary[aria-label="Abo-Nutzung"]:visible').click();
  const mobileConsumption = project.getByRole('region', { name: 'Sitzungsverbrauch', exact: true });
  await mobileConsumption.getByText('codex-usage-fixture', { exact: false }).waitFor();
  check('tablet gets the selected terminal numeric usage through the existing authorized read', (await mobileConsumption.innerText()).includes('Input gesamt') && !(await mobileConsumption.innerText()).includes(root));
  await tablet.keyboard.press('Escape');
  check('tablet usage Escape returns focus to its disclosure', await project.locator('summary[aria-label="Abo-Nutzung"]:visible').evaluate(node => node === document.activeElement));
  await project.getByRole('button', { name: 'Prompt / Diktat', exact: true }).click();
  const mobileDialog = tablet.getByRole('dialog', { name: 'Prompt und Diktat', exact: true });
  check('tablet prompt names the authorized project even without an agent profile', (await mobileDialog.innerText()).includes('An: Dictation project · Codex · main'));
  const mobileDraft = mobileDialog.getByLabel('CLI-Promptentwurf', { exact: true });
  await mobileDraft.fill('Auf dem Tablet.');
  await mobileDialog.getByRole('button', { name: 'Diktieren', exact: true }).click();
  await mobileDialog.getByRole('button', { name: /Aufnahme stoppen/ }).waitFor();
  await tablet.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('[aria-label="CLI-Promptentwurf"]')?.value.includes('Bitte prüfe'));
  check('tablet live preview appears before Stop and cannot submit unfinished speech', (await mobileDraft.inputValue()).startsWith('Auf dem Tablet.\nBitte prüfe')
    && await mobileDraft.getAttribute('readonly') !== null && await mobileDialog.getByRole('button', { name: 'An CLI absenden', exact: true }).isDisabled());
  await tablet.screenshot({ path: join(evidence, 'tablet-live.png') });
  await new Promise(done => setTimeout(done, 2200));
  await mobileDialog.getByRole('button', { name: /Aufnahme stoppen/ }).click();
  await mobileDialog.getByText('Transkript eingefügt. Bitte prüfen, dann gezielt übergeben.', { exact: true }).waitFor();
  check('tablet records actual browser audio and appends transcript through signed host API', await mobileDraft.inputValue() === 'Auf dem Tablet.\nBitte prüfe den Code.');
  const requests = readFileSync(join(root, 'provider.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { bytes: number; model: string });
  check('tablet streams actual PCM once using the live model without a batch upload', requests.length === 2 && requests[1]!.bytes > 64 * 1024 && requests[1]!.model === 'scribe_v2_realtime');
  await tablet.keyboard.press('Escape'); await mobileDialog.waitFor({ state: 'hidden' });
  await project.locator('summary[aria-label="Abo-Nutzung"]:visible').click();
  const mobileSpeech = mobileConsumption.getByRole('region', { name: 'Diktatverbrauch', exact: true });
  await mobileSpeech.getByText('Antwort erhalten', { exact: true }).waitFor();
  check('tablet sees its own single dictation attempt through authorized usage query', (await mobileSpeech.innerText()).includes('1 Auftrag/Aufträge'));
  check('tablet speech usage stays within its narrow panel', await mobileSpeech.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
  await project.locator('summary[aria-label="Abo-Nutzung"]:visible').click();
  await project.getByRole('button', { name: 'Prompt / Diktat', exact: true }).click();
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
  await mobileDialog.getByRole('button', { name: 'Terminal geprüft – Entwurf weiterbearbeiten', exact: true }).click();
  await mobileDraft.fill('Live-Verbindung.');
  await mobileDialog.getByRole('button', { name: 'Diktieren', exact: true }).click();
  await mobileDialog.getByRole('button', { name: /Aufnahme stoppen/ }).waitFor();
  await tablet.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('[aria-label="CLI-Promptentwurf"]')?.value.includes('Bitte prüfe'));
  proxy.setApiOffline(true);
  await mobileDialog.getByText(/Zwischenstand wurde als Entwurf gesichert/).waitFor();
  check('tablet connection loss preserves last live preview as an editable draft', (await mobileDraft.inputValue()).startsWith('Live-Verbindung.\nBitte prüfe') && await mobileDraft.getAttribute('readonly') === null);
  proxy.setApiOffline(false);
  await tablet.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await mobileDialog.getByRole('button', { name: 'Diktieren', exact: true }).click();
  await mobileDialog.getByRole('button', { name: /Aufnahme stoppen/ }).waitFor();
  await tablet.keyboard.press('Escape'); await mobileDialog.waitFor({ state: 'hidden' });
  check('closing live tablet dictation returns focus to its current opener or project heading', await project.getByRole('button', { name: 'Prompt / Diktat', exact: true }).evaluate(node =>
    node === document.activeElement || node.closest('dialog')?.querySelector('[data-dialog-heading]') === document.activeElement));
  await project.getByRole('button', { name: 'Prompt / Diktat', exact: true }).click();
  await tablet.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>('button')].some(button => button.textContent === 'Diktieren' && !button.disabled));
  check('tablet can record again after closing an active live stream', !await mobileDialog.getByRole('button', { name: 'Diktieren', exact: true }).isDisabled());
  await mobileDialog.getByRole('button', { name: 'Diktieren', exact: true }).click();
  await mobileDialog.getByRole('button', { name: /Aufnahme stoppen/ }).waitFor();
  await tablet.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('[aria-label="CLI-Promptentwurf"]')?.value.includes('Bitte prüfe'));
  await mobileDialog.getByRole('button', { name: /Aufnahme stoppen/ }).click();
  await mobileDialog.getByText('Transkript eingefügt. Bitte prüfen, dann gezielt übergeben.', { exact: true }).waitFor();
  check('final positive live recording succeeds after disconnect and cancellation', readFileSync(join(root, 'provider.jsonl'), 'utf8').trim().split('\n').length === 3);
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
