import type { SessionMeta } from '../shared/types';

export interface SessionExitNotice {
  title: string;
  body: string;
}

/**
 * A managed run entered `approval`: the human gate that holds exclusive
 * workspace leases until it is answered. Always worth a notice; the body
 * names only counts and the run name — never prompts, paths or summaries.
 */
export function runApprovalNotice(
  runName: string,
  workTaskCount: number,
  validatedCommitCount: number,
): SessionExitNotice {
  const name = runName.trim().slice(0, 80) || 'Run';
  const tasks = `${workTaskCount} worker task${workTaskCount === 1 ? '' : 's'}`;
  const commits = `${validatedCommitCount} validated commit${validatedCommitCount === 1 ? '' : 's'}`;
  return {
    title: `${name} awaits your approval`,
    body: `${tasks} finished with ${commits}. Approve or reject in the Graph to release the workspace leases.`,
  };
}

export function sessionExitNotice(meta: SessionMeta, agentName: string): SessionExitNotice | null {
  if (meta.exitReason === 'cancelled') return null;
  const exitCode = meta.exitCode ?? -1;
  if (meta.kind === 'interactive' && exitCode === 0) return null;

  if (meta.kind === 'task') {
    return exitCode === 0
      ? { title: `${agentName} completed a task`, body: 'The task finished successfully.' }
      : { title: `${agentName} task failed`, body: `The task exited with code ${exitCode}.` };
  }
  return {
    title: `${agentName} session ended`,
    body: `The terminal exited with code ${exitCode}.`,
  };
}
