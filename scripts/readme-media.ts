/**
 * Regenerate the README screenshots in docs/media/ from a fictional demo
 * profile against the built app (`pnpm build` first). No user data is read.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { _electron as electron, type Page } from 'playwright';
import { DEFAULT_CONFIG, type AdeConfig, type Agent, type Category } from '../src/shared/types';

const root = resolve(__dirname, '..');
const mediaDir = join(root, 'docs', 'media');

function agent(
  partial: Partial<Agent> & Pick<Agent, 'id' | 'categoryId' | 'name' | 'runtime'>,
  base: string,
): Agent {
  const home = join(base, 'agents', partial.id, 'workspace');
  const memory = join(base, 'agents', partial.id, 'memory');
  mkdirSync(home, { recursive: true });
  mkdirSync(memory, { recursive: true });
  return {
    permissionMode: 'default',
    workspaceDir: home,
    homeWorkspaceDir: home,
    memoryDir: memory,
    ...partial,
  } as Agent;
}

async function run(): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'ade-readme-'));
  const userData = join(scratch, 'user-data');
  const configDir = join(userData, 'ade');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(mediaDir, { recursive: true });

  const categories: Category[] = [
    { id: 'cat-core', name: 'core team', agents: ['a-atlas', 'a-nova', 'a-milo', 'a-rex'], kind: 'team' },
    { id: 'cat-hermes', name: 'hermes', agents: ['a-hermes'] },
    { id: 'cat-ops', name: 'ops', agents: ['a-shell'] },
  ];
  const agents: Agent[] = [
    agent({
      id: 'a-atlas', categoryId: 'cat-core', name: 'Atlas', role: 'Orchestrator',
      runtime: 'codex', codexModel: 'gpt-5.6-sol', codexReasoningEffort: 'xhigh', teamRole: 'orchestrator',
    }, userData),
    agent({
      id: 'a-nova', categoryId: 'cat-core', name: 'Nova', role: 'Frontend & design',
      runtime: 'claude', permissionMode: 'accept-edits', teamRole: 'lead',
    }, userData),
    agent({
      id: 'a-milo', categoryId: 'cat-core', name: 'Milo', role: 'Refactoring',
      runtime: 'codex', codexModel: 'gpt-5.6-sol', codexReasoningEffort: 'high', teamRole: 'worker',
    }, userData),
    agent({
      id: 'a-rex', categoryId: 'cat-core', name: 'Rex', role: 'Code review',
      runtime: 'gemini', teamRole: 'worker',
    }, userData),
    {
      ...agent({
        id: 'a-hermes', categoryId: 'cat-hermes', name: 'Hermes General', role: 'Personal agent',
        runtime: 'custom', customCommand: 'general --tui',
      }, userData),
      homeExecutionBackend: 'wsl:Ubuntu',
      homeWorkspaceDir: '/home/demo/hermes-work',
    },
    agent({
      id: 'a-shell', categoryId: 'cat-ops', name: 'Scratch Shell', role: 'Utility terminal',
      runtime: 'shell',
    }, userData),
  ];
  const config: AdeConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    categories,
    agents,
  };
  writeFileSync(join(configDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  const bannerJs = join(scratch, 'banner.js');
  writeFileSync(bannerJs, [
    "const a='\\x1b[38;5;214m', g='\\x1b[38;5;114m', f='\\x1b[2m', r='\\x1b[0m';",
    'console.log();',
    "console.log(a+'  ade_'+r+'  agentic development environment');",
    'console.log();',
    "console.log(g+'  \\u25cf nova'+r+f+'     claude \\u00b7 accept-edits \\u2014 ready'+r);",
    "console.log(g+'  \\u25cf milo'+r+f+'     codex \\u00b7 gpt-5.6-sol \\u2014 ready'+r);",
    "console.log(g+'  \\u25cf hermes'+r+f+'   wsl:ubuntu \\u00b7 ~/hermes-work \\u2014 ready'+r);",
    'console.log();',
  ].join('\n'), 'utf8');

  const app = await electron.launch({
    args: [join(root, 'out/main/index.js')],
    cwd: root,
    env: { ...process.env, ADE_USER_DATA_DIR: userData, NODE_ENV: 'test' } as Record<string, string>,
    timeout: 20_000,
  });
  try {
    const page: Page = await app.firstWindow({ timeout: 20_000 });
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1480, height: 880 });
    await page.locator('.agent-row', { hasText: 'Nova' }).waitFor({ state: 'visible' });

    // Terminals view with a real session on the utility shell agent.
    await page.locator('.agent-row', { hasText: 'Scratch Shell' }).click();
    await page.keyboard.press('Control+Shift+T');
    const textarea = page.locator('.terminal-pane-wrap:visible .xterm-helper-textarea');
    await textarea.waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(2_500);
    await textarea.focus();
    await page.keyboard.type(`node "${bannerJs}"`, { delay: 8 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2_500);
    await page.screenshot({ path: join(mediaDir, 'terminals.png') });

    // Agent settings with the WSL home backend and photo picker.
    await page.getByRole('button', { name: 'Agent settings for Hermes General' }).click({ force: true });
    const dialog = page.getByRole('dialog', { name: 'Agent settings' });
    await dialog.waitFor({ state: 'visible' });
    await page.waitForTimeout(1_200);
    await page.screenshot({ path: join(mediaDir, 'agent-settings.png') });
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // Graph view with a created (not started) managed run, so no real CLI
    // process is ever launched for the screenshot.
    await page.evaluate(async () => {
      const api = (window as unknown as {
        ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
      }).ade;
      await api.invoke('run:create', {
        name: 'Design system polish',
        goal: 'Tighten spacing, theme tokens and empty states across the app.',
        participants: [
          { agentId: 'a-atlas', role: 'orchestrator' },
          { agentId: 'a-nova', role: 'lead', teamId: 'core', teamName: 'Core Team' },
          { agentId: 'a-milo', role: 'worker', teamId: 'core', teamName: 'Core Team' },
          { agentId: 'a-rex', role: 'worker', teamId: 'core', teamName: 'Core Team' },
        ],
        budget: { maxConcurrentTasks: 2, maxApprovals: 1 },
      });
    });
    await page.keyboard.press('Control+2');
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: join(mediaDir, 'graph.png') });
  } finally {
    await app.close().catch(() => undefined);
    const safeRoot = resolve(tmpdir());
    if (dirname(resolve(scratch)) === safeRoot && basename(scratch).startsWith('ade-readme-')
        && resolve(scratch).startsWith(`${safeRoot}${sep}`)) {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  console.log('README media written to', mediaDir);
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
