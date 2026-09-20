import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { expect } from 'playwright/test';
import { mobileTlsProxy } from './mobileBrowser';

/** Same UI/host path with either the deterministic CLI peer or installed Codex.
 * Native mode is explicitly selected by the driver; no audio is generated. */
export async function casualConversationFlow(desktop: Page, port: number, profileId: string, evidence: string,
  check: (name: string, ok: boolean) => void, native = false) {
  for (let i = 0; i < 3 && await desktop.getByRole('dialog').count(); i++) await desktop.keyboard.press('Escape');
  const projectId = (await desktop.evaluate(profileId => window.ade.invoke('conversation:command', { operation: 'create', commandId: 'casual-proof-project', profileId }), profileId)).conversationId;
  await desktop.evaluate(() => window.ade.invoke('mobileAccess:setEnabled', { enabled: true }));
  const pairing = await desktop.evaluate(() => window.ade.invoke('mobileAccess:pair'));
  const proxy = await mobileTlsProxy(); proxy.target(port); proxy.rewriteOrigin('https://ade-mobile.fixture.ts.net');
  const browser = await chromium.launch({ args: ['--ignore-certificate-errors', '--host-resolver-rules=MAP ade-mobile.fixture.ts.net 127.0.0.1'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, hasTouch: true, ignoreHTTPSErrors: true }); page.setDefaultTimeout(20_000);
  try {
    await page.goto(`${proxy.origin}/#pair=${pairing.code}`);
    await page.getByLabel('Gerätename', { exact: true }).fill('Casual conversation tablet');
    await page.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
    const device = (await desktop.evaluate(() => window.ade.invoke('remoteDevices:list'))).devices.find(d => d.name === 'Casual conversation tablet')!;
    await desktop.evaluate(deviceId => window.ade.invoke('remoteDevices:setAdminScopes', { deviceId, scopes: ['workspace:read'], resourceAccess: { mode: 'all' } }), device.id);
    const open = async (target: Page, opener: string) => {
      await target.locator(opener).click(); await target.locator('#conversation-mode-casual').click();
      return target.getByRole('dialog', { name: 'Plaudern & Stimme', exact: true });
    };
    let dialog = await open(page, '#mobile-supervision');
    await dialog.getByText('Noch kein ADE-Gespräch.', { exact: false }).waitFor();
    check('tablet casual dialog receives focus and has its own empty history', await dialog.evaluate(node => node.contains(document.activeElement))
      && !(await dialog.locator(`option[value="${projectId}"]`).count()));
    await dialog.getByLabel('Gesprächsprofil', { exact: true }).selectOption(profileId);
    await dialog.getByRole('button', { name: 'Neues freies Gespräch', exact: true }).click();
    await expect(dialog.getByLabel('Nachricht an ADE', { exact: true })).toBeEditable();
    const id = await dialog.getByLabel('Gespräch auswählen', { exact: true }).inputValue();
    const detail = () => desktop.evaluate(id => window.ade.invoke('conversation:detail', { conversationId: id }), id);
    check('tablet creates casual history on the PC before launching Codex', (await detail()).mode === 'casual' && (await detail()).model === null);
    const marker = `TABLET_CASUAL_${randomUUID().replaceAll('-', '')}`;
    const send = async (target: typeof dialog, text: string) => {
      await target.getByLabel('Nachricht an ADE', { exact: true }).fill(text);
      await target.getByRole('button', { name: 'An ADE senden', exact: true }).click();
    };
    await send(dialog, native ? `Remember this marker: ${marker}. Reply only with that exact marker.` : `remember:${marker}`);
    await expect.poll(async () => (await detail()).turns.at(-1)?.status, { timeout: native ? 180_000 : 20_000 }).toBe('completed');
    const first = await detail();
    await dialog.getByText(native ? marker : 'Recorded', { exact: true }).waitFor();
    check('tablet first message completes through the PC conversation launcher', first.turns.length === 1 && first.model === (native ? 'gpt-5.6-sol' : 'fixture-observed'));
    check('tablet receives answer and private input metadata without the submitted prompt', !(await dialog.locator('.conversation-history').innerText()).includes(native ? 'Remember this marker:' : 'remember:'));
    await page.reload(); await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor(); dialog = await open(page, '#mobile-supervision');
    await expect(dialog.getByLabel('Gespräch auswählen', { exact: true })).toHaveValue(id);
    check('tablet reload preserves its selected casual conversation without resending', (await detail()).turns.length === 1);
    const pc = await open(desktop, '#desktop-supervision');
    await pc.getByLabel('Gespräch auswählen', { exact: true }).selectOption(id);
    await send(pc, native ? 'Reply only with the exact marker from my previous message.' : 'recall');
    await expect.poll(async () => (await detail()).turns.at(-1)?.status, { timeout: native ? 180_000 : 20_000 }).toBe('completed');
    await expect.poll(async () => (await detail()).turns.length).toBe(2);
    check('desktop continues the exact tablet context with the selected profile', (await detail()).turns[1]!.output.trim() === marker);
    await expect(dialog.locator('.conversation-turn').last().locator('.conversation-text').last()).toHaveText(marker);
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 850 });
      check(`casual dialog fits ${width}px`, await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1 && node.getBoundingClientRect().right <= innerWidth + 1));
    }
    await dialog.screenshot({ path: join(evidence, native ? 'casual-tablet-native.png' : 'casual-tablet.png') });
    await page.keyboard.press('Escape'); await expect(page.locator('#mobile-supervision')).toBeFocused();
    check('Escape returns tablet focus to conversations', true);
    await pc.getByRole('button', { name: 'Gespräch beenden', exact: true }).click();
    await expect(pc.getByRole('button', { name: 'An ADE senden', exact: true })).toBeDisabled();
    check('closing casual conversation keeps both answers and does not touch project history', (await detail()).closed
      && (await desktop.evaluate(id => window.ade.invoke('conversation:detail', { conversationId: id }), projectId)).turns.length === 0);
  } catch (error) {
    await page.screenshot({ path: join(evidence, 'casual-tablet-failure.png') }); throw error;
  } finally { await browser.close(); await proxy.close(); }
}
