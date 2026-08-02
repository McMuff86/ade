import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
import { isExecutionBackendId, type ExecutionBackendId } from '../../shared/executionBackends';
import {
  isWorkspaceBundleId,
  isWorkspaceBundleIdentityName,
  isWorkspaceRemoteIdentity,
  parseWorkspaceBundle,
  type AdeWorkspaceBundleV1,
  type WorkspaceBundleAgent,
  type WorkspaceBundleCategory,
  type WorkspaceBundleRepository,
  type WorkspaceImportItemStatus,
} from '../../shared/workspaceBundle';
import type { AdeConfig } from '../../shared/types';

export interface WorkspaceTargetMapping {
  backend: ExecutionBackendId;
  path: string;
}

export interface WorkspaceImportMappings {
  repositories: Record<string, WorkspaceTargetMapping | undefined>;
  agentHomes: Record<string, WorkspaceTargetMapping | undefined>;
  skip?: {
    repositories?: Record<string, true>;
    categories?: Record<string, true>;
    agents?: Record<string, true>;
    agentTemplates?: Record<string, true>;
  };
  settings?: 'keep-target' | 'use-bundle';
  names?: {
    repositories?: Record<string, string>;
    categories?: Record<string, string>;
    agents?: Record<string, string>;
    agentTemplates?: Record<string, string>;
  };
}

export type WorkspaceRepositoryProbeResult =
  | { ok: true; canonicalPath: string; commonGitDir?: string; remoteIdentity?: string }
  | { ok: false; reason: string; remediation: string };

export type WorkspaceAgentHomeProbeResult =
  | {
      ok: true;
      canonicalPath: string;
      occupancy?: 'absent' | 'empty-directory' | 'nonempty-directory';
    }
  | { ok: false; reason: string; remediation: string };

export interface WorkspaceTargetProbe {
  repository(
    source: WorkspaceBundleRepository,
    target: WorkspaceTargetMapping,
  ): Promise<WorkspaceRepositoryProbeResult>;
  agentHome(target: WorkspaceTargetMapping): Promise<WorkspaceAgentHomeProbeResult>;
  canonicalPath(target: WorkspaceTargetMapping): Promise<WorkspaceAgentHomeProbeResult>;
}

export interface WorkspaceImportPlanItem {
  sourceId: string;
  name: string;
  status: WorkspaceImportItemStatus;
  reason?: string;
  remediation?: string;
  targetId?: string;
  target?: WorkspaceTargetMapping;
  canonicalPath?: string;
  commonGitDir?: string;
}

export interface WorkspaceImportPlan {
  token: string;
  targetStateHash: string;
  bundle: AdeWorkspaceBundleV1;
  repositories: WorkspaceImportPlanItem[];
  agentHomes: WorkspaceImportPlanItem[];
  categories: WorkspaceImportPlanItem[];
  agents: WorkspaceImportPlanItem[];
  agentTemplates: WorkspaceImportPlanItem[];
  idMap: {
    repositories: Record<string, string>;
    categories: Record<string, string>;
    agents: Record<string, string>;
    templates: Record<string, string>;
  };
  settingsDecision: 'keep-target' | 'use-bundle';
  canApplyFully: boolean;
}

export interface WorkspaceImportPlannerOptions {
  hostPlatform: NodeJS.Platform;
}

function stableTargetId(kind: string, sourceId: string, occupied: Set<string>): string {
  const base = `import-${kind}-${createHash('sha256').update(`${kind}\0${sourceId}`).digest('hex').slice(0, 24)}`;
  let candidate = base;
  let suffix = 1;
  while (occupied.has(candidate)) candidate = `${base}-${suffix++}`;
  occupied.add(candidate);
  return candidate;
}

function unsupportedBackend(
  target: WorkspaceTargetMapping,
  hostPlatform: NodeJS.Platform,
): { reason: string; remediation: string } | null {
  if (target.backend !== 'native' && hostPlatform !== 'win32') {
    return {
      reason: 'A wsl:<distribution> backend is available only to the Windows ADE host.',
      remediation: 'Choose the native backend when importing inside WSL/Linux, or run the import from Windows ADE.',
    };
  }
  if (!target.path.trim()) {
    return { reason: 'The mapped target path is empty.', remediation: 'Choose an absolute target path.' };
  }
  if (target.backend === 'native' && hostPlatform === 'win32') {
    if (!/^[A-Za-z]:[\\/]/.test(target.path) && !target.path.startsWith('\\\\')) {
      return { reason: 'The Windows native target path is not absolute.', remediation: 'Choose an absolute Windows path.' };
    }
  } else if (!target.path.startsWith('/')) {
    return { reason: 'The POSIX target path is not absolute.', remediation: 'Choose an absolute Linux path.' };
  }
  return null;
}

