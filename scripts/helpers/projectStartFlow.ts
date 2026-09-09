import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import type { mobileTlsProxy } from './mobileBrowser';

/** Real Electron config/Git/PTY plus a paired Chromium tablet. No paid model calls. */
export async function projectStartFlow(desktop: Page, page: Page, proxy: Awaited<ReturnType<typeof mobileTlsProxy>>, root: string,
  categoryId: string, evidence: string, check: (label: string, passed: boolean) => void): Promise<void> {
  await page.keyboard.press('Escape'); await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Neues Projekt', exact: true }).click();
  const starter = page.getByRole('dialog', { name: 'Neues Projekt', exact: true });
  check('first project explains desktop setup and takes focus', await starter.evaluate((node) => node.contains(document.activeElement))
    && await starter.getByRole('button', { name: 'Mit Codex starten', exact: true }).isDisabled());
  await page.keyboard.press('Escape');
  const projectRoot = join(root, 'my-repos'); mkdirSync(projectRoot);
  const codex = await desktop.evaluate(async (id) => window.ade.invoke('agent:create', {
    categoryId: id, name: 'Tablet Codex', runtime: 'codex', permissionMode: 'default' }), categoryId);
  await desktop.reload(); await desktop.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = desktop.getByTestId('project-defaults');
  await settings.getByLabel('Projekt-Stammordner', { exact: true }).fill(projectRoot);
  await settings.getByLabel('Codex-Startprofil', { exact: true }).selectOption(codex.id);
  await settings.getByRole('button', { name: 'Projektstart speichern', exact: true }).click();
  await settings.getByText('Projektstart gespeichert. Am Tablet „Neues Projekt“ öffnen.', { exact: true }).waitFor();
  check('desktop setup persists chosen project root and saved Codex profile', (await desktop.evaluate(() => window.ade.invoke('projectDefaults:get'))).agentId === codex.id);
  const grants = desktop.getByRole('group', { name: 'Verwaltungsrechte für Terminal tablet', exact: true });
  await grants.getByRole('checkbox', { name: 'Agents und Projekte erstellen', exact: true }).check();
  await grants.getByRole('checkbox', { name: /Interaktive Terminals steuern/ }).check();
  await grants.getByRole('button', { name: 'Verwaltungsrechte speichern', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await page.getByRole('button', { name: 'Neues Projekt', exact: true }).click();
  await starter.getByRole('button', { name: 'Mit Codex starten', exact: true }).waitFor();
  await starter.getByLabel('Projektname (optional)', { exact: true }).fill('Tablet Garden');
  const keys: string[] = [];
  const record = (request: import('playwright').Request) => {
    if (request.url().endsWith('/api/v1/admin/commands') && request.postData()?.includes('project-create')) keys.push(request.headers()['idempotency-key'] ?? '');
  };
  page.on('request', record); proxy.loseAdminReplies(true);
  await starter.getByRole('button', { name: 'Mit Codex starten', exact: true }).click();
  await starter.getByRole('alert').waitFor(); proxy.loseAdminReplies(false);
  check('lost-response control drops a successful project creation reply', (await desktop.evaluate(() => window.ade.invoke('config:get'))).repositories.some((repo) => repo.name === 'Tablet Garden'));
  await page.reload(); await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await page.getByRole('button', { name: 'Projektstart fortsetzen', exact: true }).click();
  proxy.loseTerminalReplies(true);
  await starter.getByRole('button', { name: 'Start fortsetzen', exact: true }).click();
  await starter.getByRole('alert').waitFor(); proxy.loseTerminalReplies(false);
  const beforeTerminalRecovery = (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.filter((session) => session.agentId === codex.id);
  check('lost terminal reply leaves one real process awaiting explicit recovery', beforeTerminalRecovery.length === 1);
  await page.reload(); await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await page.getByRole('button', { name: 'Projektstart fortsetzen', exact: true }).click();
  await starter.getByRole('button', { name: 'Start fortsetzen', exact: true }).click();
  const workspace = page.getByRole('dialog', { name: 'Workspace · Tablet Codex', exact: true });
  await workspace.getByLabel('Terminalanzeige', { exact: true }).getByText('ADE_SESSION_CODEX_READY', { exact: false }).last().waitFor();
  page.off('request', record);
  const config = await desktop.evaluate(() => window.ade.invoke('config:get'));
  const repo = config.repositories.find((item) => item.name === 'Tablet Garden')!;
  const binding = config.workspaceBindings.find((item) => item.repositoryId === repo.id && item.agentId === codex.id)!;
  const started = (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.filter((session) => session.repositoryId === repo.id);
  check('lost project reply plus reload creates one named repo and one Codex PTY', config.repositories.filter((item) => item.name === 'Tablet Garden').length === 1
    && repo.rootPath === join(projectRoot, 'tablet-garden') && started.length === 1 && started[0]!.launchChoice?.mode === 'agent'
    && keys.length === 2 && !!keys[0] && keys[0] === keys[1]);
  check('Codex works in the bound project workspace with its saved profile unchanged', started[0]!.workspaceDir === binding.workspaceDir
    && config.agents.find((agent) => agent.id === codex.id)!.permissionMode === 'default');
  await workspace.getByLabel('Terminal-Eingabe', { exact: true }).fill("Set-Content -LiteralPath scaffold.txt -Value 'TABLET_SCAFFOLD'");
  await workspace.getByRole('button', { name: 'Text und Enter senden', exact: true }).click();
  await page.waitForFunction(() => (document.querySelector('[aria-label="Terminal-Eingabe"]') as HTMLTextAreaElement)?.value === '');
  const fileDeadline = Date.now() + 15_000;
  while (!existsSync(join(binding.workspaceDir, 'scaffold.txt')) && Date.now() < fileDeadline) await new Promise((done) => setTimeout(done, 100));
  check('tablet input writes the project scaffold in the real host workspace', readFileSync(join(binding.workspaceDir, 'scaffold.txt'), 'utf8').includes('TABLET_SCAFFOLD'));
  await workspace.getByLabel('Terminal-Eingabe', { exact: true }).fill('A prompt to finish later');
  proxy.setApiOffline(true);
  await page.getByRole('status').filter({ hasText: /^Offline$/ }).waitFor();
  check('offline tablet preserves input and disables sending', await workspace.getByLabel('Terminal-Eingabe', { exact: true }).inputValue() === 'A prompt to finish later'
    && await workspace.getByRole('button', { name: 'Text und Enter senden', exact: true }).isDisabled());
  proxy.setApiOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await page.reload(); await workspace.getByLabel('Terminalanzeige', { exact: true }).waitFor();
  check('reconnect and reload preserve selected project, session and draft without relaunch', await workspace.getByLabel('Terminal-Eingabe', { exact: true }).inputValue() === 'A prompt to finish later'
    && (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.filter((session) => session.repositoryId === repo.id).length === 1);
  await page.setViewportSize({ width: 1280, height: 480 }); await workspace.getByLabel('Terminal-Eingabe', { exact: true }).focus();
  check('short tablet viewport keeps composer and send action visible', await workspace.getByRole('button', { name: 'Text und Enter senden', exact: true }).evaluate((node) => {
    const box = node.getBoundingClientRect(); return box.top >= 0 && box.bottom <= (window.visualViewport?.height ?? innerHeight) + 1;
  }));
  await page.screenshot({ path: join(evidence, 'tablet-project-keyboard.png') });
  await page.setViewportSize({ width: 1280, height: 800 }); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Weiterarbeiten in / }).filter({ hasText: 'Tablet Codex' }).click();
  await workspace.getByLabel('Terminalanzeige', { exact: true }).waitFor();
  check('Continue working attaches the existing project session', (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.filter((session) => session.repositoryId === repo.id).length === 1);
  await page.screenshot({ path: join(evidence, 'tablet-project-workspace.png') });
  await workspace.getByLabel('Terminal-Eingabe', { exact: true }).fill("Write-Output 'INPUT_ACK_CONTROL'");
  proxy.loseInputReplies(true);
  await workspace.getByRole('button', { name: 'Text und Enter senden', exact: true }).click();
  await workspace.getByRole('button', { name: 'Eingabestatus prüfen', exact: true }).waitFor(); proxy.loseInputReplies(false);
  await page.reload(); await workspace.getByLabel('Terminalanzeige', { exact: true }).getByText('INPUT_ACK_CONTROL', { exact: false }).last().waitFor();
  check('reload after a lost input acknowledgement blocks implicit resending', await workspace.getByRole('button', { name: 'Text und Enter senden', exact: true }).isDisabled()
    && await workspace.getByRole('button', { name: 'Ausgabe geprüft · Entwurf freigeben', exact: true }).isVisible());
  await workspace.getByRole('button', { name: 'Ausgabe geprüft · Entwurf freigeben', exact: true }).click();
  await workspace.getByLabel('Terminal-Eingabe', { exact: true }).fill('');
}
