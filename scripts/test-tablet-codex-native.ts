/** Opt-in paid native acceptance: actual Electron, signed tablet UI, production
 * queue/workspace launcher and installed Codex. Only local Tailscale discovery
 * is simulated; no Codex process, model response or task result is replaced. */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { _electron as electron, chromium, type Browser, type ElectronApplication, type Page } from 'playwright';
import { expect } from 'playwright/test';
import { buildIdentity } from '../build/identity';
import type { CoordinatorActionSummary } from '../src/shared/coordinatorActions';
import { redactedErrorDetail } from '../src/main/errors';
import { mobileTlsProxy } from './helpers/mobileBrowser';

if (!process.argv.includes('--run-native')) throw new Error('Native Modellprobe nur ausdrücklich mit --run-native ausführen.');
if (process.platform !== 'win32') throw new Error('This acceptance measures native Windows only.');
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-tablet-codex-native-')));
const evidence = resolve('test-results/tablet-codex-native'); mkdirSync(evidence, { recursive: true });
const checks: Array<{ name: string; passed: boolean }> = [];
const sourceId = buildIdentity().sourceId;
let app: ElectronApplication | undefined; let browser: Browser | undefined; let tablet: Page | undefined;
let proxy: Awaited<ReturnType<typeof mobileTlsProxy>> | undefined;
let failed = 0; let conversationId = ''; let taskId = ''; let runId = '';
const check = (name: string, ok: boolean) => {
  checks.push({ name, passed: ok }); if (!ok) throw new Error(name); console.log(`  ok  ${name}`);
};
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { windowsHide: true, encoding: 'utf8', timeout: 15_000 }).trim();

