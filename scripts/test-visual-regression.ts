/**
 * Visual regression for the right-sidebar repository inspector.
 *
 * Captures the production renderer in dark and light themes at narrow,
 * medium and wide sidebar widths (plus the on-demand CI checks pane) against
 * per-platform PNG baselines in scripts/fixtures/visual-baselines/.
 *
 * Determinism: fixed Git author/committer dates, a frozen renderer clock,
 * --force-device-scale-factor=1, --lang=en-US, reduced motion, a fixed
 * window size and no running PTY session (so no 5s workspace poll).
 *
 * A missing baseline is created and reported; `--update` rewrites all
 * baselines. Mismatches write actual/diff PNGs to test-results/visual/.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import {
  DEFAULT_CONFIG,
  type AdeConfig,
  type Agent,
  type Category,
  type RunPublication,
} from '../src/shared/types';
import { writeFakeGithubCli } from './fixtures/fake-gh';

const FIXED_NOW = Date.parse('2026-07-19T12:00:00Z');
const WINDOW = { width: 1400, height: 900 };
/* wide stays below the Panel's 40% max (≈554px at a 1400px window). */
const WIDTHS = { narrow: 300, medium: 380, wide: 540 } as const;
const DIFF_THRESHOLD = 0.12;
const MAX_DIFF_RATIO = 0.003;
const BASELINE_DIR = join(__dirname, 'fixtures', 'visual-baselines', process.platform);
const ACTUAL_DIR = join(__dirname, '..', 'test-results', 'visual');

