import { mkdtempSync, readFileSync, realpathSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CONFIG, type AdeConfig, type Agent, type SessionMeta } from '../src/shared/types';
import { validCoordinatorActionInput } from '../src/shared/coordinatorActions';
import { ConversationProjectService } from '../src/main/conversation/ConversationProjectService';
import { CoordinatorActionService } from '../src/main/conversation/CoordinatorActionService';
import { CoordinatorActionStore } from '../src/main/conversation/CoordinatorActionStore';
import { RemoteWorkspaceService } from '../src/main/application/RemoteWorkspaceService';
import { RepositoryScopeService } from '../src/main/repositories/RepositoryScopeService';
import { projectGit } from '../src/main/repositories/ProjectGitBoundary';
import { SupervisionService } from '../src/main/supervision/SupervisionService';
import { SupervisionStore } from '../src/main/supervision/SupervisionStore';
import { ConversationStore, conversationDigest } from '../src/main/conversation/ConversationStore';
import { ConversationService } from '../src/main/conversation/ConversationService';
import { conversationHistoryTools } from '../src/main/conversation/ConversationHistoryTools';
import { OrchestrationService } from '../src/main/orchestration/OrchestrationService';
import { RunCoordinator } from '../src/main/orchestration/RunCoordinator';
import { WorkspaceService } from '../src/main/orchestration/WorkspaceService';
import { coordinatorActionDetailForWire, coordinatorActionForWire } from '../src/main/conversation/coordinatorActionWire';

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-conversation-projects-')));
let passed = 0;
const check = (name: string, ok: boolean) => { if (!ok) throw new Error(name); passed++; console.log(`  ok  ${name}`); };
const rejects = async (fn: () => unknown, pattern: RegExp) => { try { await fn(); return false; } catch (e) { return pattern.test(String(e)); } };
async function main() {
  let config = structuredClone(DEFAULT_CONFIG);
  config.agents = [{ id: 'worker', name: 'Project worker', categoryId: 'team', runtime: 'codex', permissionMode: 'bypass',
    codexModel: 'gpt-5.6-sol', codexReasoningEffort: 'high', workspaceDir: root, memoryDir: root } as Agent];
  const port = { get: () => config, save: (partial: Partial<AdeConfig>) => config = { ...config, ...partial } };
  const scopes = new RepositoryScopeService(port, { baseDir: join(root, 'worktrees') });
  const provision = new RemoteWorkspaceService(port, scopes, root, () => []);
  const supervision = new SupervisionService(new SupervisionStore(join(root, 'supervision.json')), port, () => undefined);
  let privateReply = true, validId = true, validName = true, githubCalls = 0, pushes = 0, notifications = 0;
  const projects = new ConversationProjectService(port, provision, () => { notifications++; throw new Error('fixture notification failure'); },
    async (_cwd, args, input) => {
      githubCalls++;
      if (args.join(' ') === 'api user') return JSON.stringify({ login: 'fixture-owner' });
      if (args.includes('POST')) {
        const body = JSON.parse(input!);
        check('GitHub creation explicitly requests private without auto-init', body.private === true && body.auto_init === false);
        return JSON.stringify({ id: validId ? 42 : undefined, private: privateReply, full_name: `fixture-owner/${body.name}` });
      }
      return JSON.stringify({ id: 42, private: true, full_name: validName ? 'fixture-owner/private-project' : 'different-owner/wrong' });
    }, async (cwd, args, timeout) => {
      if (args[0] === 'push') { check('push targets only the verified origin and main', args.join(' ') === 'push --set-upstream origin main'); pushes++; return ''; }
      return projectGit(cwd, args, timeout);
    });
  const binding = { profileId: 'fixture', authoritySha256: 'a'.repeat(64), toolContract: 'ade-project-actions-v2' };
  const source = { conversationId: randomUUID(), turnId: randomUUID(), binding };
  let allowed = true;
  const authorize = () => { if (!allowed) throw new Error('revoked'); };
  const storePath = join(root, 'actions.json');
  const orchestration = new OrchestrationService(port);
  const coordinator = new RunCoordinator(port, orchestration, undefined, new WorkspaceService());
  let launches = 0;
  coordinator.connect(async (_agent, _prompt, _dispatch, taskId, repositoryId, _workspace, guard) => {
    guard?.();
    const parent = new CoordinatorActionStore(storePath).snapshot().actions.find(action => action.taskId === taskId);
    const repository = config.repositories.find(repository => repository.id === repositoryId);
    check('combined project child is durably linked before admission with context files present', !!parent
      && parent.repositoryId === repositoryId && !!repository && existsSync(join(repository.rootPath, 'AGENTS.md'))
      && existsSync(join(repository.rootPath, 'PROJECT.md')));
    launches++; return { id: `fixture-session-${launches}`, runTaskId: taskId } as SessionMeta;
  }, () => undefined);
  const makeActions = () => new CoordinatorActionService(new CoordinatorActionStore(storePath), {
    config: port, supervision, authorize, createProject: (input, guard, reserved) => projects.create(input, guard, reserved),
    submit: async (input, guard, reserved) => {
      const repository = config.repositories.find(repository => repository.id === input.repositoryId)!;
      check('both reviewed context files are committed before task submission',
        (await projectGit(repository.rootPath, ['show', 'HEAD:AGENTS.md'])) === readFileSync(join(repository.rootPath, 'AGENTS.md'), 'utf8')
        && (await projectGit(repository.rootPath, ['show', 'HEAD:PROJECT.md'])) === readFileSync(join(repository.rootPath, 'PROJECT.md'), 'utf8'));
      return coordinator.submitSingleTask(input, guard, reserved);
    }, report: id => orchestration.report(id), questions: runId => ({ runId, tasks: [] }),
  });
  let actions = makeActions();
  const input = { kind: 'project' as const, name: 'Conversation Project', context: '# Product\nWindows, C++20, JUCE and Lua.\nNext: an audio prototype.', agentsMd: '# Agent\nPreserve real-time audio boundaries.', githubRepo: '' };
  const context = () => ({ threadId: 'thread', turnId: 'turn', callId: randomUUID(), signal: new AbortController().signal });
  const call = context(); const proposal = actions.propose(input, source, call);
  check('proposal has no repository or task side effects', !config.repositories.length && !config.runs.length);
  const preview = actions.detail(source.conversationId, proposal.id).project!;
  check('preview includes a durable pointer to the complete project context', preview.agentsMd.includes('PROJECT.md'));
  check('same model tool call replays the normalized proposal', actions.propose(input, source, call).id === proposal.id);
  const command = { operation: 'confirm' as const, conversationId: source.conversationId, actionId: proposal.id, commandId: 'create-local' };
  const [first, repeat] = await Promise.all([actions.command(command), actions.command(command)]);
  check('concurrent confirmations create exactly one project', first.state === 'applied' && repeat.replayed && config.repositories.length === 1);
  const repo = config.repositories[0];
  check('committed AGENTS.md exactly matches the reviewed preview', readFileSync(join(repo.rootPath, 'AGENTS.md'), 'utf8') === preview.agentsMd);
  check('PROJECT.md retains the complete conversation plan', readFileSync(join(repo.rootPath, 'PROJECT.md'), 'utf8') === input.context);
  check('both context files are tracked in the initial project history', (await projectGit(repo.rootPath, ['ls-files'])).trim().split(/\r?\n/).sort().join(',') === 'AGENTS.md,PROJECT.md');
  check('project starts in Coordinate mode with the saved objective', supervision.query().projects[0].mode === 'coordinate' && supervision.detail(supervision.query().projects[0].id).objective === input.context);
  check('local-only creation makes no GitHub calls and starts no agent', githubCalls === 0 && config.runs.length === 0);
  check('notification failure cannot turn successful creation into uncertainty', notifications === 1 && first.state === 'applied');
  actions = makeActions();
  check('reopening the durable ledger does not recreate the project', (await actions.command(command)).replayed && config.repositories.length === 1);
  check('duplicate names do not overwrite an existing project', await rejects(() => projects.create(preview, authorize, () => undefined), /bereits|already/i) && config.repositories.length === 1);
  check('path-shaped project names are rejected before effects', !validCoordinatorActionInput({ ...input, name: '../outside' }));
  check('oversized context is rejected', !validCoordinatorActionInput({ ...input, context: 'x'.repeat(8001) }));
  const privateInput = { ...preview, name: 'Private Project', githubRepo: 'private-project' };
  const privateId = await projects.create(privateInput, authorize, () => undefined);
  const privateRepo = config.repositories.find(r => r.id === privateId)!;
  check('private creation verifies GitHub before setting origin and pushing', githubCalls === 3 && pushes === 1
    && (await projectGit(privateRepo.rootPath, ['remote', 'get-url', 'origin'])).trim() === 'https://github.com/fixture-owner/private-project.git');
  privateReply = false;
  check('public repository response never triggers a push', await rejects(() => projects.create({ ...privateInput, name: 'Reject Public' }, authorize, () => undefined), /privat|private/i) && pushes === 1);
  privateReply = true; validId = false;
  check('missing GitHub identity never triggers a push', await rejects(() => projects.create({ ...privateInput, name: 'Reject Missing Identity' }, authorize, () => undefined), /privat|private/i) && pushes === 1);
  validId = true; validName = false;
  check('verification of a different GitHub repository prevents a push', await rejects(() => projects.create({ ...privateInput, name: 'Reject Wrong Identity' }, authorize, () => undefined), /privat|private/i) && pushes === 1);
  let reserved = '';
  check('revocation after local creation stops before context files', await rejects(() => projects.create({ ...preview, name: 'Revoke During Creation' }, authorize, id => { reserved = id; allowed = false; }), /revoked/));
  check('partial project identity remains recoverable without overwriting or retry', !!reserved && !existsSync(join(config.repositories.find(r => r.id === reserved)!.rootPath, 'AGENTS.md')));
  allowed = true;
  const firstTask = { agentId: 'worker', prompt: 'PRIVATE_FIRST_TASK build the approved audio prototype' };
  const combinedInput = { ...input, name: 'Create And Start', start: firstTask };
  const repoCount = config.repositories.length;
  const combined = actions.propose(combinedInput, source, context());
  check('combined proposal preserves zero repository and task effects until confirmation', config.repositories.length === repoCount && !config.runs.length && launches === 0);
  check('combined preview names the chosen worker and bypass permission', combined.startsWork === true && combined.coordinatesProject === true
    && combined.agentName === 'Project worker' && combined.permissionMode === 'bypass');
  const combinedDetail = actions.detail(source.conversationId, combined.id);
  check('first-task prompt stays out of summaries, explicit detail and wire projections',
    !JSON.stringify([combined, combinedDetail, coordinatorActionForWire(combined), coordinatorActionDetailForWire(combinedDetail)]).includes('PRIVATE_FIRST_TASK')
    && !Object.hasOwn(combinedDetail.project!, 'start'));
  check('project start rejects unbounded or caller-controlled dispatch identities',
    !validCoordinatorActionInput({ ...combinedInput, start: { ...firstTask, runId: randomUUID() } })
    && !validCoordinatorActionInput({ ...combinedInput, start: { ...firstTask, prompt: 'x'.repeat(32_001) } })
    && validCoordinatorActionInput({ ...input, start: null }));
  config.agents[0].permissionMode = 'default';
  const combinedCommand = { ...command, actionId: combined.id, commandId: 'create-and-start' };
  check('changed worker prevents combined confirmation before repository creation',
    await rejects(() => actions.command(combinedCommand), /Profil wurde geändert|profile has been changed/i)
    && config.repositories.length === repoCount && launches === 0);
  config.agents[0].permissionMode = 'bypass';
  const [combinedFirst, combinedRepeat] = await Promise.all([actions.command(combinedCommand), actions.command(combinedCommand)]);
  const combinedSummary = actions.list(source.conversationId).find(action => action.id === combined.id)!;
  const combinedRepository = config.repositories.find(repository => repository.id === combinedSummary.projectId)!;
  check('one combined confirmation creates exactly one repository and starts exactly one task', combinedFirst.state === 'applied'
    && combinedRepeat.replayed && config.repositories.length === repoCount + 1 && config.runs.length === 1 && launches === 1);
  check('combined task targets the new repository with the exact private prompt', config.runTasks[0].id === combinedSummary.taskId
    && config.runTasks[0].repositoryId === combinedRepository.id && config.runTasks[0].prompt === firstTask.prompt);
  check('combined context is committed before the first task and project is coordinated',
    (await projectGit(combinedRepository.rootPath, ['show', 'HEAD:PROJECT.md'])) === input.context
    && supervision.query().projects.find(project => project.repositoryId === combinedRepository.id)?.mode === 'coordinate');
  actions = makeActions();
  check('combined completion replays after reload without another creation or launch', (await actions.command(combinedCommand)).replayed
    && config.repositories.length === repoCount + 1 && config.runs.length === 1 && launches === 1);

  // Persist each interruption as its own real ledger revision, then reopen it;
  // an in-memory store with a stale fingerprint must never overwrite the fixture.
  for (const withChild of [false, true]) {
    const interruptedInput = { ...combinedInput, name: withChild ? 'Interrupted After Child' : 'Interrupted After Repository' };
    const interrupted = actions.propose(interruptedInput, source, context());
    const repositoryId = await projects.create({ ...actions.detail(source.conversationId, interrupted.id).project!, start: firstTask }, authorize, () => undefined);
    const recoveryStore = new CoordinatorActionStore(storePath); const recovery = recoveryStore.snapshot();
    const interruptedRecord = recovery.actions.find(action => action.id === interrupted.id)!;
    interruptedRecord.repositoryId = repositoryId; interruptedRecord.state = 'dispatching';
    if (withChild) interruptedRecord.handoffCommand = { operation: 'project', repositoryId, mode: 'coordinate',
      objective: interruptedInput.context, commandId: interruptedRecord.commandId, revision: supervision.query().revision };
    recovery.revision++; recoveryStore.save(recovery);
    const child = withChild ? orchestration.createSingleTaskRun({ repositoryId, agentId: firstTask.agentId,
      prompt: firstTask.prompt, allowQuestions: true, commandId: interruptedRecord.commandId }) : null;
    const beforeRecovery = { repositories: config.repositories.length, tasks: config.runTasks.length, launches };
    actions = makeActions();
    const recovered = actions.list(source.conversationId).find(action => action.id === interrupted.id)!;
    check(withChild ? 'child without coordination stays visible and uncertain after restart' : 'repository without child stays uncertain after restart',
      recovered.state === 'uncertain' && recovered.projectId === repositoryId
      && (withChild ? recovered.runId === child!.run.id && recovered.taskId === child!.task.id : recovered.runId === null));
    check(withChild ? 'child without coordination cannot be submitted again' : 'partial project cannot be recreated or start work on retry',
      await rejects(() => actions.command({ ...command, actionId: interrupted.id, commandId: `retry-${interrupted.id}` }), /unbestätigt|unconfirmed/i)
      && config.repositories.length === beforeRecovery.repositories && config.runTasks.length === beforeRecovery.tasks && launches === beforeRecovery.launches);
  }
  const finalProject = actions.propose({ ...combinedInput, name: 'Positive After Recovery' }, source, context());
  check('new explicit combined action succeeds after crash and worker negative controls',
    (await actions.command({ ...command, actionId: finalProject.id, commandId: 'positive-after-recovery' })).state === 'applied' && launches === 2);
  const historyStore = new ConversationStore(join(root, 'conversations.json'));
  const historyState = historyStore.snapshot(); const historyId = randomUUID();
  const original = '# Knuckles Pi\n' + 'Musik 😀 '.repeat(1500);
  historyState.conversations.push({ id: historyId, binding, closed: true, createdAt: 1, updatedAt: 3, nativeThreadId: 'old-thread', model: 'fixture', reasoningEffort: 'high',
    turns: [{ id: randomUUID(), input: original, output: 'Use JUCE and Lua.', status: 'completed', error: '', createdAt: 1, updatedAt: 3, questions: [], nativeTurnId: 'old-turn' }] });
  historyState.conversations.push({ ...structuredClone(historyState.conversations[0]), id: randomUUID(), nativeThreadId: 'casual-thread', binding: { ...binding, toolContract: 'ade-casual-chat-v1' }, turns: [] });
  historyState.revision++; historyStore.save(historyState);
  const history = new ConversationService(historyStore, { binding: () => ({ ...binding, authoritySha256: conversationDigest('new') }), launch: () => { throw new Error('no launch'); } });
  const tools = conversationHistoryTools(history, authorize);
  const find = tools.find(t => t.name === 'ade_conversations')!, read = tools.find(t => t.name === 'ade_conversation_context')!;
  const matches = JSON.parse(await find.invoke({ query: 'Knuckles', offset: 0 }, context()));
  check('history search finds earlier stale project context', matches.conversations.length === 1 && matches.conversations[0].id === historyId);
  check('casual chats are excluded from project history', JSON.parse(await find.invoke({ query: '', offset: 0 }, context())).conversations.length === 1);
  let offset: number | null = 0; let full = '';
  while (offset !== null) { const page = JSON.parse(await read.invoke({ conversationId: historyId, offset }, context())); full += page.text; offset = page.nextOffset; }
  check('pagination restores the full Unicode conversation without truncation', JSON.parse(full).turns[0].input === original);
  allowed = false;
  check('revoked read authority blocks saved conversation access', await rejects(() => read.invoke({ conversationId: historyId, offset: 0 }, context()), /revoked/));
  history.dispose();
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected fixture root');
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  console.log(`Conversation projects: ${passed} passed, ${process.exitCode ? 1 : 0} failed`);
});
