/** Runtime validation for every renderer -> main IPC request. */

import { IPC, type IpcInvokeMap } from '../shared/ipc';

type RecordValue = Record<string, unknown>;

const RUNTIMES = ['claude', 'codex', 'opencode', 'grok', 'gemini', 'ollama', 'shell', 'custom'] as const;
const PERMISSION_MODES = ['default', 'accept-edits', 'bypass'] as const;
const CODEX_REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
const CODEX_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const CATEGORY_KINDS = ['plain', 'orchestrator', 'team'] as const;
const TEAM_ROLES = ['orchestrator', 'lead', 'worker'] as const;

function invalid(channel: string, detail: string): never {
  throw new Error(`ade: invalid IPC payload for "${channel}": ${detail}`);
}

function record(channel: string, value: unknown, label = 'request'): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(channel, `${label} must be an object`);
  }
  return value as RecordValue;
}

function exactKeys(channel: string, value: RecordValue, allowed: readonly string[], label = 'request'): void {
  const allowedSet = new Set(allowed);
  const extra = Object.keys(value).find((key) => !allowedSet.has(key));
  if (extra) invalid(channel, `${label} contains unknown field "${extra}"`);
}

function stringValue(
  channel: string,
  value: unknown,
  label: string,
  options: { min?: number; max: number; allowEmpty?: boolean } = { max: 512 },
): string {
  if (typeof value !== 'string') invalid(channel, `${label} must be a string`);
  if (value.includes('\0')) invalid(channel, `${label} contains a null character`);
  if (!options.allowEmpty && value.trim().length < (options.min ?? 1)) {
    invalid(channel, `${label} is required`);
  }
  if (value.length > options.max) invalid(channel, `${label} exceeds ${options.max} characters`);
  return value;
}

function optionalString(
  channel: string,
  value: unknown,
  label: string,
  options: { max: number; allowEmpty?: boolean },
): string | undefined {
  if (value === undefined) return undefined;
  return stringValue(channel, value, label, options);
}

function optionalCodexModel(channel: string, value: unknown): string | undefined {
  const model = optionalString(channel, value, 'codexModel', { max: 100, allowEmpty: true });
  if (model?.trim() && !CODEX_MODEL_PATTERN.test(model.trim())) {
    invalid(channel, 'codexModel must be a shell-safe model id');
  }
  return model;
}

function enumValue<T extends string>(
  channel: string,
  value: unknown,
  label: string,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    invalid(channel, `${label} is not supported`);
  }
  return value as T;
}

function optionalBoundedNumber(
  channel: string,
  value: unknown,
  label: string,
  options: { min: number; max: number; integer?: boolean },
): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < options.min || value > options.max) {
    invalid(channel, `${label} must be null or a number from ${options.min} to ${options.max}`);
  }
  if (options.integer && !Number.isInteger(value)) invalid(channel, `${label} must be an integer`);
}

function id(channel: string, value: unknown, label: string): string {
  return stringValue(channel, value, label, { max: 512 });
}

function optionalId(channel: string, value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return id(channel, value, label);
}

function nullableId(channel: string, value: unknown, label: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  return id(channel, value, label);
}

function ids(channel: string, value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 1_000) {
    invalid(channel, `${label} must be an array of at most 1000 ids`);
  }
  return value.map((item, index) => id(channel, item, `${label}[${index}]`));
}

function base64(channel: string, value: unknown, label: string, maxChars: number): string {
  const text = stringValue(channel, value, label, { max: maxChars, allowEmpty: true });
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) {
    invalid(channel, `${label} must be valid base64`);
  }
  return text;
}

function filename(channel: string, value: unknown, label: string): string | undefined {
  const text = optionalString(channel, value, label, { max: 255 });
  if (text !== undefined && (text.includes('/') || text.includes('\\') || text === '.' || text === '..')) {
    invalid(channel, `${label} must be a stored filename`);
  }
  return text;
}

