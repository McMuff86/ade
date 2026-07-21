import { createHash } from 'node:crypto';
import { basename, dirname, join, posix, resolve } from 'node:path';
import {
  NATIVE_EXECUTION_BACKEND,
  normalizeExecutionBackendId,
  type ExecutionBackendId,
} from '../../shared/executionBackends';
import {
  DEFAULT_CONFIG,
  DEFAULT_RUN_BUDGET,
  type AdeConfig,
  type Agent,
  type Category,
  type Repository,
  type RunEvent,
  type RunParticipant,
  type WorkspaceBinding,
} from '../../shared/types';
import { hostPathKey } from '../platform';

const LEGACY_RUN_ID = 'legacy-graph-run-v1';

function arrayOrEmpty<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isGitObjectId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40,64}$/.test(value);
}

/** Normalize older config files and import their persisted Graph topology once. */
export function normalizeConfig(
  raw: Partial<AdeConfig>,
  now = Date.now(),
): { config: AdeConfig; migrated: boolean } {
  const categories = arrayOrEmpty(raw.categories);
  const agents = arrayOrEmpty(raw.agents);
  const hadRunSchema = Array.isArray(raw.runs);
  const scopeMigration = migrateRepositoryScopes(
    categories,
    agents,
    arrayOrEmpty(raw.repositories),
    arrayOrEmpty(raw.workspaceBindings),
    now,
  );

  const config: AdeConfig = {
    categories: scopeMigration.categories,
    agents: scopeMigration.agents,
    repositories: scopeMigration.repositories,
    workspaceBindings: scopeMigration.workspaceBindings,
    agentTemplates: arrayOrEmpty(raw.agentTemplates),
    runs: arrayOrEmpty(raw.runs).map((run) => {
      const {
        contextManifestHash,
        verifiedHeadSha,
        verificationTaskId,
        verifiedAt,
        ...legacyRun
      } = run;
      const hasVerificationAttestation = isGitObjectId(verifiedHeadSha)
        && typeof verificationTaskId === 'string'
        && verificationTaskId.trim().length > 0
        && typeof verifiedAt === 'number'
        && Number.isFinite(verifiedAt)
        && verifiedAt > 0;
      return {
        ...legacyRun,
        mode: run.mode ?? 'manual',
        phase: run.phase ?? (run.status === 'running' ? 'working' : run.status),
        budget: { ...DEFAULT_RUN_BUDGET, ...(run.budget ?? {}) },
        ...(isSha256(contextManifestHash) ? { contextManifestHash } : {}),
        ...(hasVerificationAttestation
          ? { verifiedHeadSha, verificationTaskId, verifiedAt }
          : {}),
      };
    }),
    runParticipants: arrayOrEmpty(raw.runParticipants),
    runTasks: arrayOrEmpty(raw.runTasks).map((task) => {
      const { expectedHeadSha, preparedBaseSha, ...legacyTask } = task;
      return {
        ...legacyTask,
        title: task.title ?? task.prompt.slice(0, 80),
        phase: task.phase ?? 'manual',
        managed: task.managed ?? false,
        dependsOn: arrayOrEmpty(task.dependsOn),
        attempt: task.attempt ?? 1,
        ...(isGitObjectId(expectedHeadSha) ? { expectedHeadSha } : {}),
        ...(isGitObjectId(preparedBaseSha) ? { preparedBaseSha } : {}),
      };
    }),
    runEvents: arrayOrEmpty(raw.runEvents),
    runArtifacts: arrayOrEmpty(raw.runArtifacts),
    runTaskResults: arrayOrEmpty(raw.runTaskResults),
    runApprovals: arrayOrEmpty(raw.runApprovals),
    runWorkspaceLeases: arrayOrEmpty(raw.runWorkspaceLeases),
    runPublications: arrayOrEmpty(raw.runPublications),
    runMessages: arrayOrEmpty(raw.runMessages),
    commandLog: arrayOrEmpty(raw.commandLog),
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
    !Array.isArray(raw.runPublications) ||
    !Array.isArray(raw.runMessages) ||
    !Array.isArray(raw.commandLog) ||
    !Array.isArray(raw.repositories) ||
    !Array.isArray(raw.workspaceBindings) ||
    !Array.isArray(raw.agentTemplates) ||
    scopeMigration.migrated ||
    config.runs.some((run, index) => (
      run.mode !== raw.runs?.[index]?.mode ||
      run.phase !== raw.runs?.[index]?.phase ||
      raw.runs?.[index]?.budget === undefined ||
      (raw.runs?.[index]?.contextManifestHash !== undefined &&
        !isSha256(raw.runs[index]!.contextManifestHash)) ||
      ((raw.runs?.[index]?.verifiedHeadSha !== undefined
        || raw.runs?.[index]?.verificationTaskId !== undefined
        || raw.runs?.[index]?.verifiedAt !== undefined) && (
        run.verifiedHeadSha !== raw.runs[index]!.verifiedHeadSha ||
        run.verificationTaskId !== raw.runs[index]!.verificationTaskId ||
        run.verifiedAt !== raw.runs[index]!.verifiedAt
      ))
    )) ||
    config.runTasks.some((task, index) => (
      task.phase !== raw.runTasks?.[index]?.phase ||
      task.title !== raw.runTasks?.[index]?.title ||
      task.managed !== raw.runTasks?.[index]?.managed ||
      raw.runTasks?.[index]?.dependsOn === undefined ||
      task.attempt !== raw.runTasks?.[index]?.attempt ||
      (raw.runTasks?.[index]?.expectedHeadSha !== undefined
        && task.expectedHeadSha !== raw.runTasks[index]!.expectedHeadSha) ||
      (raw.runTasks?.[index]?.preparedBaseSha !== undefined
        && task.preparedBaseSha !== raw.runTasks[index]!.preparedBaseSha)
    ));

  if (!hadRunSchema) {
    const legacyCategories = categories.filter(
      (category) => category.kind === 'orchestrator' || category.kind === 'team',
    );
    if (legacyCategories.length > 0) {
      const participants = importLegacyParticipants(legacyCategories, config.agents, now);
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
          seq: 0,
        },
        ...participants.map((participant, index): RunEvent => ({
          id: `${LEGACY_RUN_ID}:participant:${index}`,
          runId: LEGACY_RUN_ID,
          participantId: participant.id,
          type: 'participant.added',
          createdAt: now + index + 1,
          seq: 0,
        })),
      ];
      config.runEvents.push(...events);
      migrated = true;
    }
  }

  if (assignJournalSequence(config)) migrated = true;

  return { config, migrated };
}

