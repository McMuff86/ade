import { join } from 'node:path';
import { expect, type Page } from 'playwright/test';

/** Existing real fixture PTYs across original checkout and parallel branch. */
export async function cliWorkFlow(page: Page, evidence: string, workspaceId: string, parallelId: string, check: (name: string, ok: boolean) => void): Promise<void> {
  const inventory = async () => (await page.evaluate(() => window.ade.invoke('pty:list'))).sessions;
  const before = await inventory();
  const original = before.find(session => session.projectWorkspaceId === workspaceId && session.launchChoice?.mode === 'claude')!;
  const parallel = before.find(session => session.projectWorkspaceId === parallelId && session.launchChoice?.mode === 'grok')!;
  const shell = before.find(session => session.projectWorkspaceId === parallelId && session.launchChoice?.mode === 'shell')!;
  const profile = before.find(session => session.projectWorkspaceId === workspaceId && session.launchProfileId)!;
  const work = page.getByRole('tab', { name: 'Work view', exact: true });
  await work.click();
  const panel = page.getByRole('region', { name: 'CLI-Arbeit', exact: true });
  const row = (id: string) => panel.locator(`li[data-session-id="${id}"]`);
  await row(parallel.id).waitFor();
  check('Work includes original CLI, parallel CLI and empty shell without synthetic runs', await row(original.id).isVisible() && await row(shell.id).isVisible()
    && (await page.evaluate(() => window.ade.invoke('run:get'))).runs.length === 0);
  check('real PTY metadata captures native runtime, worktree and original folder', original.runtime === 'claude' && original.workspaceKind === 'checkout'
    && parallel.runtime === 'grok' && parallel.workspaceKind === 'worktree' && parallel.executionBackend === 'native');
  check('plain CLI shows no invented model or profile', !original.launchModel && !original.launchProfileId && !(await row(original.id).innerText()).includes('Startmodell:'));
  check('finished CLI remains an open shell in Work', (await row(original.id).innerText()).includes('beendet · Terminal offen'));
  check('CLI row identifies exact branch and separate workspace', (await row(parallel.id).innerText()).includes('Worktree · feature/parallel')
    && (await row(original.id).innerText()).includes('Originalordner · feature/tablet'));
  await page.getByLabel('Projektfilter', { exact: true }).selectOption(original.repositoryId!);
  await expect(panel.locator('li')).toHaveCount(4);
  check('Work project filter separates original and parallel work from other projects', await row(original.id).isVisible() && await row(parallel.id).isVisible());
  await page.getByLabel('Agentfilter', { exact: true }).selectOption(profile.launchProfileId!);
  await expect(panel.locator('li')).toHaveCount(1);
  check('Work profile filter includes project launch profile without fixed binding', await panel.locator('li').count() === 1 && await row(profile.id).isVisible());
  await page.getByLabel('Agentfilter', { exact: true }).selectOption('');
  await page.getByLabel('Projektfilter', { exact: true }).selectOption('');
  await panel.getByLabel('CLI-Filter', { exact: true }).selectOption('Grok Build');
  check('CLI filter chooses Grok across projects', await row(parallel.id).isVisible() && await row(original.id).count() === 0);
  await panel.getByLabel('CLI-Filter', { exact: true }).selectOption('');
  await panel.getByLabel('CLI-Arbeit durchsuchen', { exact: true }).fill('feature/parallel');
  check('search finds both terminals on parallel branch', await panel.locator('li').count() === 2 && await row(shell.id).isVisible());
  await panel.getByLabel('CLI-Arbeit durchsuchen', { exact: true }).fill('no-such-task');
  await panel.getByRole('heading', { name: 'Keine passenden CLI-Sitzungen', exact: true }).waitFor();
  check('empty filtered list offers a useful recovery state', await panel.getByText('Suche oder Filter ändern.', { exact: true }).isVisible());
  await panel.getByLabel('CLI-Arbeit durchsuchen', { exact: true }).fill('');
  const rename = row(parallel.id).getByRole('button', { name: /^Arbeit benennen:/ });
  await rename.click(); const dialog = page.getByRole('dialog', { name: 'CLI-Arbeit benennen', exact: true });
  check('rename dialog takes keyboard focus', await dialog.evaluate(node => node.contains(document.activeElement)));
  await dialog.getByLabel('Arbeitstitel', { exact: true }).fill('Layout parallel prüfen');
  await dialog.getByRole('button', { name: 'Titel speichern', exact: true }).click();
  check('rename returns focus to opener and preserves session identity', await rename.evaluate(node => node === document.activeElement)
    && (await row(parallel.id).innerText()).includes('Layout parallel prüfen'));
  await page.reload(); await row(parallel.id).waitFor();
  check('work title survives renderer reload without another PTY', (await row(parallel.id).innerText()).includes('Layout parallel prüfen') && (await inventory()).length === before.length);
  await row(parallel.id).getByRole('button', { name: /^Sitzung öffnen:/ }).focus();
  await page.keyboard.press('Enter');
  const terminal = page.getByRole('region', { name: 'Projekt-Terminal', exact: true });
  await terminal.locator(`#project-session-tab-${parallel.id}[aria-selected="true"]`).waitFor();
  check('keyboard activation opens the exact parallel session', await page.getByRole('heading', { name: /Projekt ·/ }).isVisible() && (await inventory()).length === before.length);
  await work.click(); await row(original.id).getByRole('button', { name: /^Sitzung öffnen:/ }).click();
  await terminal.locator(`#project-session-tab-${original.id}[aria-selected="true"]`).waitFor();
  check('switching to original project selects original CLI without restart', (await inventory()).map(session => session.id).sort().join() === before.map(session => session.id).sort().join());
  await page.getByRole('tab', { name: 'Overview view', exact: true }).click();
  await row(parallel.id).waitFor();
  check('Overview and Work share the same session titles and identifiers', (await row(parallel.id).innerText()).includes('Layout parallel prüfen'));
  await panel.getByLabel('CLI-Projektfilter', { exact: true }).selectOption(original.repositoryId!);
  check('Overview project filter keeps all four original/parallel sessions', await panel.locator('li').count() === 4);
  await page.setViewportSize({ width: 760, height: 900 });
  check('CLI work panel remains within narrow viewport', await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
  await page.screenshot({ path: join(evidence, 'cli-work-overview.png') });
  await page.setViewportSize({ width: 1400, height: 900 });
  await row(original.id).getByRole('button', { name: /^Sitzung öffnen:/ }).click();
  await terminal.locator(`#project-session-tab-${original.id}[aria-selected="true"]`).waitFor();
  check('Overview returns to exact original terminal without a duplicate process', (await inventory()).length === before.length);
}
