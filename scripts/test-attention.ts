import { attentionOverview } from '../src/main/overview/attentionOverview';
import { DEFAULT_CONFIG, type RunSummary, type SessionMeta } from '../src/shared/types';
import { ATTENTION_LIMIT, type AttentionAccess, type AttentionPromptState } from '../src/shared/attention';
import { ATTENTION_DRAFT_LIMIT, AttentionDrafts, deliverInstruction, releaseInstruction, type InstructDraft } from '../src/renderer/attention/attentionDrafts';
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

// Goal 34.4 actions: derived from state, caller grants and the actual prompt transport.
check('without explicit access every row withholds write actions', view.rows.every(row => row.actions.every(action => !action.available)));
const prompts: Record<string, AttentionPromptState> = { active: 'available', shell: 'unsupported', busy: 'not-ready', leased: 'other-device' };
const access = (overrides: Partial<AttentionAccess> = {}): AttentionAccess => ({ runsWrite: true, terminalWrite: true, prompt: id => prompts[id] ?? 'unsupported', ...overrides });
const cancelled = run('stopped', { repositoryId: 'three', repositoryName: 'Project three', status: 'cancelled', phase: 'cancelled' });
const three = attentionOverview(config, [waiting, cancelled], [session('active')], undefined, 99, access());
const byReason = (reason: string) => three.rows.find(row => row.reason === reason)!;
check('three projects: waiting, working and interrupted rows coexist with their own actions', new Set([byReason('question'), byReason('process-active'), byReason('cancelled')].map(row => row.project)).size === 3);
check('waiting run offers answer and cancel, nothing else', JSON.stringify(byReason('question').actions) === JSON.stringify([{ kind: 'answer', available: true }, { kind: 'cancel', available: true }]));
check('working CLI offers instruction and input, and states that a turn cannot be interrupted', JSON.stringify(byReason('process-active').actions) === JSON.stringify([
  { kind: 'instruct', available: true }, { kind: 'take-input', available: true }, { kind: 'interrupt', available: false, reason: 'no-turn-control' }]));
check('finished, cancelled or lost work offers no action', byReason('cancelled').actions.length === 0 && attentionOverview(config, [], [], undefined, 1, access()).rows.find(row => row.reason === 'lost')!.actions.length === 0);
check('no action anywhere claims a universal pause', three.rows.every(row => row.actions.every(action => action.kind !== 'interrupt' || !action.available)));
const sessionActions = (id: string, extra: Partial<SessionMeta> = {}, grants: Partial<AttentionAccess> = {}) =>
  attentionOverview({ ...config, sessionBookends: [] }, [], [session(id, extra)], undefined, 1, access(grants)).rows[0]!.actions;
const instruct = (id: string, extra: Partial<SessionMeta> = {}) => sessionActions(id, extra).find(action => action.kind === 'instruct')!;
check('a shell without protected prompt transport cannot be instructed', JSON.stringify(instruct('shell', { program: undefined })) === JSON.stringify({ kind: 'instruct', available: false, reason: 'prompt-unsupported' }));
check('a CLI that cannot take a paste right now is temporarily blocked', JSON.stringify(instruct('busy')) === JSON.stringify({ kind: 'instruct', available: false, reason: 'prompt-not-ready' }));
check('another device holding input blocks instruction but still allows taking input', JSON.stringify(sessionActions('leased').slice(0, 2)) === JSON.stringify([
  { kind: 'instruct', available: false, reason: 'other-device' }, { kind: 'take-input', available: true }]));
check('plain shells do not pretend to have an interruptible agent turn', !sessionActions('shell', { program: undefined }).some(action => action.kind === 'interrupt'));
check('exited sessions offer no input actions', sessionActions('active', { status: 'exited', exitCode: 0, endedAt: 2 }).length === 0);
check('read-only devices see answers and cancellation as unavailable with a reason', attentionOverview(config, [waiting], [], undefined, 1, access({ runsWrite: false })).rows[0]!.actions
  .every(action => !action.available && action.reason === 'read-only'));
check('devices without terminal control cannot instruct or take input', sessionActions('active', {}, { terminalWrite: false }).every(action => !action.available && action.reason === 'read-only'));
check('actions carry no prompt text, path or native command', !JSON.stringify(three.rows.map(row => row.actions)).match(/PRIVATE|\/private|pty|commandId/));

