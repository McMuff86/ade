/**
 * Typed atomic JSON config store.
 * Location: app.getPath('userData')/ade/config.json
 *
 * Writes are atomic and durable: write a temp file in the same directory,
 * fsync it, then rename.
 *
 * Loading never destroys an existing file. Only a missing file seeds defaults.
 * Anything else — an unreadable/locked file, invalid JSON, or a record that
 * normalization refuses — is preserved under `corrupt/` before defaults are
 * seeded, because that file is the only copy of the agent catalog, the
 * repository bindings, the run journal and the publication audit. When even
 * preservation fails, the store turns read-only and refuses every write
 * instead of overwriting the original.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, readdirSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { DEFAULT_CONFIG, type AdeConfig, type ConfigLoadFailure } from '../../shared/types';
import { isExecutionBackendId } from '../../shared/executionBackends';
import { CODEX_MODEL_PATTERN, OLLAMA_MODEL_PATTERN } from '../../shared/runtimes';
import { normalizeConfig } from '../orchestration/migrate';

/** Model ids reach a shell command line through resolveLaunchCommand, so a
 *  config that carries an unsafe one must never be persisted — not from the
 *  IPC boundary, not from a workspace-bundle import, not from a hand-edited
 *  file. boundedString already rejected the empty string above. */
function modelId(value: unknown, pattern: RegExp, label: string): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || !pattern.test(value.trim())) {
    throw new Error(`${label} is not a shell-safe model id.`);
  }
}

/** Lazily binds Electron so tests can construct a store with an explicit path. */
function defaultConfigPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron');
  return join(app.getPath('userData'), 'ade', 'config.json');
}

/** Node's fs errors embed the absolute path; keep it out of stored detail. */
function describeError(error: unknown, filePath: string): string {
  const raw = error instanceof Error ? (error.message || error.name) : String(error);
  return raw
    .split(filePath).join('<config.json>')
    .split(dirname(filePath)).join('<configDir>')
    .slice(0, 300);
}

interface LoadOutcome {
  config: AdeConfig;
  failure: ConfigLoadFailure | null;
  /** Whether the loaded state still has to reach disk (seed or migration). */
  persist: boolean;
}

