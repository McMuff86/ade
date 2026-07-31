import { createHash } from 'node:crypto';
import type {
  CategoryKind,
  CodexReasoningEffort,
  MemorySettings,
  PermissionMode,
  RuntimeId,
  TeamRole,
  ThemeName,
} from './types';
import type { ExecutionBackendId } from './executionBackends';

export const WORKSPACE_BUNDLE_FORMAT = 'ade-workspace-bundle' as const;
export const WORKSPACE_BUNDLE_VERSION = 1 as const;
export const WORKSPACE_BUNDLE_MAX_BYTES = 12 * 1024 * 1024;
export const WORKSPACE_BUNDLE_MAX_ASSET_BYTES = 2 * 1024 * 1024;
export const WORKSPACE_BUNDLE_MAX_DECODED_ASSET_BYTES = 8 * 1024 * 1024;
export const WORKSPACE_BUNDLE_MAX_MEMORY_CHARS = 32_000;
export const WORKSPACE_BUNDLE_MAX_PORTABLE_MEMORY_BYTES = 4 * 1024 * 1024;

export type WorkspaceBundleSourcePlatform = 'win32' | 'linux' | 'darwin';
export type WorkspaceBundlePathStyle = 'windows' | 'posix' | 'unknown';
export type WorkspaceImportItemStatus = 'ready' | 'reused' | 'needs-mapping' | 'conflict' | 'skipped' | 'invalid';

export interface WorkspaceBundleNotice {
  code: string;
  subjectType: 'bundle' | 'repository' | 'category' | 'agent' | 'template' | 'asset';
  subjectId?: string;
  message: string;
}

export interface WorkspaceBundleRepository {
  id: string;
  name: string;
  remoteIdentity?: string;
  sourceBackend: ExecutionBackendId;
  sourcePathStyle: WorkspaceBundlePathStyle;
  sourceLeafName: string;
}

export interface WorkspaceBundleCategory {
  id: string;
  name: string;
  agentIds: string[];
  defaultRepositoryId?: string;
  kind?: CategoryKind;
  photoAssetId?: string;
}

export interface WorkspaceBundleMemory {
  memory: string;
  user: string;
}

export interface WorkspaceBundleAgent {
  id: string;
  categoryId: string;
  name: string;
  role?: string;
  runtime: RuntimeId;
  permissionMode: PermissionMode;
  ollamaModel?: string;
  codexModel?: string;
  codexReasoningEffort?: CodexReasoningEffort;
  defaultRepositoryId?: string;
  teamRole?: TeamRole;
  photoAssetId?: string;
  memory?: WorkspaceBundleMemory;
  sourceHomeBackend: ExecutionBackendId;
  sourceHomePathStyle: WorkspaceBundlePathStyle;
}

export interface WorkspaceBundleAgentTemplate {
  id: string;
  name: string;
  role?: string;
  runtime: RuntimeId;
  permissionMode: PermissionMode;
  ollamaModel?: string;
  codexModel?: string;
  codexReasoningEffort?: CodexReasoningEffort;
  photoAssetId?: string;
  memorySeed: WorkspaceBundleMemory;
}

export interface WorkspaceBundleAsset {
  id: string;
  kind: 'photo';
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  sha256: string;
  dataBase64: string;
}

export interface WorkspaceBundleSettings {
  theme: ThemeName;
  memory: MemorySettings;
}

export interface AdeWorkspaceBundleV1 {
  format: typeof WORKSPACE_BUNDLE_FORMAT;
  version: typeof WORKSPACE_BUNDLE_VERSION;
  exportedAt: string;
  sourcePlatform: WorkspaceBundleSourcePlatform;
  repositories: WorkspaceBundleRepository[];
  categories: WorkspaceBundleCategory[];
  agents: WorkspaceBundleAgent[];
  agentTemplates: WorkspaceBundleAgentTemplate[];
  assets: WorkspaceBundleAsset[];
  settings: WorkspaceBundleSettings;
  notices: WorkspaceBundleNotice[];
}

