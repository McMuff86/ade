import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_CONFIG,
  type AdeConfig,
  type Agent,
  type RunCreateInput,
  type SessionMeta,
  type StructuredTaskResult,
} from '../src/shared/types';
import { OrchestrationService } from '../src/main/orchestration/OrchestrationService';
import { RunCoordinator } from '../src/main/orchestration/RunCoordinator';
import {
  ClaudeStreamJsonAdapter,
  CodexJsonAdapter,
  RuntimeAdapterRegistry,
  validateStructuredResult,
} from '../src/main/orchestration/runtimeAdapters';
import { ClaudeActivityParser, parseClaudeUsage } from '../src/main/orchestration/claudeStream';
import { WorkspaceService, type WorkspacePort } from '../src/main/orchestration/WorkspaceService';

let passed = 0;
let failed = 0;

function check(label: string, condition: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}`);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class MemoryStore {
  config: AdeConfig;

  constructor(config: AdeConfig) {
    this.config = structuredClone(config);
  }

  get(): AdeConfig {
    return this.config;
  }

  save(partial: Partial<AdeConfig>): AdeConfig {
    this.config = { ...this.config, ...structuredClone(partial) };
    return this.config;
  }
}

class FakeWorkspaces implements WorkspacePort {
  integrations = 0;

  async inspect(workspaceDir: string) {
    return {
      workspaceDir,
      isRepo: false,
      clean: true,
      branch: '',
      headSha: '',
      commonGitDir: '',
    };
  }

  async validateCommit(_workspaceDir: string, _baseSha: string, commitSha: string): Promise<string[]> {
    return [commitSha];
  }

  async commitChanges(
    _workspaceDir: string,
    _expectedHeadSha: string,
    _reportedFiles: string[],
    _message: string,
  ): Promise<string | null> {
    return null;
  }

  async integrateCommits(_workspaceDir: string, commits: string[]): Promise<number> {
    this.integrations += 1;
    return commits.length;
  }
}

function agent(id: string, root: string): Agent {
  return {
    id,
    categoryId: 'cat',
    name: id,
    runtime: 'custom',
    permissionMode: 'default',
    customCommand: 'fixture-agent',
    workspaceDir: join(root, 'workspaces', id),
    memoryDir: join(root, 'memory', id),
  };
}

function configWithAgents(root: string): AdeConfig {
  const agents = [agent('orchestrator', root), agent('lead', root), agent('worker', root)];
  for (const item of agents) {
    mkdirSync(item.workspaceDir, { recursive: true });
    mkdirSync(item.memoryDir, { recursive: true });
  }
  return {
    ...structuredClone(DEFAULT_CONFIG),
    categories: [{ id: 'cat', name: 'Team', agents: agents.map((item) => item.id) }],
    agents,
  };
}

const runInput = (name: string, budget?: RunCreateInput['budget']): RunCreateInput => ({
  name,
  goal: 'Implement two independent changes, integrate them, and verify the final repository.',
  budget: { maxConcurrentTasks: 1, maxApprovals: 1, ...budget },
  participants: [
    { agentId: 'orchestrator', role: 'orchestrator' },
    { agentId: 'lead', role: 'lead', teamId: 'team', teamName: 'Team' },
    { agentId: 'worker', role: 'worker', teamId: 'team', teamName: 'Team' },
  ],
});

function result(overrides: Partial<StructuredTaskResult> = {}): StructuredTaskResult {
  return {
    version: 1,
    outcome: 'succeeded',
    summary: 'Completed truthfully.',
    assignments: [],
    filesChanged: [],
    tests: [],
    commitSha: null,
    risks: [],
    usage: { inputTokens: 2, outputTokens: 1, costUsd: 0.01 },
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean, label: string, timeout = 4_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function managedLifecycleChecks(root: string): Promise<void> {
  console.log('\n== managed orchestration lifecycle ==');
  const store = new MemoryStore(configWithAgents(root));
  const service = new OrchestrationService(store);
  const workspaces = new FakeWorkspaces();
  const coordinator = new RunCoordinator(store, service, new RuntimeAdapterRegistry(), workspaces);
  const launched: string[] = [];
  coordinator.connect(async (agentId, _prompt, _dispatchId, taskId) => {
    launched.push(taskId);
    const session: SessionMeta = {
      id: `session-${launched.length}`,
      agentId,
      title: 'fixture',
      kind: 'task',
      status: 'running',
      createdAt: Date.now(),
      runTaskId: taskId,
    };
    coordinator.onTaskStarted(taskId, session);
    return session;
  }, () => undefined);

  const run = service.createRun(runInput('Managed lifecycle'));
  await coordinator.start(run.id);
  let snapshot = service.snapshot();
  check('run starts in planning phase', snapshot.runs[0]?.phase === 'planning');
  check('planner is the only first launch', launched.length === 1 && snapshot.tasks[0]?.phase === 'plan');
  check('workspaces are exclusively leased', snapshot.workspaceLeases.filter((lease) => lease.status === 'active').length === 3);
  check('planner receives a persisted file mailbox message', snapshot.messages.some((message) => message.kind === 'plan'));

  const planTask = snapshot.tasks.find((task) => task.phase === 'plan')!;
  const participants = snapshot.participants.filter((item) => item.runId === run.id);
  const lead = participants.find((item) => item.agentId === 'lead')!;
  const worker = participants.find((item) => item.agentId === 'worker')!;
  finish(coordinator, planTask.id, result({
    assignments: [
      {
        participantId: lead.id,
        title: 'Lead-owned change',
        prompt: 'Implement lead-specific behavior.',
        acceptanceCriteria: ['Lead behavior is tested'],
        dependsOn: [],
      },
      {
        participantId: worker.id,
        title: 'Worker-owned change',
        prompt: 'Implement worker-specific behavior.',
        acceptanceCriteria: ['Worker behavior is tested'],
        dependsOn: [],
      },
    ],
  }));
  await waitFor(() => service.snapshot().runs[0]?.phase === 'working', 'working phase');
  snapshot = service.snapshot();
  const workTasks = snapshot.tasks.filter((task) => task.phase === 'work');
  check('planner creates two worker-specific tasks', workTasks.length === 2 && workTasks[0]?.prompt !== workTasks[1]?.prompt);
  check('per-run concurrency launches only one worker', launched.length === 2);
  check('assignments are mirrored to recipient mailboxes', snapshot.messages.filter((message) => message.kind === 'assignment').length === 2);

  finish(coordinator, launched[1]!, result({ summary: 'First worker done.' }));
  await waitFor(() => launched.length === 3, 'second worker launch');
  check('next worker launches after the first releases its run slot', launched.length === 3);
  finish(coordinator, launched[2]!, result({ summary: 'Second worker done.' }));
  await waitFor(() => service.snapshot().runs[0]?.phase === 'approval', 'approval phase');
  snapshot = service.snapshot();
  const approval = snapshot.approvals.find((item) => item.status === 'pending');
  check('integration is blocked on a persisted approval', Boolean(approval) && launched.length === 3);
  check('worker reports route back to the orchestrator mailbox', snapshot.messages.filter((message) => message.kind === 'result').length === 2);
  check('restart recovery preserves an idle durable approval gate',
    service.recoverInterruptedTasks() === 0 &&
    service.snapshot().runs[0]?.phase === 'approval' &&
    service.snapshot().workspaceLeases.every((lease) => lease.status === 'active'));

  await coordinator.resolveApproval(approval!.id, 'approve');
  await waitFor(() => service.snapshot().tasks.some((task) => task.phase === 'integrate' && task.status === 'running'), 'integration task');
  snapshot = service.snapshot();
  const integrationTask = snapshot.tasks.find((task) => task.phase === 'integrate')!;
  check('approved run enters integration phase', snapshot.runs[0]?.phase === 'integrating');
  check('plain-workspace integration is explicit report reconciliation', workspaces.integrations === 0 && integrationTask.prompt.includes('plain-workspace'));

  finish(coordinator, integrationTask.id, result({
    summary: 'Integrated result is coherent.',
    tests: [{ command: 'pnpm test', status: 'passed', output: 'ok' }],
  }));
  await waitFor(() => service.snapshot().tasks.some((task) => task.phase === 'verify' && task.status === 'running'), 'verification task');
  snapshot = service.snapshot();
  const verificationTask = snapshot.tasks.find((task) => task.phase === 'verify')!;
  check('integration completion launches a distinct read-only verification task', verificationTask.prompt.includes('strictly read-only'));

  finish(coordinator, verificationTask.id, result({
    summary: 'All final checks pass.',
    tests: [
      { command: 'pnpm typecheck', status: 'passed', output: 'ok' },
      { command: 'pnpm test', status: 'passed', output: 'ok' },
    ],
  }));
  await waitFor(() => service.snapshot().runs[0]?.status === 'completed', 'run completion');
  snapshot = service.snapshot();
  check('verified run completes', snapshot.runs[0]?.phase === 'completed');
  check('every managed task has one structured result', snapshot.results.length === snapshot.tasks.length);
  check('all workspace leases release only after the run drains', snapshot.workspaceLeases.every((lease) => lease.status === 'released'));
  check('mailbox fallback wrote inspectable inbox and outbox JSONL', store.get().agents.every((item) => {
    const dir = join(item.memoryDir, 'mailbox', run.id);
    return existsSync(join(dir, 'INBOX.jsonl')) || existsSync(join(dir, 'OUTBOX.jsonl'));
  }));
  check('usage aggregates across structured task results', snapshot.usageByRun[run.id]?.inputTokens === snapshot.results.length * 2);
}

async function ownershipAndBudgetChecks(root: string): Promise<void> {
  console.log('\n== lease and budget enforcement ==');
  const store = new MemoryStore(configWithAgents(root));
  const service = new OrchestrationService(store);
  const coordinator = new RunCoordinator(store, service, new RuntimeAdapterRegistry(), new FakeWorkspaces());
  coordinator.connect(async (agentId, _prompt, _dispatchId, taskId) => {
    const session: SessionMeta = {
      id: `s-${taskId}`,
      agentId,
      title: 'fixture',
      kind: 'task',
      status: 'running',
      createdAt: Date.now(),
      runTaskId: taskId,
    };
    coordinator.onTaskStarted(taskId, session);
    return session;
  }, () => undefined);

  const first = service.createRun(runInput('Lease owner'));
  const second = service.createRun(runInput('Lease contender'));
  await coordinator.start(first.id);
  let conflict = '';
  try {
    await coordinator.start(second.id);
  } catch (error) {
    conflict = errorText(error);
  }
  check('a second run cannot acquire an active run worktree', conflict.includes('already owned'));

  const budgetStore = new MemoryStore(configWithAgents(join(root, 'budget')));
  const budgetService = new OrchestrationService(budgetStore);
  const budgetCoordinator = new RunCoordinator(
    budgetStore,
    budgetService,
    new RuntimeAdapterRegistry(),
    new FakeWorkspaces(),
  );
  let taskId = '';
  budgetCoordinator.connect(async (agentId, _prompt, _dispatchId, id) => {
    taskId = id;
    const session: SessionMeta = {
      id: 'budget-session', agentId, title: 'fixture', kind: 'task', status: 'running',
      createdAt: Date.now(), runTaskId: id,
    };
    budgetCoordinator.onTaskStarted(id, session);
    return session;
  }, () => undefined);
  const budgetRun = budgetService.createRun(runInput('Budget', {
    maxConcurrentTasks: 1,
    maxInputTokens: 5,
    maxOutputTokens: 5,
    maxCostUsd: 1,
    maxApprovals: 1,
  }));
  await budgetCoordinator.start(budgetRun.id);
  finish(budgetCoordinator, taskId, result({
    outcome: 'blocked',
    summary: 'The operation was blocked after usage exceeded the run budget.',
    usage: { inputTokens: 6, outputTokens: 1, costUsd: 0.1 },
    assignments: [{
      participantId: budgetService.snapshot().participants.find((item) => item.agentId === 'lead')!.id,
      title: 'Would run', prompt: 'No-op', acceptanceCriteria: ['No-op'], dependsOn: [],
    }],
  }));
  await waitFor(() => budgetService.snapshot().runs.find((item) => item.id === budgetRun.id)?.status === 'failed', 'budget failure');
  const budgetSnapshot = budgetService.snapshot();
  check('token overrun fails closed before worker scheduling', budgetSnapshot.tasks.filter((task) => task.phase === 'work').length === 0);
  check('budget exhaustion is journaled even when the task reports blocked',
    budgetSnapshot.events.some((event) => event.type === 'budget.exhausted'));

  const cancelStore = new MemoryStore(configWithAgents(join(root, 'cancel')));
  const cancelService = new OrchestrationService(cancelStore);
  const cancelCoordinator = new RunCoordinator(
    cancelStore,
    cancelService,
    new RuntimeAdapterRegistry(),
    new FakeWorkspaces(),
  );
  cancelCoordinator.connect(
    () => new Promise<SessionMeta>(() => undefined),
    (ids) => ids.forEach((id) => cancelCoordinator.onTaskLaunchFailed(id, true, 'cancelled in FIFO')),
  );
  const cancelRun = cancelService.createRun(runInput('Pending cancellation'));
  await cancelCoordinator.start(cancelRun.id);
  await Promise.race([
    cancelCoordinator.cancel(cancelRun.id),
    new Promise((_, reject) => setTimeout(() => reject(new Error('cancel timed out')), 1_000)),
  ]);
  await waitFor(() => cancelService.snapshot().workspaceLeases.every((lease) => lease.status === 'released'), 'cancel lease release');
  check('a run remains cancellable while its PTY is waiting in the global FIFO',
    cancelService.snapshot().runs.find((item) => item.id === cancelRun.id)?.status === 'cancelled');
}

function adapterChecks(root: string): void {
  console.log('\n== runtime adapters and schema ==');
  const adapter = new CodexJsonAdapter();
  const codex: Agent = {
    ...agent('codex', root),
    runtime: 'codex',
    customCommand: undefined,
  };
  const task = {
    id: 'task', runId: 'run', participantId: 'participant', prompt: 'Do work', title: 'Work',
    phase: 'work' as const, managed: true, dependsOn: [], attempt: 1, status: 'queued' as const,
    createdAt: 1, updatedAt: 1,
  };
  const dir = join(root, 'adapter');
  const files = {
    taskDir: dir,
    resultPath: join(dir, 'RESULT.json'),
    schemaPath: join(dir, 'RESULT.schema.json'),
    inboxPath: join(dir, 'INBOX.jsonl'),
    outboxPath: join(dir, 'OUTBOX.jsonl'),
  };
  const launch = adapter.prepare(codex, task, task.prompt, files, 'win32');
  check('Codex adapter uses native JSONL and output-schema flags',
    Boolean(launch.command?.startsWith('codex exec ') && !launch.command.includes('exec exec') &&
      launch.command.includes('--json') && launch.command.includes('--output-schema') &&
      launch.command.includes('--output-last-message')));
  writeFileSync(files.resultPath, JSON.stringify(result({
    usage: { inputTokens: null, outputTokens: null, costUsd: 999 },
  })), 'utf8');
  const parsed = adapter.readResult(
    launch,
    '{"type":"turn.completed","usage":{"input_tokens":17,"cached_input_tokens":2,"output_tokens":5,"reasoning_output_tokens":1}}\r\n',
  );
  check('Codex JSONL token telemetry overrides model-authored usage', parsed.usage.inputTokens === 17 && parsed.usage.outputTokens === 5);
  check('Codex cost remains explicitly unknown', parsed.usage.costUsd === null);
  check('result schema is materialized next to the task output', existsSync(files.schemaPath));
  writeFileSync(files.resultPath, JSON.stringify(result()), 'utf8');
  const wrapped = adapter.readResult(
    launch,
    '\u001b[?25l{"type":"turn.completed","usage":\r\n{"input_tokens":23,"cached_input_tokens":0,\r\n"output_tokens":7,"reasoning_output_tokens":0}}\u001b[0m',
  );
  check('Codex usage survives ConPTY wrapping and ANSI control sequences',
    wrapped.usage.inputTokens === 23 && wrapped.usage.outputTokens === 7);

  // --- Claude stream-json adapter: live activity + trusted telemetry -------
  const claudeAdapter = new ClaudeStreamJsonAdapter();
  const claudeAgent: Agent = { ...agent('claude', root), runtime: 'claude', customCommand: undefined };
  const claudeDir = join(root, 'claude-adapter');
  const claudeFiles = {
    taskDir: claudeDir,
    resultPath: join(claudeDir, 'RESULT.json'),
    schemaPath: join(claudeDir, 'RESULT.schema.json'),
    inboxPath: join(claudeDir, 'INBOX.jsonl'),
    outboxPath: join(claudeDir, 'OUTBOX.jsonl'),
  };
  const claudeLaunch = claudeAdapter.prepare(claudeAgent, task, task.prompt, claudeFiles, 'win32');
  check('registry prefers the native claude adapter over the file fallback',
    new RuntimeAdapterRegistry().capabilities(claudeAgent).adapterId === 'claude-stream-json-v1');
  check('Claude task streams JSON events and pipes the prompt over stdin',
    Boolean(claudeLaunch.command?.includes('--output-format stream-json')
      && claudeLaunch.command?.includes('$env:ADE_TASK_PROMPT |')
      && claudeLaunch.transport === 'stdin'));
  check('Claude task declares its activity stream to the PTY layer',
    claudeLaunch.activityFormat === 'claude-stream-json');
  check('Claude adapter advertises token and cost telemetry',
    claudeLaunch.reportsTokens && claudeLaunch.reportsCost);

  // A real transcript shape: init, tool use, final text, result with usage.
  const claudeStream = [
    '{"type":"system","subtype":"init","model":"claude-fable-5"}',
    '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"Ich prüfe die Tests."}]}}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"pnpm test"}}]}}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"Fertig."}]}}',
    '{"type":"result","subtype":"success","is_error":false,"num_turns":2,"total_cost_usd":0.25,'
      + '"usage":{"input_tokens":10,"cache_creation_input_tokens":100,"cache_read_input_tokens":1000,"output_tokens":42}}',
  ].join('\n');
  writeFileSync(claudeFiles.resultPath, JSON.stringify(result({
    usage: { inputTokens: 1, outputTokens: 1, costUsd: 999 },
  })), 'utf8');
  const claudeParsed = claudeAdapter.readResult(claudeLaunch, claudeStream);
  check('Claude telemetry sums fresh + cache-write + cache-read input tokens',
    claudeParsed.usage.inputTokens === 1110 && claudeParsed.usage.outputTokens === 42);
  check('Claude reports real billed cost and overrides model-authored usage',
    claudeParsed.usage.costUsd === 0.25);

  // ConPTY hard-wraps long events and injects control sequences.
  const claudeWrapped = `[?25l${(claudeStream.match(/.{1,40}/gs) ?? []).join('\r\n')}[0m`;
  writeFileSync(claudeFiles.resultPath, JSON.stringify(result()), 'utf8');
  const claudeWrappedParsed = claudeAdapter.readResult(claudeLaunch, claudeWrapped);
  check('Claude usage survives ConPTY wrapping and ANSI control sequences',
    claudeWrappedParsed.usage.inputTokens === 1110
      && claudeWrappedParsed.usage.outputTokens === 42
      && claudeWrappedParsed.usage.costUsd === 0.25);

  writeFileSync(claudeFiles.resultPath, JSON.stringify(result({
    usage: { inputTokens: 5, outputTokens: 5, costUsd: 5 },
  })), 'utf8');
  const noTelemetry = claudeAdapter.readResult(claudeLaunch, 'no events here');
  check('a missing result event fails closed to unknown usage, never zero',
    noTelemetry.usage.inputTokens === null
      && noTelemetry.usage.outputTokens === null
      && noTelemetry.usage.costUsd === null);
  check('usage is unknown, not invented, when the stream carries no result',
    parseClaudeUsage('{"type":"assistant","message":{"content":[]}}') === null);

  // Live rendering: chunk boundaries must not lose or duplicate a line.
  const feed = new ClaudeActivityParser();
  const rendered: string[] = [];
  for (let index = 0; index < claudeStream.length; index += 13) {
    for (const line of feed.push(claudeStream.slice(index, index + 13))) {
      rendered.push(`${line.kind}:${line.text}`);
    }
  }
  check('activity survives arbitrary chunk splits (5 lines, in order)',
    rendered.length === 5
      && rendered[0].startsWith('init:')
      && rendered[1] === 'thinking:Ich prüfe die Tests.'
      && rendered[2] === 'tool:Bash: pnpm test'
      && rendered[3] === 'text:Fertig.'
      && rendered[4].startsWith('result:'));
  check('the result line reports turns, tokens and cost',
    rendered[4].includes('2 Turns') && rendered[4].includes('1110 in / 42 out') && rendered[4].includes('$0.2500'));
  const wrappedFeed = new ClaudeActivityParser();
  check('activity survives ConPTY wrapping too',
    wrappedFeed.push(claudeWrapped).length === 5);
  const noisyFeed = new ClaudeActivityParser();
  check('non-JSON terminal noise never produces activity lines',
    noisyFeed.push('warning: something\r\nplain log line\r\n').length === 0);

  // The 256 KiB PTY ring buffer keeps only the tail of a long task, so the
  // transcript handed to readResult routinely starts mid-event — often inside
  // a JSON string. A parser that tracks quotes outside an object swallows the
  // rest of the stream and loses the telemetry entirely (observed on Goal 6
  // run 37d41c5d: adapter active, usage null).
  const truncated = `x_file":"src/game/Weapon.ts","content":"export const A = {\n${claudeStream}`;
  check('telemetry survives a ring-buffer head cut inside a JSON string',
    JSON.stringify(parseClaudeUsage(truncated))
      === JSON.stringify({ inputTokens: 1110, outputTokens: 42, costUsd: 0.25 }));
  const truncatedFeed = new ClaudeActivityParser();
  check('activity recovers from a truncated head instead of stalling',
    truncatedFeed.push(truncated).length === 5);

  let rejected = false;
  try {
    validateStructuredResult({ version: 1, outcome: 'succeeded' });
  } catch {
    rejected = true;
  }
  check('malformed structured results are rejected', rejected);
  let contradictory = false;
  try {
    validateStructuredResult(result({
      tests: [{ command: 'fixture', status: 'failed', output: 'boom' }],
    }));
  } catch {
    contradictory = true;
  }
  check('success claims with failed test evidence are rejected', contradictory);
}

async function realGitIntegrationChecks(root: string): Promise<void> {
  console.log('\n== real temporary-worktree integration ==');
  const repo = join(root, 'git-repo');
  const worker = join(root, 'git-worker');
  mkdirSync(repo, { recursive: true });
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'ade-test@example.invalid']);
  git(repo, ['config', 'user.name', 'ADE test']);
  writeFileSync(join(repo, 'base.txt'), 'base\n', 'utf8');
  git(repo, ['add', 'base.txt']);
  git(repo, ['commit', '-m', 'base']);
  const baseSha = git(repo, ['rev-parse', 'HEAD']).trim();
  git(repo, ['worktree', 'add', '-b', 'worker-branch', worker, 'HEAD']);
  git(worker, ['config', 'user.email', 'ade-test@example.invalid']);
  git(worker, ['config', 'user.name', 'ADE test']);
  writeFileSync(join(worker, 'worker.txt'), 'worker change\n', 'utf8');
  git(worker, ['add', 'worker.txt']);
  git(worker, ['commit', '-m', 'worker change one']);
  writeFileSync(join(worker, 'worker-two.txt'), 'second worker change\n', 'utf8');
  git(worker, ['add', 'worker-two.txt']);
  git(worker, ['commit', '-m', 'worker change two']);
  const commitSha = git(worker, ['rev-parse', 'HEAD']).trim();

  const workspace = new WorkspaceService();
  const inspection = await workspace.inspect(worker);
  const commits = await workspace.validateCommit(worker, baseSha, commitSha);
  const applied = await workspace.integrateCommits(repo, commits);
  check('temporary worker commit validates against the leased base', commitSha.length >= 7);
  check('linked worktree inspection resolves an existing shared Git metadata directory',
    inspection.isRepo && inspection.commonGitDir.length > 0 && existsSync(inspection.commonGitDir));
  check('the full worker commit range is cherry-picked in order', commits.length === 2 && applied === 2);
  check('integrated file exists in the target worktree',
    readFileSync(join(repo, 'worker.txt'), 'utf8').replace(/\r\n/g, '\n') === 'worker change\n');
  check('later commits in the reported range are integrated too',
    readFileSync(join(repo, 'worker-two.txt'), 'utf8').replace(/\r\n/g, '\n') === 'second worker change\n');
  check('integration worktree remains clean', git(repo, ['status', '--porcelain']).trim() === '');

  const managedRepo = join(root, 'managed-commit-repo');
  const managedWorker = join(root, 'managed-commit-worker');
  mkdirSync(managedRepo, { recursive: true });
  git(managedRepo, ['init', '--initial-branch=main']);
  git(managedRepo, ['config', 'user.email', 'ade-test@example.invalid']);
  git(managedRepo, ['config', 'user.name', 'ADE test']);
  writeFileSync(join(managedRepo, 'baseline.txt'), 'baseline\n', 'utf8');
  git(managedRepo, ['add', 'baseline.txt']);
  git(managedRepo, ['commit', '-m', 'managed baseline']);
  const managedBase = git(managedRepo, ['rev-parse', 'HEAD']).trim();
  git(managedRepo, ['worktree', 'add', '-b', 'managed-worker-branch', managedWorker, 'HEAD']);
  writeFileSync(join(managedWorker, 'managed.txt'), 'managed task output\n', 'utf8');
  writeFileSync(join(managedWorker, 'unreported.txt'), 'must not be committed\n', 'utf8');
  let mismatch = '';
  try {
    await workspace.commitChanges(managedWorker, managedBase, ['managed.txt'], 'ADE work: fixture');
  } catch (error) {
    mismatch = errorText(error);
  }
  check('ADE refuses to commit when the runtime omits a changed path',
    mismatch.includes('reported files do not match') && git(managedWorker, ['rev-parse', 'HEAD']).trim() === managedBase);
  rmSync(join(managedWorker, 'unreported.txt'), { force: true });
  const managedCommit = await workspace.commitChanges(
    managedWorker,
    managedBase,
    ['managed.txt'],
    'ADE work: fixture',
  );
  check('ADE creates the descendant commit instead of granting runtime Git-metadata writes',
    Boolean(managedCommit) && git(managedWorker, ['rev-parse', 'HEAD']).trim() === managedCommit);
  check('ADE-managed commit contains exactly the reported file and leaves a clean worktree',
    git(managedWorker, ['show', '--format=', '--name-only', managedCommit!]).trim() === 'managed.txt' &&
      git(managedWorker, ['status', '--porcelain']).trim() === '');

  const conflictRepo = join(root, 'conflict-repo');
  const conflictWorker = join(root, 'conflict-worker');
  mkdirSync(conflictRepo, { recursive: true });
  git(conflictRepo, ['init']);
  git(conflictRepo, ['config', 'user.email', 'ade-test@example.invalid']);
  git(conflictRepo, ['config', 'user.name', 'ADE test']);
  writeFileSync(join(conflictRepo, 'shared.txt'), 'base\n', 'utf8');
  git(conflictRepo, ['add', 'shared.txt']);
  git(conflictRepo, ['commit', '-m', 'conflict base']);
  const conflictBase = git(conflictRepo, ['rev-parse', 'HEAD']).trim();
  git(conflictRepo, ['worktree', 'add', '-b', 'conflict-worker-branch', conflictWorker, 'HEAD']);
  git(conflictWorker, ['config', 'user.email', 'ade-test@example.invalid']);
  git(conflictWorker, ['config', 'user.name', 'ADE test']);
  writeFileSync(join(conflictWorker, 'first.txt'), 'first commit\n', 'utf8');
  git(conflictWorker, ['add', 'first.txt']);
  git(conflictWorker, ['commit', '-m', 'clean first commit']);
  writeFileSync(join(conflictWorker, 'shared.txt'), 'worker version\n', 'utf8');
  git(conflictWorker, ['add', 'shared.txt']);
  git(conflictWorker, ['commit', '-m', 'conflicting second commit']);
  const conflictTip = git(conflictWorker, ['rev-parse', 'HEAD']).trim();
  const conflictCommits = await workspace.validateCommit(conflictWorker, conflictBase, conflictTip);
  writeFileSync(join(conflictRepo, 'shared.txt'), 'target version\n', 'utf8');
  git(conflictRepo, ['add', 'shared.txt']);
  git(conflictRepo, ['commit', '-m', 'target diverges']);
  const targetHead = git(conflictRepo, ['rev-parse', 'HEAD']).trim();
  let conflictFailed = false;
  try {
    await workspace.integrateCommits(conflictRepo, conflictCommits);
  } catch {
    conflictFailed = true;
  }
  check('a later cherry-pick conflict fails the integration transaction', conflictFailed);
  check('failed multi-commit integration rolls back every earlier commit',
    git(conflictRepo, ['rev-parse', 'HEAD']).trim() === targetHead &&
    !existsSync(join(conflictRepo, 'first.txt')) &&
    git(conflictRepo, ['status', '--porcelain']).trim() === '');
}

async function pauseSchedulingChecks(root: string): Promise<void> {
  console.log('\n== main-owned team pause ==');
  const store = new MemoryStore(configWithAgents(root));
  const service = new OrchestrationService(store);
  const coordinator = new RunCoordinator(store, service, new RuntimeAdapterRegistry(), new FakeWorkspaces());
  const launched: string[] = [];
  coordinator.connect(async (agentId, _prompt, _dispatchId, taskId) => {
    launched.push(taskId);
    const session: SessionMeta = {
      id: `pause-session-${launched.length}`,
      agentId,
      title: 'fixture',
      kind: 'task',
      status: 'running',
      createdAt: Date.now(),
      runTaskId: taskId,
    };
    coordinator.onTaskStarted(taskId, session);
    return session;
  }, () => undefined);

  const run = service.createRun(runInput('Paused delivery'));
  await coordinator.start(run.id);
  const snapshot = service.snapshot();
  const planTask = snapshot.tasks.find((task) => task.phase === 'plan')!;
  const participants = snapshot.participants.filter((item) => item.runId === run.id);
  const lead = participants.find((item) => item.agentId === 'lead')!;
  const worker = participants.find((item) => item.agentId === 'worker')!;
  finish(coordinator, planTask.id, result({
    assignments: [
      {
        participantId: lead.id,
        title: 'Lead-owned change',
        prompt: 'Implement lead-specific behavior.',
        acceptanceCriteria: ['Lead behavior is tested'],
        dependsOn: [],
      },
      {
        participantId: worker.id,
        title: 'Worker-owned change',
        prompt: 'Implement worker-specific behavior.',
        acceptanceCriteria: ['Worker behavior is tested'],
        dependsOn: [],
      },
    ],
  }));
  await waitFor(() => launched.length === 2, 'first paused-run worker launch');

  await coordinator.pauseTeam(run.id, 'team', 'pause-command-1');
  check('team pause is persisted on the run and journaled',
    service.snapshot().runs[0]?.pausedTeamIds?.includes('team') === true &&
    service.snapshot().events.some((event) => event.type === 'team.paused'));

  finish(coordinator, launched[1]!, result({ summary: 'First worker done.' }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  check('a paused team schedules no further queued work', launched.length === 2);
  check('a paused hold is a wait state, not a scheduling failure',
    service.snapshot().runs[0]?.status === 'running' &&
    service.snapshot().runs[0]?.phase === 'working');

  const replayed = await coordinator.pauseTeam(run.id, 'team', 'pause-command-1');
  check('a replayed pause command returns the recorded outcome without a new event',
    replayed.pausedTeamIds?.includes('team') === true &&
    service.snapshot().events.filter((event) => event.type === 'team.paused').length === 1);

  await coordinator.resumeTeam(run.id, 'team');
  await waitFor(() => launched.length === 3, 'resumed worker launch');
  check('resume immediately reschedules the held queued task',
    service.snapshot().events.some((event) => event.type === 'team.resumed'));
  finish(coordinator, launched[2]!, result({ summary: 'Second worker done.' }));
  await waitFor(() => service.snapshot().runs[0]?.phase === 'approval', 'approval after resume');
  check('the resumed run reaches its integration approval gate',
    service.snapshot().approvals.some((approval) => approval.status === 'pending'));
}

function finish(coordinator: RunCoordinator, taskId: string, value: StructuredTaskResult): void {
  const launch = coordinator.getTaskLaunch(taskId);
  if (!launch) throw new Error(`missing launch for ${taskId}`);
  writeFileSync(launch.files.resultPath, `${JSON.stringify(value)}\n`, 'utf8');
  coordinator.onTaskFinished(taskId, 'completed', 0, '');
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'ade-goal4-'));
  try {
    adapterChecks(root);
    await managedLifecycleChecks(join(root, 'lifecycle'));
    await ownershipAndBudgetChecks(join(root, 'ownership'));
    await pauseSchedulingChecks(join(root, 'pause'));
    await realGitIntegrationChecks(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  console.log(`\n${failed ? 'FAILED' : 'PASSED'} - ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
