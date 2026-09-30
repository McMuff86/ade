import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright';
import { supervisionFlow } from './supervisionFlow';
import { inputResumeFlow } from './inputResumeFlow';
import { terminalComposer } from './terminalControls';
import { expect } from 'playwright/test';
import { terminalHyperlinksFlow } from './terminalHyperlinksFlow';

export async function sessionNavigationFlow(desktop: Page, tablet: Page, root: string, check: (name: string, ok: boolean) => void): Promise<void> {
  const evidence = resolve('test-results/main-agent-planning'); mkdirSync(evidence, { recursive: true });
  const parent = join(root, 'switch-projects'); mkdirSync(parent);
  for (const name of ['Switch A', 'Switch B', 'Switch C']) {
    const repo = join(parent, name); mkdirSync(repo);
    execFileSync('git', ['init', '--initial-branch=main', repo], { windowsHide: true });
    execFileSync('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-m', 'Fixture'], { windowsHide: true });
  }
  const sessions = await desktop.evaluate(async rootPath => {
    await window.ade.invoke('projectDefaults:save', { rootPath, agentId: null });
    const { directory } = await window.ade.invoke('project:query', { operation: 'directory' });
    const result = [];
    for (const name of ['Switch A', 'Switch B', 'Switch C']) {
      const entry = directory!.entries.find(item => item.name === name)!;
      const { workspace } = await window.ade.invoke('project:command', { operation: 'open', entryId: entry.id });
      const session = await window.ade.invoke('session:launch', { projectWorkspaceId: workspace.id, expectedBranch: workspace.branch, mode: 'shell' });
      result.push({ id: session.id, workspaceId: workspace.id, repositoryId: workspace.repositoryId, createdAt: session.createdAt, name });
    }
    const extra = await window.ade.invoke('session:launch', { projectWorkspaceId: result[0]!.workspaceId, expectedBranch: 'main', mode: 'shell' });
    result.push({ id: extra.id, workspaceId: result[0]!.workspaceId, repositoryId: result[0]!.repositoryId, createdAt: extra.createdAt, name: 'Switch A' });
    return result;
  }, parent);
  // Per-process markers distinguish even two shells in the very same checkout.
  // A navigation bug must not pass just because both sessions share a directory.
  for (const [index, session] of sessions.entries()) {
    const command = process.platform === 'win32' ? `$env:ADE_SESSION_MARKER='session-${index}'\r` : `export ADE_SESSION_MARKER=session-${index}\r`;
    await desktop.evaluate(({ id, command }) => window.ade.invoke('pty:write', { sessionId: id, dataBase64: btoa(command) }), { id: session.id, command });
  }
  const count = (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.length;
  await desktop.keyboard.press('Escape'); await tablet.keyboard.press('Escape');
  const pickDesktop = async (index: number) => {
    const target = sessions[index]!;
    await desktop.getByRole('button', { name: 'Arbeit wechseln', exact: true }).click();
    const chooser = desktop.getByRole('dialog', { name: 'Arbeit wechseln', exact: true });
    await chooser.locator(`[data-session-id="${target.id}"]`).click();
    await desktop.getByRole('heading', { name: `Projekt · ${target.name}`, exact: true }).waitFor();
    await desktop.locator(`#project-session-tab-${target.id}[aria-selected="true"]`).waitFor();
  };
  await pickDesktop(0);
  await desktop.waitForFunction(() => {
    const screen = document.querySelector('.project-terminal [role="tabpanel"]:not([hidden]) .xterm-screen');
    const box = screen?.getBoundingClientRect(); const header = document.querySelector('.titlebar')?.getBoundingClientRect();
    return box && header && box.top >= header.bottom && box.top < window.innerHeight && window.scrollY === 0;
  });
  check('explicit session navigation reveals the selected terminal without scrolling away the global header', true);
  await desktop.getByRole('button', { name: 'Prompt / Diktat', exact: true }).click();
  await desktop.getByLabel('CLI-Promptentwurf', { exact: true }).fill('Desktop draft A');
  await desktop.keyboard.press('Escape');
  for (let round = 0; round < 10; round++) for (const index of [1, 2, 0]) await pickDesktop(index);
  check('desktop switches three projects ten times without another process', (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.length === count);
  await desktop.getByRole('button', { name: 'Prompt / Diktat', exact: true }).click();
  check('desktop returns to its target-bound draft', await desktop.getByLabel('CLI-Promptentwurf', { exact: true }).inputValue() === 'Desktop draft A');
  await desktop.keyboard.press('Escape'); await pickDesktop(3); await pickDesktop(0);
  check('switcher selects the exact session within the same project', await desktop.locator(`#project-session-tab-${sessions[0]!.id}`).getAttribute('aria-selected') === 'true');
  await desktop.getByRole('button', { name: 'Arbeit wechseln', exact: true }).click();
  await desktop.getByRole('dialog', { name: 'Arbeit wechseln', exact: true }).getByLabel('Sitzungen durchsuchen').fill('no matching session');
  check('switcher explains an empty search', await desktop.getByText('Keine passende Sitzung. Suche ändern.', { exact: true }).isVisible());
  await desktop.keyboard.press('Escape');
  check('desktop switcher Escape returns focus to its opener', await desktop.getByRole('button', { name: 'Arbeit wechseln', exact: true }).evaluate(node => node === document.activeElement));

  await tablet.reload();
  await tablet.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await tablet.keyboard.press('Escape');
  // The host intentionally exposes opaque remote IDs, never its internal PTY IDs.
  const inventoryResponse = tablet.waitForResponse(response => response.url().endsWith('/api/v1/terminal/sessions') && response.ok());
  await tablet.locator('#mobile-session-switch').click();
  const inventory = await (await inventoryResponse).json() as import('../../src/shared/remote').MobileSessionInventory;
  await tablet.keyboard.press('Escape');
  const remoteIds = sessions.map(session => {
    const matches = inventory.sessions.filter(item => item.projectRepositoryId === session.repositoryId && item.createdAt === session.createdAt);
    if (matches.length !== 1) throw new Error(`Expected one authorized fixture session: ${session.name}, found ${matches.length}`);
    return matches[0]!.id;
  });
  check('each desktop fixture maps to a distinct opaque tablet session', new Set(remoteIds).size === sessions.length);
  const pickTablet = async (index: number) => {
    const target = sessions[index]!;
    // The project dialog exposes the same action within the modal's focus boundary.
    const project = tablet.locator('dialog[open].m-independent-project');
    const opener = await project.count() ? project.getByRole('button', { name: 'Arbeit wechseln', exact: true }) : tablet.locator('#mobile-session-switch');
    await opener.click();
    const chooser = tablet.getByRole('dialog', { name: 'Arbeit wechseln', exact: true });
    await chooser.locator(`[data-session-id="${remoteIds[index]}"]`).click();
    const next = tablet.getByRole('dialog', { name: `Projekt · ${target.name}`, exact: true });
    await next.waitFor();
    await next.locator('[data-terminal-id]').first().waitFor({ state: 'attached' });
    await tablet.waitForFunction(id => document.querySelector('dialog[open].m-independent-project [data-terminal-id][aria-pressed="true"]')?.getAttribute('data-terminal-id') === id, remoteIds[index]);
  };
  await tablet.setViewportSize({ width: 1280, height: 800 });
  await pickTablet(0);
  await terminalHyperlinksFlow(desktop, tablet, sessions[0]!.id, check);
  const project = tablet.getByRole('dialog', { name: 'Projekt · Switch A', exact: true });
  const ownBefore = await desktop.evaluate(id => window.ade.invoke('terminal:control', { sessionId: id }), sessions[0]!.id);
  check('tablet navigation alone does not take desktop input', !ownBefore.remote);
  await project.getByRole('button', { name: 'Eingabe übernehmen', exact: true }).click();
  await project.getByLabel('CLI-Promptentwurf', { exact: true }).fill('Tablet draft A');
  for (let round = 0; round < 10; round++) for (const index of [1, 2, 0]) await pickTablet(index);
  check('tablet switches three projects ten times without another process', (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.length === count);
  // Whether or not the lease lapsed during the rounds, the session this tablet held comes back owned.
  const ownA = project.getByText('Eingabe: Du (Tablet)', { exact: true }); await ownA.waitFor();
  check('tablet draft returns only to its original session', await project.getByLabel('CLI-Promptentwurf', { exact: true }).inputValue() === 'Tablet draft A');
  await inputResumeFlow(tablet, desktop, project, sessions[0]!.id, pickTablet, check, evidence);
  await pickTablet(3); await pickTablet(0);
  check('tablet also selects the exact sibling session', true);
  for (const [index, session] of sessions.entries()) {
    await pickTablet(index);
    const current = tablet.getByRole('dialog', { name: `Projekt · ${session.name}`, exact: true });
    const claim = current.getByRole('button', { name: 'Eingabe übernehmen', exact: true });
    if (await claim.isVisible()) await claim.click();
    await current.getByText('Eingabe: Du (Tablet)', { exact: true }).waitFor();
    const filename = `session-input-${index}.txt`;
    const proof = join(parent, session.name, filename);
    const command = process.platform === 'win32'
      ? `Set-Content -LiteralPath '${filename}' -Value $env:ADE_SESSION_MARKER`
      : `printf '%s' "$ADE_SESSION_MARKER" > '${filename}'`;
    await (await terminalComposer(current)).fill(command);
    await current.getByRole('button', { name: 'Text und Enter senden', exact: true }).click();
    await expect.poll(() => existsSync(proof) ? readFileSync(proof, 'utf8').trim() : '', { timeout: 10_000 }).toBe(`session-${index}`);
    check(`tablet input reaches exact process ${index}, including sibling shells in one project`, true);
    check(`process ${index} input leaves other projects untouched`, sessions.filter(other => other.name !== session.name)
      .every(other => !existsSync(join(parent, other.name, filename))));
    const refusal = await desktop.evaluate(async id => {
      try { await window.ade.invoke('pty:write', { sessionId: id, dataBase64: btoa('SHOULD_NOT_RUN\r') }); return ''; }
      catch (error) { return error instanceof Error ? error.message : String(error); }
    }, session.id);
    check(`desktop cannot type into tablet-owned process ${index} for the ownership reason`, refusal.includes('Terminal wird remote gesteuert'));
    await desktop.evaluate(id => window.ade.invoke('terminal:reclaim', { sessionId: id }), session.id);
    const desktopCommand = command.replace(filename, `desktop-${filename}`) + '\r';
    await desktop.evaluate(({ id, command }) => window.ade.invoke('pty:write', { sessionId: id, dataBase64: btoa(command) }), { id: session.id, command: desktopCommand });
    const desktopProof = join(parent, session.name, `desktop-${filename}`);
    await expect.poll(() => existsSync(desktopProof) ? readFileSync(desktopProof, 'utf8').trim() : '', { timeout: 10_000 }).toBe(`session-${index}`);
    check(`desktop reclaim restores input to exact process ${index} after the negative control`, true);
  }
  for (const viewport of [{ width: 800, height: 1280 }, { width: 390, height: 844 }]) {
    await tablet.setViewportSize(viewport); await pickTablet(1);
    const current = tablet.getByRole('dialog', { name: 'Projekt · Switch B', exact: true });
    await current.getByRole('button', { name: 'Arbeit wechseln', exact: true }).click();
    const chooser = tablet.getByRole('dialog', { name: 'Arbeit wechseln', exact: true });
    check(`session chooser fits ${viewport.width}px viewport`, await chooser.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    check(`session target is touch sized at ${viewport.width}px`, (await chooser.locator('[data-session-id]').first().boundingBox())!.height >= 44);
    await chooser.screenshot({ path: join(evidence, `session-switcher-${viewport.width}.png`) });
    await tablet.keyboard.press('Escape');
    check(`nested chooser restores project opener at ${viewport.width}px`, await current.getByRole('button', { name: 'Arbeit wechseln', exact: true }).evaluate(node => node === document.activeElement));
  }
  await tablet.reload(); await tablet.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await pickTablet(0);
  check('reload reattaches instead of relaunching a project session', (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions.length === count);
  await supervisionFlow(desktop, sessions, check, tablet);
  for (const session of sessions) await desktop.evaluate(sessionId => window.ade.invoke('pty:kill', { sessionId }), session.id);
}