/**
 * One-time seq backfill: events and messages written before the journal
 * cursor existed receive globally monotonic seq values in createdAt order,
 * starting after the highest seq already present. Returns true when any
 * record was renumbered.
 */
function assignJournalSequence(config: AdeConfig): boolean {
  const hasSeq = (record: { seq?: unknown }): boolean =>
    typeof record.seq === 'number' && Number.isFinite(record.seq) && record.seq > 0;
  let maxSeq = 0;
  for (const record of [...config.runEvents, ...config.runMessages]) {
    if (hasSeq(record) && record.seq > maxSeq) maxSeq = record.seq;
  }
  const unsequenced: Array<{ createdAt: number; seq: number }> = [
    ...config.runEvents.filter((event) => !hasSeq(event)),
    ...config.runMessages.filter((message) => !hasSeq(message)),
  ];
  if (unsequenced.length === 0) return false;
  unsequenced.sort((a, b) => a.createdAt - b.createdAt);
  for (const record of unsequenced) {
    maxSeq += 1;
    record.seq = maxSeq;
  }
  return true;
}

interface RepositoryScopeMigration {
  categories: Category[];
  agents: Agent[];
  repositories: Repository[];
  workspaceBindings: WorkspaceBinding[];
  migrated: boolean;
}

/** Convert category-owned repo paths into first-class, deterministic records. */
function migrateRepositoryScopes(
  sourceCategories: Category[],
  sourceAgents: Agent[],
  sourceRepositories: Repository[],
  sourceBindings: WorkspaceBinding[],
  now: number,
): RepositoryScopeMigration {
  let categories = sourceCategories;
  let agents = sourceAgents;
  const repositories = sourceRepositories.map((repository) => ({
    ...repository,
    executionBackend: normalizeExecutionBackendId(repository.executionBackend),
  }));
  const repositoryBackend = new Map(repositories.map((repository) => [
    repository.id,
    repository.executionBackend,
  ]));
  const workspaceBindings = sourceBindings.map((binding) => ({
    ...binding,
    executionBackend: repositoryBackend.get(binding.repositoryId)
      ?? normalizeExecutionBackendId(binding.executionBackend),
  }));
  let migrated = repositories.some((repository, index) => (
    repository.executionBackend !== sourceRepositories[index]?.executionBackend
  )) || workspaceBindings.some((binding, index) => (
    binding.executionBackend !== sourceBindings[index]?.executionBackend
  ));

  const repositoryByPath = new Map<string, Repository>();
  for (const repository of repositories) {
    repositoryByPath.set(pathKey(repository.rootPath, repository.executionBackend), repository);
    repositoryByPath.set(pathKey(repository.commonGitDir, repository.executionBackend), repository);
  }

  const categoryUpdates = new Map<string, Category>();
  const agentUpdates = new Map<string, Agent>();
  const agentById = new Map(sourceAgents.map((agent) => [agent.id, agent]));

  sourceCategories.forEach((category, categoryIndex) => {
    if (!category.repoPath) return;
    const key = pathKey(category.repoPath, NATIVE_EXECUTION_BACKEND);
    let repository = category.defaultRepositoryId
      ? repositories.find((candidate) => candidate.id === category.defaultRepositoryId)
      : repositoryByPath.get(key);
    if (!repository) {
      repository = {
        id: deterministicId('repository', key),
        name: basename(resolve(category.repoPath)) || category.name,
        rootPath: resolve(category.repoPath),
        commonGitDir: resolve(category.repoPath),
        executionBackend: NATIVE_EXECUTION_BACKEND,
        verified: false,
        createdAt: now + categoryIndex,
      };
      repositories.push(repository);
      repositoryByPath.set(key, repository);
      migrated = true;
    }
    if (category.defaultRepositoryId !== repository.id) {
      categoryUpdates.set(category.id, { ...category, defaultRepositoryId: repository.id });
      migrated = true;
    }

    for (const agentId of category.agents) {
      const agent = agentById.get(agentId);
      if (!agent) continue;
      // Presence of homeWorkspaceDir is the one-time migration marker. A Goal
      // 5 user may intentionally clear/change a category-suggested default;
      // subsequent startups must never overwrite that choice or fabricate a
      // legacy binding from the portable home.
      const isLegacyAgent = !agent.homeWorkspaceDir;
      if (!isLegacyAgent) continue;
      const homeWorkspaceDir = agent.homeWorkspaceDir ?? join(dirname(agent.memoryDir), 'workspace');
      agentUpdates.set(agent.id, {
        ...agent,
        defaultRepositoryId: agent.defaultRepositoryId ?? repository.id,
        homeWorkspaceDir,
      });
      migrated = true;
      if (!workspaceBindings.some(
        (binding) => binding.agentId === agent.id && binding.repositoryId === repository!.id,
      )) {
        workspaceBindings.push({
          id: deterministicId('binding', `${agent.id}:${repository.id}`),
          agentId: agent.id,
          repositoryId: repository.id,
          workspaceDir: agent.workspaceDir,
          branch: '',
          executionBackend: repository.executionBackend,
          status: 'legacy-unverified',
          createdAt: now + workspaceBindings.length,
          lastUsedAt: now + workspaceBindings.length,
        });
        migrated = true;
      }
    }
  });

  if (categoryUpdates.size > 0) {
    categories = sourceCategories.map((category) => categoryUpdates.get(category.id) ?? category);
  }
  if (agentUpdates.size > 0) {
    agents = sourceAgents.map((agent) => agentUpdates.get(agent.id) ?? agent);
  }

  return { categories, agents, repositories, workspaceBindings, migrated };
}

function pathKey(path: string, backend: ExecutionBackendId): string {
  if (backend === NATIVE_EXECUTION_BACKEND) return `${backend}\0${hostPathKey(path)}`;
  const normalized = posix.normalize(path.replace(/\\/g, '/'));
  return `${backend}\0${normalized === '/' ? normalized : normalized.replace(/\/+$/, '')}`;
}

function deterministicId(kind: string, value: string): string {
  return `${kind}-${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;
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
