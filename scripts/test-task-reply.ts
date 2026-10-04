/** Reply to a finished single task: conversation identity, refusal rules, idempotency and wire privacy. */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { validateCompleteConfig } from '../src/main/config/store';
import { CodexActivityParser } from '../src/main/orchestration/codexStream';
import { resolveTaskLaunchCommand } from '../src/shared/runtimes';
import type { RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import type { Agent } from '../src/shared/types';

let passed = 0; let failed = 0;
const check = (name: string, ok: boolean): void => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } };
async function refuses(name: string, action: () => unknown, reason: RegExp): Promise<void> {
  try { await action(); } catch (error) { check(name, reason.test(String(error))); return; } check(name, false);
}
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-task-reply-')));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

void (async () => {
  const f = createRemoteWorkspaceFixture(root); const { store, devices, application: app, orchestration } = f;
  devices.enroll('tablet', 'Tablet', 's'.repeat(40)); devices.setAdminScopes('tablet', ['catalog:write', 'workspace:read']);
  const context = (key = randomUUID()): RemoteCommandContext => ({ principal: { id: 'tablet', kind: 'device', proof: 'device-signature', scopes: new Set(devices.activeDevices()[0]!.scopes) }, requestId: 'reply-test', idempotencyKey: key });
  const repositoryId = (await app.administer(context(), { operation: 'project-create', input: { name: 'Reply fixture' } })).created!.id;
  const setRuntime = (runtime: Agent['runtime'], customCommand?: string) =>
    store.save({ agents: store.get().agents.map((agent) => ({ ...agent, runtime, customCommand, permissionMode: 'bypass' as const })) });
  const workspaceDir = join(root, 'workspace');
  const start = (taskId: string) => orchestration.onTaskStarted(taskId, { id: randomUUID(), agentId: 'builder', kind: 'task', title: 'task', status: 'running', createdAt: Date.now(), runTaskId: taskId, workspaceDir });
  const record = (taskId: string) => store.get().runTasks.find((task) => task.id === taskId)!;
  const available = (runId: string, taskId: string) => orchestration.report(runId).tasks.find((task) => task.id === taskId)?.reply?.available;

  // --- Claude Code: ADE assigns the conversation id ----------------------------------------
  setRuntime('claude');
  const first = orchestration.createSingleTaskRun({ agentId: 'builder', repositoryId, prompt: 'PRIVATE_FIRST_PROMPT ask me before changing anything' });
  const conversation = record(first.task.id).nativeSessionId!;
  check('a Claude Code single task is queued with its own conversation id', UUID.test(conversation));
  check('the saved configuration with conversation fields passes complete validation', (() => { try { validateCompleteConfig(store.get()); return true; } catch { return false; } })());
  start(first.task.id);
  check('a running task offers no reply', available(first.run.id, first.task.id) === false);
  await refuses('a reply to a running task is refused', () => orchestration.createReplyTask({ runId: first.run.id, taskId: first.task.id, prompt: 'yes' }), /open work/);
  orchestration.onTaskFinished(first.task.id, 'completed', 0, undefined, { text: 'Shall I create test.txt?', source: 'cli', limited: false } as never);
  check('the finished task offers a reply', available(first.run.id, first.task.id) === true);
  const launchedBefore = f.sessions.length;
  const body = { taskId: first.task.id, prompt: 'PRIVATE_REPLY yes, create it' };
  await refuses('a reply requires a signed device proof', () => app.replyTask({ ...context(), principal: { ...context().principal, proof: 'bearer' } }, first.run.id, body), /signed device proof/);
  await refuses('a reply requires an idempotency key', () => app.replyTask({ ...context(), idempotencyKey: undefined }, first.run.id, body), /Idempotency-Key/);
  await refuses('a reply cannot name an agent or a workspace', () => app.replyTask(context(), first.run.id, { ...body, agentId: 'builder' }), /unknown field|agentId/i);
  await refuses('a reply to a task of another run is refused', () => app.replyTask(context(), randomUUID(), body), /not found|nicht/i);
  check('refused replies launch nothing and create no task', f.sessions.length === launchedBefore && store.get().runTasks.length === 1);
  const ctx = context(); const sent = await app.replyTask(ctx, first.run.id, body); const replay = await app.replyTask(ctx, first.run.id, body);
  await new Promise((done) => setTimeout(done, 100)); // the fixture launcher resolves its scope asynchronously
  const reply = record(sent.taskId!);
  check('the reply becomes the next task of the same run and participant', sent.run.id === first.run.id && reply.runId === first.run.id
    && reply.participantId === first.task.participantId && reply.replyToTaskId === first.task.id && !reply.managed);
  check('the reply resumes the answered task\'s conversation', reply.nativeSessionId === conversation);
  check('a replayed reply returns the same task and launches once', replay.replayed === true && replay.taskId === sent.taskId
    && f.sessions.length === launchedBefore + 1 && store.get().runTasks.length === 2);
  await refuses('the reply key cannot carry another text', () => app.replyTask(ctx, first.run.id, { ...body, prompt: 'something else' }), /different payload/);
  check('the run is open again while the reply works', orchestration.report(first.run.id).status === 'running');
  const projections = JSON.stringify([sent, orchestration.report(first.run.id), orchestration.view(), orchestration.summarize(first.run.id), f.inspection.activity(first.run.id)]);
  check('the conversation id never leaves main: not in report, view, summary or wire', !projections.includes(conversation) && !projections.includes('nativeSessionId'));
  check('the reply text stays out of the command result, the run summary and the activity wire',
    !JSON.stringify([sent, orchestration.summarize(first.run.id), f.inspection.activity(first.run.id)]).includes('PRIVATE_REPLY'));
  check('the report links the reply to the task it answers', orchestration.report(first.run.id).tasks.find((task) => task.id === sent.taskId)?.replyToTaskId === first.task.id);
  await refuses('a second reply while the first reply runs is refused', () => orchestration.createReplyTask({ runId: first.run.id, taskId: first.task.id, prompt: 'again' }), /open work/);
  orchestration.onTaskFinished(sent.taskId!, 'completed', 0);
  await refuses('only the last task of the run can be answered', () => orchestration.createReplyTask({ runId: first.run.id, taskId: first.task.id, prompt: 'again' }), /last task/);
  check('the reply itself can be answered, in the same conversation', available(first.run.id, sent.taskId!) === true && available(first.run.id, first.task.id) === false);
  setRuntime('codex');
  await refuses('a reply is refused after the agent switched its runtime', () => orchestration.createReplyTask({ runId: first.run.id, taskId: sent.taskId!, prompt: 'again' }), /agent of this task changed/);
  setRuntime('claude');

  // --- Codex: the CLI reports the thread ---------------------------------------------------
  setRuntime('codex');
  const codex = orchestration.createSingleTaskRun({ agentId: 'builder', repositoryId, prompt: 'codex task' });
  check('a Codex single task has no conversation id until the CLI reports one', record(codex.task.id).nativeSessionId === undefined);
  start(codex.task.id);
  const parser = new CodexActivityParser(); parser.push('{"type":"thread.started","thread_id":"019a-thread_1"}\n{"type":"turn.started"}\n');
  check('the Codex stream parser captures the reported thread id', parser.nativeSessionId === '019a-thread_1');
  const hostile = new CodexActivityParser(); hostile.push('{"type":"thread.started","thread_id":"x; rm -rf ~"}\n');
  check('a thread id outside the identity alphabet is not recorded', hostile.nativeSessionId === undefined);
  orchestration.onTaskFinished(codex.task.id, 'completed', 0);
  check('a Codex task without a recorded thread offers no reply', available(codex.run.id, codex.task.id) === false);
  await refuses('and refuses one', () => orchestration.createReplyTask({ runId: codex.run.id, taskId: codex.task.id, prompt: 'go on' }), /no recorded CLI conversation/);
  const codex2 = orchestration.createSingleTaskRun({ agentId: 'builder', repositoryId, prompt: 'codex task two' });
  start(codex2.task.id); f.coordinator.onTaskNativeSession(codex2.task.id, parser.nativeSessionId!); f.coordinator.onTaskNativeSession(codex2.task.id, 'another-thread');
  orchestration.onTaskFinished(codex2.task.id, 'failed', 1);
  check('the first reported thread is kept and a failed task can be answered too', record(codex2.task.id).nativeSessionId === '019a-thread_1' && available(codex2.run.id, codex2.task.id) === true);

  // --- custom commands have no conversation to continue --------------------------------------
  setRuntime('claude', 'my-wrapper');
  const custom = orchestration.createSingleTaskRun({ agentId: 'builder', repositoryId, prompt: 'custom task' });
  start(custom.task.id); orchestration.onTaskFinished(custom.task.id, 'completed', 0);
  check('a custom command task records no conversation and offers no reply', record(custom.task.id).nativeSessionId === undefined && available(custom.run.id, custom.task.id) === false);

  // --- launch commands -------------------------------------------------------------------------
  const claude = { runtime: 'claude', permissionMode: 'bypass' } as Agent; const codexAgent = { runtime: 'codex', permissionMode: 'bypass' } as Agent;
  const id = '0b0f6c1e-2c1f-4d6e-9a53-6f0c8d1e2a3b';
  check('Claude Code starts under the assigned id and resumes with it',
    resolveTaskLaunchCommand(claude, 'posix', { id, resume: false })!.command.includes(` -p --session-id ${id} --output-format stream-json`)
    && resolveTaskLaunchCommand(claude, 'posix', { id, resume: true })!.command.includes(` -p --resume ${id} --output-format stream-json`)
    && resolveTaskLaunchCommand(claude, 'win32', { id, resume: true })!.command.includes(` -p --resume ${id} `));
  check('Codex resumes the thread with its permission options kept',
    resolveTaskLaunchCommand(codexAgent, 'posix', { id, resume: true })!.command.endsWith(`codex exec --dangerously-bypass-approvals-and-sandbox resume ${id} --json --skip-git-repo-check -`)
    && resolveTaskLaunchCommand(codexAgent, 'posix')!.command.endsWith('codex exec --dangerously-bypass-approvals-and-sandbox --json --skip-git-repo-check -'));
  check('a command without a conversation is unchanged', !resolveTaskLaunchCommand(claude, 'posix')!.command.includes('session-id') && !resolveTaskLaunchCommand(claude, 'posix')!.command.includes('--resume'));
  await refuses('an id outside the identity alphabet never reaches a command line', () => resolveTaskLaunchCommand(claude, 'posix', { id: 'x"; rm -rf ~; "', resume: true }), /invalid CLI conversation identity/);
  await refuses('a custom command cannot continue a conversation', () => resolveTaskLaunchCommand({ ...claude, customCommand: 'wrapper' } as Agent, 'posix', { id, resume: true }), /cannot continue/);
  await refuses('Codex cannot be started under a caller-chosen id', () => resolveTaskLaunchCommand(codexAgent, 'posix', { id, resume: false }), /cannot continue/);
  await refuses('other runtimes cannot continue a conversation', () => resolveTaskLaunchCommand({ runtime: 'gemini', permissionMode: 'default' } as Agent, 'posix', { id, resume: true }), /cannot continue/);

  // --- final positive control --------------------------------------------------------------------
  setRuntime('claude');
  const last = await app.replyTask(context(), first.run.id, { taskId: sent.taskId!, prompt: 'thanks, one more thing' });
  check('final positive control: the latest reply is answered again in the same conversation', record(last.taskId!).nativeSessionId === conversation && record(last.taskId!).replyToTaskId === sent.taskId);
  console.log(`Task reply: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch((error) => { console.error(error); console.log(`Task reply: ${passed} passed, ${failed + 1} failed`); process.exitCode = 1; })
  .finally(() => rmSync(root, { recursive: true, force: true }));
