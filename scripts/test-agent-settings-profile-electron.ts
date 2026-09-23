import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright';

let passed = 0; let failed = 0; let app: ElectronApplication | undefined;
const root = mkdtempSync(join(tmpdir(), 'ade-settings-profile-'));
const check = (name: string, ok: boolean) => { if (!ok) throw new Error(name); passed++; console.log(`  ok ${name}`); };
void (async () => {
  app = await electron.launch({ args: [resolve('out/main/index.js')], env: { ...process.env, ADE_USER_DATA_DIR: root, ADE_HOST_API_ENABLED: '0', NODE_ENV: 'test' } });
  const page = await app.firstWindow(); page.setDefaultTimeout(20_000);
  const agent = await page.evaluate(async () => {
    const category = await window.ade.invoke('category:create', { name: 'Profile test' });
    return window.ade.invoke('agent:create', { categoryId: category.id, name: 'Profile parity', runtime: 'codex', permissionMode: 'default' });
  });
  for (const runtime of ['codex', 'claude', 'grok', 'ollama'] as const) {
    const named = await page.evaluate(async runtime => {
      const config = await window.ade.invoke('config:get');
      return window.ade.invoke('agent:create', { categoryId: config.categories.find(item => item.name === 'Profile test')!.id,
        name: `Logo ${runtime}`, runtime, permissionMode: 'default' });
    }, runtime);
    const cardButton = page.getByRole('button', { name: `Agent-Karte für Logo ${runtime}`, exact: true });
    await cardButton.locator('img').waitFor();
    await page.waitForFunction(runtime => [...document.querySelectorAll<HTMLImageElement>(`img[data-runtime-logo="${runtime}"]`)].some(image => image.complete && image.naturalWidth > 0), runtime);
    check(`${runtime} has a bundled vector profile logo in the rail`, (await cardButton.locator('img').getAttribute('src'))?.includes('.svg') === true);
    await cardButton.focus(); await page.keyboard.press('Enter');
    const profile = page.getByRole('dialog', { name: `Logo ${runtime}`, exact: true });
    check(`${runtime} profile card uses the same sharp logo`, await profile.locator(`img[data-runtime-logo="${runtime}"]`).count() === 1);
    mkdirSync(resolve('test-results/profile-logos'), { recursive: true });
    await profile.screenshot({ path: resolve(`test-results/profile-logos/desktop-${runtime}.png`) });
    await page.keyboard.press('Escape'); await profile.waitFor({ state: 'hidden' });
    if (runtime === 'codex') {
      await page.evaluate(async id => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
        const context = canvas.getContext('2d')!; context.fillStyle = '#996633'; context.fillRect(0, 0, 64, 64);
        const photo = await window.ade.invoke('photo:import', { mime: 'image/png', bytesBase64: canvas.toDataURL('image/png').split(',')[1]! });
        await window.ade.invoke('agent:update', { id, name: 'Logo codex', runtime: 'codex', permissionMode: 'default', photo: photo.file });
      }, named.id);
      await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[aria-label="Agent-Karte für Logo codex"] img')?.src.startsWith('ade-photo://'));
      check('personal profile photo takes priority over runtime branding', await cardButton.locator('img[data-runtime-logo]').count() === 0);
    }
  }
  const opener = page.getByRole('button', { name: 'Agent-Einstellungen für Profile parity', exact: true });
  await opener.click({ force: true });
  const dialog = page.getByRole('dialog', { name: 'Agent-Einstellungen', exact: true });
  check('agent settings preview includes its runtime logo', await dialog.locator('img[data-runtime-logo="codex"]').count() === 1);
  const behavior = dialog.getByRole('region', { name: 'Agent-Verhalten', exact: true });
  const text = behavior.getByLabel('Profil-Arbeitsanweisungen', { exact: true });
  await text.waitFor();
  check('ordinary desktop settings expose the shared behavior editor and voice controls', await dialog.getByRole('heading', { name: 'Arbeitsweise und Anweisungen', exact: true }).count() === 1 && await dialog.getByRole('region', { name: 'Agent-Stimme', exact: true }).count() === 1);
  await text.fill('Arbeite als CAD-Prüfer und kontrolliere die Einheiten.');
  await behavior.getByLabel('Markdown-Dokumente zuweisen', { exact: true }).setInputFiles({ name: 'AGENTS.md', mimeType: 'text/markdown', buffer: Buffer.from('Prüfe zuerst die vorhandene Geometrie.') });
  await behavior.getByRole('button', { name: 'Profilanweisungen speichern', exact: true }).click();
  await behavior.getByText(/Profilanweisungen gespeichert/).waitFor();
  const stored = await page.evaluate(id => window.ade.invoke('agent:behaviorGet', { agentId: id }), agent.id);
  check('desktop stores the same shared profile data used by mobile', stored.profile.instructions.includes('CAD-Prüfer') && stored.profile.documents[0]?.name === 'AGENTS.md');
  await behavior.locator('summary').click();
  check('desktop shows stored instruction and Markdown preview', (await behavior.getByLabel('Gespeicherter Profilkontext').innerText()).includes('vorhandene Geometrie'));
  await dialog.locator('#edit-agent-role').fill('CAD-Spezialist');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  check('saving other agent settings preserves separately saved behavior', (await page.evaluate(id => window.ade.invoke('agent:behaviorGet', { agentId: id }), agent.id)).profile.instructions === stored.profile.instructions);
  await page.getByRole('button', { name: 'Agent-Karte für Profile parity', exact: true }).click();
  const card = page.getByRole('dialog', { name: 'Profile parity', exact: true });
  await card.getByLabel('Profil-Arbeitsanweisungen', { exact: true }).waitFor();
  check('profile card and settings read the same persisted instructions', await card.getByLabel('Profil-Arbeitsanweisungen', { exact: true }).inputValue() === stored.profile.instructions);
  await card.getByRole('button', { name: 'Agent-Einstellungen', exact: true }).click();
  await text.waitFor(); await page.setViewportSize({ width: 760, height: 720 });
  check('shared settings fit a compact desktop window', await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
  await text.focus(); await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  check('Escape closes the expanded settings', !await dialog.count());
})().catch(error => { failed++; console.error(error); }).finally(async () => {
  await app?.close(); rmSync(root, { recursive: true, force: true });
  console.log(`Agent settings profile Electron: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
});
