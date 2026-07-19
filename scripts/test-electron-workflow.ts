/** Production-build Electron workflow for Windows and native POSIX desktops. */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { DEFAULT_CONFIG, type AdeConfig, type Agent, type Category } from '../src/shared/types';

let passed = 0;
let failed = 0;
const isWindows = process.platform === 'win32';

function shellEcho(marker: string): string {
  return isWindows ? `Write-Output ${marker}` : `printf '%s\\n' '${marker}'`;
}

function shellDelayThenEcho(milliseconds: number, marker: string): string {
  return isWindows
    ? `Start-Sleep -Milliseconds ${milliseconds}; Write-Output ${marker}`
    : `sleep ${(milliseconds / 1_000).toFixed(3)}; printf '%s\\n' '${marker}'`;
}

function shellDelayThenExit(milliseconds: number, code: number): string {
  return isWindows
    ? `Start-Sleep -Milliseconds ${milliseconds}; exit ${code}`
    : `sleep ${(milliseconds / 1_000).toFixed(3)}; exit ${code}`;
}

function quoteShellArg(value: string): string {
  return isWindows
    ? `"${value.replace(/`/g, '``').replace(/"/g, '`"')}"`
    : `'${value.replace(/'/g, `'"'"'`)}'`;
}

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}`, detail ?? '');
  }
}

async function eventually(
  label: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 15_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) {
        check(label, true);
        return true;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  check(label, false, lastError);
  return false;
}

function seedConfig(
  userData: string,
  workspace: string,
  fixturePath: string,
  managedRepo: string,
  managedWorkspaces: Record<string, string>,
): void {
  const category: Category = {
    id: 'e2e-category',
    name: 'E2E',
    kind: 'plain',
    agents: ['e2e-agent'],
  };
  const agent: Agent = {
    id: 'e2e-agent',
    categoryId: category.id,
    name: 'E2E Shell',
    role: 'Local workflow',
    runtime: 'shell',
    permissionMode: 'default',
    workspaceDir: workspace,
    homeWorkspaceDir: workspace,
    memoryDir: join(userData, 'agent-memory'),
  };
  mkdirSync(agent.memoryDir, { recursive: true });
  const repositoryId = 'e2e-managed-repository';
  const commonGitDir = resolve(managedRepo, '.git');
  const managedCategory: Category = {
    id: 'e2e-managed-category',
    name: 'Managed E2E',
    kind: 'team',
    repoPath: managedRepo,
    defaultRepositoryId: repositoryId,
    agents: ['e2e-orchestrator', 'e2e-lead', 'e2e-worker'],
  };
  const customCommand = `node ${quoteShellArg(fixturePath)}`;
  const managedAgents: Agent[] = [
    { id: 'e2e-orchestrator', name: 'E2E Orchestrator', teamRole: 'orchestrator' },
    { id: 'e2e-lead', name: 'E2E Lead', teamRole: 'lead' },
    { id: 'e2e-worker', name: 'E2E Worker', teamRole: 'worker' },
  ].map((item) => ({
    ...item,
    categoryId: managedCategory.id,
    runtime: 'custom' as const,
    permissionMode: 'default' as const,
    customCommand,
    workspaceDir: managedWorkspaces[item.id]!,
    homeWorkspaceDir: join(userData, 'managed-home', item.id),
    defaultRepositoryId: repositoryId,
    memoryDir: join(userData, 'managed-memory', item.id),
  }));
  for (const item of managedAgents) {
    mkdirSync(item.workspaceDir, { recursive: true });
    mkdirSync(item.homeWorkspaceDir!, { recursive: true });
    mkdirSync(item.memoryDir, { recursive: true });
  }
  const now = Date.now();
  const config: AdeConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    categories: [category, managedCategory],
    agents: [agent, ...managedAgents],
    repositories: [{
      id: repositoryId,
      name: 'Managed E2E repository',
      rootPath: resolve(managedRepo),
      commonGitDir,
      verified: true,
      createdAt: now,
    }],
    workspaceBindings: managedAgents.map((item, index) => ({
      id: `e2e-binding-${item.id}`,
      agentId: item.id,
      repositoryId,
      workspaceDir: item.workspaceDir,
      branch: `e2e/${item.id}`,
      status: 'ready' as const,
      createdAt: now + index,
      lastUsedAt: now + index,
    })),
    runs: [{
      id: 'e2e-failed-run',
      name: 'Historical failed E2E Run',
      goal: 'Expose a persisted fail-closed reason to the operator.',
      status: 'failed',
      mode: 'managed',
      phase: 'failed',
      budget: {
        maxConcurrentTasks: 1,
        maxInputTokens: null,
        maxOutputTokens: null,
        maxCostUsd: null,
        maxApprovals: 1,
      },
      source: 'native',
      repositoryId,
      createdAt: now - 2_000,
      updatedAt: now - 1_000,
    }, {
      id: 'e2e-managed-run',
      name: 'Managed E2E Run',
      goal: 'Prove that ADE plans separate work, waits for approval, integrates, and verifies.',
      status: 'draft',
      mode: 'manual',
      phase: 'draft',
      budget: {
        maxConcurrentTasks: 2,
        maxInputTokens: null,
        maxOutputTokens: null,
        maxCostUsd: null,
        maxApprovals: 1,
      },
      source: 'native',
      repositoryId,
      createdAt: now,
      updatedAt: now,
    }],
    runParticipants: [
      {
        id: 'e2e-failed-participant', runId: 'e2e-failed-run', agentId: 'e2e-orchestrator',
        agentName: 'E2E Orchestrator', runtime: 'custom', role: 'orchestrator', createdAt: now - 2_000,
      },
      {
        id: 'e2e-orchestrator-participant', runId: 'e2e-managed-run', agentId: 'e2e-orchestrator',
        agentName: 'E2E Orchestrator', runtime: 'custom', role: 'orchestrator', createdAt: now,
      },
      {
        id: 'e2e-lead-participant', runId: 'e2e-managed-run', agentId: 'e2e-lead',
        agentName: 'E2E Lead', runtime: 'custom', role: 'lead', teamId: 'e2e-team',
        teamName: 'Managed E2E', createdAt: now + 1,
      },
      {
        id: 'e2e-worker-participant', runId: 'e2e-managed-run', agentId: 'e2e-worker',
        agentName: 'E2E Worker', runtime: 'custom', role: 'worker', teamId: 'e2e-team',
        teamName: 'Managed E2E', createdAt: now + 2,
      },
    ],
    runTasks: [{
      id: 'e2e-failed-task', runId: 'e2e-failed-run', participantId: 'e2e-failed-participant',
      prompt: 'Integrate the validated worker result.', title: 'Validate integration result',
      phase: 'integrate', managed: true, dependsOn: [], attempt: 1, status: 'failed',
      error: 'Integration guard rejected RESULT.json: filesChanged did not match the final worktree path set.',
      createdAt: now - 1_500, updatedAt: now - 1_000, endedAt: now - 1_000,
    }],
    runEvents: [{
      id: 'e2e-failed-created', runId: 'e2e-failed-run', type: 'run.created', createdAt: now - 2_000,
      data: { source: 'native', repositoryId }, seq: 1,
    }, {
      id: 'e2e-failed-task-event', runId: 'e2e-failed-run', type: 'task.failed', createdAt: now - 1_000,
      taskId: 'e2e-failed-task', participantId: 'e2e-failed-participant',
      data: { error: 'Integration guard rejected RESULT.json: filesChanged did not match the final worktree path set.' },
      seq: 2,
    }, {
      id: 'e2e-failed-event', runId: 'e2e-failed-run', type: 'run.failed', createdAt: now - 1_000,
      data: { detail: 'Integration review failed closed.' }, seq: 3,
    }, {
      id: 'e2e-run-created', runId: 'e2e-managed-run', type: 'run.created', createdAt: now,
      data: { source: 'native', repositoryId }, seq: 4,
    }],
  };
  const configDir = join(userData, 'ade');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function createManagedWorktrees(root: string): { repo: string; workspaces: Record<string, string> } {
  const repo = join(root, 'managed-repo');
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 'ade-e2e@example.invalid']);
  git(repo, ['config', 'user.name', 'ADE E2E']);
  writeFileSync(join(repo, 'baseline.txt'), 'managed e2e baseline\n', 'utf8');
  git(repo, ['add', 'baseline.txt']);
  git(repo, ['commit', '-m', 'managed e2e baseline']);
  const workspaces: Record<string, string> = {};
  mkdirSync(join(root, 'managed-worktrees'), { recursive: true });
  for (const id of ['e2e-orchestrator', 'e2e-lead', 'e2e-worker']) {
    const path = join(root, 'managed-worktrees', id);
    git(repo, ['worktree', 'add', '-b', `e2e/${id}`, path, 'HEAD']);
    workspaces[id] = path;
  }
  return { repo, workspaces };
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
}

function writeManagedFixture(path: string): void {
  const source = `