const RUNTIMES = new Set<RuntimeId>([
  'claude', 'codex', 'opencode', 'grok', 'gemini', 'ollama', 'shell', 'custom',
]);
const PERMISSION_MODES = new Set<PermissionMode>(['default', 'accept-edits', 'bypass']);
const REASONING_EFFORTS = new Set<CodexReasoningEffort>([
  'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra',
]);
const CATEGORY_KINDS = new Set<CategoryKind>(['plain', 'orchestrator', 'team']);
const TEAM_ROLES = new Set<TeamRole>(['orchestrator', 'lead', 'worker']);
const PATH_STYLES = new Set<WorkspaceBundlePathStyle>(['windows', 'posix', 'unknown']);
const SOURCE_PLATFORMS = new Set<WorkspaceBundleSourcePlatform>(['win32', 'linux', 'darwin']);
const ASSET_MIMES = new Set<WorkspaceBundleAsset['mime']>(['image/png', 'image/jpeg', 'image/webp']);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const REMOTE_IDENTITY_PATTERN = /^[A-Za-z0-9.-]+(?::[1-9]\d{0,4})?(?:\/[A-Za-z0-9_.-]+){2,10}$/;

export function isWorkspaceRemoteIdentity(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 300
      || !REMOTE_IDENTITY_PATTERN.test(value)) return false;
  const [authority, ...pathParts] = value.split('/');
  if (!authority || pathParts.length < 2 || pathParts.length > 10) return false;
  const separator = authority.lastIndexOf(':');
  const host = separator < 0 ? authority : authority.slice(0, separator);
  const port = separator < 0 ? undefined : authority.slice(separator + 1);
  const validHost = host.length <= 253 && host.split('.').every((label) => (
    label.length > 0 && label.length <= 63
      && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
  ));
  return validHost && (!port || (/^[1-9]\d{0,4}$/.test(port) && Number(port) <= 65_535));
}

export function isWorkspaceBundleId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

