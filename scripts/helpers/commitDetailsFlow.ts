import type { Locator, Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export async function commitDetailsFlow(page: Page, workspace: Locator, sha: string, check: (label: string, ok: boolean) => void): Promise<void> {
  const opener = workspace.getByRole('button', { name: /Review tablet history/ });
  const detail = workspace.getByRole('region', { name: 'Commit-Details', exact: true });
  const heading = detail.getByRole('heading', { name: `Commit ${sha.slice(0, 8)}`, exact: true });
  await opener.focus(); await page.keyboard.press('Enter'); await heading.waitFor();
  check('commit opens from keyboard and receives heading focus', await heading.evaluate(node => node === document.activeElement));
  check('tablet commit shows full message, author, dates and line counts', (await detail.innerText()).includes('Why this layout changed.')
    && (await detail.innerText()).includes('Tablet Author') && await detail.locator('time').count() === 2
    && (await detail.innerText()).includes('+2 Zeilen hinzugefügt') && (await detail.innerText()).includes('−1 Zeilen entfernt'));
  await detail.getByRole('button', { name: /history.txt/ }).tap();
  const diff = detail.getByLabel('Commit-Diff', { exact: true }); await diff.waitFor();
  check('touch opens the committed diff with additions and deletions', (await diff.innerText()).includes('+after') && (await diff.innerText()).includes('-before'));
  check('commit file heading receives focus for keyboard readers', await detail.getByRole('heading', { name: 'history.txt', exact: true }).evaluate(node => node === document.activeElement));
  mkdirSync(resolve('test-results/remote'), { recursive: true });
  await page.screenshot({ path: resolve('test-results/remote/commit-details-tablet.png') });
  await detail.getByRole('button', { name: /badge.bin/ }).tap();
  await detail.getByText(/Binärdatei geändert/).waitFor();
  check('binary commit files explain why no text diff exists', await diff.count() === 0);
  await page.keyboard.press('Escape'); await detail.waitFor({ state: 'hidden' });
  check('Escape leaves workspace open and restores commit-list focus', await workspace.isVisible() && await opener.evaluate(node => node === document.activeElement));

  let failOperation = 'commit';
  await page.route('**/api/v1/workspace/query', async route => {
    if (route.request().postDataJSON()?.operation === failOperation) {
      failOperation = '';
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'fixture_unavailable', message: 'Commit-Test: vorübergehend nicht verfügbar.' }) });
    } else await route.continue();
  });
  await opener.tap(); await workspace.getByRole('button', { name: 'Details erneut laden', exact: true }).waitFor();
  check('commit query failure offers an explicit retry', await workspace.getByRole('alert').filter({ hasText: 'Commit-Test' }).isVisible());
  await workspace.getByRole('button', { name: 'Details erneut laden', exact: true }).click(); await heading.waitFor();
  failOperation = 'commit-file';
  await detail.getByRole('button', { name: /history.txt/ }).tap();
  await detail.getByRole('button', { name: 'Änderung erneut laden', exact: true }).waitFor();
  check('patch failure preserves the commit metadata', await heading.isVisible() && (await detail.innerText()).includes('Tablet Author'));
  await detail.getByRole('button', { name: 'Änderung erneut laden', exact: true }).click(); await diff.waitFor();
  await page.unroute('**/api/v1/workspace/query');
  check('final retry reads the real committed file again', (await diff.innerText()).includes('+after'));
  await page.setViewportSize({ width: 390, height: 844 });
  check('phone commit detail fits horizontally and replaces the list', await workspace.evaluate(node => node.scrollWidth <= node.clientWidth + 1)
    && !await workspace.getByRole('region', { name: 'Geänderte Dateien', exact: true }).isVisible());
  await page.screenshot({ path: resolve('test-results/remote/commit-details-phone.png') });
  await detail.getByRole('button', { name: 'Zurück zur Liste', exact: true }).click();
  check('phone can return to the commit list', await opener.isVisible());
  await page.setViewportSize({ width: 1024, height: 768 });
  let release!: () => void; let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/api/v1/workspace/query', async route => {
    if (route.request().postDataJSON()?.operation === 'commit') { started(); await gate; }
    await route.continue();
  });
  await opener.click(); await pending;
  check('slow commit requests show a loading state', await workspace.getByRole('status').filter({ hasText: 'Workspace wird geladen' }).isVisible());
  await workspace.getByRole('button', { name: 'Dateien', exact: true }).click();
  const completed = page.waitForResponse(response => response.url().endsWith('/api/v1/workspace/query') && response.request().postDataJSON()?.operation === 'commit');
  release(); await (await completed).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  check('late commit responses cannot replace the file tab after navigation', await detail.count() === 0
    && await workspace.getByRole('region', { name: 'Workspace-Dateien', exact: true }).isVisible());
  await page.unroute('**/api/v1/workspace/query');
  await workspace.getByRole('button', { name: 'Git-Änderungen', exact: true }).click();
  await opener.click(); await heading.waitFor();
  check('commit details remain usable after cancelling a pending selection', await heading.isVisible());
  await detail.getByRole('button', { name: 'Zurück zur Liste', exact: true }).click();
}