function ownMapping(
  values: Record<string, WorkspaceTargetMapping | undefined>,
  sourceId: string,
): { target?: WorkspaceTargetMapping; error?: { reason: string; remediation: string } } {
  if (!Object.prototype.hasOwnProperty.call(values, sourceId) || values[sourceId] === undefined) return {};
  const value = values[sourceId] as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      error: {
        reason: 'The target mapping is malformed.',
        remediation: 'Choose the target backend and path again.',
      },
    };
  }
  const raw = value as Record<string, unknown>;
  const unknownField = Object.keys(raw).find((key) => key !== 'backend' && key !== 'path');
  if (unknownField) {
    return {
      error: {
        reason: `The target mapping contains an unknown field: ${unknownField}.`,
        remediation: 'Choose the target backend and path again.',
      },
    };
  }
  if (!isExecutionBackendId(raw.backend)) {
    return {
      error: {
        reason: 'The target mapping uses an invalid execution backend.',
        remediation: 'Choose native or an available wsl:<distribution> backend.',
      },
    };
  }
  if (typeof raw.path !== 'string' || raw.path.length === 0 || raw.path.length > 4_096 || raw.path.includes('\0')) {
    return {
      error: {
        reason: 'The target mapping path is invalid.',
        remediation: 'Choose a bounded absolute target path.',
      },
    };
  }
  return { target: { backend: raw.backend, path: raw.path } };
}

function folded(value: string): string {
  return value.toLowerCase();
}

function backendIdentityKey(backend: ExecutionBackendId): string {
  return backend === 'native' ? backend : `wsl:${folded(backend.slice(4))}`;
}

function remoteIdentitiesMatch(left: string, right: string): boolean {
  const split = (value: string): { host: string; path: string } | null => {
    const separator = value.indexOf('/');
    if (separator <= 0 || separator === value.length - 1) return null;
    return { host: folded(value.slice(0, separator)), path: value.slice(separator + 1) };
  };
  const leftParts = split(left);
  const rightParts = split(right);
  return Boolean(leftParts && rightParts
    && leftParts.host === rightParts.host && leftParts.path === rightParts.path);
}

function pathsOverlap(
  leftTarget: WorkspaceTargetMapping,
  leftPath: string,
  rightTarget: WorkspaceTargetMapping,
  rightPath: string,
  hostPlatform: NodeJS.Platform,
): boolean {
  if (backendIdentityKey(leftTarget.backend) !== backendIdentityKey(rightTarget.backend)) return false;
  const windows = leftTarget.backend === 'native' && hostPlatform === 'win32';
  const separator = windows ? '\\' : '/';
  const pathApi = windows ? win32 : posix;
  const normalize = (value: string): string => {
    const normalized = pathApi.normalize(value);
    const root = pathApi.parse(normalized).root;
    const withoutTrailing = normalized === root ? normalized : normalized.replace(/[\\/]+$/g, '');
    return windows ? folded(withoutTrailing) : withoutTrailing;
  };
  const left = normalize(leftPath);
  const right = normalize(rightPath);
  const leftRoot = normalize(pathApi.parse(left).root);
  const rightRoot = normalize(pathApi.parse(right).root);
  if (leftRoot !== rightRoot) return false;
  if (left === leftRoot || right === rightRoot) return true;
  return left === right || left.startsWith(`${right}${separator}`) || right.startsWith(`${left}${separator}`);
}

function pathsEqual(
  leftTarget: WorkspaceTargetMapping,
  leftPath: string,
  rightTarget: WorkspaceTargetMapping,
  rightPath: string,
  hostPlatform: NodeJS.Platform,
): boolean {
  if (backendIdentityKey(leftTarget.backend) !== backendIdentityKey(rightTarget.backend)) return false;
  const windows = leftTarget.backend === 'native' && hostPlatform === 'win32';
  const pathApi = windows ? win32 : posix;
  const normalize = (value: string): string => {
    const normalized = pathApi.normalize(value);
    const root = pathApi.parse(normalized).root;
    const result = normalized === root ? normalized : normalized.replace(/[\\/]+$/g, '');
    return windows ? folded(result) : result;
  };
  return normalize(leftPath) === normalize(rightPath);
}

function repositoryOverlapsPath(
  repository: { target?: WorkspaceTargetMapping; canonicalPath?: string; commonGitDir?: string },
  target: WorkspaceTargetMapping,
  path: string,
  hostPlatform: NodeJS.Platform,
): boolean {
  if (!repository.target || !repository.canonicalPath) return false;
  return [repository.canonicalPath, repository.commonGitDir]
    .filter((candidate): candidate is string => candidate !== undefined)
    .some((candidate) => pathsOverlap(repository.target!, candidate, target, path, hostPlatform));
}

function repositoriesOverlap(
  left: { target?: WorkspaceTargetMapping; canonicalPath?: string; commonGitDir?: string },
  right: { target?: WorkspaceTargetMapping; canonicalPath?: string; commonGitDir?: string },
  hostPlatform: NodeJS.Platform,
): boolean {
  if (!right.target || !right.canonicalPath) return false;
  return [right.canonicalPath, right.commonGitDir]
    .filter((candidate): candidate is string => candidate !== undefined)
    .some((candidate) => repositoryOverlapsPath(left, right.target!, candidate, hostPlatform));
}