const ROOT_KEYS = [
  'categories', 'agents', 'repositories', 'workspaceBindings', 'agentTemplates', 'runs',
  'runParticipants', 'runTasks', 'runEvents', 'runArtifacts', 'runTaskResults', 'runApprovals',
  'runWorkspaceLeases', 'runPublications', 'runMessages', 'commandLog', 'settings',
] as const;
const RUNTIMES = new Set(['claude', 'codex', 'opencode', 'grok', 'gemini', 'ollama', 'shell', 'custom']);
const PERMISSIONS = new Set(['default', 'accept-edits', 'bypass']);
const REASONING = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const REPLACE_IMMUTABLE_KEYS = [
  'runs', 'runParticipants', 'runTasks', 'runEvents', 'runArtifacts', 'runTaskResults',
  'runApprovals', 'runWorkspaceLeases', 'runPublications', 'runMessages', 'commandLog',
] as const;

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(`${label} contains unknown fields.`);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, label: string, optional = false): void {
  if (optional && value === undefined) return;
  if (typeof value !== 'string' || value.length === 0 || value.length > 4_096 || /[\0-\x1f\x7f]/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

export function validateCompleteConfig(config: AdeConfig): void {
  const root = object(config, 'config');
  exactKeys(root, ROOT_KEYS, 'config');
  for (const key of ROOT_KEYS.filter((key) => key !== 'settings')) {
    if (!Array.isArray(root[key])) throw new Error(`config.${key} must be an array.`);
  }
  const settings = object(root.settings, 'config.settings');
  exactKeys(settings, ['theme', 'memory', 'worktreeBaseDir'], 'config.settings');
  if (settings.theme !== 'dark' && settings.theme !== 'light') throw new Error('config.settings.theme is invalid.');
  boundedString(settings.worktreeBaseDir, 'config.settings.worktreeBaseDir', true);
  const memory = object(settings.memory, 'config.settings.memory');
  exactKeys(memory, ['enabled', 'userProfileEnabled', 'memoryCharLimit', 'userCharLimit'], 'config.settings.memory');
  if (typeof memory.enabled !== 'boolean' || typeof memory.userProfileEnabled !== 'boolean'
      || !Number.isInteger(memory.memoryCharLimit) || !Number.isInteger(memory.userCharLimit)
      || (memory.memoryCharLimit as number) < 0 || (memory.userCharLimit as number) < 0) {
    throw new Error('config.settings.memory is invalid.');
  }

  const ids = (items: unknown[], label: string): Set<string> => {
    const result = new Set<string>();
    for (let index = 0; index < items.length; index += 1) {
      const raw = items[index];
      const item = object(raw, `${label}[${index}]`);
      boundedString(item.id, `${label}[${index}].id`);
      const id = item.id as string;
      if (result.has(id)) throw new Error(`${label} contains duplicate ids.`);
      result.add(id);
    }
    return result;
  };
  const categoryIds = ids(config.categories, 'config.categories');
  const agentIds = ids(config.agents, 'config.agents');
  const repositoryIds = ids(config.repositories, 'config.repositories');
  const bindingIds = ids(config.workspaceBindings, 'config.workspaceBindings');
  ids(config.agentTemplates, 'config.agentTemplates');

  for (const category of config.categories) {
    exactKeys(category as unknown as Record<string, unknown>,
      ['id', 'name', 'photo', 'repoPath', 'defaultRepositoryId', 'agents', 'kind'], 'category');
    boundedString(category.name, 'category.name');
    for (const [field, value] of [['photo', category.photo], ['repoPath', category.repoPath]] as const) {
      boundedString(value, `category.${field}`, true);
    }
    if (category.kind !== undefined && !['plain', 'orchestrator', 'team'].includes(category.kind)) {
      throw new Error('Category kind is invalid.');
    }
    if (!Array.isArray(category.agents) || category.agents.some((id) => !agentIds.has(id))) {
      throw new Error('Category agent relationships are invalid.');
    }
    if (new Set(category.agents).size !== category.agents.length) throw new Error('Category agent membership is duplicated.');
    for (const agentId of category.agents) {
      if (config.agents.find((agent) => agent.id === agentId)?.categoryId !== category.id) {
        throw new Error('Category membership is not reciprocal.');
      }
    }
    if (category.defaultRepositoryId !== undefined && !repositoryIds.has(category.defaultRepositoryId)) {
      throw new Error('Category repository relationship is invalid.');
    }
  }
  for (const agent of config.agents) {
    exactKeys(agent as unknown as Record<string, unknown>, [
      'id', 'categoryId', 'name', 'role', 'photo', 'runtime', 'permissionMode', 'customCommand',
      'ollamaModel', 'codexModel', 'codexReasoningEffort', 'workspaceDir', 'homeWorkspaceDir',
      'homeExecutionBackend', 'defaultRepositoryId', 'memoryDir', 'teamRole', 'dashboardUrl',
      'dashboardCommand', 'dashboardTarget',
    ], 'agent');
    boundedString(agent.name, 'agent.name');
    boundedString(agent.workspaceDir, 'agent.workspaceDir');
    boundedString(agent.memoryDir, 'agent.memoryDir');
    for (const [field, value] of [
      ['role', agent.role], ['photo', agent.photo], ['customCommand', agent.customCommand],
      ['ollamaModel', agent.ollamaModel], ['codexModel', agent.codexModel],
      ['homeWorkspaceDir', agent.homeWorkspaceDir], ['dashboardUrl', agent.dashboardUrl],
      ['dashboardCommand', agent.dashboardCommand],
    ] as const) boundedString(value, `agent.${field}`, true);
    modelId(agent.ollamaModel, OLLAMA_MODEL_PATTERN, 'agent.ollamaModel');
    modelId(agent.codexModel, CODEX_MODEL_PATTERN, 'agent.codexModel');
    if (!categoryIds.has(agent.categoryId) || !RUNTIMES.has(agent.runtime) || !PERMISSIONS.has(agent.permissionMode)
        || (agent.homeExecutionBackend !== undefined && !isExecutionBackendId(agent.homeExecutionBackend))
        || (agent.defaultRepositoryId !== undefined && !repositoryIds.has(agent.defaultRepositoryId))
        || (agent.codexReasoningEffort !== undefined && !REASONING.has(agent.codexReasoningEffort))
        || (agent.teamRole !== undefined && !['orchestrator', 'lead', 'worker'].includes(agent.teamRole))
        || (agent.dashboardTarget !== undefined && !['window', 'external'].includes(agent.dashboardTarget))) {
      throw new Error('Agent identity or relationships are invalid.');
    }
    const owner = config.categories.find((category) => category.id === agent.categoryId)!;
    if (!owner.agents.includes(agent.id)) throw new Error('Agent/category membership is not reciprocal.');
  }
  for (const repository of config.repositories) {
    exactKeys(repository as unknown as Record<string, unknown>,
      ['id', 'name', 'rootPath', 'commonGitDir', 'executionBackend', 'verified', 'createdAt'], 'repository');
    boundedString(repository.name, 'repository.name');
    boundedString(repository.rootPath, 'repository.rootPath');
    boundedString(repository.commonGitDir, 'repository.commonGitDir');
    if (!isExecutionBackendId(repository.executionBackend) || typeof repository.verified !== 'boolean'
        || !Number.isFinite(repository.createdAt)) throw new Error('Repository is invalid.');
  }
  for (const binding of config.workspaceBindings) {
    exactKeys(binding as unknown as Record<string, unknown>, [
      'id', 'agentId', 'repositoryId', 'workspaceDir', 'branch', 'executionBackend',
      'status', 'createdAt', 'lastUsedAt',
    ], 'workspace binding');
    boundedString(binding.id, 'workspaceBinding.id');
    boundedString(binding.workspaceDir, 'workspaceBinding.workspaceDir');
    boundedString(binding.branch, 'workspaceBinding.branch');
    if (!agentIds.has(binding.agentId) || !repositoryIds.has(binding.repositoryId)
        || !isExecutionBackendId(binding.executionBackend)
        || !['ready', 'legacy-unverified', 'invalid'].includes(binding.status)
        || !Number.isFinite(binding.createdAt) || !Number.isFinite(binding.lastUsedAt)) {
      throw new Error('Workspace binding relationship is invalid.');
    }
    const repository = config.repositories.find((item) => item.id === binding.repositoryId)!;
    if (binding.executionBackend !== repository.executionBackend) throw new Error('Workspace binding backend is invalid.');
  }
  for (const template of config.agentTemplates) {
    exactKeys(template as unknown as Record<string, unknown>, [
      'id', 'name', 'role', 'photo', 'runtime', 'permissionMode', 'customCommand', 'ollamaModel',
      'codexModel', 'codexReasoningEffort', 'memorySeed', 'createdAt', 'updatedAt',
    ], 'agent template');
    boundedString(template.name, 'agentTemplate.name');
    for (const [field, value] of [
      ['role', template.role], ['photo', template.photo], ['customCommand', template.customCommand],
      ['ollamaModel', template.ollamaModel], ['codexModel', template.codexModel],
    ] as const) boundedString(value, `agentTemplate.${field}`, true);
    modelId(template.ollamaModel, OLLAMA_MODEL_PATTERN, 'agentTemplate.ollamaModel');
    modelId(template.codexModel, CODEX_MODEL_PATTERN, 'agentTemplate.codexModel');
    if (!RUNTIMES.has(template.runtime) || !PERMISSIONS.has(template.permissionMode)
        || (template.codexReasoningEffort !== undefined && !REASONING.has(template.codexReasoningEffort))
        || typeof template.memorySeed?.memory !== 'string' || typeof template.memorySeed?.user !== 'string') {
      throw new Error('Agent template is invalid.');
    }
  }

  const validateJson = (value: unknown, label: string, depth = 0): void => {
    if (depth > 8) throw new Error(`${label} is too deeply nested.`);
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number.`);
      return;
    }
    if (typeof value === 'string') {
      if (value.length > 1_048_576 || /\0/.test(value)) throw new Error(`${label} contains an invalid string.`);
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > 100_000) throw new Error(`${label} is too large.`);
      value.forEach((entry, index) => validateJson(entry, `${label}[${index}]`, depth + 1));
      return;
    }
    const record = object(value, label);
    const entries = Object.entries(record);
    if (entries.length > 128) throw new Error(`${label} has too many fields.`);
    for (const [key, entry] of entries) {
      if (key.length === 0 || key.length > 128 || /[\0-\x1f\x7f]/.test(key)) throw new Error(`${label} has an invalid field.`);
      if (entry === undefined) continue;
      validateJson(entry, `${label}.${key}`, depth + 1);
    }
  };
  const schema = (
    values: unknown[],
    label: string,
    allowed: readonly string[],
    required: readonly string[],
    idField = 'id',
  ): Set<string> => {
    if (values.length > 100_000) throw new Error(`${label} is too large.`);
    const result = new Set<string>();
    values.forEach((value, index) => {
      const item = object(value, `${label}[${index}]`);
      exactKeys(item, allowed, `${label}[${index}]`);
      for (const field of required) {
        if (!(field in item) || item[field] === undefined) {
          throw new Error(`${label}[${index}].${field} is required.`);
        }
      }
      boundedString(item[idField], `${label}[${index}].${idField}`);
      if (result.has(item[idField] as string)) throw new Error(`${label} contains duplicate identifiers.`);
      result.add(item[idField] as string);
      validateJson(item, `${label}[${index}]`);
    });
    return result;
  };
  const runIds = schema(config.runs, 'config.runs', [
    'id', 'name', 'goal', 'status', 'mode', 'phase', 'budget', 'createdAt', 'updatedAt', 'source',
    'repositoryId', 'contextManifestHash', 'verifiedHeadSha', 'verificationTaskId', 'verifiedAt', 'pausedTeamIds',
  ], ['id', 'name', 'goal', 'status', 'mode', 'phase', 'budget', 'createdAt', 'updatedAt']);
  const participantIds = schema(config.runParticipants, 'config.runParticipants', [
    'id', 'runId', 'agentId', 'agentName', 'runtime', 'role', 'teamId', 'teamName', 'repositoryId', 'createdAt',
  ], ['id', 'runId', 'agentId', 'agentName', 'runtime', 'role', 'createdAt']);
  const taskIds = schema(config.runTasks, 'config.runTasks', [
    'id', 'runId', 'participantId', 'prompt', 'title', 'phase', 'managed', 'dependsOn', 'attempt', 'status',
    'sessionId', 'repositoryId', 'workspaceBindingId', 'workspaceDir', 'expectedHeadSha', 'preparedBaseSha',
    'createdAt', 'updatedAt', 'startedAt', 'endedAt', 'exitCode', 'error',
  ], ['id', 'runId', 'participantId', 'prompt', 'title', 'phase', 'managed', 'dependsOn', 'attempt', 'status', 'createdAt', 'updatedAt']);
  schema(config.runEvents, 'config.runEvents',
    ['id', 'runId', 'type', 'createdAt', 'taskId', 'participantId', 'data', 'seq'],
    ['id', 'runId', 'type', 'createdAt', 'seq']);
  schema(config.runArtifacts, 'config.runArtifacts',
    ['id', 'runId', 'taskId', 'kind', 'path', 'content', 'repositoryId', 'workspaceBindingId', 'workspaceDir', 'createdAt'],
    ['id', 'runId', 'kind', 'createdAt']);
  schema(config.runTaskResults, 'config.runTaskResults', [
    'id', 'runId', 'taskId', 'participantId', 'adapterId', 'resultPath', 'createdAt', 'version', 'outcome',
    'summary', 'assignments', 'filesChanged', 'tests', 'commitSha', 'risks', 'usage',
  ], ['id', 'runId', 'taskId', 'participantId', 'adapterId', 'resultPath', 'createdAt', 'version', 'outcome',
    'summary', 'assignments', 'filesChanged', 'tests', 'commitSha', 'risks', 'usage']);
  schema(config.runApprovals, 'config.runApprovals',
    ['id', 'runId', 'type', 'status', 'reason', 'requestedAt', 'resolvedAt'],
    ['id', 'runId', 'type', 'status', 'reason', 'requestedAt']);
  schema(config.runWorkspaceLeases, 'config.runWorkspaceLeases', [
    'id', 'runId', 'participantId', 'agentId', 'workspaceDir', 'isRepo', 'branch', 'baseSha', 'commonGitDir',
    'repositoryId', 'workspaceBindingId', 'status', 'acquiredAt', 'releasedAt',
  ], ['id', 'runId', 'participantId', 'agentId', 'workspaceDir', 'isRepo', 'branch', 'baseSha', 'commonGitDir', 'status', 'acquiredAt']);
  schema(config.runPublications, 'config.runPublications', [
    'id', 'runId', 'repositoryId', 'provider', 'providerRepository', 'remoteName', 'baseBranch', 'headBranch',
    'baseSha', 'headSha', 'status', 'createdAt', 'updatedAt', 'prNumber', 'prUrl', 'error',
  ], ['id', 'runId', 'repositoryId', 'provider', 'providerRepository', 'remoteName', 'baseBranch', 'headBranch',
    'baseSha', 'headSha', 'status', 'createdAt', 'updatedAt']);
  schema(config.runMessages, 'config.runMessages', [
    'id', 'runId', 'taskId', 'fromParticipantId', 'toParticipantId', 'kind', 'text', 'createdAt', 'seq',
  ], ['id', 'runId', 'toParticipantId', 'kind', 'text', 'createdAt', 'seq']);
  schema(config.commandLog, 'config.commandLog', ['commandId', 'channel', 'createdAt', 'resultJson'],
    ['commandId', 'channel', 'createdAt', 'resultJson'], 'commandId');

  const text = (value: unknown, label: string, optional = false): void => {
    if (value === undefined && optional) return;
    if (typeof value !== 'string' || value.length > 1_048_576 || /\0/.test(value)) {
      throw new Error(`${label} is invalid.`);
    }
  };
  const number = (value: unknown, label: string, optional = false): void => {
    if (value === undefined && optional) return;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} is invalid.`);
  };
  const enumValue = (value: unknown, allowed: readonly string[], label: string): void => {
    if (typeof value !== 'string' || !allowed.includes(value)) throw new Error(`${label} is invalid.`);
  };
  const stringArray = (value: unknown, label: string, optional = false): void => {
    if (value === undefined && optional) return;
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw new Error(`${label} is invalid.`);
  };
  const RUN_STATUSES = ['draft', 'running', 'completed', 'failed', 'cancelled'];
  const RUN_PHASES = ['draft', 'planning', 'working', 'approval', 'integrating', 'verifying', 'completed', 'failed', 'cancelled'];
  const TASK_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'];
  const TASK_PHASES = ['manual', 'plan', 'work', 'integrate', 'verify'];
  const EVENT_TYPES = [
    'run.created', 'run.started', 'run.phase_changed', 'run.completed', 'run.failed', 'run.cancelled',
    'participant.added', 'task.queued', 'task.started', 'task.completed', 'task.failed', 'task.cancelled',
    'task.result_recorded', 'approval.requested', 'approval.resolved', 'workspace.acquired',
    'workspace.prepared', 'workspace.released', 'message.sent', 'integration.applied',
    'publication.requested', 'publication.completed', 'publication.failed', 'budget.exhausted',
    'artifact.created', 'team.paused', 'team.resumed',
  ];
  for (const run of config.runs) {
    text(run.name, 'run.name'); text(run.goal, 'run.goal');
    enumValue(run.status, RUN_STATUSES, 'run.status'); enumValue(run.mode, ['manual', 'managed'], 'run.mode');
    enumValue(run.phase, RUN_PHASES, 'run.phase'); number(run.createdAt, 'run.createdAt'); number(run.updatedAt, 'run.updatedAt');
    if (run.source !== undefined) enumValue(run.source, ['native', 'legacy-graph'], 'run.source');
    const budget = object(run.budget, 'run.budget');
    exactKeys(budget, ['maxConcurrentTasks', 'maxInputTokens', 'maxOutputTokens', 'maxCostUsd', 'maxApprovals'], 'run.budget');
    number(budget.maxConcurrentTasks, 'run.budget.maxConcurrentTasks'); number(budget.maxApprovals, 'run.budget.maxApprovals');
    for (const field of ['maxInputTokens', 'maxOutputTokens', 'maxCostUsd'] as const) {
      if (budget[field] !== null) {
        number(budget[field], `run.budget.${field}`);
        if ((budget[field] as number) < 0
            || (field !== 'maxCostUsd' && !Number.isSafeInteger(budget[field]))) {
          throw new Error(`run.budget.${field} is invalid.`);
        }
      }
    }
    if (!Number.isSafeInteger(budget.maxConcurrentTasks) || (budget.maxConcurrentTasks as number) < 1
        || !Number.isSafeInteger(budget.maxApprovals) || (budget.maxApprovals as number) < 0) {
      throw new Error('run.budget bounds are invalid.');
    }
    stringArray(run.pausedTeamIds, 'run.pausedTeamIds', true);
    text(run.contextManifestHash, 'run.contextManifestHash', true); text(run.verifiedHeadSha, 'run.verifiedHeadSha', true);
    text(run.verificationTaskId, 'run.verificationTaskId', true); number(run.verifiedAt, 'run.verifiedAt', true);
  }
  for (const participant of config.runParticipants) {
    text(participant.agentId, 'runParticipant.agentId'); text(participant.agentName, 'runParticipant.agentName');
    enumValue(participant.runtime, [...RUNTIMES], 'runParticipant.runtime');
    enumValue(participant.role, ['orchestrator', 'lead', 'worker'], 'runParticipant.role');
    text(participant.teamId, 'runParticipant.teamId', true); text(participant.teamName, 'runParticipant.teamName', true);
    number(participant.createdAt, 'runParticipant.createdAt');
  }
  for (const task of config.runTasks) {
    text(task.prompt, 'runTask.prompt'); text(task.title, 'runTask.title');
    enumValue(task.phase, TASK_PHASES, 'runTask.phase'); enumValue(task.status, TASK_STATUSES, 'runTask.status');
    if (typeof task.managed !== 'boolean' || !Number.isSafeInteger(task.attempt) || task.attempt < 0) throw new Error('runTask fields are invalid.');
    stringArray(task.dependsOn, 'runTask.dependsOn');
    for (const field of ['sessionId', 'workspaceBindingId', 'workspaceDir', 'expectedHeadSha', 'preparedBaseSha', 'error'] as const) {
      text(task[field], `runTask.${field}`, true);
    }
    for (const field of ['createdAt', 'updatedAt', 'startedAt', 'endedAt', 'exitCode'] as const) number(task[field], `runTask.${field}`, true);
  }
  for (const event of config.runEvents) {
    enumValue(event.type, EVENT_TYPES, 'runEvent.type'); number(event.createdAt, 'runEvent.createdAt'); number(event.seq, 'runEvent.seq');
    if (!Number.isSafeInteger(event.seq) || event.seq < 0) throw new Error('runEvent.seq is invalid.');
    if (event.data !== undefined) {
      const data = object(event.data, 'runEvent.data');
      if (Object.values(data).some((value) => value !== null
          && !['string', 'number', 'boolean'].includes(typeof value))) throw new Error('runEvent.data is invalid.');
    }
  }
  for (const artifact of config.runArtifacts) {
    enumValue(artifact.kind, ['file', 'patch', 'message', 'result'], 'runArtifact.kind');
    for (const field of ['path', 'content', 'workspaceBindingId', 'workspaceDir'] as const) text(artifact[field], `runArtifact.${field}`, true);
    number(artifact.createdAt, 'runArtifact.createdAt');
  }
  for (const result of config.runTaskResults) {
    if (result.version !== 1) throw new Error('runTaskResult.version is invalid.');
    enumValue(result.outcome, ['succeeded', 'failed', 'blocked'], 'runTaskResult.outcome');
    for (const field of ['adapterId', 'resultPath', 'summary'] as const) text(result[field], `runTaskResult.${field}`);
    if (!Array.isArray(result.assignments) || !Array.isArray(result.filesChanged) || !Array.isArray(result.tests)
        || !Array.isArray(result.risks)) throw new Error('runTaskResult collections are invalid.');
    stringArray(result.filesChanged, 'runTaskResult.filesChanged'); stringArray(result.risks, 'runTaskResult.risks');
    for (const [index, assignment] of result.assignments.entries()) {
      const item = object(assignment, `runTaskResult.assignments[${index}]`);
      exactKeys(item, ['participantId', 'title', 'prompt', 'acceptanceCriteria', 'dependsOn'], `runTaskResult.assignments[${index}]`);
      text(item.participantId, 'runTaskResult.assignment.participantId'); text(item.title, 'runTaskResult.assignment.title');
      text(item.prompt, 'runTaskResult.assignment.prompt'); stringArray(item.acceptanceCriteria, 'runTaskResult.assignment.acceptanceCriteria');
      stringArray(item.dependsOn, 'runTaskResult.assignment.dependsOn');
    }
    for (const [index, test] of result.tests.entries()) {
      const item = object(test, `runTaskResult.tests[${index}]`);
      exactKeys(item, ['command', 'status', 'output'], `runTaskResult.tests[${index}]`);
      text(item.command, 'runTaskResult.test.command'); text(item.output, 'runTaskResult.test.output');
      enumValue(item.status, ['passed', 'failed', 'skipped'], 'runTaskResult.test.status');
    }
    if (result.commitSha !== null) text(result.commitSha, 'runTaskResult.commitSha');
    const usage = object(result.usage, 'runTaskResult.usage');
    exactKeys(usage, ['inputTokens', 'outputTokens', 'costUsd'], 'runTaskResult.usage');
    for (const field of ['inputTokens', 'outputTokens', 'costUsd'] as const) {
      if (usage[field] !== null) {
        number(usage[field], `runTaskResult.usage.${field}`);
        if ((usage[field] as number) < 0) throw new Error(`runTaskResult.usage.${field} is invalid.`);
      }
    }
    number(result.createdAt, 'runTaskResult.createdAt');
  }
  for (const approval of config.runApprovals) {
    enumValue(approval.type, ['integration'], 'runApproval.type'); enumValue(approval.status, ['pending', 'approved', 'rejected'], 'runApproval.status');
    text(approval.reason, 'runApproval.reason'); number(approval.requestedAt, 'runApproval.requestedAt'); number(approval.resolvedAt, 'runApproval.resolvedAt', true);
  }
  for (const lease of config.runWorkspaceLeases) {
    text(lease.agentId, 'runLease.agentId'); text(lease.workspaceDir, 'runLease.workspaceDir'); text(lease.branch, 'runLease.branch');
    text(lease.baseSha, 'runLease.baseSha'); text(lease.commonGitDir, 'runLease.commonGitDir');
    if (typeof lease.isRepo !== 'boolean') throw new Error('runLease.isRepo is invalid.');
    enumValue(lease.status, ['active', 'released'], 'runLease.status'); number(lease.acquiredAt, 'runLease.acquiredAt'); number(lease.releasedAt, 'runLease.releasedAt', true);
  }
  for (const publication of config.runPublications) {
    enumValue(publication.provider, ['github'], 'runPublication.provider'); enumValue(publication.remoteName, ['origin'], 'runPublication.remoteName');
    enumValue(publication.status, ['publishing', 'draft', 'failed'], 'runPublication.status');
    for (const field of ['providerRepository', 'baseBranch', 'headBranch', 'baseSha', 'headSha'] as const) text(publication[field], `runPublication.${field}`);
    number(publication.createdAt, 'runPublication.createdAt'); number(publication.updatedAt, 'runPublication.updatedAt'); number(publication.prNumber, 'runPublication.prNumber', true);
    text(publication.prUrl, 'runPublication.prUrl', true); text(publication.error, 'runPublication.error', true);
  }
  for (const message of config.runMessages) {
    enumValue(message.kind, ['plan', 'assignment', 'result', 'integration', 'verification'], 'runMessage.kind');
    text(message.text, 'runMessage.text'); number(message.createdAt, 'runMessage.createdAt'); number(message.seq, 'runMessage.seq');
    if (!Number.isSafeInteger(message.seq) || message.seq < 0) throw new Error('runMessage.seq is invalid.');
  }
  for (const command of config.commandLog) {
    text(command.channel, 'commandLog.channel'); number(command.createdAt, 'commandLog.createdAt'); text(command.resultJson, 'commandLog.resultJson');
  }

  const requireRef = (value: unknown, values: Set<string>, label: string): void => {
    if (typeof value !== 'string' || !values.has(value)) throw new Error(`${label} relationship is invalid.`);
  };
  const participantsById = new Map(config.runParticipants.map((item) => [item.id, item]));
  const tasksById = new Map(config.runTasks.map((item) => [item.id, item]));
  const bindingsById = new Map(config.workspaceBindings.map((item) => [item.id, item]));
  const runsById = new Map(config.runs.map((item) => [item.id, item]));
  const repositoriesById = new Map(config.repositories.map((item) => [item.id, item]));
  const sameOptional = (left: string | null | undefined, right: string | null | undefined, label: string): void => {
    if (left !== undefined && left !== null && right !== undefined && right !== null && left !== right) {
      throw new Error(`${label} relationship is invalid.`);
    }
  };
  const sameRun = (runId: string, relatedRunId: string | undefined, label: string): void => {
    if (relatedRunId !== runId) throw new Error(`${label} crosses run boundaries.`);
  };
  for (const run of config.runs) {
    if (run.repositoryId !== undefined && run.repositoryId !== null) requireRef(run.repositoryId, repositoryIds, 'run repository');
    if (run.verificationTaskId !== undefined) {
      requireRef(run.verificationTaskId, taskIds, 'run verification task');
      sameRun(run.id, tasksById.get(run.verificationTaskId)?.runId, 'run verification task');
    }
  }
  for (const participant of config.runParticipants) {
    requireRef(participant.runId, runIds, 'run participant');
    if (participant.repositoryId !== undefined && participant.repositoryId !== null) {
      requireRef(participant.repositoryId, repositoryIds, 'run participant repository');
    }
  }
  for (const task of config.runTasks) {
    requireRef(task.runId, runIds, 'run task');
    requireRef(task.participantId, participantIds, 'run task participant');
    sameRun(task.runId, participantsById.get(task.participantId)?.runId, 'run task participant');
    if (task.repositoryId !== undefined && task.repositoryId !== null) requireRef(task.repositoryId, repositoryIds, 'run task repository');
    sameOptional(task.repositoryId, runsById.get(task.runId)?.repositoryId, 'run task repository');
    sameOptional(task.repositoryId, participantsById.get(task.participantId)?.repositoryId, 'run task participant repository');
    if (task.workspaceBindingId !== undefined) {
      requireRef(task.workspaceBindingId, bindingIds, 'run task workspace binding');
      const binding = bindingsById.get(task.workspaceBindingId)!;
      if (task.repositoryId !== binding.repositoryId || task.workspaceDir !== binding.workspaceDir
          || participantsById.get(task.participantId)?.agentId !== binding.agentId) {
        throw new Error('run task workspace binding relationship is invalid.');
      }
    }
    if (!Array.isArray(task.dependsOn) || task.dependsOn.some((id) => !taskIds.has(id))) {
      throw new Error('run task dependencies are invalid.');
    }
    for (const dependency of task.dependsOn) sameRun(task.runId, tasksById.get(dependency)?.runId, 'run task dependency');
  }
  for (const collection of [config.runEvents, config.runArtifacts, config.runTaskResults,
    config.runApprovals, config.runWorkspaceLeases, config.runPublications, config.runMessages]) {
    for (const item of collection) requireRef(item.runId, runIds, 'run record');
  }
  for (const event of config.runEvents) {
    if (event.taskId !== undefined) {
      requireRef(event.taskId, taskIds, 'run event task');
      sameRun(event.runId, tasksById.get(event.taskId)?.runId, 'run event task');
    }
    if (event.participantId !== undefined) {
      requireRef(event.participantId, participantIds, 'run event participant');
      sameRun(event.runId, participantsById.get(event.participantId)?.runId, 'run event participant');
    }
  }
  for (const artifact of config.runArtifacts) {
    if (artifact.taskId !== undefined) {
      requireRef(artifact.taskId, taskIds, 'run artifact task');
      sameRun(artifact.runId, tasksById.get(artifact.taskId)?.runId, 'run artifact task');
    }
    if (artifact.repositoryId !== undefined && artifact.repositoryId !== null) {
      requireRef(artifact.repositoryId, repositoryIds, 'run artifact repository');
    }
    sameOptional(artifact.repositoryId, runsById.get(artifact.runId)?.repositoryId, 'run artifact repository');
    if (artifact.taskId !== undefined) {
      const task = tasksById.get(artifact.taskId)!;
      sameOptional(artifact.repositoryId, task.repositoryId, 'run artifact task repository');
      sameOptional(artifact.repositoryId, participantsById.get(task.participantId)?.repositoryId,
        'run artifact participant repository');
    }
    if (artifact.workspaceBindingId !== undefined) {
      requireRef(artifact.workspaceBindingId, bindingIds, 'run artifact workspace binding');
      const binding = bindingsById.get(artifact.workspaceBindingId)!;
      if (artifact.repositoryId !== binding.repositoryId || artifact.workspaceDir !== binding.workspaceDir
          || (artifact.taskId !== undefined
            && participantsById.get(tasksById.get(artifact.taskId)!.participantId)?.agentId !== binding.agentId)) {
        throw new Error('run artifact workspace binding relationship is invalid.');
      }
    }
  }
  for (const result of config.runTaskResults) {
    requireRef(result.taskId, taskIds, 'run result task');
    requireRef(result.participantId, participantIds, 'run result participant');
    sameRun(result.runId, tasksById.get(result.taskId)?.runId, 'run result task');
    sameRun(result.runId, participantsById.get(result.participantId)?.runId, 'run result participant');
    if (result.participantId !== tasksById.get(result.taskId)?.participantId) {
      throw new Error('run result task participant relationship is invalid.');
    }
    for (const assignment of result.assignments) {
      requireRef(assignment.participantId, participantIds, 'run result assignment participant');
      sameRun(result.runId, participantsById.get(assignment.participantId)?.runId, 'run result assignment participant');
      for (const dependency of assignment.dependsOn) {
        requireRef(dependency, participantIds, 'run result assignment dependency');
        sameRun(result.runId, participantsById.get(dependency)?.runId, 'run result assignment dependency');
      }
    }
  }
  for (const lease of config.runWorkspaceLeases) {
    requireRef(lease.participantId, participantIds, 'run lease participant');
    sameRun(lease.runId, participantsById.get(lease.participantId)?.runId, 'run lease participant');
    if (lease.repositoryId !== undefined) requireRef(lease.repositoryId, repositoryIds, 'run lease repository');
    sameOptional(lease.repositoryId, runsById.get(lease.runId)?.repositoryId, 'run lease repository');
    sameOptional(lease.repositoryId, participantsById.get(lease.participantId)?.repositoryId, 'run lease participant repository');
    if (participantsById.get(lease.participantId)?.agentId !== lease.agentId) {
      throw new Error('run lease agent relationship is invalid.');
    }
    if (lease.workspaceBindingId !== undefined) {
      requireRef(lease.workspaceBindingId, bindingIds, 'run lease workspace binding');
      const binding = bindingsById.get(lease.workspaceBindingId)!;
      if (lease.repositoryId !== binding.repositoryId || lease.agentId !== binding.agentId
          || lease.workspaceDir !== binding.workspaceDir) {
        throw new Error('run lease workspace binding relationship is invalid.');
      }
    }
    if (lease.repositoryId !== undefined
        && lease.commonGitDir !== repositoriesById.get(lease.repositoryId)?.commonGitDir) {
      throw new Error('run lease repository commonGitDir relationship is invalid.');
    }
  }
  for (const publication of config.runPublications) {
    requireRef(publication.repositoryId, repositoryIds, 'run publication repository');
  }
  for (const message of config.runMessages) {
    if (message.taskId !== undefined) {
      requireRef(message.taskId, taskIds, 'run message task');
      sameRun(message.runId, tasksById.get(message.taskId)?.runId, 'run message task');
    }
    if (message.fromParticipantId !== undefined) {
      requireRef(message.fromParticipantId, participantIds, 'run message sender');
      sameRun(message.runId, participantsById.get(message.fromParticipantId)?.runId, 'run message sender');
    }
    requireRef(message.toParticipantId, participantIds, 'run message recipient');
    sameRun(message.runId, participantsById.get(message.toParticipantId)?.runId, 'run message recipient');
  }
}

export class ConfigStore {
  private readonly filePath: string;
  private config: AdeConfig;
  private revision = 0;
  private diskFingerprint: string | null = null;
  private profileDirectoryIdentity?: { dev: bigint; ino: bigint };
  private workspaceLockDepth = 0;
  private workspaceLockRelease?: () => void;
  private readonly loadFailure: ConfigLoadFailure | null;

  constructor(filePath?: string) {
    this.filePath = filePath ?? defaultConfigPath();
    mkdirSync(dirname(this.filePath), { recursive: true });
    if (process.platform === 'linux') {
      const directory = lstatSync(dirname(this.filePath), { bigint: true });
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Config profile directory is not trusted.');
      this.profileDirectoryIdentity = { dev: directory.dev, ino: directory.ino };
    }
    const loaded = this.load();
    this.config = loaded.config;
    this.loadFailure = loaded.failure;
    if (loaded.persist && !this.readOnly) {
      try {
        this.persist();
      } catch (err) {
        console.error('[ade] failed to write config file:', err);
      }
    }

    this.diskFingerprint = this.readDiskFingerprint();
  }

  get(): AdeConfig {
    return this.config;
  }

  /** Non-null when the previous config file could not be loaded. */
  getLoadFailure(): ConfigLoadFailure | null {
    return this.loadFailure;
  }

  /** True when an unpreservable original must not be overwritten. */
  get readOnly(): boolean {
    return this.loadFailure?.readOnly === true;
  }

  /** Fail before touching in-memory state: a caller that ignores this error
   *  must not observe a mutated catalog either. */
  private assertWritable(): void {
    if (this.readOnly) {
      throw new Error(
        'ade: the existing configuration could not be read or preserved, so ADE refuses to '
        + 'overwrite it. Move or repair config.json, then restart ADE.',
      );
    }
  }

  getRevision(): number {
    return this.revision;
  }

  getPersistedSnapshot(): { bytes: Buffer; sha256: string } {
    const bytes = this.readDiskBytes();
    return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
  }

  acquireWorkspaceImportLock(): () => void {
    if (this.workspaceLockDepth > 0) {
      this.workspaceLockDepth += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        this.workspaceLockDepth -= 1;
        if (this.workspaceLockDepth === 0) {
          const release = this.workspaceLockRelease;
          this.workspaceLockRelease = undefined;
          release?.();
        }
      };
    }
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    if (process.platform !== 'linux') {
      throw new Error('Workspace import locking is unavailable on this platform.');
    }
    const dirFd = this.openAnchoredDirectory(dir);
    const lockName = '.workspace-import.lock';
    const lockPath = `/proc/self/fd/${dirFd}/${lockName}`;
    const token = randomUUID();
    const reclaimName = `.workspace-import.reclaim-${process.pid}-${token}`;
    const reclaimPath = `/proc/self/fd/${dirFd}/${reclaimName}`;
    const processStart = (pid: number): string | null => {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        const fields = stat.slice(stat.lastIndexOf(') ') + 2).trim().split(/\s+/);
        return fields[19] && /^\d+$/.test(fields[19]) ? fields[19] : null;
      } catch { return null; }
    };
    const bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    if (!/^[0-9a-f-]{36}$/.test(bootId)) {
      closeSync(dirFd);
      throw new Error('Unable to identify the current Linux boot.');
    }
    const ownerStart = processStart(process.pid);
    if (!ownerStart) {
      closeSync(dirFd);
      throw new Error('Unable to identify the workspace import lock owner.');
    }
    const claim = (): void => {
      const lockFd = openSync(
        lockPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        writeFileSync(lockFd, `${process.pid} ${ownerStart} ${bootId} ${token}\n`);
        fsyncSync(lockFd);
      } finally { closeSync(lockFd); }
      fsyncSync(dirFd);
    };
    const staleOwner = (): boolean => {
      try {
        const existingFd = openSync(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        let bytes: string;
        try {
          const stat = fstatSync(existingFd);
          if (!stat.isFile() || stat.nlink !== 1 || stat.size > 128) return false;
          bytes = readFileSync(existingFd, 'utf8');
        } finally { closeSync(existingFd); }
        const match = /^(\d+) (\d+) ([0-9a-f-]{36}) ([0-9a-f-]{36})\n$/.exec(bytes);
        if (!match) return false;
        const observedStart = processStart(Number(match[1]));
        return match[3] !== bootId || observedStart === null || observedStart !== match[2];
      } catch { return false; }
      return false;
    };
    try {
      claim();
    } catch (error) {
      let reclaimFd: number | undefined;
      try {
        reclaimFd = openSync(reclaimPath,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        writeFileSync(reclaimFd, `${process.pid} ${ownerStart} ${bootId} ${token}\n`);
        fsyncSync(reclaimFd);
        fsyncSync(dirFd);
      } catch {
        closeSync(dirFd);
        throw new Error('Unable to register a workspace import lock reclaimer.');
      }
      let reclaimFailure: unknown;
      try {
        const contenders = readdirSync(`/proc/self/fd/${dirFd}`)
          .filter((name) => name.startsWith('.workspace-import.reclaim-'))
          .flatMap((name) => {
            let fd: number | undefined;
            try {
              fd = openSync(`/proc/self/fd/${dirFd}/${name}`, constants.O_RDONLY | constants.O_NOFOLLOW);
              const stat = fstatSync(fd, { bigint: true });
              const body = readFileSync(fd, 'utf8');
              const match = /^(\d+) (\d+) ([0-9a-f-]{36}) ([0-9a-f-]{36})\n$/.exec(body);
              if (!stat.isFile() || stat.nlink !== BigInt(1) || !match
                  || match[3] !== bootId || processStart(Number(match[1])) !== match[2]) return [];
              return [{ name, ctimeNs: stat.ctimeNs, ino: stat.ino }];
            } catch { return []; } finally { if (fd !== undefined) closeSync(fd); }
          })
          .sort((left, right) => left.ctimeNs < right.ctimeNs ? -1
            : left.ctimeNs > right.ctimeNs ? 1 : left.ino < right.ino ? -1 : left.ino > right.ino ? 1
              : left.name.localeCompare(right.name));
        if (contenders[0]?.name !== reclaimName) {
          throw new Error('Another process is reclaiming the workspace import lock.');
        }
        if (!staleOwner()) throw error;
        unlinkSync(lockPath);
        claim();
      } catch (reclaimError) {
        reclaimFailure = reclaimError;
      } finally {
        if (reclaimFd !== undefined) closeSync(reclaimFd);
        try { unlinkSync(reclaimPath); fsyncSync(dirFd); } catch { /* reclaim marker remains fail-closed */ }
      }
      if (reclaimFailure !== undefined) {
        closeSync(dirFd);
        throw new Error(`Another workspace import owns the profile lock: ${reclaimFailure instanceof Error ? reclaimFailure.message : String(reclaimFailure)}`);
      }
    }
    closeSync(dirFd);
    this.workspaceLockDepth = 1;
    const releaseUnderlying = () => {
      const releaseFd = this.openAnchoredDirectory(dir);
      try {
        const releasePath = `/proc/self/fd/${releaseFd}/${lockName}`;
        const lockBytes = readFileSync(releasePath, 'utf8');
        if (lockBytes !== `${process.pid} ${ownerStart} ${bootId} ${token}\n`) {
          throw new Error('Workspace import lock ownership changed before release.');
        }
        unlinkSync(releasePath);
        fsyncSync(releaseFd);
      } finally { closeSync(releaseFd); }
    };
    this.workspaceLockRelease = releaseUnderlying;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.workspaceLockDepth -= 1;
      if (this.workspaceLockDepth === 0) {
        const release = this.workspaceLockRelease;
        this.workspaceLockRelease = undefined;
        release?.();
      }
    };
  }

  /**
   * Shallow-merge a partial config (settings merged one level deep) and
   * persist atomically. Returns the saved config.
   */
  save(partial: Partial<AdeConfig>): AdeConfig {
    this.assertWritable();
    const releaseLock = process.platform === 'linux' ? this.acquireWorkspaceImportLock() : () => {};
    try {
      this.assertDiskUnchanged();
      // An explicitly-undefined property would shadow the current value and
      // JSON.stringify would then drop the key from disk entirely (observed as
      // a transient catalog loss in Goal 6). Undefined never overwrites.
      const defined = Object.fromEntries(
        Object.entries(partial).filter(([, value]) => value !== undefined),
      ) as Partial<AdeConfig>;
      const next = {
        ...this.config,
        ...defined,
        settings: { ...this.config.settings, ...(defined.settings ?? {}) },
      };
      this.persistConfig(next);
      this.config = next;
      this.revision += 1;
      return this.config;
    } finally { releaseLock(); }
  }

  /** Validate and persist a complete config before atomically publishing it in memory. */
  replace(config: AdeConfig, expectedRevision?: number): AdeConfig {
    this.assertWritable();
    const releaseLock = process.platform === 'linux' ? this.acquireWorkspaceImportLock() : () => {};
    try {
      if (expectedRevision !== undefined && expectedRevision !== this.revision) {
        throw new Error('Config changed while the workspace import was being prepared.');
      }
      this.assertDiskUnchanged();
      const candidate = structuredClone(config);
      const normalized = normalizeConfig(candidate);
      if (normalized.migrated) {
        throw new Error('Refusing to replace config with an incomplete or non-canonical value.');
      }
      for (const key of REPLACE_IMMUTABLE_KEYS) {
        if (JSON.stringify(candidate[key]) !== JSON.stringify(this.config[key])) {
          throw new Error(`Refusing to replace unrelated config collection ${key}.`);
        }
      }
      validateCompleteConfig(candidate);
      this.persistConfig(candidate);
      this.config = candidate;
      this.revision += 1;
      return this.config;
    } finally { releaseLock(); }
  }

  private load(): LoadOutcome {
    let raw: string;
    try {
      raw = this.readDiskBytes().toString('utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // First run only: there is nothing to lose.
        return { config: structuredClone(DEFAULT_CONFIG), failure: null, persist: true };
      }
      // Everything else — a locked file, a bad ACL, or readDiskBytes' own
      // "not a bounded regular file" rejection — means a real config exists
      // and must not be overwritten.
      return this.recover('unreadable', error);
    }

    let parsed: Partial<AdeConfig>;
    try {
      parsed = JSON.parse(raw) as Partial<AdeConfig>;
    } catch (error) {
      return this.recover('malformed', error);
    }

    try {
      const normalized = normalizeConfig(parsed);
      return { config: normalized.config, failure: null, persist: normalized.migrated };
    } catch (error) {
      return this.recover('incompatible', error);
    }
  }

  /** Preserve the unusable file, then decide whether defaults may be written. */
  private recover(reason: ConfigLoadFailure['reason'], error: unknown): LoadOutcome {
    const detail = describeError(error, this.filePath);
    let quarantinedTo: string | null = null;
    try {
      quarantinedTo = this.quarantine();
    } catch (quarantineError) {
      console.error('[ade] config quarantine failed; the original stays in place:', quarantineError);
    }
    console.error(`[ade] config load failed (${reason}): ${detail}`);
    return {
      config: structuredClone(DEFAULT_CONFIG),
      failure: { reason, detail, quarantinedTo, readOnly: quarantinedTo === null, at: Date.now() },
      persist: quarantinedTo !== null,
    };
  }

  /** Move the unusable file aside. Returns its config-relative location. */
  private quarantine(): string {
    const dir = join(dirname(this.filePath), 'corrupt');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    let target = join(dir, `config-${stamp}.json`);
    for (let attempt = 1; existsSync(target); attempt += 1) {
      target = join(dir, `config-${stamp}-${attempt}.json`);
    }
    renameSync(this.filePath, target);
    return `corrupt/${basename(target)}`;
  }

  private persist(): void {
    this.persistConfig(this.config);
  }

  private persistConfig(config: AdeConfig): void {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `config.json.${process.pid}.${Date.now()}.tmp`);
    try {
      const serialized = JSON.stringify(config, null, 2) + '\n';
      if (process.platform === 'linux') {
        const fd = this.openAnchoredDirectory(dir);
        try {
          const anchoredTmp = `/proc/self/fd/${fd}/${basename(tmp)}`;
          const anchoredTarget = `/proc/self/fd/${fd}/${basename(this.filePath)}`;
          let published = false;
          const tempFd = openSync(anchoredTmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          try {
            writeFileSync(tempFd, serialized, { encoding: 'utf8' });
            fsyncSync(tempFd);
          } finally { closeSync(tempFd); }
          try {
            if (this.diskFingerprint !== null) {
              const currentFd = openSync(anchoredTarget, constants.O_RDONLY | constants.O_NOFOLLOW);
              try {
                if (createHash('sha256').update(readFileSync(currentFd)).digest('hex') !== this.diskFingerprint) {
                  throw new Error('Config changed on disk immediately before publication.');
                }
              } finally { closeSync(currentFd); }
            }
            renameSync(anchoredTmp, anchoredTarget);
            published = true;
            fsyncSync(fd);
          } finally {
            if (!published) try { unlinkSync(anchoredTmp); } catch { /* temp was not published */ }
          }
        } finally { closeSync(fd); }
      } else {
        writeFileSync(tmp, serialized, 'utf8');
        if (this.diskFingerprint !== null && this.readDiskFingerprint() !== this.diskFingerprint) {
          throw new Error('Config changed on disk immediately before publication.');
        }
        renameSync(tmp, this.filePath);
      }
      this.diskFingerprint = createHash('sha256').update(serialized).digest('hex');
    } catch (error) {
      if (process.platform !== 'linux') {
        try { unlinkSync(tmp); } catch { /* temp was never created or already removed */ }
      }
      throw error;
    }
  }

  private readDiskFingerprint(): string | null {
    try {
      return createHash('sha256').update(this.readDiskBytes()).digest('hex');
    } catch {
      return null;
    }
  }

  private assertDiskUnchanged(): void {
    if (this.readDiskFingerprint() !== this.diskFingerprint) {
      throw new Error('Config changed on disk while the workspace import was being prepared.');
    }
  }

  private readDiskBytes(): Buffer {
    if (process.platform !== 'linux') return readFileSync(this.filePath);
    const dir = dirname(this.filePath);
    const dirFd = this.openAnchoredDirectory(dir);
    try {
      const fileFd = openSync(
        `/proc/self/fd/${dirFd}/${basename(this.filePath)}`,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stat = fstatSync(fileFd);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8 * 1024 * 1024) {
          throw new Error('Config file is not a bounded regular file.');
        }
        return readFileSync(fileFd);
      } finally { closeSync(fileFd); }
    } finally { closeSync(dirFd); }
  }

  private openAnchoredDirectory(path: string): number {
    const expected = resolve(path);
    const real = realpathSync.native(expected);
    const named = lstatSync(expected, { bigint: true });
    if (!named.isDirectory() || named.isSymbolicLink() || real !== expected) {
      throw new Error('Config directory is not a canonical directory.');
    }
    const directoryFlag = (constants as unknown as Record<string, number>).O_DIRECTORY ?? 0;
    const fd = openSync(expected, constants.O_RDONLY | directoryFlag | constants.O_NOFOLLOW);
    try {
      const opened = fstatSync(fd, { bigint: true });
      const descriptorReal = realpathSync.native(`/proc/self/fd/${fd}`);
      if (!opened.isDirectory() || opened.dev !== named.dev || opened.ino !== named.ino
          || (this.profileDirectoryIdentity !== undefined
            && (opened.dev !== this.profileDirectoryIdentity.dev || opened.ino !== this.profileDirectoryIdentity.ino))
          || descriptorReal !== real) {
        throw new Error('Config directory changed while it was being anchored.');
      }
      return fd;
    } catch (error) {
      closeSync(fd);
      throw error;
    }
  }
}
