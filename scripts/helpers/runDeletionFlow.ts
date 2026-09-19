import { join } from 'node:path';
import type { Page } from 'playwright';
import type { mobileTlsProxy } from './mobileBrowser';

/** Delete only completed test runs; exercise the production mobile confirmation and durable retry. */
export async function runDeletionFlow(desktop: Page, phone: Page, proxy: Awaited<ReturnType<typeof mobileTlsProxy>>, evidence: string,
  check: (label: string, ok: boolean) => void): Promise<void> {
  const before = await desktop.evaluate(() => window.ade.invoke('run:getSummary', {}));
  const run = before.find((item) => item.name === 'Tablet question');
  if (!run || run.status !== 'completed') throw new Error('Expected completed question fixture');
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.getByRole('tab', { name: 'Aufträge', exact: true }).click();
  await phone.getByRole('button', { name: 'Run Tablet question', exact: true }).click();
  const remove = phone.getByRole('button', { name: 'Run löschen', exact: true }); await remove.waitFor();
  check('completed run exposes deletion on phone without horizontal overflow', await remove.isEnabled()
    && await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  phone.once('dialog', (dialog) => void dialog.dismiss()); await remove.click();
  check('dismissed confirmation retains completed run', (await desktop.evaluate(() => window.ade.invoke('run:getSummary', {}))).some((item) => item.id === run.id));
  await phone.screenshot({ path: join(evidence, 'phone-run-delete.png') });
  proxy.loseDeleteReplies(true);
  phone.once('dialog', (dialog) => void dialog.accept()); await remove.click();
  const retry = phone.getByRole('button', { name: 'Diesen Auftrag erneut prüfen', exact: true }); await retry.waitFor();
  check('lost deletion response keeps a retry and main already removed the run', !(await desktop.evaluate(() => window.ade.invoke('run:getSummary', {}))).some((item) => item.id === run.id));
  const receiptKey = await phone.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.endsWith(':pending-task'));
    return key ? JSON.parse(localStorage.getItem(key)!).value.key as string : null;
  });
  proxy.loseDeleteReplies(false); await phone.reload();
  await phone.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor(); await retry.waitFor();
  check('phone reload retains exact deletion idempotency key', !!receiptKey && await phone.evaluate((expected) => {
    const key = Object.keys(localStorage).find((item) => item.endsWith(':pending-task'));
    return !!key && JSON.parse(localStorage.getItem(key)!).value.key === expected;
  }, receiptKey));
  await retry.click(); await retry.waitFor({ state: 'hidden' });
  await phone.getByRole('status').filter({ hasText: 'Run gelöscht.' }).waitFor();
  await phone.waitForFunction(() => document.getElementById('view-tab-work') === document.activeElement);
  check('retry confirms deleted run and restores focus to Work navigation', await phone.getByRole('button', { name: 'Run Tablet question', exact: true }).count() === 0);
  const after = await desktop.evaluate(() => window.ade.invoke('run:getSummary', {}));
  check('deletion preserves other desktop runs', after.length === before.length - 1 && after.some((item) => item.name === 'Desktop question'));
  await phone.setViewportSize({ width: 1280, height: 800 });
  await phone.getByRole('button', { name: 'Run Desktop question', exact: true }).click();
  phone.once('dialog', (dialog) => void dialog.accept()); await phone.getByRole('button', { name: 'Run löschen', exact: true }).click();
  await phone.getByRole('button', { name: 'Run Desktop question', exact: true }).waitFor({ state: 'hidden' });
  check('tablet landscape can delete a second completed run', !(await desktop.evaluate(() => window.ade.invoke('run:getSummary', {}))).some((item) => item.name === 'Desktop question'));
  await phone.setViewportSize({ width: 390, height: 844 }); await phone.getByRole('tab', { name: 'Übersicht', exact: true }).click();
}
