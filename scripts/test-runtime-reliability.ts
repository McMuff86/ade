/** Pure checks for the bounded task queue and non-interactive runtime commands. */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskQueueCancelledError, TaskSlotQueue } from '../src/main/pty/TaskQueue';
import {
  hostNullDevice,
  hostPathKey,
  resolveHostShell,
} from '../src/main/platform';
import { failureNoticeFor, statusFor } from '../src/renderer/graph/graphModel';
import type { Run, RunEvent, RunTask } from '../src/shared/types';
import { resolveLaunchCommand, resolveTaskLaunchCommand } from '../src/shared/runtimes';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}`, detail ?? '');
  }
}

async function main(): Promise<void> {
  check('Windows path identity folds case',
    hostPathKey('C:\\Repo\\Worker', 'win32') === hostPathKey('c:\\repo\\worker\\', 'win32'));
  check('POSIX path identity preserves case for leases',
    hostPathKey('/tmp/ADE/Worker', 'posix') !== hostPathKey('/tmp/ADE/worker', 'posix'));
  check('host null-device selection is explicit',
    hostNullDevice('win32') === 'NUL' && hostNullDevice('linux') === '/dev/null');
  check('desktop POSIX shell selection honors an executable absolute SHELL',
    resolveHostShell({ SHELL: '/opt/test/zsh' }, 'linux', (path) => path === '/opt/test/zsh')
      === '/opt/test/zsh');
  check('desktop POSIX shell selection ignores relative SHELL and has an absolute fallback',
    resolveHostShell({ SHELL: 'injected-shell' }, 'linux', (path) => path === '/bin/sh')
      === '/bin/sh');

  const failedRun: Run = {
    id: 'failed-run', name: 'Failed run', goal: 'Expose the failure', status: 'failed',
    mode: 'managed', phase: 'failed', budget: {
      maxConcurrentTasks: 1, maxInputTokens: null, maxOutputTokens: null,
      maxCostUsd: null, maxApprovals: 1,
    }, createdAt: 1, updatedAt: 4,
  };
  const failedTask: RunTask = {
    id: 'failed-task', runId: failedRun.id, participantId: 'worker', prompt: 'work',
    title: 'Validate integration result', phase: 'integrate', managed: true, dependsOn: [],
    attempt: 1, status: 'failed', error: 'filesChanged did not match the final path set',
    createdAt: 2, updatedAt: 4,
  };
  const failedEvent: RunEvent = {
    id: 'failed-event', runId: failedRun.id, type: 'run.failed', createdAt: 4,
    data: { detail: 'less precise coordinator failure' }, seq: 3,
  };
  check('failed-run notice prefers the actionable persisted task error',
    failureNoticeFor(failedRun, [failedTask], [failedEvent])?.detail === failedTask.error);

  const agent = (runtime: 'claude' | 'codex' | 'ollama' | 'shell') => ({
    runtime,
    permissionMode: 'default' as const,
    ollamaModel: runtime === 'ollama' ? 'llama3.3' : undefined,
    codexModel: runtime === 'codex' ? 'gpt-5.6-sol' : undefined,
    codexReasoningEffort: runtime === 'codex' ? 'high' as const : undefined,
  });

  const claude = resolveTaskLaunchCommand(agent('claude'), 'win32');
  check('Claude task uses print mode', claude?.command.endsWith('claude -p') === true, claude);
  check(
    'Claude prompt is piped over stdin, not argument-expanded',
    claude?.command.startsWith('$env:ADE_TASK_PROMPT |') === true && claude?.transport === 'stdin',
    claude,
  );
  const claudePosix = resolveTaskLaunchCommand(agent('claude'), 'posix');
  check(
    'Claude posix task pipes the environment prompt',
    claudePosix?.command === 'printf \'%s\\n\' "$ADE_TASK_PROMPT" | claude -p'
      && claudePosix?.transport === 'stdin',
    claudePosix,
  );

  const codex = resolveTaskLaunchCommand(agent('codex'), 'win32');
  check(
    'Codex task pins its model and reasoning in exec mode',
    codex?.command.includes('$env:ADE_TASK_PROMPT | codex exec --model gpt-5.6-sol -c model_reasoning_effort="high" --skip-git-repo-check -') === true
      && codex.transport === 'stdin',
    codex,
  );
  const codexAuto = resolveTaskLaunchCommand({
    runtime: 'codex' as const,
    permissionMode: 'accept-edits' as const,
  }, 'win32');
  check(
    'Codex accept-edits uses the current workspace-write exec sandbox',
    codexAuto?.command.includes('codex exec --sandbox workspace-write --skip-git-repo-check') === true,
    codexAuto,
  );
  const codexBypass = resolveLaunchCommand({
    runtime: 'codex',
    permissionMode: 'bypass',
    codexModel: 'gpt-5.6-sol',
    codexReasoningEffort: 'xhigh',
  });
  check(
    'Codex interactive bypass keeps the persisted Sol/xhigh profile',
    codexBypass === 'codex --dangerously-bypass-approvals-and-sandbox --model gpt-5.6-sol -c model_reasoning_effort="xhigh"',
    codexBypass,
  );
  let unsafeModelRejected = false;
  try {
    resolveLaunchCommand({
      runtime: 'codex', permissionMode: 'bypass', codexModel: 'gpt-5.6-sol; whoami',
    });
  } catch {
    unsafeModelRejected = true;
  }
  check('Codex model ids cannot inject shell syntax', unsafeModelRejected);
  if (process.platform === 'win32' && codex) {
    const shimDir = mkdtempSync(join(tmpdir(), 'ade-codex-stdin-'));
    writeFileSync(join(shimDir, 'codex.cmd'), '@echo off\r\nmore\r\n', 'utf8');
    const quotedPrompt = 'literal "quoted segment" $(Get-Date) $HOME';
    const output = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', codex.command], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${shimDir};${process.env['PATH'] ?? ''}`, ADE_TASK_PROMPT: quotedPrompt },
    }).trim();
    check('Codex stdin transport survives PowerShell 5.1 quotes without evaluation',
      output === quotedPrompt, output);
  } else {
    check('Codex stdin transport survives PowerShell 5.1 quotes without evaluation', codex?.transport === 'stdin');
  }

  const ollama = resolveTaskLaunchCommand(agent('ollama'), 'posix');
  check(
    'Ollama task includes model and environment prompt',
    ollama?.command === 'ollama run llama3.3 "$ADE_TASK_PROMPT"',
    ollama,
  );
  check(
    'Shell rejects natural-language task transport',
    resolveTaskLaunchCommand(agent('shell'), 'win32') === null,
  );

  const literalPrompt = 'literal $(Get-Date) `n $HOME';
  const platform = process.platform === 'win32' ? 'win32' : 'posix';
  const custom = resolveTaskLaunchCommand({
    runtime: 'custom',
    permissionMode: 'default',
    customCommand: process.platform === 'win32' ? 'Write-Output' : 'cat',
  }, platform);
  const customOutput = custom
    ? execFileSync(
        process.platform === 'win32' ? 'powershell.exe' : (process.env['SHELL'] ?? 'bash'),
        process.platform === 'win32'
          ? ['-NoLogo', '-NoProfile', '-Command', custom.command]
          : ['-lc', custom.command],
        { encoding: 'utf8', env: { ...process.env, ADE_TASK_PROMPT: literalPrompt } },
      ).trim()
    : '';
  check(
    'task prompt is transported literally, not shell-evaluated',
    customOutput === literalPrompt,
    customOutput,
  );

  const sessionSlice: Parameters<typeof statusFor>[2]['sessions'] = {
    sessions: {},
    orderByAgent: {},
  };
  const runTask: RunTask = {
    id: 'task',
    runId: 'run',
    participantId: 'participant',
    prompt: 'test',
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
  };
  check(
    'journal running task derives working status',
    statusFor('participant', 'agent', {
      idle: false,
      busy: {},
      sessions: sessionSlice,
      tasks: [runTask],
    }) === 'working',
  );
  check(
    'a running task outranks a paused team flag',
    statusFor('participant', 'agent', {
      idle: true,
      busy: {},
      sessions: sessionSlice,
      tasks: [runTask],
    }) === 'working',
  );
  runTask.status = 'completed';
  check(
    'a paused team without live work reads idle',
    statusFor('participant', 'agent', {
      idle: true,
      busy: {},
      sessions: sessionSlice,
      tasks: [runTask],
    }) === 'idle',
  );
  check(
    'journal completion derives done status',
    statusFor('participant', 'agent', {
      idle: false,
      busy: {},
      sessions: sessionSlice,
      tasks: [runTask],
    }) === 'done',
  );
  runTask.status = 'failed';
  check(
    'journal failure is visible',
    statusFor('participant', 'agent', {
      idle: false,
      busy: {},
      sessions: sessionSlice,
      tasks: [runTask],
    }) === 'failed',
  );
  sessionSlice.sessions.interactive = { kind: 'interactive', status: 'running' };
  sessionSlice.orderByAgent.agent = ['interactive'];
  check(
    'interactive terminal presence is shown without tasks',
    statusFor('participant', 'agent', {
      idle: false,
      busy: {},
      sessions: sessionSlice,
      tasks: [],
    }) === 'running',
  );

  const statuses: Array<{ active: number; queued: number }> = [];
  const queue = new TaskSlotQueue(2, ({ active, queued }) => statuses.push({ active, queued }));
  const first = await queue.acquire({ agentId: 'a', dispatchId: 'd1' });
  const second = await queue.acquire({ agentId: 'b', dispatchId: 'd1' });
  let thirdStarted = false;
  const thirdPromise = queue.acquire({ agentId: 'c', dispatchId: 'd2' }).then((lease) => {
    thirdStarted = true;
    return lease;
  });
  await Promise.resolve();
  check(
    'queue holds work above maxActive',
    !thirdStarted && queue.status().active === 2 && queue.status().queued === 1,
  );
  first.release();
  const third = await thirdPromise;
  check(
    'released slot starts next FIFO item',
    thirdStarted && queue.status().active === 2 && queue.status().queued === 0,
  );

  const fourthPromise = queue.acquire({ agentId: 'd', dispatchId: 'cancel-me' });
  const cancelled = queue.cancelPending((key) => key.dispatchId === 'cancel-me');
  let cancelError = false;
  try {
    await fourthPromise;
  } catch (error) {
    cancelError = error instanceof TaskQueueCancelledError;
  }
  check('queued dispatch cancellation rejects its waiter', cancelled.length === 1 && cancelError);

  second.release();
  third.release();
  check('all leases release exactly once', queue.status().active === 0);
  third.release();
  check('duplicate release is harmless', queue.status().active === 0);
  check('queue emitted status transitions', statuses.length >= 6, statuses);

  console.log(`\n${failed ? 'FAILED' : 'PASSED'} - ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

void main();
