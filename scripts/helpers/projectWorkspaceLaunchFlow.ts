import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { terminalLauncher } from './terminalControls';
import type { mobileTlsProxy } from './mobileBrowser';

export async function projectWorkspaceLaunchFlow(desktop: Page, page: Page, root: string, evidence: string, proxy: Awaited<ReturnType<typeof mobileTlsProxy>>,
  check: (name: string, ok: boolean) => void): Promise<void> {
  const parent = join(root, 'cli-projects'); const repo = join(parent, 'Without profile'); mkdirSync(repo, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true });
  git('init', '--initial-branch=main'); writeFileSync(join(repo, 'AGENTS.md'), '# Project instructions\nPROJECT_RULES_ONLY\n');
  git('add', 'AGENTS.md'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Project rules');
  git('branch', 'feature/tablet');
  await desktop.evaluate((rootPath) => window.ade.invoke('projectDefaults:save', { rootPath, agentId: null }), parent);
  const before = await desktop.evaluate(() => window.ade.invoke('config:get'));
  const devices = await desktop.evaluate(() => window.ade.invoke('remoteDevices:list')); const device = devices.devices.find((item) => item.name === 'Terminal tablet')!;
  await desktop.evaluate(({ deviceId, scopes }) => window.ade.invoke('remoteDevices:setAdminScopes', { deviceId, scopes }),
    { deviceId: device.id, scopes: [...new Set([...(device.adminScopes ?? []), 'projects:write' as const, 'projectGit:write' as const])] });
  await desktop.keyboard.press('Escape'); await desktop.getByRole('tab', { name: 'Projekte view', exact: true }).click();
  await desktop.getByRole('button', { name: 'Workspace öffnen: Without profile', exact: true }).click();
  const terminal = desktop.getByRole('region', { name: 'Projekt-Terminal', exact: true });
  await terminal.getByRole('button', { name: 'Codex öffnen', exact: true }).click();
  await terminal.getByLabel('CLI- und Terminalstatus', { exact: true }).filter({ hasText: 'beendet · Terminal offen' }).waitFor();
  const config = await desktop.evaluate(() => window.ade.invoke('config:get')); const workspace = config.projectWorkspaces.find((item) => item.workspaceDir === repo)!;
  const sessions = async () => (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions;
  const codex = (await sessions()).find((item) => item.projectWorkspaceId === workspace.id)!;
  check('desktop Codex starts in original checkout with no agent or injected profile', !!workspace && codex.workspaceDir === repo && !codex.agentId && !codex.launchProfileId
    && config.agents.length === before.agents.length && config.workspaceBindings.length === before.workspaceBindings.length && readFileSync(join(repo, 'AGENTS.md'), 'utf8') === '# Project instructions\nPROJECT_RULES_ONLY\n');
  check('desktop project CLI exit is distinct from still open shell', codex.program?.status === 'exited' && codex.program.exitCode === 0 && codex.status === 'running');
  await desktop.locator('.project-branches > summary').click();
  await desktop.getByLabel('Projekt-Branch', { exact: true }).selectOption('refs/heads/feature/tablet');
  check('live project terminal blocks current-checkout branch switch', await desktop.getByRole('button', { name: 'Branch wechseln', exact: true }).isDisabled());
  desktop.once('dialog', (dialog) => void dialog.accept()); await terminal.getByRole('button', { name: 'Sitzung beenden', exact: true }).click();
  await terminal.getByText('CLI wählen und öffnen.', { exact: false }).waitFor();
  unlinkSync(join(repo, 'session-launch-proof.txt'));
  await desktop.getByRole('button', { name: 'Branches aktualisieren', exact: true }).click();
  await desktop.getByLabel('Projekt-Branch', { exact: true }).selectOption('refs/heads/feature/tablet');
  await desktop.getByRole('button', { name: 'Branch wechseln', exact: true }).click();
  const preview = desktop.getByRole('region', { name: 'Branch-Vorschau', exact: true });
  check('branch preview takes focus and does not mutate before acceptance', await preview.evaluate((node) => node.contains(document.activeElement)) && git('branch', '--show-current').trim() === 'main');
  await preview.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  check('cancel restores focus to stable branch chooser', await desktop.locator('.project-branches > summary').evaluate((node) => node === document.activeElement));
  await desktop.getByRole('button', { name: 'Branch wechseln', exact: true }).click();
  await preview.getByRole('button', { name: 'Branch-Aktion ausführen', exact: true }).click();
  await desktop.locator('.project-branches > summary').filter({ hasText: 'feature/tablet' }).waitFor();
  check('desktop branch action switches the exact selected existing checkout', git('branch', '--show-current').trim() === 'feature/tablet');
  await page.keyboard.press('Escape'); await page.getByRole('tab', { name: 'Projekte', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace öffnen: Without profile', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Projekt · Without profile', exact: true });
  await dialog.getByRole('button', { name: 'Workspace öffnen', exact: true }).click();
  await dialog.getByLabel('Projekt-CLI', { exact: true }).selectOption('claude');
  await dialog.getByRole('button', { name: 'Claude CLI öffnen', exact: true }).click();
  await dialog.getByLabel('CLI- und Terminalstatus', { exact: true }).filter({ hasText: 'beendet · Terminal offen' }).waitFor();
  const claude = (await sessions()).find((item) => item.projectWorkspaceId === workspace.id && item.launchChoice?.mode === 'claude')!;
  check('tablet Claude uses chosen branch and no saved profile', claude.workspaceDir === repo && claude.branch === 'feature/tablet' && !claude.agentId && !claude.launchProfileId);
  await dialog.getByRole('button', { name: 'Workspace einblenden', exact: true }).click();
  await terminalLauncher(dialog);
  await dialog.getByLabel('Sitzung starten mit', { exact: true }).selectOption('agent');
  await dialog.getByLabel('Startprofil', { exact: true }).selectOption(before.agents.find((agent) => agent.name === 'Terminal Agent')!.id);
  await dialog.getByRole('button', { name: 'Sitzung starten', exact: true }).click();
  await dialog.getByLabel('Terminalanzeige', { exact: true }).getByText('ADE_CONFIGURED_AGENT_READY', { exact: false }).last().waitFor();
  const profile = (await sessions()).find((item) => item.projectWorkspaceId === workspace.id && item.launchProfileId)!;
  check('explicit profile reuses settings but not its agent-owned workspace', profile.workspaceDir === repo && !profile.agentId && profile.launchProfileName === 'Terminal Agent' && !profile.workspaceBindingId);
  check('all project launches preserve repository instructions', readFileSync(join(repo, 'AGENTS.md'), 'utf8') === '# Project instructions\nPROJECT_RULES_ONLY\n');
  await dialog.getByRole('button', { name: 'Terminal vergrössern', exact: true }).click();
  await page.screenshot({ path: join(evidence, 'project-cli-tablet.png') });
  await page.keyboard.press('Escape'); await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: /Weiterarbeiten in Without profile mit Ohne Agent-Profil/ }).first().waitFor();
  check('Continue Work identifies project and optional profile honestly', await page.getByRole('button', { name: /Weiterarbeiten in Without profile mit Terminal Agent/ }).isVisible());
  await page.getByRole('button', { name: /Weiterarbeiten in Without profile mit Ohne Agent-Profil/ }).first().click();
  await dialog.getByLabel('Terminalanzeige', { exact: true }).waitFor();
  check('Continue Work reopens the same project session without another process', (await sessions()).filter((item) => item.projectWorkspaceId === workspace.id).length === 2);
  await page.setViewportSize({ width: 390, height: 844 });
  check('project terminal fits a phone viewport', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(evidence, 'project-cli-phone.png') });
  await page.setViewportSize({ width: 1280, height: 800 });
  await dialog.getByRole('button', { name: 'Workspace einblenden', exact: true }).click();
  await dialog.locator('.project-branches > summary').click();
  await dialog.getByLabel('Neuer Branch-Name', { exact: true }).fill('feature/parallel');
  await dialog.getByRole('button', { name: 'Branch anlegen', exact: true }).click();
  const mobilePreview = dialog.getByRole('region', { name: 'Branch-Vorschau', exact: true });
  check('tablet branch preview takes focus before creating a worktree', await mobilePreview.evaluate((node) => node.contains(document.activeElement))
    && !git('branch', '--list', 'feature/parallel').trim());
  await page.screenshot({ path: join(evidence, 'project-branch-preview.png') });
  proxy.loseProjectReplies(true);
  await mobilePreview.getByRole('button', { name: 'Branch-Aktion ausführen', exact: true }).click();
  await dialog.locator('.project-branches').getByRole('alert').waitFor(); proxy.loseProjectReplies(false);
  const createdCount = (await desktop.evaluate(() => window.ade.invoke('config:get'))).projectWorkspaces.length;
  await page.reload(); await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await dialog.getByRole('button', { name: 'Branch-Aktion erneut prüfen', exact: true }).click();
  await dialog.locator('.project-branches > summary').filter({ hasText: 'feature/parallel' }).waitFor();
  check('lost branch reply and reload replay one worktree creation', (await desktop.evaluate(() => window.ade.invoke('config:get'))).projectWorkspaces.length === createdCount);
  const parallel = (await desktop.evaluate(() => window.ade.invoke('config:get'))).projectWorkspaces.find((item) => item.repositoryId === workspace.repositoryId && item.id !== workspace.id)!;
  check('tablet creates separate branch while original terminal stays alive', !!parallel && parallel.workspaceDir !== repo
    && git('branch', '--show-current').trim() === 'feature/tablet' && (await sessions()).some((item) => item.id === profile.id && item.status === 'running'));
  await dialog.getByLabel('Projekt-CLI', { exact: true }).selectOption('grok');
  await dialog.getByRole('button', { name: 'Grok CLI öffnen', exact: true }).click();
  await dialog.getByLabel('CLI- und Terminalstatus', { exact: true }).filter({ hasText: 'beendet · Terminal offen' }).waitFor();
  check('tablet Grok starts in selected parallel checkout without profile', (await sessions()).some((item) => item.projectWorkspaceId === parallel.id
    && item.workspaceDir === parallel.workspaceDir && item.branch === 'feature/parallel' && item.launchChoice?.mode === 'grok' && !item.agentId && !item.launchProfileId));
  await dialog.getByRole('button', { name: 'Workspace einblenden', exact: true }).click();
  await dialog.getByLabel('Projekt-CLI', { exact: true }).selectOption('shell');
  await dialog.getByRole('button', { name: 'Leeres Terminal öffnen', exact: true }).click();
  await dialog.getByLabel('CLI- und Terminalstatus', { exact: true }).filter({ hasText: /^Terminal offen$/ }).waitFor();
  check('tablet empty terminal uses the same selected branch', (await sessions()).some((item) => item.projectWorkspaceId === parallel.id && item.launchChoice?.mode === 'shell' && item.branch === 'feature/parallel'));
  for (const session of (await sessions()).filter((item) => item.projectWorkspaceId === workspace.id || item.projectWorkspaceId === parallel.id)) await desktop.evaluate((id) => window.ade.invoke('pty:kill', { sessionId: id }), session.id);
  await page.keyboard.press('Escape');
  if (existsSync(join(repo, 'session-launch-proof.txt'))) unlinkSync(join(repo, 'session-launch-proof.txt'));
  check('final positive branch state remains selected after session cleanup', git('branch', '--show-current').trim() === 'feature/tablet');
  await desktop.getByRole('button', { name: 'Zur Projektübersicht', exact: true }).click();
  await desktop.getByText('Neues Projekt', { exact: true }).click();
  await desktop.getByLabel('Projektname', { exact: true }).fill('Desktop Garden');
  const preCreate = await desktop.evaluate(() => window.ade.invoke('config:get'));
  await desktop.getByRole('button', { name: 'Projekt anlegen und öffnen', exact: true }).click();
  await desktop.getByRole('heading', { name: 'Projekt · Desktop Garden', exact: true }).waitFor();
  const postCreate = await desktop.evaluate(() => window.ade.invoke('config:get'));
  const created = postCreate.repositories.find((item) => item.name === 'Desktop Garden')!;
  check('desktop creates named project on main and opens without an agent or CLI', created.rootPath === join(parent, 'desktop-garden')
    && execFileSync('git', ['-C', created.rootPath, 'branch', '--show-current'], { encoding: 'utf8', windowsHide: true }).trim() === 'main'
    && postCreate.agents.length === preCreate.agents.length && postCreate.workspaceBindings.length === preCreate.workspaceBindings.length
    && !(await sessions()).some((item) => item.repositoryId === created.id));
  await desktop.getByRole('tab', { name: 'Overview view', exact: true }).click();
  await desktop.getByRole('button', { name: /Desktop Garden/ }).click();
  await desktop.getByRole('button', { name: 'Projekt-Workspace öffnen', exact: true }).click();
  await desktop.getByRole('heading', { name: 'Projekt · Desktop Garden', exact: true }).waitFor();
  check('Overview project card opens the independent workspace entry', await desktop.getByRole('region', { name: 'Projekt-Terminal', exact: true }).isVisible());
}
