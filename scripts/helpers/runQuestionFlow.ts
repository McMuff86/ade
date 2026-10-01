import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { expect } from 'playwright/test';
import { join, resolve } from 'node:path';
import type { ElectronApplication, Page } from 'playwright';
import { reconnectTablet } from './tabletConnection';

/** Real Electron/IPC/HTTP/UI; the Codex stdio peer is deterministic and isolated. */
export async function runQuestionFlow(app: ElectronApplication, desktop: Page, phone: Page, root: string, evidence: string,
  check: (name: string, ok: boolean) => void, proofs?: string): Promise<void> {
  const projectRoot = join(root, 'question-projects'); mkdirSync(projectRoot);
  await app.evaluate((_electron, fixture) => {
    const cp = process.getBuiltinModule('node:child_process') as typeof import('node:child_process');
    const original = cp.spawn;
    (globalThis as unknown as { restoreQuestionSpawn?: () => void }).restoreQuestionSpawn = () => { cp.spawn = original; };
    cp.spawn = ((file: string, args: string[], options: Record<string, unknown>) => {
      // Windows starts the app server through PowerShell, Linux and macOS spawn
      // `codex app-server` directly (CodexAppServerProcess); both reach the fixture.
      if ((file === 'powershell.exe' && args.includes('& codex app-server --listen stdio://'))
        || (file === 'codex' && args[0] === 'app-server')) {
        return original(process.execPath, [fixture], { ...options, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true });
      }
      return original(file, args, options);
    }) as typeof cp.spawn;
  }, resolve('scripts/fixtures/codex-app-server.cjs'));
  try {
    const config = await desktop.evaluate(async (path) => {
      await window.ade.invoke('projectDefaults:save', { rootPath: path, agentId: null });
      const repository = await window.ade.invoke('project:create', { name: 'Interactive fixture' });
      const category = await window.ade.invoke('category:create', { name: 'Question fixture' });
      const agent = await window.ade.invoke('agent:create', { categoryId: category.id, name: 'Question agent', runtime: 'codex', permissionMode: 'default', defaultRepositoryId: repository.repositoryId });
      const device = (await window.ade.invoke('remoteDevices:list')).devices.find((item) => item.revokedAt === null)!;
      await window.ade.invoke('remoteDevices:setAdminScopes', { deviceId: device.id, scopes: [...new Set([...device.adminScopes ?? [], 'workspace:read' as const])] });
      return { repositoryId: repository.repositoryId, agentId: agent.id };
    }, projectRoot);
    await desktop.keyboard.press('Escape');
    await desktop.getByRole('tab', { name: 'Graph', exact: true }).click();
    const started = await desktop.evaluate((input) => window.ade.invoke('runTask:submit', { ...input, name: 'Desktop question', prompt: 'Question fixture prompt', allowQuestions: true }), config);
    await desktop.getByLabel('Aktiver Run', { exact: true }).selectOption(started.run.id);
    const opener = desktop.getByRole('button', { name: '1 Rückfragen beantworten', exact: true }); await opener.waitFor();
    const decisionWork = proofs ? await decisionActionsFlow(desktop, config, started.run.id, proofs, check) : undefined;
    await desktop.getByRole('tab', { name: 'Übersicht', exact: true }).click();
    const decision = desktop.getByTestId('attention-panel').locator('[data-attention-group="needs-you"]')
      .getByRole('button', { name: 'Arbeit öffnen: Desktop question', exact: true });
    await decision.focus(); await desktop.keyboard.press('Enter');
    await desktop.getByRole('dialog', { name: 'Desktop question', exact: true }).getByRole('region', { name: 'Rückfragen des Agenten', exact: true }).getByText('Welche Farbe soll verwendet werden?', { exact: true }).waitFor();
    check('desktop decision overview opens the actual question with one keyboard action', true);
    await desktop.keyboard.press('Escape');
    check('closing decision detail returns focus to the decision button', await decision.evaluate(node => node === document.activeElement));
    await desktop.getByRole('tab', { name: 'Graph', exact: true }).click();
    await opener.focus(); await desktop.keyboard.press('Enter');
    const report = desktop.getByRole('dialog', { name: 'Desktop question', exact: true });
    const panel = report.getByRole('region', { name: 'Rückfragen des Agenten', exact: true });
    await panel.getByText('Welche Farbe soll verwendet werden?', { exact: true }).waitFor();
    check('desktop question report opens with focus and no automatic answer', await report.evaluate((node) => node.contains(document.activeElement))
      && await panel.getByRole('button', { name: 'Antwort senden', exact: true }).isDisabled());
    const blue = panel.getByRole('radio', { name: /Blau/ }); await blue.focus(); await desktop.keyboard.press('Space');
    await panel.getByRole('button', { name: 'Antwort senden', exact: true }).click();
    await panel.getByText('Keine offenen Rückfragen.', { exact: true }).waitFor();
    let completed = await desktop.evaluate((id) => window.ade.invoke('run:report', { runId: id }), started.run.id);
    for (let attempt = 0; attempt < 100 && completed.tasks.some((task) => task.status === 'running'); attempt++) {
      await new Promise((done) => setTimeout(done, 100));
      completed = await desktop.evaluate((id) => window.ade.invoke('run:report', { runId: id }), started.run.id);
    }
    check('desktop answer reaches native process transport and task completes', completed.tasks.some((task) => task.output?.text.includes('Blau')));
    if (decisionWork) {
      const stale = await desktop.evaluate((input) => window.ade.invoke('run:answer', { ...input, answers: { choice: { answers: ['Grün'] } } }).then(() => 'accepted', (error: Error) => error.message), decisionWork.question);
      check('an answered question cannot receive a second, different answer', stale !== 'accepted'
        && !(await desktop.evaluate((id) => window.ade.invoke('run:report', { runId: id }), started.run.id)).tasks.some((task) => task.output?.text.includes('Grün')));
    }
    if (!completed.tasks.some((task) => task.output?.text.includes('Blau'))) console.error('Question fixture result:', JSON.stringify(completed.tasks.map((task) => ({ status: task.status, output: task.output }))));
    await desktop.keyboard.press('Escape'); await report.waitFor({ state: 'hidden' });
    check('closed answer report restores focus when question opener disappears', await desktop.getByRole('button', { name: 'Bericht', exact: true }).evaluate((node) => node === document.activeElement));
    await reconnectTablet(phone);
    await phone.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
    await phone.getByRole('tab', { name: 'Übersicht', exact: true }).click();
    await phone.getByRole('button', { name: 'Agent beauftragen', exact: true }).click();
    const composer = phone.getByRole('dialog', { name: 'Agent beauftragen', exact: true });
    await composer.getByLabel('Repository', { exact: true }).selectOption(config.repositoryId);
    await composer.getByLabel('Agent', { exact: true }).selectOption(config.agentId);
    await composer.getByLabel('Name (optional)', { exact: true }).fill('Tablet question');
    await composer.getByLabel('Aufgabe', { exact: true }).fill('Question fixture prompt from tablet');
    await composer.getByRole('checkbox', { name: 'Rückfragen erlauben (native Codex-Agenten)', exact: true }).check();
    await composer.getByRole('button', { name: 'Aufgabe starten', exact: true }).click(); await composer.waitFor({ state: 'hidden' });
    await phone.keyboard.press('Escape'); await phone.getByRole('tab', { name: 'Übersicht', exact: true }).click();
    await phone.getByTestId('attention-panel').locator('[data-attention-group="needs-you"]').getByRole('button', { name: 'Arbeit öffnen: Tablet question', exact: true }).click();
    const mobilePanel = phone.getByRole('region', { name: 'Rückfragen des Agenten', exact: true });
    await mobilePanel.getByText('Welche Farbe soll verwendet werden?', { exact: true }).waitFor();
    check('tablet task submission creates answerable question in its run inspector', await mobilePanel.getByRole('button', { name: 'Antwort senden', exact: true }).isDisabled());
    if (decisionWork) {
      const details = phone.getByRole('dialog', { name: 'Run-Details', exact: true });
      if (await details.count()) { await phone.keyboard.press('Escape'); await details.waitFor({ state: 'hidden' }); }
      await phone.getByRole('tab', { name: 'Übersicht', exact: true }).click();
      const tabletDecisions = phone.getByTestId('attention-panel');
      const toggle = tabletDecisions.getByRole('button', { name: 'Entscheidungsoptionen: Tablet question', exact: true });
      await toggle.click();
      const inline = tabletDecisions.getByRole('region', { name: 'Entscheidungsoptionen: Tablet question', exact: true });
      await inline.getByText('Welche Farbe soll verwendet werden?', { exact: true }).waitFor();
      await inline.getByRole('radio', { name: 'Eigene Antwort', exact: true }).check();
      await inline.getByRole('textbox', { name: 'Deine Antwort', exact: true }).fill('Entwurf im Überblick');
      // The tablet sees an opaque terminal ID, never the native PTY ID.
      const session = tabletDecisions.locator('[data-attention-group="working"] [data-attention-id]').filter({ hasText: 'Working fixture' });
      await session.getByRole('button', { name: /^Entscheidungsoptionen: / }).click();
      const sessionRegion = session.getByRole('region');
      check('tablet hands further instructions to the terminal lease instead of writing from the overview', await sessionRegion.getByRole('button', { name: 'Im Terminal anweisen', exact: true }).isVisible()
        && !await sessionRegion.getByRole('textbox').count() && await sessionRegion.getByText(/ADE bietet keine Pause an/).isVisible());
      await toggle.click();
      const restored = await expect(inline.getByRole('textbox', { name: 'Deine Antwort', exact: true })).toHaveValue('Entwurf im Überblick').then(() => true, () => false);
      check('switching decisions on the tablet keeps the answer draft bound to its question', restored && !await session.getByRole('region').count());
      check('tablet decision options keep touch targets and fit the viewport', await inline.evaluate(node => [...node.querySelectorAll('button')].every(button => button.getBoundingClientRect().height >= 40))
        && await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await toggle.click();
      await tabletDecisions.locator('[data-attention-group="needs-you"]').getByRole('button', { name: 'Arbeit öffnen: Tablet question', exact: true }).click();
      await mobilePanel.getByText('Welche Farbe soll verwendet werden?', { exact: true }).waitFor();
    }
    await phone.setViewportSize({ width: 800, height: 1280 });
    await mobilePanel.getByRole('radio', { name: 'Eigene Antwort', exact: true }).check();
    await mobilePanel.getByRole('textbox', { name: 'Deine Antwort', exact: true }).fill('Türkis vom Tablet');
    await phone.context().setOffline(true);
    await phone.setViewportSize({ width: 1280, height: 800 });
    check('rotation and temporary disconnection preserve the in-memory answer', await mobilePanel.getByRole('textbox', { name: 'Deine Antwort', exact: true }).inputValue() === 'Türkis vom Tablet');
    await phone.context().setOffline(false);
    await phone.screenshot({ path: join(evidence, 'tablet-question.png'), fullPage: true });
    await mobilePanel.getByRole('button', { name: 'Antwort senden', exact: true }).click();
    await mobilePanel.getByText('Keine offenen Rückfragen.', { exact: true }).waitFor();
    const activity = phone.getByRole('region', { name: 'Run-Aktivität und Ergebnis', exact: true });
    await activity.getByRole('button', { name: 'Ergebnis', exact: true }).click();
    await activity.getByText('Antwort erhalten: Türkis vom Tablet', { exact: true }).waitFor();
    check('tablet reply is confirmed and complete CLI response is visible', true);
    await phone.reload(); await phone.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
    const runs = await desktop.evaluate(() => window.ade.invoke('run:getSummary', {}));
    check('browser reload cannot answer a resolved question again or relaunch its run', runs.filter((run) => run.name === 'Tablet question').length === 1
      && runs.find((run) => run.name === 'Tablet question')!.tasks[0]!.pendingQuestions === 0);
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.getByRole('tab', { name: 'Übersicht', exact: true }).click();
    const decisions = phone.getByTestId('attention-panel');
    await decisions.locator('[data-attention-group="review"]').getByRole('button', { name: 'Arbeit öffnen: Tablet question', exact: true }).waitFor();
    check('completed structured work moves to review on a narrow tablet without horizontal overflow', await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await phone.route('**/api/v1/attention', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }));
    await decisions.getByRole('button', { name: 'Arbeitsübersicht aktualisieren', exact: true }).click();
    await decisions.getByRole('alert').waitFor();
    check('failed refresh removes stale decision actions', await decisions.locator('[data-attention-id]').count() === 0);
    await phone.unroute('**/api/v1/attention');
    await decisions.getByRole('button', { name: 'Arbeitsübersicht aktualisieren', exact: true }).click();
    await decisions.locator('[data-attention-group="review"]').getByRole('button', { name: 'Arbeit öffnen: Tablet question', exact: true }).waitFor();
    check('positive refresh restores authorized results after read failure', await decisions.getByRole('alert').count() === 0);
    await phone.context().setOffline(true);
    // An explicit reconnect asks the connection owner to recheck reachability;
    // the overview itself never submits or queues a command while offline.
    await phone.reload();
    await decisions.getByText('PC offline. Verbinde dich zum Prüfen erneut; keine Aktion wird vorgemerkt.', { exact: true }).waitFor();
    check('offline decision overview offers no stale work actions', await decisions.locator('[data-attention-id]').count() === 0
      && await decisions.getByRole('button', { name: 'Arbeitsübersicht aktualisieren', exact: true }).isDisabled());
    await phone.context().setOffline(false);
    await reconnectTablet(phone);
    await decisions.locator('[data-attention-group="review"]').getByRole('button', { name: 'Arbeit öffnen: Tablet question', exact: true }).waitFor();
    await phone.screenshot({ path: join(evidence, 'attention-narrow.png') });
    if (decisionWork) {
      await desktop.evaluate((sessionId) => window.ade.invoke('pty:kill', { sessionId }), decisionWork.session);
      await desktop.waitForFunction(async (id) => (await window.ade.invoke('pty:list')).sessions.every(item => item.id !== id || item.status !== 'running'), decisionWork.session);
      const late = await desktop.evaluate((sessionId) => window.ade.invoke('terminal:promptSend', { sessionId, commandId: crypto.randomUUID(), text: 'Zu spät', mode: 'submit' }).then(() => 'accepted', () => 'refused'), decisionWork.session);
      const attention = await desktop.evaluate(() => window.ade.invoke('attention:get'));
      check('an ended session refuses instructions and the overview no longer offers them', late === 'refused' && !readFileSync(decisionWork.inputFile, 'utf8').includes('Zu spät')
        && !attention.rows.some(row => row.id === `session:${decisionWork.session}` && row.actions.length > 0));
    }
    await desktop.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  } finally {
    await app.evaluate(() => { (globalThis as unknown as { restoreQuestionSpawn?: () => void }).restoreQuestionSpawn?.(); });
  }
}

