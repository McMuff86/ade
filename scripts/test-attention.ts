import { attentionOverview } from '../src/main/overview/attentionOverview';
import { DEFAULT_CONFIG, type RunSummary, type SessionMeta } from '../src/shared/types';
import { ATTENTION_LIMIT } from '../src/shared/attention';
import type { MorningBriefing } from '../src/shared/supervision';

let passed = 0; let failed = 0;
const check = (label: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
const config = structuredClone(DEFAULT_CONFIG);
config.repositories = ['one', 'two', 'three'].map(id => ({ id, name: `Project ${id}`, rootPath: `/private/${id}`, commonGitDir: `/private/${id}/.git`, executionBackend: 'native', verified: true, createdAt: 1 }));
const run = (id: string, overrides: Partial<RunSummary> = {}): RunSummary => ({
  id, name: id, goal: 'PRIVATE PROMPT', status: 'running', mode: 'managed', phase: 'working',
  repositoryId: 'two', repositoryName: 'Project two', teams: [], participants: [], tasks: [],
  budget: { maxConcurrentTasks: 1, maxInputTokens: null, maxOutputTokens: null, maxCostUsd: null, maxApprovals: 1, maxTaskMinutes: null },
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, approvals: 0, unreportedCostTasks: 1 },
  pendingApprovalId: null, pausedTeamIds: [], createdAt: 1, updatedAt: 3, seqCursor: 0, ...overrides,
});
const session = (id: string, overrides: Partial<SessionMeta> = {}): SessionMeta => ({
  id, title: id, kind: 'interactive', status: 'running', createdAt: 1, repositoryId: 'one', workspaceDir: '/private/one',
  program: { status: 'running', startedAt: 1 }, ...overrides,
});
config.sessionBookends = [{ id: 'lost', projectWorkspaceId: 'old-workspace', agentName: 'Lost CLI', runtime: 'codex',
  repositoryId: 'three', repositoryName: 'Project three', startedAt: 1, endedAt: 5, exitReason: 'interrupted' }];
const waiting = run('waiting', { tasks: [{ id: 'task', title: 'Task', participantId: 'participant', phase: 'work', status: 'running', attempt: 1, managed: true, createdAt: 1, pendingQuestions: 1 }] });
const view = attentionOverview(config, [waiting], [session('active')], undefined, 99);
check('three projects expose waiting, live CLI and recovered interruption together', new Set(view.rows.map(row => row.project)).size === 3
  && view.rows.some(row => row.reason === 'question') && view.rows.some(row => row.reason === 'process-active') && view.rows.some(row => row.reason === 'lost'));
check('questions take precedence over ordinary running work', view.rows[0].group === 'needs-you' && view.rows[0].pendingQuestions === 1);
check('question target identifies the existing run, never an answer payload', view.rows[0].target?.id === 'waiting' && view.rows[0].target.kind === 'run');
check('lost session opens its project rather than a fictional resumable PTY', view.rows.find(row => row.reason === 'lost')?.target?.kind === 'project');
check('no prompt or absolute workspace paths in attention projection', !JSON.stringify(view).includes('PRIVATE PROMPT') && !JSON.stringify(view).includes('/private'));
check('observed time is distinct from last confirmed activity', view.observedAt === 99 && view.rows.find(row => row.kind === 'session')?.activityAt === 1);
const silent = attentionOverview(config, [], [session('silent', { lastOutputAt: 2 })], undefined, 99999999).rows.find(row => row.kind === 'session')!;
check('long terminal silence does not imply completion or a question', silent.group === 'working' && silent.pendingQuestions === 0 && silent.activityAt === 2 && silent.activityKind === 'output');
const state = (value: SessionMeta) => attentionOverview({ ...config, sessionBookends: [] }, [], [value]).rows[0];
check('unknown program remains unknown even with a live PTY', state(session('unknown', { program: { status: 'unknown' } })).group === 'unknown');
check('plain shell is not presented as an agent working', state(session('shell', { program: undefined, launchChoice: { mode: 'shell' } })).group === 'unknown');
check('successful CLI exit is not claimed as a task result', state(session('exit', { status: 'exited', endedAt: 8, exitCode: 0 })).reason === 'ended');
check('abnormal terminal exit is actionable interruption', state(session('error', { status: 'exited', endedAt: 8, exitCode: 2 })).group === 'interrupted');
check('confirmed failed CLI remains an error even when its terminal stays open', state(session('surviving-shell', { program: { status: 'exited', exitCode: 1, endedAt: 8 } })).reason === 'failed');
check('explicit cancellation stays distinct from process loss', state(session('cancel', { status: 'exited', exitReason: 'cancelled' })).reason === 'cancelled');
check('credential-login PTYs are excluded', !state(session('login', { remoteAccessBlocked: true })));
check('managed PTYs do not duplicate run rows', !state(session('managed', { runTaskId: 'task' })));
const runState = (value: RunSummary) => attentionOverview({ ...config, sessionBookends: [] }, [value], []).rows[0];
check('successful managed result is ready for review', runState(run('done', { status: 'completed', phase: 'completed' })).group === 'review');
check('failed run never appears ready for review', runState(run('failed', { status: 'failed', phase: 'failed' })).group === 'interrupted');
check('pending approval needs the operator', runState(run('approval', { phase: 'approval' })).reason === 'approval');
check('draft runs do not pretend to be active work', !runState(run('draft', { status: 'draft', phase: 'draft' })));
check('failed run wins over stale pending question count', runState({ ...waiting, status: 'failed' }).reason === 'failed');
check('live record deduplicates a matching historical bookend', attentionOverview(config, [], [session('lost')]).rows.length === 1);
check('removed project keeps honest interrupted history without a broken link', attentionOverview({ ...config, repositories: [] }, [], []).rows[0].target === null);
const briefing: MorningBriefing = { revision: 1, observedAt: 9, projects: [{ id: 'handoff-project', repositoryId: 'three', name: 'Project three', available: true, mode: 'observe', work: [], suggestion: 'resume-handoff',
  handoffs: [{ id: 'h', status: 'open', createdAt: 1, updatedAt: 7, text: { sha256: 'PRIVATE HASH', chars: 200 }, nextStep: { sha256: 'PRIVATE HASH', chars: 30 } }] }] };
const handoff = attentionOverview(config, [], [], briefing).rows.find(row => row.kind === 'handoff')!;
check('open morning handoff joins needs-you with a project-specific detail target', handoff.group === 'needs-you' && handoff.target?.kind === 'supervision' && handoff.target.id === 'three');
check('handoff contents and hashes do not leak into decision rows', !JSON.stringify(handoff).includes('PRIVATE HASH'));
briefing.projects[0].handoffs[0].status = 'done';
check('completed handoff disappears from outstanding decisions', !attentionOverview(config, [], [], briefing).rows.some(row => row.kind === 'handoff'));
const many = attentionOverview({ ...config, sessionBookends: [] }, Array.from({ length: 120 }, (_, index) => run(String(index))), []);
check('overview is bounded with an explicit omitted count', many.rows.length === ATTENTION_LIMIT && many.omitted === 20);
check('equal timestamps have stable deterministic ordering', JSON.stringify(many) === JSON.stringify(attentionOverview({ ...config, sessionBookends: [] }, Array.from({ length: 120 }, (_, index) => run(String(index))), [], undefined, many.observedAt)));
check('empty state is a successful empty snapshot', attentionOverview({ ...config, sessionBookends: [] }, [], []).rows.length === 0);
console.log(`Attention: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
