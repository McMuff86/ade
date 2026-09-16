import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Locator, type Page } from 'playwright/test';

/** `dialog` is the prompt surface: the desktop dock or the tablet voice strip, whose buttons carry shorter names. */
export async function computerVoiceFlow(page: Page, dialog: Locator, root: string, surface: string, evidence: string, check: (name: string, ok: boolean) => void,
  names: { record: string; send: string } = { record: 'Diktieren', send: 'An CLI absenden' }): Promise<void> {
  const test = dialog.getByRole('region', { name: 'Computer Sprachtest', exact: true });
  const draft = dialog.getByLabel('CLI-Promptentwurf', { exact: true });
  const call = test.getByRole('button', { name: 'Computer testen', exact: true });
  const generations = () => existsSync(join(root, 'greetings.jsonl')) ? readFileSync(join(root, 'greetings.jsonl'), 'utf8').trim().split('\n') : [];
  await draft.fill(`Entwurf ${surface}.`);
  writeFileSync(join(root, 'live-phrase.txt'), 'Prüfe den Computer');
  await call.click(); await test.getByText('Ich höre zu. Sage jetzt „Computer“.', { exact: true }).waitFor();
  await page.waitForTimeout(700);
  check(`${surface}: listening locks dictation and sending while leaving the draft unchanged`, await dialog.getByRole('button', { name: names.record, exact: true }).isDisabled()
    && await dialog.getByRole('button', { name: names.send, exact: true }).isDisabled() && await draft.inputValue() === `Entwurf ${surface}.`);
  const before = generations().length;
  await test.getByRole('button', { name: 'Computer-Test beenden', exact: true }).click();
  await expect(call).toBeFocused();
  check(`${surface}: stop restores focus without synthesizing a non-command`, generations().length === before && await call.evaluate(node => node === document.activeElement));
  writeFileSync(join(root, 'live-phrase.txt'), 'Computer.');
  // Real short utterances can disappear from the final commit after being
  // recognized in the live preview. A harmless greeting must keep that call.
  writeFileSync(join(root, 'committed-phrase.txt'), '');
  await call.focus(); await page.keyboard.press('Enter');
  await test.getByText('Begrüssung abgespielt. Du kannst jetzt eine Aufgabe diktieren.', { exact: true }).waitFor();
  const answer = await test.getByLabel('Computer Antwort', { exact: true }).innerText();
  check(`${surface}: live Computer call survives an empty final transcript and plays one greeting`, generations().length === before + 1
    && JSON.parse(generations().at(-1)!).text === answer && answer.includes(', Adi.') && !answer.includes('ADE'));
  const delivery = JSON.parse(generations().at(-1)!).voice_settings;
  check(`${surface}: extended greeting explains dictation and review with even, measured delivery`, answer.includes('Wähle nach dieser Begrüssung „Diktieren“')
    && answer.endsWith('Deinen Text kannst du anschliessend prüfen und an die ausgewählte Sitzung senden.') && answer.length >= 200 && answer.length <= 400
    && delivery?.stability === 0.9 && delivery.style === 0 && delivery.speed === 0.85);
  check(`${surface}: voice test never alters or submits the draft`, await draft.inputValue() === `Entwurf ${surface}.`
    && !existsSync(join(root, 'Dictation project', 'prompt-proof.jsonl')));
  await expect(call).toBeEnabled();
  await test.getByRole('button', { name: 'Begrüssung abspielen', exact: true }).click();
  await test.getByText('Begrüssung abgespielt. Du kannst jetzt eine Aufgabe diktieren.', { exact: true }).waitFor();
  check(`${surface}: replay uses the existing audio without another provider request`, generations().length === before + 1);
  check(`${surface}: voice controls fit the available width`, await test.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
  await dialog.screenshot({ path: join(evidence, `computer-${surface}.png`) });
  await page.screenshot({ path: join(evidence, `computer-${surface}-page.png`) });
}

/** Tablet: the Computer call lives in the voice strip. The menu and a long press on the
 * microphone start it; a played greeting hands over to dictation without another tap. */
export async function computerStripFlow(page: Page, strip: Locator, root: string, evidence: string, check: (name: string, ok: boolean) => void): Promise<void> {
  const draft = strip.getByLabel('CLI-Promptentwurf', { exact: true });
  const mic = strip.locator('.voice-mic');
  const speak = strip.getByRole('button', { name: 'Sprechen', exact: true });
  const calling = strip.getByRole('button', { name: 'Sage „Computer“', exact: true });
  const listening = strip.getByRole('button', { name: /^Hört zu · \d+:\d\d$/ });
  const generations = () => existsSync(join(root, 'greetings.jsonl')) ? readFileSync(join(root, 'greetings.jsonl'), 'utf8').trim().split('\n') : [];
  await draft.fill('Entwurf tablet.');
  writeFileSync(join(root, 'live-phrase.txt'), 'Prüfe den Computer');
  await strip.getByRole('button', { name: 'Weitere Optionen', exact: true }).click();
  await strip.getByRole('menuitem', { name: 'Computer rufen', exact: true }).click();
  await calling.waitFor(); await page.waitForTimeout(700);
  check('tablet: the strip listens for Computer in place, locking sending and keeping the draft', await strip.getByRole('button', { name: 'Senden', exact: true }).isDisabled()
    && await draft.inputValue() === 'Entwurf tablet.' && await strip.getByRole('region', { name: 'Computer', exact: true }).getByText('Ich höre zu. Sage jetzt „Computer“.', { exact: true }).isVisible());
  const before = generations().length;
  await strip.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(speak).toBeFocused();
  check('tablet: cancelling the call synthesizes nothing and returns focus to the microphone', generations().length === before);
  writeFileSync(join(root, 'live-phrase.txt'), 'Computer.');
  writeFileSync(join(root, 'committed-phrase.txt'), '');
  const box = (await mic.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.waitForTimeout(900); await page.mouse.up();
  await calling.waitFor();
  check('tablet: a long press on the microphone calls the Computer', true);
  await strip.getByLabel('Computer Antwort', { exact: true }).waitFor();
  const answer = await strip.getByLabel('Computer Antwort', { exact: true }).innerText();
  check('tablet: live Computer call survives an empty final transcript and plays one greeting', generations().length === before + 1
    && JSON.parse(generations().at(-1)!).text === answer && answer.includes(', Adi.') && !answer.includes('ADE'));
  writeFileSync(join(root, 'live-phrase.txt'), 'Bitte prüfe den Code.');
  writeFileSync(join(root, 'committed-phrase.txt'), 'Bitte prüfe den Code.');
  await listening.waitFor();
  check('tablet: the played greeting hands over to dictation without another tap', await draft.getAttribute('readonly') !== null);
  await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('[aria-label="CLI-Promptentwurf"]')?.value.includes('Bitte prüfe'));
  await listening.click();
  await strip.getByText('Erkannt · prüfen, dann senden', { exact: true }).waitFor();
  check('tablet: the dictated task lands in the draft after the greeting without being sent', await draft.inputValue() === 'Entwurf tablet.\nBitte prüfe den Code.'
    && !existsSync(join(root, 'Dictation project', 'prompt-proof.jsonl')));
  await strip.getByRole('button', { name: 'Erneut', exact: true }).click();
  await listening.waitFor();
  check('tablet: replaying the greeting uses the existing audio and listens again', generations().length === before + 1);
  await strip.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(speak).toBeEnabled();
  check('tablet: cancelling the follow-up dictation keeps the draft', await draft.inputValue() === 'Entwurf tablet.\nBitte prüfe den Code.');
  check('tablet: voice controls fit the available width', await strip.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
  await strip.screenshot({ path: join(evidence, 'computer-tablet.png') });
  await page.screenshot({ path: join(evidence, 'computer-tablet-page.png') });
}