/** Goal 34.4: three projects with waiting, working and interrupted work; inline decisions
 * use only the actions main reports and the existing idempotent contracts. */
async function decisionActionsFlow(desktop: Page, config: { repositoryId: string; agentId: string }, questionRunId: string, proofs: string,
  check: (name: string, ok: boolean) => void): Promise<{ session: string; inputFile: string; question: { runId: string; taskId: string; questionId: string } }> {
  const before = new Set(readdirSync(proofs));
  const setup = await desktop.evaluate(async ({ agentId }) => {
    const cancelProject = await window.ade.invoke('project:create', { name: 'Cancel fixture' });
    await window.ade.invoke('project:create', { name: 'Working fixture' });
    const cancel = await window.ade.invoke('runTask:submit', { repositoryId: cancelProject.repositoryId, agentId, name: 'Cancel me', prompt: 'Question fixture prompt', allowQuestions: true });
    const { directory } = await window.ade.invoke('project:query', { operation: 'directory' });
    const entry = directory!.entries.find(item => item.name === 'Working fixture')!;
    const { workspace } = await window.ade.invoke('project:command', { operation: 'open', entryId: entry.id });
    const session = await window.ade.invoke('session:launch', { projectWorkspaceId: workspace.id, expectedBranch: workspace.branch, mode: 'codex' });
    return { cancelRunId: cancel.run.id, session: session.id };
  }, config);
  await expect.poll(() => readdirSync(proofs).filter(name => name.endsWith('.input') && !before.has(name)).length).toBe(1);
  const inputFile = `${proofs}/${readdirSync(proofs).find(name => name.endsWith('.input') && !before.has(name))!}`;
  const questions = await desktop.evaluate((runId) => window.ade.invoke('run:questions', { runId }), questionRunId);
  const question = { runId: questionRunId, taskId: questions.tasks[0]!.taskId, questionId: questions.tasks[0]!.questions[0]!.id };
  const crossed = await desktop.evaluate((input) => window.ade.invoke('run:answer', { ...input, answers: { choice: { answers: ['Blau'] } } }).then(() => 'accepted', () => 'refused'),
    { ...question, runId: setup.cancelRunId });
  check('an answer bound to another run cannot reach this question', crossed === 'refused'
    && (await desktop.evaluate((runId) => window.ade.invoke('run:questions', { runId }), questionRunId)).tasks[0]!.questions[0]!.status === 'pending');

  await desktop.getByRole('tab', { name: 'Übersicht', exact: true }).click();
  const panel = desktop.getByTestId('attention-panel');
  const refresh = panel.getByRole('button', { name: 'Arbeitsübersicht aktualisieren', exact: true });
  const row = (id: string) => panel.locator(`[data-attention-id="${id}"]`);
  await expect.poll(async () => { await refresh.click(); return await row(`session:${setup.session}`).count()
    + await panel.locator(`[data-attention-group="needs-you"] [data-attention-id="run:${setup.cancelRunId}"]`).count(); }, { timeout: 20_000 }).toBe(2);
  const toggle = panel.getByRole('button', { name: 'Entscheidungsoptionen: Desktop question', exact: true });
  await toggle.focus(); await desktop.keyboard.press('Enter');
  const inline = panel.getByRole('region', { name: 'Entscheidungsoptionen: Desktop question', exact: true });
  await inline.getByText('Welche Farbe soll verwendet werden?', { exact: true }).waitFor();
  check('decision options expand from the keyboard with only the reported actions', await toggle.getAttribute('aria-expanded') === 'true'
    && JSON.stringify(await inline.locator('[data-attention-action]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-attention-action')))) === JSON.stringify(['answer', 'cancel']));
  await inline.getByRole('radio', { name: /Grün/ }).check();
  await desktop.keyboard.press('Escape');
  check('Escape closes decision options and returns focus to their toggle', await inline.count() === 0 && await toggle.evaluate(node => node === document.activeElement));
  const cancelToggle = row(`run:${setup.cancelRunId}`).getByRole('button', { name: 'Entscheidungsoptionen: Cancel me', exact: true });
  await cancelToggle.click();
  const cancelRegion = panel.getByRole('region', { name: 'Entscheidungsoptionen: Cancel me', exact: true });
  await cancelRegion.getByText('Welche Farbe soll verwendet werden?', { exact: true }).waitFor();
  check('switching to another decision shows that question without the previous draft', !await cancelRegion.getByRole('radio', { name: /Grün/ }).isChecked());
  await cancelRegion.getByRole('button', { name: 'Run abbrechen…', exact: true }).click();
  await cancelRegion.getByRole('button', { name: 'Run behalten', exact: true }).click();
  check('backing out of cancellation leaves the run running', (await desktop.evaluate(() => window.ade.invoke('run:getSummary', {}))).find(item => item.id === setup.cancelRunId)!.status === 'running');
  await toggle.click();
  check('returning to the first decision restores its unsent answer', await expect(inline.getByRole('radio', { name: /Grün/ })).toBeChecked().then(() => true, () => false) && await cancelRegion.count() === 0);
  await toggle.click(); await cancelToggle.click();
  await cancelRegion.getByRole('button', { name: 'Run abbrechen…', exact: true }).click();
  await cancelRegion.getByRole('button', { name: 'Abbruch bestätigen', exact: true }).click();
  await expect.poll(async () => (await desktop.evaluate(() => window.ade.invoke('run:getSummary', {}))).find(item => item.id === setup.cancelRunId)!.status).toBe('cancelled');
  await refresh.click();
  await panel.locator(`[data-attention-group="interrupted"] [data-attention-id="run:${setup.cancelRunId}"]`).waitFor();
  check('confirmed cancellation moves the run to interrupted work without further actions', !await row(`run:${setup.cancelRunId}`).getByRole('button', { name: /^Entscheidungsoptionen/ }).count());

  const sessionRow = row(`session:${setup.session}`);
  await sessionRow.getByRole('button', { name: /^Entscheidungsoptionen: / }).click();
  const sessionRegion = sessionRow.getByRole('region');
  check('a working CLI states honestly that its running turn cannot be interrupted', await sessionRegion.getByText(/ADE bietet keine Pause an/).isVisible()
    && !await sessionRegion.getByRole('button', { name: /unterbrechen|Pause/i }).count());
  await expect.poll(async () => { await refresh.click(); return sessionRegion.getByRole('textbox', { name: 'Anweisung für diese Sitzung', exact: true }).count(); }, { timeout: 20_000 }).toBe(1);
  const projects = await panel.evaluate(node => [...node.querySelectorAll('[data-attention-group]')].flatMap(group => [...group.querySelectorAll('[data-attention-id]')]
    .map(item => `${group.getAttribute('data-attention-group')}:${item.querySelector('span')?.textContent ?? ''}`)));
  check('three projects show waiting, working and interrupted work together', ['needs-you:Interactive fixture', 'working:Working fixture', 'interrupted:Cancel fixture'].every(item => projects.includes(item)));
  const text = sessionRegion.getByRole('textbox', { name: 'Anweisung für diese Sitzung', exact: true });
  await text.fill('Desktop Anweisung ä\nzweite Zeile');
  await toggle.click(); await toggle.click(); await sessionRow.getByRole('button', { name: /^Entscheidungsoptionen: / }).click();
  check('switching between decisions keeps the session-bound instruction draft', await expect(text).toHaveValue('Desktop Anweisung ä\nzweite Zeile').then(() => true, () => false));
  await sessionRegion.getByRole('button', { name: 'Anweisung senden', exact: true }).click();
  await sessionRegion.getByText('Anweisung wurde dieser CLI einmal übergeben.', { exact: true }).waitFor();
  await expect.poll(() => readFileSync(inputFile, 'utf8')).toBe('\x1b[200~Desktop Anweisung ä\nzweite Zeile\x1b[201~\r');
  check('desktop decision sends the instruction exactly once to the exact CLI process', await text.inputValue() === '');
  await sessionRow.getByRole('button', { name: /^Entscheidungsoptionen: / }).click();
  return { session: setup.session, inputFile, question };
}
