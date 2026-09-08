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
  const errors: string[] = []; const endpoints: string[] = []; let streams = 0;
  page.on('pageerror', (error) => { errors.push(error.message); console.error('PAGE ERROR:', error.message); });
  page.on('request', (request) => { const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) endpoints.push(path); if (path === '/api/v1/events') streams++; });
  const connected = () => page!.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  const noOverflow = () => page!.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  const focused = (selector: string) => page!.locator(selector).evaluate((node) => node === document.activeElement);
  const closeInspector = async () => {
    const dialog = page!.getByRole('dialog', { name: 'Run-Details', exact: true });
    if (await dialog.count()) await dialog.getByRole('button', { name: 'Run-Details schliessen', exact: true }).click();
    else if (await page!.getByRole('button', { name: 'Inspector schliessen' }).count()) await page!.getByRole('button', { name: 'Inspector schliessen' }).click();
  };
  await page.goto(browserOrigin);
  await page.getByRole('heading', { name: 'Gerät koppeln', exact: true }).waitFor();
  check('unpaired phone sees useful pairing instructions without private catalog', !(await page.content()).includes('Mobile project'));
  const challenge = sessions!.beginPairing(proxy.origin);
  await page.goto(challenge.url.replace(proxy.origin, browserOrigin));
  await page.getByLabel('Gerätename', { exact: true }).fill('Test phone');
  check('QR fragment is removed from browser URL', !page.url().includes(challenge.code) && await page.getByLabel('Pairing-Code', { exact: true }).inputValue() === challenge.code);
  const firstStream = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/v1/events');
  await page.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click();
  await connected(); await firstStream;
  check('browser pairs and loads real host catalog in desktop-style Overview', await page.getByRole('button', { name: 'Aufgabe in Mobile project', exact: true }).isVisible());
  check('phone layout has no horizontal overflow', await noOverflow());
  check('mobile shares desktop dark tokens and monospace typography', await page.evaluate(() => {
    const style = getComputedStyle(document.body);
    return style.backgroundColor === 'rgb(14, 15, 18)' && style.getPropertyValue('--accent').trim() === '#E09A4A' && style.fontFamily.includes('Cascadia Code');
  }));
  check('missing token telemetry is shown as unknown', (await page.getByLabel('Overview figures').textContent())!.includes('Noch keine Token-Angabe'));
  check('signing key is non-exportable in IndexedDB', await page.evaluate(async () => new Promise<boolean>((done) => {
    const req = indexedDB.open('ade-mobile-identity', 1); req.onsuccess = () => {
      const get = req.result.transaction('identity').objectStore('identity').get('current');
      get.onsuccess = () => { done(get.result.key.extractable === false && !('secret' in get.result)); req.result.close(); };
    };
  })));
  check('session cookie is invisible to JavaScript', !(await page.evaluate(() => document.cookie)).includes('ade-session'));
  const navigationStreams = streams;
  await page.screenshot({ path: join(evidence, 'phone-overview-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  check('light theme matches the desktop paper palette', await page.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgb(243, 239, 231)'));
  await page.screenshot({ path: join(evidence, 'phone-overview-light.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Overview', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  check('mode tabs use roving keyboard focus and select Work', await page.getByRole('tab', { name: 'Work', exact: true }).getAttribute('aria-selected') === 'true' && await focused('#view-tab-work'));
  await page.keyboard.press('End');
  check('Graph has a useful empty canvas and keyboard End support', await page.getByRole('heading', { name: 'Dein Graph ist bereit' }).isVisible());
  await page.keyboard.press('Home');
  await page.getByRole('button', { name: 'Aufgabe in Mobile project', exact: true }).tap();
  check('project selection opens a prefilled task dialog and moves focus', await page.getByLabel('Repository', { exact: true }).inputValue() === 'repo'
    && await page.getByRole('dialog', { name: 'Neue Aufgabe' }).evaluate((node) => node.contains(document.activeElement)));
  await page.keyboard.press('Escape');
  check('closing task dialog restores its project opener', await page.getByRole('button', { name: 'Aufgabe in Mobile project', exact: true }).evaluate((node) => node === document.activeElement));
  await page.getByRole('button', { name: 'Workspace für Builder', exact: true }).click();
  check('projectless workspace requires an explicit project for managed tasks', await page.getByLabel('Workspace-Projekt', { exact: true }).inputValue() === ''
    && await page.getByRole('button', { name: 'Aufgabe vergeben', exact: true }).isDisabled());
  await page.getByLabel('Workspace-Projekt', { exact: true }).selectOption('repo');
  await page.getByRole('button', { name: 'Aufgabe vergeben', exact: true }).click();
  check('agent selection opens the composer with the chosen identity', await page.getByLabel('Agent', { exact: true }).inputValue() === 'builder');
  await page.getByLabel('Name (optional)', { exact: true }).fill('Phone task');
  await page.getByLabel('Aufgabe', { exact: true }).fill('Complete the deterministic mobile fixture task.');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Work', exact: true }).click();
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.getByRole('button', { name: 'Neue Aufgabe', exact: true }).click();
  check('view and theme changes preserve a private in-memory draft', await page.getByLabel('Aufgabe', { exact: true }).inputValue() === 'Complete the deterministic mobile fixture task.');
  check('navigation and appearance changes retain the same event stream and identity', streams === navigationStreams && fixture.devices.inventory().devices.length === 1);
  proxy.loseTaskReplies(true);
  await page.getByRole('button', { name: 'Aufgabe starten', exact: true }).click();
  await page.getByRole('heading', { name: 'Antwort noch unklar' }).waitFor();
  proxy.loseTaskReplies(false);
  await page.getByRole('button', { name: 'Diesen Auftrag erneut prüfen' }).click();
  await page.getByRole('dialog', { name: 'Run-Details', exact: true }).waitFor();
  check('lost task reply retries with the same key and one launch', fixture.launched.length === 1 && fixture.orchestration.snapshot().runs.length === 1);
  check('confirmed run detail receives focus', await focused('#run-detail-title'));
  check('phone inspector is modal and keyboard focus remains inside it', await page.getByRole('dialog', { name: 'Run-Details' }).evaluate((node) => node.matches(':modal')));
  await page.screenshot({ path: join(evidence, 'phone-task.png'), fullPage: true });
  await page.keyboard.press('Escape');
  check('inspector with an unmounted opener restores focus to its active view', await focused('#view-tab-graph'));
  await page.getByRole('tab', { name: 'Work', exact: true }).click();
  await page.reload(); await connected();
  check('reload restores remembered device, theme and view without pairing', fixture.devices.inventory().devices.length === 1
    && await page.getByRole('button', { name: 'Run Phone task', exact: true }).isVisible() && await page.getByRole('tab', { name: 'Work', exact: true }).getAttribute('aria-selected') === 'true'
    && await page.evaluate(() => document.documentElement.dataset.theme === 'dark'));
  const cookies = await context.cookies();
  // Native Windows WebKit's SameSite introspection is an upstream expected failure.
  check(windowsWebkit ? 'WebKit stores a Secure HttpOnly session (SameSite inspection unavailable on Windows)' : 'real browser stores a Secure HttpOnly Strict session',
    cookies.some((cookie) => cookie.name === '__Host-ade-session' && cookie.secure && cookie.httpOnly && (windowsWebkit || cookie.sameSite === 'Strict')));
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (key) => (await (await caches.open(key)).keys()).map((request) => request.url)))).flat());
  check('service worker caches only public shell assets', cached.length >= 4 && cached.every((url) => !url.includes('/api/') && !url.includes('#pair=')));
  await page.getByRole('button', { name: 'Neue Aufgabe', exact: true }).click();
  await page.getByLabel('Aufgabe', { exact: true }).fill('Preserve this offline draft.');
  await context.setOffline(true);
  await page.getByText('Offline. Dein Entwurf bleibt erhalten; zum Senden wieder verbinden.', { exact: true }).waitFor();
  check('offline state disables task submission and keeps the current draft', await page.getByRole('button', { name: 'Aufgabe starten', exact: true }).isDisabled()
    && await page.getByLabel('Aufgabe', { exact: true }).inputValue() === 'Preserve this offline draft.');
  await page.keyboard.press('Escape');
  if (!windowsWebkit) {
    await page.reload(); await page.getByRole('tab', { name: 'Work', exact: true }).waitFor();
    check('cached app shell starts offline without private runs or drafts', !(await page.content()).includes('Phone task') && !(await page.content()).includes('Preserve this offline draft.'));
  } else console.log('UNMEASURED: native Windows WebKit offline navigation fails internally; offline cold start remains a Safari/device acceptance gate.');
  await context.setOffline(false); await connected();
  check('network return restores authoritative runs', await page.getByRole('button', { name: 'Run Phone task', exact: true }).isVisible());
  sessions!.dispose(); await server!.stop(); await start();
  await page.getByRole('button', { name: 'Erneut verbinden', exact: true }).click(); await connected();
  check('host restart renews session using persisted device proof', fixture.devices.inventory().devices.length === 1);
  await page.getByRole('button', { name: 'Neue Aufgabe', exact: true }).click();
  await page.getByLabel('Aufgabe', { exact: true }).fill('Preserve this unsent draft while cancelling a different run.');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Run Phone task', exact: true }).click();
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await page.getByRole('button', { name: 'Run abbrechen', exact: true }).click();
  await page.locator('.run-detail').getByText('cancelled', { exact: true }).first().waitFor();
  check('phone can cancel accepted work through the real coordinator', fixture.orchestration.snapshot().runs[0]?.status === 'cancelled');
  check('cancellation restores focus to the updated detail', await focused('#run-detail-title'));
  await closeInspector();
  await page.getByRole('button', { name: 'Neue Aufgabe', exact: true }).click();
  check('cancellation preserves unrelated composer input', (await page.getByLabel('Aufgabe', { exact: true }).inputValue()).startsWith('Preserve this'));
  await page.keyboard.press('Escape');
  await page.getByLabel('Runs durchsuchen', { exact: true }).fill('does not exist');
  check('work search has a useful empty result', await page.getByRole('heading', { name: 'Keine passenden Runs' }).isVisible());
  await page.getByLabel('Runs durchsuchen', { exact: true }).fill('');
  await page.getByLabel('Status', { exact: true }).selectOption('open');
  check('work status filter excludes finished runs', await page.getByRole('button', { name: 'Run Phone task', exact: true }).count() === 0);
  await page.getByLabel('Status', { exact: true }).selectOption('all');

  await page.setViewportSize({ width: 820, height: 1180 });
  await page.getByRole('button', { name: 'Neuer Run', exact: true }).click();
  if (await page.getByLabel('Builder', { exact: true }).isChecked()) await page.getByLabel('Builder', { exact: true }).uncheck();
  await page.getByLabel('Coordinator', { exact: true }).check();
  await page.getByLabel('Builder', { exact: true }).check();
  await page.getByLabel('Run-Name', { exact: true }).fill('Tablet managed run');
  await page.getByLabel('Ziel', { exact: true }).fill('Coordinate a bounded fixture run.');
  await page.getByRole('button', { name: 'Run vorbereiten', exact: true }).click();
  await page.getByRole('heading', { name: 'Tablet managed run', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Run starten', exact: true }).click();
  await page.locator('.run-detail').getByText('running', { exact: true }).first().waitFor();
  check('tablet creates and starts a managed run with explicit agents and budget', fixture.orchestration.snapshot().runs.some((run) => run.name === 'Tablet managed run' && run.mode === 'managed' && run.budget.maxTaskMinutes === 30));
  check('tablet inspector sits beside the graph without making the page modal', await page.getByRole('complementary', { name: 'Run-Details', exact: true }).isVisible() && await page.getByRole('dialog').count() === 0);
  check('tablet layout has no horizontal overflow', await noOverflow());
  await page.screenshot({ path: join(evidence, 'tablet-managed-run.png'), fullPage: true });
  await closeInspector();
  const coordinatorNode = page.getByRole('button', { name: 'Agent Coordinator · orchestrator', exact: true });
  await coordinatorNode.focus(); await page.keyboard.press('Enter');
  check('Enter on a graph node selects the agent in Inspector', await page.getByRole('heading', { name: 'Coordinator', exact: true }).isVisible());
  await page.keyboard.press('Escape');
  check('Escape clears graph selection and returns focus to its node', await coordinatorNode.getAttribute('aria-pressed') === 'false' && await coordinatorNode.evaluate((node) => node === document.activeElement));
  await page.keyboard.press('Space');
  check('Space also selects a graph node', await coordinatorNode.getAttribute('aria-pressed') === 'true');
  await closeInspector();
  await page.getByRole('button', { name: 'Graph vergrössern', exact: true }).click();
  check('graph zoom controls change scale', await page.locator('.m-zoom output').textContent() === '110%');
  await page.getByRole('button', { name: 'Graph einpassen', exact: true }).click();
  check('graph fit control keeps a bounded readable scale', Number((await page.locator('.m-zoom output').textContent())!.replace('%', '')) <= 100);
  await page.getByRole('button', { name: 'Graph-Zoom zurücksetzen', exact: true }).click();
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await page.screenshot({ path: join(evidence, 'tablet-graph-light.png'), fullPage: true });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await page.keyboard.press('Shift+Tab');
  check('Settings is modal and traps reverse keyboard focus', await settings.evaluate((node) => node.matches(':modal') && node.contains(document.activeElement)));
  await page.keyboard.press('Tab');
  check('Settings wraps forward focus to its close button', await settings.getByRole('button', { name: 'Settings schliessen', exact: true }).evaluate((node) => node === document.activeElement));
  await page.keyboard.press('Escape');
  check('closing Settings restores its opener', await page.getByRole('button', { name: 'Settings', exact: true }).evaluate((node) => node === document.activeElement));
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    check(`desktop shell fits ${viewport.width}x${viewport.height} without page overflow`, await noOverflow());
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await coordinatorNode.tap();
  check('phone graph opens an accessible detail dialog', await page.getByRole('dialog', { name: 'Run-Details', exact: true }).isVisible() && await noOverflow());
  await page.keyboard.press('Escape');
  check('closing phone graph detail restores its node', await coordinatorNode.evaluate((node) => node === document.activeElement));
  await page.getByRole('button', { name: 'Neue Aufgabe', exact: true }).click();
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
  await page.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click(); await connected();
  check('final positive control re-pairs and reconnects after revocation', fixture.devices.activeDevices().length === 1);
  await page.getByRole('button', { name: 'Neue Aufgabe', exact: true }).click();
  check('a new identity cannot replay an old uncertain command or draft', !(await page.getByRole('heading', { name: 'Antwort noch unklar' }).count()) && await page.getByLabel('Aufgabe', { exact: true }).inputValue() === '');
  check('browser storage contains only appearance preferences, not private drafts', await page.evaluate(() => Object.keys(localStorage).every((key) => ['ade-mobile-theme', 'ade-mobile-view'].includes(key))));
  check('ordinary views use only signed catalog/run/host and explicit workspace reads', endpoints.every((path) =>
    /^\/api\/v1\/(pair|session|health|host|catalog|events|tasks|runs)(\/[^/]+\/(start|cancel))?$/.test(path)
    || path === '/api/v1/workspace/query'));
  check('mobile workflow has no uncaught page errors', errors.length === 0);
  await context.close();
})().catch(async (error) => { failed++; console.error(error); await page?.screenshot({ path: join(evidence, 'browser-failure.png'), fullPage: true }).catch(() => undefined); })
  .finally(async () => {
    await browser?.close(); sessions?.dispose(); await server?.stop(); await proxy?.close();
    if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('unexpected fixture root');
    rmSync(root, { recursive: true, force: true });
    console.log(`\nMobile browser (${useWebkit ? 'WebKit' : 'Chromium'}): ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
  });
