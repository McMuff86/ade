/** Derive the multi-run Graph canvas from persisted orchestration runs. */

import type {
  Agent,
  Run,
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
  /**
   * True when the team is paused. For managed runs this mirrors the main-owned
   * Run.pausedTeamIds; for manual runs it is the renderer-local idleTeams flag.
   */
  idle: boolean;
  status: NodeStatus;
}

/** One run rendered as an independent cluster on the shared canvas. */
export interface RunClusterModel {
  run: Run;
  orchestrator: GraphMember | null;
  teams: TeamModel[];
  runningTaskCount: number;
  queuedTaskCount: number;
  /** Completed/failed/cancelled runs render dimmed and read-only. */
  terminal: boolean;
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

const TERMINAL_RUN_STATUS = new Set(['completed', 'failed', 'cancelled']);

export function isTerminalRunStatus(status: string): boolean {
  return TERMINAL_RUN_STATUS.has(status);
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
  const transient = opts.busy[participantId];
  if (transient) return transient;

  const latestTask = opts.tasks
    .filter((task) => task.participantId === participantId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  // A running task outranks the pause flag: pausing a team only stops future
  // scheduling, so an in-flight worker must keep reading as working.
  if (latestTask?.status === 'queued' || latestTask?.status === 'running') return 'working';
  if (opts.idle) return 'idle';
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

function buildCluster(
  run: Run,
  participants: RunParticipant[],
  agents: Record<string, Agent>,
  tasks: RunTask[],
  sessions: SessionsSlice,
  busy: Record<string, TransientStatus>,
  manualIdleTeams: Record<string, true>,
): RunClusterModel {
  const runParticipants = participants.filter((participant) => participant.runId === run.id);
  const runTasks = tasks.filter((task) => task.runId === run.id);
  const orchestratorParticipant = runParticipants.find((participant) => participant.role === 'orchestrator');
  const orchestrator = orchestratorParticipant ? member(orchestratorParticipant, agents) : null;
  const pausedTeams = new Set(run.pausedTeamIds ?? []);

  const teamGroups = new Map<string, { name: string; participants: RunParticipant[] }>();
  for (const participant of runParticipants) {
    if (participant.role === 'orchestrator') continue;
    const id = participant.teamId ?? `${run.id}:unassigned`;
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
    const idle = run.mode === 'managed'
      ? pausedTeams.has(id)
      : Boolean(manualIdleTeams[id]);
    const statuses = [lead, ...workers]
      .filter(Boolean)
      .map((item) => statusFor(item!.id, item!.agentId, {
        idle,
        busy,
        sessions,
        tasks: runTasks,
      }));
    const rolled = rollup(statuses);
    return {
      id,
      name: group.name,
      lead,
      workers,
      idle,
      status: idle && rolled !== 'working' ? 'idle' : rolled,
    };
  });

  return {
    run,
    orchestrator,
    teams,
    runningTaskCount: runTasks.filter((task) => task.status === 'running').length,
    queuedTaskCount: runTasks.filter((task) => task.status === 'queued').length,
    terminal: isTerminalRunStatus(run.status),
  };
}

/**
 * Build every visible run cluster: all non-terminal runs plus the most recent
 * `completedLimit` terminal runs (dimmed), ordered by creation for a stable
 * left-to-right layout.
 */
export function buildClusters(
  runs: Run[],
  participants: RunParticipant[],
  agents: Record<string, Agent>,
  tasks: RunTask[],
  sessions: SessionsSlice,
  busy: Record<string, TransientStatus>,
  manualIdleTeams: Record<string, true>,
  completedLimit = 2,
): RunClusterModel[] {
  const active = runs.filter((run) => !isTerminalRunStatus(run.status));
  const recentTerminal = runs
    .filter((run) => isTerminalRunStatus(run.status))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, completedLimit);
  return [...active, ...recentTerminal]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((run) => buildCluster(run, participants, agents, tasks, sessions, busy, manualIdleTeams));
}