function relativePath(channel: string, value: unknown, allowEmpty: boolean): string {
  const path = stringValue(channel, value, 'path', { max: 4_096, allowEmpty });
  const segments = path.split(/[\\/]+/);
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(path) || segments.includes('..')) {
    invalid(channel, 'path must stay relative to the selected workspace');
  }
  return path;
}

function voidRequest(channel: string, payload: unknown): void {
  if (payload !== undefined) invalid(channel, 'request must be empty');
}

function validateConfigSave(channel: string, payload: unknown): void {
  const request = record(channel, payload);
  exactKeys(channel, request, ['settings']);
  const settings = record(channel, request.settings, 'settings');
  exactKeys(channel, settings, ['theme'], 'settings');
  enumValue(channel, settings.theme, 'settings.theme', ['dark', 'light']);
}

function validateCategoryCreate(channel: string, payload: unknown): void {
  const request = record(channel, payload);
  exactKeys(channel, request, ['name', 'photo', 'repoPath', 'defaultRepositoryId', 'kind']);
  stringValue(channel, request.name, 'name', { max: 200 });
  filename(channel, request.photo, 'photo');
  optionalString(channel, request.repoPath, 'repoPath', { max: 32_768 });
  optionalId(channel, request.defaultRepositoryId, 'defaultRepositoryId');
  if (request.kind !== undefined) enumValue(channel, request.kind, 'kind', CATEGORY_KINDS);
}

function validateAgentInput(channel: string, payload: unknown, update: boolean): void {
  const request = record(channel, payload);
  const common = [
    'name',
    'role',
    'runtime',
    'permissionMode',
    'customCommand',
    'ollamaModel',
    'codexModel',
    'codexReasoningEffort',
    'teamRole',
    'defaultRepositoryId',
  ];
  const allowed = update
    ? ['id', ...common]
    : ['categoryId', ...common, 'photo', 'teamRole'];
  exactKeys(channel, request, allowed);
  id(channel, update ? request.id : request.categoryId, update ? 'id' : 'categoryId');
  stringValue(channel, request.name, 'name', { max: 200 });
  optionalString(channel, request.role, 'role', { max: 200, allowEmpty: true });
  enumValue(channel, request.runtime, 'runtime', RUNTIMES);
  enumValue(channel, request.permissionMode, 'permissionMode', PERMISSION_MODES);
  optionalString(channel, request.customCommand, 'customCommand', { max: 4_096, allowEmpty: true });
  optionalString(channel, request.ollamaModel, 'ollamaModel', { max: 300, allowEmpty: true });
  optionalCodexModel(channel, request.codexModel);
  if (request.codexReasoningEffort !== undefined) {
    enumValue(channel, request.codexReasoningEffort, 'codexReasoningEffort', CODEX_REASONING_EFFORTS);
  }
  if (request.runtime !== 'codex' &&
      (request.codexModel !== undefined || request.codexReasoningEffort !== undefined)) {
    invalid(channel, 'Codex model settings require runtime "codex"');
  }
  if (update && request.teamRole !== undefined) {
    enumValue(channel, request.teamRole, 'teamRole', TEAM_ROLES);
  }
  nullableId(channel, request.defaultRepositoryId, 'defaultRepositoryId');
  if (!update) {
    filename(channel, request.photo, 'photo');
    if (request.teamRole !== undefined) enumValue(channel, request.teamRole, 'teamRole', TEAM_ROLES);
  }
}

function validatePtyCreate(channel: string, payload: unknown): void {
  const request = record(channel, payload);
  exactKeys(channel, request, [
    'agentId',
    'task',
    'dispatchId',
    'runTaskId',
    'repositoryId',
    'workspaceBindingId',
  ]);
  id(channel, request.agentId, 'agentId');
  optionalString(channel, request.task, 'task', { max: 8_000, allowEmpty: true });
  optionalId(channel, request.dispatchId, 'dispatchId');
  optionalId(channel, request.runTaskId, 'runTaskId');
  nullableId(channel, request.repositoryId, 'repositoryId');
  optionalId(channel, request.workspaceBindingId, 'workspaceBindingId');
}

