import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { expect } from 'playwright/test';
import { mobileTlsProxy } from './mobileBrowser';

/** Actual UI, signed HTTP, persistent parent ledger, task coordinator and native
 * protocol transport. The Codex peer is deterministic, not a paid model. */
export async function coordinatorActionsFlow(desktop: Page, root: string, port: number, profileId: string, evidence: string, check: (label: string, ok: boolean) => void) {
  const repoPaths = ['Project A', 'Project B'].map(name => join(root, name));
  for (const path of repoPaths) {
    mkdirSync(path); writeFileSync(join(path, 'AGENTS.md'), '# Tablet fixture\nWork only in this workspace. Do not edit Git metadata.\n');
    execFileSync('git', ['init', '--initial-branch=main', path], { windowsHide: true });
    execFileSync('git', ['-C', path, 'add', 'AGENTS.md'], { windowsHide: true });
    execFileSync('git', ['-C', path, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Fixture'], { windowsHide: true });
  }
  const projects = await desktop.evaluate(async paths => {
    for (let index = 0; index < paths.length; index++) {
      const repo = await window.ade.invoke('repository:import', { path: paths[index], name: index ? 'Codex B' : 'Codex A', executionBackend: 'native' });
      const view = await window.ade.invoke('supervision:get');
      await window.ade.invoke('supervision:command', { operation: 'project', repositoryId: repo.id, mode: index ? 'observe' : 'coordinate', objective: '', commandId: crypto.randomUUID(), revision: view.revision });
    }
    return (await window.ade.invoke('supervision:get')).projects;
  }, repoPaths);
  for (let index = 0; index < 3 && await desktop.getByRole('dialog').count(); index++) await desktop.keyboard.press('Escape');
  await desktop.locator('#desktop-supervision').click(); await desktop.getByRole('button', { name: 'Mit ADE sprechen', exact: true }).click();
  const dialog = desktop.getByRole('dialog', { name: 'ADE-Gespräch', exact: true });
  await dialog.getByLabel('Gesprächsprofil', { exact: true }).selectOption(profileId); await dialog.getByRole('button', { name: 'Neues ADE-Gespräch', exact: true }).click();
  await expect(dialog.getByLabel('Nachricht an ADE', { exact: true })).toBeEditable();
  const id = await dialog.getByLabel('Gespräch auswählen', { exact: true }).inputValue();
  const sendDesktop = async (text: string) => { await dialog.getByLabel('Nachricht an ADE', { exact: true }).fill(text); await dialog.getByRole('button', { name: 'An ADE senden', exact: true }).click(); };
  await sendDesktop('prepare-handoff:' + JSON.stringify({ projectId: projects[0].id, text: 'Abendentscheidung: lokale Fixture prüfen.', nextStep: 'Morgen den Codex-Auftrag testen.' }));
  const note = dialog.getByRole('article', { name: 'Übergabe · Codex A', exact: true }); await note.waitFor();
  check('desktop model proposal is visible without saving a handoff or launching work', !(await desktop.evaluate(() => window.ade.invoke('supervision:briefing'))).projects[0].handoffs.length && !(await desktop.evaluate(() => window.ade.invoke('config:get'))).runs.length);
  await note.getByRole('button', { name: 'Übergabe prüfen', exact: true }).click();
  await note.getByText('Abendentscheidung: lokale Fixture prüfen.', { exact: true }).waitFor();
  await note.getByRole('button', { name: 'Übergabe speichern', exact: true }).click();
  await note.getByText('In ADE erfasst', { exact: true }).waitFor();
  check('desktop confirmation saves one durable handoff and returns focus to actions', (await desktop.evaluate(() => window.ade.invoke('supervision:briefing'))).projects[0].handoffs.length === 1
    && await dialog.getByRole('heading', { name: 'Übergaben und Projektaufträge', exact: true }).evaluate(node => node === document.activeElement));
  await desktop.evaluate(() => window.ade.invoke('mobileAccess:setEnabled', { enabled: true }));
  const pairing = await desktop.evaluate(() => window.ade.invoke('mobileAccess:pair'));
  const proxy = await mobileTlsProxy(); proxy.target(port); proxy.rewriteOrigin('https://ade-mobile.fixture.ts.net');
  const browser = await chromium.launch({ args: ['--ignore-certificate-errors', '--host-resolver-rules=MAP ade-mobile.fixture.ts.net 127.0.0.1'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 1000 }, hasTouch: true, ignoreHTTPSErrors: true }); page.setDefaultTimeout(30_000);
  try {
    await page.goto(`${proxy.origin}/#pair=${pairing.code}`); await page.getByLabel('Gerätename', { exact: true }).fill('Codex pilot tablet');
    await page.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click(); await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
    const device = (await desktop.evaluate(() => window.ade.invoke('remoteDevices:list'))).devices.find(d => d.name === 'Codex pilot tablet')!;
    const grants = async (all: boolean) => desktop.evaluate(({ deviceId, all }) => window.ade.invoke('remoteDevices:setAdminScopes', { deviceId, scopes: ['workspace:read'], resourceAccess: all ? { mode: 'all' } : { mode: 'selected', repositoryIds: [], agentIds: [] } }), { deviceId: device.id, all });
    await grants(true);
    const open = async () => { await page.locator('#mobile-supervision').click(); await page.locator('#mobile-conversation-open').click(); return page.getByRole('dialog', { name: 'ADE-Gespräch', exact: true }); };
    let mobile = await open(); await mobile.getByLabel('Gespräch auswählen', { exact: true }).selectOption(id);
    await mobile.getByRole('article', { name: 'Übergabe · Codex A', exact: true }).waitFor();
    check('paired tablet sees the same saved handoff action', (await mobile.locator('.conversation-action').count()) === 1);
    const send = async (text: string) => { await mobile.getByLabel('Nachricht an ADE', { exact: true }).fill(text); await mobile.getByRole('button', { name: 'An ADE senden', exact: true }).click(); };
    const identity = (await desktop.evaluate(() => window.ade.invoke('config:get'))).agents.find(agent => agent.id === profileId)!;
    writeFileSync(join(identity.memoryDir, 'MEMORY.md'), 'COORDINATOR_SINGLE_TASK_MEMORY');
    await send('prepare-task:' + JSON.stringify({ projectId: projects[0].id, agentId: profileId, prompt: 'ADE_TABLET_PROJECT_TASK write the confirmed answer to tablet-result.txt' }));
    let task = mobile.getByRole('article', { name: 'Projektauftrag · Codex A', exact: true }); await task.waitFor();
    check('tablet task proposal preserves private prompt and launches no run yet', !(await mobile.innerText()).includes('ADE_TABLET_PROJECT_TASK') && !(await desktop.evaluate(() => window.ade.invoke('config:get'))).runs.length);
    proxy.loseConversationActionReplies(true);
    await task.getByRole('button', { name: 'Auftrag starten', exact: true }).click();
    await expect.poll(async () => (await desktop.evaluate(() => window.ade.invoke('config:get'))).runTasks.length).toBe(1);
    await page.reload(); proxy.loseConversationActionReplies(false); await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
    mobile = await open(); task = mobile.getByRole('article', { name: 'Projektauftrag · Codex A', exact: true });
    await task.getByText(/In ADE erfasst/).waitFor();
    check('lost tablet acknowledgement and reload retain one task and its durable parent', (await desktop.evaluate(() => window.ade.invoke('config:get'))).runs.length === 1 && !(await task.getByRole('button', { name: 'Auftrag starten', exact: true }).count()));
    await task.getByRole('button', { name: 'Ergebnis und Rückfragen öffnen', exact: true }).click();
    await task.getByText('Welchen Text soll die Ergebnisdatei enthalten?', { exact: true }).waitFor();
    await task.getByLabel('Deine Antwort', { exact: true }).fill('TABLET_CONFIRMED_RESULT');
    await task.getByRole('button', { name: 'Antwort senden', exact: true }).click();
    await task.getByRole('button', { name: 'Ergebnis und Rückfragen öffnen', exact: true }).click();
    await task.getByText('ADE_CODEX_TASK_DONE: TABLET_CONFIRMED_RESULT', { exact: true }).waitFor();
    const config = await desktop.evaluate(() => window.ade.invoke('config:get')); const child = config.runTasks[0];
    const workspace = config.workspaceBindings.find(w => w.id === child.workspaceBindingId)!;
    check('question-enabled project task keeps repository instructions unchanged', readFileSync(join(workspace.workspaceDir, 'AGENTS.md'), 'utf8').replace(/\r\n/g, '\n')
      === '# Tablet fixture\nWork only in this workspace. Do not edit Git metadata.\n');
    const nativePrompt = JSON.parse(readFileSync(join(workspace.workspaceDir, 'fixture-thread.json'), 'utf8')).lastPrompt as string;
    check('native task receives profile and memory context without instruction-file injection', nativePrompt.includes(identity.name)
      && nativePrompt.includes('COORDINATOR_SINGLE_TASK_MEMORY') && nativePrompt.includes('ADE_TABLET_PROJECT_TASK'));
    check('tablet answer reaches the exact native task and its actual workspace result', child.questions?.[0]?.status === 'answered' && !!workspace
      && readFileSync(join(workspace.workspaceDir, 'tablet-result.txt'), 'utf8') === 'TABLET_CONFIRMED_RESULT');
    check('graph shows the actual child only under its own project', (await desktop.evaluate(() => window.ade.invoke('supervision:get'))).projects[0].links.some(l => l.target.id === child.runId)
      && !(await desktop.evaluate(() => window.ade.invoke('supervision:get'))).projects[1].links.length);
    for (const width of [800, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      check(`coordinator actions fit ${width}px and keep touch targets`, await mobile.evaluate(node => node.scrollWidth <= node.clientWidth + 1
        && [...node.querySelectorAll('.conversation-action button')].every(b => b.getBoundingClientRect().height >= 44)));
      await mobile.screenshot({ path: join(evidence, `coordinator-actions-${width}.png`) });
    }
    await grants(false); await mobile.getByRole('alert').filter({ hasText: /vollständige Projektfreigabe/ }).waitFor();
    check('resource revocation removes action and task details', !(await mobile.locator('.conversation-action').count()));
    await grants(true); await mobile.getByRole('button', { name: 'Gespräch aktualisieren', exact: true }).click();
    await task.waitFor(); await task.getByRole('button', { name: 'Ergebnis und Rückfragen öffnen', exact: true }).click();
    await task.getByText('ADE_CODEX_TASK_DONE: TABLET_CONFIRMED_RESULT', { exact: true }).waitFor();
    check('final restored grant reads the same completed result without another run', (await desktop.evaluate(() => window.ade.invoke('config:get'))).runs.length === 1);
  } catch (error) {
    console.error('Actions on disk:', JSON.parse(readFileSync(join(root, 'profile', 'ade', 'conversation-actions.json'), 'utf8')).actions.map((a: { id: string; state: string; runId: string | null; error: string }) => ({ id: a.id, state: a.state, runId: a.runId, error: a.error })));
    console.error('Actual tasks:', (await desktop.evaluate(() => window.ade.invoke('config:get'))).runTasks.map(t => ({ id: t.id, status: t.status, error: t.error })));
    await page.screenshot({ path: join(evidence, 'coordinator-actions-failure.png') }); console.error(await page.locator('.conversation-panel').innerText().catch(() => 'No conversation')); throw error;
  }
  finally { await browser.close(); await proxy.close(); }
}
