import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright';
import { supervisionFlow } from './supervisionFlow';

export async function sessionNavigationFlow(desktop: Page, tablet: Page, root: string, check: (name: string, ok: boolean) => void): Promise<void> {
  const evidence = resolve('test-results/main-agent-planning'); mkdirSync(evidence, { recursive: true });
  const parent = join(root, 'switch-projects'); mkdirSync(parent);
  for (const name of ['Switch A', 'Switch B', 'Switch C']) {
    const repo = join(parent, name); mkdirSync(repo);
    execFileSync('git', ['init', '--initial-branch=main', repo], { windowsHide: true });
    execFileSync('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-m', 'Fixture'], { windowsHide: true });
  }
  const sessions = await desktop.evaluate(async rootPath => {
    await window.ade.invoke('projectDefaults:save', { rootPath, agentId: null });
    const { directory } = await window.ade.invoke('project:query', { operation: 'directory' });
    const result = [];
    for (const name of ['Switch A', 'Switch B', 'Switch C']) {
      const entry = directory!.entries.find(item => item.name === name)!;
      const { workspace } = await window.ade.invoke('project:command', { operation: 'open', entryId: entry.id });
      const session = await window.ade.invoke('session:launch', { projectWorkspaceId: workspace.id, expectedBranch: workspace.branch, mode: 'shell' });
      result.push({ id: session.id, workspaceId: workspace.id, repositoryId: workspace.repositoryId, createdAt: session.createdAt, name });
    }
    const extra = await window.ade.invoke('session:launch', { projectWorkspaceId: result[0]!.workspaceId, expectedBranch: 'main', mode: 'shell' });
    result.push({ id: extra.id, workspaceId: result[0]!.workspaceId, repositoryId: result[0]!.repositoryId, createdAt: extra.createdAt, name: 'Switch A' });
    return result;
  }, parent);
  const count = (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.length;
  await desktop.keyboard.press('Escape'); await tablet.keyboard.press('Escape');
  const pickDesktop = async (index: number) => {
    const target = sessions[index]!;
    await desktop.getByRole('button', { name: 'Arbeit wechseln', exact: true }).click();
    const chooser = desktop.getByRole('dialog', { name: 'Arbeit wechseln', exact: true });
    await chooser.locator(`[data-session-id="${target.id}"]`).click();
    await desktop.getByRole('heading', { name: `Projekt · ${target.name}`, exact: true }).waitFor();
    await desktop.locator(`#project-session-tab-${target.id}[aria-selected="true"]`).waitFor();
  };
  await pickDesktop(0);
  await desktop.waitForFunction(() => {
    const screen = document.querySelector('.project-terminal [role="tabpanel"]:not([hidden]) .xterm-screen');
    const box = screen?.getBoundingClientRect(); const header = document.querySelector('.titlebar')?.getBoundingClientRect();
    return box && header && box.top >= header.bottom && box.top < window.innerHeight && window.scrollY === 0;
  });
  check('explicit session navigation reveals the selected terminal without scrolling away the global header', true);
  await desktop.getByRole('button', { name: 'Prompt / Diktat', exact: true }).click();
  await desktop.getByLabel('CLI-Promptentwurf', { exact: true }).fill('Desktop draft A');
  await desktop.keyboard.press('Escape');
  for (let round = 0; round < 10; round++) for (const index of [1, 2, 0]) await pickDesktop(index);
  check('desktop switches three projects ten times without another process', (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.length === count);
  await desktop.getByRole('button', { name: 'Prompt / Diktat', exact: true }).click();
  check('desktop returns to its target-bound draft', await desktop.getByLabel('CLI-Promptentwurf', { exact: true }).inputValue() === 'Desktop draft A');
  await desktop.keyboard.press('Escape'); await pickDesktop(3); await pickDesktop(0);
  check('switcher selects the exact session within the same project', await desktop.locator(`#project-session-tab-${sessions[0]!.id}`).getAttribute('aria-selected') === 'true');
  await desktop.getByRole('button', { name: 'Arbeit wechseln', exact: true }).click();
  await desktop.getByRole('dialog', { name: 'Arbeit wechseln', exact: true }).getByLabel('Sitzungen durchsuchen').fill('no matching session');
  check('switcher explains an empty search', await desktop.getByText('Keine passende Sitzung. Suche ändern.', { exact: true }).isVisible());
  await desktop.keyboard.press('Escape');
  check('desktop switcher Escape returns focus to its opener', await desktop.getByRole('button', { name: 'Arbeit wechseln', exact: true }).evaluate(node => node === document.activeElement));

  await tablet.reload();
  await tablet.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await tablet.keyboard.press('Escape');
  // The host intentionally exposes opaque remote IDs, never its internal PTY IDs.
  const inventoryResponse = tablet.waitForResponse(response => response.url().endsWith('/api/v1/terminal/sessions') && response.ok());
  await tablet.locator('#mobile-session-switch').click();
  const inventory = await (await inventoryResponse).json() as import('../../src/shared/remote').MobileSessionInventory;
  await tablet.keyboard.press('Escape');
  const remoteIds = sessions.map(session => {
    const found = inventory.sessions.find(item => item.projectName === session.name && item.createdAt === session.createdAt);
    if (!found) throw new Error(`Missing authorized fixture session: ${session.name}`);
    return found.id;
  });
  const pickTablet = async (index: number) => {
    const target = sessions[index]!;
    // The project dialog exposes the same action within the modal's focus boundary.
    const project = tablet.locator('dialog[open].m-independent-project');
    const opener = await project.count() ? project.getByRole('button', { name: 'Arbeit wechseln', exact: true }) : tablet.locator('#mobile-session-switch');
    await opener.click();
    const chooser = tablet.getByRole('dialog', { name: 'Arbeit wechseln', exact: true });
    await chooser.locator(`[data-session-id="${remoteIds[index]}"]`).click();
    const next = tablet.getByRole('dialog', { name: `Projekt · ${target.name}`, exact: true });
    await next.waitFor();
    await next.getByLabel('Terminal-Sitzung', { exact: true }).waitFor({ state: 'attached' });
    await tablet.waitForFunction(id => document.querySelector<HTMLSelectElement>('dialog[open].m-independent-project [aria-label="Terminal-Sitzung"]')?.value === id, remoteIds[index]);
  };
  await tablet.setViewportSize({ width: 1280, height: 800 });
  await pickTablet(0);
  const project = tablet.getByRole('dialog', { name: 'Projekt · Switch A', exact: true });
  const ownBefore = await desktop.evaluate(id => window.ade.invoke('terminal:control', { sessionId: id }), sessions[0]!.id);
  check('tablet navigation alone does not take desktop input', !ownBefore.remote);
  await project.getByRole('button', { name: 'Eingabe übernehmen', exact: true }).click();
  await project.getByLabel('CLI-Promptentwurf', { exact: true }).fill('Tablet draft A');
  for (let round = 0; round < 10; round++) for (const index of [1, 2, 0]) await pickTablet(index);
  check('tablet switches three projects ten times without another process', (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.length === count);
  if (await project.getByRole('button', { name: 'Eingabe übernehmen', exact: true }).count()) await project.getByRole('button', { name: 'Eingabe übernehmen', exact: true }).click();
  check('tablet draft returns only to its original session', await project.getByLabel('CLI-Promptentwurf', { exact: true }).inputValue() === 'Tablet draft A');
  await pickTablet(3); await pickTablet(0);
  check('tablet also selects the exact sibling session', true);
  for (const viewport of [{ width: 800, height: 1280 }, { width: 390, height: 844 }]) {
    await tablet.setViewportSize(viewport); await pickTablet(1);
    const current = tablet.getByRole('dialog', { name: 'Projekt · Switch B', exact: true });
    await current.getByRole('button', { name: 'Arbeit wechseln', exact: true }).click();
    const chooser = tablet.getByRole('dialog', { name: 'Arbeit wechseln', exact: true });
    check(`session chooser fits ${viewport.width}px viewport`, await chooser.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    check(`session target is touch sized at ${viewport.width}px`, (await chooser.locator('[data-session-id]').first().boundingBox())!.height >= 44);
    await chooser.screenshot({ path: join(evidence, `session-switcher-${viewport.width}.png`) });
    await tablet.keyboard.press('Escape');
    check(`nested chooser restores project opener at ${viewport.width}px`, await current.getByRole('button', { name: 'Arbeit wechseln', exact: true }).evaluate(node => node === document.activeElement));
  }
  await tablet.reload(); await tablet.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await pickTablet(0);
  check('reload reattaches instead of relaunching a project session', (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.length === count);
  await supervisionFlow(desktop, sessions, check, tablet);
  for (const session of sessions) await desktop.evaluate(sessionId => window.ade.invoke('pty:kill', { sessionId }), session.id);
}
