import { join } from 'node:path';
import type { Locator, Page } from 'playwright';
import { expandSessionControls } from './terminalControls';

/** Two sessions, back and forth on the tablet (Adi's 25.09 evening: eight manual takeovers in
 * 19 minutes). A lease that only lapsed while the tablet looked at another session comes back
 * without a tap; an explicit tablet release and a desktop reclaim do not. `project` is the
 * held session's dialog and must currently own the input; `away` shows another session. */
export async function inputResumeFlow(tablet: Page, desktop: Page, project: Locator, sessionId: string,
  pick: (index: number) => Promise<void>, check: (name: string, ok: boolean) => void, evidence?: string, away = 1, back = 0): Promise<void> {
  const remote = async () => (await desktop.evaluate(id => window.ade.invoke('terminal:control', { sessionId: id }), sessionId)).remote;
  const own = project.getByText('Eingabe: Du (Tablet)', { exact: true });
  const claim = project.getByRole('button', { name: 'Eingabe übernehmen', exact: true });
  await own.waitFor();
  await pick(away);
  // Nothing heartbeats the session left behind; the host hands it to the desktop after 30 s.
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline && await remote()) await tablet.waitForTimeout(500);
  check('a session left on the tablet falls back to the desktop once its lease lapses', !await remote());
  await pick(back);
  await own.waitFor();
  check('returning to that session takes its input back without a tap', await remote()
    && await project.getByText('Die Eingabe ist wieder bei diesem Tablet.', { exact: true }).isVisible());
  check('taking the input back does not raise the keyboard', await tablet.evaluate(() => !document.activeElement?.classList.contains('xterm-helper-textarea')));
  if (evidence) await project.screenshot({ path: join(evidence, 'input-resume.png') });

  await expandSessionControls(project);
  await project.getByRole('button', { name: 'Eingabe freigeben', exact: true }).filter({ visible: true }).first().click();
  await claim.waitFor();
  await pick(away); await pick(back);
  await claim.waitFor(); await tablet.waitForTimeout(1500);
  check('an explicit release stays released when returning', !await remote() && await claim.isVisible());
  await claim.click(); await own.waitFor();

  await pick(away);
  await desktop.evaluate(id => window.ade.invoke('terminal:reclaim', { sessionId: id }), sessionId);
  await pick(back);
  await claim.waitFor(); await tablet.waitForTimeout(1500);
  check('a desktop reclaim is not taken back when returning', !await remote() && await claim.isVisible());
  await claim.click(); await own.waitFor();
  // The expanded controls are a per-device preference; leave them as the next flow expects.
  const toggle = project.getByRole('button', { name: 'Sitzung & Workspace', exact: true });
  if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
}
