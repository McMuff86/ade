import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from 'playwright/test';

/** Real Electron renderer and ConPTY; provider CLIs are isolated deterministic fixtures. */
export async function desktopWorkspaceTerminalFlow(page: Page, root: string, evidence: string,
  check: (label: string, ok: boolean) => void): Promise<void> {
  const parent = join(root, 'workspace-tools'); const repo = join(parent, 'Direct workspace');
  mkdirSync(repo, { recursive: true });
  const instructions = '# Existing workspace instructions\nDIRECT_WORKSPACE_RULES\n';
  writeFileSync(join(repo, 'AGENTS.md'), instructions);
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true });
  git('init', '--initial-branch=main'); git('add', 'AGENTS.md');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Instructions');
  const configBefore = await page.evaluate(() => window.ade.invoke('config:get'));
  const errors: string[] = []; const onError = (error: Error) => errors.push(error.message); page.on('pageerror', onError);
  await page.evaluate((rootPath) => window.ade.invoke('projectDefaults:save', { rootPath, agentId: null }), parent);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Terminals view', exact: true }).click();
  const launchButton = page.locator('.strip-actions').getByRole('button', { name: 'Terminal öffnen', exact: true });
  await launchButton.click();
  const launch = page.getByRole('dialog', { name: 'Neue Terminalsitzung', exact: true });
  const picker = launch.getByLabel('Terminal-Workspace', { exact: true });
  await picker.locator('option').filter({ hasText: 'Direct workspace' }).waitFor({ state: 'attached' });
  check('independent launcher focuses workspace selection and keeps home available', await picker.evaluate(node => node === document.activeElement)
    && await picker.inputValue() === '' && await picker.locator('option[value=""]').count() === 1);
  const entryId = (await picker.locator('option').filter({ hasText: 'Direct workspace' }).getAttribute('value'))!;
  await picker.selectOption(entryId);
  await launch.getByText('Direct workspace · Branch main · Vorhandener Projekt-Workspace', { exact: true }).waitFor();
  await expect(launch.getByRole('button', { name: 'Sitzung starten', exact: true })).toBeEnabled();
  await launch.getByLabel('Sitzung starten mit', { exact: true }).selectOption('codex');
  await launch.getByRole('button', { name: 'Sitzung starten', exact: true }).click();
  await launch.waitFor({ state: 'hidden' });
  const terminal = page.getByRole('region', { name: 'Projekt-Terminal', exact: true });
  await terminal.getByLabel('CLI- und Terminalstatus', { exact: true }).filter({ hasText: 'Terminal beendet' }).waitFor();
  const config = await page.evaluate(() => window.ade.invoke('config:get'));
  const workspaceId = config.projectWorkspaces.find(item => item.workspaceDir === repo)!.id;
  const sessions = async () => (await page.evaluate(() => window.ade.invoke('pty:list'))).sessions.filter(item => item.projectWorkspaceId === workspaceId);
  const codex = (await sessions())[0]!;
  check('global launcher opens Codex in chosen project and branch with no assigned agent', codex.launchChoice?.mode === 'codex'
    && codex.workspaceDir === repo && codex.branch === 'main' && !codex.agentId && !codex.launchProfileId);
  await terminal.getByRole('button', { name: 'Claude Code öffnen', exact: true }).click();
  await expect.poll(async () => (await sessions()).length).toBe(2);
  await terminal.getByLabel('CLI- und Terminalstatus', { exact: true }).filter({ hasText: 'Terminal beendet' }).waitFor();
  check('one-click Claude launch is independent of the Codex session', (await sessions()).length === 2
    && (await sessions()).some(item => item.launchChoice?.mode === 'claude' && !item.agentId && !item.launchProfileId));
  await terminal.getByRole('button', { name: 'Leeres Terminal öffnen', exact: true }).click();
  await expect.poll(async () => (await sessions()).length).toBe(3);
  const shell = (await sessions()).find(item => item.launchChoice?.mode === 'shell')!;
  await terminal.getByRole('button', { name: 'Leeres Terminal öffnen', exact: true }).click();
  check('repeated shell quick action reuses one live terminal', (await sessions()).length === 3);
  await terminal.getByRole('button', { name: 'Zusätzliche Sitzung starten', exact: true }).click();
  await expect.poll(async () => (await sessions()).length).toBe(4);
  check('explicit additional session creates a separate shell', (await sessions()).filter(item => item.launchChoice?.mode === 'shell').length === 2);
  const tabs = terminal.getByRole('tablist', { name: 'Projekt-Terminalsitzungen', exact: true });
  await tabs.getByRole('tab').last().focus(); await page.keyboard.press('Home');
  await expect(tabs.getByRole('tab').first()).toBeFocused();
  check('Home moves tab selection and retains keyboard focus', await tabs.getByRole('tab').first().getAttribute('aria-selected') === 'true');
  await page.keyboard.press('ArrowRight'); await expect(tabs.getByRole('tab').nth(1)).toBeFocused();
  check('arrow keys select the neighbouring workspace session', await tabs.getByRole('tab').nth(1).getAttribute('aria-selected') === 'true');
  await page.locator(`#project-session-tab-${shell.id}`).click();
  await page.getByRole('button', { name: 'Git', exact: true }).click();
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  check('Git round trip preserves active project terminal', await page.locator(`#project-session-tab-${shell.id}`).getAttribute('aria-selected') === 'true');
  const panel = page.locator(`#project-session-panel-${shell.id}`);
  const input = panel.getByLabel('Terminal-Eingabe', { exact: true });
  await input.focus(); await page.keyboard.press('Control+PageDown');
  check('Ctrl+PageDown switches project terminal without typing into its shell', await page.locator(`#project-session-tab-${shell.id}`).getAttribute('aria-selected') === 'false');
  await page.keyboard.press('Control+PageUp');
  await expect(input).toBeFocused();
  await page.keyboard.type('1..100 | ForEach-Object { Write-Output ("ADE_HISTORY_" + $_) }', { delay: 1 }); await page.keyboard.press('Enter');
  await expect.poll(async () => Buffer.from((await page.evaluate((sessionId) => window.ade.invoke('pty:attach', { sessionId }), shell.id)).replayBase64, 'base64').toString()).toContain('ADE_HISTORY_100');
  await panel.getByLabel('Terminal-Schriftgrösse', { exact: true }).selectOption('17');
  check('font control resizes actual xterm text', await panel.locator('.xterm-rows').evaluate(node => getComputedStyle(node).fontSize) === '17px');
  await input.focus(); await page.keyboard.press('Control+Shift+F');
  const search = panel.getByLabel('Im Terminal suchen', { exact: true }); await expect(search).toBeFocused();
  await search.fill('ADE_HISTORY_12');
  await page.evaluate(() => window.ade.invoke('clipboard:writeText', { text: 'ADE_COPY_PENDING' }));
  // Font/search layout changes can still repaint ConPTY and clear a match.
  // Re-establish the selection and copy together; polling an untouched clipboard
  // cannot recover a click that raced the repaint. The exact value remains required.
  await expect(async () => {
    await search.press('Enter');
    await panel.getByRole('status').filter({ hasText: 'Treffer ausgewählt' }).waitFor({ timeout: 1000 });
    await panel.getByRole('button', { name: 'Kopieren', exact: true }).click({ timeout: 1000 });
    await expect.poll(async () => (await page.evaluate(() => window.ade.invoke('clipboard:readText'))).text, { timeout: 1000 }).toBe('ADE_HISTORY_12');
  }).toPass({ timeout: 10_000 }).catch(async error => {
    await page.screenshot({ path: join(evidence, 'desktop-copy-failure.png') });
    writeFileSync(join(evidence, 'desktop-copy-failure.json'), JSON.stringify({
      text: await panel.innerText(), selectionRects: await panel.locator('.xterm-selection div').count(),
      search: await search.inputValue(), copyDisabled: await panel.getByRole('button', { name: 'Kopieren', exact: true }).isDisabled(),
    }, null, 2));
    throw error;
  });
  check('terminal search finds scrollback and copies exact matching selection', true);
  await search.fill('NO_SUCH_TERMINAL_LINE');
  await panel.getByRole('status').filter({ hasText: 'Keine Treffer' }).waitFor();
  check('search exposes an explicit empty result', true);
  await search.press('Escape'); await expect(input).toBeFocused();
  check('Escape closes search and returns focus to terminal', !await search.isVisible());
  await panel.getByRole('button', { name: 'Verlauf-Anfang', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Zur Live-Ausgabe', exact: true })).toHaveClass(/terminal-live-return/);
  await panel.getByRole('button', { name: 'Zur Live-Ausgabe', exact: true }).click(); await expect(input).toBeFocused();
  check('history controls scroll to old output and return to live input', !((await panel.getByRole('button', { name: 'Zur Live-Ausgabe', exact: true }).getAttribute('class')) ?? '').includes('terminal-live-return'));
  await page.evaluate(() => window.ade.invoke('clipboard:writeText', { text: "Write-Output 'ADE_TOOLBAR_PASTE'" }));
  await panel.getByRole('button', { name: 'Einfügen', exact: true }).click(); await expect(input).toBeFocused(); await page.keyboard.press('Enter');
  await expect.poll(async () => Buffer.from((await page.evaluate((sessionId) => window.ade.invoke('pty:attach', { sessionId }), shell.id)).replayBase64, 'base64').toString()).toContain('ADE_TOOLBAR_PASTE');
  check('paste toolbar sends clipboard text to the existing shell', true);
  await page.screenshot({ path: join(evidence, 'desktop-workspace-terminals.png') });
  await page.reload(); await page.getByRole('tab', { name: 'Projekte view', exact: true }).click();
  await page.getByRole('button', { name: 'Alle', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace öffnen: Direct workspace', exact: true }).click();
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  await expect(terminal.getByRole('tabpanel').filter({ visible: true }).getByLabel('Terminal-Schriftgrösse', { exact: true })).toHaveValue('17');
  check('reload recovers project sessions and saved terminal font', await tabs.getByRole('tab').count() === 4
    && await terminal.getByRole('tabpanel').filter({ visible: true }).getByLabel('Terminal-Schriftgrösse', { exact: true }).inputValue() === '17');
  const claude = join(root, 'bin', 'claude.exe'); const hidden = join(root, 'bin', 'claude-unavailable.exe');
  renameSync(claude, hidden);
  try {
    await terminal.getByRole('button', { name: 'CLIs aktualisieren', exact: true }).click();
    await expect(terminal.getByRole('button', { name: 'CLIs aktualisieren', exact: true })).toBeEnabled();
    // A real provider installation later on PATH may remain available; the fixture
    // discovery result is not used as evidence that the actual CLI can authenticate.
    const options = await page.evaluate((projectWorkspaceId) => window.ade.invoke('session:options', { projectWorkspaceId }), workspaceId);
    check('quick action follows main-owned CLI discovery after refresh', await terminal.getByRole('button', { name: 'Claude Code öffnen', exact: true }).isDisabled()
      === !options.choices.find(item => item.mode === 'claude')?.available);
  } finally { renameSync(hidden, claude); }
  await terminal.getByRole('button', { name: 'CLIs aktualisieren', exact: true }).click();
  await expect(terminal.getByRole('button', { name: 'Claude Code öffnen', exact: true })).toBeEnabled();
  await terminal.getByLabel('Projekt-CLI', { exact: true }).selectOption('agent');
  await expect(terminal.getByRole('button', { name: 'Auswahl öffnen / fortsetzen', exact: true })).toBeDisabled();
  await terminal.getByLabel('Startprofil', { exact: true }).selectOption(configBefore.agents.find(item => item.name === 'Terminal Agent')!.id);
  await terminal.getByRole('button', { name: 'Auswahl öffnen / fortsetzen', exact: true }).click();
  await expect.poll(async () => (await sessions()).length).toBe(5);
  check('workspace profile selection is explicit and does not change ownership', (await sessions()).some(item => item.launchProfileName === 'Terminal Agent' && !item.agentId && item.workspaceDir === repo));
  await terminal.getByRole('button', { name: 'Claude Code öffnen', exact: true }).click();
  await expect.poll(async () => (await sessions()).length).toBe(6);
  const last = (await sessions()).at(-1)!;
  check('quick CLI action clears the previously selected profile from launch', last.launchChoice?.mode === 'claude' && !last.launchProfileId);
  const after = await page.evaluate(() => window.ade.invoke('config:get'));
  check('direct launches preserve agents, bindings and workspace instructions', after.agents.length === configBefore.agents.length
    && after.workspaceBindings.length === configBefore.workspaceBindings.length && readFileSync(join(repo, 'AGENTS.md'), 'utf8') === instructions);
  await page.locator(`#project-session-tab-${shell.id}`).click();
  await input.focus(); await page.keyboard.type('exit'); await page.keyboard.press('Enter');
  await expect(terminal.getByRole('button', { name: 'Sitzung neu starten', exact: true })).toBeVisible();
  check('ended project shell exposes restart and disables paste', await panel.getByRole('button', { name: 'Einfügen', exact: true }).isDisabled());
  await terminal.getByRole('button', { name: 'Sitzung neu starten', exact: true }).click();
  await expect.poll(async () => (await sessions()).some(item => item.id === shell.id)).toBe(false);
  const restarted = (await sessions()).at(-1)!;
  check('restart replaces only the ended session in its original workspace and branch', restarted.launchChoice?.mode === 'shell'
    && restarted.branch === 'main' && restarted.workspaceDir === repo && (await sessions()).length === 6);
  page.once('dialog', dialog => void dialog.dismiss());
  await terminal.getByRole('button', { name: 'Sitzung beenden', exact: true }).click();
  check('cancelled close preserves the running session', (await sessions()).some(item => item.id === restarted.id));
  page.once('dialog', dialog => void dialog.accept());
  await terminal.getByRole('button', { name: 'Sitzung beenden', exact: true }).click();
  await expect(tabs.getByRole('tab')).toHaveCount(5);
  await expect(tabs.getByRole('tab', { selected: true })).toBeFocused();
  await expect.poll(async () => (await sessions()).some(item => item.id === restarted.id)).toBe(false);
  check('confirmed close focuses the remaining selected tab', !(await sessions()).some(item => item.id === restarted.id));
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  await page.setViewportSize({ width: 720, height: 900 });
  await expect.poll(async () => terminal.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  check('workspace and terminal tools fit a narrow desktop', await terminal.evaluate(node => node.scrollWidth <= node.clientWidth + 1)
    && await terminal.getByRole('tabpanel').filter({ visible: true }).locator('.terminal-tools').evaluate(node => node.scrollWidth <= node.clientWidth + 1));
  await page.screenshot({ path: join(evidence, 'desktop-workspace-terminal-narrow.png') });
  await page.setViewportSize(viewport);
  for (const session of await sessions()) await page.evaluate((sessionId) => window.ade.invoke('pty:kill', { sessionId }), session.id);
  await page.getByRole('button', { name: 'Zur Projektübersicht', exact: true }).click();
  await page.getByRole('tab', { name: 'Terminals view', exact: true }).click();
  check('workspace terminal flow leaves no renderer errors', errors.length === 0);
  page.off('pageerror', onError);
}
