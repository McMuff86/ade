import { REMOTE_ADMIN_SCOPES, type RemoteAdminScope } from './remoteDevices';

export const REMOTE_SCOPE_LABELS: Record<RemoteAdminScope, string> = {
  'host:restart': 'ADE neu starten', 'catalog:write': 'Agents und Projekte erstellen', 'repositories:write': 'Git abrufen und Workspaces aktualisieren',
  'workspace:read': 'Workspace-Dateien und Git-Diffs lesen', 'workspace:write': 'Kleine Workspace-Textdateien bearbeiten',
  'profiles:write': 'Agent-Namen, Rollen und Profilbilder bearbeiten', 'projects:write': 'Projekt-Workspaces ohne Agent-Profil öffnen',
  'projectGit:write': 'Projekt-Branches und lokale Git-Aktionen ausführen', 'projectGit:publish': 'Projekt-Branches pushen und GitHub-PRs erstellen',
  'terminal:control': 'Interaktive Terminals steuern (Befehle mit den Rechten meines Windows-Benutzers)',
};
export const SETUP_INTENTS = {
  project: { label: 'An Projekten arbeiten', preset: 'Projektarbeit auswählen', root: true,
    scopes: ['workspace:read', 'projects:write', 'catalog:write', 'terminal:control', 'projectGit:write', 'workspace:write'] },
  results: { label: 'Ergebnisdateien ansehen', preset: 'Dateilesen auswählen', root: false, scopes: ['workspace:read'] },
  publish: { label: 'Push und PR nutzen', preset: 'Push/PR auswählen', root: false, scopes: ['workspace:read', 'projects:write', 'projectGit:publish'] },
} as const satisfies Record<string, { label: string; preset: string; root: boolean; scopes: readonly RemoteAdminScope[] }>;
export type SetupIntent = keyof typeof SETUP_INTENTS;

export function setupReadiness(intent: SetupIntent, capabilities: unknown, configured: boolean | undefined, online: boolean) {
  const known = Array.isArray(capabilities);
  const required: readonly RemoteAdminScope[] = SETUP_INTENTS[intent].scopes;
  const missing = known ? required.filter((scope) => !capabilities.includes(scope)) : [];
  const root = !SETUP_INTENTS[intent].root ? 'not-required' : configured === undefined ? 'unknown' : configured ? 'ready' : 'missing';
  const status = !online ? 'offline' : !known || root === 'unknown' ? 'unknown' : missing.length || root === 'missing' ? 'missing' : 'ready';
  return { status, root, missing };
}

/** Select a draft only; preserves unrelated existing grants and adds no implicit publish permission. */
export function addSetupScopes(current: readonly RemoteAdminScope[], intent: SetupIntent): RemoteAdminScope[] {
  const scopes = new Set<RemoteAdminScope>([...current, ...SETUP_INTENTS[intent].scopes]);
  return REMOTE_ADMIN_SCOPES.filter((scope) => scopes.has(scope));
}
