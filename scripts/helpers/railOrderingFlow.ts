import type { Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** Real IPC persistence, grouped ordering, keyboard focus and existing drag/drop. */
export async function railOrderingFlow(page: Page, check: (label: string, ok: boolean) => void): Promise<void> {
  const fixture = await page.evaluate(async () => {
    const original = (await window.ade.invoke('config:get')).categories.map((cat) => cat.id);
    const first = await window.ade.invoke('category:create', { name: 'Order First', navigationGroup: 'Order Group' });
    const loose = await window.ade.invoke('category:create', { name: 'Order Loose' });
    const second = await window.ade.invoke('category:create', { name: 'Order Second', navigationGroup: 'Order Group' });
    const agents = [];
    for (const name of ['Order Alpha', 'Order Beta']) agents.push(await window.ade.invoke('agent:create', {
      categoryId: first.id, name, runtime: 'shell', permissionMode: 'default', defaultRepositoryId: null,
    }));
    return { original, first, second, loose, agents };
  });
  const rail = page.getByRole('navigation', { name: 'Categories and agents', exact: true });
  const button = (name: string) => rail.getByRole('button', { name, exact: true });
  const settled = () => rail.getByRole('status').filter({ hasText: 'Reihenfolge gespeichert.' }).waitFor();
  await button('Anordnen').click();
  await button('Order Group nach unten').focus();
  await page.keyboard.press('Enter'); await settled();
  let config = await page.evaluate(() => window.ade.invoke('config:get'));
  check('rail moves an entire group after the loose project', config.categories.slice(-3).map((cat) => cat.id).join() === [fixture.loose.id, fixture.first.id, fixture.second.id].join());
  check('rail keeps keyboard focus at the ordering boundary', await button('Order Group nach unten').evaluate((node) => node === document.activeElement)
    && await button('Order Group nach unten').getAttribute('aria-disabled') === 'true');
  await button('Order First nach unten').click(); await settled();
  config = await page.evaluate(() => window.ade.invoke('config:get'));
  check('rail reorders projects inside the group without moving its root', config.categories.slice(-3).map((cat) => cat.id).join() === [fixture.loose.id, fixture.second.id, fixture.first.id].join());
  await button('Order Alpha nach unten').focus(); await page.keyboard.press('Space'); await settled();
  config = await page.evaluate(() => window.ade.invoke('config:get'));
  check('rail reorders agents with the keyboard', config.categories.find((cat) => cat.id === fixture.first.id)!.agents.join() === fixture.agents.map((agent) => agent.id).reverse().join());
  await page.keyboard.press('Escape');
  check('Escape ends ordering and returns focus to its opener', await button('Anordnen').evaluate((node) => node === document.activeElement));
  await page.reload(); await button('Anordnen').waitFor();
  check('saved project and agent order survives a renderer reload', (await rail.locator('.cat-name').allTextContents()).slice(-3).join() === 'Order Loose,Order Second,Order First'
    && (await rail.locator('.agent-name').allTextContents()).filter((name) => name.startsWith('Order ')).join() === 'Order Beta,Order Alpha');
  await button('Anordnen').click();
  await rail.getByRole('searchbox').fill('Order Alpha');
  check('filtered navigation hides ordering controls', await button('Order Alpha nach oben').count() === 0);
  await rail.getByRole('searchbox').fill('');
  await button('Order Loose nach unten').click(); await settled();
  check('loose projects can move past a complete group', (await rail.locator('.cat-name').allTextContents()).slice(-3).join() === 'Order Second,Order First,Order Loose');
  const source = rail.locator('.agent-entry').filter({ hasText: 'Order Alpha' });
  const target = rail.locator('.agent-entry').filter({ hasText: 'Order Beta' });
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  const box = (await target.boundingBox())!;
  await source.dispatchEvent('dragstart', { dataTransfer: transfer });
  await target.dispatchEvent('dragover', { dataTransfer: transfer, clientY: box.y + 1 });
  check('agent drag shows an insertion marker', (await target.getAttribute('class'))!.includes('drop-before'));
  await target.dispatchEvent('drop', { dataTransfer: transfer, clientY: box.y + 1 }); await settled();
  await transfer.dispose();
  config = await page.evaluate(() => window.ade.invoke('config:get'));
  check('agent drag persists the requested position', config.categories.find((cat) => cat.id === fixture.first.id)!.agents.join() === fixture.agents.map((agent) => agent.id).join());
  const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await page.setViewportSize({ width: 900, height: 700 });
  check('ordering controls fit the desktop rail at a narrow viewport', await rail.evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
  check('narrow ordering leaves room for project names', await rail.locator('.cat-name').evaluateAll((nodes) => nodes.every((node) => node.getBoundingClientRect().width >= 45)));
  mkdirSync(resolve('test-results/rail-ordering'), { recursive: true });
  await rail.screenshot({ path: resolve('test-results/rail-ordering/narrow.png') });
  await page.setViewportSize(viewport);
  await page.keyboard.press('Escape');
  await page.evaluate(async ({ original, first, second, loose, agents }) => {
    for (const agent of agents) await window.ade.invoke('agent:delete', { id: agent.id });
    for (const cat of [first, second, loose]) await window.ade.invoke('category:delete', { id: cat.id });
    await window.ade.invoke('category:reorder', { orderedIds: original });
  }, fixture);
  await page.reload();
}
