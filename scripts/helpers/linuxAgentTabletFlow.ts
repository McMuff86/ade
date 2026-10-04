import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from 'playwright/test';
import type { mobileTlsProxy } from './mobileBrowser';
import { terminalLauncher } from './terminalControls';

/** Native PTYs and signed browser requests; only the installed CLI is doubled. */
export async function linuxAgentTabletFlow(desktop: Page, tablet: Page, root: string, proofs: string, evidence: string,
  proxy: Awaited<ReturnType<typeof mobileTlsProxy>>, check: (label: string, ok: boolean) => void): Promise<void> {
  const parent = join(root, 'agent-projects'); mkdirSync(parent);
  const git = (name: string, ...args: string[]) => execFileSync('git', ['-C', join(parent, name), '-c', 'commit.gpgSign=false', ...args], { encoding: 'utf8' });
  for (const name of ['Linux A', 'Linux B']) {
    const repo = join(parent, name); mkdirSync(repo);
    writeFileSync(join(repo, 'AGENTS.md'), '# Existing project instructions\nKEEP_REPOSITORY\n');
    writeFileSync(join(repo, 'a.txt'), 'base\n');
    git(name, 'init', '--initial-branch=main'); git(name, 'add', '.');
    git(name, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'Base');
  }
  const setup = await desktop.evaluate(async rootPath => {
    const category = await window.ade.invoke('category:create', { name: 'Linux tablet' });
    const agent = await window.ade.invoke('agent:create', { categoryId: category.id, name: 'Linux saved Codex', runtime: 'codex',
      permissionMode: 'bypass', codexModel: 'gpt-5.6-sol', codexReasoningEffort: 'high', defaultRepositoryId: null });
    const view = await window.ade.invoke('agent:behaviorGet', { agentId: agent.id });
    await window.ade.invoke('agent:behaviorSet', { agentId: agent.id, revision: view.revision,
      profile: { instructions: 'TABLET_PROFILE_KEEP\nUnicode ä 漢字, "quotes", $literal.', documents: [] } });
    await window.ade.invoke('projectDefaults:save', { rootPath, agentId: agent.id });
    const device = (await window.ade.invoke('remoteDevices:list')).devices.find(item => !item.revokedAt)!;
    await window.ade.invoke('remoteDevices:setAdminScopes', { deviceId: device.id,
      scopes: [...new Set([...(device.adminScopes ?? []), 'projects:write' as const])], resourceAccess: { mode: 'all' } });
    const { directory } = await window.ade.invoke('project:query', { operation: 'directory' });
    const sessions = [];
    for (const name of ['Linux A', 'Linux B', 'Linux A']) {
      const entry = directory!.entries.find(item => item.name === name)!;
      const { workspace } = await window.ade.invoke('project:command', { operation: 'open', entryId: entry.id });
      const session = await window.ade.invoke('session:launch', { projectWorkspaceId: workspace.id, expectedBranch: workspace.branch, mode: 'agent', profileId: agent.id });
      sessions.push({ id: session.id, repositoryId: workspace.repositoryId, createdAt: session.createdAt, name });
    }
    return sessions;
  }, parent);
  interface Proof { pid: number; cwd: string; args: string[]; profileText: string; inputFile: string }
  const readProofs = (): Proof[] => readdirSync(proofs).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(join(proofs, name), 'utf8')) as Proof)
    .filter(item => item.profileText.includes('TABLET_PROFILE_KEEP')).sort((a, b) => a.pid - b.pid);
  await expect.poll(() => readProofs().length).toBe(3);
  const records = readProofs();
  check('three native CLI processes receive saved profile plus existing Codex guidance', new Set(records.map(item => item.pid)).size === 3
    && records.every(item => item.profileText.startsWith('FIXTURE_BASELINE_KEEP\n\n') && item.profileText.includes('TABLET_PROFILE_KEEP')
      && item.args.includes('--dangerously-bypass-approvals-and-sandbox') && item.args.includes('gpt-5.6-sol')));
  check('profile launches preserve tracked project instructions and branches', ['Linux A', 'Linux B'].every(name => git(name, 'status', '--porcelain') === '' && git(name, 'branch', '--show-current').trim() === 'main'));
  await tablet.reload(); await tablet.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  const response = tablet.waitForResponse(item => item.url().endsWith('/api/v1/terminal/sessions') && item.ok());
  await tablet.locator('#mobile-session-switch').click();
  const inventory = await (await response).json() as import('../../src/shared/remote').MobileSessionInventory;
  await tablet.keyboard.press('Escape');
  const ids = setup.map(session => inventory.sessions.find(item => item.projectRepositoryId === session.repositoryId && item.createdAt === session.createdAt)!.id);
  const pick = async (index: number) => {
    const open = tablet.locator('dialog[open].m-independent-project');
    await (await open.count() ? open.getByRole('button', { name: 'Arbeit wechseln', exact: true }) : tablet.locator('#mobile-session-switch')).click();
    await tablet.getByRole('dialog', { name: 'Arbeit wechseln', exact: true }).locator(`[data-session-id="${ids[index]}"]`).click();
    const dialog = tablet.getByRole('dialog', { name: `Projekt · ${setup[index]!.name}`, exact: true });
    await dialog.locator(`[data-terminal-id="${ids[index]}"][aria-pressed="true"]`).waitFor({ state: 'attached' });
    const claim = dialog.getByRole('button', { name: 'Eingabe übernehmen', exact: true }).filter({ visible: true }).first();
    if (await claim.isVisible()) await claim.click();
    await dialog.getByText('Eingabe: Du (Tablet)', { exact: true }).first().waitFor();
    return dialog;
  };
  for (let index = 0; index < 3; index++) {
    const dialog = await pick(index); const strip = dialog.locator('.voice-strip-live');
    const prompt = `Sitzung ${index}: ä 漢字\n"quotes" $literal`;
    await strip.getByLabel('CLI-Promptentwurf', { exact: true }).fill(prompt);
    await strip.getByRole('button', { name: 'Senden', exact: true }).click();
    await expect.poll(() => readFileSync(records[index]!.inputFile, 'utf8')).toBe(`\x1b[200~${prompt}\x1b[201~\r`);
    await expect(strip.getByLabel('CLI-Promptentwurf', { exact: true })).toHaveValue('');
    check(`tablet sends multiline prompt exactly once to native process ${index}`, records.filter((_, other) => other > index).every(item => readFileSync(item.inputFile, 'utf8') === ''));
  }
  const first = await pick(0);
  await first.getByLabel('CLI-Promptentwurf', { exact: true }).fill('Entwurf nur A');
  const second = await pick(1);
  check('switching agents does not move the unsent prompt to another process', await second.getByLabel('CLI-Promptentwurf', { exact: true }).inputValue() === '');
  await pick(0);
  await tablet.context().setOffline(true); await tablet.setViewportSize({ width: 800, height: 1280 });
  check('disconnect and rotation preserve the target-bound draft', await first.getByLabel('CLI-Promptentwurf', { exact: true }).inputValue() === 'Entwurf nur A');
  await tablet.context().setOffline(false);
  const strip = first.locator('.voice-strip-live');
  await expect(strip.getByRole('button', { name: 'Senden', exact: true })).toBeEnabled();
  const before = readFileSync(records[0]!.inputFile, 'utf8');
  proxy.losePromptReplies(true);
  await strip.getByRole('button', { name: 'Senden', exact: true }).click();
  await strip.getByText('Die vorige Übergabe ist nicht bestätigt. Vor erneutem Senden zuerst die CLI prüfen.', { exact: true }).waitFor();
  proxy.losePromptReplies(false);
  await expect.poll(() => readFileSync(records[0]!.inputFile, 'utf8')).toBe(`${before}\x1b[200~Entwurf nur A\x1b[201~\r`);
  check('lost receipt keeps the draft locked after one real delivery', await strip.getByLabel('CLI-Promptentwurf', { exact: true }).getAttribute('readonly') !== null);
  await tablet.reload(); await tablet.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor(); await pick(0);
  check('reload preserves uncertain delivery without duplicate input or new CLI', readFileSync(records[0]!.inputFile, 'utf8') === `${before}\x1b[200~Entwurf nur A\x1b[201~\r` && readProofs().length === 3);
  await strip.getByRole('button', { name: 'Terminal geprüft – Entwurf weiterbearbeiten', exact: true }).click();
  await strip.getByLabel('CLI-Promptentwurf', { exact: true }).fill('Nach Wiederverbindung');
  await strip.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect.poll(() => readFileSync(records[0]!.inputFile, 'utf8')).toContain('\x1b[200~Nach Wiederverbindung\x1b[201~\r');
  check('explicit recovery can send a new prompt to the original process', true);
  await terminalLauncher(first);
  await first.getByLabel('Sitzung starten mit', { exact: true }).selectOption('agent');
  await first.getByLabel('Startprofil', { exact: true }).selectOption({ label: 'Linux saved Codex · codex' });
  await first.getByRole('button', { name: 'Sitzung starten', exact: true }).click();
  await expect.poll(() => readProofs().length).toBe(4);
  const launched = (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.find(item => !setup.some(previous => previous.id === item.id))!;
  check('tablet explicitly starts another saved Codex profile in the existing project', launched.launchProfileName === 'Linux saved Codex'
    && launched.workspaceDir === join(parent, 'Linux A') && readProofs()[3]!.profileText.includes('TABLET_PROFILE_KEEP'));
  await strip.getByLabel('CLI-Promptentwurf', { exact: true }).fill('Neuer Agent vom Tablet');
  await strip.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect.poll(() => readFileSync(readProofs()[3]!.inputFile, 'utf8')).toBe('\x1b[200~Neuer Agent vom Tablet\x1b[201~\r');
  check('new tablet-launched profile accepts protected prompts without affecting its siblings', !readFileSync(records[0]!.inputFile, 'utf8').includes('Neuer Agent vom Tablet'));
  writeFileSync(join(parent, 'Linux A', 'a.txt'), 'Tablet review ä\n');
  const toggle = first.getByRole('button', { name: 'Projektbereich einblenden', exact: true });
  if (await toggle.isVisible()) await toggle.click();
  await first.getByRole('button', { name: 'Git', exact: true }).click();
  const panel = first.getByRole('region', { name: 'Projekt-Git', exact: true });
  await panel.getByRole('button', { name: 'Diff anzeigen: a.txt', exact: true }).click();
  await panel.getByRole('region', { name: 'Git-Diff', exact: true }).getByText('+Tablet review ä', { exact: false }).waitFor();
  check('tablet shows the actual native Git diff from its selected project', true);
  await panel.getByRole('button', { name: 'Datei bearbeiten: a.txt', exact: true }).click();
  const file = panel.getByLabel('Git-Dateiinhalt', { exact: true });
  await expect(file).toHaveValue('Tablet review ä\n');
  check('file reading works without granting file mutation', await file.getAttribute('readonly') !== null);
  await tablet.setViewportSize({ width: 390, height: 844 });
  await tablet.screenshot({ path: join(evidence, 'linux-tablet-file-diff.png') });
  check('file and diff view fits a narrow tablet browser', await first.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
  // A CLI that ends by itself (e.g. /exit) leaves an ended session. It must stay calm through the
  // next lease heartbeat and remain removable, although there is no input lease left to renew.
  await tablet.setViewportSize({ width: 1280, height: 800 });
  await first.getByRole('button', { name: 'Terminal', exact: true }).first().click();
  const endButton = first.getByRole('button', { name: 'Terminal beenden', exact: true });
  await first.locator('.xterm-helper-textarea').first().focus(); await tablet.keyboard.press('Control+d');
  await first.getByText('Sitzung beendet', { exact: true }).first().waitFor();
  const endedTop = Math.round((await endButton.boundingBox())!.y);
  await tablet.waitForTimeout(11_000);
  check('ended CLI session shows no refusal and keeps its end button in place across a heartbeat', await first.getByRole('alert').filter({ visible: true }).count() === 0
    && Math.round((await endButton.boundingBox())!.y) === endedTop && await endButton.isEnabled());
  const liveBefore = (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.length;
  await endButton.click();
  await tablet.getByRole('button', { name: 'Beenden bestätigen', exact: true }).click();
  await expect.poll(async () => (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.length).toBe(liveBefore - 1);
  check('tablet removes the ended session without a refusal', await first.getByRole('alert').filter({ visible: true }).count() === 0);
  await tablet.keyboard.press('Escape');
  for (const session of setup) await desktop.evaluate(sessionId => window.ade.invoke('pty:kill', { sessionId }), session.id);
  await desktop.evaluate(sessionId => window.ade.invoke('pty:kill', { sessionId }), launched.id);
}
