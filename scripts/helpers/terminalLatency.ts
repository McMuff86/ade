import type { Locator, Page } from 'playwright';

/** Measures actual browser keydown → rendered PTY acknowledgement, excluding test-driver travel. */
export async function terminalEchoLatency(page: Page, workspace: Locator, text: string, acknowledgement: string): Promise<number> {
  const direct = workspace.getByLabel('Direkte Terminal-Eingabe', { exact: true });
  await direct.focus();
  await direct.evaluate((node, ack) => {
    const measurement = { started: 0, elapsed: 0 };
    (window as unknown as { adeEchoMeasurement: typeof measurement }).adeEchoMeasurement = measurement;
    node.addEventListener('keydown', () => { measurement.started = performance.now(); }, { once: true, capture: true });
    const screen = node.closest('.m-terminal-screen')!;
    const observer = new MutationObserver(() => {
      if (measurement.started && screen.textContent?.includes(ack)) { measurement.elapsed = performance.now() - measurement.started; observer.disconnect(); }
    });
    observer.observe(screen, { childList: true, characterData: true, subtree: true });
    setTimeout(() => observer.disconnect(), 5000);
  }, acknowledgement);
  await page.keyboard.type(text, { delay: 15 });
  await page.waitForFunction(() => (window as unknown as { adeEchoMeasurement: { elapsed: number } }).adeEchoMeasurement.elapsed > 0, undefined, { timeout: 5000 });
  return page.evaluate(() => Math.round((window as unknown as { adeEchoMeasurement: { elapsed: number } }).adeEchoMeasurement.elapsed));
}
