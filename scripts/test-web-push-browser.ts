/** Actual HTTPS browser -> signatures/CSRF -> application/ledger/vault/journal.
 * Browser subscription and provider delivery are simulated; this is NOT an
 * Android background-delivery acceptance test. */
import { createECDH, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { expect } from 'playwright/test';
import { createMobileFixture, fixtureProtection } from './helpers/mobileFixture';
import { mobileTlsProxy } from './helpers/mobileBrowser';
import { mobileAssetsDir } from './helpers/buildOutput';
import { PushStore } from '../src/main/notifications/PushStore';
import { WebPushService } from '../src/main/notifications/WebPushService';
import { DeviceResourceService } from '../src/main/application/DeviceResourceService';
import { AdeApplicationService } from '../src/main/application/AdeApplicationService';
import { RemoteCommandLedger } from '../src/main/application/RemoteCommandLedger';
import { HostOperationGate } from '../src/main/application/HostOperationGate';
import { HostRestartController } from '../src/main/application/HostRestartController';
import { HostApiServer } from '../src/main/remote/HostApiServer';
import { RemoteAuthorizer } from '../src/main/remote/authorization';
import { BrowserSessions } from '../src/main/remote/BrowserSessions';
import { loadMobileAssets } from '../src/main/remote/mobileAssets';
import type { MobilePushPayload } from '../src/shared/remote';

let passed = 0; let failed = 0;
const check = (name: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } };
const root = mkdtempSync(join(tmpdir(), 'ade-push-browser-')); const evidence = resolve('test-results/web-push'); mkdirSync(evidence, { recursive: true });
let browser: Browser | undefined; let server: HostApiServer | undefined; let proxy: Awaited<ReturnType<typeof mobileTlsProxy>> | undefined;
let push: WebPushService | undefined;
void (async () => {
  const f = createMobileFixture(root); const resources = new DeviceResourceService(f.store, id => f.devices.resourceAccess(id));
  const delivered: MobilePushPayload[] = []; let transportFails = false; let clockOffset = 0;
  push = new WebPushService(new PushStore(join(root, 'remote', 'push.json'), fixtureProtection), {
    subscribe: listener => f.changes.subscribe(listener),
    cursor: () => f.orchestration.journalCursor(), events: cursor => f.orchestration.eventsSince(cursor, 100),
    completed: id => f.store.get().runs.some(run => run.id === id && run.status === 'completed'),
    active: id => f.devices.activeDevices().some(d => d.id === id), allowed: (id, runId) => resources.run(id, runId),
  }, async (_subscription, payload) => { if (transportFails) throw new Error('fixture provider failure'); delivered.push(payload); return 201; }, () => Date.now() + clockOffset);
  push.start(); f.devices.onRevoked(id => push!.authorityChanged(id));
  const ledger = new RemoteCommandLedger(join(root, 'remote', 'commands.json'), e => f.devices.audit(e), (id, scope) => f.devices.activeDevices().some(d => d.id === id && d.scopes.includes(scope)));
  const app = new AdeApplicationService(f.store, f.orchestration, { status: () => ({ active: 0, queued: 0, maxActive: 4 }) }, {
    notifications: push, resourceAccess: id => f.devices.resourceAccess(id), deviceActive: id => f.devices.activeDevices().some(d => d.id === id), changes: f.changes,
    administration: { ledger, restart: new HostRestartController(new HostOperationGate(), () => [], () => {}, 'fixture', true) },
  });
  const task = await f.coordinator.submitSingleTask({ agentId: 'builder', repositoryId: 'repo', name: 'Notification fixture work', prompt: 'PRIVATE TASK CONTENT' });
  proxy = await mobileTlsProxy(); const sessions = new BrowserSessions(f.devices);
  server = new HostApiServer(app, { port: 0, requireDeviceReads: true, heartbeatMs: 100,
    authorizer: new RemoteAuthorizer('t'.repeat(32), [], undefined, f.devices),
    browser: { origin: proxy.origin, sessions, assets: loadMobileAssets(mobileAssetsDir()) }, audit: e => f.devices.audit(e) });
  proxy.target((await server.start()).port);
  browser = await chromium.launch({ args: ['--ignore-certificate-errors', '--host-resolver-rules=MAP ade-mobile.fixture.ts.net 127.0.0.1'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, ignoreHTTPSErrors: true });
  const receiver = createECDH('prime256v1'); receiver.generateKeys();
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/ui-fixture', keys: { p256dh: receiver.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
  await context.addInitScript({ content: `(() => {
    const value = ${JSON.stringify(sub)};
    let active = null;
    const control = window.__pushFixture = { workerUnavailable: false, subscriptionFails: false, permission: 'granted', subscriptions: 0 };
    const postMessage = ServiceWorker.prototype.postMessage;
    ServiceWorker.prototype.postMessage = function(message, transfer) {
      if (control.workerUnavailable && message === 'ade-push-capability') return;
      return postMessage.call(this, message, transfer);
    };
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'granted' });
    Object.defineProperty(Notification, 'requestPermission', { configurable: true, value: async () => control.permission });
    PushManager.prototype.getSubscription = async () => active;
    PushManager.prototype.subscribe = async () => {
      control.subscriptions++;
      if (control.subscriptionFails) throw new DOMException('PRIVATE ENDPOINT must not reach UI', 'AbortError');
      active = { toJSON: () => value, unsubscribe: async () => { active = null; return true; } };
      return active;
    };
  })();` });
  const page = await context.newPage(); page.setDefaultTimeout(20_000); const errors: string[] = []; page.on('pageerror', e => { errors.push(e.message); console.error('Browser error:', e.message); });
  await page.goto(sessions.beginPairing(proxy.origin).url); await page.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  const device = f.devices.activeDevices()[0].id;
  const openSettings = async () => { await page.getByRole('button', { name: 'Einstellungen', exact: true }).click(); return page.getByRole('dialog', { name: 'Einstellungen', exact: true }); };
  let dialog = await openSettings(); let panel = dialog.getByRole('region', { name: 'Mobile Benachrichtigungen', exact: true });
  await panel.getByText('Benachrichtigungen für dieses gekoppelte Gerät ausgeschaltet.', { exact: true }).waitFor();
  check('new device is opted out with no delivery', !push.status(device).enabled && delivered.length === 0);
  check('test remains discoverable but disabled until registration is confirmed', await panel.getByRole('button', { name: 'Testnachricht senden', exact: true }).isDisabled()
    && await panel.getByText('Der Test wird verfügbar, sobald ADE', { exact: false }).isVisible());
  await page.evaluate("window.__pushFixture.permission = 'default'");
  await panel.getByRole('button', { name: 'Benachrichtigungen auf diesem Gerät einschalten', exact: true }).click();
  await panel.getByRole('alert').filter({ hasText: 'Die Browser-Berechtigung wurde nicht erteilt.' }).waitFor();
  check('dismissed permission explains its own recovery before any subscription', !push.status(device).enabled && await page.evaluate('window.__pushFixture.subscriptions') === 0);
  await page.evaluate("window.__pushFixture.permission = 'granted'; window.__pushFixture.workerUnavailable = true");
  await panel.getByRole('button', { name: 'Benachrichtigungen auf diesem Gerät einschalten', exact: true }).click();
  await panel.getByRole('alert').filter({ hasText: 'Die ADE-Hintergrundkomponente ist noch nicht' }).waitFor();
  check('obsolete worker fails for the expected capability timeout with no subscription', !push.status(device).enabled && await page.evaluate('window.__pushFixture.subscriptions') === 0);
  await panel.getByRole('button', { name: 'Benachrichtigungsstatus neu laden', exact: true }).click();
  await panel.getByRole('status').filter({ hasText: 'Status geprüft: noch nicht eingeschaltet.' }).waitFor();
  check('status reload acknowledges unchanged state and retains the actionable worker diagnosis', await panel.getByRole('alert').filter({ hasText: 'Schliesse alle ADE-Tabs' }).isVisible()
    && await panel.getByRole('button', { name: 'Testnachricht senden', exact: true }).isDisabled());
  await page.evaluate('window.__pushFixture.workerUnavailable = false; window.__pushFixture.subscriptionFails = true');
  await panel.getByRole('button', { name: 'Benachrichtigungen auf diesem Gerät einschalten', exact: true }).click();
  await panel.getByRole('alert').filter({ hasText: 'Der Browser konnte sich nicht beim Push-Dienst anmelden.' }).waitFor();
  check('browser provider failure is distinct and never exposes its raw exception', !push.status(device).enabled && !(await panel.innerText()).includes('PRIVATE ENDPOINT'));
  await page.evaluate('window.__pushFixture.subscriptionFails = false');
  await page.route('**/api/v1/notifications/command', route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_payload' }) }));
  await panel.getByRole('button', { name: 'Benachrichtigungen auf diesem Gerät einschalten', exact: true }).click();
  await panel.getByRole('alert').filter({ hasText: 'ADE konnte diese Push-Anmeldung des Browsers nicht annehmen.' }).waitFor();
  check('host subscription validation rejection stays distinct from local browser failures', !push.status(device).enabled);
  await page.unroute('**/api/v1/notifications/command');


  await panel.getByRole('checkbox', { name: 'Gemeldete Arbeitsfehler', exact: true }).uncheck();
  let releaseStatus!: () => void; let capturedStatus = false;
  const heldStatus = new Promise<void>(done => { releaseStatus = done; });
  await page.route('**/api/v1/notifications', async route => {
    const body = JSON.stringify(push!.status(device)); capturedStatus = true; await heldStatus;
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
  await panel.getByRole('button', { name: 'Benachrichtigungsstatus neu laden', exact: true }).click();
  await expect.poll(() => capturedStatus).toBe(true);
  const enable = panel.getByRole('button', { name: 'Benachrichtigungen auf diesem Gerät einschalten', exact: true }); await enable.focus(); await enable.press('Enter');
  await panel.getByText('Benachrichtigungen für dieses gekoppelte Gerät eingeschaltet.', { exact: true }).waitFor();
  const oldResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/notifications')); releaseStatus(); await (await oldResponse).finished();
  await page.unroute('**/api/v1/notifications');
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  check('late status response cannot overwrite a confirmed opt-in or category choice', await panel.getByText('Benachrichtigungen für dieses gekoppelte Gerät eingeschaltet.', { exact: true }).isVisible()
    && !await panel.getByRole('checkbox', { name: 'Gemeldete Arbeitsfehler', exact: true }).isChecked());
  check('keyboard opt-in persists only the chosen categories for this identity', push.status(device).enabled && !push.status(device).preferences.error);
  await panel.getByRole('button', { name: 'Benachrichtigungsstatus neu laden', exact: true }).click();
  await panel.getByRole('status').filter({ hasText: 'Status geprüft: eingeschaltet.' }).waitFor();
  check('positive recovery clears the failure and makes the test available', await panel.getByRole('alert').count() === 0
    && await panel.getByRole('button', { name: 'Testnachricht senden', exact: true }).isEnabled());

  check('notification choices and controls fit a narrow tablet', await panel.evaluate(n => n.scrollWidth <= n.clientWidth + 1 && [...n.querySelectorAll('button')].every(b => b.getBoundingClientRect().height >= 40)));
  // A second tab of the same paired device still believes a test is possible.
  const other = await context.newPage(); other.setDefaultTimeout(20_000); other.on('pageerror', e => { errors.push(e.message); console.error('Browser error:', e.message); });
  await other.goto(proxy.origin); await other.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await other.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  const otherPanel = other.getByRole('dialog', { name: 'Einstellungen', exact: true }).getByRole('region', { name: 'Mobile Benachrichtigungen', exact: true });
  await otherPanel.getByText('Benachrichtigungen für dieses gekoppelte Gerät eingeschaltet.', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Testnachricht senden', exact: true }).click();
  await panel.getByText('Der Push-Dienst hat die letzte Nachricht angenommen.', { exact: false }).waitFor();
  check('explicit browser test reaches signed command and simulated provider once', delivered.length === 1 && delivered[0].kind === 'test');
  const testButton = panel.getByRole('button', { name: 'Testnachricht senden', exact: true });
  check('accepted test disables another test and explains the host wait', await testButton.isDisabled()
    && /^Nächster Test in (29|30) s möglich\./.test(await panel.locator('#push-test-wait').innerText())
    && await testButton.getAttribute('aria-describedby') === 'push-test-wait' && await panel.locator('#push-test-wait').getAttribute('role') === null);
  await panel.screenshot({ path: join(evidence, 'push-test-wait-390.png') });
  clockOffset = 28_000;
  await otherPanel.getByRole('button', { name: 'Testnachricht senden', exact: true }).click();
  await otherPanel.getByRole('status').filter({ hasText: /^Gerade wurde ein Test gesendet\. Warte [12] s bis zum nächsten/ }).waitFor();
  check('rejected repeat shows the remaining wait instead of a generic failure', await otherPanel.getByRole('alert').count() === 0
    && await otherPanel.getByRole('button', { name: 'Testnachricht senden', exact: true }).isDisabled() && delivered.length === 1);
  await otherPanel.getByRole('status').filter({ hasText: 'Du kannst jetzt einen weiteren Test senden.' }).waitFor({ timeout: 5_000 });
  check('test becomes available again exactly after the wait', await otherPanel.getByRole('button', { name: 'Testnachricht senden', exact: true }).isEnabled()
    && await otherPanel.locator('#push-test-wait').count() === 0);
  await other.close(); clockOffset = 0;
  await panel.screenshot({ path: join(evidence, 'push-settings-390.png') });
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Einstellungen', exact: true })).toBeFocused();
  check('closing notification settings returns keyboard focus', true);
  // Real coordinator completion emits the event; only task launch/provider are fixtures.
  f.coordinator.onTaskFinished(task.task.id, 'completed', 0, 'Fixture complete');
  await expect.poll(() => delivered.filter(d => d.kind === 'result').length).toBe(1);
  check('journal completion triggers the opted-in result without task text', delivered[1].runId === task.run.id && !JSON.stringify(delivered).includes('PRIVATE'));
  await push.poll(); check('another poll does not duplicate completion', delivered.length === 2);
  await page.goto(`${proxy.origin}/#notice=run:${task.run.id}`);
  await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await page.getByRole('dialog', { name: 'Run-Details', exact: true }).waitFor();
  check('notification hint opens the exact current run after fresh authorization', page.url() === `${proxy.origin}/` && await page.getByRole('dialog').getByText('Notification fixture work', { exact: false }).count() > 0);
  await page.keyboard.press('Escape');
  f.devices.setAdminScopes(device, [], { mode: 'selected', repositoryIds: [], agentIds: [] });
  await page.goto(`${proxy.origin}/#notice=run:${task.run.id}`);
  await page.getByText('Das Nachrichtenziel ist nicht verfügbar oder nicht mehr freigegeben.', { exact: false }).waitFor();
  check('old notification cannot bypass a changed project grant', await page.getByRole('dialog').count() === 0 && f.launched.length === 1);
  f.devices.setAdminScopes(device, [], { mode: 'all' });
  await page.reload(); await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  dialog = await openSettings(); panel = dialog.getByRole('region', { name: 'Mobile Benachrichtigungen', exact: true });
  await panel.getByText('Benachrichtigungen für dieses gekoppelte Gerät eingeschaltet.', { exact: true }).waitFor();
  check('grant refresh and page reload preserve the device opt-in', push.status(device).enabled);
  await page.evaluate("window.__savedRegistration = navigator.serviceWorker.getRegistration; navigator.serviceWorker.getRegistration = async () => { throw new Error('fixture unavailable worker'); }");
  await panel.getByRole('button', { name: 'Benachrichtigungen ausschalten', exact: true }).click();
  await panel.getByText('Benachrichtigungen für dieses gekoppelte Gerät ausgeschaltet.', { exact: true }).waitFor();
  check('explicit disable removes host subscription', !push.status(device).enabled);
  check('host opt-out succeeds even when browser worker lookup fails', await panel.getByRole('alert').count() === 0);
  await page.evaluate('navigator.serviceWorker.getRegistration = window.__savedRegistration');

  await panel.getByRole('button', { name: 'Benachrichtigungen auf diesem Gerät einschalten', exact: true }).click();
  await panel.getByText('Benachrichtigungen für dieses gekoppelte Gerät eingeschaltet.', { exact: true }).waitFor();
  transportFails = true; await panel.getByRole('button', { name: 'Testnachricht senden', exact: true }).click();
  await panel.getByText('Die letzte Nachricht konnte nicht bestätigt werden.', { exact: false }).waitFor();
  check('failed push is reported without changing completed work', f.store.get().runs.find(r => r.id === task.run.id)?.status === 'completed');
  await page.keyboard.press('Escape'); await context.setOffline(true); await page.reload();
  await page.getByText('Offline', { exact: true }).first().waitFor();
  dialog = await openSettings(); panel = dialog.getByRole('region', { name: 'Mobile Benachrichtigungen', exact: true });
  check('offline settings cannot enqueue notification or task commands', await panel.getByRole('button', { name: 'Benachrichtigungen auf diesem Gerät einschalten', exact: true }).isDisabled());
  await page.keyboard.press('Escape');
  const requestsBefore = f.launched.length;
  await page.goto(`${proxy.origin}/#notice=run:${task.run.id}`);
  await page.getByText('Erneut verbinden, um das Nachrichtenziel zu prüfen. Es wird keine Arbeit gestartet.', { exact: true }).waitFor();
  check('offline notification tap waits for authorization and queues no work', await page.getByRole('dialog').count() === 0 && f.launched.length === requestsBefore
    && page.url() === `${proxy.origin}/`);
  await context.setOffline(false);
  await page.getByRole('dialog', { name: 'Run-Details', exact: true }).waitFor();
  check('reconnect checks the device again before opening the notified run', await page.getByRole('dialog').getByText('Notification fixture work', { exact: false }).count() > 0 && f.launched.length === requestsBefore);
  await page.keyboard.press('Escape');
  await page.reload(); await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  transportFails = false; dialog = await openSettings(); panel = dialog.getByRole('region', { name: 'Mobile Benachrichtigungen', exact: true });
  await panel.getByText('Benachrichtigungen für dieses gekoppelte Gerät eingeschaltet.', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Benachrichtigungen ausschalten', exact: true }).click();
  await panel.getByText('Benachrichtigungen für dieses gekoppelte Gerät ausgeschaltet.', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Benachrichtigungen auf diesem Gerät einschalten', exact: true }).click();
  await panel.getByText('Benachrichtigungen für dieses gekoppelte Gerät eingeschaltet.', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Testnachricht senden', exact: true }).click();
  await panel.getByText('Der Push-Dienst hat die letzte Nachricht angenommen.', { exact: false }).waitFor();
  check('positive control after provider failure and offline recovery succeeds', delivered.at(-1)?.kind === 'test');
  await page.keyboard.press('Escape');
  await page.evaluate("Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'denied' })");
  dialog = await openSettings(); panel = dialog.getByRole('region', { name: 'Mobile Benachrichtigungen', exact: true });
  await panel.getByText('Benachrichtigungen sind blockiert.', { exact: false }).waitFor();
  check('blocked browser permission explains recovery and disables opt-in', await panel.getByRole('button', { name: 'Benachrichtigungsauswahl speichern', exact: true }).isDisabled());
  await page.keyboard.press('Escape'); await page.evaluate("Reflect.deleteProperty(window, 'PushManager')");
  dialog = await openSettings(); panel = dialog.getByRole('region', { name: 'Mobile Benachrichtigungen', exact: true });
  await panel.getByText('Dieser Browser bietet kein Web Push.', { exact: false }).waitFor();
  check('unsupported browser exposes an explicit useful state', true);
  f.devices.revoke(device); check('full device revocation removes push credentials immediately', !push.status(device).enabled);
  await page.goto(`${proxy.origin}/#notice=run:${task.run.id}`); await page.waitForTimeout(1_000);
  check('a notification on a revoked device opens no work', await page.getByRole('dialog', { name: 'Run-Details', exact: true }).count() === 0
    && !(await page.locator('body').innerText()).includes('Notification fixture work'));
  check('notification browser flow has no uncaught errors', errors.length === 0);
})().catch(async error => {
  failed++; console.error(error);
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) { console.error((await page.locator('body').innerText()).slice(0, 2500)); await page.screenshot({ path: join(evidence, 'push-failure.png') }); }
}).finally(async () => {
  push?.dispose(); await browser?.close(); await server?.stop(); await proxy?.close(); rmSync(root, { recursive: true, force: true });
  console.log(`Web push browser: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
});