function invalidProbePath(
  target: WorkspaceTargetMapping,
  canonicalPath: unknown,
  hostPlatform: NodeJS.Platform,
): { reason: string; remediation: string } | null {
  if (typeof canonicalPath !== 'string' || canonicalPath.length === 0
      || canonicalPath.length > 4_096 || /[\0-\x1f\x7f]/.test(canonicalPath)) {
    return {
      reason: 'Target verification returned an invalid canonical path.',
      remediation: 'Choose the target again and retry verification.',
    };
  }
  const unsupported = unsupportedBackend({ backend: target.backend, path: canonicalPath }, hostPlatform);
  if (unsupported) return unsupported;
  const windows = target.backend === 'native' && hostPlatform === 'win32';
  const pathApi = windows ? win32 : posix;
  if (!pathApi.isAbsolute(canonicalPath) || pathApi.normalize(canonicalPath) !== canonicalPath) {
    return {
      reason: 'Target verification returned a non-canonical path.',
      remediation: 'Choose the target again and retry verification.',
    };
  }
  return null;
}

function validateMappingContainer(
  value: unknown,
  allowedIds: Set<string>,
  label: string,
): asserts value is Record<string, WorkspaceTargetMapping | undefined> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`workspace import: ${label} mappings must be an object`);
  }
  const unknownId = Object.keys(value).find((sourceId) => !allowedIds.has(sourceId));
  if (unknownId) throw new Error(`workspace import: unknown ${label} mapping id ${unknownId}`);
}

function validateSkipContainer(value: unknown, allowedIds: Set<string>, label: string): Set<string> {
  if (value === undefined) return new Set();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`workspace import: ${label} skip decisions must be an object`);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const invalid = entries.find(([sourceId, decision]) => !allowedIds.has(sourceId) || decision !== true);
  if (invalid) throw new Error(`workspace import: invalid ${label} skip decision ${invalid[0]}`);
  return new Set(entries.map(([sourceId]) => sourceId));
}

function validateNameContainer(
  value: unknown,
  allowedIds: Set<string>,
  label: string,
): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`workspace import: ${label} names must be an object`);
  }
  const result: Record<string, string> = {};
  for (const [id, name] of Object.entries(value)) {
    if (!allowedIds.has(id)) throw new Error(`workspace import: ${label} names contain unknown source id ${id}`);
    if (!isWorkspaceBundleIdentityName(name) || name.trim() !== name) {
      throw new Error(`workspace import: ${label} name for ${id} is invalid`);
    }
    result[id] = name;
  }
  return result;
}

function invalidProbeResult(message: string): WorkspaceRepositoryProbeResult {
  return {
    ok: false,
    reason: message,
    remediation: 'Choose the target again and retry verification.',
  };
}

function validateRepositoryProbeResult(value: unknown): WorkspaceRepositoryProbeResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidProbeResult('Repository verification returned a malformed result.');
  }
  const raw = value as Record<string, unknown>;
  if (raw.ok === true) {
    if (Object.keys(raw).some((key) => !['ok', 'canonicalPath', 'commonGitDir', 'remoteIdentity'].includes(key))
        || typeof raw.canonicalPath !== 'string'
        || typeof raw.commonGitDir !== 'string'
        || (raw.remoteIdentity !== undefined && !isWorkspaceRemoteIdentity(raw.remoteIdentity))) {
      return invalidProbeResult('Repository verification returned malformed success data.');
    }
    return {
      ok: true,
      canonicalPath: raw.canonicalPath,
      commonGitDir: raw.commonGitDir as string,
      ...(raw.remoteIdentity === undefined ? {} : { remoteIdentity: raw.remoteIdentity as string }),
    };
  }
  if (raw.ok === false && Object.keys(raw).every((key) => ['ok', 'reason', 'remediation'].includes(key))
      && typeof raw.reason === 'string' && raw.reason.length > 0 && raw.reason.length <= 1_000
      && typeof raw.remediation === 'string' && raw.remediation.length > 0 && raw.remediation.length <= 1_000) {
    return { ok: false, reason: raw.reason, remediation: raw.remediation };
  }
  return invalidProbeResult('Repository verification returned a malformed result.');
}

