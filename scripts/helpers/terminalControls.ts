import type { Locator } from 'playwright';

export async function terminalComposer(workspace: Locator): Promise<Locator> {
  const field = workspace.getByLabel('Terminal-Eingabe', { exact: true });
  if (!await field.isVisible()) await workspace.locator('.m-terminal-composer summary').click();
  return field;
}
/** A selected session hides launch and session management behind "Sitzung & Workspace" until expanded. */
export async function expandSessionControls(workspace: Locator): Promise<void> {
  const toggle = workspace.getByRole('button', { name: 'Sitzung & Workspace', exact: true });
  if (await toggle.count() && await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}
/** Project and free terminals start a CLI with one tile; with a session selected the tiles
 * sit behind "Sitzung & Workspace". Names are the tile titles ("Claude Code", "Grok Build"). */
export async function launchTile(workspace: Locator, name: 'Codex' | 'Claude Code' | 'Grok Build' | 'Leeres Terminal'): Promise<Locator> {
  await expandSessionControls(workspace);
  return workspace.locator('.m-launcher').getByRole('button', { name: `${name} öffnen`, exact: true });
}
export async function terminalLauncher(workspace: Locator): Promise<void> {
  const back = workspace.getByRole('button', { name: 'Workspace einblenden', exact: true });
  if (await back.isVisible()) await back.click();
  await expandSessionControls(workspace);
  const details = workspace.locator('.m-terminal-tools > details');
  if (!await details.getAttribute('open').then((value) => value !== null)) await details.locator('summary').first().click();
}
