/** Real desktop Git workflow, using only disposable repositories and an isolated profile. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { DEFAULT_CONFIG, type AdeConfig } from '../src/shared/types';

const root = mkdtempSync(join(tmpdir(), 'ade-sync-electron-'));
const evidence = resolve('test-results/git-sync');
mkdirSync(evidence, { recursive: true });
let app: ElectronApplication | undefined;
let page: Page | undefined;
let passed = 0;
let failed = 0;
function check(label: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`FAIL  ${label}`); }
}
const git = (path: string, args: string[]): string => execFileSync('git', ['-C', path, ...args], {
  encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
}).trim();
async function ready(): Promise<void> {
  await page!.locator('[data-testid="repository-sync"][aria-busy="false"]').waitFor({ timeout: 30_000 });
}
void (async () => {
  const repo = join(root, 'main'); const remote = join(root, 'remote.git'); const agent = join(root, 'agent');
  const userData = join(root, 'profile');
  mkdirSync(repo); mkdirSync(join(userData, 'ade'), { recursive: true });
  git(repo, ['init', '--initial-branch=main']);
  git(repo, ['config', 'user.name', 'ADE Sync E2E']); git(repo, ['config', 'user.email', 'sync@example.invalid']);
  writeFileSync(join(repo, 'base.txt'), 'base'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'base']);
  const base = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['init', '--bare', remote]); git(repo, ['remote', 'add', 'origin', remote]); git(repo, ['push', '-u', 'origin', 'main']);
  git(repo, ['worktree', 'add', '-b', 'ade/agent', agent]);
  writeFileSync(join(repo, 'new.txt'), 'new'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'local update']);
  const next = git(repo, ['rev-parse', 'HEAD']);
  writeFileSync(join(repo, 'unsaved.txt'), 'preserve this work');
  const config: AdeConfig = { ...structuredClone(DEFAULT_CONFIG),
    categories: [{ id: 'category', name: 'Sync fixture', repoPath: repo, defaultRepositoryId: 'repo', agents: ['agent'] }],
    agents: [{ id: 'agent', categoryId: 'category', name: 'Sync Agent', runtime: 'shell', permissionMode: 'default',
      workspaceDir: agent, homeWorkspaceDir: agent, defaultRepositoryId: 'repo', memoryDir: join(root, 'memory') }],
    repositories: [{ id: 'repo', name: 'Sync fixture', rootPath: realpathSync.native(repo), commonGitDir: realpathSync.native(join(repo, '.git')),
      executionBackend: 'native', verified: true, createdAt: 1 }],
    workspaceBindings: [{ id: 'binding', agentId: 'agent', repositoryId: 'repo', workspaceDir: realpathSync.native(agent),
      branch: 'ade/agent', status: 'ready', executionBackend: 'native', createdAt: 1, lastUsedAt: 1 }],
  };
  writeFileSync(join(userData, 'ade', 'config.json'), JSON.stringify(config));
  const launch = { args: [resolve('out/main/index.js')], cwd: resolve('.'), timeout: 30_000,
    env: { ...process.env, ADE_USER_DATA_DIR: userData, ADE_HOST_API_ENABLED: '0', ADE_HOST_API_TOKEN: '',
      ADE_HOST_API_COMMAND_DEVICE: '', ADE_HOST_API_PORT: '', NODE_ENV: 'test' } };
  app = await electron.launch(launch); page = await app.firstWindow(); page.setDefaultTimeout(20_000);
  await page.locator('.agent-row', { hasText: 'Sync Agent' }).waitFor();
  await page.keyboard.press('Control+2');
  const opener = page.locator('[data-open-git-sync]:visible');
  await opener.click(); await ready();
  const dialog = page.getByRole('dialog', { name: 'Repository synchronisieren' });
  check('Graph opens the shared Git dialog and moves focus inside', await dialog.evaluate((node) => node.contains(document.activeElement)));
  await dialog.getByRole('button', { name: 'Schliessen', exact: true }).focus(); await page.keyboard.press('Tab');
  check('Tab stays inside the dialog and cycles to its first control', await dialog.getByRole('combobox', { name: 'Repository für Git-Abgleich' }).evaluate((node) => node === document.activeElement));
  check('remote freshness starts explicitly unknown', await dialog.getByText('in dieser App-Sitzung noch nicht geprüft', { exact: false }).isVisible());
  check('Graph shows agent lag separately from the dirty main repository',
    (await dialog.locator('[data-sync-target="binding"]').innerText()).includes('1 Commits hinter')
    && await dialog.getByRole('button', { name: 'Hauptrepository aktualisieren', exact: true }).isDisabled());
  await dialog.getByRole('button', { name: 'Sync Agent aktualisieren', exact: true }).click(); await ready();
  const checkbox = dialog.getByRole('checkbox', { name: 'Diesen Worktree auf die angezeigte Basis aktualisieren' });
  check('preview shows exact tips before changing files', await dialog.getByText(`${base.slice(0, 12)} → ${next.slice(0, 12)}`, { exact: true }).isVisible()
    && git(agent, ['rev-parse', 'HEAD']) === base);
  check('confirmation receives keyboard focus and apply remains disabled', await checkbox.evaluate((node) => node === document.activeElement)
    && await dialog.getByRole('button', { name: 'Fast-forward ausführen' }).isDisabled());
  await page.keyboard.press('Space');
  await dialog.getByRole('button', { name: 'Fast-forward ausführen' }).click(); await ready();
  check('confirmed fast-forward moves only the selected branch', git(agent, ['rev-parse', 'HEAD']) === next && git(agent, ['branch', '--show-current']) === 'ade/agent'
    && readFileSync(join(repo, 'unsaved.txt'), 'utf8') === 'preserve this work');
  check('successful update announces the result and restores focus', await dialog.getByText('Sync Agent wurde per Fast-forward aktualisiert.', { exact: true }).isVisible()
    && await dialog.getByRole('button', { name: 'Anzeige aktualisieren', exact: true }).evaluate((node) => node === document.activeElement));
  await page.screenshot({ path: join(evidence, 'graph-synced.png') });
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  check('Escape closes the dialog and restores its Graph opener', await opener.evaluate((node) => node === document.activeElement));

  // An independent checkout publishes a commit while ADE stays open.
  git(repo, ['push', 'origin', 'main']);
  const other = join(root, 'other'); git(repo, ['clone', '--branch', 'main', remote, other]);
  git(other, ['config', 'user.name', 'Other']); git(other, ['config', 'user.email', 'other@example.invalid']);
  writeFileSync(join(other, 'remote.txt'), 'published elsewhere'); git(other, ['add', '.']); git(other, ['commit', '-m', 'external update']); git(other, ['push']);
  const published = git(other, ['rev-parse', 'HEAD']);
  await opener.click(); await ready();
  await dialog.getByRole('button', { name: 'Remote prüfen · Fetch', exact: true }).click(); await ready();
  check('Fetch discovers external work without moving local branches', git(repo, ['rev-parse', 'origin/main']) === published
    && git(repo, ['rev-parse', 'HEAD']) === next && git(agent, ['rev-parse', 'HEAD']) === next);
  check('successful Fetch displays a remote check time', !(await dialog.innerText()).includes('in dieser App-Sitzung noch nicht geprüft'));
  await dialog.getByRole('combobox', { name: 'Gewünschte Git-Basis' }).selectOption('refs/remotes/origin/main'); await ready();
  await dialog.getByRole('button', { name: 'Sync Agent aktualisieren', exact: true }).click(); await ready();
  writeFileSync(join(agent, 'new-dirty.txt'), 'keep late work');
  await checkbox.check(); await dialog.getByRole('button', { name: 'Fast-forward ausführen' }).click(); await ready();
  check('late edits produce an actionable error without moving the branch', (await dialog.getByRole('alert').innerText()).includes('uncommittete')
    && git(agent, ['rev-parse', 'HEAD']) === next && readFileSync(join(agent, 'new-dirty.txt'), 'utf8') === 'keep late work');
  rmSync(join(agent, 'new-dirty.txt'));
  await dialog.getByRole('button', { name: 'Anzeige aktualisieren', exact: true }).click(); await ready();
  await dialog.getByRole('button', { name: 'Sync Agent aktualisieren', exact: true }).click(); await ready();
  await checkbox.check(); await dialog.getByRole('button', { name: 'Fast-forward ausführen' }).click(); await ready();
  check('fresh confirmation succeeds after the rejected update', git(agent, ['rev-parse', 'HEAD']) === published);
  git(repo, ['remote', 'set-url', 'origin', join(root, 'missing.git')]);
  await dialog.getByRole('button', { name: 'Remote prüfen · Fetch', exact: true }).click(); await ready();
  check('offline Fetch keeps the local comparison visible with a useful error', await dialog.getByRole('alert').isVisible()
    && await dialog.locator('[data-sync-target="binding"]').isVisible());
  git(repo, ['remote', 'set-url', 'origin', remote]);
  await dialog.getByRole('button', { name: 'Remote prüfen · Fetch', exact: true }).click(); await ready();
  check('Fetch recovers after connection repair', await dialog.getByRole('alert').count() === 0);
  await page.setViewportSize({ width: 800, height: 700 });
  check('Git dialog remains contained at compact width', await dialog.evaluate((node) => {
    const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && node.scrollWidth <= node.clientWidth + 1;
  }));
  await page.screenshot({ path: join(evidence, 'compact.png') });
  await dialog.getByRole('button', { name: 'Schliessen', exact: true }).click();
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.keyboard.press('Control+1');
  await page.locator('.agent-row', { hasText: 'Sync Agent' }).click();
  await page.locator('.ri [data-open-git-sync]').click(); await ready();
  check('repository inspector opens the same Git workflow', await dialog.getByRole('combobox', { name: 'Repository für Git-Abgleich' }).inputValue() === 'repo');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+2');
  await page.getByRole('button', { name: 'Neuer Run', exact: true }).first().click();
  await page.getByText('Git-Basis vor dem Run prüfen und aktualisieren', { exact: true }).click(); await ready();
  check('new Run exposes the same comparison before launch', await page.locator('.gnew-run [data-testid="repository-sync"]').count() > 0
    || await page.locator('.gcomposer-back [data-testid="repository-sync"]').count() > 0);
  await app.close(); app = await electron.launch(launch); page = await app.firstWindow(); page.setDefaultTimeout(20_000);
  await page.getByRole('tab', { name: 'Graph', exact: false }).waitFor(); await page.keyboard.press('Control+2');
  await page.locator('[data-open-git-sync]:visible').click(); await ready();
  check('restart preserves updated Git state and resets remote freshness honestly', git(agent, ['rev-parse', 'HEAD']) === published
    && await page.getByText('in dieser App-Sitzung noch nicht geprüft', { exact: false }).isVisible()
    && readFileSync(join(repo, 'unsaved.txt'), 'utf8') === 'preserve this work');
  // Simulate the documented disappearing-opener condition independently from business state.
  await page.locator('[data-open-git-sync]:visible').evaluate((node) => node.remove());
  await page.keyboard.press('Escape');
  check('closing after the opener disappears focuses the selected mode tab', await page.locator('[role="tab"][aria-selected="true"]').evaluate((node) => node === document.activeElement));
})().catch(async (error) => {
  failed++; console.error(error);
  await page?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => undefined);
}).finally(async () => {
  await app?.close();
  if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('unexpected fixture root');
  rmSync(root, { recursive: true, force: true });
  console.log(`\nGit sync Electron: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
});