function validateAgentHomeProbeResult(value: unknown): WorkspaceAgentHomeProbeResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'Agent-home verification returned a malformed result.', remediation: 'Choose the target again.' };
  }
  const raw = value as Record<string, unknown>;
  if (raw.ok === true && Object.keys(raw).every((key) => ['ok', 'canonicalPath', 'occupancy'].includes(key))
      && typeof raw.canonicalPath === 'string'
      && (raw.occupancy === undefined || ['absent', 'empty-directory', 'nonempty-directory'].includes(String(raw.occupancy)))) {
    return {
      ok: true,
      canonicalPath: raw.canonicalPath,
      ...(raw.occupancy === undefined ? {} : {
        occupancy: raw.occupancy as 'absent' | 'empty-directory' | 'nonempty-directory',
      }),
    };
  }
  if (raw.ok === false && Object.keys(raw).every((key) => ['ok', 'reason', 'remediation'].includes(key))
      && typeof raw.reason === 'string' && raw.reason.length > 0 && raw.reason.length <= 1_000
      && typeof raw.remediation === 'string' && raw.remediation.length > 0 && raw.remediation.length <= 1_000) {
    return { ok: false, reason: raw.reason, remediation: raw.remediation };
  }
  return { ok: false, reason: 'Agent-home verification returned a malformed result.', remediation: 'Choose the target again.' };
}

function markPathConflict(
  left: WorkspaceImportPlanItem,
  right: WorkspaceImportPlanItem,
  reason: string,
): void {
  left.status = 'conflict';
  right.status = 'conflict';
  left.reason = reason;
  right.reason = reason;
  left.remediation = 'Choose distinct, non-overlapping target locations.';
  right.remediation = left.remediation;
}

function isPathCollisionCandidate(item: WorkspaceImportPlanItem): boolean {
  return (item.status === 'ready' || item.status === 'reused' || item.status === 'conflict')
    && Boolean(item.target && item.canonicalPath);
}

function mappedItem(
  sourceId: string,
  name: string,
  targetId: string,
  target: WorkspaceTargetMapping | undefined,
): WorkspaceImportPlanItem {
  if (!target) {
    return {
      sourceId, name, targetId, status: 'needs-mapping',
      reason: 'No target path/backend has been selected.',
      remediation: 'Choose an existing repository path or a new ADE-owned agent home on this machine.',
    };
  }
  return { sourceId, name, targetId, target, status: 'ready' };
}

function identityItems<T extends { id: string; name: string }>(
  values: T[],
  occupiedNames: Set<string>,
  targetIds: Record<string, string>,
): WorkspaceImportPlanItem[] {
  const byName = new Map<string, WorkspaceImportPlanItem>();
  const items: WorkspaceImportPlanItem[] = [];
  for (const value of values) {
    const key = folded(value.name.trim());
    const prior = byName.get(key);
    const item: WorkspaceImportPlanItem = {
      sourceId: value.id,
      name: value.name,
      targetId: targetIds[value.id],
      status: occupiedNames.has(key) || prior ? 'conflict' : 'ready',
    };
    if (item.status === 'conflict') {
      item.reason = prior
        ? 'Two imported items have equivalent names.'
        : 'An item with the same name already exists in the target profile.';
      item.remediation = 'Choose a distinct name, explicitly reuse an existing item where supported, or skip one item.';
    }
    if (prior) {
      prior.status = 'conflict';
      prior.reason = 'Two imported items have equivalent names.';
      prior.remediation = item.remediation;
    } else {
      byName.set(key, item);
    }
    items.push(item);
  }
  return items;
}

function planToken(value: Omit<WorkspaceImportPlan, 'token'>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

interface ExistingPathOccupancy {
  id: string;
  name: string;
  target: WorkspaceTargetMapping;
  canonicalPath: string;
  commonGitDir?: string;
}

function canonicalStoredTargetPath(
  target: WorkspaceTargetMapping,
  hostPlatform: NodeJS.Platform,
): string {
  if (!isExecutionBackendId(target.backend) || typeof target.path !== 'string'
      || target.path.length === 0 || target.path.length > 4_096
      || /[\0-\x1f\x7f]/.test(target.path)) {
    throw new Error('workspace import: target profile contains an invalid occupied path');
  }
  const unsupported = unsupportedBackend(target, hostPlatform);
  if (unsupported) throw new Error(`workspace import: ${unsupported.reason}`);
  const windows = target.backend === 'native' && hostPlatform === 'win32';
  const pathApi = windows ? win32 : posix;
  const canonicalPath = pathApi.normalize(target.path);
  if (!pathApi.isAbsolute(canonicalPath)) {
    throw new Error('workspace import: target profile contains a non-absolute occupied path');
  }
  return canonicalPath;
}

function targetStateHash(
  targetConfig: AdeConfig,
  repositories: ExistingPathOccupancy[],
  agentHomes: ExistingPathOccupancy[],
): string {
  const byId = <T extends { id: string }>(values: T[]): T[] => [...values].sort((left, right) => (
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  ));
  const snapshot = {
    repositories: byId(repositories).map((item) => ({
      id: item.id, name: item.name,
      backend: backendIdentityKey(item.target.backend), path: item.canonicalPath,
      commonGitDir: item.commonGitDir,
    })),
    categories: byId(targetConfig.categories).map((item) => ({ id: item.id, name: item.name })),
    agents: byId(agentHomes).map((item) => ({
      id: item.id, name: item.name,
      backend: backendIdentityKey(item.target.backend), path: item.canonicalPath,
    })),
    templates: byId(targetConfig.agentTemplates).map((item) => ({ id: item.id, name: item.name })),
  };
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

function validateTargetIdentityCollection(
  value: unknown,
  label: string,
): asserts value is Array<{ id: string; name: string }> {
  if (!Array.isArray(value) || value.length > 10_000) {
    throw new Error(`workspace import: target ${label} collection is malformed`);
  }
  const ids = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
        || !isWorkspaceBundleId((item as { id?: unknown }).id)
        || !isWorkspaceBundleIdentityName((item as { name?: unknown }).name)) {
      throw new Error(`workspace import: target ${label} entry is malformed`);
    }
    const id = (item as { id: string }).id;
    if (ids.has(id)) {
      throw new Error(`workspace import: target ${label} contains duplicate ids`);
    }
    ids.add(id);
  }
}

