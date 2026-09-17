import type { Page } from 'playwright';
import { expect } from 'playwright/test';

export async function conversationVoiceFlow(page: Page, otherId: string, check: (name: string, ok: boolean) => void, label: string) {
  const dialog = page.getByRole('dialog', { name: 'ADE-Gespräch', exact: true });
  const selector = dialog.getByLabel('Gespräch auswählen', { exact: true });
  const id = await selector.inputValue(); const input = dialog.getByLabel('Nachricht an ADE', { exact: true });
  const original = await input.inputValue(); const text = 'Wo stehen meine Projekte heute?';
  await input.fill('Getippte Nachricht');
  await dialog.getByRole('button', { name: 'Nachricht diktieren', exact: true }).click();
  await expect(dialog.getByLabel('Diktatvorschau', { exact: true })).toHaveValue(text);
  check(`${label}: actual microphone packets produce a preview without sending a message`, await input.inputValue() === 'Getippte Nachricht');
  await input.fill('Später ergänzt');
  await dialog.getByRole('button', { name: 'Aufnahme stoppen', exact: true }).click();
  await dialog.getByText('Diktat abgeschlossen. Text prüfen und übernehmen.', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Diktat in Nachricht übernehmen', exact: true }).click();
  await expect(input).toHaveValue(`Später ergänzt\n${text}`); await expect(input).toBeFocused();
  check(`${label}: completed speech appends to current text and returns keyboard focus`, true);
  await dialog.getByRole('button', { name: 'Nachricht diktieren', exact: true }).click();
  await expect(dialog.getByLabel('Diktatvorschau', { exact: true })).toHaveValue(text);
  await selector.selectOption(otherId);
  await expect(dialog.getByRole('button', { name: 'Nachricht diktieren', exact: true })).toBeVisible();
  check(`${label}: switching conversation leaves no recording preview on the new target`, !(await dialog.getByLabel('Diktatvorschau', { exact: true }).count()));
  await selector.selectOption(id);
  await expect(dialog.getByLabel('Diktatvorschau', { exact: true })).toHaveValue(text);
  await dialog.getByText('Unvollständiges Diktat.', { exact: false }).waitFor();
  check(`${label}: original target restores its partial speech with an incomplete notice`, true);
  await dialog.getByRole('button', { name: 'Vorheriges Diktat prüfen', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Diktat verwerfen', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Diktat verwerfen', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Nachricht diktieren', exact: true })).toBeEnabled();
  check(`${label}: discard clears only the preview and preserves already edited message`, await input.inputValue() === `Später ergänzt\n${text}`);
  await input.fill(original);
}
