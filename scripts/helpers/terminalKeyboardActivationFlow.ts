import type { Locator, Page } from 'playwright';

interface KeyboardProbe {
  requests: { editable: boolean; activated: boolean }[];
  blurs: number;
  onBlur: () => void;
  restore: () => void;
}
type ProbeWindow = Window & { keyboardProbe: KeyboardProbe };

/** Real touch activation and xterm focus; OS keyboard display still needs Android. */
export async function terminalKeyboardActivationFlow(page: Page, workspace: Locator,
  check: (label: string, ok: boolean) => void): Promise<void> {
  const input = workspace.getByLabel('Direkte Terminal-Eingabe', { exact: true });
  const screen = workspace.getByLabel('Terminalanzeige', { exact: true });
  await page.evaluate(() => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'virtualKeyboard');
    const field = document.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')!;
    const probe: KeyboardProbe = { requests: [], blurs: 0, onBlur() { probe.blurs++; }, restore() {
      field.removeEventListener('blur', probe.onBlur);
      if (original) Object.defineProperty(navigator, 'virtualKeyboard', original);
      else Reflect.deleteProperty(navigator, 'virtualKeyboard');
    } };
    field.addEventListener('blur', probe.onBlur);
    (window as unknown as ProbeWindow).keyboardProbe = probe;
    Object.defineProperty(navigator, 'virtualKeyboard', { configurable: true, value: { show() {
      const field = document.activeElement;
      probe.requests.push({ editable: field instanceof HTMLTextAreaElement && !field.readOnly && !field.disabled,
        activated: navigator.userActivation.isActive });
    } } });
  });
  try {
    await workspace.locator('[data-dialog-heading]').focus();
    await screen.tap({ position: { x: 24, y: 24 } });
    const requests = await page.evaluate(() => (window as unknown as ProbeWindow).keyboardProbe.requests);
    check('a real terminal tap explicitly requests the keyboard on editable xterm input in user activation', requests.length === 1 && requests[0]!.editable && requests[0]!.activated);
    if (!requests.length) return; // The pre-fix negative control fails above, before testing the new button.
    await screen.tap({ position: { x: 24, y: 24 } });
    check('tapping an already focused terminal requests the dismissed keyboard again', await page.evaluate(() => (window as unknown as ProbeWindow).keyboardProbe.requests.length) === 2);
    await workspace.getByRole('button', { name: 'Tastatur öffnen', exact: true }).click();
    check('explicit keyboard button focuses editable xterm and requests the keyboard', await page.evaluate(() => {
      const calls = (window as unknown as ProbeWindow).keyboardProbe.requests; return calls.length === 3 && calls.every((call) => call.editable && call.activated);
    }));
    await workspace.getByRole('button', { name: 'Eingabe freigeben', exact: true }).click();
    await workspace.getByText('Der Desktop steuert die Eingabe.', { exact: true }).waitFor();
    await screen.tap({ position: { x: 24, y: 24 } });
    check('read-only terminal taps cannot request a keyboard or take desktop ownership', await page.evaluate(() => (window as unknown as ProbeWindow).keyboardProbe.requests.length) === 3
      && await input.evaluate((node) => (node as HTMLTextAreaElement).readOnly)
      && await workspace.getByRole('button', { name: 'Tastatur öffnen', exact: true }).isDisabled());
    await workspace.getByRole('button', { name: 'Eingabe übernehmen', exact: true }).click();
    await workspace.getByText('Du steuerst die Eingabe.', { exact: true }).waitFor();
    await screen.tap({ position: { x: 24, y: 24 } });
    check('explicit input takeover restores touch keyboard activation without a new session', await page.evaluate(() => {
      const calls = (window as unknown as ProbeWindow).keyboardProbe.requests; return calls.length === 4 && calls[3]!.editable;
    }));
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'virtualKeyboard', { configurable: true, value: undefined });
      (window as unknown as ProbeWindow).keyboardProbe.blurs = 0;
    });
    await screen.tap({ position: { x: 24, y: 24 } });
    check('without the keyboard API a tap renews the already focused input', await page.evaluate(() => (window as unknown as ProbeWindow).keyboardProbe.blurs) === 1
      && await input.evaluate((node) => document.activeElement === node));
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'virtualKeyboard', { configurable: true, value: { show() { throw new Error('Fixture keyboard API rejected'); } } });
      (window as unknown as ProbeWindow).keyboardProbe.blurs = 0;
    });
    await screen.tap({ position: { x: 24, y: 24 } });
    check('a rejected keyboard API request falls back to editable focus', await page.evaluate(() => (window as unknown as ProbeWindow).keyboardProbe.blurs) === 1
      && await input.evaluate((node) => document.activeElement === node));
  } finally {
    await page.evaluate(() => { (window as unknown as ProbeWindow).keyboardProbe.restore(); Reflect.deleteProperty(window, 'keyboardProbe'); });
  }
}
