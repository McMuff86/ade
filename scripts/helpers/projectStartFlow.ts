import { terminalComposer } from './terminalControls';
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
    && await starter.getByRole('button', { name: 'Projekt anlegen und öffnen', exact: true }).isDisabled());
  await page.keyboard.press('Escape');
  const projectRoot = join(root, 'my-repos'); mkdirSync(projectRoot);
  await desktop.evaluate(async (id) => window.ade.invoke('agent:create', {
    categoryId: id, name: 'Tablet Codex', runtime: 'codex', permissionMode: 'default' }), categoryId);
  await desktop.reload(); await desktop.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = desktop.getByTestId('project-defaults');
  await settings.getByLabel('Projekt-Stammordner', { exact: true }).fill(projectRoot);
  await settings.getByRole('button', { name: 'Projektstart speichern', exact: true }).click();
  await settings.getByText('Projektstart gespeichert. Am Tablet „Neues Projekt“ öffnen.', { exact: true }).waitFor();
  check('desktop setup persists project root without requiring a profile', (await desktop.evaluate(() => window.ade.invoke('projectDefaults:get'))).rootPath === projectRoot
    && !await settings.getByLabel('Codex-Startprofil', { exact: true }).count());
  const grants = desktop.getByRole('group', { name: 'Verwaltungsrechte für Terminal tablet', exact: true });
  await grants.getByRole('checkbox', { name: 'Agents und Projekte erstellen', exact: true }).check();
  await grants.getByRole('checkbox', { name: /Interaktive Terminals steuern/ }).check();
  await grants.getByRole('checkbox', { name: 'Projekt-Workspaces ohne Agent-Profil öffnen', exact: true }).check();
  await grants.getByRole('button', { name: 'Verwaltungsrechte speichern', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await page.getByRole('button', { name: 'Neues Projekt', exact: true }).click();
  await starter.getByRole('button', { name: 'Projekt anlegen und öffnen', exact: true }).waitFor();
  await starter.getByLabel('Projektname (optional)', { exact: true }).fill('Tablet Garden');
  const keys: string[] = [];
  const record = (request: import('playwright').Request) => {
    if (request.url().endsWith('/api/v1/admin/commands') && request.postData()?.includes('project-create')) keys.push(request.headers()['idempotency-key'] ?? '');
  };
  const before = await desktop.evaluate(() => window.ade.invoke('config:get'));
  page.on('request', record); proxy.loseAdminReplies(true);
  await starter.getByRole('button', { name: 'Projekt anlegen und öffnen', exact: true }).click();
  await starter.getByRole('alert').waitFor(); proxy.loseAdminReplies(false);
  check('lost-response control drops a successful project creation reply', (await desktop.evaluate(() => window.ade.invoke('config:get'))).repositories.some((repo) => repo.name === 'Tablet Garden'));
  await page.reload(); await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await page.getByRole('button', { name: 'Projektstart fortsetzen', exact: true }).click();
  await starter.getByRole('button', { name: 'Start fortsetzen', exact: true }).click();
  const workspace = page.getByRole('dialog', { name: 'Projekt · Tablet Garden', exact: true });
  await workspace.getByLabel('Projekt-CLI', { exact: true }).waitFor();
  page.off('request', record);
  const config = await desktop.evaluate(() => window.ade.invoke('config:get'));
  const repo = config.repositories.find((item) => item.name === 'Tablet Garden')!;
  const independent = config.projectWorkspaces.find((item) => item.repositoryId === repo.id)!;
  check('lost project reply plus reload creates one repo and waits for explicit CLI choice', config.repositories.filter((item) => item.name === 'Tablet Garden').length === 1
    && repo.rootPath === join(projectRoot, 'tablet-garden') && independent.workspaceDir === repo.rootPath
    && !(await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.some((item) => item.repositoryId === repo.id)
    && keys.length === 2 && !!keys[0] && keys[0] === keys[1]);
  check('new project creates no profile or agent binding', config.agents.length === before.agents.length && config.workspaceBindings.length === before.workspaceBindings.length);
  proxy.loseTerminalReplies(true);
  await workspace.getByRole('button', { name: 'Codex öffnen', exact: true }).click();
  await workspace.getByRole('alert').waitFor();
  await workspace.getByRole('button', { name: 'Terminalaktion erneut prüfen', exact: true }).waitFor(); proxy.loseTerminalReplies(false);
  check('lost terminal reply leaves one real process awaiting explicit recovery', (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.filter((item) => item.repositoryId === repo.id).length === 1);
  await page.reload(); await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await workspace.getByRole('button', { name: 'Terminalaktion erneut prüfen', exact: true }).click();
  await workspace.getByLabel('Terminalanzeige', { exact: true }).getByText('ADE_SESSION_CODEX_READY', { exact: false }).last().waitFor();
  const started = (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.filter((item) => item.repositoryId === repo.id);
  check('Codex opens exact new checkout with no profile and no duplicate after lost reply', started.length === 1 && started[0]!.workspaceDir === repo.rootPath
    && started[0]!.projectWorkspaceId === independent.id && !started[0]!.agentId && !started[0]!.launchProfileId);
  await (await terminalComposer(workspace)).fill("Set-Content -LiteralPath scaffold.txt -Value 'TABLET_SCAFFOLD'");
  await workspace.getByRole('button', { name: 'Text und Enter senden', exact: true }).click();
  await page.waitForFunction(() => (document.querySelector('[aria-label="Terminal-Eingabe"]') as HTMLTextAreaElement)?.value === '');
  const fileDeadline = Date.now() + 15_000;
  while (!existsSync(join(repo.rootPath, 'scaffold.txt')) && Date.now() < fileDeadline) await new Promise((done) => setTimeout(done, 100));
  check('tablet input writes the project scaffold in the real host workspace', readFileSync(join(repo.rootPath, 'scaffold.txt'), 'utf8').includes('TABLET_SCAFFOLD'));
  await (await terminalComposer(workspace)).fill('A prompt to finish later');
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
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: /Weiterarbeiten in Tablet Garden mit Ohne Agent-Profil/ }).click();
  await workspace.getByLabel('Terminalanzeige', { exact: true }).waitFor();
  check('Continue working attaches the existing project session', (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.filter((session) => session.repositoryId === repo.id).length === 1);
  await page.screenshot({ path: join(evidence, 'tablet-project-workspace.png') });
  await (await terminalComposer(workspace)).fill("Write-Output 'INPUT_ACK_CONTROL'");
  proxy.loseInputReplies(true);
  await workspace.getByRole('button', { name: 'Text und Enter senden', exact: true }).click();
  await workspace.getByRole('button', { name: 'Eingabestatus prüfen', exact: true }).waitFor(); proxy.loseInputReplies(false);
  await page.reload(); await workspace.getByLabel('Terminalanzeige', { exact: true }).getByText('INPUT_ACK_CONTROL', { exact: false }).last().waitFor();
  check('reload after a lost input acknowledgement blocks implicit resending', await workspace.getByRole('button', { name: 'Text und Enter senden', exact: true }).isDisabled()
    && await workspace.getByRole('button', { name: 'Ausgabe geprüft · Entwurf freigeben', exact: true }).isVisible());
  await workspace.getByRole('button', { name: 'Ausgabe geprüft · Entwurf freigeben', exact: true }).click();
  await (await terminalComposer(workspace)).fill('');
}
