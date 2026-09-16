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
export async function terminalLauncher(workspace: Locator): Promise<void> {
  const back = workspace.getByRole('button', { name: 'Workspace einblenden', exact: true });
  if (await back.isVisible()) await back.click();
  await expandSessionControls(workspace);
  const details = workspace.locator('.m-terminal-tools > details');
  if (!await details.getAttribute('open').then((value) => value !== null)) await details.locator('summary').first().click();
}
