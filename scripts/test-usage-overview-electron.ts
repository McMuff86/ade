/** Desktop Overview usage tile + panel and the Settings → Usage consent switch, in real Electron. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-usage-electron-')));
const evidence = resolve('test-results/usage'); mkdirSync(evidence, { recursive: true });
let app: ElectronApplication | undefined; let page: Page | undefined; let passed = 0; let failed = 0;
const check = (name: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } };
void (async () => {
  const launcher = join(root, 'launch.cjs');
  writeFileSync(launcher, `require(${JSON.stringify(resolve(process.env.ADE_ORGANIZER_MAIN ?? 'out/main/index.js'))});`);
  // CLAUDE_CONFIG_DIR points at an empty folder: the consent switch must never make ADE read the operator's real sign-in in a test.
  const claudeDir = join(root, 'claude'); mkdirSync(claudeDir);
  app = await electron.launch({ args: [launcher], env: { ...process.env, ADE_USER_DATA_DIR: join(root, 'profile'), ADE_HOST_API_ENABLED: '0', NODE_ENV: 'test', CLAUDE_CONFIG_DIR: claudeDir } });
  page = await app.firstWindow(); page.setDefaultTimeout(30_000); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  // A fresh profile shows the first-run screen instead of the Overview; one imported project is enough to reach the hero.
  const project = join(root, 'project'); mkdirSync(project); execFileSync('git', ['init', project], { stdio: 'ignore' });
  await page.evaluate((path) => window.ade.invoke('repository:import', { path, name: 'Usage project', executionBackend: 'native' }), project);
  await page.getByRole('tab', { name: 'Übersicht', exact: true }).click();
  const tile = page.getByTestId('overview-usage'); await tile.waitFor();
  check('the desktop hero carries the usage tile with its toggle', (await tile.textContent())!.includes('Nutzung') && await page.getByRole('button', { name: 'Nutzung anzeigen', exact: true }).isVisible());
  const toggle = page.getByRole('button', { name: 'Nutzung anzeigen', exact: true }); await toggle.click();
  const panel = page.getByRole('region', { name: 'Nutzung', exact: true }); await panel.waitFor();
  await panel.getByRole('region', { name: 'Codex', exact: true }).waitFor({ timeout: 45_000 });
  const claude = panel.getByRole('region', { name: 'Claude Code', exact: true });
  check('the panel lists Codex and Claude Code and explains the Claude consent switch', await claude.isVisible() && (await claude.textContent())!.includes('/usage') && (await panel.textContent())!.includes('Einstellungen → Nutzung'));
  await page.waitForTimeout(300); await page.screenshot({ path: join(evidence, 'desktop-usage-panel.png') });
  await panel.getByRole('button', { name: 'Nutzung aktualisieren', exact: true }).focus(); await page.keyboard.press('Escape');
  check('Escape closes the panel and returns focus to the tile button', await panel.count() === 0 && await toggle.evaluate(node => node === document.activeElement));
  // Settings → Usage: consent is persisted and, with no sign-in in the test folder, the panel reports the missing sign-in instead of figures.
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).first().click();
  const consent = page.getByRole('checkbox', { name: 'Claude-Kontolimits über die Anmeldung der Claude-CLI abrufen', exact: true }); await consent.waitFor();
  check('the consent switch starts off', !await consent.isChecked());
  await consent.check();
  await page.waitForFunction(async () => (await window.ade.invoke('config:get')).settings.claudeAccountUsage === true);
  check('switching consent on is persisted in the config', (await page.evaluate(() => window.ade.invoke('config:get'))).settings.claudeAccountUsage === true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Nutzung anzeigen', exact: true }).click(); await panel.waitFor();
  await panel.getByRole('button', { name: 'Nutzung aktualisieren', exact: true }).click();
  await claude.getByText(/\/login/).waitFor({ timeout: 45_000 });
  check('with consent but no CLI sign-in the Claude block asks for /login and shows no percentages', (await claude.textContent())!.includes('/login') && await claude.locator('progress').count() === 0);
  // Projects room: every card carries a usage line; the range switch defaults to 7 days and remembers the choice.
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Projekte', exact: true }).click();
  const card = page.getByTestId('project-usage').first(); await card.waitFor();
  check('the project card explains that no ADE session ran in the period', (await card.textContent())!.includes('Nutzung') && (await card.textContent())!.includes('Keine ADE-Sitzungen'));
  const range = page.getByRole('group', { name: 'Zeitraum der Nutzung', exact: true });
  check('the usage period defaults to 7 days', await range.getByRole('button', { name: '7 Tage', exact: true }).getAttribute('aria-pressed') === 'true');
  await range.getByRole('button', { name: 'Heute', exact: true }).click();
  check('switching to today is a device preference', await range.getByRole('button', { name: 'Heute', exact: true }).getAttribute('aria-pressed') === 'true' && await page.evaluate(() => localStorage.getItem('ade:usage-range')) === 'today');
  check('no uncaught renderer errors', errors.length === 0);
})().catch((error) => { failed++; console.error(error); }).finally(async () => {
  await app?.close();
  if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unsafe cleanup'); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  console.log(`Usage overview Electron: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
});
