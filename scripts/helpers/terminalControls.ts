import type { Locator } from 'playwright';

export async function terminalComposer(workspace: Locator): Promise<Locator> {
  const field = workspace.getByLabel('Terminal-Eingabe', { exact: true });
  if (!await field.isVisible()) await workspace.locator('.m-terminal-composer summary').click();
  return field;
}
export async function terminalLauncher(workspace: Locator): Promise<void> {
  const back = workspace.getByRole('button', { name: 'Workspace einblenden', exact: true });
  if (await back.isVisible()) await back.click();
  const details = workspace.locator('.m-terminal-tools > details');
  if (!await details.getAttribute('open').then((value) => value !== null)) await details.locator('summary').first().click();
}
