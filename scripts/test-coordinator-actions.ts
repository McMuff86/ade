import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CONFIG, type AdeConfig, type Agent, type SessionMeta } from '../src/shared/types';
import { CoordinatorActionService, type CoordinatorActionSource } from '../src/main/conversation/CoordinatorActionService';
import { CoordinatorActionStore } from '../src/main/conversation/CoordinatorActionStore';
import { conversationFingerprint } from '../src/main/conversation/ConversationStore';
import { SupervisionStore } from '../src/main/supervision/SupervisionStore';
import { SupervisionService } from '../src/main/supervision/SupervisionService';
import { OrchestrationService } from '../src/main/orchestration/OrchestrationService';
import { RunCoordinator } from '../src/main/orchestration/RunCoordinator';
import { WorkspaceService } from '../src/main/orchestration/WorkspaceService';
import { coordinatorActionTools } from '../src/main/conversation/CoordinatorActionTools';
import { coordinatorActionDetailForWire, coordinatorActionForWire } from '../src/main/conversation/coordinatorActionWire';
import { assertIpcPayload } from '../src/main/ipcValidation';
import { CHANNEL_POLICY, REMOTE_COMMAND_CHANNELS } from '../src/main/ipcPolicy';

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-coordinator-actions-')));
let passed = 0; let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) throw new Error(label); passed++; console.log(`  ok  ${label}`); };
const rejects = async (fn: () => unknown, reason: RegExp) => { try { await fn(); return false; } catch (error) { return reason.test(String(error)); } };
async function main() {
  let config = structuredClone(DEFAULT_CONFIG);
  config.agents = [{ id: 'worker', name: 'Codex worker', categoryId: 'team', runtime: 'codex', permissionMode: 'bypass', codexModel: 'gpt-5.6-sol', codexReasoningEffort: 'high', workspaceDir: root, memoryDir: root } as Agent];
  config.repositories = ['a', 'b'].map(id => ({ id, name: 'Same project name', rootPath: join(root, id), commonGitDir: join(root, id, '.git'), verified: true, executionBackend: 'native', createdAt: 1 }));
  const port = { get: () => config, save: (partial: Partial<AdeConfig>) => config = { ...config, ...partial } };
  let actions!: CoordinatorActionService;
  const supervision = new SupervisionService(new SupervisionStore(join(root, 'supervision.json')), port, () => undefined, Date.now, projectId => actions?.links(projectId) ?? []);
  supervision.command({ operation: 'project', repositoryId: 'a', mode: 'coordinate', objective: '', commandId: 'project-a', revision: 0 });
  supervision.command({ operation: 'project', repositoryId: 'b', mode: 'observe', objective: '', commandId: 'project-b', revision: 1 });
  const [a, b] = supervision.query().projects;
  const orchestration = new OrchestrationService(port);
  const coordinator = new RunCoordinator(port, orchestration, undefined, new WorkspaceService());
  let launches = 0; let queueGuard: (() => void) | undefined; let releaseQueue: (() => void) | undefined; let queue = false;
  coordinator.connect(async (_agent, _prompt, _dispatch, taskId, _repo, _workspace, authorize) => {
    check('child is durably linked to its parent before queue admission', new CoordinatorActionStore(join(root, 'actions.json')).snapshot().actions.some(a => a.taskId === taskId));
    if (queue) { queueGuard = authorize; await new Promise<void>(resolve => { releaseQueue = resolve; }); }
    authorize?.(); launches++; return { id: 'fixture-session', runTaskId: taskId } as SessionMeta;
  }, () => undefined);
  let allowed = true; let open = true;
  const binding = { profileId: 'central', authoritySha256: 'a'.repeat(64), toolContract: 'ade-project-actions-v1' };
  const source: CoordinatorActionSource = { conversationId: randomUUID(), turnId: randomUUID(), binding };
  const actionStore = new CoordinatorActionStore(join(root, 'actions.json'));
  const make = (store = actionStore) => new CoordinatorActionService(store, { config: port, supervision,
    authorize: (id, actual, requireOpen) => { if (!allowed || id !== source.conversationId || conversationFingerprint(actual) !== conversationFingerprint(binding) || requireOpen && !open) throw new Error('Authority revoked'); },
    submit: (input, authorize, reserved) => coordinator.submitSingleTask(input, authorize, reserved), report: id => orchestration.report(id), questions: runId => ({ runId, tasks: [] }) });
  actions = make(); let sequence = 0;
  const context = () => ({ threadId: 'thread', turnId: 'native-turn', callId: `call-${++sequence}`, signal: new AbortController().signal });
  const handoff = { kind: 'handoff' as const, projectId: a.id, text: 'Remember the design decision', nextStep: 'Discuss implementation tomorrow' };
  const task = { kind: 'task' as const, projectId: a.id, agentId: 'worker', prompt: 'PRIVATE_TASK_PROMPT write a fixture result' };
  const confirm = (id: string, commandId: string = randomUUID()) => actions.command({ operation: 'confirm', conversationId: source.conversationId, actionId: id, commandId });
  const call = context(); const proposal = actions.propose(handoff, source, call);
  check('handoff proposal has no persisted handoff or task side effect', !supervision.briefing().projects[0].handoffs.length && !config.runs.length);
  check('same native call replays one durable proposal', actions.propose(handoff, source, call).id === proposal.id && actions.list(source.conversationId).length === 1);
  check('changed native call arguments fail for the identity conflict', await rejects(() => actions.propose({ ...handoff, text: 'Changed' }, source, call), /geändertem Inhalt/));
  actions = make(new CoordinatorActionStore(join(root, 'actions.json')));
  check('proposal survives reopening its store', actions.detail(source.conversationId, proposal.id).text === handoff.text);
  await confirm(proposal.id, 'remember');
  check('confirmed handoff is saved exactly once', supervision.briefing().projects[0].handoffs.length === 1 && (await confirm(proposal.id, 'remember')).replayed);
  check('task proposal creates no run before explicit confirmation', actions.propose(task, source, context()).state === 'proposed' && !config.runs.length);
  const taskAction = actions.list(source.conversationId).at(-1)!;
  check('summaries and explicit action detail never reveal private task prompts', !JSON.stringify(actions.list(source.conversationId)).includes('PRIVATE_TASK_PROMPT') && !JSON.stringify(actions.detail(source.conversationId, taskAction.id)).includes('PRIVATE_TASK_PROMPT'));
  check('a different conversation cannot confirm an action', await rejects(() => actions.command({ operation: 'confirm', conversationId: randomUUID(), actionId: taskAction.id, commandId: 'foreign' }), /gehört nicht/));
  check('one command key cannot be reused for another action', await rejects(() => confirm(taskAction.id, 'remember'), /geänderter Eingabe/));
  const [first, second] = await Promise.all([confirm(taskAction.id, 'task'), confirm(taskAction.id, 'task')]);
  check('concurrent confirmation creates and launches exactly one native task', first.state === 'applied' && second.replayed && config.runs.length === 1 && launches === 1);
  const linked = actions.list(source.conversationId).find(p => p.id === taskAction.id)!;
  check('actual run and task IDs are retained on the same parent', linked.runId === config.runs[0].id && linked.taskId === config.runTasks[0].id && config.runTasks[0].allowQuestions === true);
  check('graph derives the child relationship without a post-launch link write', supervision.query().projects[0].links.some(l => l.id === taskAction.id && l.target.id === linked.runId && l.origin === 'conversation'));
  check('second same-name project has no accidental child relation', !supervision.query().projects[1].links.length);
  config.commandLog = [];
  actions = make(new CoordinatorActionStore(join(root, 'actions.json')));
  check('receipt eviction and restart cannot relaunch a confirmed task', (await confirm(taskAction.id, 'task')).replayed && launches === 1 && config.runs.length === 1);
  check('same request key cannot change confirm to dismiss', await rejects(() => actions.command({ operation: 'dismiss', conversationId: source.conversationId, actionId: taskAction.id, commandId: 'task' }), /geänderter Eingabe/));
  check('observe mode blocks task proposals', await rejects(() => actions.propose({ ...task, projectId: b.id }, source, context()), /Koordinieren/));
  const observed = actions.propose({ ...handoff, projectId: b.id }, source, context()); await confirm(observed.id);
  check('observe mode still supports an explicit handoff without task launch', supervision.briefing().projects[1].handoffs.length === 1 && launches === 1);
  const dismissed = actions.propose(task, source, context());
  await actions.command({ operation: 'dismiss', conversationId: source.conversationId, actionId: dismissed.id, commandId: 'dismiss' });
  check('dismissed task can never be confirmed later', await rejects(() => confirm(dismissed.id), /anders entschieden/) && launches === 1);
  const denied = actions.propose(task, source, context()); allowed = false;
  check('revoked conversation authority prevents confirmation', await rejects(() => confirm(denied.id), /Authority revoked/) && launches === 1);
  allowed = true; open = false;
  check('ending a conversation prevents new task confirmation', await rejects(() => confirm(denied.id), /Authority revoked/)); open = true;
  config.agents[0].codexModel = 'changed';
  check('changed worker profile cannot use an old proposal', await rejects(() => confirm(denied.id), /Profil wurde geändert/)); config.agents[0].codexModel = 'gpt-5.6-sol';
  await confirm(denied.id);
  check('positive task launch works after authority and profile negative controls', launches === 2);
  queue = true; const queued = actions.propose(task, source, context()); await confirm(queued.id); allowed = false;
  check('queued task retains a live authority guard', await rejects(() => queueGuard!(), /Authority revoked/)); releaseQueue!();
  await new Promise(resolve => setImmediate(resolve));
  check('revocation during queue wait fails the task before its native effect', launches === 2 && config.runTasks.find(t => t.id === actions.list(source.conversationId).find(a => a.id === queued.id)!.taskId)?.status === 'failed');
  allowed = true; queue = false;
  const final = actions.propose(task, source, context()); await confirm(final.id);
  check('independent task still launches after rejected queued work', launches === 3);
  const failureStore = new CoordinatorActionStore(join(root, 'actions.json'));
  const save = failureStore.save.bind(failureStore); let failParent = true;
  failureStore.save = next => {
    if (failParent && next.actions.some(a => a.state === 'dispatching' && a.runId)) { failParent = false; throw new Error('Injected parent disk failure'); }
    save(next);
  };
  actions = make(failureStore); const failedParent = actions.propose(task, source, context());
  check('parent disk failure before queue admission blocks launch', await rejects(() => confirm(failedParent.id), /parent disk failure/) && launches === 3);
  const failedChild = actions.list(source.conversationId).find(a => a.id === failedParent.id)!;
  check('failed admission leaves its exact child visible as failed', failedChild.taskStatus === 'failed' && supervision.query().projects[0].links.some(l => l.target.id === failedChild.runId));
  actions = make(new CoordinatorActionStore(join(root, 'actions.json'))); const recoveredRun = actions.propose(task, source, context());
  const recoveryStore = new CoordinatorActionStore(join(root, 'actions.json')); const recoveryState = recoveryStore.snapshot();
  const reserved = recoveryState.actions.find(a => a.id === recoveredRun.id)!; reserved.state = 'dispatching'; recoveryState.revision++; recoveryStore.save(recoveryState);
  const child = orchestration.createSingleTaskRun({ repositoryId: 'a', agentId: 'worker', prompt: task.prompt, allowQuestions: true, commandId: reserved.commandId });
  actions = make(new CoordinatorActionStore(join(root, 'actions.json')));
  check('restart recovers a committed child from its exact command without launch', actions.list(source.conversationId).find(a => a.id === recoveredRun.id)?.runId === child.run.id
    && (await confirm(recoveredRun.id)).replayed && launches === 3);
  const missing = actions.propose(task, source, context()); const missingStore = new CoordinatorActionStore(join(root, 'actions.json')); const missingState = missingStore.snapshot();
  missingState.actions.find(a => a.id === missing.id)!.state = 'dispatching'; missingState.revision++; missingStore.save(missingState);
  actions = make(new CoordinatorActionStore(join(root, 'actions.json')));
  check('interrupted reservation without a receipt remains explicitly uncertain', actions.list(source.conversationId).find(a => a.id === missing.id)?.state === 'uncertain'
    && await rejects(() => confirm(missing.id), /unbestätigt/) && launches === 3);
  const prunedStore = new CoordinatorActionStore(join(root, 'actions.json')); const prunedState = prunedStore.snapshot();
  const pruned = prunedState.actions.find(a => a.id === missing.id)!; pruned.runId = randomUUID(); pruned.taskId = randomUUID(); prunedState.revision++; prunedStore.save(prunedState);
  actions = make(new CoordinatorActionStore(join(root, 'actions.json')));
  check('pruned child stays unavailable without breaking other graph relations or allowing replay', actions.list(source.conversationId).find(a => a.id === missing.id)?.state === 'uncertain'
    && supervision.query().projects[0].links.some(l => l.id === missing.id && !l.available) && supervision.query().projects[0].links.some(l => l.id === taskAction.id && l.available)
    && await rejects(() => confirm(missing.id), /unbestätigt/) && launches === 3);
  const recoveredHandoff = actions.propose(handoff, source, context()); const handoffStore = new CoordinatorActionStore(join(root, 'actions.json')); const handoffState = handoffStore.snapshot();
  const remembered = handoffState.actions.find(a => a.id === recoveredHandoff.id)!; remembered.state = 'dispatching';
  remembered.handoffCommand = { operation: 'remember', projectId: a.id, text: handoff.text, nextStep: handoff.nextStep, linkId: null, commandId: remembered.commandId, revision: supervision.query().revision };
  handoffState.revision++; handoffStore.save(handoffState); supervision.command(remembered.handoffCommand);
  const countBeforeRecovery = supervision.briefing().projects[0].handoffs.length; actions = make(new CoordinatorActionStore(join(root, 'actions.json')));
  check('restart recovers a committed handoff without saving it twice', (await confirm(recoveredHandoff.id)).replayed && supervision.briefing().projects[0].handoffs.length === countBeforeRecovery);
  const positiveAfterCrash = actions.propose(task, source, context()); await confirm(positiveAfterCrash.id);
  check('new explicit action succeeds after crash and disk negative controls', launches === 4);
  const tools = coordinatorActionTools(actions, port, () => source, () => { if (!allowed) throw new Error('Authority revoked'); });
  const profiles = await tools.find(t => t.name === 'ade_codex_profiles')!.invoke({ offset: 0 }, context());
  check('tool catalog exposes actual eligible native Codex profiles', profiles.includes('worker') && !profiles.includes(root));
  check('model cannot supply its own conversation or dispatch IDs', await rejects(() => tools.find(t => t.name === 'ade_prepare_task')!.invoke({ projectId: a.id, agentId: 'worker', prompt: 'x', conversationId: source.conversationId }, context()), /Werkzeugargumente/));
  const aborted = new AbortController(); aborted.abort();
  check('expired native tool call cannot create a proposal', await rejects(() => actions.propose(handoff, source, { ...context(), signal: aborted.signal }), /abort/i));
  const withSecrets = { ...linked, projectName: 'C:\\Users\\private\\repo', error: 'token sk-1234567890abcdefghijklmnopqrstuvwxyz' };
  check('wire action labels and details redact paths and credentials', !JSON.stringify(coordinatorActionForWire(withSecrets)).includes('C:\\Users')
    && !JSON.stringify(coordinatorActionDetailForWire({ action: linked, text: 'C:\\Users\\private\\note', nextStep: '' })).includes('C:\\Users'));
  check('new action channels stay desktop-only and outside generic remote allowlist', CHANNEL_POLICY['conversation:actionsCommand'].surface === 'desktop'
    && CHANNEL_POLICY['conversation:actionsCommand'].effect === 'launch' && !REMOTE_COMMAND_CHANNELS.includes('conversation:actionsCommand'));
  check('action IPC rejects client task/run/command extras', await rejects(() => assertIpcPayload('conversation:actionsQuery', { operation: 'list', conversationId: source.conversationId, runId: linked.runId }), /invalid/));
  assertIpcPayload('conversation:actionsCommand', { operation: 'confirm', conversationId: source.conversationId, actionId: final.id, commandId: 'positive' });
  check('final exact command payload remains admitted', true);
  const corrupted = join(root, 'corrupt.json'); const bytes = readFileSync(join(root, 'actions.json'), 'utf8');
  writeFileSync(corrupted, bytes.replace('"sourceDigest":', '"foreign":'));
  check('malformed ledger fails closed and preserves original bytes', await rejects(() => new CoordinatorActionStore(corrupted), /ungültig/) && readFileSync(corrupted, 'utf8') === bytes.replace('"sourceDigest":', '"foreign":'));
  const driftStore = new CoordinatorActionStore(join(root, 'actions.json')); const state = driftStore.snapshot(); state.revision++;
  writeFileSync(join(root, 'actions.json'), bytes + ' ');
  check('external ledger changes prevent overwrite', await rejects(() => driftStore.save(state), /ausserhalb/));
}
void main().catch(error => { failed++; console.error(error); }).finally(() => {
  if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected fixture root'); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  console.log(`Coordinator actions: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
});