// Drafts: bound to host identity and row, bounded, never shared.
const drafts = new AttentionDrafts('host-a');
drafts.slot<string>('session:a:instruct').write('A only');
check('a draft stays with its own session', drafts.slot<string>('session:a:instruct').read() === 'A only' && drafts.slot<string>('session:b:instruct').read() === undefined);
check('another host identity cannot read the draft', new AttentionDrafts('host-b').slot<string>('session:a:instruct').read() === undefined);
for (let index = 0; index < ATTENTION_DRAFT_LIMIT + 5; index++) drafts.slot<string>(`row:${index}`).write('x');
check('draft memory is bounded and evicts the oldest entry', drafts.slot<string>('session:a:instruct').read() === undefined && drafts.slot<string>(`row:${ATTENTION_DRAFT_LIMIT + 4}`).read() === 'x');

// Delivery: an unconfirmed instruction keeps one identity; a check never sends different text.
void (async () => {
  const sent: Array<[string, string]> = []; let mode: 'fail' | 'ok' | 'replay' = 'fail';
  const send = async (text: string, id: string) => { sent.push([text, id]); if (mode === 'fail') throw new Error('lost receipt'); return { accepted: true as const, replayed: mode === 'replay' }; };
  let ids = 0; const newId = () => `id-${++ids}`;
  let draft: InstructDraft = { text: 'Bitte Tests ergänzen', status: 'idle' };
  draft = await deliverInstruction(draft, send, newId);
  check('a failed handoff keeps text and delivery identity locked', draft.status === 'unconfirmed' && draft.attempt?.commandId === 'id-1' && draft.text === 'Bitte Tests ergänzen');
  draft = await deliverInstruction({ ...draft, text: 'edited behind the lock' }, send, newId); mode = 'replay';
  draft = await deliverInstruction(draft, send, newId);
  check('status check repeats the same identity and text and reports the earlier delivery', sent.every(([text, id]) => text === 'Bitte Tests ergänzen' && id === 'id-1')
    && draft.status === 'delivered' && draft.replayed === true && draft.text === '' && ids === 1);
  mode = 'fail'; let released = releaseInstruction(await deliverInstruction({ text: 'Neu', status: 'idle' }, send, newId));
  check('after the operator checked the terminal the text unlocks without a delivery identity', released.status === 'idle' && !released.attempt && released.text === 'Neu');
  mode = 'ok'; released = await deliverInstruction(released, send, newId);
  check('the next send after release is a new delivery', sent.at(-1)![1] === 'id-3' && released.status === 'delivered' && released.replayed === false);
  {
  const { acknowledgeInterruptedBookend } = await import('../src/main/overview/sessionBookends');
  const lost = { id: 'lost-1', agentName: 'Lost', runtime: 'codex' as const, repositoryId: null, repositoryName: null, startedAt: 1, endedAt: 2, exitReason: 'interrupted' as const };
  const withLost = { ...config, sessionBookends: [lost, { ...lost, id: 'ended-1', exitReason: 'exit' as const }] };
  const listed = attentionOverview(withLost, [], []).rows.find(row => row.id === 'history:lost-1');
  check('an interrupted record is listed, and is closable only for a caller that may close it', !!listed && listed.dismissible === undefined
    && attentionOverview(withLost, [], [], undefined, 99, { runsWrite: false, terminalWrite: false, dismiss: true, prompt: () => 'unsupported' }).rows.find(row => row.id === 'history:lost-1')?.dismissible === true);
  const acknowledged = acknowledgeInterruptedBookend(withLost.sessionBookends, 'lost-1', 50);
  check('closing acknowledges only the interrupted record and keeps it', acknowledged[0]!.acknowledgedAt === 50 && acknowledged[0]!.exitReason === 'interrupted' && acknowledged[1]!.acknowledgedAt === undefined && acknowledged.length === 2);
  check('an acknowledged interruption is no longer listed', !attentionOverview({ ...withLost, sessionBookends: acknowledged }, [], []).rows.some(row => row.kind === 'history'));
  check('closing again, a normally ended or an unknown session changes nothing', acknowledgeInterruptedBookend(acknowledged, 'lost-1', 60) === acknowledged
    && acknowledgeInterruptedBookend(withLost.sessionBookends, 'ended-1', 60) === withLost.sessionBookends && acknowledgeInterruptedBookend(withLost.sessionBookends, 'nope', 60) === withLost.sessionBookends);
}
console.log(`Attention: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})();
