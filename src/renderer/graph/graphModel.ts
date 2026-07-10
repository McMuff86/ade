/**
 * Derive the Graph-mode model from real app data + live sessions.
 *
 * Teams are categories with kind 'team'; the orchestrator is the single agent
 * (teamRole 'orchestrator') inside the kind 'orchestrator' category. Node status
 * is real: an agent is 'running' when it has a live pty session, unless the user
 * has paused its team (idle) or a task dispatch has it transiently 'working'.
 */

import type { Agent, Category } from '../../shared/types';
import type { TransientStatus } from './graphStore';

export type NodeStatus = 'running' | 'idle' | 'working' | 'done';

export interface TeamModel {
  category: Category;
  lead: Agent | null;
  workers: Agent[];
  idle: boolean;
  /** Team-level rollup used for the frame + orchestrator→lead cable. */
  status: NodeStatus;
}

export interface GraphModel {
  orchestratorCategory: Category | null;
  orchestrator: Agent | null;
  teams: TeamModel[];
}

interface SessionsSlice {
  sessions: Record<string, {
    kind: 'interactive' | 'task';
    status: 'running' | 'exited';
    exitCode?: number;
  }>;
  orderByAgent: Record<string, string[]>;
}

export function hasRunningSession(agentId: string, sessions: SessionsSlice): boolean {
  const ids = sessions.orderByAgent[agentId] ?? [];
  return ids.some((id) => sessions.sessions[id]?.status === 'running');
}

export function statusFor(
  agentId: string,
  opts: { idle: boolean; busy: Record<string, TransientStatus>; sessions: SessionsSlice },
): NodeStatus {
  if (opts.idle) return 'idle';
  const transient = opts.busy[agentId];
  if (transient) return transient;
  const ids = opts.sessions.orderByAgent[agentId] ?? [];
  if (ids.some((id) => {
    const session = opts.sessions.sessions[id];
    return session?.kind === 'task' && session.status === 'running';
  })) return 'working';
  if (ids.some((id) => {
    const session = opts.sessions.sessions[id];
    return session?.kind === 'interactive' && session.status === 'running';
  })) return 'running';
  const latestTask = [...ids].reverse()
    .map((id) => opts.sessions.sessions[id])
    .find((session) => session?.kind === 'task');
  if (latestTask?.status === 'exited' && latestTask.exitCode === 0) return 'done';
  return 'idle';
}

function rollup(members: NodeStatus[]): NodeStatus {
  if (members.some((s) => s === 'working')) return 'working';
  if (members.some((s) => s === 'running')) return 'running';
  if (members.some((s) => s === 'done')) return 'done';
  return 'idle';
}

export function buildGraph(
  categories: Category[],
  agents: Record<string, Agent>,
  sessions: SessionsSlice,
  busy: Record<string, TransientStatus>,
  idleTeams: Record<string, true>,
): GraphModel {
  const orchestratorCategory = categories.find((c) => c.kind === 'orchestrator') ?? null;
  let orchestrator: Agent | null = null;
  if (orchestratorCategory) {
    const members = orchestratorCategory.agents.map((id) => agents[id]).filter(Boolean) as Agent[];
    orchestrator = members.find((a) => a.teamRole === 'orchestrator') ?? members[0] ?? null;
  }

  const teams: TeamModel[] = categories
    .filter((c) => c.kind === 'team')
    .map((category) => {
      const members = category.agents.map((id) => agents[id]).filter(Boolean) as Agent[];
      const lead = members.find((a) => a.teamRole === 'lead') ?? members[0] ?? null;
      const workers = members.filter((a) => a !== lead);
      const idle = Boolean(idleTeams[category.id]);
      const memberStatuses = members.map((a) => statusFor(a.id, { idle, busy, sessions }));
      return { category, lead, workers, idle, status: idle ? 'idle' : rollup(memberStatuses) };
    });

  return { orchestratorCategory, orchestrator, teams };
}
