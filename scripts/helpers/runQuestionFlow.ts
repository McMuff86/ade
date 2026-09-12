import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ElectronApplication, Page } from 'playwright';

/** Real Electron/IPC/HTTP/UI; the Codex stdio peer is deterministic and isolated. */
export async function runQuestionFlow(app: ElectronApplication, desktop: Page, phone: Page, root: string, evidence: string,
  check: (name: string, ok: boolean) => void): Promise<void> {
  const projectRoot = join(root, 'question-projects'); mkdirSync(projectRoot);
  await app.evaluate((_electron, fixture) => {
    const cp = process.getBuiltinModule('node:child_process') as typeof import('node:child_process');
    const original = cp.spawn;
    (globalThis as unknown as { restoreQuestionSpawn?: () => void }).restoreQuestionSpawn = () => { cp.spawn = original; };
    cp.spawn = ((file: string, args: string[], options: Record<string, unknown>) => {
      if (file === 'powershell.exe' && args.includes('& codex app-server --listen stdio://')) {
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
      await window.ade.invoke('remoteDevices:setAdminScopes', { deviceId: device.id, scopes: [...device.adminScopes ?? [], 'workspace:read'] });
      return { repositoryId: repository.repositoryId, agentId: agent.id };
    }, projectRoot);
    await desktop.keyboard.press('Escape');
    await desktop.getByRole('tab', { name: 'Graph view', exact: true }).click();
    const started = await desktop.evaluate((input) => window.ade.invoke('runTask:submit', { ...input, name: 'Desktop question', prompt: 'Question fixture prompt', allowQuestions: true }), config);
    await desktop.getByLabel('Aktiver Run', { exact: true }).selectOption(started.run.id);
    const opener = desktop.getByRole('button', { name: '1 Rückfragen beantworten', exact: true }); await opener.waitFor();
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
    if (!completed.tasks.some((task) => task.output?.text.includes('Blau'))) console.error('Question fixture result:', JSON.stringify(completed.tasks.map((task) => ({ status: task.status, output: task.output }))));
    await desktop.keyboard.press('Escape'); await report.waitFor({ state: 'hidden' });
    check('closed answer report restores focus when question opener disappears', await desktop.getByRole('button', { name: 'Bericht', exact: true }).evaluate((node) => node === document.activeElement));
    await phone.getByRole('button', { name: 'Erneut verbinden', exact: true }).click();
    await phone.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
    await phone.getByRole('button', { name: 'Neue Aufgabe', exact: true }).click();
    const composer = phone.getByRole('dialog', { name: 'Neue Aufgabe', exact: true });
    await composer.getByLabel('Repository', { exact: true }).selectOption(config.repositoryId);
    await composer.getByLabel('Agent', { exact: true }).selectOption(config.agentId);
    await composer.getByLabel('Name (optional)', { exact: true }).fill('Tablet question');
    await composer.getByLabel('Aufgabe', { exact: true }).fill('Question fixture prompt from tablet');
    await composer.getByRole('checkbox', { name: 'Rückfragen erlauben (native Codex-Agenten)', exact: true }).check();
    await composer.getByRole('button', { name: 'Aufgabe starten', exact: true }).click(); await composer.waitFor({ state: 'hidden' });
    await phone.keyboard.press('Escape'); await phone.getByRole('tab', { name: 'Work', exact: true }).click();
    await phone.getByRole('button', { name: 'Run Tablet question', exact: true }).click();
    const mobilePanel = phone.getByRole('region', { name: 'Rückfragen des Agenten', exact: true });
    await mobilePanel.getByText('Welche Farbe soll verwendet werden?', { exact: true }).waitFor();
    check('tablet task submission creates answerable question in its run inspector', await mobilePanel.getByRole('button', { name: 'Antwort senden', exact: true }).isDisabled());
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
    await phone.getByRole('tab', { name: 'Overview', exact: true }).click();
    await desktop.getByRole('button', { name: 'Settings', exact: true }).click();
  } finally {
    await app.evaluate(() => { (globalThis as unknown as { restoreQuestionSpawn?: () => void }).restoreQuestionSpawn?.(); });
  }
}
