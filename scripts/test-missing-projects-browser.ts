/** Tablet: a folder deleted on the PC disappears on return, is removable after confirmation, and a rejected project start can be retried. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium, type Browser, type Request } from 'playwright';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { mobileTlsProxy } from './helpers/mobileBrowser';
import { mobileAssetsDir } from './helpers/buildOutput';
import { BrowserSessions } from '../src/main/remote/BrowserSessions';
import { HostApiServer } from '../src/main/remote/HostApiServer';
import { RemoteAuthorizer } from '../src/main/remote/authorization';
import { loadMobileAssets } from '../src/main/remote/mobileAssets';
import { ProjectDefaultsService } from '../src/main/settings/ProjectDefaultsService';

let passed = 0; let failed = 0;
const check = (name: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } };
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-missing-browser-')));
const evidence = resolve('test-results/remote'); mkdirSync(evidence, { recursive: true });
let browser: Browser | undefined; let server: HostApiServer | undefined; let proxy: Awaited<ReturnType<typeof mobileTlsProxy>> | undefined;
void (async () => {
  const f = createRemoteWorkspaceFixture(root); const { store, projects, devices } = f;
  const parent = join(root, 'projects'); mkdirSync(parent);
  const init = (name: string) => { const path = join(parent, name); mkdirSync(path); execFileSync('git', ['init', '-q', '--initial-branch=main', path], { windowsHide: true, timeout: 10000 }); return path; };
  init('Keep'); const gone = init('Gone');
  const defaults = new ProjectDefaultsService(store); defaults.save({ rootPath: parent, agentId: null });
  for (const name of ['Keep', 'Gone']) await projects.open((await projects.directory()).entries.find((item) => item.name === name)!.id);
  const goneId = store.get().repositories.find((item) => item.name === 'Gone')!.id;

  proxy = await mobileTlsProxy(); const sessions = new BrowserSessions(devices);
  server = new HostApiServer(f.application, { port: 0, heartbeatMs: 200, requireDeviceReads: true,
    authorizer: new RemoteAuthorizer('t'.repeat(32), [], undefined, devices), browser: { origin: proxy.origin, sessions, assets: loadMobileAssets(mobileAssetsDir(process.env.ADE_MOBILE_ASSETS)) }, audit: (entry) => devices.audit(entry) });
  proxy.target((await server.start()).port);
  browser = await chromium.launch({ args: ['--ignore-certificate-errors', '--host-resolver-rules=MAP ade-mobile.fixture.ts.net 127.0.0.1'] });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true, ignoreHTTPSErrors: true }); page.setDefaultTimeout(30_000);
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(sessions.beginPairing(proxy.origin).url); await page.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor(); const device = devices.activeDevices()[0]!;
  devices.setAdminScopes(device.id, ['workspace:read', 'projects:write', 'catalog:write']);
  await page.getByRole('tab', { name: 'Projekte', exact: true }).click();
  await page.getByRole('button', { name: 'Alle', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace öffnen: Gone', exact: true }).waitFor();
  check('both projects are listed while their folders exist', await page.getByRole('heading', { name: /nicht mehr gefunden/ }).count() === 0);

  // Deleted on the PC; no event reaches the tablet. Returning to the tab re-checks (at most every 5 s).
  rmSync(gone, { recursive: true });
  await page.waitForTimeout(5_200); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const heading = page.getByRole('heading', { name: '1 Projekt nicht mehr gefunden', exact: true });
  await heading.waitFor();
  check('returning to the tab hides the deleted project from the list', await page.getByRole('button', { name: 'Workspace öffnen: Gone', exact: true }).count() === 0
    && await page.getByRole('button', { name: 'Workspace öffnen: Keep', exact: true }).count() === 1);
  check('hiding keeps the registration on the PC', store.get().repositories.some((item) => item.id === goneId));
  const remove = page.getByRole('button', { name: 'Aus ADE entfernen: Gone', exact: true });
  await remove.focus(); await page.keyboard.press('Enter');
  const confirmation = page.getByRole('group', { name: 'Entfernen bestätigen: Gone', exact: true });
  await confirmation.waitFor();
  check('the keyboard opens the confirmation and focuses its confirm button', await confirmation.getByRole('button', { name: 'Registrierung entfernen', exact: true }).evaluate((node) => node === document.activeElement));
  await page.screenshot({ path: join(evidence, 'missing-project-confirm.png') });
  await page.keyboard.press('Escape');
  await remove.waitFor();
  check('Escape cancels without removing and returns focus to the remove button', await remove.evaluate((node) => node === document.activeElement)
    && store.get().repositories.some((item) => item.id === goneId));
  await page.keyboard.press('Enter'); await confirmation.getByRole('button', { name: 'Registrierung entfernen', exact: true }).click();
  await page.getByText('Gone wurde aus ADE entfernt. Der Run-Verlauf bleibt.', { exact: true }).waitFor();
  await heading.waitFor({ state: 'detached' });
  check('confirmed removal deregisters only the missing project', !store.get().repositories.some((item) => item.id === goneId)
    && store.get().repositories.some((item) => item.name === 'Keep'));
  await page.waitForFunction(() => document.activeElement?.textContent === 'Projektordner aktualisieren');
  check('focus moves to the stable refresh button when the section disappears', true);

  // Project start: break the root so project-create is rejected, then fix it on the PC.
  renameSync(parent, parent + '.old'); mkdirSync(parent);
  const keys: string[] = [];
  const record = (request: Request) => { if (request.url().endsWith('/api/v1/admin/commands') && request.postData()?.includes('project-create')) keys.push(request.headers()['idempotency-key'] ?? ''); };
  page.on('request', record);
  await page.getByRole('button', { name: 'Neues Projekt', exact: true }).click();
  const starter = page.getByRole('dialog', { name: 'Neues Projekt', exact: true });
  await starter.getByLabel('Projektname (optional)', { exact: true }).fill('Autokauf');
  await starter.getByRole('button', { name: 'Projekt anlegen und öffnen', exact: true }).click();
  await starter.getByRole('alert').waitFor();
  const retry = starter.getByRole('button', { name: 'Erneut versuchen', exact: true });
  await retry.waitFor();
  check('a definite rejection explains the step and offers a new attempt', (await starter.innerText()).includes('legt das Projekt nicht doppelt an'));
  defaults.save({ rootPath: parent, agentId: null });
  await starter.getByRole('button', { name: 'Start fortsetzen', exact: true }).click();
  await retry.waitFor();
  check('continuing with the old key only replays the stored rejection', keys.length === 2 && keys[0] === keys[1] && !store.get().repositories.some((item) => item.name === 'Autokauf'));
  proxy.loseAdminReplies(true);
  await retry.click();
  await starter.getByRole('alert').waitFor(); proxy.loseAdminReplies(false);
  check('the new attempt uses a new key and creates the project once', keys.length === 3 && keys[2] !== keys[0] && store.get().repositories.filter((item) => item.name === 'Autokauf').length === 1);
  check('an uncertain outcome offers no further new key', await retry.count() === 0);
  await starter.getByRole('button', { name: 'Start fortsetzen', exact: true }).click();
  await page.getByRole('dialog', { name: 'Projekt · Autokauf', exact: true }).waitFor();
  page.off('request', record);
  check('continuing after the lost reply replays the same key and opens the project', keys.length === 4 && keys[3] === keys[2]
    && store.get().repositories.filter((item) => item.name === 'Autokauf').length === 1);
  check('no uncaught page errors', errors.length === 0);
  rmSync(parent + '.old', { recursive: true, force: true });
})().catch((error) => { failed++; console.error(error); })
  .finally(async () => {
    await browser?.close(); await server?.stop(); await proxy?.close();
    if (dirname(root) !== realpathSync.native(resolve(tmpdir()))) throw new Error('Unexpected fixture directory');
    rmSync(root, { recursive: true, force: true });
    console.log(`Missing projects browser: ${passed} passed, ${failed} failed`);
    if (failed) process.exitCode = 1;
  });
