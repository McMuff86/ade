import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ElectronApplication, Page } from 'playwright';

export async function tabletLayoutFlow(app: ElectronApplication, desktop: Page, page: Page, root: string, check: (name: string, ok: boolean) => void) {
  const parent = join(root, 'standard-repos'); const external = join(root, 'External project'); const ordinary = join(root, 'Not a repository');
  for (const dir of [parent, external, ordinary]) mkdirSync(dir);
  execFileSync('git', ['init', '--initial-branch=main', external], { windowsHide: true });
  await desktop.evaluate((rootPath) => window.ade.invoke('projectDefaults:save', { rootPath, agentId: null }), parent);
  await desktop.keyboard.press('Escape'); await desktop.getByRole('tab', { name: 'Projekte view', exact: true }).click();
  const share = desktop.getByRole('button', { name: 'Bestehenden Ordner zu meinen ADE Projekten hinzufügen', exact: true });
  await share.waitFor();
  check('desktop directory initially prefers My ADE Projects', await desktop.getByRole('button', { name: 'Meine ADE Projekte', exact: true }).getAttribute('aria-pressed') === 'true');
  const before = await desktop.evaluate(() => window.ade.invoke('config:get'));
  const pick = async (path: string | null) => {
    await app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = (async () => ({ canceled: chosen === null, filePaths: chosen ? [chosen] : [] })) as typeof dialog.showOpenDialog;
    }, path);
    await share.click(); await share.waitFor({ state: 'visible' });
    await desktop.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[aria-label="Einzelnes Projekt freigeben"] button')?.disabled);
  };
  await pick(null);
  check('cancelled PC picker keeps catalog and returns focus', (await desktop.evaluate(() => window.ade.invoke('config:get'))).repositories.length === before.repositories.length
    && await share.evaluate((node) => node === document.activeElement));
  await pick(ordinary);
  check('non-Git folder reports an error without registration', await desktop.getByRole('alert').count() > 0
    && (await desktop.evaluate(() => window.ade.invoke('config:get'))).repositories.length === before.repositories.length);
  await pick(external);
  await desktop.getByRole('button', { name: 'Workspace öffnen: External project', exact: true }).waitFor();
  const after = await desktop.evaluate(() => window.ade.invoke('config:get'));
  check('PC import adds external checkout without changing standard root, agents or workspaces', after.repositories.length === before.repositories.length + 1
    && JSON.stringify(after.settings.projectDefaults) === JSON.stringify(before.settings.projectDefaults)
    && after.agents.length === before.agents.length && after.projectWorkspaces.length === before.projectWorkspaces.length);
  await pick(external);
  check('selecting the same external project twice is idempotent', (await desktop.evaluate(() => window.ade.invoke('config:get'))).repositories.length === after.repositories.length);
  await desktop.screenshot({ path: resolve('test-results/remote/desktop-external-project.png') });
  await page.keyboard.press('Escape'); await page.getByRole('tab', { name: 'Projekte', exact: true }).click();
  await page.getByRole('button', { name: 'Projektordner aktualisieren', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace öffnen: External project', exact: true }).waitFor();
  check('tablet directory initially prefers the same My Projects selection', await page.getByRole('button', { name: 'Meine ADE Projekte', exact: true }).getAttribute('aria-pressed') === 'true');
  check('paired tablet discovers external project but has no PC folder picker', !await page.getByRole('button', { name: 'Bestehenden Ordner zu meinen ADE Projekten hinzufügen', exact: true }).count());
  const device = (await desktop.evaluate(() => window.ade.invoke('remoteDevices:list'))).devices.find(item => item.name === 'Terminal tablet')!;
  await desktop.evaluate(({ deviceId, scopes }) => window.ade.invoke('remoteDevices:setAdminScopes', { deviceId, scopes }),
    { deviceId: device.id, scopes: [...new Set([...(device.adminScopes ?? []), 'catalog:write' as const, 'workspace:read' as const])] });
  await page.getByRole('button', { name: 'Projektordner aktualisieren', exact: true }).click();
  await page.getByRole('button', { name: 'Meine ADE Projekte', exact: true }).click();
  const remove = page.getByRole('button', { name: 'Aus meinen ADE Projekten entfernen: External project', exact: true });
  await remove.click();
  await page.getByRole('button', { name: 'Workspace öffnen: External project', exact: true }).waitFor({ state: 'hidden' });
  check('tablet removal leaves files and catalog identity and returns focus to filter', (await desktop.evaluate(() => window.ade.invoke('config:get'))).repositories.find(repo => repo.name === 'External project')?.inMyProjects === false
    && await page.getByRole('button', { name: 'Meine ADE Projekte', exact: true }).evaluate(node => node === document.activeElement));
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Projekt öffnen: External project', exact: true }).waitFor({ state: 'hidden' });
  check('removed project disappears from mobile overview', !await page.getByRole('button', { name: 'Projekt öffnen: External project', exact: true }).count());
  await page.getByRole('tab', { name: 'Projekte', exact: true }).click();
  await page.getByRole('button', { name: 'Alle', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Zu meinen ADE Projekten hinzufügen: External project', exact: true }).waitFor();
  check('explicit All filter survives tablet reload with the removed project still available', await page.getByRole('button', { name: 'Alle', exact: true }).getAttribute('aria-pressed') === 'true');
  await page.getByRole('button', { name: 'Zu meinen ADE Projekten hinzufügen: External project', exact: true }).click();
  await page.getByRole('button', { name: 'Aus meinen ADE Projekten entfernen: External project', exact: true }).waitFor();
  check('tablet explicit re-add reuses original repository identity', (await desktop.evaluate(() => window.ade.invoke('config:get'))).repositories.find(repo => repo.name === 'External project')?.id === after.repositories.find(repo => repo.name === 'External project')?.id);
  await desktop.getByRole('button', { name: 'Projektordner aktualisieren', exact: true }).click();
  await desktop.getByRole('button', { name: 'Meine ADE Projekte', exact: true }).click();
  await desktop.getByRole('button', { name: 'Aus meinen ADE Projekten entfernen: External project', exact: true }).click();
  await desktop.getByRole('button', { name: 'Workspace öffnen: External project', exact: true }).waitFor({ state: 'hidden' });
  check('desktop membership uses the same shared selection', (await desktop.evaluate(() => window.ade.invoke('config:get'))).repositories.find(repo => repo.name === 'External project')?.inMyProjects === false);
  await desktop.getByRole('button', { name: 'Alle', exact: true }).click();
  await desktop.getByRole('button', { name: 'Zu meinen ADE Projekten hinzufügen: External project', exact: true }).click();
  await desktop.getByRole('button', { name: 'Aus meinen ADE Projekten entfernen: External project', exact: true }).waitFor();
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.getByRole('tab', { name: 'Terminals', exact: true }).click();
  const rail = page.getByRole('separator', { name: 'Breite der Agentenliste', exact: true });
  const inspector = page.getByRole('separator', { name: 'Breite des Inspectors', exact: true });
  await rail.focus(); await page.keyboard.press('End');
  await inspector.focus(); await page.keyboard.press('Home');
  check('keyboard independently sets agent and inspector widths within bounds', await rail.getAttribute('aria-valuenow') === '32' && await inspector.getAttribute('aria-valuenow') === '14');
  const startWidth = await page.locator('#terminal-inspector').evaluate((node) => node.getBoundingClientRect().width);
  const bounds = (await inspector.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + 80 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bounds.x - 100, y: bounds.y + 80 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  check('actual touch drag widens inspector and keeps terminal usable', await page.locator('#terminal-inspector').evaluate((node) => node.getBoundingClientRect().width) > startWidth + 50
    && await page.getByRole('region', { name: 'Terminal-Arbeitsfläche', exact: true }).evaluate((node) => node.getBoundingClientRect().width) > 300);
  const saved = await inspector.getAttribute('aria-valuenow');
  await page.reload(); await inspector.waitFor();
  check('reload restores both independently saved widths', await rail.getAttribute('aria-valuenow') === '32' && await inspector.getAttribute('aria-valuenow') === saved);
  await page.screenshot({ path: resolve('test-results/remote/tablet-resizable-panels.png') });
  await page.setViewportSize({ width: 800, height: 1000 });
  check('portrait tablet retains agent resize without a hidden inspector handle', await rail.isVisible() && !await inspector.isVisible()
    && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 390, height: 844 });
  check('phone uses collapsible navigation with no misplaced resize handles', !await rail.isVisible() && !await inspector.isVisible()
    && await page.getByRole('button', { name: 'Agents und Sitzungen', exact: true }).isVisible());
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.evaluate(() => localStorage.setItem('ade-mobile-terminal-panel-widths', '["broken",999]'));
  await page.reload(); await rail.waitFor();
  check('invalid stored panel sizes recover to usable defaults', await rail.getAttribute('aria-valuenow') === '20' && await inspector.getAttribute('aria-valuenow') === '20');
}
