/** Production-build Electron workflow for Windows and native POSIX desktops. */

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { DEFAULT_CONFIG, type AdeConfig, type Agent, type Category } from '../src/shared/types';
import { publicationBranch } from '../src/main/publishing/PublicationService';

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

function quotePosixArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function wslExec(
  distribution: string,
  args: string[],
  input?: string,
): string {
  return execFileSync('wsl.exe', [
    '--distribution', distribution,
    '--exec',
    ...args,
  ], {
    encoding: 'utf8',
    input,
    timeout: 30_000,
    windowsHide: true,
  });
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
  const repositoryRoot = realpathSync.native(resolve(managedRepo));
  const commonGitDir = realpathSync.native(resolve(managedRepo, '.git'));
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
      rootPath: repositoryRoot,
      commonGitDir,
      verified: true,
      createdAt: now,
    }],
    workspaceBindings: managedAgents.map((item, index) => ({
      id: `e2e-binding-${item.id}`,
      agentId: item.id,
      repositoryId,
      workspaceDir: item.workspaceDir,
      branch: `ade/${item.id}`,
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

function createManagedWorktrees(root: string): {
  repo: string;
  remote: string;
  workspaces: Record<string, string>;
} {
  const repo = join(root, 'managed-repo');
  const remote = join(root, 'managed-remote.git');
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 'ade-e2e@example.invalid']);
  git(repo, ['config', 'user.name', 'ADE E2E']);
  writeFileSync(join(repo, 'baseline.txt'), 'managed e2e baseline\n', 'utf8');
  git(repo, ['add', 'baseline.txt']);
  git(repo, ['commit', '-m', 'managed e2e baseline']);
  git(root, ['init', '--bare', remote]);
  gitBare(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  const githubUrl = 'https://github.com/ade-e2e/managed.git';
  git(repo, ['remote', 'add', 'origin', githubUrl]);
  git(repo, ['config', `url.${pathToFileURL(remote).toString()}.insteadOf`, githubUrl]);
  git(repo, ['push', '-u', 'origin', 'main']);
  const workspaces: Record<string, string> = {};
  mkdirSync(join(root, 'managed-worktrees'), { recursive: true });
  for (const id of ['e2e-orchestrator', 'e2e-lead', 'e2e-worker']) {
    const path = join(root, 'managed-worktrees', id);
    git(repo, ['worktree', 'add', '-b', `ade/${id}`, path, 'HEAD']);
    workspaces[id] = path;
  }
  return { repo, remote, workspaces };
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
}

function gitBare(repository: string, args: string[]): string {
  return execFileSync('git', ['--git-dir', repository, ...args], { encoding: 'utf8', windowsHide: true });
}

function bareRef(repository: string, ref: string): string | null {
  try {
    return execFileSync('git', ['--git-dir', repository, 'rev-parse', '--verify', ref], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function writeFakeGithubCli(root: string, remote: string): { bin: string; statePath: string } {
  const bin = join(root, 'fake-gh-bin');
  const statePath = join(root, 'fake-gh-state.json');
  mkdirSync(bin, { recursive: true });
  const scriptPath = join(bin, 'gh.cjs');
  const source = `
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const args = process.argv.slice(2);
const statePath = process.env.ADE_E2E_FAKE_GH_STATE;
const remote = process.env.ADE_E2E_MANAGED_REMOTE;
const repo = 'ade-e2e/managed';
const read = () => {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return null; }
};
const write = (value) => fs.writeFileSync(statePath, JSON.stringify(value) + '\\n', 'utf8');
const field = (name) => args[args.indexOf(name) + 1];
if (args[0] === 'auth' && args[1] === 'status') {
  process.stdout.write('authenticated fixture\\n');
} else if (args[0] === 'repo' && args[1] === 'view') {
  process.stdout.write(JSON.stringify({ nameWithOwner: repo }) + '\\n');
} else if (args[0] === 'pr' && args[1] === 'list') {
  if (args.includes('--limit')) {
    process.stdout.write(JSON.stringify([{
      number: 42,
      title: 'Improve repository inspector fixture',
      url: 'https://github.com/' + repo + '/pull/42',
      author: { login: 'e2e-reviewer' },
      isDraft: false,
      updatedAt: '2026-07-19T12:00:00Z',
      headRefName: 'feature/inspector',
      baseRefName: 'main',
      reviewDecision: 'REVIEW_REQUIRED',
      changedFiles: 3,
      additions: 21,
      deletions: 4,
    }]) + '\\n');
  } else {
    const state = read();
    process.stdout.write(JSON.stringify(state ? [state] : []) + '\\n');
  }
} else if (args[0] === 'pr' && args[1] === 'create') {
  const head = field('--head');
  const base = field('--base');
  if (!args.includes('--draft') || !head || !base) process.exit(7);
  const headSha = execFileSync('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/' + head], { encoding: 'utf8' }).trim();
  const state = {
    number: 71,
    url: 'https://github.com/' + repo + '/pull/71',
    isDraft: true,
    state: 'OPEN',
    baseRefName: base,
    headRefName: head,
    headRefOid: headSha,
    statusCheckRollup: [{ name: 'E2E CI', status: 'IN_PROGRESS', conclusion: '' }],
  };
  write(state);
  process.stdout.write(state.url + '\\n');
} else if (args[0] === 'pr' && args[1] === 'view') {
  const state = read();
  if (!state) process.exit(8);
  process.stdout.write(JSON.stringify(state) + '\\n');
} else {
  process.stderr.write('unsupported fake gh command: ' + args.join(' ') + '\\n');
  process.exit(9);
}
`;
  writeFileSync(scriptPath, source, 'utf8');
  if (isWindows) {
    const csharpPath = join(bin, 'GhFixture.cs');
    const executablePath = join(bin, 'gh.exe');
    const csharp = String.raw`
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;

public static class GhFixture {
  private static string Field(string[] args, string name) {
    int index = Array.IndexOf(args, name);
    return index >= 0 && index + 1 < args.Length ? args[index + 1] : "";
  }

  private static string Escape(string value) {
    return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
  }

  private static string PullRequest(string head, string baseBranch, string headSha) {
    return "{\"number\":71,\"url\":\"https://github.com/ade-e2e/managed/pull/71\","
      + "\"isDraft\":true,\"state\":\"OPEN\",\"baseRefName\":\"" + Escape(baseBranch) + "\","
      + "\"headRefName\":\"" + Escape(head) + "\",\"headRefOid\":\"" + Escape(headSha) + "\","
      + "\"statusCheckRollup\":[{\"name\":\"E2E CI\",\"status\":\"IN_PROGRESS\",\"conclusion\":\"\"}]}";
  }

  private static string InspectorPullRequest() {
    return "{\"number\":42,\"title\":\"Improve repository inspector fixture\","
      + "\"url\":\"https://github.com/ade-e2e/managed/pull/42\","
      + "\"author\":{\"login\":\"e2e-reviewer\"},\"isDraft\":false,"
      + "\"updatedAt\":\"2026-07-19T12:00:00Z\","
      + "\"headRefName\":\"feature/inspector\",\"baseRefName\":\"main\","
      + "\"reviewDecision\":\"REVIEW_REQUIRED\",\"changedFiles\":3,"
      + "\"additions\":21,\"deletions\":4}";
  }

  public static int Main(string[] args) {
    string statePath = Environment.GetEnvironmentVariable("ADE_E2E_FAKE_GH_STATE");
    if (args.Length >= 2 && args[0] == "auth" && args[1] == "status") {
      Console.WriteLine("authenticated fixture");
      return 0;
    }
    if (args.Length >= 2 && args[0] == "repo" && args[1] == "view") {
      Console.WriteLine("{\"nameWithOwner\":\"ade-e2e/managed\"}");
      return 0;
    }
    if (args.Length >= 2 && args[0] == "pr" && args[1] == "list") {
      Console.WriteLine(args.Contains("--limit")
        ? "[" + InspectorPullRequest() + "]"
        : (File.Exists(statePath) ? "[" + File.ReadAllText(statePath).Trim() + "]" : "[]"));
      return 0;
    }
    if (args.Length >= 2 && args[0] == "pr" && args[1] == "create") {
      string head = Field(args, "--head");
      string baseBranch = Field(args, "--base");
      if (!args.Contains("--draft") || head.Length == 0 || baseBranch.Length == 0) return 7;
      var info = new ProcessStartInfo("git", "rev-parse HEAD");
      info.UseShellExecute = false;
      info.RedirectStandardOutput = true;
      info.CreateNoWindow = true;
      using (var process = Process.Start(info)) {
        string headSha = process.StandardOutput.ReadToEnd().Trim();
        process.WaitForExit();
        if (process.ExitCode != 0) return 8;
        File.WriteAllText(statePath, PullRequest(head, baseBranch, headSha) + Environment.NewLine);
      }
      Console.WriteLine("https://github.com/ade-e2e/managed/pull/71");
      return 0;
    }
    if (args.Length >= 2 && args[0] == "pr" && args[1] == "view") {
      if (!File.Exists(statePath)) return 8;
      Console.WriteLine(File.ReadAllText(statePath).Trim());
      return 0;
    }
    Console.Error.WriteLine("unsupported fake gh command: " + string.Join(" ", args));
    return 9;
  }
}
`;
    writeFileSync(csharpPath, csharp, 'utf8');
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Add-Type -Path $env:ADE_FIXTURE_CS -OutputAssembly $env:ADE_FIXTURE_EXE -OutputType ConsoleApplication',
    ], {
      env: { ...process.env, ADE_FIXTURE_CS: csharpPath, ADE_FIXTURE_EXE: executablePath },
      timeout: 60_000,
      windowsHide: true,
    });
  } else {
    const launcher = join(bin, 'gh');
    writeFileSync(launcher, '#!/bin/sh\nexec node "$(dirname "$0")/gh.cjs" "$@"\n', 'utf8');
    chmodSync(launcher, 0o755);
  }
  return { bin, statePath };
}

function writeManagedFixture(
  path: string,
  participantIds: { lead: string; worker: string } = {
    lead: 'e2e-lead-participant',
    worker: 'e2e-worker-participant',
  },
): void {
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
      participantId: ${JSON.stringify(participantIds.lead)},
      title: 'Lead E2E assignment',
      prompt: 'Produce the lead-specific E2E report.',
      acceptanceCriteria: ['Lead result is structured'],
      dependsOn: [],
    },
    {
      participantId: ${JSON.stringify(participantIds.worker)},
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
  base.tests = [{ command: 'fixture work', status: 'passed', output: process.platform + ':' + process.cwd() }];
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
  const evidenceDir = process.env['ADE_E2E_EVIDENCE_DIR'];
  const scratch = mkdtempSync(join(tmpdir(), 'ade-e2e-'));
  const userData = join(scratch, 'user-data');
  const workspace = join(scratch, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const fixturePath = join(scratch, 'managed-fixture.cjs');
  writeManagedFixture(fixturePath);
  const managed = createManagedWorktrees(scratch);
  const fakeGithub = writeFakeGithubCli(scratch, managed.remote);
  seedConfig(userData, workspace, fixturePath, managed.repo, managed.workspaces);

  let app: ElectronApplication | null = null;
  let page: Page | null = null;
  const runWslBackend = isWindows && process.env['ADE_WSL_BACKEND_E2E'] === '1';
  const wslDistribution = process.env['ADE_WSL_DISTRO']?.trim() || 'Ubuntu';
  let wslRepository: string | null = null;
  let wslBindingIdsBeforeRestart: string[] = [];
  const wslWorktreeContainers: string[] = [];
  try {
    if (runWslBackend) {
      wslRepository = wslExec(wslDistribution, ['mktemp', '-d', '/tmp/ade-electron-wsl.XXXXXX']).trim();
      if (!/^\/tmp\/ade-electron-wsl\.[A-Za-z0-9]+$/.test(wslRepository)) {
        throw new Error(`Unsafe WSL Electron fixture path: ${wslRepository}`);
      }
      wslExec(wslDistribution, ['git', 'init', '--initial-branch=main', wslRepository]);
      wslExec(wslDistribution, ['git', '-C', wslRepository, 'config', 'user.name', 'ADE Electron WSL']);
      wslExec(wslDistribution, ['git', '-C', wslRepository, 'config', 'user.email', 'ade-electron-wsl@test.invalid']);
      wslExec(wslDistribution, ['tee', '--', `${wslRepository}/README.md`], 'Electron WSL fixture\n');
      wslExec(wslDistribution, ['git', '-C', wslRepository, 'add', 'README.md']);
      wslExec(wslDistribution, ['git', '-C', wslRepository, 'commit', '-m', 'fixture']);
    }
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
        ADE_E2E_FAKE_GH_STATE: fakeGithub.statePath,
        ADE_E2E_MANAGED_REMOTE: managed.remote,
        PATH: `${fakeGithub.bin}${delimiter}${process.env['PATH'] ?? ''}`,
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
    await scopeHeader.getByRole('button', { name: 'Pfad…' }).click();
    const nativeBackendLabel = await scopeHeader.getByLabel('Execution backend')
      .locator('option')
      .first()
      .textContent();
    check('manual repository import names the native host platform accurately',
      nativeBackendLabel === (isWindows
        ? 'Native Windows'
        : process.platform === 'darwin' ? 'Native macOS' : 'Native Linux'),
      nativeBackendLabel);
    await scopeHeader.getByRole('button', { name: 'Pfad…' }).click();
    await scopeHeader.getByLabel('Repository for new session').selectOption({
      label: 'Managed E2E repository',
    });
    const repositoryOverview = page.getByTestId('repository-overview');
    const overviewLoaded = await eventually('selected repository opens a bounded local overview', async () => {
      const text = await repositoryOverview.textContent();
      return text?.includes('Managed E2E repository') === true
        && text.includes('main')
        && text.includes('Clean')
        && text.includes('ade-e2e/managed')
        && text.includes('managed e2e baseline');
    });
    if (!overviewLoaded) {
      const directInspectorResult = await page.evaluate(async () => {
        const api = (window as unknown as {
          ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
        }).ade;
        try {
          return {
            ok: true,
            value: await api.invoke('repository:overview', {
              repositoryId: 'e2e-managed-repository',
            }),
          };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      });
      throw new Error(`Repository overview diagnostic: UI=${JSON.stringify(
        await repositoryOverview.textContent(),
      )} IPC=${JSON.stringify(directInspectorResult)}`);
    }
    await eventually('repository overview renders open GitHub Pull Requests independently', async () => {
      const link = repositoryOverview.getByRole('link', {
        name: /Open Pull Request #42 on GitHub/,
      });
      return await link.count() === 1
        && await link.getAttribute('href') === 'https://github.com/ade-e2e/managed/pull/42'
        && (await link.textContent())?.includes('Improve repository inspector fixture') === true;
    });
    if (evidenceDir) {
      mkdirSync(resolve(evidenceDir), { recursive: true });
      await page.screenshot({
        path: join(resolve(evidenceDir), 'repository-inspector.png'),
        fullPage: true,
      });
    }
    const overviewTab = page.getByRole('tab', { name: 'Overview', exact: true });
    await overviewTab.focus();
    await page.keyboard.press('End');
    check('repository panel tabs support roving End/Home keyboard navigation',
      await page.getByRole('tab', { name: 'Files', exact: true }).getAttribute('aria-selected') === 'true');
    await page.keyboard.press('Home');
    await eventually('Home returns focus and selection to repository overview', async () =>
      await overviewTab.getAttribute('aria-selected') === 'true'
        && await overviewTab.evaluate((element) => element === document.activeElement),
    );
    await eventually('overview reload after tab navigation remains deterministic', async () =>
      (await repositoryOverview.textContent())?.includes('managed e2e baseline') === true,
    );
    const commitButton = repositoryOverview.getByRole('button', {
      name: /Inspect commit .*managed e2e baseline/,
    });
    await commitButton.click();
    await eventually('opening a recent commit loads its capped patch in the shared detail pane', async () =>
      (await page!.locator('.rp-inline .diff-body').textContent())?.includes('baseline.txt') === true,
    );
    await page.keyboard.press('Escape');
    await eventually('Escape closes commit detail and restores focus to its commit row', async () =>
      await page!.locator('.rp-inline').count() === 0
        && await commitButton.evaluate((element) => element === document.activeElement),
    );
    await repositoryOverview.getByRole('button', { name: 'Refresh repository overview' }).click();
    await eventually('manual repository refresh preserves local and provider information', async () => {
      const text = await repositoryOverview.textContent();
      return text?.includes('managed e2e baseline') === true
        && text.includes('Improve repository inspector fixture');
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
        runs: Array<{
          id: string;
          verifiedHeadSha?: string;
          verificationTaskId?: string;
          verifiedAt?: number;
        }>;
        tasks: Array<{ id: string; runId: string; phase: string; expectedHeadSha?: string }>;
        results: Array<{ runId: string }>;
        approvals: Array<{ runId: string; status: string }>;
        workspaceLeases: Array<{
          runId: string;
          participantId: string;
          status: string;
          workspaceDir: string;
          baseSha: string;
        }>;
      };
    });
    const completedTasks = completedSnapshot.tasks.filter((task) => task.runId === 'e2e-managed-run');
    const completedRun = completedSnapshot.runs.find((run) => run.id === 'e2e-managed-run');
    const completedResults = completedSnapshot.results.filter((result) => result.runId === 'e2e-managed-run');
    const completedApprovals = completedSnapshot.approvals.filter((approval) => approval.runId === 'e2e-managed-run');
    const completedLeases = completedSnapshot.workspaceLeases.filter((lease) => lease.runId === 'e2e-managed-run');
    check('Electron flow records one validated result per managed task',
      completedTasks.length === 5 && completedResults.length === 5);
    check('Electron approval is durable and all leases release after verification',
      completedApprovals.some((approval) => approval.status === 'approved') &&
      completedLeases.every((lease) => lease.status === 'released'));
    check('completed repository run persists an immutable verification attestation',
      Boolean(completedRun?.verifiedHeadSha)
      && completedRun?.verificationTaskId === completedTasks.find((task) => task.phase === 'verify')?.id
      && completedTasks.find((task) => task.phase === 'verify')?.expectedHeadSha === completedRun?.verifiedHeadSha
      && typeof completedRun?.verifiedAt === 'number');
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

    const publicationRef = publicationBranch({ id: 'e2e-managed-run', name: 'Managed E2E Run' });
    check('publication branch does not exist before explicit UI confirmation',
      bareRef(managed.remote, `refs/heads/${publicationRef}`) === null);
    await page.getByRole('button', { name: 'Draft-PR', exact: true }).click();
    const publicationDialog = page.getByRole('dialog', { name: 'Verifizierten Draft-PR veröffentlichen' });
    await publicationDialog.waitFor({ state: 'visible' });
    await eventually('publication preview proves repository, base, head and provider', async () => {
      const text = await publicationDialog.textContent();
      return text?.includes('ade-e2e/managed') === true
        && text.includes(publicationRef)
        && text.includes('GitHub CLI im Repo-Backend');
    }, 20_000);
    const publishButton = publicationDialog.getByRole('button', { name: 'Branch pushen & Draft-PR anlegen' });
    check('publication modal owns focus and external mutation stays disabled before confirmation',
      await publishButton.isDisabled()
        && await publicationDialog.getByRole('button', { name: 'Schließen' }).first()
          .evaluate((element) => element === document.activeElement));
    await publicationDialog.getByRole('checkbox').check();
    await publishButton.click();
    await eventually('Electron publication flow creates and verifies the Draft PR', async () =>
      (await publicationDialog.textContent())?.includes('Draft-PR #71 ist angelegt') === true,
    20_000);
    const publishedSnapshot = await page.evaluate(async () => {
      const api = (window as unknown as { ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> } }).ade;
      return await api.invoke('run:get') as {
        publications: Array<{
          runId: string;
          status: string;
          headBranch: string;
          headSha: string;
          prNumber?: number;
          prUrl?: string;
        }>;
      };
    });
    const published = publishedSnapshot.publications.find((item) => item.runId === 'e2e-managed-run');
    check('Draft PR identity and exact attested SHA persist through Electron IPC',
      published?.status === 'draft'
      && published.headBranch === publicationRef
      && published.headSha === completedRun?.verifiedHeadSha
      && published.prNumber === 71);
    check('real publication push creates only the new ADE ref and leaves main unchanged',
      bareRef(managed.remote, `refs/heads/${publicationRef}`) === completedRun?.verifiedHeadSha
      && bareRef(managed.remote, 'refs/heads/main') === completedLeases[0]?.baseSha);
    check('publication UI exposes only the verified credential-free GitHub PR URL',
      await publicationDialog.getByRole('link', { name: 'Auf GitHub öffnen' }).getAttribute('href')
        === 'https://github.com/ade-e2e/managed/pull/71');
    if (evidenceDir) {
      await page.screenshot({ path: join(resolve(evidenceDir), 'verified-draft-pr.png'), fullPage: true });
    }
    await publicationDialog.getByRole('button', { name: 'Schließen' }).first().click();
    await page.keyboard.press('Control+1');
    await eventually('Ctrl+1 returns to Terminals mode', async () =>
      await page!.getByRole('tab', { name: 'Terminals' }).getAttribute('aria-selected') === 'true',
    );

    if (runWslBackend && wslRepository) {
      const scopePanel = page.getByTestId('repository-scope');
      await scopePanel.getByRole('button', { name: 'Pfad…' }).click();
      const backendSelect = scopePanel.getByLabel('Execution backend');
      await eventually('WSL distribution is discoverable in the repository UI', async () =>
        await backendSelect.locator(`option[value="wsl:${wslDistribution}"]`).count() === 1);
      await backendSelect.selectOption(`wsl:${wslDistribution}`);
      await scopePanel.getByLabel('Repository path').fill(wslRepository);
      await scopePanel.getByRole('button', { name: 'Importieren' }).click();
      await eventually('WSL repository import is visibly confirmed', async () =>
        (await scopePanel.textContent())?.includes('importiert') === true);
      await scopePanel.getByRole('button', { name: 'Set agent default' }).click();
      const tabCountBeforeWsl = await page.locator('[role="tab"][id^="session-tab-"]').count();
      await scopePanel.getByRole('button', { name: 'Open new session' }).click();
      await eventually('Windows UI opens a WSL-backed terminal session', async () =>
        await page!.locator('[role="tab"][id^="session-tab-"]').count() === tabCountBeforeWsl + 1,
        20_000,
      );
      await eventually('WSL backend and Linux worktree are visible in the scope header', async () => {
        const text = await scopePanel.textContent();
        return text?.includes(`WSL · ${wslDistribution}`) === true && text.includes('.ade-worktrees');
      });
      await sendCommand(page, "printf 'ADE_ELECTRON_WSL_OK\\n'");
      await eventually('Playwright receives output from the real WSL PTY', async () =>
        (await page!.locator('.terminal-pane-wrap:visible .xterm-rows').textContent())
          ?.includes('ADE_ELECTRON_WSL_OK') === true,
        15_000,
      );
      const scopedDiagnostic = await page.evaluate(async () => {
        const api = (window as unknown as {
          ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
        }).ade;
        const sessions = await api.invoke('pty:list') as {
          sessions: Array<{ id: string; agentId: string; executionBackend?: string; status: string }>;
        };
        const session = sessions.sessions.find((item) => (
          item.agentId === 'e2e-agent'
            && item.executionBackend?.startsWith('wsl:')
            && item.status === 'running'
        ));
        if (!session) throw new Error('Active WSL session is missing');
        const result = await api.invoke('runtime:diagnose', {
          agentId: session.agentId,
          sessionId: session.id,
        }) as {
          items: Array<{ agentId: string; executionBackend?: string; status: string }>;
        };
        return result.items.find((item) => item.agentId === session.agentId);
      });
      check('session-scoped diagnostics use the immutable WSL backend snapshot',
        scopedDiagnostic?.executionBackend === `wsl:${wslDistribution}`
          && scopedDiagnostic.status === 'ready',
        scopedDiagnostic);

      await page.getByRole('button', { name: 'Diagnostics' }).first().click();
      const wslDiagnostics = page.getByRole('dialog', { name: 'Runtime diagnostics' });
      await wslDiagnostics.waitFor({ state: 'visible' });
      await eventually('runtime diagnostics execute against the selected WSL backend', async () =>
        (await wslDiagnostics.textContent())?.includes(`WSL · ${wslDistribution}`) === true);
      await wslDiagnostics.getByRole('button', { name: 'Close' }).click();

      const linuxFixturePath = wslExec(wslDistribution, ['wslpath', '-a', '-u', fixturePath]).trim();
      const wslManaged = await page.evaluate(async ({ command }) => {
        const api = (window as unknown as {
          ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
        }).ade;
        const config = await api.invoke('config:get') as {
          agents: Array<{
            id: string; name: string; role?: string; teamRole?: 'orchestrator' | 'lead' | 'worker';
          }>;
          repositories: Array<{ id: string; executionBackend: string }>;
        };
        const repository = config.repositories.find((item) => item.executionBackend.startsWith('wsl:'));
        if (!repository) throw new Error('WSL repository is missing');
        const agentIds = ['e2e-orchestrator', 'e2e-lead', 'e2e-worker'];
        for (const id of agentIds) {
          const agent = config.agents.find((item) => item.id === id);
          if (!agent) throw new Error(`Managed test agent is missing: ${id}`);
          await api.invoke('agent:update', {
            id: agent.id,
            name: agent.name,
            role: agent.role,
            runtime: 'custom',
            permissionMode: 'default',
            customCommand: command,
            teamRole: agent.teamRole,
          });
          await api.invoke('agent:setDefaultRepository', {
            agentId: agent.id,
            repositoryId: repository.id,
          });
        }
        const run = await api.invoke('run:create', {
          name: 'WSL Managed E2E',
          goal: 'Prove managed task files, Git and runtimes stay inside the selected WSL backend.',
          repositoryId: repository.id,
          participants: [
            { agentId: 'e2e-orchestrator', role: 'orchestrator' },
            { agentId: 'e2e-lead', role: 'lead', teamId: 'wsl-team', teamName: 'WSL Team' },
            { agentId: 'e2e-worker', role: 'worker', teamId: 'wsl-team', teamName: 'WSL Team' },
          ],
          budget: { maxConcurrentTasks: 2, maxApprovals: 1 },
        }) as { id: string };
        const snapshot = await api.invoke('run:get') as {
          participants: Array<{ id: string; runId: string; role: string }>;
        };
        const participants = snapshot.participants.filter((item) => item.runId === run.id);
        return {
          runId: run.id,
          leadParticipantId: participants.find((item) => item.role === 'lead')?.id,
          workerParticipantId: participants.find((item) => item.role === 'worker')?.id,
        };
      }, { command: `node ${quotePosixArg(linuxFixturePath)}` });
      if (!wslManaged.leadParticipantId || !wslManaged.workerParticipantId) {
        throw new Error('WSL managed participants were not created');
      }
      writeManagedFixture(fixturePath, {
        lead: wslManaged.leadParticipantId,
        worker: wslManaged.workerParticipantId,
      });
      await page.evaluate(async (runId) => {
        const api = (window as unknown as {
          ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
        }).ade;
        await api.invoke('run:start', { runId });
      }, wslManaged.runId);
      let wslApprovalId: string | null = null;
      await eventually('WSL managed run reaches its durable approval gate', async () => {
        const state = await page!.evaluate(async (runId) => {
          const api = (window as unknown as {
            ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
          }).ade;
          const snapshot = await api.invoke('run:get') as {
            runs: Array<{ id: string; phase: string; status: string }>;
            approvals: Array<{ id: string; runId: string; status: string }>;
          };
          return {
            run: snapshot.runs.find((item) => item.id === runId),
            approval: snapshot.approvals.find((item) => item.runId === runId && item.status === 'pending'),
          };
        }, wslManaged.runId);
        if (state.run?.status === 'failed') throw new Error('WSL managed run failed before approval');
        wslApprovalId = state.approval?.id ?? null;
        return state.run?.phase === 'approval' && Boolean(wslApprovalId);
      }, 30_000);
      await page.evaluate(async (approvalId) => {
        const api = (window as unknown as {
          ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
        }).ade;
        await api.invoke('runApproval:resolve', { approvalId, decision: 'approve' });
      }, wslApprovalId!);
      await eventually('WSL managed run integrates and verifies through Linux Git', async () => {
        const run = await page!.evaluate(async (runId) => {
          const api = (window as unknown as {
            ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
          }).ade;
          const snapshot = await api.invoke('run:get') as {
            runs: Array<{ id: string; status: string; phase: string }>;
          };
          return snapshot.runs.find((item) => item.id === runId);
        }, wslManaged.runId);
        if (run?.status === 'failed') throw new Error('WSL managed run failed after approval');
        return run?.status === 'completed' && run.phase === 'completed';
      }, 30_000);
      const wslManagedEvidence = await page.evaluate(async (runId) => {
        const api = (window as unknown as {
          ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
        }).ade;
        const snapshot = await api.invoke('run:get') as {
          tasks: Array<{ id: string; runId: string; workspaceDir?: string; workspaceBindingId?: string }>;
          results: Array<{
            runId: string; resultPath: string;
            tests: Array<{ output: string }>;
          }>;
          workspaceLeases: Array<{
            runId: string; participantId: string; workspaceDir: string; status: string;
          }>;
          participants: Array<{ id: string; runId: string; role: string }>;
        };
        return {
          tasks: snapshot.tasks.filter((item) => item.runId === runId),
          results: snapshot.results.filter((item) => item.runId === runId),
          leases: snapshot.workspaceLeases.filter((item) => item.runId === runId),
          participants: snapshot.participants.filter((item) => item.runId === runId),
        };
      }, wslManaged.runId);
      check('managed task/result files cross the boundary without changing their Windows ownership',
        wslManagedEvidence.tasks.length === 5
          && wslManagedEvidence.results.length === 5
          && wslManagedEvidence.results.every((result) => isAbsolute(result.resultPath)));
      check('every managed process and leased worktree ran inside WSL',
        wslManagedEvidence.tasks.every((task) => task.workspaceDir?.startsWith('/tmp/.ade-worktrees/'))
          && wslManagedEvidence.results.filter((result) => result.tests.length > 0)
            .some((result) => result.tests.some((test) => test.output.startsWith('linux:/tmp/.ade-worktrees/'))));
      const orchestratorId = wslManagedEvidence.participants.find((item) => item.role === 'orchestrator')?.id;
      const integratedWorkspace = wslManagedEvidence.leases.find(
        (lease) => lease.participantId === orchestratorId,
      )?.workspaceDir;
      check('WSL transactional integration contains both worker results',
        Boolean(integratedWorkspace)
          && wslExec(wslDistribution, ['cat', '--', `${integratedWorkspace}/lead-e2e.txt`]).trim()
            === 'Lead-specific result.'
          && wslExec(wslDistribution, ['cat', '--', `${integratedWorkspace}/worker-e2e.txt`]).trim()
            === 'Worker-specific result.');

      const wslSessionId = await page.evaluate(async () => {
        const api = (window as unknown as {
          ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
        }).ade;
        const list = await api.invoke('pty:list') as {
          sessions: Array<{ id: string; executionBackend?: string; status: string }>;
        };
        return list.sessions.find((session) => session.executionBackend?.startsWith('wsl:'))?.id ?? null;
      });
      if (!wslSessionId) throw new Error('WSL PTY disappeared before close');
      await page.evaluate(async (sessionId) => {
        const api = (window as unknown as {
          ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
        }).ade;
        await api.invoke('pty:kill', { sessionId });
      }, wslSessionId);
      await eventually('closing the WSL tab releases its PTY', async () => {
        const running = await page!.evaluate(async (sessionId) => {
          const api = (window as unknown as {
            ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
          }).ade;
          const list = await api.invoke('pty:list') as { sessions: Array<{ id: string; status: string }> };
          return list.sessions.some((session) => session.id === sessionId && session.status === 'running');
        }, wslSessionId);
        return !running;
      }, 20_000);
      const persistedWslScope = await page.evaluate(async () => {
        const api = (window as unknown as {
          ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
        }).ade;
        const config = await api.invoke('config:get') as {
          repositories: Array<{ id: string; executionBackend: string }>;
          workspaceBindings: Array<{
            id: string;
            repositoryId: string;
            workspaceDir: string;
            executionBackend: string;
          }>;
        };
        const repository = config.repositories.find((item) => item.executionBackend.startsWith('wsl:'));
        const bindings = config.workspaceBindings.filter((item) => item.repositoryId === repository?.id);
        return { repository, bindings };
      }) as {
        repository?: { id: string; executionBackend: string };
        bindings: Array<{
          id: string;
          workspaceDir: string;
          executionBackend: string;
          status: string;
        }>;
      };
      wslBindingIdsBeforeRestart = persistedWslScope.bindings.map((binding) => binding.id).sort();
      for (const binding of persistedWslScope.bindings) {
        const parts = binding.workspaceDir.split('/');
        wslWorktreeContainers.push(parts.slice(0, -1).join('/'));
      }
      check('WSL repository and released worktree bindings are durable before restart',
        persistedWslScope.repository?.executionBackend === `wsl:${wslDistribution}`
          && persistedWslScope.bindings.length === 4
          && persistedWslScope.bindings.every((binding) => (
            binding.executionBackend === `wsl:${wslDistribution}` && binding.status === 'ready'
          )),
        persistedWslScope);
    }

    await page.getByRole('button', { name: 'Diagnostics' }).first().click();
    const diagnosticsDialog = page.getByRole('dialog', { name: 'Runtime diagnostics' });
    await diagnosticsDialog.waitFor({ state: 'visible' });
    await eventually('diagnostics report configured shell readiness without mutation', async () => {
      const diagnosticText = await diagnosticsDialog.textContent();
      return diagnosticText?.includes('E2E Shell') === true
        && diagnosticText.includes('Interactive shell is ready.');
    });
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
        repositories: Array<{ id: string; executionBackend: string }>;
        workspaceBindings: Array<{
          id: string;
          agentId: string;
          repositoryId: string;
          workspaceDir: string;
          executionBackend: string;
          status: string;
        }>;
        runs: Array<{ id: string; status: string; repositoryId?: string | null }>;
        runPublications: Array<{ runId: string; status: string; prNumber?: number; headSha: string }>;
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
    check('full app restart preserves the verified Draft PR audit record',
      restartedConfig.runPublications.some((publication) => (
        publication.runId === 'e2e-managed-run'
          && publication.status === 'draft'
          && publication.prNumber === 71
      )));

    if (runWslBackend) {
      const restartedWslRepository = restartedConfig.repositories.find(
        (repository) => repository.executionBackend === `wsl:${wslDistribution}`,
      );
      const restartedWslBindings = restartedConfig.workspaceBindings.filter(
        (binding) => binding.repositoryId === restartedWslRepository?.id,
      );
      check('full app restart preserves the exact WSL repository and binding identities',
        Boolean(restartedWslRepository)
          && JSON.stringify(restartedWslBindings.map((binding) => binding.id).sort())
            === JSON.stringify(wslBindingIdsBeforeRestart)
          && restartedWslBindings.every((binding) => (
            binding.executionBackend === `wsl:${wslDistribution}`
              && binding.workspaceDir.startsWith('/tmp/.ade-worktrees/')
              && binding.status === 'ready'
          )),
        restartedWslBindings);

      await page.locator('.agent-row', { hasText: 'E2E Shell' }).click();
      const restartedScopePanel = page.getByTestId('repository-scope');
      await eventually('restarted UI restores the WSL agent default scope', async () =>
        (await restartedScopePanel.textContent())?.includes(`WSL · ${wslDistribution}`) === true);
      const tabCountBeforeRestartedWsl = await page.locator('[role="tab"][id^="session-tab-"]').count();
      await restartedScopePanel.getByRole('button', { name: 'Open new session' }).click();
      await eventually('restarted Windows UI reopens the persisted WSL binding', async () =>
        await page!.locator('[role="tab"][id^="session-tab-"]').count() === tabCountBeforeRestartedWsl + 1,
        20_000,
      );
      await sendCommand(page, "printf 'ADE_WSL_RESTART_OK\\n'");
      await eventually('restarted WSL terminal remains interactive across the app boundary', async () =>
        (await page!.locator('.terminal-pane-wrap:visible .xterm-rows').textContent())
          ?.includes('ADE_WSL_RESTART_OK') === true,
        15_000,
      );

      const restartedWslSessionId = await page.evaluate(async () => {
        const api = (window as unknown as {
          ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
        }).ade;
        const list = await api.invoke('pty:list') as {
          sessions: Array<{ id: string; executionBackend?: string; status: string }>;
        };
        return list.sessions.find((session) => (
          session.executionBackend?.startsWith('wsl:') && session.status === 'running'
        ))?.id ?? null;
      });
      if (!restartedWslSessionId) throw new Error('Restarted WSL PTY is missing');
      await page.evaluate(async (sessionId) => {
        const api = (window as unknown as {
          ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
        }).ade;
        await api.invoke('pty:kill', { sessionId });
      }, restartedWslSessionId);
      await eventually('restarted WSL PTY closes before worktree cleanup', async () => {
        const running = await page!.evaluate(async (sessionId) => {
          const api = (window as unknown as {
            ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
          }).ade;
          const list = await api.invoke('pty:list') as { sessions: Array<{ id: string; status: string }> };
          return list.sessions.some((session) => session.id === sessionId && session.status === 'running');
        }, restartedWslSessionId);
        return !running;
      }, 20_000);

      const cleanup = await page.evaluate(async (repositoryId) => {
        const api = (window as unknown as {
          ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
        }).ade;
        const config = await api.invoke('config:get') as {
          workspaceBindings: Array<{ id: string; repositoryId: string; workspaceDir: string }>;
        };
        const bindings = config.workspaceBindings.filter((item) => item.repositoryId === repositoryId);
        const removed = [];
        for (const binding of bindings) {
          const result = await api.invoke('workspace:removeBinding', { workspaceBindingId: binding.id });
          removed.push({ binding, result });
        }
        return removed;
      }, restartedWslRepository!.id) as Array<{
        binding: { workspaceDir: string };
        result: { branchDeleted: boolean };
      }>;
      check('ADE removes every clean WSL worktree after restart and lease release',
        cleanup.length === 4 && cleanup.some((item) => item.result.branchDeleted),
        cleanup);
    }
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
    if (wslRepository && /^\/tmp\/ade-electron-wsl\.[A-Za-z0-9]+$/.test(wslRepository)) {
      try {
        const worktrees = wslExec(wslDistribution, [
          'git', '-C', wslRepository, 'worktree', 'list', '--porcelain',
        ]).split(/\r?\n/)
          .filter((line) => line.startsWith('worktree '))
          .map((line) => line.slice('worktree '.length).trim())
          .filter((worktree) => /^\/tmp\/\.ade-worktrees\/ade-electron-wsl-[a-z0-9-]+\/[a-z0-9-]+$/.test(worktree));
        for (const worktree of worktrees) {
          wslExec(wslDistribution, ['git', '-C', wslRepository, 'worktree', 'remove', '--force', '--', worktree]);
          const parts = worktree.split('/');
          wslWorktreeContainers.push(parts.slice(0, -1).join('/'));
        }
      } catch { /* fixture repository may already be removed */ }
    }
    for (const container of [...new Set(wslWorktreeContainers)]) {
      if (!container.startsWith('/tmp/.ade-worktrees/')) continue;
      try { wslExec(wslDistribution, ['rmdir', '--', container]); } catch { /* not empty */ }
    }
    if (wslRepository && /^\/tmp\/ade-electron-wsl\.[A-Za-z0-9]+$/.test(wslRepository)) {
      try { wslExec(wslDistribution, ['rm', '-rf', '--', wslRepository]); } catch { /* evidence remains */ }
    }
  }

  console.log(`\n${failed ? 'FAILED' : 'PASSED'} - ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

void run();
