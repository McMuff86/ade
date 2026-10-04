import type { AdeConfig, RunSummary, SessionMeta } from '../../shared/types';
import type { MorningBriefing } from '../../shared/supervision';
import { ATTENTION_GROUPS, ATTENTION_LIMIT, NO_ATTENTION_ACCESS, type AttentionAccess, type AttentionAction, type AttentionRow, type AttentionSnapshot } from '../../shared/attention';

const FINAL_RUN = new Set(['completed', 'failed', 'cancelled']);
const grant = (kind: AttentionAction['kind'], allowed: boolean): AttentionAction => allowed ? { kind, available: true } : { kind, available: false, reason: 'read-only' };

/** Input is filtered by the application service before projection for remote
 * devices. A running CLI proves a process, not a model turn or input readiness.
 * Actions reflect the caller's `access`; without it every write action is withheld. */
export function attentionOverview(config: AdeConfig, runs: readonly RunSummary[], sessions: readonly SessionMeta[], briefing?: MorningBriefing, now = Date.now(),
  access: AttentionAccess = NO_ATTENTION_ACCESS): AttentionSnapshot {
  const rows: AttentionRow[] = runs.filter(run => run.status !== 'draft').map(run => {
    const pending = run.tasks.reduce((count, task) => count + (task.pendingQuestions ?? 0), 0);
    const reason: AttentionRow['reason'] = run.status === 'failed' ? 'failed' : run.status === 'cancelled' ? 'cancelled'
      : pending ? 'question' : run.phase === 'approval' || run.pendingApprovalId ? 'approval'
        : run.status === 'completed' ? 'completed' : run.status === 'running' ? 'run-active' : 'unknown';
    return { id: `run:${run.id}`, kind: 'run', title: run.name, project: run.repositoryName ?? null,
      group: reason === 'question' || reason === 'approval' ? 'needs-you' : reason === 'completed' ? 'review'
        : reason === 'failed' || reason === 'cancelled' ? 'interrupted' : reason === 'run-active' ? 'working' : 'unknown',
      reason, pendingQuestions: pending, activityAt: run.updatedAt, activityKind: 'state', target: { kind: 'run', id: run.id },
      actions: [...reason === 'question' ? [grant('answer', access.runsWrite)] : [], ...FINAL_RUN.has(run.status) ? [] : [grant('cancel', access.runsWrite)]] };
  });
  const interactive = sessions.filter(session => session.kind === 'interactive' && !session.runTaskId && !session.remoteAccessBlocked);
  const liveIds = new Set(interactive.map(session => session.id));
  for (const session of interactive) {
    const failed = session.exitReason !== 'cancelled' && (session.status === 'exited' && session.exitCode !== undefined && session.exitCode !== 0
      || session.program?.status === 'exited' && session.program.exitCode !== undefined && session.program.exitCode !== 0);
    const reason: AttentionRow['reason'] = session.status === 'exited' ? session.exitReason === 'cancelled' ? 'cancelled' : failed ? 'failed' : 'ended'
      : failed ? 'failed' : session.program?.status === 'running' || session.program?.status === 'starting' ? 'process-active' : 'unknown';
    const endedAt = session.endedAt ?? (session.program?.status === 'exited' ? session.program.endedAt : undefined);
    rows.push({ id: `session:${session.id}`, kind: 'session', title: session.title,
      project: config.repositories.find(repo => repo.id === session.repositoryId)?.name ?? null,
      group: reason === 'failed' || reason === 'cancelled' ? 'interrupted' : reason === 'process-active' ? 'working' : 'unknown',
      reason, pendingQuestions: 0, activityAt: endedAt ?? session.lastOutputAt ?? session.createdAt,
      activityKind: endedAt ? 'state' : session.lastOutputAt ? 'output' : 'start', target: { kind: 'session', id: session.id },
      actions: session.status === 'running' ? sessionActions(session, access) : [] });
  }
  // Recovery records are evidence of process loss, never resumable PTY handles.
  for (const bookend of config.sessionBookends) {
    if (liveIds.has(bookend.id) || bookend.exitReason !== 'interrupted' || bookend.acknowledgedAt !== undefined) continue;
    const repository = config.repositories.find(repo => repo.id === bookend.repositoryId);
    rows.push({ id: `history:${bookend.id}`, kind: 'history', group: 'interrupted', title: bookend.agentName,
      project: bookend.repositoryName, reason: 'lost', pendingQuestions: 0, interruption: bookend.interruption ?? 'unknown',
      ...(access.dismiss ? { dismissible: true } : {}),
      activityAt: bookend.endedAt, activityKind: 'state', target: repository ? { kind: 'project', id: repository.id } : null, actions: [] });
  }
  for (const project of briefing?.projects ?? []) {
    const open = project.handoffs.filter(handoff => handoff.status === 'open');
    if (!open.length) continue;
    rows.push({ id: `handoff:${project.id}`, kind: 'handoff', group: 'needs-you', title: project.name,
      project: project.name, reason: 'handoff', pendingQuestions: 0,
      activityAt: Math.max(...open.map(handoff => handoff.updatedAt)), activityKind: 'state',
      target: project.available ? { kind: 'supervision', id: project.repositoryId } : null, actions: [] });
  }
  rows.sort((left, right) => ATTENTION_GROUPS.indexOf(left.group) - ATTENTION_GROUPS.indexOf(right.group)
    || (right.activityAt ?? 0) - (left.activityAt ?? 0) || left.id.localeCompare(right.id));
  return { observedAt: now, rows: rows.slice(0, ATTENTION_LIMIT), omitted: Math.max(0, rows.length - ATTENTION_LIMIT) };
}

/** A live PTY can take input. Instruction delivery needs the protected prompt path of
 * that exact process; interrupting a running model turn has no confirmed contract. */
function sessionActions(session: SessionMeta, access: AttentionAccess): AttentionAction[] {
  if (!access.terminalWrite) return [{ kind: 'instruct', available: false, reason: 'read-only' }, { kind: 'take-input', available: false, reason: 'read-only' }];
  const prompt = access.prompt(session.id);
  const instruct: AttentionAction = prompt === 'available' ? { kind: 'instruct', available: true }
    : { kind: 'instruct', available: false, reason: prompt === 'unsupported' ? 'prompt-unsupported' : prompt === 'other-device' ? 'other-device' : 'prompt-not-ready' };
  const agent = session.program?.status === 'running' || session.program?.status === 'starting';
  return [instruct, { kind: 'take-input', available: true }, ...agent ? [{ kind: 'interrupt' as const, available: false as const, reason: 'no-turn-control' as const }] : []];
}
