/** Pure checks for the bounded task queue and non-interactive runtime commands. */

import { execFileSync } from 'node:child_process';
import { TaskQueueCancelledError, TaskSlotQueue } from '../src/main/pty/TaskQueue';
import { statusFor } from '../src/renderer/graph/graphModel';
import type { RunTask } from '../src/shared/types';
import { resolveTaskLaunchCommand } from '../src/shared/runtimes';

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
  const agent = (runtime: 'claude' | 'codex' | 'ollama' | 'shell') => ({
    runtime,
    permissionMode: 'default' as const,
    ollamaModel: runtime === 'ollama' ? 'llama3.3' : undefined,
  });

  const claude = resolveTaskLaunchCommand(agent('claude'), 'win32');
  check('Claude task uses print mode', claude?.command.includes('claude -p --') === true, claude);
  check(
    'Claude prompt stays in environment',
    claude?.command.includes('$env:ADE_TASK_PROMPT') === true,
    claude,
  );

  const codex = resolveTaskLaunchCommand(agent('codex'), 'win32');
  check(
    'Codex task uses exec mode',
    codex?.command.includes('codex exec --skip-git-repo-check') === true,
    codex,
  );

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
  runTask.status = 'completed';
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
