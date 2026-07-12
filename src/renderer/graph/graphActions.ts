/** Graph actions backed by persisted runs/tasks and main-owned PTY sessions. */

import type { RunParticipant } from '../../shared/types';
import { useAppData } from '../stores/appdata';
import { useMode } from '../stores/mode';
import { useRuns } from '../stores/runs';
import { useSelection } from '../stores/selection';
import { useSessions } from '../stores/sessions';
import { useGraphStore } from './graphStore';

export interface DispatchOpts {
  /** Fan the task out to each worker as its own bounded task session. */
  toWorkers?: boolean;
  /** Internal grouping key used to cancel a partially queued team dispatch. */
  dispatchId?: string;
}

export interface DispatchResult {
  started: number;
  failed: number;
}

function newDispatchId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `dispatch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function activeParticipants(): {
  runId: string;
  repositoryId?: string | null;
  participants: RunParticipant[];
} | null {
  const runs = useRuns.getState();
  if (!runs.activeRunId) return null;
  return {
    runId: runs.activeRunId,
    repositoryId: runs.runs.find((run) => run.id === runs.activeRunId)?.repositoryId,
    participants: runs.participants.filter((participant) => participant.runId === runs.activeRunId),
  };
}

async function dispatchParticipant(
  runId: string,
  participant: RunParticipant,
  prompt: string,
  dispatchId: string,
  repositoryId?: string | null,
): Promise<boolean> {
  const graph = useGraphStore.getState();
  if (!useAppData.getState().agents[participant.agentId]) return false;

  graph.setBusy(participant.id, 'working');
  let runTaskId: string | undefined;
  try {
    const task = await useRuns.getState().createTask({
      runId,
      participantId: participant.id,
      prompt,
    });
    runTaskId = task.id;
    await useSessions.getState().createSession(
      participant.agentId,
      prompt,
      dispatchId,
      task.id,
      task.repositoryId !== undefined ? task.repositoryId : repositoryId,
      task.workspaceBindingId,
    );
    return true;
  } catch (error) {
    console.error(`[ade] dispatch failed for participant ${participant.id}:`, error);
    if (runTaskId) {
      try {
        await useRuns.getState().failTask(runTaskId, errorMessage(error));
      } catch (persistError) {
        console.error(`[ade] failed to persist task failure ${runTaskId}:`, persistError);
      }
    }
    graph.clearBusy(participant.id);
    return false;
  }
}

export async function dispatchTeam(
  teamId: string,
  task: string,
  opts: DispatchOpts = {},
): Promise<DispatchResult> {
  const prompt = task.trim();
  const active = activeParticipants();
  if (!prompt || !active || useGraphStore.getState().idleTeams[teamId]) {
    return { started: 0, failed: 0 };
  }

  const members = active.participants.filter((participant) => participant.teamId === teamId);
  const lead = members.find((participant) => participant.role === 'lead') ?? members[0];
  if (!lead) return { started: 0, failed: 0 };
  const targets = opts.toWorkers
    ? [lead, ...members.filter((participant) => participant !== lead)]
    : [lead];
  const dispatchId = opts.dispatchId ?? newDispatchId();
  const result: DispatchResult = { started: 0, failed: 0 };

  for (const participant of targets) {
    if (await dispatchParticipant(
      active.runId,
      participant,
      prompt,
      dispatchId,
      active.repositoryId,
    )) result.started += 1;
    else result.failed += 1;
  }
  return result;
}

export async function dispatchAgent(participantId: string, task: string): Promise<DispatchResult> {
  const prompt = task.trim();
  const active = activeParticipants();
  if (!prompt || !active) return { started: 0, failed: 0 };
  const participant = active.participants.find((candidate) => candidate.id === participantId);
  if (!participant) return { started: 0, failed: 1 };
  const started = await dispatchParticipant(
    active.runId,
    participant,
    prompt,
    newDispatchId(),
    active.repositoryId,
  );
  return { started: started ? 1 : 0, failed: started ? 0 : 1 };
}

export async function dispatchAll(task: string, opts: DispatchOpts = {}): Promise<DispatchResult> {
  const active = activeParticipants();
  if (!active) return { started: 0, failed: 0 };
  const graph = useGraphStore.getState();
  const teamIds = [...new Set(active.participants
    .map((participant) => participant.teamId)
    .filter((teamId): teamId is string => Boolean(teamId)))]
    .filter((teamId) => !graph.idleTeams[teamId]);
  const result: DispatchResult = { started: 0, failed: 0 };
  for (const teamId of teamIds) {
    const teamResult = await dispatchTeam(teamId, task, {
      ...opts,
      dispatchId: newDispatchId(),
    });
    result.started += teamResult.started;
    result.failed += teamResult.failed;
  }
  return result;
}

export async function cancelTeamTasks(teamId: string): Promise<void> {
  const active = activeParticipants();
  if (!active) return;
  const participantIds = new Set(active.participants
    .filter((participant) => participant.teamId === teamId)
    .map((participant) => participant.id));
  const runTaskIds = useRuns.getState().tasks
    .filter((task) => task.runId === active.runId && participantIds.has(task.participantId))
    .filter((task) => task.status === 'queued' || task.status === 'running')
    .map((task) => task.id);
  await useSessions.getState().cancelTasks({ runTaskIds });
  for (const participantId of participantIds) useGraphStore.getState().clearBusy(participantId);
}

export async function cancelAllTasks(): Promise<void> {
  const active = activeParticipants();
  if (!active) return;
  const runTaskIds = useRuns.getState().tasks
    .filter((task) => task.runId === active.runId)
    .filter((task) => task.status === 'queued' || task.status === 'running')
    .map((task) => task.id);
  await useSessions.getState().cancelTasks({ runTaskIds });
  const participantIds = new Set(active.participants.map((participant) => participant.id));
  useGraphStore.setState((state) => ({
    busy: Object.fromEntries(
      Object.entries(state.busy).filter(([participantId]) => !participantIds.has(participantId)),
    ),
  }));
}

/**
 * Main-owned managed pause: journaled, persisted, honored by the scheduler.
 * Manual runs keep using the renderer-local graphStore.idleTeams instead.
 */
export async function setTeamPause(runId: string, teamId: string, paused: boolean): Promise<void> {
  const commandId = globalThis.crypto?.randomUUID?.();
  await window.ade.invoke(paused ? 'run:pauseTeam' : 'run:resumeTeam', {
    runId,
    teamId,
    ...(commandId ? { commandId } : {}),
  });
}

/**
 * Attach to the participant's live task session when one is running; only
 * fall back to the interactive terminal when no bounded task is active.
 */
export async function openParticipantTerminal(
  agentId: string,
  participantId: string,
  runId: string,
): Promise<void> {
  const sessionsState = useSessions.getState();
  const liveTask = useRuns.getState().tasks
    .filter((task) => task.runId === runId
      && task.participantId === participantId
      && task.sessionId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .find((task) => sessionsState.sessions[task.sessionId!]?.status === 'running');
  if (liveTask?.sessionId) {
    sessionsState.setActive(agentId, liveTask.sessionId);
    useSelection.getState().setSelectedAgent(agentId);
    useMode.getState().setMode('terminals');
    return;
  }
  await openTerminal(agentId);
}

/** Jump to a catalog agent's live terminal, spawning one when needed. */
export async function openTerminal(agentId: string): Promise<void> {
  if (!useAppData.getState().agents[agentId]) return;
  const sessions = useSessions.getState();
  const runs = useRuns.getState();
  const repositoryId = runs.runs.find((run) => run.id === runs.activeRunId)?.repositoryId;
  const matchingSessionId = [...(sessions.orderByAgent[agentId] ?? [])].reverse().find((sessionId) => {
    const meta = sessions.sessions[sessionId];
    if (!meta || meta.kind !== 'interactive') return false;
    if (repositoryId === undefined) return true;
    if (repositoryId === null) return meta.scopeSource === 'plain-home';
    return meta.repositoryId === repositoryId;
  });
  if (!matchingSessionId) {
    try {
      await sessions.createSession(agentId, undefined, undefined, undefined, repositoryId);
    } catch (error) {
      console.error('[ade] openTerminal: session failed:', error);
    }
  } else {
    sessions.setActive(agentId, matchingSessionId);
  }
  useSelection.getState().setSelectedAgent(agentId);
  useMode.getState().setMode('terminals');
}

if (typeof window !== 'undefined' && window.ade) {
  window.ade.on('pty:exit', ({ sessionId }) => {
    const meta = useSessions.getState().sessions[sessionId];
    if (!meta?.runTaskId) return;
    const task = useRuns.getState().tasks.find((candidate) => candidate.id === meta.runTaskId);
    if (!task) return;
    // Durable task status now drives the node. The transient dispatch marker is
    // only needed until the real PTY completion event arrives.
    useGraphStore.getState().clearBusy(task.participantId);
  });
}
