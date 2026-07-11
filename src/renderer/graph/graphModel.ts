/** Derive the Graph canvas from one persisted orchestration run. */

import type {
  Agent,
  RunParticipant,
  RunTask,
  RuntimeId,
} from '../../shared/types';
import type { TransientStatus } from './graphStore';

export type NodeStatus = 'running' | 'idle' | 'working' | 'done' | 'failed';

export interface GraphMember {
  /** Run-scoped participant id. */
  id: string;
  agentId: string;
  name: string;
  runtime: RuntimeId;
  available: boolean;
}

export interface TeamModel {
  id: string;
  name: string;
  lead: GraphMember | null;
  workers: GraphMember[];
  idle: boolean;
  status: NodeStatus;
}

export interface GraphModel {
  orchestrator: GraphMember | null;
  teams: TeamModel[];
}

export interface SessionsSlice {
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
  participantId: string,
  agentId: string,
  opts: {
    idle: boolean;
    busy: Record<string, TransientStatus>;
    sessions: SessionsSlice;
    tasks: RunTask[];
  },
): NodeStatus {
  if (opts.idle) return 'idle';
  const transient = opts.busy[participantId];
  if (transient) return transient;

  const latestTask = opts.tasks
    .filter((task) => task.participantId === participantId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (latestTask?.status === 'queued' || latestTask?.status === 'running') return 'working';
  if (latestTask?.status === 'completed') return 'done';
  if (latestTask?.status === 'failed') return 'failed';

  const ids = opts.sessions.orderByAgent[agentId] ?? [];
  if (ids.some((id) => {
    const session = opts.sessions.sessions[id];
    return session?.kind === 'interactive' && session.status === 'running';
  })) return 'running';
  return 'idle';
}

function rollup(members: NodeStatus[]): NodeStatus {
  if (members.some((status) => status === 'working')) return 'working';
  if (members.some((status) => status === 'failed')) return 'failed';
  if (members.some((status) => status === 'running')) return 'running';
  if (members.some((status) => status === 'done')) return 'done';
  return 'idle';
}

function member(participant: RunParticipant, agents: Record<string, Agent>): GraphMember {
  const current = agents[participant.agentId];
  return {
    id: participant.id,
    agentId: participant.agentId,
    name: current?.name ?? participant.agentName,
    runtime: current?.runtime ?? participant.runtime,
    available: Boolean(current),
  };
}

export function buildGraph(
  runId: string | null,
  participants: RunParticipant[],
  agents: Record<string, Agent>,
  tasks: RunTask[],
  sessions: SessionsSlice,
  busy: Record<string, TransientStatus>,
  idleTeams: Record<string, true>,
): GraphModel {
  if (!runId) return { orchestrator: null, teams: [] };

  const runParticipants = participants.filter((participant) => participant.runId === runId);
  const runTasks = tasks.filter((task) => task.runId === runId);
  const orchestratorParticipant = runParticipants.find((participant) => participant.role === 'orchestrator');
  const orchestrator = orchestratorParticipant ? member(orchestratorParticipant, agents) : null;

  const teamGroups = new Map<string, { name: string; participants: RunParticipant[] }>();
  for (const participant of runParticipants) {
    if (participant.role === 'orchestrator') continue;
    const id = participant.teamId ?? `${runId}:unassigned`;
    const group = teamGroups.get(id) ?? {
      name: participant.teamName ?? 'Unassigned',
      participants: [],
    };
    group.participants.push(participant);
    teamGroups.set(id, group);
  }

  const teams = [...teamGroups.entries()].map(([id, group]): TeamModel => {
    const leadParticipant = group.participants.find((participant) => participant.role === 'lead')
      ?? group.participants[0];
    const lead = leadParticipant ? member(leadParticipant, agents) : null;
    const workers = group.participants
      .filter((participant) => participant !== leadParticipant)
      .map((participant) => member(participant, agents));
    const idle = Boolean(idleTeams[id]);
    const statuses = [lead, ...workers]
      .filter(Boolean)
      .map((item) => statusFor(item!.id, item!.agentId, {
        idle,
        busy,
        sessions,
        tasks: runTasks,
      }));
    return {
      id,
      name: group.name,
      lead,
      workers,
      idle,
      status: idle ? 'idle' : rollup(statuses),
    };
  });

  return { orchestrator, teams };
}
