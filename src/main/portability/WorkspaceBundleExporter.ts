import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
import type { ExecutionBackendId } from '../../shared/executionBackends';
import {
  WORKSPACE_BUNDLE_FORMAT,
  WORKSPACE_BUNDLE_MAX_ASSET_BYTES,
  WORKSPACE_BUNDLE_MAX_DECODED_ASSET_BYTES,
  WORKSPACE_BUNDLE_MAX_MEMORY_CHARS,
  WORKSPACE_BUNDLE_MAX_PORTABLE_MEMORY_BYTES,
  WORKSPACE_BUNDLE_VERSION,
  isValidWorkspaceImageBytes,
  isWorkspaceRemoteIdentity,
  parseWorkspaceBundle,
  serializeWorkspaceBundle,
  type AdeWorkspaceBundleV1,
  type WorkspaceBundleAsset,
  type WorkspaceBundleNotice,
  type WorkspaceBundlePathStyle,
  type WorkspaceBundleSourcePlatform,
} from '../../shared/workspaceBundle';
import { DEFAULT_CONFIG, type AdeConfig, type Repository } from '../../shared/types';

export interface WorkspaceBundlePhotoResource {
  bytes: Buffer;
  mime: WorkspaceBundleAsset['mime'];
}

export interface WorkspaceBundleResourceReader {
  repositoryRemote?(repository: Repository): string | null;
  photo?(file: string, maxBytes: number): WorkspaceBundlePhotoResource | null;
  memory?(agentId: string, target: 'memory' | 'user', maxBytes: number): Buffer | null;
}

export interface WorkspaceBundleExportOptions {
  sourcePlatform: WorkspaceBundleSourcePlatform;
  exportedAt?: string;
  includeMemory?: boolean;
  includePhotos?: boolean;
  resources?: WorkspaceBundleResourceReader;
}

export interface WorkspaceBundleExportResult {
  bundle: AdeWorkspaceBundleV1;
  warnings: WorkspaceBundleNotice[];
}

function sourcePathStyle(path: string | undefined): WorkspaceBundlePathStyle {
  if (!path) return 'unknown';
  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')) return 'windows';
  if (path.startsWith('/')) return 'posix';
  return 'unknown';
}

function sourceLeaf(path: string, style: WorkspaceBundlePathStyle): string {
  const leaf = style === 'windows' ? win32.basename(path) : posix.basename(path.replace(/\\/g, '/'));
  return leaf.slice(0, 200) || 'repository';
}