let passed = 0;
let failed = 0;
let baselinesCreated = 0;
const update = process.argv.includes('--update');

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}`, detail ?? '');
  }
}

function git(cwd: string, args: string[], isoDate?: string): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    env: isoDate
      ? { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate }
      : process.env,
  });
}

function createFixtureRepository(root: string): { repo: string; remote: string } {
  const repo = join(root, 'visual-repo');
  const remote = join(root, 'visual-remote.git');
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 'ade-visual@example.invalid']);
  git(repo, ['config', 'user.name', 'ADE Visual']);
  writeFileSync(join(repo, 'README.md'), '# Visual fixture\n\nBaseline content.\n', 'utf8');
  git(repo, ['add', 'README.md'], '2026-07-12T09:00:00Z');
  git(repo, ['commit', '-m', 'Bootstrap visual fixture'], '2026-07-12T09:00:00Z');
  writeFileSync(join(repo, 'inspector.txt'), 'inspector fixture\n', 'utf8');
  git(repo, ['add', 'inspector.txt'], '2026-07-15T10:00:00Z');
  git(repo, ['commit', '-m', 'Add inspector fixtures'], '2026-07-15T10:00:00Z');
  writeFileSync(join(repo, 'states.txt'), 'decision-relevant states\n', 'utf8');
  git(repo, ['add', 'states.txt'], '2026-07-18T16:30:00Z');
  git(repo, ['commit', '-m', 'Polish decision-relevant states'], '2026-07-18T16:30:00Z');
  execFileSync('git', ['-C', root, 'init', '--bare', remote], { encoding: 'utf8', windowsHide: true });
  execFileSync('git', ['--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  // The provider identity must be the fake gh fixture repository; pushes go
  // to the local bare remote through the insteadOf rewrite.
  const githubUrl = 'https://github.com/ade-e2e/managed.git';
  git(repo, ['remote', 'add', 'origin', githubUrl]);
  git(repo, ['config', `url.${pathToFileURL(remote).toString()}.insteadOf`, githubUrl]);
  git(repo, ['push', '-u', 'origin', 'main']);
  // One unpushed commit → upstream divergence (↑1) earns the accent color.
  writeFileSync(join(repo, 'next.txt'), 'next slice\n', 'utf8');
  git(repo, ['add', 'next.txt'], '2026-07-19T08:00:00Z');
  git(repo, ['commit', '-m', 'Prepare next slice'], '2026-07-19T08:00:00Z');
  // Dirty working tree → decision-relevant highlight.
  writeFileSync(join(repo, 'README.md'), '# Visual fixture\n\nBaseline content.\nEdited line.\n', 'utf8');
  writeFileSync(join(repo, 'notes.txt'), 'untracked note\n', 'utf8');
  return { repo, remote };
}

/** Pre-seed the fake gh state so the PR list contains the published Draft PR. */
function seedFakeGithubState(statePath: string): void {
  const state = {
    number: 71,
    url: 'https://github.com/ade-e2e/managed/pull/71',
    isDraft: true,
    state: 'OPEN',
    baseRefName: 'main',
    headRefName: 'ade/run-visual',
    headRefOid: 'a'.repeat(40),
    statusCheckRollup: [{ name: 'E2E CI', status: 'IN_PROGRESS', conclusion: '' }],
  };
  writeFileSync(statePath, `${JSON.stringify(state)}\n`, 'utf8');
  const listEntry = {
    number: 71,
    title: 'ADE: Managed E2E Run',
    url: 'https://github.com/ade-e2e/managed/pull/71',
    author: { login: 'ade-bot' },
    isDraft: true,
    updatedAt: '2026-07-19T10:00:00Z',
    headRefName: 'ade/run-visual',
    baseRefName: 'main',
    reviewDecision: 'REVIEW_REQUIRED',
    changedFiles: 2,
    additions: 2,
    deletions: 0,
    statusCheckRollup: [{ name: 'E2E CI', status: 'IN_PROGRESS', conclusion: '' }],
  };
  writeFileSync(`${statePath}.list`, `${JSON.stringify(listEntry)}\n`, 'utf8');
}

function seedConfig(userData: string, workspace: string, repositoryRoot: string): void {
  const identityRoot = git(repositoryRoot, ['rev-parse', '--show-toplevel']).trim();
  const commonGitDir = git(repositoryRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
  const category: Category = {
    id: 'visual-category',
    name: 'Visual',
    kind: 'plain',
    agents: ['visual-agent'],
  };
  const agent: Agent = {
    id: 'visual-agent',
    categoryId: category.id,
    name: 'Visual Shell',
    role: 'Visual regression',
    runtime: 'shell',
    permissionMode: 'default',
    workspaceDir: workspace,
    homeWorkspaceDir: workspace,
    memoryDir: join(userData, 'agent-memory'),
  };
  mkdirSync(agent.memoryDir, { recursive: true });
  const now = FIXED_NOW;
  const publication: RunPublication = {
    id: 'visual-publication',
    runId: 'visual-run',
    repositoryId: 'visual-repository',
    provider: 'github',
    providerRepository: 'ade-e2e/managed',
    remoteName: 'origin',
    baseBranch: 'main',
    headBranch: 'ade/run-visual',
    baseSha: 'b'.repeat(40),
    headSha: 'a'.repeat(40),
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    prNumber: 71,
    prUrl: 'https://github.com/ade-e2e/managed/pull/71',
  };
  const config: AdeConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    categories: [category],
    agents: [agent],
    repositories: [{
      id: 'visual-repository',
      name: 'Visual fixture repository',
      rootPath: identityRoot,
      commonGitDir,
      verified: true,
      createdAt: now,
    }],
    runPublications: [publication],
  };
  const configDir = join(userData, 'ade');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

async function setSidebarWidth(page: Page, target: number): Promise<number> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const panel = await page.locator('.rp').boundingBox();
    if (!panel) throw new Error('right panel is not visible');
    const delta = panel.width - target;
    if (Math.abs(delta) <= 2) return panel.width;
    const handle = await page.locator('.resize-handle').last().boundingBox();
    if (!handle) throw new Error('resize handle is not visible');
    const x = handle.x + handle.width / 2;
    const y = handle.y + Math.min(300, handle.height / 2);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + delta, y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(120);
  }
  const finalPanel = await page.locator('.rp').boundingBox();
  return finalPanel?.width ?? 0;
}

async function waitForStableOverview(page: Page): Promise<void> {
  await page.locator('.ri[aria-busy="false"]').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => {
    const text = document.querySelector('.rp')?.textContent ?? '';
    return text.includes('Visual fixture repository')
      && text.includes('Improve repository inspector fixture')
      && text.includes('ADE: Managed E2E Run')
      && text.includes('Prepare next slice');
  }, undefined, { timeout: 20_000 });
  await page.evaluate(async () => { await document.fonts.ready; });
}

function comparePng(name: string, actual: Buffer): void {
  // Hosted runners rasterize fonts differently than the operator machine;
  // pixel baselines are only authoritative where they were captured.
  if (process.env['CI']) {
    mkdirSync(ACTUAL_DIR, { recursive: true });
    writeFileSync(join(ACTUAL_DIR, `${name}.actual.png`), actual);
    check(`${name}: captured (pixel comparison skipped on CI)`, true);
    return;
  }
  const baselinePath = join(BASELINE_DIR, `${name}.png`);
  if (update || !existsSync(baselinePath)) {
    mkdirSync(BASELINE_DIR, { recursive: true });
    writeFileSync(baselinePath, actual);
    baselinesCreated += 1;
    check(`${name}: baseline ${update ? 'updated' : 'created'}`, true);
    return;
  }
  const expected = PNG.sync.read(readFileSync(baselinePath));
  const received = PNG.sync.read(actual);
  mkdirSync(ACTUAL_DIR, { recursive: true });
  if (expected.width !== received.width || expected.height !== received.height) {
    writeFileSync(join(ACTUAL_DIR, `${name}.actual.png`), actual);
    check(`${name}: matches the committed baseline`, false,
      `size ${received.width}x${received.height} vs baseline ${expected.width}x${expected.height}`);
    return;
  }
  const diff = new PNG({ width: expected.width, height: expected.height });
  const differing = pixelmatch(
    expected.data,
    received.data,
    diff.data,
    expected.width,
    expected.height,
    { threshold: DIFF_THRESHOLD },
  );
  const ratio = differing / (expected.width * expected.height);
  if (ratio > MAX_DIFF_RATIO) {
    writeFileSync(join(ACTUAL_DIR, `${name}.actual.png`), actual);
    writeFileSync(join(ACTUAL_DIR, `${name}.diff.png`), PNG.sync.write(diff));
    check(`${name}: matches the committed baseline`, false,
      `${differing} differing pixels (${(ratio * 100).toFixed(3)}%) — see test-results/visual/`);
    return;
  }
  check(`${name}: matches the committed baseline`, true);
}

async function captureState(page: Page, name: string): Promise<void> {
  await waitForStableOverview(page);
  const overflow = await page.evaluate(() => {
    const panel = document.querySelector('.rp');
    const content = document.querySelector('.rp-content');
    return {
      panel: panel ? panel.scrollWidth - panel.clientWidth : 0,
      content: content ? content.scrollWidth - content.clientWidth : 0,
    };
  });
  check(`${name}: no horizontal overflow in the sidebar`,
    overflow.panel <= 1 && overflow.content <= 1, overflow);
  const screenshot = await page.locator('.rp').screenshot({ animations: 'disabled' });
  comparePng(name, screenshot);
}

async function run(): Promise<void> {
  const root = process.cwd();
  const scratch = mkdtempSync(join(tmpdir(), 'ade-visual-'));
  const userData = join(scratch, 'user-data');
  const workspace = join(scratch, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const fixture = createFixtureRepository(scratch);
  const fakeGithub = writeFakeGithubCli(scratch, fixture.remote);
  seedFakeGithubState(fakeGithub.statePath);
  seedConfig(userData, workspace, fixture.repo);

  let app: ElectronApplication | null = null;
  try {
    app = await electron.launch({
      args: [
        join(root, 'out/main/index.js'),
        '--force-device-scale-factor=1',
        '--lang=en-US',
      ],
      cwd: root,
      env: {
        ...process.env,
        ADE_USER_DATA_DIR: userData,
        ADE_E2E_FAKE_GH_STATE: fakeGithub.statePath,
        ADE_E2E_MANAGED_REMOTE: fixture.remote,
        PATH: `${fakeGithub.bin}${delimiter}${process.env['PATH'] ?? ''}`,
        NODE_ENV: 'test',
      },
      timeout: 30_000,
    });
    const page = await app.firstWindow({ timeout: 20_000 });
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setContentSize(size.width, size.height);
    }, WINDOW);
    // Freeze the renderer clock so relative timestamps render identically on
    // every run; the init script only applies from the next navigation.
    await page.addInitScript((fixedNow) => {
      Date.now = () => fixedNow;
    }, FIXED_NOW);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.agent-row', { hasText: 'Visual Shell' }).waitFor({ state: 'visible' });
    const frozen = await page.evaluate(() => Date.now());
    check('renderer clock is frozen for deterministic relative timestamps', frozen === FIXED_NOW, frozen);

    await page.locator('.agent-row', { hasText: 'Visual Shell' }).click();
    const scopeHeader = page.locator('[data-testid="repository-scope"]');
    await scopeHeader.getByLabel('Repository for new session').selectOption({
      label: 'Visual fixture repository',
    });
    await waitForStableOverview(page);

    for (const theme of ['dark', 'light'] as const) {
      const active = await page.evaluate(() => document.documentElement.dataset['theme']);
      if (active !== theme) {
        await page.locator('button[title="Switch theme"]').click();
        await page.waitForFunction(
          (expected) => document.documentElement.dataset['theme'] === expected,
          theme,
        );
      }
      for (const [label, width] of Object.entries(WIDTHS)) {
        const actualWidth = await setSidebarWidth(page, width);
        check(`${theme}-${label}: sidebar width is deterministic (${width}px)`,
          Math.abs(actualWidth - width) <= 2, actualWidth);
        await captureState(page, `${theme}-${label}`);
        if (theme === 'dark' && label === 'medium') {
          await page.getByRole('button', { name: 'Show CI checks for Pull Request #42' }).click();
          await page.waitForFunction(() => (
            document.querySelector('.rp-inline')?.textContent?.includes('E2E Lint') ?? false
          ));
          await captureState(page, `${theme}-${label}-checks`);
          await page.keyboard.press('Escape');
          await page.locator('.rp-inline').waitFor({ state: 'detached' });
        }
      }
    }
  } finally {
    if (app) await app.close().catch(() => undefined);
    const safeRoot = resolve(tmpdir());
    const safeScratch = resolve(scratch);
    if (dirname(safeScratch) === safeRoot
        && basename(safeScratch).startsWith('ade-visual-')
        && safeScratch.startsWith(`${safeRoot}${sep}`)) {
      rmSync(safeScratch, { recursive: true, force: true });
    }
  }
  if (baselinesCreated > 0) {
    console.log(`\n${baselinesCreated} baseline(s) written to ${BASELINE_DIR}`);
  }
  console.log(`\n${failed ? 'FAILED' : 'PASSED'} - ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

void run().catch((error) => {
  console.error('Visual regression threw:', error);
  process.exitCode = 1;
});
