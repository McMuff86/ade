import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { expect } from 'playwright/test';
import { mobileTlsProxy } from './mobileBrowser';
import { conversationVoiceFlow } from './conversationVoiceFlow';

/** Paired browser -> signed host API -> the desktop's actual conversation
 * service and native protocol peer. No PTY or provider model is involved. */
export async function conversationMobileFlow(desktop: Page, port: number, profileId: string, evidence: string, check: (name: string, ok: boolean) => void) {
  for (let i = 0; i < 3 && await desktop.getByRole('dialog').count(); i++) await desktop.keyboard.press('Escape');
  await desktop.evaluate(() => window.ade.invoke('mobileAccess:setEnabled', { enabled: true }));
  const pairing = await desktop.evaluate(() => window.ade.invoke('mobileAccess:pair'));
  const proxy = await mobileTlsProxy(); proxy.target(port); proxy.rewriteOrigin('https://ade-mobile.fixture.ts.net');
  // Full Chromium provides media capture; the separate headless-shell build
  // rejects it even with a granted permission (same driver as terminal dictation).
  const browser = await chromium.launch({ channel: 'chromium', args: ['--ignore-certificate-errors', '--use-fake-device-for-media-stream', '--host-resolver-rules=MAP ade-mobile.fixture.ts.net 127.0.0.1'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 1000 }, hasTouch: true, ignoreHTTPSErrors: true }); page.setDefaultTimeout(20_000);
  try {
    await page.context().grantPermissions(['microphone'], { origin: proxy.origin });
    await page.goto(`${proxy.origin}/#pair=${pairing.code}`); await page.getByLabel('Gerätename', { exact: true }).fill('Conversation tablet');
    await page.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
    const deviceId = (await desktop.evaluate(() => window.ade.invoke('remoteDevices:list'))).devices.find(d => d.name === 'Conversation tablet')!.id;
    const grant = async (all: boolean) => desktop.evaluate(({ deviceId, all }) => window.ade.invoke('remoteDevices:setAdminScopes', { deviceId, scopes: ['workspace:read', 'dictation:transcribe'], resourceAccess: all ? { mode: 'all' } : { mode: 'selected', agentIds: [], repositoryIds: [] } }), { deviceId, all });
    const open = async () => { await page.locator('#mobile-supervision').click(); await page.locator('#conversation-mode-project').click(); await page.locator('#mobile-conversation-open').click(); return page.getByRole('dialog', { name: 'ADE-Gespräch', exact: true }); };
    let dialog = await open();
    await dialog.getByRole('alert').filter({ hasText: 'vollständige Projektfreigabe' }).waitFor();
    check('tablet global dialog explains required access before exposing history', !(await dialog.locator('.conversation-turn').count()));
    await grant(true); await dialog.getByRole('button', { name: 'Gespräch aktualisieren', exact: true }).click();
    await dialog.getByLabel('Gesprächsprofil', { exact: true }).selectOption(profileId);
    const before = (await desktop.evaluate(() => window.ade.invoke('conversation:get'))).length;
    proxy.loseConversationReplies(true);
    await dialog.getByRole('button', { name: 'Neues ADE-Gespräch', exact: true }).click();
    await desktop.waitForFunction(async count => (await window.ade.invoke('conversation:get')).length === count + 1, before);
    await page.reload(); proxy.loseConversationReplies(false);
    await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor(); dialog = await open();
    await dialog.getByRole('button', { name: 'Neues Gespräch erneut prüfen', exact: true }).click();
    await expect(dialog.getByLabel('Nachricht an ADE', { exact: true })).toBeEditable();
    const id = await dialog.getByLabel('Gespräch auswählen', { exact: true }).inputValue();
    check('tablet reload recovers lost creation with one conversation and no PTY', (await desktop.evaluate(() => window.ade.invoke('conversation:get'))).length === before + 1 && !(await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.length);
    const otherId = (await desktop.evaluate(() => window.ade.invoke('conversation:get'))).find(c => c.id !== id && c.available && !c.closed)!.id;
    await conversationVoiceFlow(page, otherId, check, 'tablet voice');
    const send = async (text: string) => { await dialog.getByLabel('Nachricht an ADE', { exact: true }).fill(text); await dialog.getByRole('button', { name: 'An ADE senden', exact: true }).click(); };
    proxy.loseConversationReplies(true); await send('remember:TABLET_OWN_CONTEXT');
    await desktop.waitForFunction(async id => (await window.ade.invoke('conversation:detail', { conversationId: id })).turns[0]?.status === 'completed', id);
    await page.reload(); proxy.loseConversationReplies(false);
    await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor(); dialog = await open();
    await dialog.getByRole('button', { name: 'Vorgang erneut prüfen', exact: true }).click();
    await expect(dialog.getByLabel('Nachricht an ADE', { exact: true })).toHaveValue('');
    check('lost send acknowledgement recovers the original command without a second model turn', (await desktop.evaluate(id => window.ade.invoke('conversation:detail', { conversationId: id }), id)).turns.length === 1);
    check('remote history shows private input metadata instead of retrieving the user prompt', !(await dialog.locator('.conversation-history').innerText()).includes('remember:TABLET_OWN_CONTEXT'));
    await send('question'); await dialog.getByText('Womit beginnen?', { exact: true }).waitFor();
    await dialog.getByLabel('Deine Antwort', { exact: true }).fill('Tablet briefing'); await dialog.getByRole('button', { name: 'Antwort senden', exact: true }).click();
    await dialog.getByText('Antwort empfangen', { exact: true }).waitFor();
    check('tablet answers the exact central native question', (await desktop.evaluate(id => window.ade.invoke('conversation:detail', { conversationId: id }), id)).turns.at(-1)!.questions[0].status === 'answered');
    await desktop.locator('#desktop-supervision').click(); await desktop.locator('#conversation-mode-project').click(); await desktop.locator('#ade-conversation-open').click();
    const desktopDialog = desktop.getByRole('dialog', { name: 'ADE-Gespräch', exact: true });
    await desktopDialog.getByLabel('Gespräch auswählen', { exact: true }).selectOption(id);
    await desktopDialog.getByLabel('Nachricht an ADE', { exact: true }).fill('recall'); await desktopDialog.getByRole('button', { name: 'An ADE senden', exact: true }).click();
    await dialog.getByText('TABLET_OWN_CONTEXT', { exact: true }).waitFor();
    check('desktop continues the tablet conversation in the same native context', (await desktop.evaluate(id => window.ade.invoke('conversation:detail', { conversationId: id }), id)).turns.length === 3);
    await send('long-answer'); await dialog.getByText(/Final sentence of complete answer/).waitFor();
    check('tablet renders every answer page and redacts host paths', await dialog.locator('.conversation-turn').last().locator('.conversation-text').last().innerText()
      === 'Beginning of complete answer\n' + '語😀'.repeat(6000) + '\n[path]\nFinal sentence of complete answer');
    for (const width of [800, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      check(`paired conversation fits ${width}px with touch-sized controls`, await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1 && node.getBoundingClientRect().right <= innerWidth + 1 && [...node.querySelectorAll('button')].every(b => b.getBoundingClientRect().height >= 44)));
      await dialog.evaluate(node => { node.scrollTop = 0; }); await dialog.screenshot({ path: join(evidence, `mobile-conversation-${width}.png`) });
    }
    await send('hold'); await dialog.getByText('ADE arbeitet', { exact: true }).waitFor();
    await page.keyboard.press('Escape'); await expect(page.locator('#mobile-supervision')).toBeFocused();
    check('closing tablet dialog leaves its active conversation running', (await desktop.evaluate(id => window.ade.invoke('conversation:detail', { conversationId: id }), id)).turns.at(-1)!.status === 'working');
    dialog = await open(); await dialog.getByRole('button', { name: 'Antwort unterbrechen', exact: true }).click();
    await dialog.getByText('Unterbrochen', { exact: true }).waitFor();
    check('tablet interrupt reaches native acknowledgement without ending other conversations', (await desktop.evaluate(id => window.ade.invoke('conversation:detail', { conversationId: id }), id)).turns.at(-1)!.status === 'interrupted');
    await grant(false); await dialog.getByRole('alert').filter({ hasText: 'vollständige Projektfreigabe' }).waitFor();
    check('revoked resource scope removes the displayed conversation history', !(await dialog.locator('.conversation-turn').count()));
    await grant(true); await dialog.getByRole('button', { name: 'Gespräch aktualisieren', exact: true }).click();
    await dialog.getByRole('button', { name: 'Gespräch beenden', exact: true }).click();
    await desktop.waitForFunction(async id => (await window.ade.invoke('conversation:detail', { conversationId: id })).closed, id);
    await dialog.getByRole('button', { name: 'Zur Projektbetreuung', exact: true }).click(); await expect(page.locator('#mobile-conversation-open')).toBeFocused();
    check('final restored grant allows closing the conversation and returns focus to its opener', true);
  } catch (error) {
    console.error('Mobile conversation state:', await page.locator('.conversation-voice').innerText().catch(() => 'not mounted'));
    await page.screenshot({ path: join(evidence, 'mobile-conversation-failure.png') }); throw error;
  }
  finally { await browser.close(); await proxy.close(); }
}
