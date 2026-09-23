/**
 * Visual review helper (not part of the suites): draws one stroke per brush on
 * a fresh note in the tablet build and saves test-results/organizer/sheet-brushes.png.
 * Run with ADE_ORGANIZER_ASSETS pointing at a mobile build, e.g. the isolated one.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { mobileTlsProxy } from './helpers/mobileBrowser';
import { BrowserSessions } from '../src/main/remote/BrowserSessions';
import { HostApiServer } from '../src/main/remote/HostApiServer';
import { RemoteAuthorizer } from '../src/main/remote/authorization';
import { loadMobileAssets } from '../src/main/remote/mobileAssets';

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-brush-preview-')));
const evidence = resolve('test-results/organizer'); mkdirSync(evidence, { recursive: true });
const fixture = createRemoteWorkspaceFixture(root);
let browser: Browser | undefined; let page: Page | undefined; let server: HostApiServer | undefined;
let proxy: Awaited<ReturnType<typeof mobileTlsProxy>> | undefined;
void (async () => {
  const repository = join(root, 'project'); mkdirSync(repository); execFileSync('git', ['init', repository], { stdio: 'ignore' });
  writeFileSync(join(repository, 'README.md'), '# Brush preview'); execFileSync('git', ['-C', repository, 'add', '.']);
  execFileSync('git', ['-C', repository, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture'], { stdio: 'ignore' });
  fixture.store.save({ repositories: [{ id: 'repo', name: 'Brush project', rootPath: repository, commonGitDir: join(repository, '.git'), executionBackend: 'native', verified: true, createdAt: Date.now() }] });
  proxy = await mobileTlsProxy(); const sessions = new BrowserSessions(fixture.devices);
  server = new HostApiServer(fixture.application, { port: 0, heartbeatMs: 200, requireDeviceReads: true,
    authorizer: new RemoteAuthorizer('t'.repeat(32), [], undefined, fixture.devices),
    browser: { origin: proxy.origin, sessions, assets: loadMobileAssets(resolve(process.env.ADE_ORGANIZER_ASSETS ?? 'out/mobile')) }, audit: entry => fixture.devices.audit(entry) });
  proxy.target((await server.start()).port);
  browser = await chromium.launch({ args: ['--ignore-certificate-errors', '--host-resolver-rules=MAP ade-mobile.fixture.ts.net 127.0.0.1'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, hasTouch: true, ignoreHTTPSErrors: true });
  page = await context.newPage(); page.setDefaultTimeout(20_000);
  await page.goto(sessions.beginPairing(proxy.origin).url);
  await page.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  const device = fixture.devices.activeDevices()[0]!.id;
  fixture.devices.setAdminScopes(device, ['organizer:read', 'organizer:write'], { mode: 'all' }); await page.reload();
  await page.getByRole('tab', { name: 'Notizen', exact: true }).click();
  await page.getByRole('button', { name: 'Neue Notiz', exact: true }).click();
  await page.getByLabel('Titel', { exact: true }).fill('Stiftarten');
  await page.getByRole('button', { name: 'Zeichnen', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Skizze', exact: true }); await sheet.waitFor(); await page.waitForTimeout(400);
  const canvas = sheet.locator('canvas'); const box = (await canvas.boundingBox())!;
  const pen = await context.newCDPSession(page);
  const brushes = ['pen', 'pencil', 'ballpoint', 'charcoal', 'calligraphy', 'highlighter'];
  await page.getByLabel('Strichstärke', { exact: true }).fill('8');
  for (const [index, brush] of brushes.entries()) {
    await page.getByLabel('Stiftart', { exact: true }).selectOption(brush);
    const y = box.y + box.height * (0.18 + index * 0.12); const x0 = box.x + box.width * 0.2; const x1 = box.x + box.width * 0.8;
    await pen.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: .3 });
    for (let step = 1; step <= 24; step++) {
      const t = step / 24; const wave = Math.sin(t * Math.PI * 2) * box.height * 0.03;
      await pen.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * t, y: y + wave, button: 'left', buttons: 1, pointerType: 'pen', force: .3 + .6 * Math.sin(t * Math.PI) });
    }
    await pen.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
    await page.waitForTimeout(150);
  }
  // A second highlighter pass across the pen line shows the multiply blend.
  await page.getByLabel('Stiftart', { exact: true }).selectOption('highlighter'); await page.getByLabel('Strichstärke', { exact: true }).fill('24');
  const hy = box.y + box.height * 0.5; const hx0 = box.x + box.width * 0.35; const hx1 = box.x + box.width * 0.45;
  await pen.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hx0, y: box.y + box.height * 0.14, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: .5 });
  await pen.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hx1, y: hy + box.height * 0.3, button: 'left', buttons: 1, pointerType: 'pen', force: .5 });
  await pen.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hx1, y: hy + box.height * 0.3, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(evidence, 'sheet-brushes.png') });
  await pen.detach();
  console.log('brush preview saved', join(evidence, 'sheet-brushes.png'), 'strokes:', fixture.organizer.store.index().entries.length);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); await server?.stop(); await proxy?.close?.();
  if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected temporary root');
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
