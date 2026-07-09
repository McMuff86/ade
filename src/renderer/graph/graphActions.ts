/**
 * Graph-mode actions — the real wiring behind the canvas.
 *
 * Everything routes through the existing stores/IPC: a team is a Category
 * (kind 'team'), a lead/worker is an Agent (teamRole), so leads get their
 * MEMORY.md / USER.md from the normal agent-creation scaffold. Dispatching a
 * task opens a real pty session for the lead and types the task into it.
 */

import type { RuntimeId } from '../../shared/types';
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

/**
 * Dispatch a task to a team: open a real session for the lead with the task
 * typed in, and animate the lead→worker hand-off via transient status.
 */
export async function dispatchTeam(teamId: string, task: string): Promise<void> {
  const text = task.trim();
  if (!text) return;
  const app = useAppData.getState();
  const graph = useGraphStore.getState();
  if (graph.idleTeams[teamId]) return;

  const category = app.categories.find((c) => c.id === teamId);
  if (!category) return;
  const members = category.agents.map((id) => app.agents[id]).filter(Boolean);
  const lead = members.find((a) => a?.teamRole === 'lead') ?? members[0];
  if (!lead) return;
  const workers = members.filter((a) => a && a !== lead);

  // Lead: real session with the task.
  graph.setBusy(lead.id, 'working');
  try {
    await useSessions.getState().createSession(lead.id, text);
  } catch (err) {
    console.error('[ade] dispatch: lead session failed:', err);
  }

  // Workers: simulated hand-off so the report-back flow is visible.
  workers.forEach((w, i) => {
    if (!w) return;
    window.setTimeout(() => useGraphStore.getState().setBusy(w.id, 'working'), 250 + i * 180);
    window.setTimeout(() => useGraphStore.getState().setBusy(w.id, 'done'), 1600 + i * 180);
    window.setTimeout(() => useGraphStore.getState().clearBusy(w.id), 2900 + i * 180);
  });

  // Lead settles to 'done' then clears (its live session keeps it 'running').
  window.setTimeout(() => useGraphStore.getState().setBusy(lead.id, 'done'), 1900);
  window.setTimeout(() => useGraphStore.getState().clearBusy(lead.id), 3200);
}

/** Dispatch a task to a single agent (worker): real session + transient status. */
export async function dispatchAgent(agentId: string, task: string): Promise<void> {
  const text = task.trim();
  if (!text) return;
  const graph = useGraphStore.getState();
  graph.setBusy(agentId, 'working');
  try {
    await useSessions.getState().createSession(agentId, text);
  } catch (err) {
    console.error('[ade] dispatchAgent failed:', err);
  }
  window.setTimeout(() => useGraphStore.getState().setBusy(agentId, 'done'), 1700);
  window.setTimeout(() => useGraphStore.getState().clearBusy(agentId), 3000);
}

export async function dispatchAll(task: string): Promise<void> {
  const app = useAppData.getState();
  const graph = useGraphStore.getState();
  const teams = app.categories.filter((c) => c.kind === 'team' && !graph.idleTeams[c.id]);
  for (const t of teams) {
    await dispatchTeam(t.id, task);
  }
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
