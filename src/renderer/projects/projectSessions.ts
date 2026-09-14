import type { SessionLaunchChoice } from '../../shared/remote';
import type { SessionMeta } from '../../shared/types';
import { canReuseLaunch } from '../../shared/sessionState';

/** Reuse only the exact workspace, branch, runtime/model and explicit profile. */
export function reusableProjectSession(sessions: SessionMeta[], workspaceId: string, branch: string,
  choice: SessionLaunchChoice, profileId?: string): SessionMeta | undefined {
  return sessions.filter((session) => session.projectWorkspaceId === workspaceId && session.branch === branch
    && session.kind === 'interactive' && canReuseLaunch({ ...session, launchMode: session.launchChoice?.mode }, choice.mode)
    && session.launchProfileId === (choice.mode === 'agent' ? profileId : undefined)
    && (choice.mode !== 'ollama' || session.launchChoice?.mode === 'ollama' && session.launchChoice.model === choice.model))
    .sort((a, b) => a.createdAt - b.createdAt).at(-1);
}
