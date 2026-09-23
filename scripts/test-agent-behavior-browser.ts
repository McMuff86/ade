import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { mobileTlsProxy } from './helpers/mobileBrowser';
import { BrowserSessions } from '../src/main/remote/BrowserSessions';
import { HostApiServer } from '../src/main/remote/HostApiServer';
import { RemoteAuthorizer } from '../src/main/remote/authorization';
import { loadMobileAssets } from '../src/main/remote/mobileAssets';
import { AgentBehaviorService } from '../src/main/memory/AgentBehaviorService';

let passed = 0; let failed = 0;
const check = (name: string, ok: boolean) => { if (!ok) throw new Error(name); passed++; console.log(`  ok ${name}`); };
const root = mkdtempSync(join(tmpdir(), 'ade-behavior-browser-'));
let browser: Browser | undefined; let server: HostApiServer | undefined;
let sessions: BrowserSessions | undefined; let proxy: Awaited<ReturnType<typeof mobileTlsProxy>> | undefined;
void (async () => {
  const { application, store, devices } = createRemoteWorkspaceFixture(root);
  const behavior = new AgentBehaviorService(store);
  proxy = await mobileTlsProxy(); sessions = new BrowserSessions(devices);
  server = new HostApiServer(application, { port: 0, heartbeatMs: 200, requireDeviceReads: true,
    authorizer: new RemoteAuthorizer('t'.repeat(32), [], undefined, devices),
    browser: { origin: proxy.origin, sessions, assets: loadMobileAssets(resolve(process.env.ADE_MOBILE_ASSETS ?? 'out/mobile')) }, audit: entry => devices.audit(entry) });
  proxy.target((await server.start()).port);
  browser = await chromium.launch({ args: ['--ignore-certificate-errors', '--host-resolver-rules=MAP ade-mobile.fixture.ts.net 127.0.0.1'] });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, hasTouch: true, ignoreHTTPSErrors: true });
  page.setDefaultTimeout(25_000); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(sessions.beginPairing(proxy.origin).url);
  await page.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  const deviceId = devices.activeDevices()[0]!.id;
  devices.setAdminScopes(deviceId, ['workspace:read']);
  const open = async () => {
    await page.getByRole('button', { name: 'Workspace für Builder', exact: true }).click();
    await page.getByRole('dialog', { name: 'Workspace · Builder', exact: true }).getByRole('button', { name: 'Agent-Profil', exact: true }).click();
  };
  const originalRuntime = store.get().agents.find(agent => agent.id === 'builder')!.runtime;
  for (const runtime of ['codex', 'claude', 'grok', 'ollama'] as const) {
    store.save({ agents: store.get().agents.map(agent => agent.id === 'builder' ? { ...agent, runtime } : agent) });
    await page.reload(); await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
    await open();
    const enlarge = page.getByRole('button', { name: 'Profilbild vergrössern', exact: true });
    await enlarge.waitFor();
    await page.waitForFunction(runtime => [...document.querySelectorAll<HTMLImageElement>(`img[data-runtime-logo="${runtime}"]`)].some(image => image.complete && image.naturalWidth > 0), runtime);
    check(`tablet ${runtime} profile loads its bundled vector logo`, (await enlarge.locator('img').getAttribute('src'))?.includes('.svg') === true);
    await enlarge.focus(); await page.keyboard.press('Enter');
    const portrait = page.getByRole('dialog', { name: 'Profilbild · Builder', exact: true });
    check(`tablet ${runtime} portrait uses the vector at display density 2`, await portrait.locator(`img[data-runtime-logo="${runtime}"]`).count() === 1
      && await portrait.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    mkdirSync(resolve('test-results/profile-logos'), { recursive: true });
    await portrait.screenshot({ path: resolve(`test-results/profile-logos/tablet-${runtime}.png`) });
    await page.keyboard.press('Escape'); await portrait.waitFor({ state: 'hidden' });
    check('closing enlarged logo restores profile button focus', await enlarge.evaluate(node => node === document.activeElement));
    await page.keyboard.press('Escape');
  }
  store.save({ agents: store.get().agents.map(agent => agent.id === 'builder' ? { ...agent, runtime: originalRuntime } : agent) });
  await page.reload(); await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await open();
  const workspace = page.getByRole('dialog', { name: 'Workspace · Builder', exact: true });
  const editor = workspace.getByRole('region', { name: 'Agent-Verhalten', exact: true });
  const input = editor.getByLabel('Profil-Arbeitsanweisungen', { exact: true });
  await input.waitFor(); check('read-only device sees context but cannot change instructions', await input.isDisabled());
  await page.keyboard.press('Escape'); await workspace.waitFor({ state: 'hidden' });
  devices.setAdminScopes(deviceId, ['workspace:read', 'profiles:write']);
  await open(); await input.fill('Prüfe Geometrie und Masse sorgfältig.');
  await editor.getByLabel('Markdown-Dokumente zuweisen', { exact: true }).setInputFiles([
    { name: 'AGENTS.md', mimeType: 'text/markdown', buffer: Buffer.from('Erstelle zuerst eine Bestandsaufnahme.') },
    { name: 'CAD.md', mimeType: 'text/markdown', buffer: Buffer.from('Beachte die Materialstärke.') },
  ]);
  await editor.getByRole('button', { name: 'CAD.md nach oben', exact: true }).click();
  await editor.getByRole('button', { name: 'Profilanweisungen speichern', exact: true }).click();
  await editor.getByText(/Profilanweisungen gespeichert/).waitFor();
  check('tablet saves instructions and ordered Markdown copies', store.get().agents.find(agent => agent.id === 'builder')!.profile?.documents[0]?.name === 'CAD.md');
  await editor.locator('summary').click();
  const preview = editor.getByLabel('Gespeicherter Profilkontext', { exact: true });
  check('saved preview contains full instruction and document text', (await preview.innerText()).includes('Materialstärke') && (await preview.innerText()).includes('Geometrie'));
  await input.fill('Ungespeicherter lokaler Entwurf.');
  const current = behavior.query('builder');
  behavior.update({ agentId: 'builder', revision: current.revision, profile: { ...current.profile, instructions: 'Zwischenzeitlich am PC geändert.' } });
  await editor.getByRole('button', { name: 'Profilanweisungen speichern', exact: true }).click();
  await editor.getByRole('alert').waitFor();
  check('stale tablet edit preserves local draft and newer host content', await input.inputValue() === 'Ungespeicherter lokaler Entwurf.' && behavior.query('builder').profile.instructions === 'Zwischenzeitlich am PC geändert.');
  await editor.getByRole('button', { name: 'Entwurf verwerfen und Profil neu laden', exact: true }).click();
  await page.waitForFunction(() => (document.querySelector('[aria-label="Profil-Arbeitsanweisungen"]') as HTMLTextAreaElement)?.value === 'Zwischenzeitlich am PC geändert.');
  check('explicit reload resolves conflict', await input.inputValue() === 'Zwischenzeitlich am PC geändert.');
  await editor.getByLabel('Markdown-Dokumente zuweisen', { exact: true }).setInputFiles({ name: 'bad.md', mimeType: 'text/markdown', buffer: Buffer.from('x'.repeat(8001)) });
  await editor.getByRole('alert').waitFor();
  check('oversized import leaves saved documents unchanged', behavior.query('builder').profile.documents.length === 2);
  await editor.getByRole('button', { name: 'CAD.md entfernen', exact: true }).click();
  await editor.getByRole('button', { name: 'Profilanweisungen speichern', exact: true }).click();
  await editor.getByText(/Profilanweisungen gespeichert/).waitFor();
  check('positive save after rejected import removes only selected document', behavior.query('builder').profile.documents.length === 1 && behavior.query('builder').profile.documents[0]!.name === 'AGENTS.md');
  await input.fill('Diesen lokalen Entwurf behalten.');
  const newer = behavior.query('builder');
  behavior.update({ agentId: 'builder', revision: newer.revision, profile: { ...newer.profile, instructions: 'Zweite Änderung am PC.' } });
  await editor.getByRole('button', { name: 'Profilanweisungen speichern', exact: true }).click();
  await editor.getByRole('alert').waitFor();
  await editor.getByRole('button', { name: 'Neue Profilbasis laden und Entwurf behalten', exact: true }).click();
  await editor.getByText(/Aktueller Profilstand geladen/).waitFor();
  check('explicit new base preserves the local draft without overwriting host changes', await input.inputValue() === 'Diesen lokalen Entwurf behalten.' && behavior.query('builder').profile.instructions === 'Zweite Änderung am PC.');
  await editor.getByRole('button', { name: 'Profilanweisungen speichern', exact: true }).click();
  await editor.getByText(/Profilanweisungen gespeichert/).waitFor();
  check('reviewed retained draft can be saved against the new base', behavior.query('builder').profile.instructions === 'Diesen lokalen Entwurf behalten.');
  await page.setViewportSize({ width: 390, height: 844 });
  check('profile editor fits narrow phone viewport', await editor.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
  await input.focus(); await page.keyboard.press('Escape'); await workspace.waitFor({ state: 'hidden' });
  check('Escape closes profile workspace and restores opener focus', await page.getByRole('button', { name: 'Workspace für Builder', exact: true }).evaluate(node => node === document.activeElement));
  check('behavior editor has no uncaught browser errors', errors.length === 0);
})().catch(async error => {
  failed++; console.error(error); const page = browser?.contexts()[0]?.pages()[0];
  if (page) { console.error((await page.locator('body').innerText()).slice(-5000)); await page.screenshot({ path: resolve('test-results/agent-behavior-browser-failure.png') }); }
}).finally(async () => {
  await browser?.close(); await server?.stop(); sessions?.dispose(); await proxy?.close();
  rmSync(root, { recursive: true, force: true }); console.log(`Agent behavior browser: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
});
