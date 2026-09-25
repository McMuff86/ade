import { t as translate } from "./i18n";
import { localizedLabels } from "./i18n/labels";
import type { SessionLaunchChoice, SessionLaunchOptions } from './remote';
import { OLLAMA_MODEL_PATTERN } from './runtimes';
import { validWorkspaceSelection } from './projectWorkspaceRequests';

export function validTerminalSelection(value: Record<string, unknown>): boolean {
  return Object.hasOwn(value, 'terminalHome')
    ? value.terminalHome === true && !['agentId', 'repositoryId', 'projectWorkspaceId', 'workspaceBindingId', 'expectedBranch', 'profileId'].some((key) => Object.hasOwn(value, key))
      && value.mode !== 'agent'
    : validWorkspaceSelection(value);
}

export const SESSION_LAUNCH_LABELS: Record<SessionLaunchChoice['mode'], string> = localizedLabels(() => ({
  shell: translate("Empty terminal"), agent: translate("Saved agent profile"), codex: translate("Codex"), claude: translate("Claude CLI"), grok: translate("Grok CLI"), hermes: translate("Hermes"), ollama: translate("Ollama"),
}));

/** Project shortcuts use a visible, host-recommended saved profile. The request
 * still carries its exact ID through ordinary main/device profile validation. */
export function projectLaunchSelection(choice: SessionLaunchChoice, options?: SessionLaunchOptions, selectedProfileId?: string): { choice: SessionLaunchChoice; profileId?: string } {
  if (choice.mode === 'agent') return { choice, profileId: selectedProfileId };
  const profile = options?.profiles?.find(p => p.defaultForCli && p.runtime === choice.mode);
  return profile ? { choice: { mode: 'agent' }, profileId: profile.id } : { choice };
}

export function projectLaunchLabel(choice: SessionLaunchChoice, options?: SessionLaunchOptions, selectedProfileId?: string): string {
  const launch = projectLaunchSelection(choice, options, selectedProfileId);
  const profile = options?.profiles?.find(p => p.id === launch.profileId);
  return profile ? `${profile.name} · ${profile.permissionMode === 'bypass' ? 'Bypass' : profile.permissionMode === 'accept-edits' ? translate('Accept edits') : translate('default')}`
    : `${SESSION_LAUNCH_LABELS[choice.mode]} · ${translate('Without an agent profile')}`;
}
export function validSessionChoice(value: Record<string, unknown>): boolean {
  return ['shell', 'agent', 'codex', 'claude', 'grok', 'hermes', 'ollama'].includes(String(value.mode))
    && (value.mode === 'ollama' ? typeof value.model === 'string' && OLLAMA_MODEL_PATTERN.test(value.model) : value.model === undefined);
}

/** A project launch must name the branch the user actually saw. */
export function validProjectLaunch(value: Record<string, unknown>): boolean {
  return typeof value.expectedBranch === 'string' && value.expectedBranch.length > 0 && value.expectedBranch.length <= 200
    && !/[\x00-\x1f\x7f]/.test(value.expectedBranch)
    && (value.mode === 'agent' ? typeof value.profileId === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value.profileId) : value.profileId === undefined);
}