const fs = require('node:fs');
const path = require('node:path');
const prompt = process.env.ADE_TASK_PROMPT || '';
const base = {
  version: 1,
  outcome: 'succeeded',
  summary: 'E2E managed phase completed.',
  assignments: [],
  filesChanged: [],
  tests: [],
  commitSha: null,
  risks: [],
  usage: { inputTokens: 3, outputTokens: 2, costUsd: 0.01 },
};
if (prompt.includes('You are the ADE run orchestrator')) {
  base.summary = 'Created two distinct assignments.';
  base.assignments = [
    {
      participantId: 'e2e-lead-participant',
      title: 'Lead E2E assignment',
      prompt: 'Produce the lead-specific E2E report.',
      acceptanceCriteria: ['Lead result is structured'],
      dependsOn: [],
    },
    {
      participantId: 'e2e-worker-participant',
      title: 'Worker E2E assignment',
      prompt: 'Produce the worker-specific E2E report.',
      acceptanceCriteria: ['Worker result is structured'],
      dependsOn: [],
    },
  ];
} else if (prompt.includes('strictly read-only')) {
  base.summary = 'Final E2E verification passed.';
  base.tests = [{ command: 'fixture verify', status: 'passed', output: 'ok' }];
} else if (prompt.includes('Review the combined result')) {
  base.summary = 'E2E integration review passed.';
  base.tests = [{ command: 'fixture integrate', status: 'passed', output: 'ok' }];
} else {
  const lead = prompt.includes('Lead E2E assignment');
  const changedFile = lead ? 'lead-e2e.txt' : 'worker-e2e.txt';
  base.summary = lead ? 'Lead-specific result.' : 'Worker-specific result.';
  fs.writeFileSync(path.join(process.cwd(), changedFile), base.summary + '\\n', 'utf8');
  base.filesChanged = [changedFile];
  base.tests = [{ command: 'fixture work', status: 'passed', output: 'ok' }];
}
const output = process.env.ADE_TASK_RESULT_PATH;
if (!output) process.exit(9);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(base) + '\\n', 'utf8');
`;
  writeFileSync(path, source, 'utf8');
}

async function activeTabId(page: Page): Promise<string | null> {
  return page.locator('[role="tab"][id^="session-tab-"][aria-selected="true"]').getAttribute('id');
}

async function sendCommand(page: Page, command: string): Promise<void> {
  const input = page.locator('.terminal-pane-wrap:visible .xterm-helper-textarea');
  await input.waitFor({ state: 'visible', timeout: 10_000 });
  await input.click();
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
}

async function run(): Promise<void> {
  const root = process.cwd();
  const scratch = mkdtempSync(join(tmpdir(), 'ade-e2e-'));
  const userData = join(scratch, 'user-data');
  const workspace = join(scratch, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const fixturePath = join(scratch, 'managed-fixture.cjs');
  writeManagedFixture(fixturePath);
  const managed = createManagedWorktrees(scratch);
  seedConfig(userData, workspace, fixturePath, managed.repo, managed.workspaces);

  let app: ElectronApplication | null = null;
  let page: Page | null = null;
  try {
    const packagedExecutable = process.env['ADE_E2E_EXECUTABLE'];
    const launchOptions = {
      ...(packagedExecutable
        ? { executablePath: resolve(packagedExecutable), args: [] }
        : { args: [join(root, 'out/main/index.js')] }),
      cwd: root,
      env: {
        ...process.env,
        ADE_USER_DATA_DIR: userData,
        ADE_E2E_PTY_LIST_SNAPSHOT_DELAY_MS: '900',
        NODE_ENV: 'test',
      },
      timeout: 20_000,
    };
    app = await electron.launch(launchOptions);
    page = await app.firstWindow({ timeout: 20_000 });
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.agent-row', { hasText: 'E2E Shell' }).waitFor({ state: 'visible' });

    const surface = await page.evaluate(() => {
      const global = window as unknown as {
        ade?: Record<string, unknown>;
        require?: unknown;
        process?: unknown;
      };
      return {
        api: Object.keys(global.ade ?? {}).sort(),
        requireType: typeof global.require,
        processType: typeof global.process,
        csp: document.querySelector<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy"]')?.content ?? '',
      };
    });
    check('preload exposes only invoke/on', JSON.stringify(surface.api) === JSON.stringify(['invoke', 'on']), surface.api);
    check('renderer has no Node globals', surface.requireType === 'undefined' && surface.processType === 'undefined', surface);
    check('production renderer loaded the restrictive CSP', surface.csp.includes("default-src 'none'"));

    const preferences = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const prefs = window?.webContents.getLastWebPreferences();
      return {
        sandbox: prefs?.sandbox,
        contextIsolation: prefs?.contextIsolation,
        nodeIntegration: prefs?.nodeIntegration,
        webviewTag: prefs?.webviewTag,
      };
    });
    check('live renderer is sandboxed and context-isolated',
      preferences.sandbox === true && preferences.contextIsolation === true && preferences.nodeIntegration === false,
      preferences);
    check('webview support is disabled', preferences.webviewTag === false, preferences);

    const invalidPayload = await page.evaluate(async () => {
      try {
        const api = (window as unknown as { ade: { invoke: (...args: unknown[]) => Promise<unknown> } }).ade;
        await api.invoke('pty:resize', { sessionId: 'missing', cols: 80, rows: 24, extra: true });
        return '';
      } catch (error) {
        return String(error);
      }
    });
    check(
      'main rejects malformed payloads from the trusted renderer',
      invalidPayload.includes('invalid IPC payload'),
      invalidPayload,
    );
    const unknownChannel = await page.evaluate(async () => {
      try {
        const api = (window as unknown as { ade: { invoke: (...args: unknown[]) => Promise<unknown> } }).ade;
        await api.invoke('not:a:channel');
        return '';
      } catch (error) {
        return String(error);
      }
    });
    check('preload rejects unknown channels', unknownChannel.includes('unknown invoke channel'), unknownChannel);

    // Real UI coverage for first-class Codex model/reasoning persistence. The
    // shell agent is restored before PTY checks so the rest of this workflow
    // still exercises the platform shell transport.
    await page.getByRole('button', { name: 'Agent settings for E2E Shell' }).click({ force: true });
    let agentDialog = page.getByRole('dialog', { name: 'Agent settings' });
    await agentDialog.waitFor({ state: 'visible' });
    await agentDialog.locator('#edit-agent-runtime').selectOption('codex');
    check('Codex settings reveal pinned model and reasoning controls',
      await agentDialog.locator('#edit-agent-codex-model').inputValue() === 'gpt-5.6-sol'
        && await agentDialog.locator('#edit-agent-codex-reasoning').inputValue() === 'high');
    await agentDialog.locator('#edit-agent-codex-reasoning').selectOption('xhigh');
    await agentDialog.locator('#edit-agent-perm').selectOption('bypass');
    const commandPreview = await agentDialog.locator('#edit-agent-cmd').getAttribute('placeholder');
    check('Codex command preview includes Sol, xhigh and bypass',
      commandPreview?.includes('gpt-5.6-sol') === true
        && commandPreview.includes('model_reasoning_effort="xhigh"')
        && commandPreview.includes('dangerously-bypass-approvals-and-sandbox'),
      commandPreview);
    await agentDialog.getByRole('button', { name: 'Save', exact: true }).click();
    await agentDialog.waitFor({ state: 'hidden' });

    await page.getByRole('button', { name: 'Agent settings for E2E Shell' }).click({ force: true });
    agentDialog = page.getByRole('dialog', { name: 'Agent settings' });
    await agentDialog.waitFor({ state: 'visible' });
    check('saved Codex model/reasoning/bypass profile round-trips through Electron IPC',
      await agentDialog.locator('#edit-agent-runtime').inputValue() === 'codex'
        && await agentDialog.locator('#edit-agent-codex-model').inputValue() === 'gpt-5.6-sol'
        && await agentDialog.locator('#edit-agent-codex-reasoning').inputValue() === 'xhigh'
        && await agentDialog.locator('#edit-agent-perm').inputValue() === 'bypass');
    const durableInstructions = readFileSync(join(userData, 'agent-memory', 'AGENTS.md'), 'utf8');
    check('saving an agent guarantees its durable AGENTS.md identity contract',
      durableInstructions.includes('Identity: E2E Shell')
        && durableInstructions.includes('model gpt-5.6-sol')
        && durableInstructions.includes('reasoning xhigh'));
    await agentDialog.locator('#edit-agent-runtime').selectOption('shell');
    await agentDialog.locator('#edit-agent-perm').selectOption('default');
    await agentDialog.getByRole('button', { name: 'Save', exact: true }).click();
    await agentDialog.waitFor({ state: 'hidden' });

    await page.locator('.agent-row', { hasText: 'E2E Shell' }).click();
    await page.keyboard.press('Control+Shift+T');
    const tabs = page.locator('[role="tab"][id^="session-tab-"]');
    await eventually('keyboard shortcut creates a terminal session', async () => await tabs.count() === 1);
    const firstTab = await activeTabId(page);
    check('new session becomes the active tab', Boolean(firstTab));
    await sendCommand(page, shellEcho('ADE_E2E_READY'));
    await eventually('real ConPTY output reaches xterm', async () =>
      (await page!.locator('.terminal-pane-wrap:visible .xterm-rows').textContent())?.includes('ADE_E2E_READY') === true,
    );

    const scopeHeader = page.locator('[data-testid="repository-scope"]');
    await eventually('plain session visibly reports its portable repository scope', async () => {
      const text = await scopeHeader.textContent();
      return text?.includes('No repository') === true && text.includes('Portable home');
    });
    await scopeHeader.getByLabel('Repository for new session').selectOption({
      label: 'Managed E2E repository',
    });
    await scopeHeader.getByRole('button', { name: 'Open new session' }).click();
    await eventually('repository chooser opens a second scoped session', async () => await tabs.count() === 2);
    const secondTab = await activeTabId(page);
    check('repository-scoped session receives focus', Boolean(secondTab) && secondTab !== firstTab, { firstTab, secondTab });
    await eventually('right panel names the active repository, source and ADE worktree', async () => {
      const text = await scopeHeader.textContent();
      return text?.includes('Managed E2E repository') === true
        && text.includes('This session')
        && text.includes('ade/');
    });
    await page.keyboard.press('Control+PageUp');
    await eventually('Ctrl+PageUp selects the previous session', async () => await activeTabId(page!) === firstTab);
    await eventually('switching tabs restores the original immutable plain scope', async () =>
      (await scopeHeader.textContent())?.includes('No repository') === true,
    );
    await page.keyboard.press('Control+PageDown');
    await eventually('Ctrl+PageDown selects the next session', async () => await activeTabId(page!) === secondTab);
    await eventually('switching back restores the repository snapshot', async () =>
      (await scopeHeader.textContent())?.includes('Managed E2E repository') === true,
    );

    await sendCommand(page, shellDelayThenEcho(700, 'ADE_RELOAD_OK'));
    await page.waitForTimeout(75);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.agent-row', { hasText: 'E2E Shell' }).click();
    await eventually('renderer reload reconstructs both main-owned sessions', async () =>
      await page!.locator('[role="tab"][id^="session-tab-"]').count() === 2,
    );
    await eventually('output produced across reload is replayed without a gap', async () =>
      (await page!.locator('.terminal-pane-wrap:visible .xterm-rows').textContent())?.includes('ADE_RELOAD_OK') === true,
    );
    await eventually('renderer reload retains the active session repository scope', async () =>
      (await page!.locator('[data-testid="repository-scope"]').textContent())?.includes('Managed E2E repository') === true,
    );

    await sendCommand(page, shellDelayThenExit(300, 7));
    await page.waitForTimeout(50);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.agent-row', { hasText: 'E2E Shell' }).click();
    await eventually('exit racing a stale reload snapshot has actionable failure UI', async () =>
      (await page!.locator('.session-notice.error').textContent())?.includes('Session failed (exit 7)') === true,
    );
    const evidenceDir = process.env['ADE_E2E_EVIDENCE_DIR'];
    if (evidenceDir) {
      mkdirSync(resolve(evidenceDir), { recursive: true });
      await page.screenshot({ path: join(resolve(evidenceDir), 'failure-ui.png'), fullPage: true });
    }
    await page.getByRole('button', { name: 'Restart' }).click();
    await eventually('restart replaces the failed interactive session', async () => {
      const selected = page!.locator('[role="tab"][id^="session-tab-"][aria-selected="true"]');
      return await selected.count() === 1 && (await selected.getAttribute('aria-label'))?.includes('running') === true;
    });
    await eventually('session restart preserves the exact repository binding', async () =>
      (await page!.locator('[data-testid="repository-scope"]').textContent())?.includes('Managed E2E repository') === true,
    );
    await sendCommand(page, shellEcho('ADE_RESTART_OK'));
    await eventually('restarted terminal accepts input', async () =>
      (await page!.locator('.terminal-pane-wrap:visible .xterm-rows').textContent())?.includes('ADE_RESTART_OK') === true,
    );

    await page.keyboard.press('Control+Shift+W');
    await eventually('close shortcut removes the active tab and PTY', async () =>
      await page!.locator('[role="tab"][id^="session-tab-"]').count() === 1,
    );
    await page.keyboard.press('Control+2');
    await eventually('Ctrl+2 opens Graph mode', async () =>
      await page!.getByRole('tab', { name: 'Graph' }).getAttribute('aria-selected') === 'true',
    );
    await eventually('Graph names the immutable repository selected by the run', async () =>
      (await page!.locator('.grun-repo').textContent()) === 'Managed E2E repository',
    );
    await page.getByLabel('Aktiver Run').selectOption('e2e-failed-run');
    await eventually('failed run exposes its persisted technical reason in the Graph UI', async () =>
      (await page!.locator('.grun-failure[role="alert"]').textContent())?.includes(
        'Integration guard rejected RESULT.json: filesChanged did not match the final worktree path set.',
      ) === true,
    );
    if (evidenceDir) {
      await page.screenshot({ path: join(resolve(evidenceDir), 'run-failure-alert.png'), fullPage: true });
    }
    await page.getByLabel('Aktiver Run').selectOption('e2e-managed-run');
    await page.getByRole('button', { name: 'Orchestrierung starten' }).click();
    await eventually('managed run reaches its real approval gate', async () =>
      await page!.locator('.gapproval').count() === 1 &&
      (await page!.locator('.grun-phase').textContent()) === 'Freigabe',
      20_000,
    );
    const approvalSnapshot = await page.evaluate(async () => {
      const api = (window as unknown as { ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> } }).ade;
      return await api.invoke('run:get') as {
        tasks: Array<{
          id: string;
          runId: string;
          phase: string;
          prompt: string;
          repositoryId?: string | null;
          workspaceBindingId?: string;
          workspaceDir?: string;
        }>;
        results: Array<{ runId: string; taskId: string; commitSha: string | null; filesChanged: string[] }>;
        approvals: Array<{ runId: string; status: string }>;
        workspaceLeases: Array<{
          runId: string;
          participantId: string;
          status: string;
          workspaceDir: string;
          repositoryId?: string;
          workspaceBindingId?: string;
        }>;
      };
    });
    const managedTasks = approvalSnapshot.tasks.filter((task) => task.runId === 'e2e-managed-run');
    const managedLeases = approvalSnapshot.workspaceLeases.filter((lease) => lease.runId === 'e2e-managed-run');
    const workerPrompts = managedTasks.filter((task) => task.phase === 'work').map((task) => task.prompt);
    check('Electron flow persisted distinct worker assignments',
      workerPrompts.length === 2 && workerPrompts[0] !== workerPrompts[1]);
    const workerTaskIds = new Set(managedTasks.filter((task) => task.phase === 'work').map((task) => task.id));
    const workerResults = approvalSnapshot.results.filter((result) => workerTaskIds.has(result.taskId));
    check('ADE, not the sandboxed runtime, created one validated commit per worker diff',
      workerResults.length === 2 && workerResults.every((result) =>
        /^[a-f0-9]{40}$/i.test(result.commitSha ?? '') && result.filesChanged.length === 1));
    check('Electron flow keeps worktree leases active through approval',
      managedLeases.filter((lease) => lease.status === 'active').length === 3);
    check('managed tasks and leases persist exact Goal 5 repository bindings',
      managedTasks.every((task) => (
        task.repositoryId === 'e2e-managed-repository'
          && Boolean(task.workspaceBindingId)
          && Boolean(task.workspaceDir)
      )) && managedLeases.every((lease) => (
        lease.repositoryId === 'e2e-managed-repository' && Boolean(lease.workspaceBindingId)
      )));
    check('managed task setup does not dirty leased repository worktrees',
      managedLeases.every(
        (lease) => git(lease.workspaceDir, ['status', '--porcelain']).trim() === '',
      ));
    if (evidenceDir) {
      await page.screenshot({ path: join(resolve(evidenceDir), 'orchestration-approval.png'), fullPage: true });
    }
    await page.getByRole('button', { name: 'Freigeben & integrieren' }).click();
    await eventually('approved Electron run integrates, verifies, and completes', async () =>
      (await page!.locator('.grun-status').textContent()) === 'Abgeschlossen' &&
      (await page!.locator('.grun-phase').textContent()) === 'Fertig',
      20_000,
    );
    const completedSnapshot = await page.evaluate(async () => {
      const api = (window as unknown as { ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> } }).ade;
      return await api.invoke('run:get') as {
        tasks: Array<{ runId: string; phase: string }>;
        results: Array<{ runId: string }>;
        approvals: Array<{ runId: string; status: string }>;
        workspaceLeases: Array<{
          runId: string;
          participantId: string;
          status: string;
          workspaceDir: string;
        }>;
      };
    });
    const completedTasks = completedSnapshot.tasks.filter((task) => task.runId === 'e2e-managed-run');
    const completedResults = completedSnapshot.results.filter((result) => result.runId === 'e2e-managed-run');
    const completedApprovals = completedSnapshot.approvals.filter((approval) => approval.runId === 'e2e-managed-run');
    const completedLeases = completedSnapshot.workspaceLeases.filter((lease) => lease.runId === 'e2e-managed-run');
    check('Electron flow records one validated result per managed task',
      completedTasks.length === 5 && completedResults.length === 5);
    check('Electron approval is durable and all leases release after verification',
      completedApprovals.some((approval) => approval.status === 'approved') &&
      completedLeases.every((lease) => lease.status === 'released'));
    const integrationWorkspace = completedLeases.find(
      (lease) => lease.participantId === 'e2e-orchestrator-participant',
    )?.workspaceDir;
    check('transactional integration contains both ADE-authored worker commits',
      Boolean(integrationWorkspace) &&
      readFileSync(join(integrationWorkspace!, 'lead-e2e.txt'), 'utf8').trim() === 'Lead-specific result.' &&
      readFileSync(join(integrationWorkspace!, 'worker-e2e.txt'), 'utf8').trim() === 'Worker-specific result.');
    if (evidenceDir) {
      await page.screenshot({ path: join(resolve(evidenceDir), 'orchestration-completed.png'), fullPage: true });
    }
    await page.keyboard.press('Control+1');
    await eventually('Ctrl+1 returns to Terminals mode', async () =>
      await page!.getByRole('tab', { name: 'Terminals' }).getAttribute('aria-selected') === 'true',
    );

    await page.getByRole('button', { name: 'Diagnostics' }).first().click();
    await page.getByRole('dialog', { name: 'Runtime diagnostics' }).waitFor({ state: 'visible' });
    const diagnosticText = await page.getByRole('dialog', { name: 'Runtime diagnostics' }).textContent();
    check('diagnostics report configured shell readiness without mutation',
      diagnosticText?.includes('E2E Shell') === true && diagnosticText.includes('Interactive shell is ready.'),
      diagnosticText);
    if (evidenceDir) {
      await page.screenshot({ path: join(resolve(evidenceDir), 'diagnostics-ui.png'), fullPage: true });
    }
    await page.getByRole('button', { name: 'Close' }).last().click();

    await app.close();
    app = null;
    page = null;
    app = await electron.launch(launchOptions);
    page = await app.firstWindow({ timeout: 20_000 });
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.agent-row', { hasText: 'E2E Shell' }).waitFor({ state: 'visible' });
    const restartedConfig = await page.evaluate(async () => {
      const api = (window as unknown as {
        ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
      }).ade;
      return await api.invoke('config:get') as {
        repositories: Array<{ id: string }>;
        workspaceBindings: Array<{ agentId: string; repositoryId: string; status: string }>;
        runs: Array<{ id: string; status: string; repositoryId?: string | null }>;
      };
    });
    check('full app restart retains repository catalog, new binding and run scope',
      restartedConfig.repositories.filter((repository) => (
        repository.id === 'e2e-managed-repository'
      )).length === 1
        && restartedConfig.workspaceBindings.some((binding) => (
          binding.agentId === 'e2e-agent'
            && binding.repositoryId === 'e2e-managed-repository'
            && binding.status === 'ready'
        ))
        && restartedConfig.runs.some((run) => (
          run.id === 'e2e-managed-run'
            && run.status === 'completed'
            && run.repositoryId === 'e2e-managed-repository'
        )));
  } catch (error) {
    console.error('Electron workflow threw:', error);
    failed += 1;
    if (page) {
      const resultDir = join(root, 'test-results');
      mkdirSync(resultDir, { recursive: true });
      await page.screenshot({ path: join(resultDir, 'electron-workflow-failure.png'), fullPage: true }).catch(() => undefined);
    }
  } finally {
    await app?.close().catch(() => undefined);
    const safeRoot = resolve(tmpdir());
    const safeScratch = resolve(scratch);
    const rel = relative(safeRoot, safeScratch);
    if (dirname(safeScratch) === safeRoot && rel.startsWith('ade-e2e-')) {
      rmSync(safeScratch, { recursive: true, force: true });
    }
  }

  console.log(`\n${failed ? 'FAILED' : 'PASSED'} - ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

void run();
