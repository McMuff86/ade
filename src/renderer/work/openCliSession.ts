import { useMode } from '../stores/mode';
import { useSelection } from '../stores/selection';
import { TERMINAL_HOME_GROUP, useSessions } from '../stores/sessions';
import { useCliWorkPreferences } from './cliWorkPreferences';

/** Navigation only: never creates or restarts a PTY. */
export async function openCliSession(id: string, current: () => boolean = () => true): Promise<void> {
  await useSessions.getState().hydrate(true);
  if (!current()) return;
  if (useSessions.getState().error?.source === 'recovery') throw new Error('Die Sitzungsliste konnte nicht geprüft werden. Erneut versuchen.');
  const session = useSessions.getState().sessions[id];
  if (!session || session.remoteAccessBlocked || session.kind !== 'interactive') throw new Error('Diese Sitzung ist nicht mehr verfügbar. Liste aktualisieren.');
  if (session.projectWorkspaceId) {
    const { workspace } = await window.ade.invoke('project:query', { operation: 'workspace', workspaceId: session.projectWorkspaceId });
    if (!current()) return;
    if (!workspace || workspace.branch !== session.branch) throw new Error('Der Workspace-Branch hat sich seit dem Sitzungsstart geändert. Den Arbeitsort zuerst unter Projekte prüfen.');
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
