import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from 'playwright/test';
import { expandSessionControls } from './terminalControls';

/** Real desktop/tablet requests and native PTYs; the driver puts deterministic
 * local Codex executables first on PATH, so these assertions never call a model. */
export async function projectDefaultProfileFlow(desktop: Page, tablet: Page, root: string, evidence: string,
  check: (label: string, ok: boolean) => void): Promise<void> {
  const parent = join(root, 'profile-projects'); const repo = join(parent, 'Saved profile');
  mkdirSync(repo, { recursive: true });
  const instructions = '# Existing project\nKEEP_PROJECT_INSTRUCTIONS\n';
  writeFileSync(join(repo, 'AGENTS.md'), instructions);
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true });
  git('init', '--initial-branch=main'); git('add', 'AGENTS.md');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Existing project instructions');
  const setup = await desktop.evaluate(async rootPath => {
    const category = await window.ade.invoke('category:create', { name: 'Project profile fixtures' });
    const profile = await window.ade.invoke('agent:create', { categoryId: category.id, name: 'Project Bypass', runtime: 'codex',
      permissionMode: 'bypass', codexModel: 'gpt-6-astra', codexReasoningEffort: 'xhigh', defaultRepositoryId: null });
    await window.ade.invoke('agent:create', { categoryId: category.id, name: 'Other Codex', runtime: 'codex',
      permissionMode: 'default', codexModel: 'gpt-5.6-sol', codexReasoningEffort: 'low', defaultRepositoryId: null });
    await window.ade.invoke('projectDefaults:save', { rootPath, agentId: profile.id });
    const device = (await window.ade.invoke('remoteDevices:list')).devices.find(item => item.name === 'Terminal tablet')!;
    await window.ade.invoke('remoteDevices:setAdminScopes', { deviceId: device.id,
      scopes: [...new Set([...(device.adminScopes ?? []), 'projects:write' as const])], resourceAccess: { mode: 'all' } });
    return { profileId: profile.id, bindings: (await window.ade.invoke('config:get')).workspaceBindings.length };
  }, parent);
  const proof = join(repo, 'session-launch-proof.txt');
  const argv = async () => {
    await expect.poll(() => existsSync(proof) ? readFileSync(proof, 'utf8') : '').toContain('ADE_SESSION_CODEX_READY');
    return readFileSync(proof, 'utf8');
  };
  const hasProfileArguments = (value: string) => value.includes('--dangerously-bypass-approvals-and-sandbox')
    && value.includes('--model gpt-6-astra') && /model_reasoning_effort=["']?xhigh/.test(value);
  await desktop.keyboard.press('Escape'); await desktop.getByRole('tab', { name: 'Projekte', exact: true }).click();
  await desktop.getByRole('button', { name: 'Alle', exact: true }).click();
  await desktop.getByRole('button', { name: 'Workspace öffnen: Saved profile', exact: true }).click();
  const terminal = desktop.getByRole('region', { name: 'Projekt-Terminal', exact: true });
  const shortcut = terminal.getByRole('button', { name: 'Codex öffnen · Project Bypass · Bypass', exact: true });
  await expect(shortcut).toBeEnabled(); await shortcut.focus(); await expect(shortcut).toBeFocused(); await shortcut.press('Enter');
  await terminal.getByLabel('CLI- und Terminalstatus', { exact: true }).filter({ hasText: 'Terminal beendet' }).waitFor();
  const config = await desktop.evaluate(() => window.ade.invoke('config:get'));
  const workspace = config.projectWorkspaces.find(item => item.workspaceDir === repo)!;
  const sessions = async () => (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.filter(item => item.projectWorkspaceId === workspace.id);
  const first = (await sessions())[0]!;
  check('desktop keyboard shortcut selects the saved default among two native Codex profiles', first.launchChoice?.mode === 'agent'
    && first.launchProfileId === setup.profileId && first.launchProfileName === 'Project Bypass' && !first.agentId);
  check('desktop native process receives saved bypass, model and reasoning flags', hasProfileArguments(await argv()));
  check('profile launch stays in the selected existing checkout and branch', first.workspaceDir === repo && first.branch === 'main'
    && config.workspaceBindings.length === setup.bindings && readFileSync(join(repo, 'AGENTS.md'), 'utf8') === instructions);
  await desktop.evaluate(id => window.ade.invoke('pty:kill', { sessionId: id }), first.id); unlinkSync(proof);

  await tablet.keyboard.press('Escape'); await tablet.getByRole('tab', { name: 'Projekte', exact: true }).click();
  await tablet.getByRole('button', { name: 'Alle', exact: true }).click();
  await tablet.getByRole('button', { name: 'Workspace öffnen: Saved profile', exact: true }).click();
  const dialog = tablet.getByRole('dialog', { name: 'Projekt · Saved profile', exact: true });
  await dialog.getByRole('button', { name: 'Workspace öffnen', exact: true }).click();
  const picker = dialog.getByLabel('Projekt-CLI', { exact: true });
  await expect(picker.locator('option[value="codex"]')).toHaveText('Project Bypass · Bypass');
  await picker.selectOption('codex');
  const tabletOpen = dialog.getByRole('button', { name: 'Codex öffnen', exact: true });
  await expect(tabletOpen).toBeEnabled(); await tabletOpen.focus(); await tabletOpen.press('Enter');
  await dialog.getByLabel('CLI- und Terminalstatus', { exact: true }).filter({ hasText: 'Terminal beendet' }).waitFor();
  const second = (await sessions()).find(item => item.id !== first.id)!;
  check('tablet Codex picker launches the exact saved default profile in the original checkout', second.launchChoice?.mode === 'agent'
    && second.launchProfileId === setup.profileId && second.workspaceDir === repo && second.branch === 'main' && !second.agentId);
  check('tablet native process receives the same bypass, model and reasoning flags', hasProfileArguments(await argv()));
  await tablet.screenshot({ path: join(evidence, 'project-default-profile-tablet.png') });

  // A real shell remains alive, allowing the collapsed-control failure from the
  // tablet incident to be exercised independently of the short-lived Codex fixture.
  await expandSessionControls(dialog); await picker.selectOption('shell');
  await dialog.getByRole('button', { name: 'Leeres Terminal öffnen', exact: true }).click();
  await dialog.getByLabel('CLI- und Terminalstatus', { exact: true }).filter({ hasText: /^Terminal offen$/ }).waitFor();
  await dialog.locator('.m-dialog-head').getByText('Eingabe: Du (Tablet)', { exact: true }).waitFor();
  const shell = (await sessions()).find(item => item.launchChoice?.mode === 'shell')!;
  check('empty terminal still launches without an inherited Codex profile', !!shell && !shell.launchProfileId);
  await expandSessionControls(dialog);
  await dialog.locator('.m-terminal-focus-bar').getByRole('button', { name: 'Eingabe freigeben', exact: true }).click();
  await dialog.locator('.m-dialog-head').getByText('Eingabe: Desktop', { exact: true }).waitFor();
  const toggle = dialog.getByRole('button', { name: 'Sitzung & Workspace', exact: true });
  if (await toggle.getAttribute('aria-expanded') === 'true') { await toggle.focus(); await toggle.press('Enter'); }
  check('session controls collapse with the keyboard while the shell stays live', await toggle.getAttribute('aria-expanded') === 'false'
    && !await picker.isVisible());
  const failure = 'Fixture: Aktionsspeicher voll, Eingabe konnte nicht übernommen werden.';
  let failedClaims = 0;
  await tablet.route('**/api/v1/terminal/command', async route => {
    if (route.request().postDataJSON().operation !== 'claim') { await route.continue(); return; }
    failedClaims++; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable', message: failure }) });
  });
  try {
    const claim = dialog.getByRole('button', { name: 'Eingabe übernehmen', exact: true }).filter({ visible: true }).first();
    await claim.focus(); await claim.press('Enter');
    await expect(dialog.getByRole('alert').filter({ hasText: failure }).first()).toBeVisible();
    check('failed takeover is visible with controls collapsed and is not silently repeated', failedClaims === 1
      && await toggle.getAttribute('aria-expanded') === 'false' && !await picker.isVisible());
    await tablet.screenshot({ path: join(evidence, 'project-collapsed-takeover-error.png') });
  } finally { await tablet.unroute('**/api/v1/terminal/command'); }
  await toggle.focus(); await toggle.press('Enter');
  await dialog.getByRole('button', { name: 'Terminalaktion erneut prüfen', exact: true }).click();
  await dialog.locator('.m-dialog-head').getByText('Eingabe: Du (Tablet)', { exact: true }).waitFor();
  check('explicit retry recovers ownership on the same live shell after the failure is removed',
    (await sessions()).filter(item => item.launchChoice?.mode === 'shell').length === 1 && !(await dialog.getByRole('alert').filter({ hasText: failure }).count()));
  for (const session of await sessions()) await desktop.evaluate(id => window.ade.invoke('pty:kill', { sessionId: id }), session.id);
  check('project instructions and main branch remain unchanged after desktop/tablet profile launches',
    readFileSync(join(repo, 'AGENTS.md'), 'utf8') === instructions && git('branch', '--show-current').trim() === 'main');
}
