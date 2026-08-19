/**
 * Small real-CLI operator check for the Grok Build managed-task adapter.
 *
 * Not part of `pnpm test`: it needs a logged-in `grok` on PATH and talks to
 * the network. It uses a disposable Git repo and never touches a user
 * working tree. Fail-closed if the CLI is missing, unsigned-in, or the
 * structured result / activity contract is not met.
 *
 *   pnpm exec tsx scripts/test-grok-operator.ts
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrokActivityParser } from '../src/main/orchestration/grokStream';
import { GrokJsonAdapter } from '../src/main/orchestration/runtimeAdapters';
import type { Agent, RunTask } from '../src/shared/types';

const MARKER = 'ade grok worker';
const TIMEOUT_MS = 240_000;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (!condition) {
    throw new Error(`ade grok operator: ${label}${detail ? ` — ${String(detail).slice(0, 500)}` : ''}`);
  }
  console.log(`  ok  ${label}`);
}

function locateGrok(): string {
  try {
    const output = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['grok'], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    });
    const path = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (!path) throw new Error('empty');
    return path;
  } catch {
    throw new Error('ade grok operator: `grok` is not on PATH');
  }
}

function assertSignedIn(): void {
  const output = execFileSync('grok', ['models'], {
    encoding: 'utf8',
    timeout: 20_000,
    windowsHide: true,
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (!/logged in|available models|default model/i.test(output)) {
    throw new Error('ade grok operator: grok is not signed in; run `grok login`');
  }
}

function initRepo(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, windowsHide: true });
  execFileSync('git', ['-c', 'user.name=ADE', '-c', 'user.email=ade@example.invalid',
    'commit', '--allow-empty', '-m', 'operator baseline'], { cwd: dir, windowsHide: true });
}

async function main(): Promise<void> {
  console.log('Grok operator run (disposable repo, real CLI)\n');
  locateGrok();
  assertSignedIn();

  const root = mkdtempSync(join(tmpdir(), 'ade-grok-operator-'));
  const repo = join(root, 'repo');
  const taskDir = join(root, 'task');
  mkdirSync(repo, { recursive: true });
  mkdirSync(taskDir, { recursive: true });
  initRepo(repo);

  const agent: Agent = {
    id: 'grok-operator',
    categoryId: 'operator',
    name: 'Grok Worker',
    runtime: 'grok',
    permissionMode: 'bypass',
    grokModel: 'grok-4.6',
    grokReasoningEffort: 'high',
    workspaceDir: repo,
    memoryDir: join(root, 'memory'),
  };
  const task: RunTask = {
    id: 'operator-task',
    runId: 'operator-run',
    participantId: 'grok-operator',
    prompt: '',
    title: 'Write a marker file',
    phase: 'work',
    managed: true,
    dependsOn: [],
    attempt: 1,
    status: 'queued',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const files = {
    taskDir,
    resultPath: join(taskDir, 'RESULT.json'),
    schemaPath: join(taskDir, 'RESULT.schema.json'),
    inboxPath: join(taskDir, 'INBOX.jsonl'),
    outboxPath: join(taskDir, 'OUTBOX.jsonl'),
  };
  writeFileSync(files.inboxPath, '', 'utf8');
  writeFileSync(files.outboxPath, '', 'utf8');
  const prompt = [
    `Create the file hello-ade.txt in the current workspace with exactly this one line: ${MARKER}`,
    'Do not create a git commit. Do not push. Do not touch files other than hello-ade.txt.',
    'When done, return only the ADE structured-result JSON object required by the contract below.',
  ].join(' ');

  const adapter = new GrokJsonAdapter();
  const launch = adapter.prepare(agent, task, prompt, files, process.platform === 'win32' ? 'win32' : 'posix');
  check('adapter prepared a streaming-json prompt-file launch',
    launch.activityFormat === 'grok-streaming-json'
      && launch.command?.includes('--output-format streaming-json') === true
      && !launch.command?.includes('--worktree'));

  const command = `${launch.command} --max-turns 8`;
  const env = {
    ...process.env,
    ...launch.env,
    ADE_TASK_PROMPT_FILE: launch.env['ADE_TASK_PROMPT_FILE'] ?? '',
    GROK_DISABLE_AUTOUPDATER: '1',
    NO_COLOR: '1',
  };
  console.log(`  cwd  ${repo}`);
  console.log(`  cmd  ${command}`);

  let output = '';
  try {
    output = execFileSync(
      process.platform === 'win32' ? 'powershell.exe' : (process.env['SHELL'] ?? 'bash'),
      process.platform === 'win32'
        ? ['-NoLogo', '-NoProfile', '-Command', command]
        : ['-lc', command],
      {
        cwd: repo,
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        windowsHide: true,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    output = `${err.stdout ?? ''}\n${err.stderr ?? ''}`;
    writeFileSync(join(root, 'transcript.txt'), output, 'utf8');
    throw new Error(`ade grok operator: grok exited unsuccessfully: ${err.message ?? error}\n${output.slice(-2_000)}`);
  }
  writeFileSync(join(root, 'transcript.txt'), output, 'utf8');

  const activity = new GrokActivityParser().push(output);
  const result = adapter.readResult(launch, output);
  const created = existsSync(join(repo, 'hello-ade.txt'))
    ? readFileSync(join(repo, 'hello-ade.txt'), 'utf8')
    : '';

  check('activity feed produced live lines',
    activity.some((line) => line.kind === 'tool' || line.kind === 'thinking' || line.kind === 'text'),
    activity);
  check('structured result validated',
    result.outcome === 'succeeded' || result.outcome === 'blocked' || result.outcome === 'failed');
  check('marker file was written',
    created.includes(MARKER), created);
  check('usage did not invent a zero cost',
    result.usage.costUsd === null || result.usage.costUsd > 0);
  check('result lists the created file or is explicit about it',
    result.filesChanged.some((path) => path.includes('hello-ade.txt'))
      || result.summary.toLowerCase().includes('hello-ade')
      || result.outcome !== 'succeeded');

  console.log(`\n  activity ${activity.length} lines · outcome ${result.outcome}`);
  console.log(`  usage    ${result.usage.inputTokens ?? '?'} in / ${result.usage.outputTokens ?? '?'} out · cost ${result.usage.costUsd ?? 'unknown'}`);
  console.log(`  evidence ${root}`);
  console.log('\nPASSED - grok operator run');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
