import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { terminalLauncher } from './terminalControls';
import type { mobileTlsProxy } from './mobileBrowser';

export async function workspaceAssignmentFlow(desktop: Page, page: Page, proxy: Awaited<ReturnType<typeof mobileTlsProxy>>, root: string, evidence: string, check: (name: string, ok: boolean) => void) {
  for (const window of [desktop, page]) for (let i = 0; i < 5 && await window.locator('[role="dialog"],dialog[open]').count(); i++) await window.keyboard.press('Escape');
  await desktop.evaluate(async () => { for (const session of (await window.ade.invoke('pty:list')).sessions) if (session.status === 'running') await window.ade.invoke('pty:kill', { sessionId: session.id }); });
  const parent = join(root, 'assignment-projects'); const directory = join(parent, 'Layout assignment'); mkdirSync(directory, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-C', directory, ...args], { windowsHide: true });
  git('init', '--initial-branch=feature/existing'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-m', 'Original project');
  writeFileSync(join(directory, 'original.txt'), 'Original layout workspace.\n');
  await desktop.evaluate((rootPath) => window.ade.invoke('projectDefaults:save', { rootPath, agentId: null }), parent);
  const devices = await desktop.evaluate(() => window.ade.invoke('remoteDevices:list'));
  const device = devices.devices.find((item) => item.name === 'Terminal tablet')!;
  await desktop.evaluate((deviceId) => window.ade.invoke('remoteDevices:setAdminScopes', { deviceId, scopes: ['workspace:read', 'workspace:write', 'catalog:write', 'terminal:control'], resourceAccess: { mode: 'all' } }), device.id);
  const before = await desktop.evaluate(() => window.ade.invoke('config:get'));
  const agent = before.agents.find((item) => item.name === 'Terminal Agent')!;
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.getByRole('tab', { name: 'Terminals', exact: true }).click();
  await page.getByRole('complementary', { name: 'Agents und Terminals', exact: true }).getByRole('button', { name: 'Terminal Agent', exact: true }).click();
  const project = page.getByLabel('Terminal-Projekt', { exact: true });
  check('terminal dropdown explicitly offers project browsing', await project.locator('option[value="@browse"]').count() === 1);
  await project.selectOption('@browse');
  const dialog = page.getByRole('dialog', { name: 'Workspace-Zuweisung prüfen', exact: true });
  const find = dialog.getByLabel('Projekte suchen', { exact: true }); await find.waitFor();
  await dialog.getByRole('button', { name: 'Projekt prüfen · Layout assignment', exact: true }).waitFor();
  check('browse dialog takes focus and includes unregistered project', await dialog.evaluate((node) => node.contains(document.activeElement))
    && await dialog.getByRole('button', { name: 'Projekt prüfen · Layout assignment', exact: true }).count() === 1);
  await find.fill('does-not-exist'); await dialog.getByText('Keine passenden Projektordner gefunden.', { exact: false }).waitFor();
  check('project search explains empty matches', true); await find.fill('Layout assignment');
  await dialog.getByRole('button', { name: 'Projekt prüfen · Layout assignment', exact: true }).click();
  await dialog.getByRole('heading', { name: 'Prüfergebnis · Layout assignment', exact: true }).waitFor();
  check('project preview receives focus and leaves catalog and files unchanged', await dialog.getByRole('heading', { name: 'Prüfergebnis · Layout assignment', exact: true }).evaluate((node) => node === document.activeElement)
    && (await desktop.evaluate(() => window.ade.invoke('config:get'))).repositories.length === before.repositories.length
    && readFileSync(join(directory, 'original.txt'), 'utf8') === 'Original layout workspace.\n');
  await page.screenshot({ path: join(evidence, 'workspace-assignment-tablet.png') });
  const keys: string[] = [];
  const record = (request: import('playwright').Request) => { if (request.url().endsWith('/api/v1/workspace/assignment/command')) keys.push(request.headers()['idempotency-key'] ?? ''); };
  page.on('request', record);
  proxy.loseAssignmentReplies(true);
  await dialog.getByRole('button', { name: 'Workspace zuweisen', exact: true }).click();
  await dialog.getByRole('button', { name: 'Zuweisungsstatus prüfen', exact: true }).waitFor();
  await dialog.getByRole('alert').waitFor();
  proxy.loseAssignmentReplies(false);
  const assignedBeforeReply = await desktop.evaluate(() => window.ade.invoke('config:get'));
  const targetWorkspace = assignedBeforeReply.projectWorkspaces.find((item) => item.workspaceDir === directory);
  check('lost assignment reply still creates one main-owned association', !!targetWorkspace && assignedBeforeReply.workspaceAssignments.filter((item) => item.agentId === agent.id && item.projectWorkspaceId === targetWorkspace.id).length === 1);
  await page.reload(); await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await page.getByRole('button', { name: 'Projekte durchsuchen', exact: true }).click();
  await dialog.getByRole('button', { name: 'Zuweisungsstatus prüfen', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); page.off('request', record);
  const config = await desktop.evaluate(() => window.ade.invoke('config:get'));
  const assignment = config.workspaceAssignments.find((item) => item.agentId === agent.id)!;
  check('reload recovers same-key assignment without duplicate registration', keys.length === 2 && !!keys[0] && keys[0] === keys[1]
    && config.repositories.length === before.repositories.length + 1 && config.projectWorkspaces.some((item) => item.id === assignment.projectWorkspaceId && item.workspaceDir === directory));
  check('assigned project becomes the current terminal selection', await project.inputValue() === assignment.repositoryId);
  check('confirmed assignment restores focus to the browser opener', await page.getByRole('button', { name: 'Projekte durchsuchen', exact: true }).evaluate((node) => node === document.activeElement));
  await page.getByRole('button', { name: 'Dateien und Agent-Profil', exact: true }).click();
  const workspace = page.getByRole('dialog', { name: 'Workspace · Terminal Agent', exact: true });
  await workspace.getByText('Belegung beim Aktualisieren: Nicht belegt', { exact: false }).waitFor();
  check('workspace status distinguishes assignment from occupancy', await workspace.getByText('Zuordnung: Projektordner', { exact: false }).isVisible()
    && !((await workspace.innerText()).includes('Workspace frei')));
  await workspace.getByRole('button', { name: 'original.txt', exact: true }).click();
  await workspace.getByLabel('Dateivorschau', { exact: true }).filter({ hasText: 'Original layout workspace.' }).waitFor();
  check('agent file view uses the assigned original project', true);
  await workspace.getByRole('button', { name: 'Datei bearbeiten', exact: true }).click();
  await workspace.getByRole('textbox', { name: 'Datei bearbeiten', exact: true }).fill('Edited in assigned project.\n');
  await workspace.getByRole('button', { name: 'Datei speichern', exact: true }).click();
  await workspace.getByRole('textbox', { name: 'Datei bearbeiten', exact: true }).waitFor({ state: 'hidden' });
  await workspace.getByRole('button', { name: 'original.txt', exact: true }).waitFor();
  check('file save follows the assigned project scope', readFileSync(join(directory, 'original.txt'), 'utf8') === 'Edited in assigned project.\n');
  await workspace.getByRole('button', { name: 'Workspace-Zuweisung prüfen', exact: true }).click(); await dialog.waitFor();
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  check('cancelled assignment dialog returns focus to its workspace opener', await workspace.getByRole('button', { name: 'Workspace-Zuweisung prüfen', exact: true }).evaluate((node) => node === document.activeElement));
  await page.keyboard.press('Escape'); await workspace.waitFor({ state: 'hidden' });
  const terminal = page.getByRole('region', { name: 'Interaktives Terminal', exact: true });
  await terminalLauncher(terminal); await terminal.getByLabel('Sitzung starten mit', { exact: true }).selectOption('codex');
  await terminal.getByRole('button', { name: 'Sitzung starten', exact: true }).click();
  await terminal.getByLabel('CLI- und Terminalstatus', { exact: true }).filter({ hasText: 'beendet · Terminal offen' }).waitFor();
  check('terminal CLI executes in the assigned original folder', readFileSync(join(directory, 'session-launch-proof.txt'), 'utf8').includes('ADE_SESSION_CODEX_READY'));
  await page.getByRole('button', { name: 'Projekte durchsuchen', exact: true }).click();
  await dialog.getByLabel('Projekte suchen', { exact: true }).fill('Layout assignment');
  await dialog.getByRole('button', { name: 'Projekt prüfen · Layout assignment', exact: true }).click();
  await dialog.getByText('Im bisherigen oder gewählten Workspace läuft ein Terminal.', { exact: false }).waitFor();
  check('active workspace terminal prevents reassignment in UI', await dialog.getByRole('button', { name: 'Workspace zuweisen', exact: true }).isDisabled());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(evidence, 'workspace-assignment-phone.png') });
  check('workspace browsing and preview fit phone width', await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1 && node.getBoundingClientRect().right <= innerWidth));
  await page.keyboard.press('Escape');
  const after = await desktop.evaluate(() => window.ade.invoke('config:get'));
  check('final positive control preserves original managed bindings and user file', JSON.stringify(after.workspaceBindings) === JSON.stringify(before.workspaceBindings)
    && readFileSync(join(directory, 'original.txt'), 'utf8') === 'Edited in assigned project.\n');
}
