import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, webkit, type Browser, type Page } from 'playwright';
import { BrowserSessions } from '../src/main/remote/BrowserSessions';
import { HostApiServer } from '../src/main/remote/HostApiServer';
import { RemoteAuthorizer } from '../src/main/remote/authorization';
import { loadMobileAssets } from '../src/main/remote/mobileAssets';
import { createMobileFixture } from './helpers/mobileFixture';
import { mobileTlsProxy } from './helpers/mobileBrowser';

let passed = 0; let failed = 0;
const check = (label: string, condition: boolean): void => { if (condition) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
const root = mkdtempSync(join(tmpdir(), 'ade-mobile-browser-'));
const evidence = resolve('test-results/mobile'); mkdirSync(evidence, { recursive: true });
const fixture = createMobileFixture(root);
let browser: Browser | undefined; let page: Page | undefined;
let server: HostApiServer | undefined; let sessions: BrowserSessions | undefined;
let proxy: Awaited<ReturnType<typeof mobileTlsProxy>> | undefined;
const useWebkit = process.argv.includes('--webkit');
const windowsWebkit = useWebkit && process.platform === 'win32';

void (async () => {
  proxy = await mobileTlsProxy();
  const browserOrigin = useWebkit ? proxy.localOrigin : proxy.origin;
  if (useWebkit) proxy.rewriteOrigin(proxy.origin);
  const start = async (): Promise<void> => {
    sessions = new BrowserSessions(fixture.devices);
    server = new HostApiServer(fixture.application, { port: 0, requireDeviceReads: true, heartbeatMs: 200,
      authorizer: new RemoteAuthorizer('b'.repeat(32), [], undefined, fixture.devices),
      browser: { origin: proxy!.origin, sessions, assets: loadMobileAssets(resolve('out/mobile')) }, audit: (entry) => fixture.devices.audit(entry) });
    proxy!.target((await server.start()).port);
  };
  await start();
  browser = useWebkit ? await webkit.launch() : await chromium.launch({ args: ['--ignore-certificate-errors', '--host-resolver-rules=MAP ade-mobile.fixture.ts.net 127.0.0.1'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
  page = await context.newPage(); page.setDefaultTimeout(20_000);
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(browserOrigin);
  await page.getByRole('heading', { name: 'Gerät koppeln', exact: true }).waitFor();
  check('unpaired phone sees useful pairing instructions without private catalog', !(await page.content()).includes('Mobile project'));
  const challenge = sessions!.beginPairing(proxy.origin);
  await page.goto(challenge.url.replace(proxy.origin, browserOrigin));
  await page.getByLabel('Gerätename', { exact: true }).fill('Test phone');
  check('QR fragment is removed from browser URL', !page.url().includes(challenge.code) && await page.getByLabel('Pairing-Code', { exact: true }).inputValue() === challenge.code);
  await page.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  check('browser pairs and loads real host catalog', (await page.getByLabel('Repository', { exact: true }).textContent())!.includes('Mobile project'));
  check('phone layout has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  check('signing key is non-exportable in IndexedDB', await page.evaluate(async () => new Promise<boolean>((done) => {
    const req = indexedDB.open('ade-mobile-identity', 1); req.onsuccess = () => {
      const get = req.result.transaction('identity').objectStore('identity').get('current');
      get.onsuccess = () => { done(get.result.key.extractable === false && !('secret' in get.result)); req.result.close(); };
    };
  })));
  check('session cookie is invisible to JavaScript', !(await page.evaluate(() => document.cookie)).includes('ade-session'));
  await page.getByLabel('Agent', { exact: true }).selectOption('builder');
  await page.getByLabel('Name (optional)', { exact: true }).fill('Phone task');
  await page.getByLabel('Aufgabe', { exact: true }).fill('Complete the deterministic mobile fixture task.');
  proxy.loseTaskReplies(true);
  await page.getByRole('button', { name: 'Aufgabe starten', exact: true }).click();
  await page.getByRole('heading', { name: 'Antwort noch unklar' }).waitFor();
  proxy.loseTaskReplies(false);
  await page.getByRole('button', { name: 'Diesen Auftrag erneut prüfen' }).click();
  await page.getByText('Bereits bestätigter Auftrag wiederhergestellt.', { exact: true }).waitFor();
  check('lost task reply retries with the same key and one launch', fixture.launched.length === 1 && fixture.orchestration.snapshot().runs.length === 1);
  check('confirmed run detail receives focus', await page.locator('#run-detail-title').evaluate((node) => node === document.activeElement));
  await page.screenshot({ path: join(evidence, 'phone-task.png'), fullPage: true });
  await page.reload(); await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  check('reload restores remembered device without another pairing', fixture.devices.inventory().devices.length === 1 && await page.getByRole('button', { name: /Phone task/ }).isVisible());
  const cookies = await context.cookies();
  // Upstream explicitly expects native Windows WebKit's SameSite introspection to fail:
  // github.com/microsoft/playwright/blob/main/tests/library/browsercontext-cookies.spec.ts
  check(windowsWebkit ? 'WebKit stores a Secure HttpOnly session (SameSite inspection unavailable on Windows)' : 'real browser stores a Secure HttpOnly Strict session',
    cookies.some((cookie) => cookie.name === '__Host-ade-session' && cookie.secure && cookie.httpOnly && (windowsWebkit || cookie.sameSite === 'Strict')));
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (key) => (await (await caches.open(key)).keys()).map((request) => request.url)))).flat());
  check('service worker caches only public shell assets', cached.length >= 4 && cached.every((url) => !url.includes('/api/') && !url.includes('#pair=')));
  await context.setOffline(true);
  await page.getByRole('status').filter({ hasText: /^Offline$/ }).waitFor();
  check('offline state disables task submission', await page.getByRole('button', { name: 'Aufgabe starten', exact: true }).isDisabled());
  if (!windowsWebkit) {
    await page.reload(); await page.getByRole('heading', { name: 'Dein Workspace. Überall.' }).waitFor();
    check('cached app shell starts offline without caching private runs', !(await page.content()).includes('Phone task'));
  } else {
    console.log('UNMEASURED: native Windows WebKit offline navigation fails internally; offline cold start remains a Safari/device acceptance gate.');
  }
  await context.setOffline(false); await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  check('network return restores authoritative runs', await page.getByRole('button', { name: /Phone task/ }).isVisible());
  sessions!.dispose(); await server!.stop(); await start();
  await page.getByRole('button', { name: 'Erneut verbinden', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  check('host restart renews session using persisted device proof', fixture.devices.inventory().devices.length === 1);
  await page.getByRole('button', { name: /Phone task/ }).click();
  await page.getByLabel('Aufgabe', { exact: true }).fill('Preserve this unsent draft while cancelling a different run.');
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await page.getByRole('button', { name: 'Run abbrechen', exact: true }).click();
  await page.locator('.run-detail').getByText(/cancelled/).first().waitFor();
  check('phone can cancel accepted work through the real coordinator', fixture.orchestration.snapshot().runs[0]?.status === 'cancelled');
  check('cancellation preserves unrelated form input and restores focus', (await page.getByLabel('Aufgabe', { exact: true }).inputValue()).startsWith('Preserve this')
    && await page.locator('#run-detail-title').evaluate((node) => node === document.activeElement));

  await page.setViewportSize({ width: 820, height: 1180 });
  await page.getByLabel('Managed Run', { exact: true }).check();
  await page.getByLabel('Builder', { exact: true }).uncheck();
  await page.getByLabel('Coordinator', { exact: true }).check();
  await page.getByLabel('Builder', { exact: true }).check();
  await page.getByLabel('Run-Name', { exact: true }).fill('Tablet managed run');
  await page.getByLabel('Ziel', { exact: true }).fill('Coordinate a bounded fixture run.');
  await page.getByRole('button', { name: 'Run vorbereiten', exact: true }).click();
  await page.getByRole('heading', { name: 'Tablet managed run', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Run starten', exact: true }).click();
  await page.locator('.run-detail').getByText(/running/).first().waitFor();
  check('tablet creates and starts a managed run with explicit agents and budget', fixture.orchestration.snapshot().runs.some((run) => run.name === 'Tablet managed run' && run.mode === 'managed' && run.budget.maxTaskMinutes === 30));
  check('tablet layout has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(evidence, 'tablet-managed-run.png'), fullPage: true });
  await page.getByRole('button', { name: 'Erneut verbinden', exact: true }).focus();
  await page.keyboard.press('Tab');
  check('keyboard navigation reaches an actionable form control', await page.evaluate(() => ['INPUT', 'BUTTON', 'SELECT'].includes(document.activeElement?.tagName ?? '')));

  await page.getByLabel('Einzelaufgabe', { exact: true }).check();
  await page.getByLabel('Agent', { exact: true }).selectOption('reviewer');
  await page.getByLabel('Aufgabe', { exact: true }).fill('An uncertain request must never cross a revoked device identity.');
  proxy.loseTaskReplies(true);
  await page.getByRole('button', { name: 'Aufgabe starten', exact: true }).click();
  await page.getByRole('heading', { name: 'Antwort noch unklar' }).waitFor();
  proxy.loseTaskReplies(false);
  fixture.devices.revoke(fixture.devices.inventory().devices.find((device) => device.revokedAt === null)!.id);
  await page.getByRole('heading', { name: 'Gerät koppeln', exact: true }).waitFor();
  check('live revocation clears private mobile state and requests re-pairing', !(await page.content()).includes('Mobile project') && (await page.getByRole('alert').textContent())!.includes('widerrufen'));
  const positive = sessions!.beginPairing(proxy.origin);
  await page.getByLabel('Pairing-Code', { exact: true }).fill(positive.code);
  await page.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  check('final positive control re-pairs and reconnects after revocation', fixture.devices.activeDevices().length === 1);
  check('a new identity cannot replay an old uncertain command', !(await page.getByRole('heading', { name: 'Antwort noch unklar' }).count())
    && await page.getByLabel('Aufgabe', { exact: true }).inputValue() === '');
  check('mobile workflow has no uncaught page errors', errors.length === 0);
  await context.close();
})().catch(async (error) => { failed++; console.error(error); await page?.screenshot({ path: join(evidence, 'browser-failure.png'), fullPage: true }).catch(() => undefined); })
  .finally(async () => {
    await browser?.close(); sessions?.dispose(); await server?.stop(); await proxy?.close();
    if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('unexpected fixture root');
    rmSync(root, { recursive: true, force: true });
    console.log(`\nMobile browser (${useWebkit ? 'WebKit' : 'Chromium'}): ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
  });