async function main() {
  check('production build matches the source under test', readFileSync(resolve('out/main/index.js'), 'utf8').includes(sourceId));
  const version = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '& codex --version'], { windowsHide: true, encoding: 'utf8', timeout: 15_000 }).trim();
  check('installed native Codex has the accepted protocol version', version === 'codex-cli 0.154.0');
  const repository = join(root, 'project'); mkdirSync(repository);
  const guidance = '# Native tablet acceptance\nWork only in this leased workspace. ADE owns Git metadata: do not add, commit, reset, checkout, rebase, merge or push. Read these instructions, ask the requested question through request_user_input and wait for its answer. Then write only tablet-result.txt with exactly the answer. Do not delegate or start other agents.\n';
  writeFileSync(join(repository, 'AGENTS.md'), guidance);
  git(repository, 'init', '--initial-branch=main'); git(repository, 'add', 'AGENTS.md');
  git(repository, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Native tablet acceptance');
  const originalHead = git(repository, 'rev-parse', 'HEAD');
  const reservation = createServer(); await new Promise<void>(done => reservation.listen(0, '127.0.0.1', done));
  const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const port = address.port; await new Promise<void>(done => reservation.close(() => done()));
  const launcher = join(root, 'launch.cjs');
  writeFileSync(launcher, `const cp=require('node:child_process'); const original=cp.execFile;
cp.execFile=function(file,args,options,callback){
 if(!/tailscale(?:\\.exe)?$/i.test(file))return original.call(this,file,args,options,callback);
 const config={TCP:{'443':{HTTPS:true}},Web:{'ade-mobile.fixture.ts.net:443':{Handlers:{'/':{Proxy:'http://127.0.0.1:${port}'}}}}};
 queueMicrotask(()=>callback(null,JSON.stringify(args[0]==='status'?{BackendState:'Running',Self:{DNSName:'ade-mobile.fixture.ts.net.',Online:true}}:config)));return {};};
cp.execFile[require('node:util').promisify.custom]=(file,args,options)=>new Promise((done,fail)=>cp.execFile(file,args,options,(error,stdout,stderr)=>error?fail(error):done({stdout,stderr})));
require(${JSON.stringify(resolve('out/main/index.js'))});`);
  const launch = async () => {
    app = await electron.launch({ args: [launcher], cwd: resolve('.'), timeout: 30_000,
      env: { ...process.env, ADE_USER_DATA_DIR: join(root, 'profile'), ADE_HOST_API_ENABLED: '0', ADE_MOBILE_PORT: String(port), NODE_ENV: 'test' } });
    const page = await app.firstWindow(); page.setDefaultTimeout(30_000); await page.waitForFunction(() => !!window.ade); return page;
  };
  let desktop = await launch();
  const setup = await desktop.evaluate(async path => {
    const category = await window.ade.invoke('category:create', { name: 'Native tablet test' });
    const repository = await window.ade.invoke('repository:import', { path, name: 'Native tablet test', executionBackend: 'native' });
    const agent = await window.ade.invoke('agent:create', { categoryId: category.id, name: 'Native test Codex', runtime: 'codex',
      permissionMode: 'bypass', codexModel: 'gpt-5.6-sol', codexReasoningEffort: 'high' });
    const view = await window.ade.invoke('supervision:get');
    await window.ade.invoke('supervision:command', { operation: 'project', repositoryId: repository.id, mode: 'coordinate', objective: 'Native tablet acceptance', commandId: crypto.randomUUID(), revision: view.revision });
    await window.ade.invoke('mobileAccess:setEnabled', { enabled: true });
    return { agentId: agent.id, repositoryId: repository.id, projectId: (await window.ade.invoke('supervision:get')).projects[0].id,
      pairing: await window.ade.invoke('mobileAccess:pair') };
  }, repository);
  proxy = await mobileTlsProxy(); proxy.target(port); proxy.rewriteOrigin('https://ade-mobile.fixture.ts.net');
  browser = await chromium.launch({ args: ['--ignore-certificate-errors', '--host-resolver-rules=MAP ade-mobile.fixture.ts.net 127.0.0.1'] });
  tablet = await browser.newPage({ viewport: { width: 800, height: 1000 }, hasTouch: true, ignoreHTTPSErrors: true }); tablet.setDefaultTimeout(30_000);
  await tablet.goto(`${proxy.origin}/#pair=${setup.pairing.code}`);
  await tablet.getByLabel('Gerätename', { exact: true }).fill('Native acceptance tablet');
  await tablet.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click();
  const connected = () => tablet!.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor(); await connected();
  const deviceId = (await desktop.evaluate(() => window.ade.invoke('remoteDevices:list'))).devices.find(d => d.name === 'Native acceptance tablet')!.id;
  await desktop.evaluate(deviceId => window.ade.invoke('remoteDevices:setAdminScopes', { deviceId, scopes: ['workspace:read'], resourceAccess: { mode: 'all' } }), deviceId);
  const open = async () => {
    await tablet!.locator('#mobile-supervision').click(); await tablet!.locator('#mobile-conversation-open').click();
    return tablet!.getByRole('dialog', { name: 'ADE-Gespräch', exact: true });
  };
  let dialog = await open(); await dialog.getByLabel('Gesprächsprofil', { exact: true }).selectOption(setup.agentId);
  await dialog.getByRole('button', { name: 'Neues ADE-Gespräch', exact: true }).click();
  await expect(dialog.getByLabel('Nachricht an ADE', { exact: true })).toBeEditable();
  conversationId = await dialog.getByLabel('Gespräch auswählen', { exact: true }).inputValue();
  const prompt = `Prepare exactly one Codex project task for project ${setup.projectId}, profile ${setup.agentId}, using ade_prepare_task. Use this task prompt: "Read AGENTS.md. This is an authorized isolated native acceptance test. Ask exactly one request_user_input question with id result_text asking in German what text tablet-result.txt should contain, with no options. Wait for the answer. Then create tablet-result.txt containing exactly the supplied answer, no other files or Git changes. Reply with ADE_NATIVE_TABLET_DONE followed by the answer." Do not start work; I will confirm in ADE. Emit tool results via the wrapper's text helper.`;
  await dialog.getByLabel('Nachricht an ADE', { exact: true }).fill(prompt); await dialog.getByRole('button', { name: 'An ADE senden', exact: true }).click();
  const actions = async () => await desktop.evaluate(id => window.ade.invoke('conversation:actionsQuery', { operation: 'list', conversationId: id }), conversationId) as CoordinatorActionSummary[];
  await expect.poll(async () => {
    const turn = (await desktop.evaluate(id => window.ade.invoke('conversation:detail', { conversationId: id }), conversationId)).turns.at(-1);
    if (turn?.status === 'uncertain' || turn?.status === 'interrupted') throw new Error(turn.error || turn.status);
    return (await actions()).filter(action => action.kind === 'task').length;
  }, { timeout: 180_000 }).toBe(1);
  let card = dialog.getByRole('article', { name: 'Projektauftrag · Native tablet test', exact: true }); await card.waitFor();
  const editableAnswer = async () => {
    await card.locator('.run-question').waitFor();
    const field = card.getByLabel('Deine Antwort', { exact: true });
    // Native request_user_input can supply choices plus a free-text alternative.
    if (!await field.count() && await card.getByLabel('Eigene Antwort', { exact: true }).count()) await card.getByLabel('Eigene Antwort', { exact: true }).check();
    await field.waitFor(); return field;
  };
  const detail = await desktop.evaluate(id => window.ade.invoke('conversation:detail', { conversationId: id }), conversationId);
  check('native coordinator reports the pinned model and reasoning', detail.model === 'gpt-5.6-sol' && detail.reasoningEffort === 'high');
  check('native proposal starts no task until the tablet confirms it', !(await desktop.evaluate(() => window.ade.invoke('config:get'))).runTasks.length && !existsSync(join(repository, 'tablet-result.txt')));
  const actionId = (await actions())[0].id;
  proxy.loseConversationActionReplies(true);
  await card.getByRole('button', { name: 'Auftrag starten', exact: true }).click();
  await expect.poll(async () => (await desktop.evaluate(() => window.ade.invoke('config:get'))).runTasks.length, { timeout: 60_000 }).toBe(1);
  await tablet.reload(); proxy.loseConversationActionReplies(false); await connected(); dialog = await open();
  card = dialog.getByRole('article', { name: 'Projektauftrag · Native tablet test', exact: true });
  await card.getByText(/In ADE erfasst/).waitFor();
  const admitted = await desktop.evaluate(() => window.ade.invoke('config:get')); const child = admitted.runTasks[0];
  taskId = child.id; runId = child.runId;
  check('lost confirmation and browser reload preserve exactly one production task and parent', admitted.runs.length === 1 && (await actions())[0].taskId === taskId
    && !(await card.getByRole('button', { name: 'Auftrag starten', exact: true }).count()));
  await expect.poll(async () => {
    const task = (await desktop.evaluate(() => window.ade.invoke('config:get'))).runTasks[0];
    if (['failed', 'cancelled'].includes(task.status)) throw new Error(task.error || task.status);
    return task.questions?.filter(q => q.status === 'pending').length ?? 0;
  }, { timeout: 180_000 }).toBe(1);
  writeFileSync(join(evidence, 'native-question.json'), JSON.stringify((await desktop.evaluate(() => window.ade.invoke('config:get'))).runTasks[0].questions, null, 2));
  await card.getByRole('button', { name: 'Ergebnis und Rückfragen öffnen', exact: true }).click();
  await editableAnswer();
  const beforeAnswer = await desktop.evaluate(() => window.ade.invoke('config:get')); const questionId = beforeAnswer.runTasks[0].questions![0].id;
  const workspace = beforeAnswer.workspaceBindings.find(binding => binding.id === beforeAnswer.runTasks[0].workspaceBindingId)!;
  check('production launcher allocates a separate checkout for the task', !!workspace && workspace.workspaceDir !== repository);
  check('task launch preserves repository-owned guidance', readFileSync(join(workspace.workspaceDir, 'AGENTS.md'), 'utf8').replace(/\r\n/g, '\n') === guidance);
  check('native worker waits for the answer before writing the result', !existsSync(join(workspace.workspaceDir, 'tablet-result.txt')));
  await tablet.context().setOffline(true);
  await tablet.getByRole('status').filter({ hasText: /^Offline$/ }).waitFor();
  await tablet.context().setOffline(false); await tablet.reload(); await connected(); dialog = await open();
  card = dialog.getByRole('article', { name: 'Projektauftrag · Native tablet test', exact: true });
  await card.getByRole('button', { name: 'Ergebnis und Rückfragen öffnen', exact: true }).click();
  await editableAnswer();
  const recovered = await desktop.evaluate(() => window.ade.invoke('config:get'));
  check('connection loss preserves the same pending native question without another task', recovered.runTasks.length === 1 && recovered.runTasks[0].questions![0].id === questionId
    && recovered.runTasks[0].questions![0].status === 'pending');
  const answer = `TABLET_${randomUUID().replaceAll('-', '')}`;
  await (await editableAnswer()).fill(answer); await card.getByRole('button', { name: 'Antwort senden', exact: true }).click();
  await expect.poll(async () => {
    const task = (await desktop.evaluate(() => window.ade.invoke('config:get'))).runTasks[0];
    if (['failed', 'cancelled'].includes(task.status)) throw new Error(task.error || task.status); return task.status;
  }, { timeout: 180_000 }).toBe('completed');
  // Answer completion may collapse the details; reopen through its actual control.
  const details = card.getByRole('button', { name: 'Ergebnis und Rückfragen öffnen', exact: true }); if (await details.isVisible()) await details.click();
  await card.getByText(new RegExp(answer)).first().waitFor();
  const completed = await desktop.evaluate(() => window.ade.invoke('config:get'));
  check('tablet answer reaches the native worker and its exact file result', completed.runTasks[0].questions![0].status === 'answered'
    && readFileSync(join(workspace.workspaceDir, 'tablet-result.txt'), 'utf8').trim() === answer && !!completed.runTasks[0].output?.text.includes(answer));
  check('native work leaves source checkout and Git metadata unchanged', git(repository, 'rev-parse', 'HEAD') === originalHead && git(repository, 'status', '--porcelain') === ''
    && git(workspace.workspaceDir, 'rev-parse', 'HEAD') === originalHead && git(workspace.workspaceDir, 'status', '--porcelain') === '?? tablet-result.txt');
  const project = (await desktop.evaluate(() => window.ade.invoke('supervision:get'))).projects[0];
  check('graph links the completed run to the actual parent action and project', project.id === setup.projectId && project.links.some(link => link.id === actionId && link.target.id === runId));
  await tablet.setViewportSize({ width: 390, height: 844 });
  check('native result and answer controls fit the phone viewport', await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
  await dialog.screenshot({ path: join(evidence, 'completed-phone.png') });
  const oldPid = app!.process().pid; await app!.close(); app = undefined;
  desktop = await launch(); check('real Electron restart uses a new host process', app!.process().pid !== oldPid);
  await tablet.reload(); await connected(); dialog = await open();
  await dialog.getByLabel('Gespräch auswählen', { exact: true }).selectOption(conversationId);
  card = dialog.getByRole('article', { name: 'Projektauftrag · Native tablet test', exact: true });
  await card.getByRole('button', { name: 'Ergebnis und Rückfragen öffnen', exact: true }).click(); await card.getByText(new RegExp(answer)).first().waitFor();
  const afterRestart = await desktop.evaluate(() => window.ade.invoke('config:get'));
  check('host restart retains the same completed task and full answer without another launch', afterRestart.runTasks.length === 1 && afterRestart.runTasks[0].id === taskId
    && afterRestart.runTasks[0].status === 'completed' && afterRestart.runTasks[0].output?.text === completed.runTasks[0].output?.text);
  check('host restart preserves the original paired device', (await desktop.evaluate(() => window.ade.invoke('remoteDevices:list'))).devices.filter(device => device.revokedAt === null).map(device => device.id).join() === deviceId);
  await dialog.screenshot({ path: join(evidence, 'restarted-phone.png') });
}

void main().catch(async error => {
  failed++; console.error(redactedErrorDetail(error));
  if (tablet) {
    writeFileSync(join(evidence, 'failure-ui.txt'), await tablet.locator('.conversation-panel').innerText().catch(() => 'Panel unavailable'));
    await tablet.getByRole('dialog', { name: 'ADE-Gespräch', exact: true }).evaluate(node => { node.scrollTop = node.scrollHeight; }).catch(() => undefined);
  }
  await tablet?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => undefined);
}).finally(async () => {
  await browser?.close(); await proxy?.close(); await app?.close().catch(() => undefined);
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ at: new Date().toISOString(), platform: process.platform, sourceId,
    model: 'gpt-5.6-sol', reasoning: 'high', protocol: 'installed Codex 0.154.0', launcher: 'production Electron queue and leased workspace',
    physicalTablet: false, conversationId, taskId, runId, checks, passed: checks.filter(item => item.passed).length, failed }, null, 2));
  if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected acceptance root');
  await rm(root, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
  console.log(`Tablet Codex native: ${checks.filter(item => item.passed).length} passed, ${failed} failed`); if (failed) process.exitCode = 1;
});
