import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { CodexAppServerProcess } from '../src/main/pty/CodexAppServerProcess';
import { CodexActivityParser, parseCodexUsage } from '../src/main/orchestration/codexStream';
import { RunCoordinator } from '../src/main/orchestration/RunCoordinator';
import { validateCompleteConfig } from '../src/main/config/store';
import { assertIpcPayload } from '../src/main/ipcValidation';
import { mergeActivityLines } from '../src/shared/activity';
import type { RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import type { RunQuestionItem } from '../src/shared/runQuestions';

let passed = 0;
const check = (name: string, ok: boolean): void => { if (!ok) throw new Error(name); passed++; console.log(`  ok  ${name}`); };
async function refuses(name: string, action: () => unknown, reason: RegExp): Promise<void> {
  try { await action(); } catch (error) { check(name, reason.test(String(error))); return; } throw new Error(name);
}
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-run-questions-')));
const processes: CodexAppServerProcess[] = [];
const until = async (test: () => boolean) => { const start = Date.now(); while (!test() && Date.now() - start < 8000) await new Promise((done) => setTimeout(done, 10)); if (!test()) throw new Error('fixture timeout'); };
void (async () => {
  const f = createRemoteWorkspaceFixture(root); const { store, devices, application: app, orchestration, questions } = f;
  devices.enroll('tablet', 'Tablet', 's'.repeat(40)); devices.setAdminScopes('tablet', ['catalog:write', 'workspace:read']);
  const context = (key = randomUUID()): RemoteCommandContext => ({ principal: { id: 'tablet', kind: 'device', proof: 'device-signature', scopes: new Set(devices.activeDevices()[0]!.scopes) }, requestId: 'question-test', idempotencyKey: key });
  const repositoryId = (await app.administer(context(), { operation: 'project-create', input: { name: 'Question fixture' } })).created!.id;
  const base = { agentId: 'builder', repositoryId, prompt: 'Private operator prompt', allowQuestions: true, name: 'Question run' };
  await refuses('unsupported runtimes reject interactive submission before launch', () => orchestration.createSingleTaskRun(base), /native Codex/);
  store.save({ agents: store.get().agents.map((agent) => ({ ...agent, runtime: 'codex', customCommand: undefined, permissionMode: 'bypass' })) });
  const newTask = () => {
    const submission = orchestration.createSingleTaskRun(base);
    orchestration.onTaskStarted(submission.task.id, { id: randomUUID(), agentId: 'builder', kind: 'task', title: 'Codex task', status: 'running', createdAt: Date.now(), runTaskId: submission.task.id });
    return submission;
  };
  const input: RunQuestionItem[] = [{ id: 'choice', header: 'Auswahl', question: 'Welche Variante?', isOther: true, isSecret: false, options: [{ label: 'Blau', description: 'Blaue Variante' }] }];
  const first = newTask(); let deliveries = 0;
  const registration = questions.register(first.task.id, input, true, async () => { deliveries++; });
  check('question metadata is persisted with its task and journaled', store.get().runTasks[0]!.questions![0]!.id === registration.id && store.get().runEvents.at(-1)!.type === 'question.requested');
  check('summary and renderer view expose counts without question bodies', orchestration.summarize(first.run.id)[0]!.tasks[0]!.pendingQuestions === 1
    && orchestration.view().tasks[0]!.pendingQuestions === 1 && !JSON.stringify(orchestration.view()).includes('Welche Variante?'));
  check('detail endpoint exposes the complete question', app.runQuestions(context().principal, first.run.id).tasks[0]!.questions[0]!.questions[0]!.question === 'Welche Variante?');
  await refuses('one task cannot accumulate multiple simultaneous questions', () => questions.register(first.task.id, input, true, async () => undefined), /offene Rückfrage/);
  await refuses('invalid answer map is rejected by desktop IPC', () => assertIpcPayload('run:answer', { runId: first.run.id, taskId: first.task.id, questionId: registration.id, answers: { choice: { answers: [''] } } }), /invalid question answers/);
  const answer = { taskId: first.task.id, questionId: registration.id, answers: { choice: { answers: ['PRIVATE_ANSWER'] } } };
  await refuses('answer requires device signature', () => app.answerRunQuestion({ ...context(), principal: { ...context().principal, proof: 'bearer' } }, first.run.id, answer), /signed device proof/);
  await refuses('answer requires idempotency key', () => app.answerRunQuestion({ ...context(), idempotencyKey: undefined }, first.run.id, answer), /Idempotency-Key/);
  const ctx = context(); await app.answerRunQuestion(ctx, first.run.id, answer); const replay = await app.answerRunQuestion(ctx, first.run.id, answer);
  check('confirmed answer resumes exactly once and replay is durable', deliveries === 1 && replay.replayed && store.get().runTasks[0]!.questions![0]!.status === 'answered');
  check('answer journal distinguishes pending confirmation from confirmed receipt', store.get().runEvents.filter((event) => event.type === 'question.updated')
    .map((event) => event.data?.status).join(',') === 'answering,answered');
  check('answer text and digest stay out of report, view and journal detail', !JSON.stringify([orchestration.report(first.run.id), orchestration.view(), questions.view(first.run.id)]).includes('PRIVATE_ANSWER')
    && !JSON.stringify(orchestration.report(first.run.id)).includes('answerDigest') && !JSON.stringify(store.get()).includes('PRIVATE_ANSWER'));
  await refuses('changed answer cannot reuse old idempotency key', () => app.answerRunQuestion(ctx, first.run.id, { ...answer, answers: { choice: { answers: ['changed'] } } }), /different payload/);
  const second = newTask(); const q2 = questions.register(second.task.id, input, true, async () => { deliveries++; });
  orchestration.onTaskFinished(second.task.id, 'cancelled', 130);
  await refuses('cancelled task cannot accept a late answer', () => questions.answer({ ...answer, runId: second.run.id, taskId: second.task.id, questionId: q2.id }), /abgelaufen/);
  check('cancellation expires its question without losing the question text', orchestration.report(second.run.id).tasks[0]!.questions![0]!.status === 'expired');
  q2.expire();
  const third = newTask(); questions.register(third.task.id, input, true, async () => undefined);
  orchestration.recoverInterruptedTasks();
  check('restart recovery expires questions and terminalizes unfinished tasks', orchestration.report(third.run.id).tasks[0]!.questions![0]!.status === 'expired' && orchestration.report(third.run.id).tasks[0]!.status === 'failed');
  registration.expire();
  validateCompleteConfig(store.get()); check('durable question records pass complete config validation', true);
  const timed = orchestration.createSingleTaskRun(base); const timers: Array<{ callback: () => void; delay: number; cleared: boolean }> = []; let now = 1000;
  store.save({ runs: store.get().runs.map((run) => run.id === timed.run.id ? { ...run, mode: 'managed', budget: { ...run.budget, maxTaskMinutes: 1 } } : run),
    runTasks: store.get().runTasks.map((task) => task.id === timed.task.id ? { ...task, managed: true } : task) });
  const coordinator = new RunCoordinator(store, orchestration, undefined, undefined, undefined, {
    now: () => now, set: (callback, delay) => { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; }, clear: (handle) => { (handle as typeof timers[number]).cleared = true; },
  });
  coordinator.onTaskStarted(timed.task.id, { id: 'timed', agentId: 'builder', kind: 'task', title: 'Timed', status: 'running', createdAt: now });
  now += 10_000; coordinator.onTaskQuestionWait(timed.task.id, true); now += 600_000;
  check('blocking user question pauses the running time budget', timers[0]!.cleared && timers.length === 1);
  coordinator.onTaskQuestionWait(timed.task.id, false);
  check('resume preserves the remaining budget instead of resetting it', timers[1]!.delay === 50_000);
  orchestration.onTaskFinished(timed.task.id, 'cancelled', 130);
  const live = newTask(); let output = ''; let exit: number | undefined; const resultPath = join(root, 'result.txt');
  const process = new CodexAppServerProcess({ cwd: root, env: {}, agent: { permissionMode: 'bypass' }, prompt: 'Private operator prompt', resultPath,
    launch: () => spawn(globalThis.process.execPath, [resolve('scripts/fixtures/codex-app-server.cjs')], { windowsHide: true, stdio: 'pipe' }),
    question: (items, blocking, deliver) => questions.register(live.task.id, items, blocking, deliver),
  }); processes.push(process); process.onData((data) => { output += data; }); process.onExit((event) => { exit = event.exitCode; orchestration.onTaskFinished(live.task.id, event.exitCode === 0 ? 'completed' : 'failed', event.exitCode); });
  await until(() => !!questions.view(live.run.id).tasks.length);
  check('real stdio protocol exposes answerable request without exposing prompt or hidden reasoning', !output.includes('Private operator prompt') && !output.includes('PRIVATE_REASONING_NEVER_EXPORT') && output.includes('A public summary'));
  const liveQuestion = questions.view(live.run.id).tasks[0]!.questions[0]!;
  await app.answerRunQuestion(context(), live.run.id, { taskId: live.task.id, questionId: liveQuestion.id, answers: { choice: { answers: ['Blau'] } } });
  await until(() => exit !== undefined);
  check('protocol acknowledgement wins the same-tick completion race and result is written', exit === 0 && readFileSync(resultPath, 'utf8') === 'Antwort erhalten: Blau'
    && orchestration.report(live.run.id).tasks[0]!.questions![0]!.status === 'answered');
  check('trusted protocol token usage feeds existing accounting', parseCodexUsage(output)?.inputTokens === 123 && parseCodexUsage(output)?.outputTokens === 45);
  const lines = new CodexActivityParser().push(output);
  check('activity shows command start, completion, output and relative access metadata', lines.some((line) => line.text.includes('Gestartet') && line.mobileText?.includes('src'))
    && lines.some((line) => line.text.includes('Exit 0') && line.text.includes('src/example.ts')));
  const merged = mergeActivityLines([{ kind: 'tool', text: 'repeated', sequence: 1 }, { kind: 'tool', text: 'repeated', sequence: 2 }], [{ kind: 'tool', text: 'repeated', sequence: 2 }, { kind: 'text', text: 'last', sequence: 3 }]);
  check('snapshot overlap is deduplicated by sequence without losing repeated commands', merged.length === 3 && merged.map((line) => line.sequence).join() === '1,2,3');
  check('renderer activity retention is bounded', mergeActivityLines(merged, Array.from({ length: 3000 }, (_, i) => ({ kind: 'text', text: 'line', sequence: i + 4 }))).length === 2000);
  let unsupportedExit: number | undefined; const unsupported = new CodexAppServerProcess({ cwd: root, env: {}, agent: { permissionMode: 'default' }, prompt: 'No approval',
    launch: () => spawn(globalThis.process.execPath, [resolve('scripts/fixtures/codex-app-server.cjs')], { windowsHide: true, stdio: 'pipe', env: { ...globalThis.process.env, ADE_PROTOCOL_FIXTURE: 'unknown-request' } }),
    question: () => { throw new Error('Unexpected user question'); },
  }); processes.push(unsupported); unsupported.onExit((event) => { unsupportedExit = event.exitCode; });
  await until(() => unsupportedExit !== undefined); check('unsupported server request fails closed without automatic approval', unsupportedExit === 1);
  const positive = newTask(); const last = questions.register(positive.task.id, input, false, async () => { deliveries++; });
  await questions.answer({ runId: positive.run.id, taskId: positive.task.id, questionId: last.id, answers: { choice: { answers: ['Blau'] } } });
  check('final positive control answers a fresh nonblocking question', orchestration.report(positive.run.id).tasks[0]!.questions![0]!.status === 'answered');
  console.log(`Run questions: ${passed} passed, 0 failed`);
})().catch((error) => { console.error(error); console.log(`Run questions: ${passed} passed, 1 failed`); process.exitCode = 1; })
  .finally(() => { for (const process of processes) process.kill(); if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected fixture root'); rmSync(root, { recursive: true, force: true }); });
