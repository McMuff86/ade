import { t as translate } from "./i18n";
import type { Agent, Repository, SessionMeta } from './types';
import { sessionStateLabel } from './sessionState';
import { LAUNCH_PROFILES } from './runtimes';

export type CliWorkStatus = 'running' | 'shell' | 'ended' | 'unknown';
export interface CliWorkPreference { title?: string; seenSequence?: number; updatedAt: number }
export interface CliWorkRow {
  session: SessionMeta;
  title: string;
  cli: string;
  project: string;
  profile: string;
  workspace: string;
  state: CliWorkStatus;
  status: string;
  updatedAt: number;
  unread: boolean;
}

export function cliWorkStatus(session: SessionMeta): CliWorkStatus {
  if (session.status === 'exited') return 'ended';
  if (session.program?.status === 'starting' || session.program?.status === 'running') return 'running';
  if (session.program?.status === 'exited' || session.launchChoice?.mode === 'shell' && !session.program) return 'shell';
  return 'unknown';
}

/** Pure desktop projection. Paths already belong to the local SessionMeta contract. */
export function cliWorkRows(sessions: readonly SessionMeta[], repositories: readonly Repository[], agents: Readonly<Record<string, Agent>>,
  preferences: Readonly<Record<string, CliWorkPreference>> = {}): CliWorkRow[] {
  return sessions.filter(session => session.kind === 'interactive' && !session.remoteAccessBlocked).map(session => {
    const preference = preferences[session.id];
    const agent = session.agentId ? agents[session.agentId] : undefined;
    const profile = session.launchProfileName ?? agent?.name ?? '';
    const runtime = session.runtime ?? (session.launchChoice?.mode !== 'agent' ? session.launchChoice?.mode : undefined);
    const cli = runtime && runtime in LAUNCH_PROFILES ? LAUNCH_PROFILES[runtime as keyof typeof LAUNCH_PROFILES].label : session.title;
    return { session, title: preference?.title || session.title, cli,
      project: session.repositoryId ? repositories.find(repo => repo.id === session.repositoryId)?.name ?? translate("Removed project")
        : session.scopeSource === 'terminal-home' ? translate("No project") : translate("Personal workspace"),
      profile, workspace: session.workspaceKind === 'checkout' ? translate("Original folder") : session.workspaceKind === 'worktree' || session.workspaceBindingId ? translate("Worktree")
        : session.projectWorkspaceId ? translate("Project workspace") : translate("Personal workspace"),
      state: cliWorkStatus(session), status: sessionStateLabel({ ...session, launchMode: session.launchChoice?.mode }),
      updatedAt: Math.max(session.createdAt, session.lastOutputAt ?? 0, session.program?.endedAt ?? 0, session.endedAt ?? 0),
      unread: (session.outputSequence ?? 0) > (preference?.seenSequence ?? 0) };
  }).sort((left, right) => Number(left.state === 'ended') - Number(right.state === 'ended')
    || right.session.createdAt - left.session.createdAt || left.session.id.localeCompare(right.session.id));
}

export function matchesCliWork(row: CliWorkRow, filter: { project?: string; profile?: string; cli?: string; status?: string; search?: string }): boolean {
  const statusMatches = !filter.status || filter.status === 'all'
    || (filter.status === 'open' ? row.state !== 'ended' : row.state === filter.status);
  return (!filter.project || row.session.repositoryId === filter.project)
    && (!filter.profile || row.session.agentId === filter.profile || row.session.launchProfileId === filter.profile)
    && (!filter.cli || row.cli === filter.cli)
    && statusMatches
    && (!filter.search || [row.title, row.cli, row.project, row.profile, row.session.branch, row.session.workspaceDir].join(' ').toLocaleLowerCase().includes(filter.search.toLocaleLowerCase()));
}
