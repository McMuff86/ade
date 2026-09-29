import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { expect } from 'playwright/test';
import { mobileTlsProxy } from './mobileBrowser';

/** Real tablet UI -> signed host API -> durable proposal -> real Git/files.
 * Only the language-model peer is simulated. No external repository is created. */
export async function conversationProjectFlow(desktop: Page, port: number, profileId: string, evidence: string, check: (label: string, ok: boolean) => void) {
  for (let i = 0; i < 3 && await desktop.getByRole('dialog').count(); i++) await desktop.keyboard.press('Escape');
  await desktop.evaluate(() => window.ade.invoke('mobileAccess:setEnabled', { enabled: true }));
  const pairing = await desktop.evaluate(() => window.ade.invoke('mobileAccess:pair'));
  const proxy = await mobileTlsProxy(); proxy.target(port); proxy.rewriteOrigin('https://ade-mobile.fixture.ts.net');
  const browser = await chromium.launch({ args: ['--ignore-certificate-errors', '--host-resolver-rules=MAP ade-mobile.fixture.ts.net 127.0.0.1'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 1000 }, hasTouch: true, ignoreHTTPSErrors: true }); page.setDefaultTimeout(30_000);
  try {
    await page.goto(`${proxy.origin}/#pair=${pairing.code}`);
    await page.getByLabel('Gerätename', { exact: true }).fill('Project creation tablet');
    await page.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
    const deviceId = (await desktop.evaluate(() => window.ade.invoke('remoteDevices:list'))).devices.find(d => d.name === 'Project creation tablet')!.id;
    const grant = async (create: boolean) => desktop.evaluate(({ deviceId, create }) => window.ade.invoke('remoteDevices:setAdminScopes', {
      deviceId, scopes: create ? ['workspace:read', 'catalog:write', 'workspace:write'] : ['workspace:read'], resourceAccess: { mode: 'all' },
    }), { deviceId, create });
    await grant(false);
    const open = async () => {
      await page.locator('#mobile-supervision').click(); await page.locator('#conversation-mode-project').click(); await page.locator('#mobile-conversation-open').click();
      return page.getByRole('dialog', { name: 'ADE-Gespräch', exact: true });
    };
    let dialog = await open(); await dialog.getByLabel('Gesprächsprofil', { exact: true }).selectOption(profileId);
    await dialog.getByRole('button', { name: 'Neues ADE-Gespräch', exact: true }).click();
    await expect(dialog.getByLabel('Nachricht an ADE', { exact: true })).toBeEditable();
    const conversationId = await dialog.getByLabel('Gespräch auswählen', { exact: true }).inputValue();
    const before = await desktop.evaluate(() => window.ade.invoke('config:get'));
    const project = { name: 'Music From Tablet', context: '# Knuckles-style music\nWindows. C++20, JUCE, CMake, Lua.\nFirst: audio prototype.', agentsMd: '# Agent instructions\nKeep audio callbacks free of I/O and allocation.', githubRepo: '', start: null };
    await dialog.getByLabel('Nachricht an ADE', { exact: true }).fill('prepare-project:' + JSON.stringify(project));
    await dialog.getByRole('button', { name: 'An ADE senden', exact: true }).click();
    let card = dialog.getByRole('article', { name: 'Projekt aus Gespräch · Music From Tablet', exact: true }); await card.waitFor();
    await expect(card.locator('pre').first()).toHaveText(project.context);
    await card.locator('summary').filter({ hasText: /^AGENTS.md$/ }).click();
    await expect(card.locator('pre').last()).toContainText('PROJECT.md');
    check('tablet reviews complete context and durable agent instructions before effects', (await desktop.evaluate(() => window.ade.invoke('config:get'))).repositories.length === before.repositories.length);
    await card.getByRole('button', { name: 'Projekt aus Kontext anlegen', exact: true }).click();
    await card.getByRole('alert').waitFor();
    check('missing catalog/workspace grants prevent creation without consuming the proposal', (await desktop.evaluate(() => window.ade.invoke('config:get'))).repositories.length === before.repositories.length);
    await grant(true); proxy.loseConversationActionReplies(true);
    await card.getByRole('button', { name: 'Projekt aus Kontext anlegen', exact: true }).click();
    await expect.poll(async () => (await desktop.evaluate(() => window.ade.invoke('config:get'))).repositories.length).toBe(before.repositories.length + 1);
    await page.reload(); proxy.loseConversationActionReplies(false);
    await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor(); dialog = await open();
    await dialog.getByLabel('Gespräch auswählen', { exact: true }).selectOption(conversationId);
    card = dialog.getByRole('article', { name: 'Projekt aus Gespräch · Music From Tablet', exact: true });
    await card.getByText('In ADE erfasst', { exact: true }).waitFor();
    const config = await desktop.evaluate(() => window.ade.invoke('config:get'));
    const repo = config.repositories.find(r => r.name === project.name)!;
    check('lost tablet reply and reload retain exactly one new project', config.repositories.length === before.repositories.length + 1);
    check('real project contains both reviewed context files', readFileSync(join(repo.rootPath, 'PROJECT.md'), 'utf8') === project.context
      && readFileSync(join(repo.rootPath, 'AGENTS.md'), 'utf8').includes('PROJECT.md'));
    check('new project is coordinated without a separate mode-setting step', (await desktop.evaluate(() => window.ade.invoke('supervision:get'))).projects.some(p => p.repositoryId === repo.id && p.mode === 'coordinate'));
    check('project creation does not launch an unreviewed implementation task', config.runs.length === before.runs.length);
    for (const width of [800, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      check(`project preview fits ${width}px with touch controls`, await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1 && [...node.querySelectorAll('.conversation-action button')].every(b => b.getBoundingClientRect().height >= 44)));
      await card.screenshot({ path: join(evidence, `conversation-project-${width}.png`) });
    }
    await dialog.getByRole('button', { name: 'Mit diesem Kontext weiterreden', exact: true }).click();
    await expect(dialog.getByLabel('Nachricht an ADE', { exact: true })).toHaveValue(new RegExp(conversationId));
    check('one-click continuation carries the old conversation into a fresh writable context', await dialog.getByLabel('Gespräch auswählen', { exact: true }).inputValue() !== conversationId
      && await dialog.getByLabel('Nachricht an ADE', { exact: true }).isEditable());
    // Focus lands after the fresh conversation renders; poll instead of sampling once (raced under load).
    check('continuation focuses the draft without sending or launching on its own', await expect(dialog.getByLabel('Nachricht an ADE', { exact: true })).toBeFocused({ timeout: 5_000 }).then(() => true, () => false)
      && (await desktop.evaluate(() => window.ade.invoke('config:get'))).runs.length === before.runs.length);

    // A second, explicit proposal includes its first task. Creation-only above
    // remains covered; selecting a profile never starts work by implication.
    await page.setViewportSize({ width: 800, height: 1000 });
    const startConversationId = await dialog.getByLabel('Gespräch auswählen', { exact: true }).inputValue();
    const beforeStart = await desktop.evaluate(() => window.ade.invoke('config:get'));
    const worker = beforeStart.agents.find(agent => agent.id === profileId)!;
    const startedProject = { name: 'Music With First Task', context: '# First project task\nCreate the audio prototype and ask which result text to write.',
      agentsMd: '# Project rules\nWork only in this workspace. Keep AGENTS.md and PROJECT.md unchanged. Do not edit Git metadata.', githubRepo: '',
      start: { agentId: profileId, prompt: 'ADE_TABLET_PROJECT_TASK write the confirmed answer to tablet-result.txt' } };
    await dialog.getByLabel('Nachricht an ADE', { exact: true }).fill('prepare-project:' + JSON.stringify(startedProject));
    await dialog.getByRole('button', { name: 'An ADE senden', exact: true }).click();
    let startCard = dialog.getByRole('article', { name: 'Projekt aus Gespräch · Music With First Task', exact: true });
    const startButton = startCard.getByRole('button', { name: 'Projekt anlegen und Arbeit starten', exact: true });
    await expect(startButton).toBeEnabled();
    await expect(startCard.locator('pre').first()).toHaveText(startedProject.context);
    const reviewedInstructions = await startCard.locator('pre').last().textContent();
    if (reviewedInstructions === null) throw new Error('Missing reviewed project instructions');
    check('combined proposal shows the selected bypass worker before any repository or task is created',
      (await startCard.innerText()).includes(worker.name) && (await startCard.innerText()).includes('Bypass')
      && (await desktop.evaluate(() => window.ade.invoke('config:get'))).repositories.length === beforeStart.repositories.length
      && (await desktop.evaluate(() => window.ade.invoke('config:get'))).runTasks.length === beforeStart.runTasks.length);
    proxy.loseConversationActionReplies(true);
    await startButton.focus(); await startButton.press('Enter');
    await expect.poll(async () => (await desktop.evaluate(() => window.ade.invoke('config:get'))).runTasks.length, { timeout: 30_000 }).toBe(beforeStart.runTasks.length + 1);
    await page.reload(); proxy.loseConversationActionReplies(false);
    await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor(); dialog = await open();
    await dialog.getByLabel('Gespräch auswählen', { exact: true }).selectOption(startConversationId);
    startCard = dialog.getByRole('article', { name: 'Projekt aus Gespräch · Music With First Task', exact: true });
    await startCard.getByText(/In ADE erfasst/).waitFor();
    await startCard.getByText('Welchen Text soll die Ergebnisdatei enthalten?', { exact: true }).waitFor();
    const launched = await desktop.evaluate(() => window.ade.invoke('config:get'));
    const created = launched.repositories.find(repository => repository.name === startedProject.name)!;
    const child = launched.runTasks.find(task => task.repositoryId === created.id)!;
    const participant = launched.runParticipants.find(item => item.id === child.participantId)!;
    const binding = launched.workspaceBindings.find(item => item.id === child.workspaceBindingId)!;
    const actions = await desktop.evaluate(conversationId => window.ade.invoke('conversation:actionsQuery', { operation: 'list', conversationId }), startConversationId);
    if (!Array.isArray(actions)) throw new Error('Expected conversation action summaries');
    const action = actions.find(item => item.projectName === startedProject.name)!;
    check('lost combined-start reply and reload retain exactly one repository, run and task',
      launched.repositories.length === beforeStart.repositories.length + 1 && launched.runs.length === beforeStart.runs.length + 1
      && launched.runTasks.length === beforeStart.runTasks.length + 1
      && !await startCard.getByRole('button', { name: 'Projekt anlegen und Arbeit starten', exact: true }).count());
    // Single-task submissions use the managed launcher, but deliberately have
    // manual phase/managed:false instead of entering the multi-phase run machine.
    check('first task follows the native single-task contract with the exact parent and worker',
      child.phase === 'manual' && child.managed === false && child.allowQuestions === true
      && action.runId === child.runId && action.taskId === child.id && action.startsWork === true
      && participant.agentId === profileId && participant.runtime === 'codex'
      && launched.runs.find(run => run.id === child.runId)?.mode === 'manual');
    const supervision = (await desktop.evaluate(() => window.ade.invoke('supervision:get'))).projects.find(item => item.repositoryId === created.id)!;
    check('first task is linked to the created Coordinate project', supervision.mode === 'coordinate'
      && supervision.links.some(link => link.target.id === child.runId) && binding.repositoryId === created.id && binding.workspaceDir !== created.rootPath);
    const originalContext = readFileSync(join(created.rootPath, 'PROJECT.md'));
    const originalInstructions = readFileSync(join(created.rootPath, 'AGENTS.md'));
    check('created repository preserves the reviewed context and instructions byte for byte',
      originalContext.equals(Buffer.from(startedProject.context, 'utf8')) && originalInstructions.equals(Buffer.from(reviewedInstructions, 'utf8')));
    // Git may check out CRLF under core.autocrlf; only worktree text comparison
    // normalizes that representation, never the original reviewed root files.
    const lf = (text: string) => text.replace(/\r\n/g, '\n');
    check('worker receives the committed project context and agent instructions in its leased workspace',
      lf(readFileSync(join(binding.workspaceDir, 'PROJECT.md'), 'utf8')) === lf(startedProject.context)
      && lf(readFileSync(join(binding.workspaceDir, 'AGENTS.md'), 'utf8')) === lf(originalInstructions.toString('utf8')));
    const native = JSON.parse(readFileSync(join(binding.workspaceDir, 'fixture-thread.json'), 'utf8')) as {
      lastPrompt: string; threadStart: { sandbox: string; approvalPolicy: string; model: string; config: Record<string, unknown> };
    };
    check('first worker uses the actual native bypass request with saved model and reasoning', native.threadStart.sandbox === 'danger-full-access'
      && native.threadStart.approvalPolicy === 'never' && native.threadStart.model === worker.codexModel
      && native.threadStart.config.model_reasoning_effort === worker.codexReasoningEffort && native.lastPrompt.includes('ADE_TABLET_PROJECT_TASK'));
    await startCard.getByLabel('Deine Antwort', { exact: true }).fill('PROJECT_STARTED_FROM_TABLET');
    await startCard.getByRole('button', { name: 'Antwort senden', exact: true }).click();
    await startCard.getByText('ADE_CODEX_TASK_DONE: PROJECT_STARTED_FROM_TABLET', { exact: true }).waitFor();
    const completed = await desktop.evaluate(() => window.ade.invoke('config:get'));
    check('combined project card carries the exact worker question, answer and completed result',
      completed.runTasks.find(task => task.id === child.id)?.questions?.[0]?.status === 'answered'
      && readFileSync(join(binding.workspaceDir, 'tablet-result.txt'), 'utf8') === 'PROJECT_STARTED_FROM_TABLET');
    await page.reload(); await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor(); dialog = await open();
    await dialog.getByLabel('Gespräch auswählen', { exact: true }).selectOption(startConversationId);
    startCard = dialog.getByRole('article', { name: 'Projekt aus Gespräch · Music With First Task', exact: true });
    await startCard.getByText('ADE_CODEX_TASK_DONE: PROJECT_STARTED_FROM_TABLET', { exact: true }).waitFor();
    const restored = await desktop.evaluate(() => window.ade.invoke('config:get'));
    check('completed first task remains readable after another reload without a duplicate run',
      restored.repositories.length === launched.repositories.length && restored.runs.length === launched.runs.length && restored.runTasks.length === launched.runTasks.length);
    check('worker execution and reload leave original project files byte-for-byte unchanged',
      readFileSync(join(created.rootPath, 'PROJECT.md')).equals(originalContext)
      && readFileSync(join(created.rootPath, 'AGENTS.md')).equals(originalInstructions));
    for (const width of [800, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      check(`combined project result fits ${width}px with touch controls`, await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1
        && [...node.querySelectorAll('.conversation-action button')].every(button => button.getBoundingClientRect().height >= 44)));
      await startCard.screenshot({ path: join(evidence, `conversation-project-start-${width}.png`) });
    }
  } catch (error) {
    await page.screenshot({ path: join(evidence, 'conversation-project-failure.png') });
    console.error(await page.locator('.conversation-panel').innerText().catch(() => 'No conversation')); throw error;
  } finally { await browser.close(); await proxy.close(); }
}
