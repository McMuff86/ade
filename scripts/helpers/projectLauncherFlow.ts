import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from 'playwright/test';
import { expandSessionControls } from './terminalControls';

/** Adi's setup on 2026-09-27: one profile per CLI (Codex and Claude Code with bypass,
 * Grok standard) and a project opened from the tablet's Projects tab. The driver puts
 * deterministic CLI fixtures first on PATH, so nothing here calls a model. */
export async function projectLauncherFlow(desktop: Page, tablet: Page, root: string, evidence: string,
  check: (label: string, ok: boolean) => void): Promise<void> {
  const parent = join(root, 'launcher-projects'); const repo = join(parent, 'Knuckles Pi');
  mkdirSync(repo, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true });
  git('init', '--initial-branch=main');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-m', 'Fixture');
  const profiles = await desktop.evaluate(async rootPath => {
    const category = await window.ade.invoke('category:create', { name: 'Launcher fixtures' });
    const created: Record<string, string> = {};
    for (const [name, runtime, permissionMode] of [['Codex', 'codex', 'bypass'], ['Claude Code', 'claude', 'bypass'], ['Grok', 'grok', 'default']] as const) {
      created[runtime] = (await window.ade.invoke('agent:create', { categoryId: category.id, name, runtime, permissionMode, defaultRepositoryId: null })).id;
    }
    await window.ade.invoke('projectDefaults:save', { rootPath, agentId: null });
    const device = (await window.ade.invoke('remoteDevices:list')).devices.find(item => item.name === 'Terminal tablet')!;
    await window.ade.invoke('remoteDevices:setAdminScopes', { deviceId: device.id,
      scopes: [...new Set([...(device.adminScopes ?? []), 'projects:write' as const])], resourceAccess: { mode: 'all' } });
    return created;
  }, parent);
  await tablet.setViewportSize({ width: 1480, height: 924 });
  await tablet.keyboard.press('Escape'); await tablet.getByRole('tab', { name: 'Projekte', exact: true }).click();
  await tablet.getByRole('button', { name: 'Alle', exact: true }).click();
  await tablet.getByRole('button', { name: 'Workspace öffnen: Knuckles Pi', exact: true }).click();
  const dialog = tablet.getByRole('dialog', { name: 'Projekt · Knuckles Pi', exact: true });
  const launcher = dialog.getByRole('region', { name: 'Sitzung starten', exact: true });
  await launcher.waitFor();
  check('the project card opens the existing folder without a second “Workspace öffnen”', await dialog.getByRole('button', { name: 'Workspace öffnen', exact: true }).count() === 0);

  const tile = (name: string) => launcher.getByRole('button', { name: `${name} öffnen`, exact: true });
  const described = async (name: string) => (await tile(name).getAttribute('aria-describedby'))
    ? await tablet.locator(`[id="${await tile(name).getAttribute('aria-describedby')}"]`).innerText() : '';
  await expect(tile('Codex')).toBeEnabled();
  const codex = await described('Codex'); const claude = await described('Claude Code'); const grok = await described('Grok Build'); const shell = await described('Leeres Terminal');
  check('Codex tile names its bypass profile and the literal start command', codex.includes('Ohne Rückfragen') && codex.includes('codex --dangerously-bypass-approvals-and-sandbox') && codex.includes('Profil Codex'));
  check('Claude Code tile shows --dangerously-skip-permissions', claude.includes('Ohne Rückfragen') && claude.includes('claude --dangerously-skip-permissions') && claude.includes('Profil Claude Code'));
  check('Grok tile says it asks before changes', grok.includes('Fragt vor Änderungen') && grok.includes('Profil Grok'));
  check('empty terminal tile opens a shell in the project folder', shell.includes('Shell im Projektordner'));
  check('no duplicate CLI picker, session picker or start-profile text remains', await dialog.getByLabel('Projekt-CLI', { exact: true }).count() === 0
    && await dialog.getByLabel('Terminal-Sitzung', { exact: true }).count() === 0 && await dialog.getByText(/^Startprofil:/).count() === 0
    && await dialog.getByText('Sitzung wählen', { exact: true }).count() === 0 && !(await dialog.innerText()).includes('Ohne Agent-Profil ·'));
  check('rarer options stay folded under one summary', await dialog.locator('.m-terminal-tools > details > summary').innerText() === 'Weitere Startoptionen'
    && await dialog.locator('.m-terminal-tools > details').getAttribute('open') === null);
  for (const [width, height] of [[1480, 924], [800, 1280], [390, 844]]) {
    await tablet.setViewportSize({ width, height }); await tablet.waitForTimeout(250);
    check(`launcher fits ${width}px with touch-sized tiles`, await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)
      && (await tile('Claude Code').boundingBox())!.height >= 44);
    await tablet.screenshot({ path: join(evidence, `launcher-${width}.png`) });
  }
  await tablet.setViewportSize({ width: 1480, height: 924 });

  // One tap (here: keyboard) starts Claude Code with the saved bypass profile.
  await tile('Claude Code').focus(); await tablet.keyboard.press('Enter');
  const proof = join(repo, 'session-launch-proof.txt');
  await expect.poll(() => existsSync(proof) ? readFileSync(proof, 'utf8') : '').toContain('ADE_SESSION_CLAUDE_READY');
  const sessions = async () => (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.filter(item => item.workspaceDir === repo);
  await expect.poll(async () => (await sessions()).length).toBe(1);
  const started = (await sessions())[0]!;
  check('one tap launches the saved Claude Code profile with --dangerously-skip-permissions', started.launchChoice?.mode === 'agent'
    && started.launchProfileId === profiles.claude && readFileSync(proof, 'utf8').includes('--dangerously-skip-permissions'));
  await dialog.getByLabel('Terminalanzeige', { exact: true }).waitFor();

  // The image button explains itself instead of sitting grey without a reason.
  // aria-disabled keeps it focusable and operable (Playwright treats it as not "enabled" for click).
  const image = dialog.getByRole('button', { name: 'Bild hinzufügen', exact: true });
  await image.focus(); await tablet.keyboard.press('Enter');
  const imageDialog = tablet.getByRole('dialog', { name: 'Bild und Nachricht', exact: true });
  const reason = await imageDialog.locator('.m-terminal-image-reason').innerText();
  check('an unavailable image handoff is tappable and says why', reason.length > 10 && await imageDialog.getByRole('button', { name: 'Bild und Nachricht senden', exact: true }).isDisabled());
  await tablet.keyboard.press('Escape'); await expect(image).toBeFocused();

  // A lost reply (e.g. during an ADE restart) no longer freezes every start button silently.
  await expandSessionControls(dialog);
  const newSession = dialog.getByRole('region', { name: 'Neue Sitzung', exact: true });
  await tablet.route('**/api/v1/terminal/command', async route => {
    if (route.request().postDataJSON().operation !== 'open') { await route.continue(); return; }
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable', message: 'Fixture: ADE startet neu.' }) });
  });
  try {
    await newSession.getByRole('button', { name: 'Codex öffnen', exact: true }).click();
    const pending = dialog.locator('.m-launch-pending');
    await pending.waitFor();
    check('an unconfirmed start names the action and offers check and discard', (await pending.innerText()).includes('„Codex öffnen“')
      && await pending.getByRole('button', { name: 'Terminalaktion erneut prüfen', exact: true }).isVisible()
      && await newSession.getByRole('button', { name: 'Codex öffnen', exact: true }).isDisabled());
    await tablet.screenshot({ path: join(evidence, 'launcher-pending.png') });
  } finally { await tablet.unroute('**/api/v1/terminal/command'); }
  await dialog.getByRole('button', { name: 'Verwerfen', exact: true }).click();
  await expect(newSession.getByRole('button', { name: 'Codex öffnen', exact: true })).toBeEnabled();
  check('discarding frees the start tiles without starting anything', await dialog.locator('.m-launch-pending').count() === 0 && (await sessions()).length === 1);

  // Sessions of this project are rows, not a select; the running one continues on tap.
  const row = dialog.locator(`[data-terminal-id]`).first();
  check('open sessions are listed as rows with their state', await row.getAttribute('aria-pressed') === 'true' && (await row.innerText()).includes('Claude Code'));
  await dialog.getByRole('button', { name: 'Leeres Terminal öffnen', exact: true }).click();
  await expect.poll(async () => (await sessions()).filter(item => item.launchChoice?.mode === 'shell').length).toBe(1);
  await dialog.getByLabel('CLI- und Terminalstatus', { exact: true }).filter({ hasText: /^Terminal offen$/ }).waitFor();
  await expandSessionControls(dialog);
  await dialog.locator(`[data-terminal-id]`).filter({ hasText: 'Claude Code' }).click();
  await dialog.getByLabel('CLI- und Terminalstatus', { exact: true }).filter({ hasText: 'Claude Code' }).waitFor();
  check('a session row switches back to the existing Claude Code session without a new process', (await sessions()).length === 2);
  for (const session of await sessions()) await desktop.evaluate(id => window.ade.invoke('pty:kill', { sessionId: id }), session.id);
}
