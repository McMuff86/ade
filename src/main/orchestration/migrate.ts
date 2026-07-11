import {
  DEFAULT_CONFIG,
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
    runs: arrayOrEmpty(raw.runs),
    runParticipants: arrayOrEmpty(raw.runParticipants),
    runTasks: arrayOrEmpty(raw.runTasks),
    runEvents: arrayOrEmpty(raw.runEvents),
    runArtifacts: arrayOrEmpty(raw.runArtifacts),
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
    !Array.isArray(raw.runArtifacts);

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
