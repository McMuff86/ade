import { join } from 'node:path';
import type { Locator, Page } from 'playwright';

/** Chromium's actual IME event path against a native shell and signed host API.
 * A physical Samsung keyboard remains a separate device check. */
export async function terminalInputEchoFlow(desktop: Page, page: Page, panel: Locator, evidence: string, check: (label: string, ok: boolean) => void) {
  const sessions = () => desktop.evaluate(() => window.ade.invoke('pty:list'));
  const shell = (await sessions()).sessions.find((session) => session.projectWorkspaceId && session.launchChoice?.mode === 'shell')!;
  const input = panel.getByLabel('Direkte Terminal-Eingabe', { exact: true });
  const screen = panel.getByLabel('Terminalanzeige', { exact: true });
  const end = panel.getByRole('button', { name: 'Shell beenden', exact: true });
  const rows = screen.locator('.xterm-rows');
  await rows.getByText('[path]>', { exact: false }).first().waitFor();
  await input.focus();
  const beforeCursor = () => screen.locator('.xterm-cursor').evaluate((node) => {
    const range = document.createRange(); range.selectNodeContents(node.parentElement!); range.setEndBefore(node);
    return range.toString().replace(/\u00a0/g, ' ');
  });
  check('shell cursor follows the redacted prompt and its input space', /\[path\]> $/.test(await beforeCursor()));
  check('shell end action shares the collapsed editor row with the keyboard closed', await end.evaluate((node) => {
    const button = node.getBoundingClientRect();
    const editor = node.closest('.m-terminal-composer')!.querySelector(':scope > details')!.getBoundingClientRect();
    return button.height >= 44 && button.width >= 44 && button.bottom <= innerHeight && Math.abs(button.top - editor.top) < 2;
  }));
  const cdp = await page.context().newCDPSession(page);
  const viewport = page.viewportSize()!;
  try {
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 420 });
      window.visualViewport!.dispatchEvent(new Event('resize'));
    });
    await panel.locator('.m-keyboard-compact').waitFor();
    check('keyboard resize retains direct-input focus', await input.evaluate((node) => document.activeElement === node));
    await cdp.send('Input.imeSetComposition', { text: 'git status', selectionStart: 10, selectionEnd: 10 });
    const composition = screen.locator('.composition-view.active'); await composition.waitFor();
    check('uncommitted touchscreen text is visible before Enter', await composition.textContent() === 'git status');
    check('IME preview sits at the visible shell cursor inside the terminal', await screen.evaluate((node) => {
      const cursor = node.querySelector('.xterm-cursor')!.getBoundingClientRect();
      const preview = node.querySelector('.composition-view.active')!.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      return Math.abs(preview.left - cursor.left) < 2 && Math.abs(preview.top - cursor.top) < 2
        && preview.left >= box.left && preview.right <= box.right && preview.top >= box.top && preview.bottom <= box.bottom;
    }));
    await page.screenshot({ path: join(evidence, 'terminal-shell-ime-preview.png') });
    await cdp.send('Input.insertText', { text: 'git status' });
    await rows.getByText(/\[path\]> git status/).first().waitFor();
    await composition.waitFor({ state: 'hidden' });
    check('committed touchscreen text reaches the native shell once before Enter', /\[path\]> git status$/.test(await beforeCursor()));
    await page.keyboard.press('Enter');
    await rows.getByText('On branch main', { exact: false }).first().waitFor();
    check('Enter executes the visible command and shows native Git output', (await rows.textContent())?.includes('nothing to commit') === true);
    await input.focus();
    await cdp.send('Input.imeSetComposition', { text: 'pwd', selectionStart: 3, selectionEnd: 3 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => {
      const live = document.querySelector('.m-terminal-live')!;
      const screen = live.querySelector('.xterm-screen')!;
      return screen.getBoundingClientRect().width <= live.getBoundingClientRect().width + 1;
    });
    await composition.waitFor();
    // Remote resize and the final shell prompt can render in adjacent frames.
    await page.waitForFunction(() => {
      const preview = document.querySelector('.composition-view.active')?.getBoundingClientRect();
      const cursor = document.querySelector('.xterm-cursor')?.getBoundingClientRect();
      return preview && cursor && Math.abs(preview.left - cursor.left) < 2 && Math.abs(preview.top - cursor.top) < 2;
    }, undefined, { timeout: 5000 });
    check('phone resize retains IME text at the visible cursor in the keyboard viewport', await composition.evaluate((node) => {
      const box = node.getBoundingClientRect(); const screen = node.closest('.m-terminal-screen')!.getBoundingClientRect();
      const cursor = node.closest('.m-terminal-screen')!.querySelector('.xterm-cursor')!.getBoundingClientRect();
      return node.textContent === 'pwd' && Math.abs(box.left - cursor.left) < 2 && Math.abs(box.top - cursor.top) < 2
        && box.left >= screen.left && box.right <= screen.right && box.top >= screen.top && box.bottom <= 420;
    }));
    await page.screenshot({ path: join(evidence, 'terminal-shell-ime-phone.png') });
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    await page.keyboard.press('Control+c');
    check('shell end action remains directly visible at phone width with keyboard open', await end.evaluate((node) => {
      const box = node.getBoundingClientRect(); return box.height >= 44 && box.width >= 44 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= 420;
    }));
    // Ctrl+C is still being acknowledged by the real PTY; click waits until the
    // existing input/command lock enables the control again.
    await end.click();
    const confirmation = page.getByRole('dialog', { name: 'Terminalsitzung beenden', exact: true }); await confirmation.waitFor();
    check('shell close requires confirmation and moves focus into its dialog', await confirmation.evaluate((node) => node.contains(document.activeElement))
      && (await sessions()).sessions.some((session) => session.id === shell.id && session.status === 'running'));
    await page.keyboard.press('Escape'); await confirmation.waitFor({ state: 'hidden' });
    check('cancelling close returns focus to the shell action and keeps the process running', await end.evaluate((node) => node === document.activeElement)
      && (await sessions()).sessions.some((session) => session.id === shell.id && session.status === 'running'));
    await end.press('Enter'); await confirmation.getByRole('button', { name: 'Beenden bestätigen', exact: true }).click();
    await screen.waitFor({ state: 'hidden' });
    const launch = panel.locator('.m-terminal-focus-bar .m-primary'); await launch.waitFor();
    // The close receipt removes the screen before the scheduled focus handoff.
    await page.waitForFunction(() => document.activeElement?.matches('.m-terminal-focus-bar .m-primary'), undefined, { timeout: 5000 }).catch(async (error) => {
      console.log('Close focus diagnostics', await page.evaluate(() => ({ active: document.activeElement?.outerHTML.slice(0, 700), launchers: [...document.querySelectorAll('.m-terminal-focus-bar .m-primary')].map((node) => ({ html: node.outerHTML, rect: node.getBoundingClientRect().toJSON(), inert: !!node.closest('[inert]') })) })));
      await page.screenshot({ path: join(evidence, 'terminal-close-focus.png') }); throw error;
    });
    check('confirmed close stops the native shell and focuses the available launcher', !(await sessions()).sessions.some((session) => session.id === shell.id && session.status === 'running')
      && await launch.evaluate((node) => node === document.activeElement));
    await launch.click(); await input.waitFor(); await input.focus();
    await rows.getByText('[path]>', { exact: false }).first().waitFor();
    check('fresh shell can be opened after confirmed close', (await sessions()).sessions.some((session) => session.id !== shell.id && session.projectWorkspaceId === shell.projectWorkspaceId && session.status === 'running'));
  } finally {
    await page.evaluate(() => { Reflect.deleteProperty(window.visualViewport!, 'height'); window.visualViewport!.dispatchEvent(new Event('resize')); });
    await page.setViewportSize(viewport); await cdp.detach();
  }
}
