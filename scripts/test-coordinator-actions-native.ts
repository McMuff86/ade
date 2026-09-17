/** Opt-in real Codex: production coordinator tools, durable confirmation,
 * native project work, question round-trip, result and exact context resume. */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DEFAULT_CONFIG, type AdeConfig, type SessionMeta } from '../src/shared/types';
import { createCoordinatorConversation } from '../src/main/conversation/CoordinatorConversation';
import type { ConversationService } from '../src/main/conversation/ConversationService';
import { CoordinatorActionService } from '../src/main/conversation/CoordinatorActionService';
import { CoordinatorActionStore } from '../src/main/conversation/CoordinatorActionStore';
import { SupervisionStore } from '../src/main/supervision/SupervisionStore';
import { SupervisionService } from '../src/main/supervision/SupervisionService';
import { OrchestrationService } from '../src/main/orchestration/OrchestrationService';
import { RunCoordinator } from '../src/main/orchestration/RunCoordinator';
import { RunQuestionService } from '../src/main/orchestration/RunQuestionService';
import { WorkspaceService } from '../src/main/orchestration/WorkspaceService';
import { CodexAppServerProcess } from '../src/main/pty/CodexAppServerProcess';

if (!process.argv.includes('--run-native')) throw new Error('Native Modellprobe nur ausdrücklich mit --run-native ausführen.');
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-actions-native-')));
const evidence = resolve('test-results/main-agent-planning');
const checks: Array<{ name: string; passed: boolean }> = [];
let service: ConversationService | undefined; let taskProcess: CodexAppServerProcess | undefined;
let failed = 0; let nativeOutput = ''; let childRunId = ''; let childTaskId = '';
const check = (name: string, ok: boolean) => { checks.push({ name, passed: ok }); if (!ok) throw new Error(name); console.log(`  ok  ${name}`); };
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(read: () => boolean, name: string, timeout = 180_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (read()) return; await delay(200); }
  throw new Error(`Native probe timed out: ${name}`);
}
async function main() {
  const version = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '& codex --version'], { windowsHide: true, encoding: 'utf8', timeout: 15000 }).trim();
  check('installed native Codex is pinned to 0.154.0', version === 'codex-cli 0.154.0');
  let config = structuredClone(DEFAULT_CONFIG);
  const repository = join(root, 'project'); const memoryDir = join(root, 'identity'); mkdirSync(repository); mkdirSync(memoryDir);
  writeFileSync(join(repository, 'AGENTS.md'), 'Isolated ADE acceptance project. Work only in this directory. ADE owns Git metadata: do not add, commit, reset, checkout, rebase, merge or push. Ask the requested question through request_user_input, wait for its answer, then write only tablet-result.txt.\n');
  execFileSync('git', ['init', '--quiet', repository], { windowsHide: true, timeout: 10000 });
  config.agents = [{ id: 'codex', categoryId: 'fixture', name: 'Native Codex proof', runtime: 'codex', permissionMode: 'bypass', codexModel: 'gpt-5.6-sol', codexReasoningEffort: 'high', workspaceDir: repository, memoryDir }];
  config.repositories = [{ id: 'project', name: 'Native tablet proof', rootPath: repository, commonGitDir: join(repository, '.git'), verified: true, executionBackend: 'native', createdAt: Date.now() }];
  const port = { get: () => config, save: (partial: Partial<AdeConfig>) => { config = { ...config, ...partial }; writeFileSync(join(root, 'config.json'), JSON.stringify(config)); return config; } };
  let actions!: CoordinatorActionService;
  const supervision = new SupervisionService(new SupervisionStore(join(root, 'supervision.json')), port, () => undefined, Date.now, id => actions?.links(id) ?? []);
  supervision.command({ operation: 'project', commandId: 'project', revision: 0, repositoryId: 'project', objective: 'Complete an isolated Codex tablet acceptance task.', mode: 'coordinate' });
  const projectId = supervision.query().projects[0]!.id;
  const orchestration = new OrchestrationService(port); const coordinator = new RunCoordinator(port, orchestration, undefined, new WorkspaceService());
  const questions = new RunQuestionService(orchestration); let launches = 0; let asked = false;
  coordinator.connect(async (agentId, prompt, _dispatch, taskId, _repo, _workspace, authorize) => {
    authorize?.();
    check('native child has a durable parent before any process starts', new CoordinatorActionStore(join(root, 'actions.json')).snapshot().actions.some(a => a.taskId === taskId));
    launches++;
    const session = { id: randomUUID(), agentId, runTaskId: taskId } as SessionMeta; coordinator.onTaskStarted(taskId!, session);
    taskProcess = new CodexAppServerProcess({ cwd: repository, env: process.env as Record<string, string>, agent: config.agents[0], prompt,
      question: (items, blocking, deliver) => { asked = true; return questions.register(taskId!, items, blocking, deliver); } });
    taskProcess.onData(data => { nativeOutput += data; });
    taskProcess.onExit(event => { coordinator.onTaskFinished(taskId!, event.exitCode === 0 ? 'completed' : 'failed', event.exitCode, nativeOutput); });
    return session;
  }, () => taskProcess?.kill());
  const actionStore = new CoordinatorActionStore(join(root, 'actions.json'));
  actions = new CoordinatorActionService(actionStore, { config: port, supervision,
    authorize: (id, binding, requireOpen) => service!.assertActionAuthority(id, binding, requireOpen),
    submit: (input, authorize, reserved) => coordinator.submitSingleTask(input, authorize, reserved), report: id => orchestration.report(id), questions: id => questions.view(id) });
  const start = () => createCoordinatorConversation({ directory: root, config: port, supervision, actions: () => actions, env: () => process.env as Record<string, string> });
  service = start(); const id = service.command({ operation: 'create', commandId: 'create', profileId: 'codex' }).conversationId;
  const settle = async () => {
    await until(() => { const turn = service!.detail(id).turns.at(-1)!;
      if (turn.status === 'uncertain' || turn.status === 'interrupted') throw new Error(turn.error || turn.status); return turn.status === 'completed'; }, 'coordinator turn');
    return service!.detail(id).turns.at(-1)!;
  };
  const handoffMarker = `HANDOFF_${randomUUID().replaceAll('-', '')}`;
  service.command({ operation: 'send', commandId: 'handoff', conversationId: id, afterTurnId: null,
    text: `This is an authorized isolated integration probe. Prepare a handoff for project ${projectId} using ade_prepare_handoff with text exactly ${handoffMarker} and nextStep exactly Test the Codex task. I will confirm in the ADE UI afterwards. Emit tool results via the wrapper's text helper. Do not prepare a task yet.` });
  await settle(); const note = actions.list(id).find(a => a.kind === 'handoff');
  check('real coordinator prepares a handoff without saving or starting work', !!note && note.state === 'proposed' && !supervision.briefing().projects[0].handoffs.length && launches === 0);
  await actions.command({ operation: 'confirm', conversationId: id, actionId: note!.id, commandId: 'confirm-note' });
  check('explicit confirmation persists the exact native handoff once', supervision.handoff(projectId, supervision.briefing().projects[0].handoffs[0].id).text === handoffMarker
    && (await actions.command({ operation: 'confirm', conversationId: id, actionId: note!.id, commandId: 'confirm-note' })).replayed);
  check('coordinator records observed gpt-5.6-sol and high reasoning', service.detail(id).model === 'gpt-5.6-sol' && service.detail(id).reasoningEffort === 'high');
  await service.shutdown(); service = start();
  service.command({ operation: 'send', commandId: 'task', conversationId: id, afterTurnId: service.detail(id).turns.at(-1)!.id,
    text: `Prepare exactly one Codex project task for project ${projectId}, profile codex, using ade_prepare_task. Use this task prompt: "Read AGENTS.md. This is an authorized isolated native acceptance test. Ask exactly one request_user_input question with id result_text asking for the content of tablet-result.txt, with no options. Wait for the answer. Then create tablet-result.txt containing exactly the supplied answer, no other files or Git changes. Reply with ADE_NATIVE_TASK_DONE followed by the answer." Do not start work; I will confirm in ADE. Emit tool results via the wrapper's text helper.` });
  await settle(); const task = actions.list(id).find(a => a.kind === 'task');
  check('resumed native coordinator prepares a task with no pre-confirmation side effect', !!task && task.state === 'proposed' && launches === 0 && !existsSync(join(repository, 'tablet-result.txt')));
  await actions.command({ operation: 'confirm', conversationId: id, actionId: task!.id, commandId: 'confirm-task' });
  const linked = actions.list(id).find(a => a.id === task!.id)!; childRunId = linked.runId!; childTaskId = linked.taskId!;
  await until(() => { if (config.runTasks[0]?.status === 'failed') throw new Error(config.runTasks[0]?.error || nativeOutput.slice(-2000)); return questions.view(childRunId).tasks.length > 0; }, 'native task question');
  check('real native task exposes its exact pending question through ADE', asked && questions.view(childRunId).tasks[0].taskId === childTaskId);
  const question = questions.view(childRunId).tasks[0].questions[0]; const answerMarker = `TABLET_${randomUUID().replaceAll('-', '')}`;
  await questions.answer({ runId: childRunId, taskId: childTaskId, questionId: question.id, commandId: 'answer',
    answers: Object.fromEntries(question.questions.map(item => [item.id, { answers: [answerMarker] }])) });
  await until(() => ['completed', 'failed', 'cancelled'].includes(config.runTasks[0]?.status), 'native file and result');
  const work = actions.work(id, task!.id);
  check('native task writes the supplied answer and ADE retains its completed result', work.task?.status === 'completed' && readFileSync(join(repository, 'tablet-result.txt'), 'utf8').trim() === answerMarker
    && !!work.task.output?.text.includes('ADE_NATIVE_TASK_DONE') && !work.questions.tasks.length);
  check('replayed task confirmation cannot start another native process', (await actions.command({ operation: 'confirm', conversationId: id, actionId: task!.id, commandId: 'confirm-task' })).replayed && launches === 1);
  service.command({ operation: 'send', commandId: 'result', conversationId: id, afterTurnId: service.detail(id).turns.at(-1)!.id,
    text: `Read ade_action_result for action ${task!.id} at offset 0 and each nextOffset until null. Reply only with the exact TABLET_ marker found in the completed task result. Emit tool results via the wrapper's text helper.` });
  const result = await settle(); check('real coordinator reads the exact completed child result through its ADE tool', result.output.includes(answerMarker));
  check('graph keeps the exact native child attached to its project', supervision.query().projects[0].links.some(l => l.id === task!.id && l.target.id === childRunId && l.origin === 'conversation'));
}
void main().catch(error => { failed++; console.error(error instanceof Error ? error.message : 'Native probe failed'); }).finally(async () => {
  await service?.shutdown(); taskProcess?.kill(); mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, 'coordinator-actions-native.json'), JSON.stringify({ at: new Date().toISOString(), platform: process.platform, model: 'gpt-5.6-sol', reasoning: 'high',
    transport: 'installed Codex app-server 0.154.0', taskLauncher: 'isolated production protocol, no PTY queue/workspace allocation', checks, passed: checks.filter(c => c.passed).length, failed }, null, 2));
  if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected fixture root');
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  console.log(`Coordinator actions native: ${checks.filter(c => c.passed).length} passed, ${failed} failed`); if (failed) process.exitCode = 1;
});
