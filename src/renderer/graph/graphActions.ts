/**
 * Graph-mode actions — the real wiring behind the canvas.
 *
 * Everything routes through the existing stores/IPC: a team is a Category
 * (kind 'team'), a lead/worker is an Agent (teamRole), so leads get their
 * MEMORY.md / USER.md from the normal agent-creation scaffold. Dispatching a
 * task opens a real pty session for the lead and types the task into it.
 */

import type { Agent, RuntimeId } from '../../shared/types';
import { useAppData } from '../stores/appdata';
import { useSessions } from '../stores/sessions';
import { useSelection } from '../stores/selection';
import { useMode } from '../stores/mode';
import { useGraphStore } from './graphStore';
import { runtimeVisual } from './runtimeGlyphs';

const TEAM_NAME_POOL = [
  'frontend',
  'platform',
  'backend',
  'infra',
  'research',
  'data',
  'mobile',
  'payments',
  'growth',
  'design',
];

function pickTeamName(): string {
  const { categories } = useAppData.getState();
  const used = new Set(categories.filter((c) => c.kind === 'team').map((c) => c.name.toLowerCase()));
  return TEAM_NAME_POOL.find((n) => !used.has(n)) ?? `team-${used.size + 1}`;
}

/** Create the orchestrator category + agent if absent; return its agent id. */
export async function ensureOrchestrator(): Promise<string | null> {
  const app = useAppData.getState();
  const existing = app.categories.find((c) => c.kind === 'orchestrator');
  if (existing) {
    const leadId = existing.agents[0];
    if (leadId) return leadId;
  }
  const category = existing ?? (await app.createCategory({ name: 'Orchestrator', kind: 'orchestrator' }));
  const agent = await useAppData.getState().createAgent({
    categoryId: category.id,
    name: 'Claude',
    role: 'orchestrator',
    teamRole: 'orchestrator',
    runtime: 'claude',
    permissionMode: 'default',
  });
  return agent.id;
}

export interface SpawnTeamInput {
  runtime: RuntimeId;
  name?: string;
  workerCount?: number;
}

/** Spawn a full team: orchestrator (if needed) + lead + N workers. */
export async function spawnTeam(input: SpawnTeamInput): Promise<string> {
  await ensureOrchestrator();
  const app = useAppData.getState();
  const name = input.name?.trim() || pickTeamName();
  const short = runtimeVisual(input.runtime).short;

  const category = await app.createCategory({ name, kind: 'team' });
  await useAppData.getState().createAgent({
    categoryId: category.id,
    name: short,
    role: 'lead',
    teamRole: 'lead',
    runtime: input.runtime,
    permissionMode: 'default',
  });
  const workers = Math.max(0, input.workerCount ?? 2);
  for (let i = 0; i < workers; i += 1) {
    await useAppData.getState().createAgent({
      categoryId: category.id,
      name: short,
      role: 'worker',
      teamRole: 'worker',
      runtime: input.runtime,
      permissionMode: 'default',
    });
  }
  return category.id;
}

/** Add one worker to an existing team (inherits the lead's runtime). */
export async function addWorker(teamId: string): Promise<void> {
  const app = useAppData.getState();
  const category = app.categories.find((c) => c.id === teamId);
  if (!category) return;
  const members = category.agents.map((id) => app.agents[id]).filter(Boolean);
  const lead = members.find((a) => a?.teamRole === 'lead') ?? members[0];
  const runtime: RuntimeId = lead?.runtime ?? 'claude';
  await app.createAgent({
    categoryId: teamId,
    name: runtimeVisual(runtime).short,
    role: 'worker',
    teamRole: 'worker',
    runtime,
    permissionMode: 'default',
  });
}

export async function removeAgent(agentId: string): Promise<void> {
  await useAppData.getState().deleteAgent(agentId);
  useGraphStore.getState().clearBusy(agentId);
}

/** Dissolve a team: drop the category + its agents from config (files kept). */
export async function dissolveTeam(teamId: string): Promise<void> {
  await useAppData.getState().deleteCategory(teamId);
  useGraphStore.getState().setTeamIdle(teamId, false);
  useGraphStore.getState().select(null);
}

export interface DispatchOpts {
  /**
   * Also fan the task out to each worker as its own real pty session. When
   * false (default), only the lead receives work.
   * Each worker session is a PowerShell + a CLI — heavy on Windows — so this
   * is opt-in from the composer and sessions are spawned sequentially.
   */
  toWorkers?: boolean;
  /** Internal grouping key used to cancel a partially queued team dispatch. */
  dispatchId?: string;
}

export interface DispatchResult {
  started: number;
  failed: number;
}