function validatePtyCancel(channel: string, payload: unknown): void {
  const request = record(channel, payload);
  exactKeys(channel, request, ['agentIds', 'runTaskIds']);
  ids(channel, request.agentIds, 'agentIds');
  ids(channel, request.runTaskIds, 'runTaskIds');
}

function commandId(channel: string, value: unknown): void {
  optionalString(channel, value, 'commandId', { max: 128 });
}

/** Strict optional integer: undefined passes, null and non-integers fail. */
function optionalStrictInteger(
  channel: string,
  value: unknown,
  label: string,
  options: { min: number; max: number },
): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < options.min || value > options.max) {
    invalid(channel, `${label} must be an integer from ${options.min} to ${options.max}`);
  }
}

function validateRunEvents(channel: string, payload: unknown): void {
  const request = record(channel, payload);
  exactKeys(channel, request, ['sinceSeq', 'limit']);
  optionalStrictInteger(channel, request.sinceSeq, 'sinceSeq', { min: 0, max: Number.MAX_SAFE_INTEGER });
  optionalStrictInteger(channel, request.limit, 'limit', { min: 1, max: 500 });
}

function validateRunLifecycle(channel: string, payload: unknown): void {
  const request = record(channel, payload);
  exactKeys(channel, request, ['runId', 'commandId']);
  id(channel, request.runId, 'runId');
  commandId(channel, request.commandId);
}

function validateTeamPause(channel: string, payload: unknown): void {
  const request = record(channel, payload);
  exactKeys(channel, request, ['runId', 'teamId', 'commandId']);
  id(channel, request.runId, 'runId');
  id(channel, request.teamId, 'teamId');
  commandId(channel, request.commandId);
}

function validateRunCreate(channel: string, payload: unknown): void {
  const request = record(channel, payload);
  exactKeys(channel, request, ['name', 'goal', 'repositoryId', 'participants', 'budget', 'commandId']);
  stringValue(channel, request.name, 'name', { max: 200 });
  optionalString(channel, request.goal, 'goal', { max: 8_000, allowEmpty: true });
  nullableId(channel, request.repositoryId, 'repositoryId');
  commandId(channel, request.commandId);
  if (!Array.isArray(request.participants) || request.participants.length < 1 || request.participants.length > 100) {
    invalid(channel, 'participants must contain between 1 and 100 entries');
  }
  request.participants.forEach((value, index) => {
    const participant = record(channel, value, `participants[${index}]`);
    exactKeys(channel, participant, ['agentId', 'role', 'teamId', 'teamName'], `participants[${index}]`);
    id(channel, participant.agentId, `participants[${index}].agentId`);
    enumValue(channel, participant.role, `participants[${index}].role`, TEAM_ROLES);
    optionalId(channel, participant.teamId, `participants[${index}].teamId`);
    optionalString(channel, participant.teamName, `participants[${index}].teamName`, {
      max: 200,
      allowEmpty: true,
    });
  });
  if (request.budget !== undefined) {
    const budget = record(channel, request.budget, 'budget');
    exactKeys(channel, budget, [
      'maxConcurrentTasks',
      'maxInputTokens',
      'maxOutputTokens',
      'maxCostUsd',
      'maxApprovals',
    ], 'budget');
    optionalBoundedNumber(channel, budget.maxConcurrentTasks, 'budget.maxConcurrentTasks', {
      min: 1, max: 4, integer: true,
    });
    optionalBoundedNumber(channel, budget.maxInputTokens, 'budget.maxInputTokens', {
      min: 1, max: 2_000_000_000, integer: true,
    });
    optionalBoundedNumber(channel, budget.maxOutputTokens, 'budget.maxOutputTokens', {
      min: 1, max: 2_000_000_000, integer: true,
    });
    optionalBoundedNumber(channel, budget.maxCostUsd, 'budget.maxCostUsd', {
      min: 0.01, max: 1_000_000,
    });
    optionalBoundedNumber(channel, budget.maxApprovals, 'budget.maxApprovals', {
      min: 0, max: 20, integer: true,
    });
  }
}

