import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Request } from 'playwright';
import type { mobileTlsProxy } from './mobileBrowser';

/** Actual Electron IPC, signed browser HTTP and native Git. No UI route mocks. */
export async function projectDirectoryFlow(desktop: Page, page: Page, proxy: Awaited<ReturnType<typeof mobileTlsProxy>>, root: string, evidence: string,
  check: (name: string, ok: boolean) => void): Promise<void> {
  const parent = join(root, 'directory-projects'); const repo = join(parent, 'Discover me'); const folder = join(parent, 'Just an idea');
  mkdirSync(repo, { recursive: true }); mkdirSync(folder);
  execFileSync('git', ['init', '--initial-branch=feature/tablet', repo], { windowsHide: true });
  await desktop.evaluate((rootPath) => window.ade.invoke('projectDefaults:save', { rootPath, agentId: null }), parent);
  const devices = await desktop.evaluate(() => window.ade.invoke('remoteDevices:list'));
  const device = devices.devices.find((item) => item.name === 'Terminal tablet')!;
  await desktop.evaluate(({ deviceId, scopes }) => window.ade.invoke('remoteDevices:setAdminScopes', { deviceId, scopes }),
    { deviceId: device.id, scopes: (device.adminScopes ?? []).filter((scope) => scope !== 'projects:write') });
  const configBefore = await desktop.evaluate(() => window.ade.invoke('config:get'));
  await page.keyboard.press('Escape'); await page.getByRole('tab', { name: 'Projekte', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace öffnen: Discover me', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Projekt · Discover me', exact: true });
  await dialog.getByText('Am PC unter Settings → Verbundene Geräte zusätzlich', { exact: false }).waitFor();
  check('project details take focus and explain missing independent workspace grant', await dialog.evaluate((node) => node.contains(document.activeElement))
    && await dialog.getByRole('button', { name: 'Workspace öffnen', exact: true }).isDisabled());
  check('discovery includes an unregistered Git directory without creating metadata', (await desktop.evaluate(() => window.ade.invoke('config:get'))).projectWorkspaces.length === configBefore.projectWorkspaces.length);
  await desktop.evaluate(({ deviceId, scopes }) => window.ade.invoke('remoteDevices:setAdminScopes', { deviceId, scopes }),
    { deviceId: device.id, scopes: [...new Set([...(device.adminScopes ?? []), 'projects:write' as const])] });
  await dialog.getByRole('button', { name: 'Freigaben aktualisieren', exact: true }).click();
  await dialog.getByRole('button', { name: 'Workspace öffnen', exact: true }).waitFor();
  const keys: string[] = []; const record = (request: Request) => {
    if (request.url().endsWith('/api/v1/projects/command')) keys.push(request.headers()['idempotency-key'] ?? '');
  };
  page.on('request', record); proxy.loseProjectReplies(true);
  await dialog.getByRole('button', { name: 'Workspace öffnen', exact: true }).click();
  await dialog.getByRole('alert').waitFor(); proxy.loseProjectReplies(false);
  check('deliberately lost project-open reply still creates exactly one workspace', (await desktop.evaluate(() => window.ade.invoke('config:get'))).projectWorkspaces.length === configBefore.projectWorkspaces.length + 1);
  await page.reload(); await page.getByRole('button', { name: 'Workspace-Öffnung prüfen', exact: true }).click();
  await dialog.getByRole('button', { name: 'Workspace-Öffnung erneut prüfen', exact: true }).click();
  await dialog.getByRole('region', { name: 'Geöffneter Projekt-Workspace', exact: true }).waitFor(); page.off('request', record);
  check('reload replays the durable same-key receipt and displays exact checkout branch', keys.length === 2 && !!keys[0] && keys[0] === keys[1]
    && await dialog.getByText('feature/tablet', { exact: true }).isVisible() && await dialog.getByText('Ohne Agent-Profil', { exact: true }).isVisible());
  const openedConfig = await desktop.evaluate(() => window.ade.invoke('config:get'));
  check('tablet open creates no agent, no binding and no CLI', openedConfig.agents.length === configBefore.agents.length
    && openedConfig.workspaceBindings.length === configBefore.workspaceBindings.length
    && openedConfig.projectWorkspaces.at(-1)?.workspaceDir === repo);
  await page.screenshot({ path: join(evidence, 'project-directory-workspace-tablet.png') });
  await page.reload(); await dialog.getByText('feature/tablet', { exact: true }).waitFor();
  check('selected independent workspace is restored by read-only query after reload', (await desktop.evaluate(() => window.ade.invoke('config:get'))).projectWorkspaces.length === openedConfig.projectWorkspaces.length);
  await page.keyboard.press('Escape');
  check('closing restored workspace focuses the explicit Projects fallback', await page.getByRole('tab', { name: 'Projekte', exact: true }).evaluate((node) => node === document.activeElement));
  await page.getByRole('button', { name: 'Projektordner aktualisieren', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace öffnen: Just an idea', exact: true }).waitFor();
  check('ordinary non-Git folder is visible with a clear unavailable open action', await page.getByRole('button', { name: 'Workspace öffnen: Just an idea', exact: true }).isDisabled()
    && await page.getByText('Git zuerst am PC initialisieren.', { exact: true }).isVisible());
  await page.getByLabel('Projekte durchsuchen', { exact: true }).fill('nothing-matches');
  check('project search has a useful empty state', await page.getByText('Keine passenden Projektordner. Suche ändern.', { exact: true }).isVisible());
  await page.getByLabel('Projekte durchsuchen', { exact: true }).fill('Discover');
  await page.setViewportSize({ width: 390, height: 844 });
  check('project directory fits a touch phone viewport', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(evidence, 'project-directory-phone.png') });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: join(evidence, 'project-directory-tablet.png') });
  await desktop.keyboard.press('Escape'); await desktop.getByRole('tab', { name: 'Overview view', exact: true }).click();
  await desktop.keyboard.press('ArrowRight');
  check('keyboard navigation reaches the new desktop Projects tab', await desktop.getByRole('tab', { name: 'Projekte view', exact: true }).getAttribute('aria-selected') === 'true'
    && await desktop.getByRole('tab', { name: 'Projekte view', exact: true }).evaluate((node) => node === document.activeElement));
  await desktop.getByRole('button', { name: 'Workspace öffnen: Discover me', exact: true }).click();
  await desktop.getByRole('region', { name: 'Geöffneter Projekt-Workspace', exact: true }).waitFor();
  check('desktop opens the same independent checkout and focuses its title', await desktop.getByText('feature/tablet', { exact: true }).isVisible()
    && await desktop.getByRole('heading', { name: 'Projekt · Discover me', exact: true }).evaluate((node) => node === document.activeElement)
    && (await desktop.evaluate(() => window.ade.invoke('config:get'))).projectWorkspaces.length === openedConfig.projectWorkspaces.length);
  await desktop.screenshot({ path: join(evidence, 'project-directory-desktop.png') });
  await desktop.getByRole('button', { name: 'Zur Projektübersicht', exact: true }).click();
  check('desktop return focuses Projects when the original directory opener unmounted', await desktop.getByRole('tab', { name: 'Projekte view', exact: true }).evaluate((node) => node === document.activeElement));
  await page.getByRole('button', { name: 'Workspace öffnen: Discover me', exact: true }).click();
  // The local receipt checkpoint is a contract: storage failure must precede the host mutation.
  await page.evaluate(() => { Storage.prototype.setItem = function () { throw new Error('fixture quota'); }; });
  const countBefore = keys.length; page.on('request', record);
  await dialog.getByRole('button', { name: 'Workspace öffnen', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Browser-Speicher nicht verfügbar' }).waitFor();
  check('disabled browser storage rejects open before sending any command', keys.length === countBefore);
  page.off('request', record); await page.reload();
  await page.getByRole('button', { name: 'Workspace öffnen: Discover me', exact: true }).click();
  await dialog.getByRole('button', { name: 'Workspace öffnen', exact: true }).click();
  await dialog.getByText('feature/tablet', { exact: true }).waitFor();
  check('final positive browser control opens one unchanged checkout after failures', (await desktop.evaluate(() => window.ade.invoke('config:get'))).projectWorkspaces.length === openedConfig.projectWorkspaces.length);
  await page.keyboard.press('Escape');
}
