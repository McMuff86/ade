import type { MobileCatalog, MobileRecentSession } from './remote';
import type { Agent, Repository, SessionMeta } from './types';
import { sessionStateLabel } from './sessionState';
import { SESSION_LAUNCH_LABELS } from './sessionLaunch';

/** Display-only projection. Navigation revalidates the original identity. */
export interface SessionNavigationItem {
  id: string; project: string; title: string; detail: string; status: string;
  running: boolean; createdAt: number;
}
function sorted(items: SessionNavigationItem[]): SessionNavigationItem[] {
  return items.sort((a, b) => Number(b.running) - Number(a.running) || b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}
export function desktopSessionNavigation(sessions: readonly SessionMeta[], repositories: readonly Repository[], agents: Readonly<Record<string, Agent>>): SessionNavigationItem[] {
  return sorted(sessions.filter(session => session.kind === 'interactive' && !session.runTaskId && !session.remoteAccessBlocked
    && (session.projectWorkspaceId || session.agentId || session.scopeSource === 'terminal-home')).map(session => ({
    id: session.id,
    project: session.repositoryId ? repositories.find(repo => repo.id === session.repositoryId)?.name ?? 'Entferntes Projekt' : 'Ohne Projekt',
    title: session.title,
    detail: [session.branch, session.launchChoice ? SESSION_LAUNCH_LABELS[session.launchChoice.mode] : session.runtime,
      session.launchProfileName ?? (session.agentId ? agents[session.agentId]?.name : undefined)].filter(Boolean).join(' · '),
    status: sessionStateLabel({ ...session, launchMode: session.launchChoice?.mode }),
    running: session.status === 'running', createdAt: session.createdAt,
  })));
}
export function mobileSessionNavigation(sessions: readonly MobileRecentSession[], catalog: MobileCatalog | null): SessionNavigationItem[] {
  return sorted(sessions.map(session => ({
    id: session.id,
    project: session.projectName ?? (session.repositoryId ? catalog?.repositories.find(repo => repo.id === session.repositoryId)?.name ?? 'Entferntes Projekt' : 'Ohne Projekt'),
    title: session.title,
    detail: [session.branch, session.launchMode ? SESSION_LAUNCH_LABELS[session.launchMode] : undefined,
      session.launchProfileName ?? (session.agentId ? catalog?.agents.find(agent => agent.id === session.agentId)?.name : undefined)].filter(Boolean).join(' · '),
    status: sessionStateLabel(session), running: session.status === 'running', createdAt: session.createdAt,
  })));
}
export function filterSessionNavigation(items: readonly SessionNavigationItem[], search: string): SessionNavigationItem[] {
  const words = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => words.every(word => `${item.project} ${item.title} ${item.detail}`.toLocaleLowerCase().includes(word)));
}