function validateArtifact(channel: string, payload: unknown): void {
  const request = record(channel, payload);
  exactKeys(channel, request, ['runId', 'taskId', 'kind', 'path', 'content']);
  id(channel, request.runId, 'runId');
  optionalId(channel, request.taskId, 'taskId');
  enumValue(channel, request.kind, 'kind', ['file', 'patch', 'message', 'result']);
  optionalString(channel, request.path, 'path', { max: 4_096, allowEmpty: true });
  optionalString(channel, request.content, 'content', { max: 1_048_576, allowEmpty: true });
}

function validateIdRequest(channel: string, payload: unknown, field: string): void {
  const request = record(channel, payload);
  exactKeys(channel, request, [field]);
  id(channel, request[field], field);
}

function validateAgentPath(channel: string, payload: unknown, pathOptional: boolean): void {
  const request = record(channel, payload);
  exactKeys(channel, request, ['agentId', 'sessionId', 'path']);
  id(channel, request.agentId, 'agentId');
  optionalId(channel, request.sessionId, 'sessionId');
  if (pathOptional) {
    if (request.path !== undefined) relativePath(channel, request.path, true);
  } else {
    relativePath(channel, request.path, false);
  }
}

function validateWorkspaceTarget(channel: string, payload: unknown): void {
  const request = record(channel, payload);
  exactKeys(channel, request, ['agentId', 'sessionId']);
  id(channel, request.agentId, 'agentId');
  optionalId(channel, request.sessionId, 'sessionId');
}

function validateCategoryReorder(channel: string, payload: unknown): void {
  const request = record(channel, payload);
  exactKeys(channel, request, ['orderedIds']);
  if (request.orderedIds === undefined) invalid(channel, 'orderedIds is required');
  ids(channel, request.orderedIds, 'orderedIds');
}

function validateAgentMove(channel: string, payload: unknown): void {
  const request = record(channel, payload);
  exactKeys(channel, request, ['agentId', 'categoryId', 'index']);
  id(channel, request.agentId, 'agentId');
  id(channel, request.categoryId, 'categoryId');
  const index = request.index;
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) > 10_000) {
    invalid(channel, 'index must be an integer from 0 to 10000');
  }
}

function validateFsRename(channel: string, payload: unknown): void {
  const request = record(channel, payload);
  exactKeys(channel, request, ['agentId', 'sessionId', 'path', 'newName']);
  id(channel, request.agentId, 'agentId');
  optionalId(channel, request.sessionId, 'sessionId');
  relativePath(channel, request.path, false);
  const newName = stringValue(channel, request.newName, 'newName', { max: 255 });
  if (/[/\\]/.test(newName) || newName === '.' || newName === '..' || newName.trim() !== newName) {
    invalid(channel, 'newName must be a bare file or folder name');
  }
}

