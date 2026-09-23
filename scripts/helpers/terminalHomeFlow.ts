import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { expandSessionControls, terminalLauncher } from './terminalControls';

export async function terminalHomeFlow(desktop: Page, page: Page, root: string, evidence: string,
  check: (name: string, ok: boolean) => void): Promise<void> {
  for (const window of [desktop, page]) for (let i = 0; i < 4 && await window.locator('[role="dialog"],dialog[open]').count(); i++) await window.keyboard.press('Escape');
  const devices = await desktop.evaluate(() => window.ade.invoke('remoteDevices:list'));
  const device = devices.devices.find((item) => item.name === 'Terminal tablet')!;
  await desktop.evaluate((deviceId) => window.ade.invoke('remoteDevices:setAdminScopes', { deviceId, scopes: ['terminal:control', 'workspace:read'], resourceAccess: { mode: 'all' } }), device.id);
  const before = await desktop.evaluate(() => window.ade.invoke('config:get'));
  const sessions = async () => (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions;
  const homeSessions = async () => (await sessions()).filter((item) => item.scopeSource === 'terminal-home');
  await desktop.getByRole('tab', { name: 'Terminals', exact: true }).click();
  await desktop.locator('.strip-actions').getByRole('button', { name: 'Terminal öffnen', exact: true }).click();
  const launch = desktop.getByRole('dialog', { name: 'Neue Terminalsitzung', exact: true });
  await launch.getByText('Umgebung: Windows', { exact: true }).waitFor();
  check('desktop home launcher has focus and no mandatory agent/project', await launch.evaluate((node) => node.contains(document.activeElement)
    && !node.querySelector('[aria-label="Sitzungsprojekt"]') && node.querySelector<HTMLOptionElement>('option[value="agent"]')?.disabled === true));
  await launch.getByRole('button', { name: 'Sitzung starten', exact: true }).click();
  await launch.waitFor({ state: 'hidden' });
  const shell = (await homeSessions()).at(-1)!;
  check('desktop creates a real native home PTY with no agent/project metadata', !!shell && !shell.agentId && !shell.repositoryId
    && shell.executionBackend === 'native' && shell.workspaceDir === join(root, 'terminal-home') && shell.launchChoice?.mode === 'shell');
  await desktop.getByRole('button', { name: 'Neue Sitzung', exact: true }).focus(); await desktop.keyboard.press('Control+Shift+T');
  await launch.waitFor(); await desktop.keyboard.press('Escape');
  check('free terminal keyboard launcher restores focus when cancelled', await desktop.getByRole('button', { name: 'Neue Sitzung', exact: true }).evaluate((node) => node === document.activeElement));
  await page.getByRole('tab', { name: 'Terminals', exact: true }).click();
  const navigation = page.getByRole('complementary', { name: 'Agents und Terminals', exact: true });
  await navigation.getByRole('button', { name: /Shell.*Benutzerverzeichnis/ }).last().click();
  const terminal = page.getByRole('region', { name: 'Interaktives Terminal', exact: true });
  await terminal.getByLabel('Terminalanzeige', { exact: true }).waitFor();
  check('mobile terminal view attaches desktop home session without starting another PTY', (await homeSessions()).length === 1);
  await terminal.getByRole('button', { name: 'Eingabe übernehmen', exact: true }).click();
  await terminal.getByText('Eingabe: Du (Tablet)', { exact: true }).waitFor();
  await terminal.getByLabel('Terminalanzeige', { exact: true }).getByText(/PS \[path\]>/).last().waitFor();
  await terminal.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type("Write-Output 'ADE_HOME_ECHO'", { delay: 30 }); await page.keyboard.press('Enter');
  await terminal.getByLabel('Terminalanzeige', { exact: true }).getByText('ADE_HOME_ECHO', { exact: false }).last().waitFor();
  check('phone keyboard input reaches the same real home shell', Buffer.from((await desktop.evaluate((id) => window.ade.invoke('pty:attach', { sessionId: id }), shell.id)).replayBase64, 'base64').toString().includes('ADE_HOME_ECHO'));
  const beforeKeyboardViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 400 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await page.locator('.m-terminals-page .m-keyboard-compact').waitFor();
  const keyboardInput = terminal.getByLabel('Direkte Terminal-Eingabe', { exact: true });
  const keyboardToggle = page.getByRole('button', { name: 'Terminal-Bedienung', exact: true });
  check('free-terminal keyboard layout preserves input focus and at least 274px of screen', await keyboardInput.evaluate((node) => node === document.activeElement)
    && await terminal.getByLabel('Terminalanzeige', { exact: true }).evaluate((node) => node.getBoundingClientRect().height >= 274));
  check('free-terminal keyboard keys stay inside the visible viewport', await terminal.getByRole('button', { name: /^Terminaltaste / }).evaluateAll((nodes) => nodes.length === 8
    && nodes.every((node) => { const rect = node.getBoundingClientRect(); return rect.height >= 44 && rect.bottom <= 400; })));
  check('free-terminal keyboard controls fit the phone width', await keyboardToggle.evaluate((node) => {
    const rect = node.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= 400
      && document.documentElement.scrollWidth <= innerWidth + 1;
  }));
  await page.screenshot({ path: join(evidence, 'terminal-home-keyboard.png'), clip: { x: 0, y: 0, width: 390, height: 400 } });
  await keyboardToggle.click();
  check('keyboard controls expand without taking focus from the free terminal', await keyboardToggle.getAttribute('aria-expanded') === 'true'
    && await keyboardInput.evaluate((node) => node === document.activeElement));
  await page.evaluate(() => { Reflect.deleteProperty(window.visualViewport!, 'height'); window.visualViewport!.dispatchEvent(new Event('resize')); });
  await keyboardToggle.waitFor({ state: 'hidden' });
  check('closing keyboard restores the terminal view navigation', await page.getByRole('tab', { name: 'Terminals', exact: true }).isVisible());
  await page.setViewportSize(beforeKeyboardViewport);
  await keyboardInput.focus();
  await page.keyboard.type("1..350 | ForEach-Object { Write-Output ('SCROLL_LINE_' + $_) }; Start-Sleep -Seconds 8; Write-Output ('SCROLL_LIVE_' + 'UPDATE')", { delay: 5 });
  await page.keyboard.press('Enter');
  await terminal.getByLabel('Terminal-Textverlauf', { exact: true }).getByText('SCROLL_LINE_350', { exact: false }).waitFor({ state: 'attached' });
  await terminal.getByLabel('Terminalanzeige', { exact: true }).hover(); await page.mouse.wheel(0, -300);
  const history = terminal.getByLabel('Terminalverlauf lesen', { exact: true }); await history.waitFor();
  check('wheel up opens focusable history beyond the live screen', (await history.innerText()).includes('SCROLL_LINE_1\n')
    && await history.evaluate((node) => node === document.activeElement && node.scrollHeight > node.clientHeight));
  await history.evaluate((node) => { node.scrollTop = 0; });
  const frozen = await history.innerText();
  await terminal.getByLabel('Terminal-Textverlauf', { exact: true }).getByText('SCROLL_LIVE_UPDATE', { exact: false }).waitFor({ state: 'attached' });
  check('incoming output preserves the text and scroll position being read', await history.innerText() === frozen && await history.evaluate((node) => node.scrollTop === 0));
  await page.keyboard.press('Escape'); await history.waitFor({ state: 'hidden' });
  check('Escape returns focus to the history button', await terminal.getByRole('button', { name: 'Verlauf', exact: true }).evaluate((node) => node === document.activeElement));
  await page.keyboard.press('Shift+PageUp'); await history.waitFor();
  check('keyboard history refreshes the snapshot on reopening', (await history.innerText()).includes('SCROLL_LIVE_UPDATE'));
  await terminal.getByRole('button', { name: 'Zur Live-Ausgabe', exact: true }).click();
  const touchBox = (await terminal.getByLabel('Terminalanzeige', { exact: true }).boundingBox())!;
  const touch = await page.context().newCDPSession(page);
  const touchPoint = { x: touchBox.x + 40, y: touchBox.y + 60 };
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...touchPoint, y: touchPoint.y + 80 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await touch.detach();
  await history.waitFor(); check('downward touch gesture opens readable history', await history.isVisible());
  await page.screenshot({ path: join(evidence, 'terminal-scroll-history.png') });
  await terminal.getByRole('button', { name: 'Zur Live-Ausgabe', exact: true }).click();
  await desktop.getByRole('tab', { name: 'Terminals', exact: true }).click();
  await desktop.getByRole('button', { name: 'Freie Terminals', exact: true }).click();
  await desktop.locator(`#session-tab-${shell.id}`).click();
  await desktop.waitForFunction((id) => document.activeElement === document.querySelector(`#session-panel-${id} .xterm-helper-textarea`), shell.id);
  check('clicking a desktop session tab focuses its terminal input', true);
  check('desktop paste toolbar respects tablet input ownership', await desktop.locator(`#session-panel-${shell.id}`).getByRole('button', { name: 'Einfügen', exact: true }).isDisabled());
  await desktop.locator(`#session-panel-${shell.id}`).getByRole('button', { name: 'Eingabe am Desktop übernehmen', exact: true }).click();
  await terminal.getByRole('button', { name: 'Eingabe übernehmen', exact: true }).waitFor();
  check('desktop can reclaim the mobile home terminal', !(await desktop.evaluate((id) => window.ade.invoke('terminal:control', { sessionId: id }), shell.id)).remote);
  await expandSessionControls(terminal);
  await terminal.getByLabel('Terminal-Schriftgrösse', { exact: true }).selectOption('18');
  await page.getByRole('button', { name: 'Zur hellen Darstellung wechseln', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  check('mobile light theme also updates the xterm screen', await terminal.locator('.xterm-viewport').evaluate((node) => getComputedStyle(node).backgroundColor !== 'rgb(14, 15, 18)'));
  await page.reload(); await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await terminal.getByLabel('Terminalanzeige', { exact: true }).waitFor();
  check('mobile reload preserves terminal view, session and font size', await page.getByRole('tab', { name: 'Terminals', exact: true }).getAttribute('aria-selected') === 'true'
    && await terminal.getByLabel('Terminal-Schriftgrösse', { exact: true }).inputValue() === '18' && (await homeSessions()).length === 1);
  await desktop.reload(); await desktop.getByRole('tab', { name: 'Terminals', exact: true }).click();
  await desktop.getByRole('button', { name: 'Freie Terminals', exact: true }).click();
  await desktop.locator('.terminal-host').first().waitFor();
  check('desktop reload restores home terminal tabs from main-owned sessions', await desktop.locator('.tabstrip [role="tab"]').count() === 1
    && await desktop.locator('.tabstrip .tab-title').innerText() === 'Shell' && (await homeSessions())[0]!.id === shell.id);
  for (const [mode, label] of [['codex', 'Codex'], ['claude', 'Claude CLI'], ['grok', 'Grok CLI']] as const) {
    await expandSessionControls(terminal);
    await terminal.getByLabel('Terminal-CLI', { exact: true }).selectOption(mode);
    await terminal.getByRole('button', { name: `${label} öffnen`, exact: true }).click();
    const deadline = Date.now() + 30_000;
    while (!(await homeSessions()).some((item) => item.launchChoice?.mode === mode && item.program?.status === 'exited')) {
      if (Date.now() >= deadline) throw new Error(`${mode} home CLI did not finish`);
      await new Promise((done) => setTimeout(done, 100));
    }
    await terminal.getByLabel('CLI- und Terminalstatus', { exact: true }).filter({ hasText: 'Terminal beendet' }).waitFor();
    check(`mobile starts ${mode} fixture in home with no profile and preserves CLI exit`, (await homeSessions()).some((item) => item.launchChoice?.mode === mode
      && item.workspaceDir === join(root, 'terminal-home') && !item.agentId && item.status === 'exited' && item.program?.status === 'exited' && item.program.exitCode === 0));
    check(`${mode} uses the requested home as its actual working directory`, readFileSync(join(root, 'terminal-home/session-launch-proof.txt'), 'utf8').includes(`ADE_SESSION_${mode.toUpperCase()}_READY`));
    await terminal.locator('.terminal-usage > summary').click();
    const usage = terminal.getByRole('region', { name: 'Abo-Nutzung', exact: true });
    await usage.getByRole('button', { name: 'Nutzung aktualisieren', exact: true }).waitFor();
    if (mode === 'codex') {
      await usage.getByText('7 Tage: 75 % übrig', { exact: true }).waitFor();
      check('Codex subscription quota is read through the account-only CLI fixture', await usage.getByRole('progressbar').getAttribute('value') === '25');
      const quotaSession = (await homeSessions()).find((item) => item.launchChoice?.mode === 'codex')!;
      check('desktop and mobile share the same bounded quota observation', (await desktop.evaluate((id) => window.ade.invoke('terminal:usage', { sessionId: id }), quotaSession.id)).windows[0]?.remainingPercent === 75);
    } else {
      await usage.getByText('/usage', { exact: true }).waitFor();
      check(`${mode} exposes its provider usage command without inventing a remaining percentage`, !(await usage.getByRole('progressbar').count()));
    }
    await terminal.locator('.terminal-usage > summary').click();
  }
  const after = await desktop.evaluate(() => window.ade.invoke('config:get'));
  check('agent-free launches create no identity, workspace or injected instructions', JSON.stringify(after.agents) === JSON.stringify(before.agents)
    && after.projectWorkspaces.length === before.projectWorkspaces.length && after.workspaceBindings.length === before.workspaceBindings.length
    && !existsSync(join(root, 'terminal-home/AGENTS.md')) && !existsSync(join(root, 'terminal-home/CLAUDE.md')));
  await terminalLauncher(terminal);
  await navigation.getByRole('button', { name: 'Sitzungen aktualisieren', exact: true }).click();
  await navigation.locator('button[aria-pressed="true"]').filter({ hasText: 'Grok Build' }).waitFor();
  check('session rail follows the CLI selected by the terminal launcher', true);
  await page.reload(); await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await terminal.getByLabel('CLI- und Terminalstatus', { exact: true }).filter({ hasText: 'Terminal beendet' }).waitFor();
  const restoredGrok = (await homeSessions()).findLast(item => item.launchChoice?.mode === 'grok')!;
  // Terminal screen rendering follows its metadata by a frame.
  await terminal.getByLabel('Terminalanzeige', { exact: true }).getByText('ADE_SESSION_GROK_READY', { exact: false }).last().waitFor();
  check('reload restores the most recently launched ended CLI rather than an older shell', !!restoredGrok && restoredGrok.status === 'exited'
    && (await terminal.getByLabel('Terminalanzeige', { exact: true }).innerText()).includes('ADE_SESSION_GROK_READY'));
  await terminalLauncher(terminal);
  await terminal.locator('.m-terminal-tools > details > summary').first().click();
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.screenshot({ path: join(evidence, 'terminal-home-tablet.png') });
  check('wide mobile view has agents, terminal and inspector', await navigation.isVisible() && await page.getByRole('complementary', { name: 'Terminal-Kontext', exact: true }).isVisible());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(evidence, 'terminal-home-phone.png') });
  check('phone terminal navigation and controls fit without page overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
    && await page.getByRole('button', { name: 'Agents und Sitzungen', exact: true }).isVisible());
  await page.getByRole('button', { name: 'Agents und Sitzungen', exact: true }).click();
  check('phone exposes the session rail on demand', await navigation.isVisible());
  await navigation.getByRole('button', { name: 'Freie Terminals', exact: true }).click();
  await page.getByRole('button', { name: 'Terminal öffnen', exact: true }).click();
  await terminalLauncher(terminal);
  const sessionsBefore = await homeSessions(); const count = sessionsBefore.length;
  const runningBefore = sessionsBefore.filter(item => item.status === 'running').map(item => item.id).sort();
  const previousWireIds = await terminal.getByLabel('Terminal-Sitzung', { exact: true }).locator('option').evaluateAll(nodes => nodes.map(n => (n as HTMLOptionElement).value));
  await terminal.getByLabel('Sitzung starten mit', { exact: true }).selectOption('shell');
  await terminal.getByRole('button', { name: 'Sitzung starten', exact: true }).click();
  await terminal.getByLabel('Terminalanzeige', { exact: true }).waitFor();
  // The old screen remains mounted during launch. Wait for the new selected
  // session acknowledgement before reading host identities, not only before close.
  await page.waitForFunction(previous => {
    const selected = document.querySelector<HTMLSelectElement>('[aria-label="Terminal-Sitzung"]');
    return !!selected?.value && !previous.includes(selected.value) && !selected.disabled;
  }, previousWireIds);
  await terminal.getByLabel('CLI- und Terminalstatus', { exact: true }).filter({ hasText: /^Terminal offen$/ }).waitFor();
  const afterOpen = await homeSessions();
  const added = afterOpen.find(item => !sessionsBefore.some(previous => previous.id === item.id));
  check('direct phone entry starts an additional free shell', afterOpen.length === count + 1 && !!added);
  if (!added) throw new Error('New free shell was not identified');
  await expandSessionControls(terminal);
  await terminal.getByRole('button', { name: 'Sitzung beenden', exact: true }).click();
  const confirmation = page.getByRole('dialog').last();
  check('terminal close confirmation takes keyboard focus', await confirmation.evaluate((node) => node.contains(document.activeElement)));
  await confirmation.getByRole('button', { name: 'Beenden bestätigen', exact: true }).click();
  await confirmation.waitFor({ state: 'hidden' });
  await terminal.getByText('Sitzung beendet.', { exact: true }).waitFor();
  // Command acknowledgement precedes ConPTY's asynchronous exit. Observe the
  // particular new session ending before comparing the untouched older ones.
  // Poll awaited IPC from Node: a Promise-returning browser predicate can
  // resolve waitForFunction even when its eventual value is false.
  let afterClose = await homeSessions();
  const closeDeadline = Date.now() + 10_000;
  while (afterClose.some(item => item.id === added.id && item.status === 'running') && Date.now() < closeDeadline) {
    await new Promise(done => setTimeout(done, 100));
    afterClose = await homeSessions();
  }
  const remaining = afterClose.filter(item => item.status === 'running').map(item => item.id).sort();
  const retained = JSON.stringify(remaining) === JSON.stringify(runningBefore);
  if (!retained) console.error('Home close identity mismatch', { added: added.id, before: runningBefore, after: remaining });
  check('closing one home terminal retains the other sessions', retained);
}
