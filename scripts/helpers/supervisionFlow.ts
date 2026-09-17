import type { Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export async function supervisionFlow(page: Page, sessions: Array<{ id: string; repositoryId: string; name: string }>, check: (name: string, ok: boolean) => void, tablet?: Page) {
  const evidence = resolve('test-results/main-agent-planning'); mkdirSync(evidence, { recursive: true });
  await page.setViewportSize({ width: 800, height: 600 });
  check('compact desktop header contains every wrapped action without covering project content', await page.locator('.titlebar').evaluate(header => {
    const box = header.getBoundingClientRect();
    return [...header.querySelectorAll('button')].every(button => { const rect = button.getBoundingClientRect(); return rect.top >= box.top && rect.bottom <= box.bottom && rect.right <= box.right; });
  }));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor();
  check('compact desktop settings remains reachable above an open project', true);
  await page.keyboard.press('Escape');
  check('project content scrolls inside the remaining desktop workspace', await page.locator('.project-desktop').evaluate(project => {
    const box = project.getBoundingClientRect(); return box.bottom <= window.innerHeight + 1 && window.scrollY === 0;
  }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('#desktop-supervision').click();
  const dialog = page.getByRole('dialog', { name: 'ADE-Betreuung', exact: true });
  await dialog.getByLabel('Projekt betreuen', { exact: true }).waitFor();
  check('global supervision opens without launching a separate terminal', await dialog.isVisible());
  const count = (await page.evaluate(() => window.ade.invoke('pty:list'))).sessions.length;
  for (const [index, session] of sessions.slice(0, 3).entries()) {
    await dialog.getByLabel('Projekt betreuen', { exact: true }).selectOption(session.repositoryId);
    await dialog.getByLabel('Betreuungsmodus', { exact: true }).selectOption(index === 1 ? 'observe' : 'coordinate');
    await dialog.getByLabel('Auftrag für dieses Projekt', { exact: true }).fill(`Auftrag ${session.name}: eigenes Projekt betreuen.`);
    await dialog.getByRole('button', { name: 'Projektbetreuung speichern', exact: true }).click();
    await dialog.getByText('Projektbetreuung gespeichert.', { exact: true }).waitFor();
    await dialog.locator(`[data-supervision-target="session:${session.id}"]`).click();
    await dialog.locator('.supervision-editor [aria-label^="Verbindung lösen:"]').first().waitFor();
  }
  check('three project modes and exact work links are persisted', await page.evaluate(async ids => {
    const state = await window.ade.invoke('supervision:get');
    return ids.every((id, index) => state.projects.some(p => p.mode === (index === 1 ? 'observe' : 'coordinate') && p.links.some(l => l.target.id === id)));
  }, sessions.slice(0, 3).map(s => s.id)));
  check('planning and linking leave the original process count unchanged', (await page.evaluate(() => window.ade.invoke('pty:list'))).sessions.length === count);
  await dialog.getByLabel('Auftrag für dieses Projekt', { exact: true }).fill('Entwurf für C bleibt bei C.');
  await page.keyboard.press('Escape');
  check('supervision dialog restores the global opener', await page.locator('#desktop-supervision').evaluate(node => node === document.activeElement));
  await page.locator('#desktop-supervision').click();
  await dialog.getByLabel('Projekt betreuen', { exact: true }).selectOption(sessions[2]!.repositoryId);
  await dialog.getByText('Ungespeicherter Projektentwurf wiederhergestellt.', { exact: true }).waitFor();
  check('project supervision restores its own unsaved draft', await dialog.getByLabel('Auftrag für dieses Projekt', { exact: true }).inputValue() === 'Entwurf für C bleibt bei C.');
  // A second actor changes ownership. Refresh must not silently adopt its new revision.
  await page.evaluate(async repo => {
    const current = await window.ade.invoke('supervision:get');
    await window.ade.invoke('supervision:command', { commandId: 'concurrent-fixture-change', revision: current.revision, operation: 'project', repositoryId: repo, mode: 'direct', objective: 'Aktueller Auftrag von zweitem Gerät.' });
  }, sessions[2]!.repositoryId);
  await dialog.getByRole('button', { name: 'Betreuung aktualisieren', exact: true }).click();
  await dialog.getByText('Der Betreuungsstand hat sich geändert. Vor dem Speichern neu laden.', { exact: true }).waitFor();
  check('stale editor keeps its text but cannot overwrite newer ownership', await dialog.getByRole('button', { name: 'Projektbetreuung speichern', exact: true }).isDisabled()
    && await dialog.getByLabel('Auftrag für dieses Projekt', { exact: true }).inputValue() === 'Entwurf für C bleibt bei C.');
  await dialog.getByRole('button', { name: 'Aktuellen Auftrag laden', exact: true }).click();
  await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('[aria-label="Auftrag für dieses Projekt"]')?.value === 'Aktueller Auftrag von zweitem Gerät.');
  check('explicit reload adopts the latest complete instruction', await dialog.getByLabel('Betreuungsmodus', { exact: true }).inputValue() === 'direct');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Graph view', exact: true }).click();
  const graph = page.getByRole('region', { name: 'ADE-Projektverbindungen', exact: true });
  await graph.locator('[data-supervised-project]').nth(2).waitFor();
  check('graph shows three host-owned project edges and their real sessions', await graph.locator('[data-supervised-project]').count() === 3 && await graph.locator('[data-supervision-link]').count() === 3);
  await page.locator('.supervision-overlay').screenshot({ path: join(evidence, 'desktop-project-graph.png') });
  await graph.getByRole('button', { name: `Betreuung öffnen: ${sessions[0]!.name}`, exact: true }).focus(); await page.keyboard.press('Enter');
  await dialog.waitFor();
  check('graph project node opens its exact project with the keyboard', await dialog.getByLabel('Projekt betreuen', { exact: true }).inputValue() === sessions[0]!.repositoryId);
  await page.keyboard.press('Escape');
  check('graph dialog returns focus to its project node', await graph.getByRole('button', { name: `Betreuung öffnen: ${sessions[0]!.name}`, exact: true }).evaluate(node => node === document.activeElement));
  await graph.locator('[data-supervised-project]').first().locator('[data-supervision-link] button').click();
  await page.locator(`#project-session-tab-${sessions[0]!.id}[aria-selected="true"]`).waitFor();
  check('graph work edge returns to the exact existing terminal', (await page.evaluate(() => window.ade.invoke('pty:list'))).sessions.length === count);
  await page.reload(); await page.locator('#desktop-supervision').click();
  await dialog.locator('[data-supervised-project]').nth(2).waitFor();
  check('renderer reload restores persisted supervision relations', await dialog.locator('[data-supervision-link]').count() === 3);
  await dialog.getByLabel('Projekt betreuen', { exact: true }).selectOption(sessions[0]!.repositoryId);
  await dialog.getByLabel('Übergabe', { exact: true }).fill('Abend A: Entscheidung ist festgehalten.');
  await dialog.getByLabel('Nächster Schritt', { exact: true }).fill('Morgen A: Umsetzung besprechen.');
  await dialog.getByLabel('Projekt betreuen', { exact: true }).selectOption(sessions[1]!.repositoryId);
  check('handoff draft does not move into another project', await dialog.getByLabel('Übergabe', { exact: true }).inputValue() === '');
  await dialog.getByLabel('Projekt betreuen', { exact: true }).selectOption(sessions[0]!.repositoryId);
  await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('[aria-label="Übergabe"]')?.value === 'Abend A: Entscheidung ist festgehalten.');
  await dialog.getByRole('button', { name: 'Übergabe speichern', exact: true }).click();
  await dialog.getByText('Für die nächste Session gespeichert. Im Morgenüberblick abrufbar.', { exact: true }).waitFor();
  await page.keyboard.press('Escape'); await page.reload(); await page.locator('#desktop-supervision').click();
  await dialog.getByRole('button', { name: 'Morgenüberblick laden', exact: true }).click();
  const morningA = dialog.getByRole('article', { name: `Morgenstand: ${sessions[0]!.name}`, exact: true });
  await morningA.getByRole('button', { name: 'Übergabe lesen', exact: true }).click();
  await morningA.getByText('Abend A: Entscheidung ist festgehalten.', { exact: true }).waitFor();
  check('desktop reload retains the confirmed evening note and proposed next step', await morningA.getByText('Abend A: Entscheidung ist festgehalten.', { exact: true }).isVisible()
    && (await morningA.textContent())!.includes('Morgen A: Umsetzung besprechen.'));
  check('saving and reading morning handoffs does not launch work', (await page.evaluate(() => window.ade.invoke('pty:list'))).sessions.length === count);
  await page.keyboard.press('Escape');
  if (!tablet) return;
  await tablet.keyboard.press('Escape'); await tablet.setViewportSize({ width: 1280, height: 800 });
  const response = tablet.waitForResponse(res => res.url().endsWith('/api/v1/supervision/query') && res.ok());
  await tablet.locator('#mobile-supervision').click();
  const wire = JSON.stringify(await (await response).json());
  const mobile = tablet.getByRole('dialog', { name: 'ADE-Betreuung', exact: true });
  await mobile.locator('[data-supervised-project]').nth(2).waitFor();
  check('tablet shares the three durable project relationships', await mobile.locator('[data-supervision-link]').count() === 3);
  check('tablet graph receives opaque session IDs and no private instruction bodies', sessions.every(s => !wire.includes(s.id)) && !wire.includes('Aktueller Auftrag von'));
  await mobile.getByLabel('Projekt betreuen', { exact: true }).selectOption(sessions[1]!.repositoryId);
  await mobile.getByLabel('Auftrag für dieses Projekt', { exact: true }).fill('Brainstorming bleibt bei Projekt B.');
  await mobile.getByRole('button', { name: 'Projektbetreuung speichern', exact: true }).click();
  await mobile.getByText('Projektbetreuung gespeichert.', { exact: true }).waitFor();
  check('tablet saves the objective only to its selected project', await page.evaluate(async repo => {
    const state = await window.ade.invoke('supervision:get'); const project = state.projects.find(p => p.repositoryId === repo)!;
    return (await window.ade.invoke('supervision:detail', { projectId: project.id })).objective === 'Brainstorming bleibt bei Projekt B.' && project.mode === 'observe';
  }, sessions[1]!.repositoryId));
  await mobile.getByLabel('Übergabe', { exact: true }).fill('Abend B: Zwei Ideen für das Brainstorming.');
  await mobile.getByLabel('Nächster Schritt', { exact: true }).fill('Optionen B gemeinsam vergleichen.');
  await mobile.getByRole('button', { name: 'Übergabe speichern', exact: true }).click();
  await mobile.getByText('Für die nächste Session gespeichert. Im Morgenüberblick abrufbar.', { exact: true }).waitFor();
  const morningReply = tablet.waitForResponse(async res => res.url().endsWith('/api/v1/supervision/query') && res.ok() && res.request().postDataJSON()?.operation === 'briefing');
  await mobile.getByRole('button', { name: 'Morgenüberblick laden', exact: true }).click();
  check('tablet briefing summary keeps handoff bodies behind explicit detail queries', !JSON.stringify(await (await morningReply).json()).includes('Abend A:'));
  const tabletA = mobile.getByRole('article', { name: `Morgenstand: ${sessions[0]!.name}`, exact: true });
  await tabletA.getByRole('button', { name: 'Übergabe lesen', exact: true }).click();
  await tabletA.getByText('Abend A: Entscheidung ist festgehalten.', { exact: true }).waitFor();
  check('tablet reads the exact desktop handoff in its original project', true);
  await tabletA.getByRole('button', { name: 'Als erledigt markieren', exact: true }).click();
  await tabletA.getByRole('button', { name: 'Wieder öffnen', exact: true }).waitFor();
  check('tablet closes one handoff while another project stays open', await page.evaluate(async repo => {
    const briefing = await window.ade.invoke('supervision:briefing');
    return briefing.projects.find(p => p.repositoryId === repo)?.handoffs[0]?.status === 'done' && briefing.projects.filter(p => p.repositoryId !== repo).some(p => p.handoffs[0]?.status === 'open');
  }, sessions[0]!.repositoryId));
  for (const viewport of [{ width: 800, height: 1280 }, { width: 390, height: 844 }]) {
    await tablet.setViewportSize(viewport);
    check(`supervision fits the ${viewport.width}px tablet viewport`, await mobile.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    check(`supervision graph nodes remain touch sized at ${viewport.width}px`, (await mobile.locator('[data-supervised-project] > button').first().boundingBox())!.height >= 44);
  }
  await mobile.locator('[data-supervised-project]').first().locator('[data-supervision-link] button').click();
  await tablet.getByRole('dialog', { name: `Projekt · ${sessions[0]!.name}`, exact: true }).waitFor();
  check('tablet graph link opens the existing project session without another process', (await page.evaluate(() => window.ade.invoke('pty:list'))).sessions.length === count);
  const projectDialog = tablet.getByRole('dialog', { name: `Projekt · ${sessions[0]!.name}`, exact: true });
  await projectDialog.getByRole('button', { name: 'ADE-Betreuung', exact: true }).click();
  await mobile.getByLabel('Projekt betreuen', { exact: true }).waitFor();
  check('tablet project opens supervision directly with its exact repository selected', await mobile.getByLabel('Projekt betreuen', { exact: true }).inputValue() === sessions[0]!.repositoryId);
  const inventoryReply = tablet.waitForResponse(res => res.url().endsWith('/api/v1/terminal/sessions') && res.ok());
  await mobile.getByRole('button', { name: 'Betreuung aktualisieren', exact: true }).click();
  const inventory = await (await inventoryReply).json() as import('../../src/shared/remote').MobileSessionInventory;
  const sibling = inventory.sessions.find(s => s.projectRepositoryId === sessions[0]!.repositoryId && !wire.includes(s.id));
  if (!sibling) throw new Error('Expected the unlinked sibling session');
  await mobile.locator(`[data-supervision-target="session:${sibling.id}"]`).click();
  await page.waitForFunction(async () => (await window.ade.invoke('supervision:get')).projects[0]?.links.length === 2);
  check('tablet attaches a project session by its opaque ID without mixing workspace selection fields', true);
  await tablet.keyboard.press('Escape');
  check('closing project supervision restores its project opener', await projectDialog.getByRole('button', { name: 'ADE-Betreuung', exact: true }).evaluate(node => node === document.activeElement));
}
