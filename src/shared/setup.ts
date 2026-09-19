import { t as translate } from "./i18n";
import { localizedLabels } from "./i18n/labels";
import { REMOTE_ADMIN_SCOPES, type RemoteAdminScope } from './remoteDevices';

export const REMOTE_SCOPE_LABELS: Record<RemoteAdminScope, string> = localizedLabels(() => ({
  'host:restart': translate("Restart ADE"), 'catalog:write': translate("Create agents and projects"), 'repositories:write': translate("Get Git and update workspaces"),
  'workspace:read': translate("Read workspace files and git diffs"), 'workspace:write': translate("Edit small workspace text files"),
  'profiles:write': translate("Edit agent names, roles and profile pictures"), 'projects:write': translate("Open project workspaces without an agent profile"),
  'speech:control': translate("Choose voices and run ElevenLabs voice tests (uses credits)"),
  'dictation:transcribe': translate("Transcribe microphone recordings with ElevenLabs (consumes credit)"),
  'organizer:read': translate("Read personal tasks and notes"),
  'organizer:write': translate("Edit personal tasks and notes"),
  'projectGit:write': translate("Manage project branches and local Git operations"), 'projectGit:publish': translate("Push project branches and create GitHub PRs"),
  'terminal:control': translate("Control interactive terminals (commands with the rights of my Windows user)"),
}));
export const SETUP_INTENTS = localizedLabels(() => ({
  project: { label: translate("Work on projects"), preset: translate("Select project work"), root: true,
    scopes: ['workspace:read', 'projects:write', 'catalog:write', 'terminal:control', 'projectGit:write', 'workspace:write'] },
  results: { label: translate("View results files"), preset: translate("Select file reading"), root: false, scopes: ['workspace:read'] },
  publish: { label: translate("Use push and PR"), preset: translate("Select Push/PR"), root: false, scopes: ['workspace:read', 'projects:write', 'projectGit:publish'] },
} as const satisfies Record<string, { label: string; preset: string; root: boolean; scopes: readonly RemoteAdminScope[] }>));
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
