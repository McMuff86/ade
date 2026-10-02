/** Desktop: a project folder deleted outside ADE is hidden on window return and removable only after an explicit confirmation, in real Electron. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { mainEntry } from './helpers/buildOutput';
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-missing-electron-')));
const evidence = resolve('test-results/projects'); mkdirSync(evidence, { recursive: true });
let app: ElectronApplication | undefined; let page: Page | undefined; let passed = 0; let failed = 0;
const check = (name: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } };
void (async () => {
  const launcher = join(root, 'launch.cjs');
  writeFileSync(launcher, `require(${JSON.stringify(mainEntry(process.env.ADE_ORGANIZER_MAIN))});`);
  app = await electron.launch({ args: [launcher], env: { ...process.env, ADE_USER_DATA_DIR: join(root, 'profile'), ADE_HOST_API_ENABLED: '0', NODE_ENV: 'test' } });
  page = await app.firstWindow(); page.setDefaultTimeout(30_000); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const repo = (name: string) => { const path = join(root, name); mkdirSync(path); execFileSync('git', ['init', '-q', path], { stdio: 'ignore' }); return path; };
  const keep = repo('Keep'); const gone = repo('Gone');
  for (const [path, name] of [[keep, 'Keep'], [gone, 'Gone']]) await page.evaluate(([value, label]) => window.ade.invoke('repository:import', { path: value, name: label, executionBackend: 'native' }), [path, name]);
  await page.getByRole('tab', { name: 'Projekte', exact: true }).click();
  await page.getByRole('button', { name: 'Alle', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace öffnen: Gone', exact: true }).waitFor();
  check('both projects are listed while their folders exist', await page.getByRole('heading', { name: /nicht mehr gefunden/ }).count() === 0);

  rmSync(gone, { recursive: true });
  await page.waitForTimeout(5_200); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const heading = page.getByRole('heading', { name: '1 Projekt nicht mehr gefunden', exact: true }); await heading.waitFor();
  check('the window return hides the deleted project and keeps the other one', await page.getByRole('button', { name: 'Workspace öffnen: Gone', exact: true }).count() === 0
    && await page.getByRole('button', { name: 'Workspace öffnen: Keep', exact: true }).count() === 1);
  check('hiding keeps the registration', (await page.evaluate(() => window.ade.invoke('config:get'))).repositories.some((item) => item.name === 'Gone'));
  const remove = page.getByRole('button', { name: 'Aus ADE entfernen: Gone', exact: true });
  await remove.focus(); await page.keyboard.press('Enter');
  const confirmation = page.getByRole('group', { name: 'Entfernen bestätigen: Gone', exact: true }); await confirmation.waitFor();
  check('the confirmation takes focus', await confirmation.getByRole('button', { name: 'Registrierung entfernen', exact: true }).evaluate((node) => node === document.activeElement));
  await page.screenshot({ path: join(evidence, 'desktop-missing-project.png') });
  await page.keyboard.press('Escape'); await remove.waitFor();
  check('Escape cancels and returns focus to the remove button', await remove.evaluate((node) => node === document.activeElement));
  await page.keyboard.press('Enter'); await confirmation.getByRole('button', { name: 'Registrierung entfernen', exact: true }).click();
  await page.getByText('Gone wurde aus ADE entfernt. Der Run-Verlauf bleibt.', { exact: true }).waitFor();
  await heading.waitFor({ state: 'detached' });
  const config = await page.evaluate(() => window.ade.invoke('config:get'));
  check('confirmed removal deregisters only the missing project', !config.repositories.some((item) => item.name === 'Gone') && config.repositories.some((item) => item.name === 'Keep'));
  await page.waitForFunction(() => document.activeElement?.textContent === 'Projektordner aktualisieren');
  check('focus moves to the refresh button when the section disappears', true);
  check('no uncaught renderer errors', errors.length === 0);
})().catch((error) => { failed++; console.error(error); }).finally(async () => {
  await app?.close();
  if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unsafe cleanup'); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  console.log(`Missing projects Electron: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
});
