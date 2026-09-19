import { t as translate } from "../../shared/i18n";
import { useMode } from '../stores/mode';
import { useSelection } from '../stores/selection';
import { TERMINAL_HOME_GROUP, useSessions } from '../stores/sessions';
import { useCliWorkPreferences } from './cliWorkPreferences';

/** Navigation only: never creates or restarts a PTY. */
export async function openCliSession(id: string, current: () => boolean = () => true): Promise<void> {
  await useSessions.getState().hydrate(true);
  if (!current()) return;
  if (useSessions.getState().error?.source === 'recovery') throw new Error(translate("Could not check the session list. Try again."));
  const session = useSessions.getState().sessions[id];
  if (!session || session.remoteAccessBlocked || session.kind !== 'interactive') throw new Error(translate("This session is no longer available. Update list."));
  if (session.projectWorkspaceId) {
    const { workspace } = await window.ade.invoke('project:query', { operation: 'workspace', workspaceId: session.projectWorkspaceId });
    if (!current()) return;
    if (!workspace || workspace.branch !== session.branch) throw new Error(translate("The workspace branch has changed since the start of the session, checking the location first under Projects."));
    useSelection.getState().openProjectSession(session.projectWorkspaceId, session.id);
    useMode.getState().setMode('projects');
  } else {
    useSelection.getState().setSelectedAgent(session.agentId ?? null);
    useSelection.getState().setSelectedRepository(session.repositoryId ?? null);
    useSessions.getState().setActive(session.agentId ?? TERMINAL_HOME_GROUP, session.id);
    useMode.getState().setMode('terminals');
  }
  useCliWorkPreferences.getState().update(id, { seenSequence: session.outputSequence ?? 0 });
}
