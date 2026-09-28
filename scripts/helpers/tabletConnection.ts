import type { Page } from 'playwright';

/**
 * Reconnects the tablet the way a person does since the status footer moved
 * into the connection pill: open the pill's dialog and choose "Erneut
 * verbinden", which the dialog offers in every state and which closes it.
 */
export async function reconnectTablet(page: Page): Promise<void> {
  await page.locator('.m-titlebar .m-connection').click();
  const dialog = page.getByRole('dialog', { name: 'Verbindung zum PC', exact: true });
  await dialog.getByRole('button', { name: 'Erneut verbinden', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
}