/** Throws before a privileged handler sees malformed or over-sized input. */
export function assertIpcPayload<K extends keyof IpcInvokeMap>(
  channel: K,
  payload: unknown,
): asserts payload is IpcInvokeMap[K]['req'] {
  switch (channel) {
    case IPC.ConfigGet:
    case IPC.PtyList:
    case IPC.RunGet:
    case IPC.DialogPickFolder:
      voidRequest(channel, payload);
      return;
    case IPC.ConfigSave:
      validateConfigSave(channel, payload);
      return;
    case IPC.PhotoImport: {
      const request = record(channel, payload);
      exactKeys(channel, request, ['bytesBase64', 'mime']);
      base64(channel, request.bytesBase64, 'bytesBase64', 14_000_000);
      enumValue(channel, request.mime, 'mime', ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
      return;
    }
    case IPC.CategoryCreate:
      validateCategoryCreate(channel, payload);
      return;
    case IPC.CategoryDelete:
    case IPC.AgentDelete:
    case IPC.AgentTemplateDelete:
      validateIdRequest(channel, payload, 'id');
      return;
    case IPC.CategoryReorder:
      validateCategoryReorder(channel, payload);
      return;
    case IPC.AgentMove:
      validateAgentMove(channel, payload);
      return;
    case IPC.AgentCreate:
      validateAgentInput(channel, payload, false);
      return;
    case IPC.AgentUpdate:
      validateAgentInput(channel, payload, true);
      return;
    case IPC.AgentSetDefaultRepository: {
      const request = record(channel, payload);
      exactKeys(channel, request, ['agentId', 'repositoryId']);
      id(channel, request.agentId, 'agentId');
      nullableId(channel, request.repositoryId, 'repositoryId');
      if (request.repositoryId === undefined) invalid(channel, 'repositoryId is required');
      return;
    }
    case IPC.AgentTemplateCreate: {
      const request = record(channel, payload);
      exactKeys(channel, request, ['sourceAgentId', 'name']);
      id(channel, request.sourceAgentId, 'sourceAgentId');
      stringValue(channel, request.name, 'name', { max: 200 });
      return;
    }
    case IPC.AgentTemplateSpawn: {
      const request = record(channel, payload);
      exactKeys(channel, request, [
        'templateId',
        'categoryId',
        'name',
        'role',
        'photo',
        'runtime',
        'permissionMode',
        'customCommand',
        'ollamaModel',
        'codexModel',
        'codexReasoningEffort',
        'defaultRepositoryId',
      ]);
      id(channel, request.templateId, 'templateId');
      id(channel, request.categoryId, 'categoryId');
      optionalString(channel, request.name, 'name', { max: 200, allowEmpty: true });
      optionalString(channel, request.role, 'role', { max: 200, allowEmpty: true });
      filename(channel, request.photo, 'photo');
      if (request.runtime !== undefined) enumValue(channel, request.runtime, 'runtime', RUNTIMES);
      if (request.permissionMode !== undefined) {
        enumValue(channel, request.permissionMode, 'permissionMode', PERMISSION_MODES);
      }
      optionalString(channel, request.customCommand, 'customCommand', { max: 4_096, allowEmpty: true });
      optionalString(channel, request.ollamaModel, 'ollamaModel', { max: 300, allowEmpty: true });
      optionalCodexModel(channel, request.codexModel);
      if (request.codexReasoningEffort !== undefined) {
        enumValue(channel, request.codexReasoningEffort, 'codexReasoningEffort', CODEX_REASONING_EFFORTS);
      }
      if (request.runtime !== undefined && request.runtime !== 'codex' &&
          (request.codexModel !== undefined || request.codexReasoningEffort !== undefined)) {
        invalid(channel, 'Codex model settings require runtime "codex"');
      }
      nullableId(channel, request.defaultRepositoryId, 'defaultRepositoryId');
      return;
    }
    case IPC.RepositoryImport: {
      const request = record(channel, payload);
      exactKeys(channel, request, ['path', 'name']);
      stringValue(channel, request.path, 'path', { max: 32_768 });
      optionalString(channel, request.name, 'name', { max: 200, allowEmpty: true });
      return;
    }
    case IPC.WorkspaceDescribe:
      validateWorkspaceTarget(channel, payload);
      return;
    case IPC.WorkspaceRemoveBinding:
      validateIdRequest(channel, payload, 'workspaceBindingId');
      return;
    case IPC.ClipboardReadText:
      voidRequest(channel, payload);
      return;
    case IPC.ClipboardWriteText: {
      const request = record(channel, payload);
      exactKeys(channel, request, ['text']);
      stringValue(channel, request.text, 'text', { max: 2_000_000 });
      return;
    }
    case IPC.PtyCreate:
      validatePtyCreate(channel, payload);
      return;
    case IPC.PtyWrite: {
      const request = record(channel, payload);
      exactKeys(channel, request, ['sessionId', 'dataBase64']);
      id(channel, request.sessionId, 'sessionId');
      base64(channel, request.dataBase64, 'dataBase64', 1_400_000);
      return;
    }
    case IPC.PtyResize: {
      const request = record(channel, payload);
      exactKeys(channel, request, ['sessionId', 'cols', 'rows']);
      id(channel, request.sessionId, 'sessionId');
      for (const field of ['cols', 'rows'] as const) {
        const value = request[field];
        if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 2_000) {
          invalid(channel, `${field} must be an integer from 1 to 2000`);
        }
      }
      return;
    }
    case IPC.PtyKill:
    case IPC.PtyAttach:
      validateIdRequest(channel, payload, 'sessionId');
      return;
    case IPC.PtyCancelTasks:
      validatePtyCancel(channel, payload);
      return;
    case IPC.RuntimeDiagnose: {
      const request = record(channel, payload);
      exactKeys(channel, request, ['agentId']);
      optionalId(channel, request.agentId, 'agentId');
      return;
    }
    case IPC.RunCreate:
      validateRunCreate(channel, payload);
      return;
    case IPC.RunDelete:
    case IPC.RunApprovalDiff:
      validateIdRequest(channel, payload, 'runId');
      return;
    case IPC.PtyActivitySnapshot:
      validateIdRequest(channel, payload, 'sessionId');
      return;
    case IPC.RunTaskActivity:
      validateIdRequest(channel, payload, 'taskId');
      return;
    case IPC.RunStart:
    case IPC.RunCancel:
      validateRunLifecycle(channel, payload);
      return;
    case IPC.RunPauseTeam:
    case IPC.RunResumeTeam:
      validateTeamPause(channel, payload);
      return;
    case IPC.RunEvents:
      validateRunEvents(channel, payload);
      return;
    case IPC.RunGetSummary: {
      const request = record(channel, payload);
      exactKeys(channel, request, ['runId']);
      optionalId(channel, request.runId, 'runId');
      return;
    }
    case IPC.RunApprovalResolve: {
      const request = record(channel, payload);
      exactKeys(channel, request, ['approvalId', 'decision', 'commandId']);
      id(channel, request.approvalId, 'approvalId');
      enumValue(channel, request.decision, 'decision', ['approve', 'reject']);
      commandId(channel, request.commandId);
      return;
    }
    case IPC.RunTaskCreate: {
      const request = record(channel, payload);
      exactKeys(channel, request, ['runId', 'participantId', 'prompt']);
      id(channel, request.runId, 'runId');
      id(channel, request.participantId, 'participantId');
      stringValue(channel, request.prompt, 'prompt', { max: 8_000 });
      return;
    }
    case IPC.RunTaskFail: {
      const request = record(channel, payload);
      exactKeys(channel, request, ['taskId', 'error']);
      id(channel, request.taskId, 'taskId');
      stringValue(channel, request.error, 'error', { max: 8_000 });
      return;
    }
    case IPC.RunArtifactCreate:
      validateArtifact(channel, payload);
      return;
    case IPC.GitStatus:
    case IPC.FsAgentFiles:
      validateWorkspaceTarget(channel, payload);
      return;
    case IPC.GitDiff:
    case IPC.FsRead:
    case IPC.FsPathInfo:
    case IPC.FsReveal:
    case IPC.FsOpenPath:
    case IPC.FsDelete:
      validateAgentPath(channel, payload, false);
      return;
    case IPC.FsRename:
      validateFsRename(channel, payload);
      return;
    case IPC.FsTree:
      validateAgentPath(channel, payload, true);
      return;
    default: {
      const exhaustive: never = channel;
      invalid(String(exhaustive), 'unknown channel');
    }
  }
}
