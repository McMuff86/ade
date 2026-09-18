import { join } from 'node:path';
import type { Locator, Page, Request } from 'playwright';

/** Native shell, real transport loss and desktop takeover. No command replay. */
export async function terminalRecoveryFlow(desktop: Page, page: Page, panel: Locator, evidence: string, check: (label: string, ok: boolean) => void) {
  const sessions = () => desktop.evaluate(() => window.ade.invoke('pty:list'));
  const shell = (await sessions()).sessions.find(session => session.projectWorkspaceId && session.status === 'running' && session.launchChoice?.mode === 'shell')!;
  const direct = panel.getByLabel('Direkte Terminal-Eingabe', { exact: true });
  const composer = panel.locator('.m-terminal-composer > details');
  const draft = panel.getByLabel('Terminal-Eingabe', { exact: true });
  const recovery = panel.getByLabel('Terminalverbindung', { exact: true });
  const viewport = page.viewportSize()!;
  const writable = (value: boolean) => page.waitForFunction(wanted => {
    const input = document.querySelector<HTMLTextAreaElement>('[aria-label="Direkte Terminal-Eingabe"]');
    return input && input.readOnly !== wanted;
  }, value);
  const reachable = (control: Locator) => control.evaluate(node => {
    const box = node.getBoundingClientRect(); return box.width >= 44 && box.height >= 44 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= 420;
  });
  const packets: string[] = [];
  const record = (request: Request) => {
    if (request.url().endsWith('/api/v1/terminal/input')) {
      const body = request.postDataJSON(); if (body.data) packets.push(body.data);
    }
  };
  await composer.locator('summary').click(); await draft.fill('Mein ungesendeter Entwurf'); await composer.locator('summary').click();
  try {
    await page.setViewportSize({ width: 390, height: 844 }); await direct.focus();
    await page.evaluate(() => { Object.defineProperty(visualViewport!, 'height', { configurable: true, value: 420 }); visualViewport!.dispatchEvent(new Event('resize')); });
    await panel.locator('.m-keyboard-compact').waitFor();
    const infoButton = panel.getByRole('button', { name: 'Workspace-Info', exact: true });
    check('workspace info remains reachable at phone width with the keyboard open', await reachable(infoButton));
    await infoButton.press('Enter');
    const info = page.getByRole('dialog', { name: 'Workspace-Info', exact: true }); await info.waitFor();
    check('workspace info takes focus and identifies project and branch without a host path', await info.evaluate(node => node.contains(document.activeElement))
      && await info.getByText('Latency', { exact: true }).isVisible() && await info.getByText('main', { exact: true }).isVisible()
      && !/[A-Z]:\\/i.test(await info.innerText()));
    await page.keyboard.press('Escape'); await info.waitFor({ state: 'hidden' });
    check('closing workspace info returns focus without closing the project', await infoButton.evaluate(node => node === document.activeElement) && await direct.isVisible());
    await page.context().setOffline(true); await writable(false);
    const reconnect = recovery.getByRole('button', { name: 'Erneut verbinden', exact: true }); await reconnect.waitFor();
    check('offline explanation and reconnect action stay in the keyboard viewport', await reachable(reconnect)
      && (await recovery.innerText()).includes('Eingabe pausiert'));
    await desktop.evaluate(sessionId => window.ade.invoke('terminal:reclaim', { sessionId }), shell.id);
    // Exercise retry while the connection is still down. Restoring the network
    // also resumes automatically and can otherwise remove the button mid-click.
    await reconnect.click(); await page.context().setOffline(false);
    const claim = recovery.getByRole('button', { name: 'Eingabe übernehmen', exact: true }); await claim.waitFor();
    check('reconnect preserves desktop ownership until explicit tablet takeover', await direct.evaluate(node => (node as HTMLTextAreaElement).readOnly) && await reachable(claim));
    await page.screenshot({ path: join(evidence, 'terminal-recovery-phone.png') });
    await claim.click(); await writable(true);
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Direkte Terminal-Eingabe');
    check('takeover restores focus and reuses exactly the same running shell', (await sessions()).sessions.filter(session => session.projectWorkspaceId === shell.projectWorkspaceId && session.status === 'running').map(session => session.id).join() === shell.id);
    await page.route('**/api/v1/terminal/query', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unavailable', message: 'Display unavailable' } }) }));
    await writable(false);
    const reload = recovery.getByRole('button', { name: 'Anzeige erneut laden', exact: true }); await reload.waitFor();
    page.on('request', record); await direct.focus(); await page.keyboard.type('ADE_BLIND_PROBE'); await page.waitForTimeout(400);
    check('failed screen queries block direct keys and special keys without blocking shell close', packets.length === 0
      && await panel.getByRole('button', { name: 'Terminaltaste Enter', exact: true }).isDisabled()
      && !await panel.getByRole('button', { name: 'Shell beenden', exact: true }).isDisabled() && await reachable(reload));
    await reload.click(); await page.unroute('**/api/v1/terminal/query'); await writable(true);
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Direkte Terminal-Eingabe');
    check('display recovery does not replay keys typed while paused', packets.length === 0);
    await page.keyboard.type('git status'); await page.keyboard.press('Enter');
    await panel.locator('.xterm-rows').getByText('On branch main', { exact: false }).first().waitFor();
    check('recovered native shell executes the deliberate command exactly once', packets.join('') === 'git status\r');
    page.off('request', record);
    await page.evaluate(() => { Reflect.deleteProperty(visualViewport!, 'height'); visualViewport!.dispatchEvent(new Event('resize')); });
    await composer.locator('summary').click();
    check('unsent local draft survives transport loss and display failure', await draft.inputValue() === 'Mein ungesendeter Entwurf');
    await draft.fill(''); await composer.locator('summary').click();
  } finally {
    page.off('request', record); await page.context().setOffline(false); await page.unroute('**/api/v1/terminal/query');
    await page.evaluate(() => { Reflect.deleteProperty(visualViewport!, 'height'); visualViewport!.dispatchEvent(new Event('resize')); });
    await page.setViewportSize(viewport);
  }
}
