/**
 * Read-only Overview projection. Built from the catalog, bindings, run
 * journal and live PTY list. No host paths, prompts or diagnostics.
 */

import { NATIVE_EXECUTION_BACKEND, type ExecutionBackendId } from '../../shared/executionBackends';
import { LAUNCH_PROFILES } from '../../shared/runtimes';
import type {
  AdeConfig,
  OverviewAgentRow,
  OverviewProjectCard,
  OverviewSnapshot,
  OverviewUsageRollup,
  OverviewWorkRow,
  Run,
  SessionBookend,
  SessionMeta,
} from '../../shared/types';
import { bookendActivityAt } from './sessionBookends';

export const OVERVIEW_WORK_LIMIT = 20;
const NAMED_BOUND_AGENTS = 3;

export function emptyUsageRollup(): OverviewUsageRollup {
  return {
    reportedInputTokens: 0,
    reportedOutputTokens: 0,
    reportedCostUsd: 0,
    tasksWithTokens: 0,
    tasksWithoutTokens: 0,
    tasksWithCost: 0,
    tasksWithoutCost: 0,
  };
}

export function addTaskUsage(
  rollup: OverviewUsageRollup,
  usage: { inputTokens: number | null; outputTokens: number | null; costUsd: number | null },
): void {
  const hasTokens = usage.inputTokens !== null || usage.outputTokens !== null;
  if (hasTokens) {
    rollup.tasksWithTokens += 1;
    rollup.reportedInputTokens += usage.inputTokens ?? 0;
    rollup.reportedOutputTokens += usage.outputTokens ?? 0;
  } else {
    rollup.tasksWithoutTokens += 1;
  }
  if (usage.costUsd === null) rollup.tasksWithoutCost += 1;
  else {
    rollup.tasksWithCost += 1;
    rollup.reportedCostUsd += usage.costUsd;
  }
}

export function heroTokens(rollup: OverviewUsageRollup): number | null {
  if (rollup.tasksWithTokens === 0) return null;
  return rollup.reportedInputTokens + rollup.reportedOutputTokens;
}

export function backendLabel(backend: ExecutionBackendId): string {
  if (backend === NATIVE_EXECUTION_BACKEND) return 'native';
  return `WSL · ${backend.slice('wsl:'.length)}`;
}

export function isOpenRun(run: Run): boolean {
  return run.status === 'running' || run.phase === 'approval';
}

