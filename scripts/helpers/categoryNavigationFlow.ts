import { join } from 'node:path';
import type { Page } from 'playwright';
import type { Agent, Category } from '../../src/shared/types';

export async function categoryNavigationFlow(desktop: Page, page: Page, evidence: string, check: (name: string, ok: boolean) => void) {
  for (const window of [desktop, page]) for (let i = 0; i < 5 && await window.locator('[role="dialog"],dialog[open]').count(); i++) await window.keyboard.press('Escape');
  const created = await desktop.evaluate(async () => {
    const rows: Array<{ category: Category; agent: Agent }> = [];
    for (const [categoryName, agentName] of [['Navigation Hermes', 'Navigation Hermes General'], ['Navigation OpenClaw', 'Navigation Sentinel'], ['Navigation Grok', 'Navigation GrokMain']]) {
      const category = await window.ade.invoke('category:create', { name: categoryName!, ...(rows.length ? { navigationGroup: 'Agent-Systeme' } : {}) });
      const agent = await window.ade.invoke('agent:create', { categoryId: category.id, name: agentName!, runtime: 'shell', permissionMode: 'default', defaultRepositoryId: null });
      rows.push({ category, agent });
    }
    const devices = await window.ade.invoke('remoteDevices:list');
    await window.ade.invoke('remoteDevices:setAdminScopes', { deviceId: devices.devices.find((item) => item.name === 'Terminal tablet')!.id,
      scopes: ['catalog:write', 'workspace:read', 'workspace:write', 'terminal:control'], resourceAccess: { mode: 'all' } });
    return rows;
  });
  await desktop.reload();
  await desktop.getByRole('button', { name: 'Kategorie-Einstellungen für Navigation Hermes', exact: true }).click();
  const edit = desktop.getByRole('dialog', { name: 'Kategorie-Einstellungen', exact: true });
  await edit.getByLabel('Obergruppe', { exact: true }).fill('Agent-Systeme');
  await edit.getByRole('button', { name: 'Speichern', exact: true }).click(); await edit.waitFor({ state: 'hidden' });
  const group = desktop.getByRole('region', { name: 'Agent-Systeme', exact: true });
  await group.getByRole('button', { name: 'Kategorie-Einstellungen für Navigation Hermes', exact: true }).waitFor();
  check('desktop groups existing categories without replacing agent profiles', await group.locator('.agent-row').count() === 3);
  check('category save returns focus to the moved settings opener', await group.getByRole('button', { name: 'Kategorie-Einstellungen für Navigation Hermes', exact: true }).evaluate((node) => node === document.activeElement));
  const toggle = group.getByRole('button', { name: 'Agent-Systeme', exact: false }).first();
  await toggle.focus(); await desktop.keyboard.press('Enter');
  check('desktop group supports keyboard collapse', await group.locator('.agent-row').count() === 0);
  await desktop.reload();
  check('desktop collapsed group survives reload', await group.locator('.agent-row').count() === 0);
  await desktop.getByRole('searchbox', { name: 'Agents suchen', exact: true }).fill('Navigation Hermes General');
  check('search reveals matching agent through collapsed parents', await group.locator('.agent-row').count() === 1);
  await desktop.getByRole('searchbox', { name: 'Agents suchen', exact: true }).fill('');
  await toggle.click();
  await page.setViewportSize({ width: 1400, height: 900 }); await page.reload();
  await page.getByRole('tab', { name: 'Terminals', exact: true }).click();
  const rail = page.getByRole('complementary', { name: 'Agents und Terminals', exact: true });
  const mobileGroup = rail.getByRole('region', { name: 'Agent-Systeme', exact: true });
  await mobileGroup.getByRole('button', { name: 'Navigation Hermes General', exact: true }).waitFor();
  check('mobile displays the same group, category and profile hierarchy', await mobileGroup.getByRole('region').count() === 3);
  await mobileGroup.getByRole('button', { name: 'Agent-Systeme', exact: false }).first().click(); await page.reload();
  await rail.getByRole('searchbox', { name: 'Agents suchen', exact: true }).waitFor();
  check('mobile collapsed group survives reload', await mobileGroup.getByRole('button', { name: 'Navigation Hermes General', exact: true }).count() === 0);
  await rail.getByRole('searchbox', { name: 'Agents suchen', exact: true }).fill('Navigation Hermes General');
  await mobileGroup.getByRole('button', { name: 'Navigation Hermes General', exact: true }).click();
  check('mobile search can select an agent hidden inside a collapsed group', await page.getByRole('heading', { name: 'Navigation Hermes General', exact: true }).isVisible());
  await rail.getByRole('searchbox', { name: 'Agents suchen', exact: true }).fill('');
  await page.getByRole('button', { name: 'Verwalten', exact: true }).click();
  const manager = page.getByRole('dialog', { name: 'Projekte und Agents verwalten', exact: true });
  const saveGroup = async () => {
    const [response] = await Promise.all([
      page.waitForResponse((reply) => reply.url().endsWith('/api/v1/admin/commands') && reply.request().method() === 'POST'),
      manager.getByRole('button', { name: 'Obergruppe speichern', exact: true }).click(),
    ]);
    const result = await response.json() as { error?: string };
    if (!response.ok()) throw new Error(`Category save failed: HTTP ${response.status()} ${result.error ?? 'unknown'}`);
  };
  await manager.getByRole('button', { name: 'Agenten', exact: true }).click();
  await manager.getByLabel('Kategorie für Obergruppe', { exact: true }).selectOption(created[0]!.category.id);
  await manager.getByLabel('Obergruppe', { exact: true }).fill('Remote Agents');
  await saveGroup();
  await desktop.getByRole('region', { name: 'Remote Agents', exact: true }).locator('.agent-row', { hasText: 'Navigation Hermes General' }).waitFor();
  check('mobile grouping updates desktop navigation through catalog event', true);
  await manager.getByLabel('Obergruppe', { exact: true }).fill('Agent-Systeme');
  await saveGroup();
  await desktop.getByRole('region', { name: 'Agent-Systeme', exact: true }).locator('.agent-row', { hasText: 'Navigation Hermes General' }).waitFor();
  await page.keyboard.press('Escape'); await manager.waitFor({ state: 'hidden' });
  check('mobile group manager restores opener focus', await page.getByRole('button', { name: 'Verwalten', exact: true }).evaluate((node) => node === document.activeElement));
  await rail.getByRole('searchbox', { name: 'Agents suchen', exact: true }).fill('Agent-Systeme');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Agents und Sitzungen', exact: true }).click();
  await page.screenshot({ path: join(evidence, 'category-navigation-phone.png') });
  check('nested navigation fits a phone viewport', await rail.evaluate((node) => node.scrollWidth <= node.clientWidth + 1 && node.getBoundingClientRect().right <= innerWidth));
  const after = await desktop.evaluate(() => window.ade.invoke('config:get'));
  check('final grouping preserves category memberships and agent identities', created.every(({ agent, category }) => after.agents.some((item) => item.id === agent.id && item.categoryId === category.id)
    && after.categories.some((item) => item.id === category.id && item.navigationGroup === 'Agent-Systeme' && item.agents.includes(agent.id))));
}