export function isWorkspaceBundleIdentityName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
    && !/[\0-\x1f\x7f]/.test(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`workspace bundle: ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const set = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !set.has(key));
  if (unknown) throw new Error(`workspace bundle: unknown field ${label}.${unknown}`);
}

function array(value: unknown, label: string, max = 1_000): unknown[] {
  if (!Array.isArray(value)) throw new Error(`workspace bundle: ${label} must be an array`);
  if (value.length > max) throw new Error(`workspace bundle: ${label} exceeds ${max} items`);
  return value;
}

function text(value: unknown, label: string, max: number, options: { optional?: boolean; pattern?: RegExp } = {}): string | undefined {
  if (value === undefined && options.optional) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > max || value.includes('\0')) {
    throw new Error(`workspace bundle: ${label} must contain 1-${max} characters`);
  }
  if (options.pattern && !options.pattern.test(value)) {
    throw new Error(`workspace bundle: ${label} has an invalid format`);
  }
  return value;
}

function id(value: unknown, label: string): string {
  if (!isWorkspaceBundleId(value)) {
    throw new Error(`workspace bundle: ${label} has an invalid format`);
  }
  return value;
}

function identityName(value: unknown, label: string): string {
  if (!isWorkspaceBundleIdentityName(value)) {
    throw new Error(`workspace bundle: ${label} has an invalid format`);
  }
  return value;
}

function optionalId(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : id(value, label);
}

function enumeration<T extends string>(value: unknown, values: Set<T>, label: string): T {
  if (typeof value !== 'string' || !values.has(value as T)) {
    throw new Error(`workspace bundle: ${label} is invalid`);
  }
  return value as T;
}

function backend(value: unknown, label: string): ExecutionBackendId {
  if (value === 'native') return value;
  if (typeof value === 'string' && /^wsl:[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(value)) {
    return value as ExecutionBackendId;
  }
  throw new Error(`workspace bundle: ${label} is not a valid execution backend`);
}

function unique(items: readonly { id: string }[], label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`workspace bundle: duplicate ${label} id ${item.id}`);
    seen.add(item.id);
  }
}

function parseMemory(value: unknown, label: string): WorkspaceBundleMemory {
  const raw = record(value, label);
  exactKeys(raw, ['memory', 'user'], label);
  return {
    memory: typeof raw.memory === 'string' && raw.memory.length <= WORKSPACE_BUNDLE_MAX_MEMORY_CHARS
      ? raw.memory
      : (() => { throw new Error(`workspace bundle: ${label}.memory exceeds character limit`); })(),
    user: typeof raw.user === 'string' && raw.user.length <= WORKSPACE_BUNDLE_MAX_MEMORY_CHARS
      ? raw.user
      : (() => { throw new Error(`workspace bundle: ${label}.user exceeds character limit`); })(),
  };
}

function parseRepository(value: unknown, index: number): WorkspaceBundleRepository {
  const label = `repositories[${index}]`;
  const raw = record(value, label);
  exactKeys(raw, ['id', 'name', 'remoteIdentity', 'sourceBackend', 'sourcePathStyle', 'sourceLeafName'], label);
  const remoteIdentity = text(raw.remoteIdentity, `${label}.remoteIdentity`, 300, {
    optional: true,
    pattern: REMOTE_IDENTITY_PATTERN,
  });
  if (remoteIdentity && !isWorkspaceRemoteIdentity(remoteIdentity)) {
    throw new Error(`workspace bundle: ${label}.remoteIdentity has an invalid port`);
  }
  return {
    id: id(raw.id, `${label}.id`),
    name: identityName(raw.name, `${label}.name`),
    ...(remoteIdentity ? { remoteIdentity } : {}),
    sourceBackend: backend(raw.sourceBackend, `${label}.sourceBackend`),
    sourcePathStyle: enumeration(raw.sourcePathStyle, PATH_STYLES, `${label}.sourcePathStyle`),
    sourceLeafName: text(raw.sourceLeafName, `${label}.sourceLeafName`, 200)!,
  };
}

function parseCategory(value: unknown, index: number): WorkspaceBundleCategory {
  const label = `categories[${index}]`;
  const raw = record(value, label);
  exactKeys(raw, ['id', 'name', 'agentIds', 'defaultRepositoryId', 'kind', 'photoAssetId'], label);
  const kind = raw.kind === undefined ? undefined : enumeration(raw.kind, CATEGORY_KINDS, `${label}.kind`);
  const agentIds = array(raw.agentIds, `${label}.agentIds`, 500)
    .map((entry, i) => id(entry, `${label}.agentIds[${i}]`));
  if (new Set(agentIds).size !== agentIds.length) {
    throw new Error(`workspace bundle: ${label}.agentIds contains duplicate membership`);
  }
  return {
    id: id(raw.id, `${label}.id`),
    name: identityName(raw.name, `${label}.name`),
    agentIds,
    ...(optionalId(raw.defaultRepositoryId, `${label}.defaultRepositoryId`) ? {
      defaultRepositoryId: optionalId(raw.defaultRepositoryId, `${label}.defaultRepositoryId`),
    } : {}),
    ...(kind ? { kind } : {}),
    ...(optionalId(raw.photoAssetId, `${label}.photoAssetId`) ? {
      photoAssetId: optionalId(raw.photoAssetId, `${label}.photoAssetId`),
    } : {}),
  };
}

function parseAgent(value: unknown, index: number): WorkspaceBundleAgent {
  const label = `agents[${index}]`;
  const raw = record(value, label);
  exactKeys(raw, [
    'id', 'categoryId', 'name', 'role', 'runtime', 'permissionMode', 'ollamaModel',
    'codexModel', 'codexReasoningEffort', 'defaultRepositoryId', 'teamRole',
    'photoAssetId', 'memory', 'sourceHomeBackend', 'sourceHomePathStyle',
  ], label);
  const runtime = enumeration(raw.runtime, RUNTIMES, `${label}.runtime`);
  const effort = raw.codexReasoningEffort === undefined
    ? undefined
    : enumeration(raw.codexReasoningEffort, REASONING_EFFORTS, `${label}.codexReasoningEffort`);
  const teamRole = raw.teamRole === undefined ? undefined : enumeration(raw.teamRole, TEAM_ROLES, `${label}.teamRole`);
  return {
    id: id(raw.id, `${label}.id`),
    categoryId: id(raw.categoryId, `${label}.categoryId`),
    name: identityName(raw.name, `${label}.name`),
    ...(text(raw.role, `${label}.role`, 500, { optional: true }) ? { role: raw.role as string } : {}),
    runtime,
    permissionMode: enumeration(raw.permissionMode, PERMISSION_MODES, `${label}.permissionMode`),
    ...(text(raw.ollamaModel, `${label}.ollamaModel`, 200, { optional: true }) ? { ollamaModel: raw.ollamaModel as string } : {}),
    ...(text(raw.codexModel, `${label}.codexModel`, 200, { optional: true }) ? { codexModel: raw.codexModel as string } : {}),
    ...(effort ? { codexReasoningEffort: effort } : {}),
    ...(optionalId(raw.defaultRepositoryId, `${label}.defaultRepositoryId`) ? { defaultRepositoryId: raw.defaultRepositoryId as string } : {}),
    ...(teamRole ? { teamRole } : {}),
    ...(optionalId(raw.photoAssetId, `${label}.photoAssetId`) ? { photoAssetId: raw.photoAssetId as string } : {}),
    ...(raw.memory === undefined ? {} : { memory: parseMemory(raw.memory, `${label}.memory`) }),
    sourceHomeBackend: backend(raw.sourceHomeBackend, `${label}.sourceHomeBackend`),
    sourceHomePathStyle: enumeration(raw.sourceHomePathStyle, PATH_STYLES, `${label}.sourceHomePathStyle`),
  };
}

function parseTemplate(value: unknown, index: number): WorkspaceBundleAgentTemplate {
  const label = `agentTemplates[${index}]`;
  const raw = record(value, label);
  exactKeys(raw, [
    'id', 'name', 'role', 'runtime', 'permissionMode', 'ollamaModel', 'codexModel',
    'codexReasoningEffort', 'photoAssetId', 'memorySeed',
  ], label);
  const effort = raw.codexReasoningEffort === undefined
    ? undefined
    : enumeration(raw.codexReasoningEffort, REASONING_EFFORTS, `${label}.codexReasoningEffort`);
  return {
    id: id(raw.id, `${label}.id`),
    name: identityName(raw.name, `${label}.name`),
    ...(text(raw.role, `${label}.role`, 500, { optional: true }) ? { role: raw.role as string } : {}),
    runtime: enumeration(raw.runtime, RUNTIMES, `${label}.runtime`),
    permissionMode: enumeration(raw.permissionMode, PERMISSION_MODES, `${label}.permissionMode`),
    ...(text(raw.ollamaModel, `${label}.ollamaModel`, 200, { optional: true }) ? { ollamaModel: raw.ollamaModel as string } : {}),
    ...(text(raw.codexModel, `${label}.codexModel`, 200, { optional: true }) ? { codexModel: raw.codexModel as string } : {}),
    ...(effort ? { codexReasoningEffort: effort } : {}),
    ...(optionalId(raw.photoAssetId, `${label}.photoAssetId`) ? { photoAssetId: raw.photoAssetId as string } : {}),
    memorySeed: parseMemory(raw.memorySeed, `${label}.memorySeed`),
  };
}

function parseAsset(value: unknown, index: number): WorkspaceBundleAsset {
  const label = `assets[${index}]`;
  const raw = record(value, label);
  exactKeys(raw, ['id', 'kind', 'mime', 'sha256', 'dataBase64'], label);
  if (raw.kind !== 'photo') throw new Error(`workspace bundle: ${label}.kind is invalid`);
  const dataBase64 = text(raw.dataBase64, `${label}.dataBase64`, Math.ceil(WORKSPACE_BUNDLE_MAX_ASSET_BYTES * 4 / 3) + 8)!;
  const bytes = Buffer.from(dataBase64, 'base64');
  if (bytes.byteLength > WORKSPACE_BUNDLE_MAX_ASSET_BYTES || bytes.toString('base64') !== dataBase64) {
    throw new Error(`workspace bundle: ${label} has invalid or oversized base64 data`);
  }
  const mime = enumeration(raw.mime, ASSET_MIMES, `${label}.mime`);
  if (!isValidWorkspaceImageBytes(mime, bytes)) {
    throw new Error(`workspace bundle: ${label} data does not match its image MIME type`);
  }
  const sha256 = text(raw.sha256, `${label}.sha256`, 64, { pattern: SHA256_PATTERN })!;
  if (createSha256(bytes) !== sha256) {
    throw new Error(`workspace bundle: asset ${String(raw.id)} digest mismatch`);
  }
  return {
    id: id(raw.id, `${label}.id`),
    kind: 'photo',
    mime,
    sha256,
    dataBase64,
  };
}

export function isValidWorkspaceImageBytes(
  mime: string,
  bytes: Buffer,
): boolean {
  if (mime === 'image/png') {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime !== 'image/webp') return false;
  return bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
}

function parseNotice(value: unknown, index: number): WorkspaceBundleNotice {
  const label = `notices[${index}]`;
  const raw = record(value, label);
  exactKeys(raw, ['code', 'subjectType', 'subjectId', 'message'], label);
  const subjectTypes = new Set<WorkspaceBundleNotice['subjectType']>([
    'bundle', 'repository', 'category', 'agent', 'template', 'asset',
  ]);
  return {
    code: text(raw.code, `${label}.code`, 100, { pattern: /^[a-z0-9-]+$/ })!,
    subjectType: enumeration(raw.subjectType, subjectTypes, `${label}.subjectType`),
    ...(optionalId(raw.subjectId, `${label}.subjectId`) ? { subjectId: raw.subjectId as string } : {}),
    message: text(raw.message, `${label}.message`, 1_000)!,
  };
}

export function parseWorkspaceBundle(value: unknown): AdeWorkspaceBundleV1 {
  const raw = record(value, 'root');
  exactKeys(raw, [
    'format', 'version', 'exportedAt', 'sourcePlatform', 'repositories', 'categories',
    'agents', 'agentTemplates', 'assets', 'settings', 'notices',
  ], 'root');
  if (raw.format !== WORKSPACE_BUNDLE_FORMAT) throw new Error('workspace bundle: invalid format');
  if (raw.version !== WORKSPACE_BUNDLE_VERSION) throw new Error('workspace bundle: unsupported version');
  const exportedAt = text(raw.exportedAt, 'exportedAt', 64)!;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(exportedAt)
      || new Date(exportedAt).toISOString() !== exportedAt) {
    throw new Error('workspace bundle: exportedAt must be a canonical ISO-8601 UTC timestamp');
  }
  const repositories = array(raw.repositories, 'repositories', 500).map(parseRepository);
  const categories = array(raw.categories, 'categories', 500).map(parseCategory);
  const agents = array(raw.agents, 'agents', 1_000).map(parseAgent);
  const agentTemplates = array(raw.agentTemplates, 'agentTemplates', 1_000).map(parseTemplate);
  let portableMemoryBytes = 0;
  const consumePortableMemory = (memory: string, user: string): void => {
    portableMemoryBytes += Buffer.byteLength(memory) + Buffer.byteLength(user);
    if (portableMemoryBytes > WORKSPACE_BUNDLE_MAX_PORTABLE_MEMORY_BYTES) {
      throw new Error('workspace bundle: aggregate portable memory size exceeds bundle limit');
    }
  };
  for (const agent of agents) {
    if (agent.memory) consumePortableMemory(agent.memory.memory, agent.memory.user);
  }
  for (const template of agentTemplates) {
    consumePortableMemory(template.memorySeed.memory, template.memorySeed.user);
  }
  const assets: WorkspaceBundleAsset[] = [];
  let decodedAssetBytes = 0;
  const assetValues = array(raw.assets, 'assets', 2_000);
  for (let index = 0; index < assetValues.length; index += 1) {
    const asset = parseAsset(assetValues[index], index);
    decodedAssetBytes += Buffer.byteLength(asset.dataBase64, 'base64');
    if (decodedAssetBytes > WORKSPACE_BUNDLE_MAX_DECODED_ASSET_BYTES) {
      throw new Error('workspace bundle: aggregate decoded asset size exceeds bundle limit');
    }
    assets.push(asset);
  }
  const settingsRaw = record(raw.settings, 'settings');
  exactKeys(settingsRaw, ['theme', 'memory'], 'settings');
  const memoryRaw = record(settingsRaw.memory, 'settings.memory');
  exactKeys(memoryRaw, ['enabled', 'userProfileEnabled', 'memoryCharLimit', 'userCharLimit'], 'settings.memory');
  if (typeof memoryRaw.enabled !== 'boolean' || typeof memoryRaw.userProfileEnabled !== 'boolean') {
    throw new Error('workspace bundle: memory settings booleans are invalid');
  }
  const memoryCharLimit = memoryRaw.memoryCharLimit;
  const userCharLimit = memoryRaw.userCharLimit;
  if (typeof memoryCharLimit !== 'number' || !Number.isInteger(memoryCharLimit)
      || memoryCharLimit < 0 || memoryCharLimit > 1_000_000
      || typeof userCharLimit !== 'number' || !Number.isInteger(userCharLimit)
      || userCharLimit < 0 || userCharLimit > 1_000_000) {
    throw new Error('workspace bundle: memory settings limits are invalid');
  }
  unique(repositories, 'repository');
  unique(categories, 'category');
  unique(agents, 'agent');
  unique(agentTemplates, 'template');
  unique(assets, 'asset');

  const repositoryIds = new Set(repositories.map((item) => item.id));
  const categoryIds = new Set(categories.map((item) => item.id));
  const agentIds = new Set(agents.map((item) => item.id));
  const assetIds = new Set(assets.map((item) => item.id));
  for (const category of categories) {
    if (category.defaultRepositoryId && !repositoryIds.has(category.defaultRepositoryId)) {
      throw new Error(`workspace bundle: category ${category.id} references an unknown repository`);
    }
    for (const agentId of category.agentIds) {
      if (!agentIds.has(agentId)) throw new Error(`workspace bundle: category ${category.id} references an unknown agent`);
    }
    if (category.photoAssetId && !assetIds.has(category.photoAssetId)) {
      throw new Error(`workspace bundle: category ${category.id} references an unknown asset`);
    }
  }
  for (const agent of agents) {
    if (!categoryIds.has(agent.categoryId)) throw new Error(`workspace bundle: agent ${agent.id} references an unknown category`);
    const category = categories.find((entry) => entry.id === agent.categoryId)!;
    if (!category.agentIds.includes(agent.id)) {
      throw new Error(`workspace bundle: agent ${agent.id} is missing from reciprocal category membership`);
    }
    if (agent.defaultRepositoryId && !repositoryIds.has(agent.defaultRepositoryId)) {
      throw new Error(`workspace bundle: agent ${agent.id} references an unknown repository`);
    }
    if (agent.photoAssetId && !assetIds.has(agent.photoAssetId)) {
      throw new Error(`workspace bundle: agent ${agent.id} references an unknown asset`);
    }
  }
  for (const template of agentTemplates) {
    if (template.photoAssetId && !assetIds.has(template.photoAssetId)) {
      throw new Error(`workspace bundle: template ${template.id} references an unknown asset`);
    }
  }
  for (const category of categories) {
    for (const memberId of category.agentIds) {
      const agent = agents.find((entry) => entry.id === memberId)!;
      if (agent.categoryId !== category.id) {
        throw new Error(`workspace bundle: category ${category.id} has inconsistent agent membership`);
      }
    }
  }

  return {
    format: WORKSPACE_BUNDLE_FORMAT,
    version: WORKSPACE_BUNDLE_VERSION,
    exportedAt,
    sourcePlatform: enumeration(raw.sourcePlatform, SOURCE_PLATFORMS, 'sourcePlatform'),
    repositories,
    categories,
    agents,
    agentTemplates,
    assets,
    settings: {
      theme: enumeration(settingsRaw.theme, new Set<ThemeName>(['dark', 'light']), 'settings.theme'),
      memory: {
        enabled: memoryRaw.enabled,
        userProfileEnabled: memoryRaw.userProfileEnabled,
        memoryCharLimit,
        userCharLimit,
      },
    },
    notices: array(raw.notices, 'notices', 5_000).map(parseNotice),
  };
}

function createSha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function serializeWorkspaceBundle(bundle: AdeWorkspaceBundleV1): string {
  const validated = parseWorkspaceBundle(bundle);
  const text = `${JSON.stringify(validated, null, 2)}\n`;
  if (Buffer.byteLength(text, 'utf8') > WORKSPACE_BUNDLE_MAX_BYTES) {
    throw new Error('workspace bundle: serialized bundle exceeds size limit');
  }
  return text;
}

export function parseSerializedWorkspaceBundle(text: string): AdeWorkspaceBundleV1 {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > WORKSPACE_BUNDLE_MAX_BYTES) {
    throw new Error('workspace bundle: serialized input exceeds size limit');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('workspace bundle: serialized input is not valid JSON');
  }
  return parseWorkspaceBundle(parsed);
}