function newDispatchId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `dispatch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Dispatch a task to a team: open a real session for the lead with the task
 * typed in. Workers either get a real session each (opts.toWorkers) or the
 * transient lead→worker hand-off animation.
 */
export async function dispatchTeam(
  teamId: string,
  task: string,
  opts: DispatchOpts = {},
): Promise<DispatchResult> {
  const text = task.trim();
  if (!text) return { started: 0, failed: 0 };
  const app = useAppData.getState();
  const graph = useGraphStore.getState();
  if (graph.idleTeams[teamId]) return { started: 0, failed: 0 };

  const category = app.categories.find((c) => c.id === teamId);
  if (!category) return { started: 0, failed: 0 };
  const members = category.agents.map((id) => app.agents[id]).filter(Boolean) as Agent[];
  const lead = members.find((a) => a.teamRole === 'lead') ?? members[0];
  if (!lead) return { started: 0, failed: 0 };
  const workers = members.filter((a) => a !== lead);
  const dispatchId = opts.dispatchId ?? newDispatchId();
  const result: DispatchResult = { started: 0, failed: 0 };

  // Lead: real session with the task.
  graph.setBusy(lead.id, 'working');
  try {
    await useSessions.getState().createSession(lead.id, text, dispatchId);
    result.started += 1;
  } catch (err) {
    console.error('[ade] dispatch: lead session failed:', err);
    graph.clearBusy(lead.id);
    result.failed += 1;
  }

  if (opts.toWorkers) {
    // Real fan-out: each worker gets its own session with the same task.
    // Sequential — never spawn N ptys at once (Windows ptys are heavy).
    for (const w of workers) {
      graph.setBusy(w.id, 'working');
      try {
        await useSessions.getState().createSession(w.id, text, dispatchId);
        result.started += 1;
      } catch (err) {
        console.error('[ade] dispatch: worker session failed:', err);
        graph.clearBusy(w.id);
        result.failed += 1;
      }
    }
  }
  return result;
}

/** Dispatch a task to a single agent (worker): real session + transient status. */
export async function dispatchAgent(agentId: string, task: string): Promise<DispatchResult> {
  const text = task.trim();
  if (!text) return { started: 0, failed: 0 };
  const graph = useGraphStore.getState();
  graph.setBusy(agentId, 'working');
  try {
    await useSessions.getState().createSession(agentId, text, newDispatchId());
    return { started: 1, failed: 0 };
  } catch (err) {
    console.error('[ade] dispatchAgent failed:', err);
    graph.clearBusy(agentId);
    return { started: 0, failed: 1 };
  }
}

export async function dispatchAll(task: string, opts: DispatchOpts = {}): Promise<DispatchResult> {
  const app = useAppData.getState();
  const graph = useGraphStore.getState();
  const teams = app.categories.filter((c) => c.kind === 'team' && !graph.idleTeams[c.id]);
  const result: DispatchResult = { started: 0, failed: 0 };
  for (const t of teams) {
    const teamResult = await dispatchTeam(t.id, task, { ...opts, dispatchId: newDispatchId() });
    result.started += teamResult.started;
    result.failed += teamResult.failed;
  }
  return result;
}

export async function cancelTeamTasks(teamId: string): Promise<void> {
  const app = useAppData.getState();
  const team = app.categories.find((category) => category.id === teamId);
  if (!team) return;
  await useSessions.getState().cancelTasks(team.agents);
  for (const agentId of team.agents) useGraphStore.getState().clearBusy(agentId);
}

export async function cancelAllTasks(): Promise<void> {
  await useSessions.getState().cancelTasks();
  useGraphStore.setState({ busy: {} });
}

/** Jump to a node's live terminal (Terminals mode), spawning one if needed. */
export async function openTerminal(agentId: string): Promise<void> {
  const sessions = useSessions.getState();
  const has = (sessions.orderByAgent[agentId] ?? []).length > 0;
  if (!has) {
    try {
      await useSessions.getState().createSession(agentId);
    } catch (err) {
      console.error('[ade] openTerminal: session failed:', err);
    }
  }
  useSelection.getState().setSelectedAgent(agentId);
  useMode.getState().setMode('terminals');
}

// A task is done only when its one-shot CLI process exits successfully.
if (typeof window !== 'undefined' && window.ade) {
  window.ade.on('pty:exit', ({ sessionId, exitCode, reason }) => {
    const meta = useSessions.getState().sessions[sessionId];
    if (!meta || meta.kind !== 'task') return;
    if (reason === 'cancelled' || exitCode !== 0) {
      useGraphStore.getState().clearBusy(meta.agentId);
      return;
    }
    useGraphStore.getState().setBusy(meta.agentId, 'done');
    window.setTimeout(() => useGraphStore.getState().clearBusy(meta.agentId), 2600);
  });
}