export async function planWorkspaceImport(
  rawBundle: AdeWorkspaceBundleV1,
  targetConfig: AdeConfig,
  mappings: WorkspaceImportMappings,
  probe: WorkspaceTargetProbe,
  options: WorkspaceImportPlannerOptions,
): Promise<WorkspaceImportPlan> {
  const bundle = parseWorkspaceBundle(rawBundle);
  if (!targetConfig || typeof targetConfig !== 'object' || Array.isArray(targetConfig)) {
    throw new Error('workspace import: target config is malformed');
  }
  validateTargetIdentityCollection(targetConfig.repositories, 'repositories');
  validateTargetIdentityCollection(targetConfig.categories, 'categories');
  validateTargetIdentityCollection(targetConfig.agents, 'agents');
  validateTargetIdentityCollection(targetConfig.agentTemplates, 'agent templates');
  if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)
      || Object.keys(mappings).some((key) => !['repositories', 'agentHomes', 'skip', 'settings', 'names'].includes(key))) {
    throw new Error('workspace import: mappings container is malformed');
  }
  if (mappings.settings !== undefined && mappings.settings !== 'keep-target' && mappings.settings !== 'use-bundle') {
    throw new Error('workspace import: settings decision is invalid');
  }
  if (mappings.names !== undefined && (!mappings.names || typeof mappings.names !== 'object'
      || Array.isArray(mappings.names)
      || Object.keys(mappings.names).some((key) => ![
        'repositories', 'categories', 'agents', 'agentTemplates',
      ].includes(key)))) {
    throw new Error('workspace import: names decisions container is malformed');
  }
  const resolvedNames = {
    repositories: validateNameContainer(
      mappings.names?.repositories, new Set(bundle.repositories.map((item) => item.id)), 'repository',
    ),
    categories: validateNameContainer(
      mappings.names?.categories, new Set(bundle.categories.map((item) => item.id)), 'category',
    ),
    agents: validateNameContainer(
      mappings.names?.agents, new Set(bundle.agents.map((item) => item.id)), 'agent',
    ),
    agentTemplates: validateNameContainer(
      mappings.names?.agentTemplates,
      new Set(bundle.agentTemplates.map((item) => item.id)),
      'agent-template',
    ),
  };
  validateMappingContainer(
    mappings.repositories,
    new Set(bundle.repositories.map((item) => item.id)),
    'repository',
  );
  validateMappingContainer(
    mappings.agentHomes,
    new Set(bundle.agents.map((item) => item.id)),
    'agent-home',
  );
  if (mappings.skip !== undefined && (!mappings.skip || typeof mappings.skip !== 'object'
      || Array.isArray(mappings.skip)
      || Object.keys(mappings.skip).some((key) => ![
        'repositories', 'categories', 'agents', 'agentTemplates',
      ].includes(key)))) {
    throw new Error('workspace import: skip decisions container is malformed');
  }
  const skippedRepositories = validateSkipContainer(
    mappings.skip?.repositories, new Set(bundle.repositories.map((item) => item.id)), 'repository',
  );
  const skippedCategories = validateSkipContainer(
    mappings.skip?.categories, new Set(bundle.categories.map((item) => item.id)), 'category',
  );
  const explicitlySkippedAgents = validateSkipContainer(
    mappings.skip?.agents, new Set(bundle.agents.map((item) => item.id)), 'agent',
  );
  const skippedAgents = new Set([
    ...Array.from(explicitlySkippedAgents),
    ...bundle.agents.filter((agent) => skippedCategories.has(agent.categoryId)).map((agent) => agent.id),
  ]);
  const skippedTemplates = validateSkipContainer(
    mappings.skip?.agentTemplates,
    new Set(bundle.agentTemplates.map((item) => item.id)),
    'agent-template',
  );
  for (const item of targetConfig.repositories) {
    try {
      canonicalStoredTargetPath(
        { backend: item.executionBackend, path: item.rootPath },
        options.hostPlatform,
      );
    } catch {
      throw new Error('workspace import: target repository has an invalid occupied path');
    }
    try {
      canonicalStoredTargetPath({
        backend: item.executionBackend,
        path: item.commonGitDir ?? item.rootPath,
      }, options.hostPlatform);
    } catch {
      throw new Error('workspace import: target repository has an unsafe commonGitDir');
    }
  }

  const storedRepositories = targetConfig.repositories.map((item) => {
    const target = { backend: item.executionBackend, path: item.rootPath };
    const commonGitTarget = {
      backend: item.executionBackend,
      path: item.commonGitDir ?? item.rootPath,
    };
    canonicalStoredTargetPath(target, options.hostPlatform);
    canonicalStoredTargetPath(commonGitTarget, options.hostPlatform);
    return { item, target, commonGitTarget };
  });
  const storedAgentHomes = targetConfig.agents.map((item) => {
    const raw = item as unknown as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(raw, 'homeExecutionBackend')
        && raw.homeExecutionBackend !== undefined
        && !isExecutionBackendId(raw.homeExecutionBackend)) {
      throw new Error('workspace import: target profile contains an invalid occupied backend');
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'homeWorkspaceDir')
        && raw.homeWorkspaceDir !== undefined
        && typeof raw.homeWorkspaceDir !== 'string') {
      throw new Error('workspace import: target profile contains an invalid occupied path');
    }
    const target = {
      backend: item.homeExecutionBackend === undefined ? 'native' : item.homeExecutionBackend,
      path: item.homeWorkspaceDir === undefined ? item.workspaceDir : item.homeWorkspaceDir,
    };
    canonicalStoredTargetPath(target, options.hostPlatform);
    return { item, target };
  });
  const verifyExistingPath = async (
    id: string,
    name: string,
    target: WorkspaceTargetMapping,
  ): Promise<ExistingPathOccupancy> => {
    const result = validateAgentHomeProbeResult(await probe.canonicalPath(target));
    if (result.ok === false) {
      throw new Error(`workspace import: existing target item "${name}" could not be canonicalized: ${result.reason}`);
    }
    const invalidPath = invalidProbePath(target, result.canonicalPath, options.hostPlatform);
    if (invalidPath) {
      throw new Error(`workspace import: existing target item "${name}" returned a non-canonical path`);
    }
    return { id, name, target, canonicalPath: result.canonicalPath };
  };
  const existingRepositories: ExistingPathOccupancy[] = await Promise.all(storedRepositories.map(async ({ item, target, commonGitTarget }) => {
    const root = await verifyExistingPath(item.id, item.name, target);
    const git = await verifyExistingPath(item.id, item.name, commonGitTarget);
    return { ...root, commonGitDir: git.canonicalPath };
  }));
  const existingAgentHomes: ExistingPathOccupancy[] = await Promise.all(storedAgentHomes.map(({ item, target }) => {
    return verifyExistingPath(item.id, item.name, target);
  }));
  const occupancyOrder = (left: ExistingPathOccupancy, right: ExistingPathOccupancy): number => {
    const leftKey = `${backendIdentityKey(left.target.backend)}\0${left.canonicalPath}\0${left.id}\0${left.name}`;
    const rightKey = `${backendIdentityKey(right.target.backend)}\0${right.canonicalPath}\0${right.id}\0${right.name}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  };
  existingRepositories.sort(occupancyOrder);
  existingAgentHomes.sort(occupancyOrder);
  const occupiedIds = new Set([
    ...targetConfig.repositories.map((item) => item.id),
    ...targetConfig.categories.map((item) => item.id),
    ...targetConfig.agents.map((item) => item.id),
    ...targetConfig.agentTemplates.map((item) => item.id),
  ]);
  const idMap = {
    repositories: Object.fromEntries(bundle.repositories.map((item) => [
      item.id, stableTargetId('repository', item.id, occupiedIds),
    ])),
    categories: Object.fromEntries(bundle.categories.map((item) => [
      item.id, stableTargetId('category', item.id, occupiedIds),
    ])),
    agents: Object.fromEntries(bundle.agents.map((item) => [
      item.id, stableTargetId('agent', item.id, occupiedIds),
    ])),
    templates: Object.fromEntries(bundle.agentTemplates.map((item) => [
      item.id, stableTargetId('template', item.id, occupiedIds),
    ])),
  };

  const repositories: WorkspaceImportPlanItem[] = [];
  for (const source of bundle.repositories) {
    const mapping = ownMapping(mappings.repositories, source.id);
    const target = mapping.target;
    const item = mappedItem(
      source.id, resolvedNames.repositories[source.id] ?? source.name,
      idMap.repositories[source.id]!, target,
    );
    if (mapping.error) {
      Object.assign(item, { status: 'invalid' as const, ...mapping.error });
    } else if (skippedRepositories.has(source.id)) {
      item.status = 'skipped';
      item.reason = 'Skipped by the import decision.';
    } else if (target) {
      const unsupported = unsupportedBackend(target, options.hostPlatform);
      if (unsupported) {
        Object.assign(item, { status: 'invalid' as const, ...unsupported });
      } else {
        const result = validateRepositoryProbeResult(await probe.repository(source, target));
        if (result.ok === false) {
          Object.assign(item, { status: 'invalid' as const, reason: result.reason, remediation: result.remediation });
        } else {
          const invalidPath = invalidProbePath(target, result.canonicalPath, options.hostPlatform);
          if (invalidPath) {
            Object.assign(item, { status: 'invalid' as const, ...invalidPath });
            repositories.push(item);
            continue;
          }
          item.canonicalPath = result.canonicalPath;
          if (result.commonGitDir !== undefined) {
            const invalidCommonGitDir = invalidProbePath(
              target, result.commonGitDir, options.hostPlatform,
            );
            if (invalidCommonGitDir) {
              Object.assign(item, { status: 'invalid' as const, ...invalidCommonGitDir });
              repositories.push(item);
              continue;
            }
            item.commonGitDir = result.commonGitDir;
          }
          if (source.remoteIdentity
              && (!result.remoteIdentity || !remoteIdentitiesMatch(source.remoteIdentity, result.remoteIdentity))) {
            item.status = 'invalid';
            item.reason = result.remoteIdentity
              ? 'The selected target repository remote does not match the exported repository identity.'
              : 'The selected target repository has no verifiable origin remote.';
            item.remediation = 'Choose the correct clone with a matching origin remote or explicitly remap this repository.';
          }
          if (item.status === 'ready') {
            const exactRepository = existingRepositories.find((existing) => (
              pathsEqual(target, result.canonicalPath, existing.target, existing.canonicalPath, options.hostPlatform)
              && result.commonGitDir !== undefined
              && existing.commonGitDir !== undefined
              && pathsEqual(target, result.commonGitDir, existing.target, existing.commonGitDir, options.hostPlatform)
            ));
            if (exactRepository) {
              item.status = 'reused';
              item.targetId = exactRepository.id;
              item.name = exactRepository.name;
              idMap.repositories[source.id] = exactRepository.id;
              item.reason = 'The selected mapping explicitly reuses this verified target repository.';
            }
            const occupied = item.status === 'reused' ? undefined : existingRepositories.find((existing) => (
              folded(existing.name.trim()) === folded(item.name.trim())
              || repositoriesOverlap(item, existing, options.hostPlatform)
            )) ?? existingAgentHomes.find((existing) => repositoryOverlapsPath(
              item, existing.target, existing.canonicalPath, options.hostPlatform,
            ));
            if (occupied) {
              item.status = 'conflict';
              item.reason = `The mapped repository overlaps or duplicates existing target item "${occupied.name}".`;
              item.remediation = 'Explicitly reuse the existing target item, choose a distinct path/name, or skip this repository.';
            }
          }
        }
      }
    }
    repositories.push(item);
  }

  for (let leftIndex = 0; leftIndex < repositories.length; leftIndex += 1) {
    const left = repositories[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < repositories.length; rightIndex += 1) {
      const right = repositories[rightIndex]!;
      if (folded(left.name.trim()) !== folded(right.name.trim())) continue;
      for (const item of [left, right]) {
        if (item.status === 'invalid' || item.status === 'skipped') continue;
        item.status = 'conflict';
        item.reason = 'Two imported repositories have equivalent names.';
        item.remediation = 'Choose distinct repository names, explicitly reuse one target, or skip one repository.';
      }
    }
  }

  for (let leftIndex = 0; leftIndex < repositories.length; leftIndex += 1) {
    const left = repositories[leftIndex]!;
    if (!isPathCollisionCandidate(left) || !left.target || !left.canonicalPath) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < repositories.length; rightIndex += 1) {
      const right = repositories[rightIndex]!;
      if (!isPathCollisionCandidate(right) || !right.target || !right.canonicalPath) continue;
      if (repositoriesOverlap(left, right, options.hostPlatform)) {
        markPathConflict(left, right, 'Imported target mappings resolve to duplicate or overlapping paths.');
      }
    }
  }

  const agentHomes: WorkspaceImportPlanItem[] = [];
  for (const source of bundle.agents) {
    const mapping = ownMapping(mappings.agentHomes, source.id);
    const target = mapping.target;
    const item = mappedItem(
      source.id, resolvedNames.agents[source.id] ?? source.name,
      idMap.agents[source.id]!, target,
    );
    if (mapping.error) {
      Object.assign(item, { status: 'invalid' as const, ...mapping.error });
    } else if (skippedAgents.has(source.id)) {
      item.status = 'skipped';
      item.reason = 'Skipped by the import decision.';
    } else if (target) {
      const unsupported = unsupportedBackend(target, options.hostPlatform);
      if (unsupported) {
        Object.assign(item, { status: 'invalid' as const, ...unsupported });
      } else {
        const result = validateAgentHomeProbeResult(await probe.agentHome(target));
        if (result.ok === false) {
          Object.assign(item, { status: 'invalid' as const, reason: result.reason, remediation: result.remediation });
        } else {
          const invalidPath = invalidProbePath(target, result.canonicalPath, options.hostPlatform);
          if (invalidPath) Object.assign(item, { status: 'invalid' as const, ...invalidPath });
          else {
            item.canonicalPath = result.canonicalPath;
            if (result.occupancy && result.occupancy !== 'absent') {
              item.status = 'conflict';
              item.reason = 'The mapped agent home already exists and is not transaction-owned.';
              item.remediation = 'Choose a new absent path or explicitly skip this agent.';
              agentHomes.push(item);
              continue;
            }
            const occupied = existingRepositories.find((existing) => repositoryOverlapsPath(
              existing, target, result.canonicalPath, options.hostPlatform,
            )) ?? existingAgentHomes.find((existing) => pathsOverlap(
              target, result.canonicalPath, existing.target, existing.canonicalPath, options.hostPlatform,
            ));
            if (occupied) {
              item.status = 'conflict';
              item.reason = `The mapped agent home overlaps existing target item "${occupied.name}".`;
              item.remediation = 'Choose a distinct ADE-owned agent-home path or explicitly skip this agent.';
            }
          }
        }
      }
    }
    agentHomes.push(item);
  }

  for (let leftIndex = 0; leftIndex < agentHomes.length; leftIndex += 1) {
    const left = agentHomes[leftIndex]!;
    if (!isPathCollisionCandidate(left) || !left.target || !left.canonicalPath) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < agentHomes.length; rightIndex += 1) {
      const right = agentHomes[rightIndex]!;
      if (!isPathCollisionCandidate(right) || !right.target || !right.canonicalPath) continue;
      if (pathsOverlap(left.target, left.canonicalPath, right.target, right.canonicalPath, options.hostPlatform)) {
        markPathConflict(left, right, 'Imported target mappings resolve to duplicate or overlapping paths.');
      }
    }
  }
  for (const home of agentHomes) {
    if (!isPathCollisionCandidate(home) || !home.target || !home.canonicalPath) continue;
    for (const repository of repositories) {
      if (!isPathCollisionCandidate(repository) || !repository.target || !repository.canonicalPath) continue;
      if (repositoryOverlapsPath(repository, home.target, home.canonicalPath, options.hostPlatform)) {
        markPathConflict(home, repository, 'Imported target mappings resolve to duplicate or overlapping paths.');
      }
    }
  }

  const categories = identityItems(
    bundle.categories.map((item) => ({
      ...item, name: resolvedNames.categories[item.id] ?? item.name,
    })),
    new Set(targetConfig.categories.map((item) => folded(item.name.trim()))),
    idMap.categories,
  );
  const agents = identityItems(
    bundle.agents.map((item) => ({
      ...item, name: resolvedNames.agents[item.id] ?? item.name,
    })),
    new Set(targetConfig.agents.map((item) => folded(item.name.trim()))),
    idMap.agents,
  );
  const agentTemplates = identityItems(
    bundle.agentTemplates.map((item) => ({
      ...item, name: resolvedNames.agentTemplates[item.id] ?? item.name,
    })),
    new Set(targetConfig.agentTemplates.map((item) => folded(item.name.trim()))),
    idMap.templates,
  );
  for (const item of categories) {
    if (skippedCategories.has(item.sourceId)) {
      item.status = 'skipped';
      item.reason = 'Skipped by the import decision.';
    }
  }
  for (const item of agents) {
    if (skippedAgents.has(item.sourceId)) {
      item.status = 'skipped';
      item.reason = skippedCategories.has(
        bundle.agents.find((agent) => agent.id === item.sourceId)!.categoryId,
      ) ? 'Skipped because its category is skipped.' : 'Skipped by the import decision.';
    }
  }
  for (const item of agentTemplates) {
    if (skippedTemplates.has(item.sourceId)) {
      item.status = 'skipped';
      item.reason = 'Skipped by the import decision.';
    }
  }

  const withoutToken: Omit<WorkspaceImportPlan, 'token'> = {
    targetStateHash: targetStateHash(targetConfig, existingRepositories, existingAgentHomes),
    bundle,
    repositories,
    agentHomes,
    categories,
    agents,
    agentTemplates,
    idMap,
    settingsDecision: mappings.settings ?? 'keep-target',
    canApplyFully: [repositories, agentHomes, categories, agents, agentTemplates]
      .flat().every((item) => item.status === 'ready' || item.status === 'reused' || item.status === 'skipped'),
  };
  return { token: planToken(withoutToken), ...withoutToken };
}

export type { WorkspaceBundleAgent, WorkspaceBundleCategory };