/** Normalize a fetch remote without retaining credentials, query data or scheme. */
export function normalizeRepositoryRemote(value: string | null | undefined): string | undefined {
  const input = value?.trim();
  if (!input || input.startsWith('/') || /^[A-Za-z]:[\\/]/.test(input)) return undefined;
  let host = '';
  let pathname = '';
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):([^\s]+)$/.exec(input);
  if (scp && !input.includes('://')) {
    host = scp[1] ?? '';
    pathname = scp[2] ?? '';
  } else {
    try {
      const parsed = new URL(input);
      if (!['https:', 'http:', 'ssh:', 'git:'].includes(parsed.protocol)) return undefined;
      host = `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
      pathname = parsed.pathname;
    } catch {
      return undefined;
    }
  }
  const cleanPath = pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  const parts = cleanPath.split('/').filter(Boolean);
  if (!/^[A-Za-z0-9.-]+(?::[1-9]\d{0,4})?$/.test(host) || parts.length < 2
      || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) return undefined;
  const identity = `${host.toLowerCase()}/${parts.join('/')}`;
  return isWorkspaceRemoteIdentity(identity) ? identity : undefined;
}

function validPhoto(resource: WorkspaceBundlePhotoResource): boolean {
  if (!Buffer.isBuffer(resource.bytes)
      || !['image/png', 'image/jpeg', 'image/webp'].includes(resource.mime)
      || resource.bytes.byteLength === 0
      || resource.bytes.byteLength > WORKSPACE_BUNDLE_MAX_ASSET_BYTES) return false;
  return isValidWorkspaceImageBytes(resource.mime, resource.bytes);
}

export function exportWorkspaceBundle(
  config: AdeConfig,
  options: WorkspaceBundleExportOptions,
): WorkspaceBundleExportResult {
  const warnings: WorkspaceBundleNotice[] = [];
  const assets: WorkspaceBundleAsset[] = [];
  const assetByPhoto = new Map<string, string>();
  const processedPhotos = new Set<string>();
  const resources = options.resources;
  let fetchedAssetBytes = 0;
  let assetBudgetExhausted = false;
  let fetchedMemoryBytes = 0;
  let memoryBudgetExhausted = false;

  const exhaustMemoryBudget = (): void => {
    if (memoryBudgetExhausted) return;
    memoryBudgetExhausted = true;
    warnings.push({
      code: 'memory-budget-exhausted', subjectType: 'bundle',
      message: 'Additional memory was omitted because the aggregate portable memory budget was exhausted.',
    });
  };

  const retainPortableMemory = (
    raw: string,
    subjectType: 'agent' | 'template',
    subjectId: string,
  ): string => {
    const value = raw.slice(0, WORKSPACE_BUNDLE_MAX_MEMORY_CHARS);
    if (raw.length > WORKSPACE_BUNDLE_MAX_MEMORY_CHARS) {
      warnings.push({
        code: subjectType === 'agent' ? 'memory-truncated' : 'template-memory-truncated',
        subjectType,
        subjectId,
        message: `${subjectType === 'agent' ? 'Agent' : 'Template'} memory exceeded the portable bundle limit and was truncated.`,
      });
    }
    return value;
  };

  const portableResourceMemory = (
    source: (maxBytes: number) => Buffer | null,
    subjectId: string,
  ): string => {
    if (memoryBudgetExhausted) return '';
    const remaining = WORKSPACE_BUNDLE_MAX_PORTABLE_MEMORY_BYTES - fetchedMemoryBytes;
    const maxBytes = Math.min(WORKSPACE_BUNDLE_MAX_MEMORY_CHARS * 4, remaining);
    if (maxBytes <= 0) {
      exhaustMemoryBudget();
      return '';
    }
    fetchedMemoryBytes += maxBytes;
    const raw = source(maxBytes);
    if (!raw) return '';
    if (!Buffer.isBuffer(raw) || raw.byteLength > maxBytes) {
      exhaustMemoryBudget();
      return '';
    }
    return retainPortableMemory(raw.toString('utf8'), 'agent', subjectId);
  };

  const portableTemplateMemory = (raw: string, subjectId: string): string => {
    if (memoryBudgetExhausted) return '';
    const rawBytes = Buffer.byteLength(raw);
    if (fetchedMemoryBytes + rawBytes > WORKSPACE_BUNDLE_MAX_PORTABLE_MEMORY_BYTES) {
      exhaustMemoryBudget();
      return '';
    }
    fetchedMemoryBytes += rawBytes;
    return retainPortableMemory(raw, 'template', subjectId);
  };

  const photoAsset = (file: string | undefined, subjectType: WorkspaceBundleNotice['subjectType'], subjectId: string): string | undefined => {
    if (!file || !options.includePhotos) return undefined;
    const existing = assetByPhoto.get(file);
    if (existing) return existing;
    if (processedPhotos.has(file)) return undefined;
    processedPhotos.add(file);
    if (assetBudgetExhausted) return undefined;
    if (fetchedAssetBytes + WORKSPACE_BUNDLE_MAX_ASSET_BYTES
        > WORKSPACE_BUNDLE_MAX_DECODED_ASSET_BYTES) {
      assetBudgetExhausted = true;
      warnings.push({
        code: 'asset-budget-exhausted', subjectType: 'bundle',
        message: 'Additional photos were omitted because the aggregate portable asset budget was exhausted.',
      });
      return undefined;
    }
    fetchedAssetBytes += WORKSPACE_BUNDLE_MAX_ASSET_BYTES;
    const resource = resources?.photo?.(file, WORKSPACE_BUNDLE_MAX_ASSET_BYTES) ?? null;
    if (!resource || !Buffer.isBuffer(resource.bytes)) {
      warnings.push({
        code: 'photo-unavailable', subjectType, subjectId,
        message: 'The selected profile photo was unavailable, unsafe, or exceeded the bundle limit.',
      });
      return undefined;
    }
    if (resource.bytes.byteLength > WORKSPACE_BUNDLE_MAX_ASSET_BYTES) {
      assetBudgetExhausted = true;
      warnings.push({
        code: 'asset-budget-exhausted', subjectType: 'bundle',
        message: 'Additional photos were omitted because a reader exceeded its bounded resource contract.',
      });
      warnings.push({
        code: 'photo-unavailable', subjectType, subjectId,
        message: 'The selected profile photo was unavailable, unsafe, or exceeded the bundle limit.',
      });
      return undefined;
    }
    if (!validPhoto(resource)) {
      warnings.push({
        code: 'photo-unavailable', subjectType, subjectId,
        message: 'The selected profile photo was unavailable, unsafe, or exceeded the bundle limit.',
      });
      return undefined;
    }
    const sha256 = createHash('sha256').update(resource.bytes).digest('hex');
    const id = `photo-${sha256.slice(0, 24)}`;
    if (!assets.some((asset) => asset.id === id)) {
      assets.push({
        id,
        kind: 'photo',
        mime: resource.mime,
        sha256,
        dataBase64: resource.bytes.toString('base64'),
      });
    }
    assetByPhoto.set(file, id);
    return id;
  };

  const repositories = config.repositories.map((repository) => {
    const style = sourcePathStyle(repository.rootPath);
    const remoteIdentity = normalizeRepositoryRemote(resources?.repositoryRemote?.(repository));
    return {
      id: repository.id,
      name: repository.name,
      ...(remoteIdentity ? { remoteIdentity } : {}),
      sourceBackend: repository.executionBackend,
      sourcePathStyle: style,
      sourceLeafName: sourceLeaf(repository.rootPath, style),
    };
  });

  // An agent whose category is gone is unreachable inside ADE itself: the rail
  // and the graph both list agents by walking category.agents, so it cannot be
  // opened, edited or deleted. Failing the whole export over such a record
  // would block the feature on a row the user has no way to fix. It is left
  // out, with a notice naming it, instead.
  const categoryIds = new Set(config.categories.map((category) => category.id));
  const exportableAgents = config.agents.filter((agent) => categoryIds.has(agent.categoryId));
  for (const agent of config.agents) {
    if (categoryIds.has(agent.categoryId)) continue;
    warnings.push({
      code: 'agent-unreachable-omitted', subjectType: 'agent', subjectId: agent.id,
      message: `Agent "${agent.name}" belongs to a category that no longer exists, so it is not `
        + 'reachable in ADE and was not exported.',
    });
  }

  const categories = config.categories.map((category) => {
    const photoAssetId = photoAsset(category.photo, 'category', category.id);
    // Rebuilt rather than copied, so membership is reciprocal by construction:
    // stored order is kept, ids of agents that no longer exist drop out, and an
    // agent pointing at this category but missing from its list is restored.
    const members = exportableAgents.filter((agent) => agent.categoryId === category.id);
    const ordered = category.agents.filter((id) => members.some((agent) => agent.id === id));
    const unlisted = members.filter((agent) => !ordered.includes(agent.id)).map((agent) => agent.id);
    return {
      id: category.id,
      name: category.name,
      agentIds: [...ordered, ...unlisted],
      ...(category.defaultRepositoryId ? { defaultRepositoryId: category.defaultRepositoryId } : {}),
      ...(category.kind ? { kind: category.kind } : {}),
      ...(photoAssetId ? { photoAssetId } : {}),
    };
  });

  const agents = exportableAgents.map((agent) => {
    const photoAssetId = photoAsset(agent.photo, 'agent', agent.id);
    let memory: { memory: string; user: string } | undefined;
    if (options.includeMemory) {
      memory = {
        memory: portableResourceMemory(
          (maxBytes) => resources?.memory?.(agent.id, 'memory', maxBytes) ?? null, agent.id,
        ),
        user: portableResourceMemory(
          (maxBytes) => resources?.memory?.(agent.id, 'user', maxBytes) ?? null, agent.id,
        ),
      };
    }
    if (agent.customCommand || agent.dashboardCommand || agent.dashboardUrl) {
      warnings.push({
        code: 'agent-settings-omitted', subjectType: 'agent', subjectId: agent.id,
        message: 'Custom commands and dashboard settings are host-specific and were not exported.',
      });
    }
    return {
      id: agent.id,
      categoryId: agent.categoryId,
      name: agent.name,
      ...(agent.role ? { role: agent.role } : {}),
      runtime: agent.runtime,
      permissionMode: agent.permissionMode,
      ...(agent.ollamaModel ? { ollamaModel: agent.ollamaModel } : {}),
      ...(agent.codexModel ? { codexModel: agent.codexModel } : {}),
      ...(agent.codexReasoningEffort ? { codexReasoningEffort: agent.codexReasoningEffort } : {}),
      ...(agent.defaultRepositoryId ? { defaultRepositoryId: agent.defaultRepositoryId } : {}),
      ...(agent.teamRole ? { teamRole: agent.teamRole } : {}),
      ...(photoAssetId ? { photoAssetId } : {}),
      ...(memory ? { memory } : {}),
      sourceHomeBackend: (agent.homeExecutionBackend ?? 'native') as ExecutionBackendId,
      sourceHomePathStyle: sourcePathStyle(agent.homeWorkspaceDir ?? agent.workspaceDir),
    };
  });

  const agentTemplates = config.agentTemplates.map((template) => {
    const photoAssetId = photoAsset(template.photo, 'template', template.id);

    return {
      id: template.id,
      name: template.name,
      ...(template.role ? { role: template.role } : {}),
      runtime: template.runtime,
      permissionMode: template.permissionMode,
      ...(template.ollamaModel ? { ollamaModel: template.ollamaModel } : {}),
      ...(template.codexModel ? { codexModel: template.codexModel } : {}),
      ...(template.codexReasoningEffort ? { codexReasoningEffort: template.codexReasoningEffort } : {}),
      ...(photoAssetId ? { photoAssetId } : {}),
      memorySeed: {
        memory: portableTemplateMemory(template.memorySeed.memory, template.id),
        user: portableTemplateMemory(template.memorySeed.user, template.id),
      },
    };
  });

  const bundle: AdeWorkspaceBundleV1 = {
    format: WORKSPACE_BUNDLE_FORMAT,
    version: WORKSPACE_BUNDLE_VERSION,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    sourcePlatform: options.sourcePlatform,
    repositories,
    categories,
    agents,
    agentTemplates,
    assets,
    settings: {
      theme: config.settings.theme,
      memory: structuredClone(config.settings.memory ?? DEFAULT_CONFIG.settings.memory!),
    },
    notices: warnings,
  };
  let parsed = parseWorkspaceBundle(bundle);
  try {
    serializeWorkspaceBundle(parsed);
  } catch {
    if (bundle.assets.length > 0) {
      bundle.assets = [];
      for (const category of bundle.categories) delete category.photoAssetId;
      for (const agent of bundle.agents) delete agent.photoAssetId;
      for (const template of bundle.agentTemplates) delete template.photoAssetId;
      warnings.push({
        code: 'serialization-budget-exhausted', subjectType: 'bundle',
        message: 'Portable photos were omitted so the completed workspace bundle fits its serialized byte limit.',
      });
      bundle.notices = warnings;
      parsed = parseWorkspaceBundle(bundle);
    }
    try {
      serializeWorkspaceBundle(parsed);
    } catch {
      for (const agent of bundle.agents) delete agent.memory;
      for (const template of bundle.agentTemplates) template.memorySeed = { memory: '', user: '' };
      warnings.push({
        code: 'serialization-budget-exhausted', subjectType: 'bundle',
        message: 'Portable memory was omitted so the completed workspace bundle fits its serialized byte limit.',
      });
      bundle.notices = warnings;
      parsed = parseWorkspaceBundle(bundle);
      serializeWorkspaceBundle(parsed);
    }
  }
  return { bundle: parsed, warnings: structuredClone(warnings) };
}