export function projectOverview(
  config: AdeConfig,
  sessions: readonly SessionMeta[],
  now = Date.now(),
): OverviewSnapshot {
  const liveByAgent = new Map<string, number>();
  let liveSessions = 0;
  for (const session of sessions) {
    if (session.status !== 'running') continue;
    liveSessions += 1;
    liveByAgent.set(session.agentId, (liveByAgent.get(session.agentId) ?? 0) + 1);
  }

  const repoName = new Map(config.repositories.map((repository) => [repository.id, repository.name]));
  const agentName = new Map(config.agents.map((agent) => [agent.id, agent.name]));

  const usageByRun = new Map<string, OverviewUsageRollup>();
  const totals = emptyUsageRollup();
  for (const result of config.runTaskResults) {
    const rollup = usageByRun.get(result.runId) ?? emptyUsageRollup();
    addTaskUsage(rollup, result.usage);
    usageByRun.set(result.runId, rollup);
    addTaskUsage(totals, result.usage);
  }

  const participantsByRun = new Map<string, typeof config.runParticipants>();
  for (const participant of config.runParticipants) {
    const list = participantsByRun.get(participant.runId) ?? [];
    list.push(participant);
    participantsByRun.set(participant.runId, list);
  }

  const lastRunByAgent = new Map<string, Run>();
  const lastRunByRepo = new Map<string, Run>();
  for (const run of config.runs) {
    const participants = participantsByRun.get(run.id) ?? [];
    for (const participant of participants) {
      const current = lastRunByAgent.get(participant.agentId);
      if (!current || run.updatedAt > current.updatedAt) lastRunByAgent.set(participant.agentId, run);
    }
    if (run.repositoryId) {
      const current = lastRunByRepo.get(run.repositoryId);
      if (!current || run.updatedAt > current.updatedAt) lastRunByRepo.set(run.repositoryId, run);
    }
  }

  const lastBindingByAgent = new Map<string, number>();
  for (const binding of config.workspaceBindings) {
    const current = lastBindingByAgent.get(binding.agentId);
    if (current === undefined || binding.lastUsedAt > current) {
      lastBindingByAgent.set(binding.agentId, binding.lastUsedAt);
    }
  }

  const lastBookendByAgent = new Map<string, number>();
  const lastBookendByRepo = new Map<string, number>();
  for (const bookend of config.sessionBookends) {
    const at = bookendActivityAt(bookend);
    const current = lastBookendByAgent.get(bookend.agentId);
    if (current === undefined || at > current) lastBookendByAgent.set(bookend.agentId, at);
    if (bookend.repositoryId) {
      const repoAt = lastBookendByRepo.get(bookend.repositoryId);
      if (repoAt === undefined || at > repoAt) lastBookendByRepo.set(bookend.repositoryId, at);
    }
  }

  const seenAgents = new Set<string>();
  const agents: OverviewAgentRow[] = [];
  for (const category of config.categories) {
    for (const id of category.agents) {
      if (seenAgents.has(id)) continue;
      const agent = config.agents.find((candidate) => candidate.id === id);
      if (!agent) continue;
      seenAgents.add(id);
      agents.push(toAgentRow(
        agent, liveByAgent, lastRunByAgent, lastBindingByAgent, lastBookendByAgent, repoName,
      ));
    }
  }
  for (const agent of config.agents) {
    if (seenAgents.has(agent.id)) continue;
    agents.push(toAgentRow(
      agent, liveByAgent, lastRunByAgent, lastBindingByAgent, lastBookendByAgent, repoName,
    ));
  }

  const projects: OverviewProjectCard[] = config.repositories.map((repository) => {
    const bindings = config.workspaceBindings.filter((binding) => binding.repositoryId === repository.id);
    const names = [...new Set(bindings.map((binding) => agentName.get(binding.agentId)).filter(
      (name): name is string => Boolean(name),
    ))];
    const lastRun = lastRunByRepo.get(repository.id);
    let lastActivityAt: number | null = lastRun?.updatedAt ?? null;
    for (const binding of bindings) {
      if (lastActivityAt === null || binding.lastUsedAt > lastActivityAt) lastActivityAt = binding.lastUsedAt;
    }
    const lastBookendAt = lastBookendByRepo.get(repository.id);
    if (lastBookendAt !== undefined && (lastActivityAt === null || lastBookendAt > lastActivityAt)) {
      lastActivityAt = lastBookendAt;
    }
    return {
      id: repository.id,
      name: repository.name,
      backendLabel: backendLabel(repository.executionBackend),
      boundAgentCount: names.length,
      boundAgentNames: names.slice(0, NAMED_BOUND_AGENTS),
      lastActivityAt,
      ...(lastRun ? {
        lastRunId: lastRun.id,
        lastRunName: lastRun.name,
        lastRunStatus: lastRun.status,
        lastRunPhase: lastRun.phase,
      } : {}),
    };
  });

  const work: OverviewWorkRow[] = [
    ...config.runs.map((run): OverviewWorkRow => {
      const participants = participantsByRun.get(run.id) ?? [];
      return {
        kind: 'run',
        detached: !!run.repositoryId && !repoName.has(run.repositoryId) || participants.some((participant) => !agentName.has(participant.agentId)),
        id: run.id,
        name: run.name,
        updatedAt: run.updatedAt,
        status: run.status,
        phase: run.phase,
        repositoryName: run.repositoryId ? (repoName.get(run.repositoryId) ?? 'Entferntes Projekt') : null,
        participantNames: participants.map((participant) => participant.agentName),
        usage: usageByRun.get(run.id) ?? emptyUsageRollup(),
      };
    }),
    ...config.sessionBookends
      .filter((bookend): bookend is SessionBookend & { endedAt: number } => bookend.endedAt !== null)
      .map((bookend): OverviewWorkRow => ({
        kind: 'session',
        detached: !agentName.has(bookend.agentId) || !!bookend.repositoryId && !repoName.has(bookend.repositoryId),
        agentAvailable: agentName.has(bookend.agentId),
        id: bookend.id,
        name: bookend.agentName,
        updatedAt: bookend.endedAt,
        agentId: bookend.agentId,
        exitReason: bookend.exitReason ?? 'exit',
        repositoryName: bookend.repositoryName,
        participantNames: [bookend.agentName],
        usage: emptyUsageRollup(),
      })),
  ]
    .sort((left, right) => Number(right.kind === 'run' && (right.status === 'running' || right.phase === 'approval'))
      - Number(left.kind === 'run' && (left.status === 'running' || left.phase === 'approval')) || right.updatedAt - left.updatedAt)
    .slice(0, OVERVIEW_WORK_LIMIT);

  return {
    generatedAt: now,
    hero: {
      liveSessions,
      openRuns: config.runs.filter(isOpenRun).length,
      tokens: heroTokens(totals),
      usage: totals,
    },
    agents,
    projects,
    work,
  };
}

function toAgentRow(
  agent: AdeConfig['agents'][number],
  liveByAgent: Map<string, number>,
  lastRunByAgent: Map<string, Run>,
  lastBindingByAgent: Map<string, number>,
  lastBookendByAgent: Map<string, number>,
  repoName: Map<string, string>,
): OverviewAgentRow {
  const lastRun = lastRunByAgent.get(agent.id);
  const lastBindingAt = lastBindingByAgent.get(agent.id);
  const lastBookendAt = lastBookendByAgent.get(agent.id);
  let lastActivityAt: number | null = lastRun?.updatedAt ?? null;
  if (lastBindingAt !== undefined && (lastActivityAt === null || lastBindingAt > lastActivityAt)) {
    lastActivityAt = lastBindingAt;
  }
  if (lastBookendAt !== undefined && (lastActivityAt === null || lastBookendAt > lastActivityAt)) {
    lastActivityAt = lastBookendAt;
  }
  return {
    id: agent.id,
    name: agent.name,
    ...(agent.photo ? { photo: agent.photo } : {}),
    runtime: agent.runtime,
    runtimeLabel: LAUNCH_PROFILES[agent.runtime].label,
    hasDashboard: !!(agent.dashboardUrl || agent.dashboardCommand),
    liveSessions: liveByAgent.get(agent.id) ?? 0,
    defaultRepositoryName: agent.defaultRepositoryId
      ? (repoName.get(agent.defaultRepositoryId) ?? null)
      : null,
    lastActivityAt,
    ...(lastRun ? {
      lastRunId: lastRun.id,
      lastRunName: lastRun.name,
      lastRunAt: lastRun.updatedAt,
    } : {}),
  };
}
