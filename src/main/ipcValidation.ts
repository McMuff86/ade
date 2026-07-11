/** Runtime validation for every renderer -> main IPC request. */

import { IPC, type IpcInvokeMap } from '../shared/ipc';

type RecordValue = Record<string, unknown>;

const RUNTIMES = ['claude', 'codex', 'opencode', 'grok', 'gemini', 'ollama', 'shell', 'custom'] as const;
const PERMISSION_MODES = ['default', 'accept-edits', 'bypass'] as const;
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
  exactKeys(channel, request, ['name', 'photo', 'repoPath', 'kind']);
  stringValue(channel, request.name, 'name', { max: 200 });
  filename(channel, request.photo, 'photo');
  optionalString(channel, request.repoPath, 'repoPath', { max: 32_768 });
  if (request.kind !== undefined) enumValue(channel, request.kind, 'kind', CATEGORY_KINDS);
}

function validateAgentInput(channel: string, payload: unknown, update: boolean): void {
  const request = record(channel, payload);
  const common = ['name', 'role', 'runtime', 'permissionMode', 'customCommand', 'ollamaModel'];
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
  if (!update) {
    filename(channel, request.photo, 'photo');
    if (request.teamRole !== undefined) enumValue(channel, request.teamRole, 'teamRole', TEAM_ROLES);
  }
}

function validatePtyCreate(channel: string, payload: unknown): void {
  const request = record(channel, payload);
  exactKeys(channel, request, ['agentId', 'task', 'dispatchId', 'runTaskId']);
  id(channel, request.agentId, 'agentId');
  optionalString(channel, request.task, 'task', { max: 8_000, allowEmpty: true });
  optionalId(channel, request.dispatchId, 'dispatchId');
  optionalId(channel, request.runTaskId, 'runTaskId');
}

function validatePtyCancel(channel: string, payload: unknown): void {
  const request = record(channel, payload);
  exactKeys(channel, request, ['agentIds', 'runTaskIds']);
  ids(channel, request.agentIds, 'agentIds');
  ids(channel, request.runTaskIds, 'runTaskIds');
}

function validateRunCreate(channel: string, payload: unknown): void {
  const request = record(channel, payload);
  exactKeys(channel, request, ['name', 'goal', 'participants', 'budget']);
  stringValue(channel, request.name, 'name', { max: 200 });
  optionalString(channel, request.goal, 'goal', { max: 8_000, allowEmpty: true });
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
  exactKeys(channel, request, ['agentId', 'path']);
  id(channel, request.agentId, 'agentId');
  if (pathOptional) {
    if (request.path !== undefined) relativePath(channel, request.path, true);
  } else {
    relativePath(channel, request.path, false);
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
      validateIdRequest(channel, payload, 'id');
      return;
    case IPC.AgentCreate:
      validateAgentInput(channel, payload, false);
      return;
    case IPC.AgentUpdate:
      validateAgentInput(channel, payload, true);
      return;
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
    case IPC.RunStart:
    case IPC.RunCancel:
      validateIdRequest(channel, payload, 'runId');
      return;
    case IPC.RunApprovalResolve: {
      const request = record(channel, payload);
      exactKeys(channel, request, ['approvalId', 'decision']);
      id(channel, request.approvalId, 'approvalId');
      enumValue(channel, request.decision, 'decision', ['approve', 'reject']);
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
      validateIdRequest(channel, payload, 'agentId');
      return;
    case IPC.GitDiff:
    case IPC.FsRead:
      validateAgentPath(channel, payload, false);
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
