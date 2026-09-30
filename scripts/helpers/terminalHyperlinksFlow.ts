import { expect, type Page } from 'playwright/test';

/** Real PTY -> headless parser -> signed host response -> touch/keyboard UI. */
export async function terminalHyperlinksFlow(desktop: Page, tablet: Page, sessionId: string, check: (name: string, ok: boolean) => void) {
  const target = 'https://example.org:8444/knuckles';
  const osc = (href: string, label: string) => `\x1b]8;;${href}\x1b\\${label}\x1b]8;;\x1b\\`;
  const output = '\x1b[2J\x1b[HTablet: ' + osc(target, 'Knuckles Pi öffnen') + '\r\n'
    + osc('http://localhost:5173/', 'Lokaler Server') + '\r\n'
    + osc('file:///home/fixture/private', 'Private Datei') + '\r\n';
  const encoded = Buffer.from(output).toString('base64');
  const command = process.platform === 'win32'
    ? `[Console]::Write([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))\r`
    : `printf '%s' '${encoded}' | base64 --decode\r`;
  await desktop.evaluate(({ sessionId, command }) => window.ade.invoke('pty:write', { sessionId, dataBase64: btoa(command) }), { sessionId, command });
  const project = tablet.getByRole('dialog', { name: 'Projekt · Switch A', exact: true });
  const linksButton = project.getByRole('button', { name: 'Links', exact: true });
  await expect(project.locator('.xterm-rows')).toContainText('Knuckles Pi öffnen');
  await project.locator('.m-terminal-screen').evaluate(node => node.scrollIntoView({ block: 'center' }));
  const label = project.locator('.xterm-rows').getByText('Knuckles Pi öffnen', { exact: true });
  const box = await label.boundingBox(); if (!box) throw new Error('Terminal hyperlink label missing');
  const pagesBefore = tablet.context().pages().length;
  await tablet.touchscreen.tap(box.x + 12, box.y + box.height / 2);
  const dialog = tablet.getByRole('dialog', { name: 'Links im Terminal', exact: true });
  await expect(dialog).toBeVisible();
  check('touching an OSC label shows the exact destination before navigation', (await dialog.innerText()).includes(target)
    && tablet.context().pages().length === pagesBefore && await dialog.getByRole('link').count() === 1);
  check('hyperlink review takes keyboard focus', await dialog.locator('h2').evaluate(node => node === document.activeElement));
  await tablet.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(tablet.url()).origin });
  await dialog.getByRole('button', { name: `Kopieren: ${target}`, exact: true }).click();
  check('named link copies its destination instead of its label', await tablet.evaluate(() => navigator.clipboard.readText()) === target);
  await tablet.context().route(target, route => route.fulfill({ contentType: 'text/html', body: '<p>TABLET_LINK_OK</p>' }));
  const popupPromise = tablet.waitForEvent('popup');
  await dialog.getByRole('link', { name: `Öffnen: ${target}`, exact: true }).tap();
  const popup = await popupPromise; await popup.waitForLoadState('domcontentloaded');
  check('explicit open uses the complete HTTPS port in a separate tab without opener or referrer', popup.url() === target
    && await popup.evaluate(() => window.opener === null && document.referrer === ''));
  await popup.close(); await tablet.keyboard.press('Escape'); await expect(linksButton).toBeFocused();
  check('closing live link review restores focus to Links', true);
  await linksButton.click();
  check('Links includes embedded addresses while file targets remain excluded', (await dialog.innerText()).includes(target)
    && !(await dialog.innerText()).includes('file:') && !(await dialog.innerText()).includes('/home/fixture'));
  check('embedded localhost shows explanation and has no Open action', (await dialog.innerText()).includes('Diese Adresse gehört zum PC')
    && await dialog.locator('a[href*="localhost"]').count() === 0);
  await tablet.keyboard.press('Escape');
  await project.getByRole('button', { name: 'Verlauf', exact: true }).click();
  const historyLink = project.getByLabel('Terminalverlauf lesen', { exact: true }).getByRole('button', { name: 'Knuckles Pi öffnen', exact: true });
  await historyLink.focus(); await tablet.keyboard.press('Enter'); await expect(dialog).toBeVisible();
  await tablet.setViewportSize({ width: 390, height: 780 });
  check('named link review fits narrow tablet/phone layouts', await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
  await dialog.screenshot({ path: 'test-results/terminal-hyperlink-review.png' });
  await tablet.keyboard.press('Escape'); await expect(historyLink).toBeFocused();
  check('history label is keyboard accessible and Escape restores its focus', true);
  await tablet.setViewportSize({ width: 1280, height: 800 });
  await project.getByRole('button', { name: 'Zur Live-Ausgabe', exact: true }).click();
  await tablet.context().unroute(target);
}
