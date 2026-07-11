import {
  DEFAULT_CONFIG,
  DEFAULT_RUN_BUDGET,
  type AdeConfig,
  type Agent,
  type RunEvent,
  type RunParticipant,
} from '../../shared/types';

const LEGACY_RUN_ID = 'legacy-graph-run-v1';

function arrayOrEmpty<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

/** Normalize older config files and import their persisted Graph topology once. */
export function normalizeConfig(
  raw: Partial<AdeConfig>,
  now = Date.now(),
): { config: AdeConfig; migrated: boolean } {
  const categories = arrayOrEmpty(raw.categories);
  const agents = arrayOrEmpty(raw.agents);
  const hadRunSchema = Array.isArray(raw.runs);

  const config: AdeConfig = {
    categories,
    agents,
    runs: arrayOrEmpty(raw.runs).map((run) => ({
      ...run,
      mode: run.mode ?? 'manual',
      phase: run.phase ?? (run.status === 'running' ? 'working' : run.status),
      budget: { ...DEFAULT_RUN_BUDGET, ...(run.budget ?? {}) },
    })),
    runParticipants: arrayOrEmpty(raw.runParticipants),
    runTasks: arrayOrEmpty(raw.runTasks).map((task) => ({
      ...task,
      title: task.title ?? task.prompt.slice(0, 80),
      phase: task.phase ?? 'manual',
      managed: task.managed ?? false,
      dependsOn: arrayOrEmpty(task.dependsOn),
      attempt: task.attempt ?? 1,
    })),
    runEvents: arrayOrEmpty(raw.runEvents),
    runArtifacts: arrayOrEmpty(raw.runArtifacts),
    runTaskResults: arrayOrEmpty(raw.runTaskResults),
    runApprovals: arrayOrEmpty(raw.runApprovals),
    runWorkspaceLeases: arrayOrEmpty(raw.runWorkspaceLeases),
    runMessages: arrayOrEmpty(raw.runMessages),
    settings: {
      ...DEFAULT_CONFIG.settings,
      ...(raw.settings ?? {}),
      memory: {
        ...DEFAULT_CONFIG.settings.memory!,
        ...(raw.settings?.memory ?? {}),
      },
    },
  };

  let migrated =
    !hadRunSchema ||
    !Array.isArray(raw.runParticipants) ||
    !Array.isArray(raw.runTasks) ||
    !Array.isArray(raw.runEvents) ||
    !Array.isArray(raw.runArtifacts) ||
    !Array.isArray(raw.runTaskResults) ||
    !Array.isArray(raw.runApprovals) ||
    !Array.isArray(raw.runWorkspaceLeases) ||
    !Array.isArray(raw.runMessages) ||
    config.runs.some((run, index) => (
      run.mode !== raw.runs?.[index]?.mode ||
      run.phase !== raw.runs?.[index]?.phase ||
      raw.runs?.[index]?.budget === undefined
    )) ||
    config.runTasks.some((task, index) => (
      task.phase !== raw.runTasks?.[index]?.phase ||
      task.title !== raw.runTasks?.[index]?.title ||
      task.managed !== raw.runTasks?.[index]?.managed ||
      raw.runTasks?.[index]?.dependsOn === undefined ||
      task.attempt !== raw.runTasks?.[index]?.attempt
    ));

  if (!hadRunSchema) {
    const legacyCategories = categories.filter(
      (category) => category.kind === 'orchestrator' || category.kind === 'team',
    );
    if (legacyCategories.length > 0) {
      const participants = importLegacyParticipants(legacyCategories, agents, now);
      config.runs.push({
        id: LEGACY_RUN_ID,
        name: 'Migrated Graph workspace',
        goal: 'Imported from the pre-run Graph topology.',
        status: 'draft',
        mode: 'manual',
        phase: 'draft',
        budget: { ...DEFAULT_RUN_BUDGET },
        source: 'legacy-graph',
        createdAt: now,
        updatedAt: now,
      });
      config.runParticipants.push(...participants);
      const events: RunEvent[] = [
        {
          id: `${LEGACY_RUN_ID}:created`,
          runId: LEGACY_RUN_ID,
          type: 'run.created',
          createdAt: now,
          data: { source: 'legacy-graph' },
        },
        ...participants.map((participant, index): RunEvent => ({
          id: `${LEGACY_RUN_ID}:participant:${index}`,
          runId: LEGACY_RUN_ID,
          participantId: participant.id,
          type: 'participant.added',
          createdAt: now + index + 1,
        })),
      ];
      config.runEvents.push(...events);
      migrated = true;
    }
  }

  return { config, migrated };
}

function importLegacyParticipants(
  categories: AdeConfig['categories'],
  agents: Agent[],
  now: number,
): RunParticipant[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const participants: RunParticipant[] = [];

  for (const category of categories) {
    const members = category.agents.map((id) => byId.get(id)).filter(Boolean) as Agent[];
    const lead = category.kind === 'team'
      ? (members.find((agent) => agent.teamRole === 'lead') ?? members[0])
      : undefined;
    const orchestrator = category.kind === 'orchestrator'
      ? (members.find((agent) => agent.teamRole === 'orchestrator') ?? members[0])
      : undefined;

    for (const agent of members) {
      const role = category.kind === 'orchestrator'
        ? (agent === orchestrator ? 'orchestrator' : 'worker')
        : (agent === lead ? 'lead' : 'worker');
      participants.push({
        id: `${LEGACY_RUN_ID}:participant:${agent.id}`,
        runId: LEGACY_RUN_ID,
        agentId: agent.id,
        agentName: agent.name,
        runtime: agent.runtime,
        role,
        teamId: category.kind === 'team' ? category.id : undefined,
        teamName: category.kind === 'team' ? category.name : undefined,
        createdAt: now,
      });
    }
  }
  return participants;
}
