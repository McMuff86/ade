import type { SessionMeta } from '../shared/types';

export interface SessionExitNotice {
  title: string;
  body: string;
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
