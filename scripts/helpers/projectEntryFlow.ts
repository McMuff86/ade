import { join } from 'node:path';
import type { Page } from 'playwright';
import type { mobileTlsProxy } from './mobileBrowser';

/** Uses deterministic native CLI executables supplied by the terminal Electron fixture. */
export async function projectEntryFlow(desktop: Page, page: Page, evidence: string, check: (label: string, ok: boolean) => void,
  proxy?: Awaited<ReturnType<typeof mobileTlsProxy>>): Promise<void> {
  await page.keyboard.press('Escape');
  const device = (await desktop.evaluate(() => window.ade.invoke('remoteDevices:list'))).devices.find((item) => item.name === 'Terminal tablet')!;
  await desktop.evaluate(({ deviceId, scopes }) => window.ade.invoke('remoteDevices:setAdminScopes', { deviceId, scopes }),
    { deviceId: device.id, scopes: [...new Set([...(device.adminScopes ?? []), 'projects:write' as const])] });
  await page.getByRole('tab', { name: 'Projekte', exact: true }).click();
  check('Projects entry keeps run controls in Work', !await page.getByRole('button', { name: 'Neue Aufgabe', exact: true }).count());
  await page.getByLabel('Projekte durchsuchen', { exact: true }).fill('Tablet Garden');
  const openLegacy = async () => {
    await page.getByRole('button', { name: 'Workspace öffnen: Tablet Garden', exact: true }).click();
    const selection = page.getByRole('dialog', { name: 'Projekt · Tablet Garden', exact: true });
    await selection.getByRole('button', { name: 'Workspace öffnen', exact: true }).click();
    await selection.getByText('Agent-Arbeitskopie', { exact: true }).click();
    await selection.getByRole('button', { name: 'Agent-Arbeitskopie öffnen', exact: true }).click();
  };
  await openLegacy();
  const workspace = page.getByRole('dialog', { name: 'Projekt · Tablet Garden', exact: true });
  const before = (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.length;
  await workspace.getByRole('button', { name: 'Workspace öffnen', exact: true }).click();
  await workspace.getByLabel('Projekt-CLI', { exact: true }).waitFor();
  check('project workspace opens without starting a CLI or requiring an agent selection', (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.length === before
    && !await workspace.getByLabel('Workspace-Projekt', { exact: true }).count());
  await workspace.getByRole('button', { name: 'Dateien', exact: true }).click();
  await workspace.getByRole('region', { name: 'Workspace-Dateien', exact: true }).waitFor();
  check('project entry exposes the existing workspace files', await workspace.getByRole('button', { name: 'scaffold.txt', exact: true }).isVisible());
  await workspace.getByRole('button', { name: 'Terminal', exact: true }).click();
  for (const [mode, label] of [['codex', 'Codex'], ['claude', 'Claude CLI'], ['grok', 'Grok CLI']] as const) {
    await workspace.getByLabel('Projekt-CLI', { exact: true }).selectOption(mode);
    await workspace.getByRole('button', { name: `${label} öffnen`, exact: true }).click({ trial: true });
    await workspace.getByRole('button', { name: `${label} öffnen`, exact: true }).press('Enter');
    await workspace.getByLabel('Terminalanzeige', { exact: true }).getByText(`ADE_SESSION_${mode.toUpperCase()}_READY`, { exact: false }).last().waitFor();
    const sessions = (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions;
    const config = await desktop.evaluate(() => window.ade.invoke('config:get'));
    const repo = config.repositories.find((item) => item.name === 'Tablet Garden')!;
    const binding = config.workspaceBindings.find((item) => item.repositoryId === repo.id)!;
    check(`Projects launches ${label} in the same bound project workspace`, sessions.some((session) => session.launchChoice?.mode === mode
      && session.repositoryId === repo.id && session.workspaceDir === binding.workspaceDir));
    await workspace.getByLabel('CLI- und Terminalstatus', { exact: true }).filter({ hasText: 'beendet · Terminal offen' }).waitFor();
    await workspace.getByRole('button', { name: `${label} öffnen`, exact: true }).click();
    await workspace.getByText('wird geöffnet…', { exact: false }).waitFor({ state: 'hidden' });
    check(`${label} starts again after the short-lived fixture exits instead of reusing its empty shell`, (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.length === sessions.length + 1);
  }
  await page.screenshot({ path: join(evidence, 'project-cli-tablet.png') });
  await workspace.getByRole('button', { name: 'Projekt · Tablet Garden schliessen', exact: true }).click();
  check('closing project workspace returns keyboard focus to Projects', await page.getByRole('button', { name: 'Workspace öffnen: Tablet Garden', exact: true }).evaluate((node) => node === document.activeElement)
    || await page.getByRole('tab', { name: 'Projekte', exact: true }).evaluate((node) => node === document.activeElement));
  if (proxy) {
    await openLegacy();
    await workspace.locator('summary').click();
    await workspace.getByLabel('Profil für die Arbeitskopie', { exact: true }).selectOption('');
    const agentsBefore = (await desktop.evaluate(() => window.ade.invoke('config:get'))).agents.length;
    const keys: string[] = [];
    const record = (request: import('playwright').Request) => {
      if (request.url().endsWith('/api/v1/admin/commands') && request.postData()?.includes('agent-create')) keys.push(request.headers()['idempotency-key'] ?? '');
    };
    page.on('request', record); proxy.loseAdminReplies(true);
    await workspace.getByRole('button', { name: 'Workspace öffnen', exact: true }).click();
    await workspace.getByRole('alert').waitFor(); proxy.loseAdminReplies(false);
    check('new workspace profile is created despite a deliberately lost reply', (await desktop.evaluate(() => window.ade.invoke('config:get'))).agents.length === agentsBefore + 1);
    await page.reload(); await workspace.getByRole('button', { name: 'Workspace öffnen · fortsetzen', exact: true }).click();
    await workspace.getByLabel('Projekt-CLI', { exact: true }).waitFor(); page.off('request', record);
    check('project preparation resumes after reload with one profile and the same receipt', (await desktop.evaluate(() => window.ade.invoke('config:get'))).agents.length === agentsBefore + 1
      && keys.length === 2 && !!keys[0] && keys[0] === keys[1]);
    check('a new project workspace still waits for an explicit CLI start', !await workspace.getByLabel('Terminalanzeige', { exact: true }).count());
    await page.keyboard.press('Escape');
  }
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
}
