/** Explicit operator acceptance: uses the PC's real private tailnet, an isolated ADE profile and valid TLS. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { _electron as electron, chromium, type Browser, type ElectronApplication, type Page } from 'playwright';

if (!process.argv.includes('--enable-private-serve')) {
  throw new Error('This operator test changes private Tailscale Serve state. Pass --enable-private-serve explicitly. It is excluded from pnpm verify.');
}
let passed = 0; let failed = 0;
const check = (label: string, condition: boolean): void => { if (condition) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
const root = mkdtempSync(join(tmpdir(), 'ade-tailscale-acceptance-'));
let app: ElectronApplication | undefined; let desktop: Page | undefined; let browser: Browser | undefined;
void (async () => {
  app = await electron.launch({ args: [resolve('out/main/index.js')], cwd: resolve('.'), timeout: 30_000,
    env: { ...process.env, ADE_USER_DATA_DIR: join(root, 'profile'), ADE_HOST_API_ENABLED: '0', ADE_MOBILE_PORT: '4317' } });
  desktop = await app.firstWindow();
  const status = await desktop.evaluate(() => window.ade.invoke('mobileAccess:setEnabled', { enabled: true }));
  if (!status.listening || !status.url) throw new Error(status.message);
  console.log(`Private ADE address: ${status.url}`);
  check('real Tailscale controller installs the private loopback proxy', status.tailscale === 'ready');
  // Deliberately no ignoreHTTPSErrors, custom certificates, DNS overrides or proxy fixtures.
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const phone = await context.newPage(); phone.setDefaultTimeout(60_000);
  await phone.goto(status.url, { timeout: 60_000 });
  await phone.getByRole('heading', { name: 'Gerät koppeln', exact: true }).waitFor();
  check('actual tailnet URL serves the app with normal certificate validation', phone.url().startsWith(status.url));
  let verified = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const current = await desktop.evaluate(() => window.ade.invoke('mobileAccess:status'));
    if (current.https === 'verified') { verified = true; break; }
    await new Promise((done) => setTimeout(done, 1000));
  }
  check('desktop confirms HTTPS only after its independent certificate probe succeeds', verified);
  check('unpaired HTTPS client cannot read catalog', await phone.evaluate(async () => (await fetch('/api/v1/catalog')).status === 401));
  const pairing = await desktop.evaluate(() => window.ade.invoke('mobileAccess:pair'));
  await phone.goto(pairing.url);
  await phone.getByLabel('Gerätename', { exact: true }).fill('Tailscale acceptance browser');
  await phone.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click();
  await phone.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  check('pairing, signed sessions and SSE work through real Tailscale Serve', true);
  await phone.reload(); await phone.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  check('real HTTPS reload restores the paired device', true);
  const inventory = await desktop.evaluate(() => window.ade.invoke('remoteDevices:list'));
  await desktop.evaluate((deviceId) => window.ade.invoke('remoteDevices:revoke', { deviceId }), inventory.devices[0]!.id);
  await phone.getByRole('heading', { name: 'Gerät koppeln', exact: true }).waitFor();
  check('real private proxy forwards revocation disconnection correctly', true);
  const positive = await desktop.evaluate(() => window.ade.invoke('mobileAccess:pair'));
  await phone.getByLabel('Pairing-Code', { exact: true }).fill(positive.code);
  await phone.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click();
  await phone.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  check('final positive control reconnects through real private HTTPS', true);
  await context.close();
})().catch((error) => { failed++; console.error(error instanceof Error ? error.message : 'Tailscale acceptance failed'); })
  .finally(async () => {
    if (desktop) {
      const disabled = await desktop.evaluate(() => window.ade.invoke('mobileAccess:setEnabled', { enabled: false })).catch(() => null);
      check('operator fixture stops its listener and disables its opt-in', disabled?.enabled === false && disabled.listening === false);
    }
    await browser?.close(); await app?.close();
    if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('unexpected fixture root');
    rmSync(root, { recursive: true, force: true });
    console.log(`\nReal Tailscale: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
  });
