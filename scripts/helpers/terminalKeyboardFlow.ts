import { join } from 'node:path';
import type { Locator, Page } from 'playwright';
import { terminalComposer } from './terminalControls';

/** Simulate Android's visual-only keyboard resize, keeping the layout viewport
 * intact. A normal Playwright window resize would miss this regression. */
export async function terminalKeyboardFlow(page: Page, workspace: Locator, evidence: string,
  check: (label: string, ok: boolean) => void): Promise<void> {
  const viewport = page.viewportSize()!;
  const setVisible = async (height: number, scale = 1, offsetTop = 0) => {
    await page.evaluate(({ height, scale, offsetTop }) => {
      for (const [key, value] of Object.entries({ height, scale, offsetTop })) {
        Object.defineProperty(window.visualViewport!, key, { configurable: true, value });
      }
      window.visualViewport!.dispatchEvent(new Event('resize'));
    }, { height, scale, offsetTop });
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  };
  const screen = workspace.getByLabel('Terminalanzeige', { exact: true });
  const input = workspace.getByLabel('Direkte Terminal-Eingabe', { exact: true });
  const toggle = workspace.getByRole('button', { name: 'Terminal-Bedienung', exact: true });
  const compact = workspace.locator('.m-keyboard-compact');
  try {
    await input.focus();
    await setVisible(420);
    await compact.waitFor();
    check('keyboard compacts a visual-only resize without changing layout height', await page.evaluate(() => window.innerHeight) === viewport.height
      && await toggle.getAttribute('aria-expanded') === 'false');
    check('keyboard hides launch chrome, transcript and idle composer', !await workspace.getByRole('button', { name: 'Workspace einblenden', exact: true }).isVisible()
      && !await workspace.locator('.m-terminal-transcript').isVisible() && !await workspace.locator('.m-terminal-composer summary').isVisible());
    const height = await screen.evaluate((node) => node.getBoundingClientRect().height);
    check(`keyboard leaves at least 70% of 420 px for the TUI (${height} px)`, height >= 294);
    check('keyboard layout retains direct input focus', await input.evaluate((node) => document.activeElement === node));
    check('keyboard terminal keys fit one reachable row with 44 px targets', await workspace.getByRole('button', { name: /^Terminaltaste / }).evaluateAll((nodes) => {
      const boxes = nodes.map((node) => node.getBoundingClientRect());
      return boxes.length === 8 && boxes.every((box) => box.height >= 44 && box.width >= 44 && box.top === boxes[0]!.top && box.bottom <= 420);
    }));
    await workspace.getByRole('button', { name: 'Terminaltaste Tab', exact: true }).click();
    check('tapping a terminal key preserves direct-input focus', await input.evaluate((node) => document.activeElement === node));
    await page.screenshot({ path: join(evidence, 'terminal-keyboard-tablet.png'), clip: { x: 0, y: 0, width: viewport.width, height: 420 } });
    await toggle.click();
    check('keyboard controls can expand without blurring the TUI', await toggle.getAttribute('aria-expanded') === 'true'
      && await workspace.getByRole('button', { name: 'Workspace einblenden', exact: true }).isVisible()
      && await input.evaluate((node) => document.activeElement === node));
    await toggle.focus(); await toggle.press('Enter');
    await compact.waitFor();
    check('keyboard controls also collapse through keyboard activation', await toggle.getAttribute('aria-expanded') === 'false');
    await setVisible(viewport.height);
    check('closing the keyboard restores controls and moves hidden-toggle focus to heading', !await toggle.isVisible()
      && await workspace.getByRole('button', { name: 'Workspace einblenden', exact: true }).isVisible()
      && await workspace.locator('[data-dialog-heading]').evaluate((node) => document.activeElement === node));
    await setVisible(420, 2);
    check('pinch zoom does not trigger keyboard compact mode', await compact.count() === 0 && !await toggle.isVisible());
    await setVisible(viewport.height - 80);
    check('browser toolbar resize does not trigger keyboard compact mode', await compact.count() === 0);
    await input.focus(); await setVisible(420, 1, 20);
    check('compact dialog follows the visible viewport offset', await workspace.evaluate((node) => {
      const box = node.getBoundingClientRect(); return Math.abs(box.top - 20) <= 1 && box.bottom <= 441;
    }));
    await toggle.click(); await setVisible(viewport.height); await setVisible(420);
    check('reopening the keyboard resets the temporary expanded-controls override', await toggle.getAttribute('aria-expanded') === 'false' && await compact.count() === 1);
    await setVisible(viewport.height);
    const composer = await terminalComposer(workspace);
    await composer.fill('Unsent keyboard layout draft');
    await setVisible(420);
    check('keyboard keeps an actively edited composer and its unsent draft visible', await composer.isVisible()
      && await composer.inputValue() === 'Unsent keyboard layout draft'
      && await composer.evaluate((node) => document.activeElement === node)
      && await workspace.getByRole('button', { name: 'Text und Enter senden', exact: true }).isVisible());
    await setVisible(viewport.height);
    check('keyboard close preserves composer expansion and unsent text', await composer.isVisible() && await composer.inputValue() === 'Unsent keyboard layout draft');
    await composer.fill(''); await workspace.locator('.m-terminal-composer summary').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await input.focus(); await setVisible(400);
    check('phone compact layout fits horizontally and preserves terminal space', await workspace.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
      && await screen.evaluate((node) => node.getBoundingClientRect().height >= 274));
    await page.screenshot({ path: join(evidence, 'terminal-keyboard-phone.png'), clip: { x: 0, y: 0, width: 390, height: 400 } });
    await page.route('**/api/v1/terminal/query', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unavailable', message: 'Keyboard fixture connection interrupted' } }) }));
    await workspace.getByRole('alert').first().waitFor();
    check('compact layout keeps a real terminal query error visible', await compact.count() === 1 && await workspace.getByRole('alert').first().isVisible());
    await page.unroute('**/api/v1/terminal/query');
    await workspace.getByRole('alert').waitFor({ state: 'hidden' });
    check('terminal recovers from the query failure while keyboard stays compact', await compact.count() === 1 && await input.isEnabled());
  } finally {
    await page.unroute('**/api/v1/terminal/query');
    await page.evaluate(() => {
      for (const key of ['height', 'scale', 'offsetTop']) Reflect.deleteProperty(window.visualViewport!, key);
      window.visualViewport!.dispatchEvent(new Event('resize'));
    });
    await page.setViewportSize(viewport);
    await compact.waitFor({ state: 'detached' });
  }
}
