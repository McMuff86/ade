import { join } from 'node:path';
import type { Locator, Page } from 'playwright';

/** Exercise the actual project header with a live, signed terminal connection. */
export async function projectContextLayoutFlow(page: Page, dialog: Locator, evidence: string, check: (name: string, ok: boolean) => void): Promise<void> {
  const toggle = dialog.locator('.m-project-context-toggle');
  const context = dialog.locator('.m-project-context');
  const screen = dialog.getByLabel('Terminalanzeige', { exact: true });
  await page.setViewportSize({ width: 1400, height: 900 });
  await context.waitFor({ state: 'visible' });
  const sessionControls = dialog.getByRole('button', { name: 'Sitzung & Workspace', exact: true });
  if (await sessionControls.getAttribute('aria-expanded') === 'true') await sessionControls.click();
  const terminalNode = await screen.elementHandle();
  const expanded = (await screen.boundingBox())!;
  const actions = (await dialog.getByRole('button', { name: 'Terminal', exact: true }).boundingBox())!;
  const refresh = (await dialog.getByRole('button', { name: 'Workspace aktualisieren', exact: true }).boundingBox())!;
  const branches = dialog.locator('.project-branches > summary');
  const branchBounds = (await branches.boundingBox())!;
  check('tablet puts project tabs, refresh and collapsed branches on one row', Math.abs(actions.y - refresh.y) < 2 && Math.abs(actions.y - branchBounds.y) < 2);
  await page.screenshot({ path: join(evidence, 'project-context-expanded.png') });
  await toggle.focus(); await toggle.press('Enter');
  await context.waitFor({ state: 'hidden' });
  const collapsed = (await screen.boundingBox())!;
  check('keyboard collapse gives real height to the terminal and retains toggle focus', collapsed.height > expanded.height + 60
    && collapsed.y < expanded.y - 60 && await toggle.getAttribute('aria-expanded') === 'false'
    && await toggle.evaluate(node => node === document.activeElement));
  check('collapsed project keeps its title and terminal ownership visible', await dialog.getByRole('heading', { name: 'Projekt · Without profile', exact: true }).isVisible()
    && await dialog.locator('.m-dialog-head .m-terminal-owner').isVisible());
  check('collapse retains the existing terminal element rather than restarting its view', !!terminalNode && await terminalNode.evaluate(node => node.isConnected));
  await terminalNode?.dispose();
  const info = dialog.getByRole('button', { name: 'Workspace-Info', exact: true });
  await info.click();
  await page.getByRole('dialog', { name: 'Workspace-Info', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  check('workspace information remains accessible while collapsed and returns focus', await info.evaluate(node => node === document.activeElement) && !await context.isVisible());
  await page.screenshot({ path: join(evidence, 'project-context-collapsed.png') });
  await page.reload(); await toggle.waitFor(); await screen.waitFor();
  check('project context preference survives reload with the terminal still available', await toggle.getAttribute('aria-expanded') === 'false' && !await context.isVisible());
  for (const viewport of [{ width: 800, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    check(`collapsed project fits ${viewport.width}px with reachable restore control`, await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)
      && await toggle.isVisible() && (await toggle.boundingBox())!.height >= 44);
  }
  await page.screenshot({ path: join(evidence, 'project-context-phone.png') });
  await toggle.focus(); await toggle.press('Space'); await context.waitFor({ state: 'visible' });
  check('Space restores the project navigation without horizontal overflow', await toggle.getAttribute('aria-expanded') === 'true'
    && await dialog.getByRole('button', { name: 'Git', exact: true }).isVisible() && await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
  await page.setViewportSize({ width: 1400, height: 900 });
  await branches.focus(); await branches.press('Enter');
  await dialog.getByLabel('Projekt-Branch', { exact: true }).waitFor();
  check('compact branch control still opens its full-width keyboard-accessible panel', (await dialog.locator('.project-branches').boundingBox())!.width > 1000);
  await branches.press('Enter');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === 'ade-mobile-project-context-collapsed') throw new Error('fixture quota'); original.call(this, key, value); };
  });
  await toggle.click(); await context.waitFor({ state: 'hidden' });
  await toggle.click(); await context.waitFor({ state: 'visible' });
  check('unavailable preference storage leaves collapse and restore usable', await toggle.getAttribute('aria-expanded') === 'true');
  await page.reload(); await toggle.waitFor(); await screen.waitFor();
  check('final positive control restores the expanded project and live terminal', await context.isVisible() && await screen.isVisible());
}
