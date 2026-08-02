import { extname } from 'node:path';
import { normalizeConfig } from '../orchestration/migrate';
import { isExecutionBackendId } from '../../shared/executionBackends';
import type { AdeConfig, Repository } from '../../shared/types';
import {
  WORKSPACE_BUNDLE_MAX_ASSET_BYTES,
  WORKSPACE_BUNDLE_MAX_MEMORY_CHARS,
  type WorkspaceBundleSourcePlatform,
} from '../../shared/workspaceBundle';
import {
  exportWorkspaceBundle,
  type WorkspaceBundleExportResult,
  type WorkspaceBundlePhotoResource,
} from './WorkspaceBundleExporter';
import {
  readBoundedRelativeFile,
  resolveProfileRootAnchor,
  safelyReadManagedFile,
  type ProfileRootAnchor,
} from './managed/ManagedProfileAccess';
import { createManagedHost } from './managed/createManagedHost';
import type { ManagedHost } from './managed/ManagedHost';

const MAX_SOURCE_CONFIG_BYTES = 8 * 1024 * 1024;
const PHOTO_MIME: Record<string, WorkspaceBundlePhotoResource['mime']> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export interface ProfileWorkspaceBundleOptions {
  sourcePlatform: WorkspaceBundleSourcePlatform;
  exportedAt?: string;
  includeMemory?: boolean;
  includePhotos?: boolean;
  repositoryRemote?(repository: Repository): string | null;
  /** Test/diagnostic hook; receives only paths intentionally opened by the migration reader. */
  auditFileOpen?(path: string): void;
}

// The managed reader/writer moved to ./managed so a second host implementation
// could exist without the semantics drifting. Re-exported here because every
// caller already imports them from this module.
export {
  ManagedProfileWriter, openManagedProfileReader,
  type ManagedProfileReader, type ProfileRootAnchor,
} from './managed/ManagedProfileAccess';

function assertPortableLegacyBackends(parsed: Record<string, unknown>): void {
  const checkEntries = (value: unknown, field: string, label: string): void => {
    if (!Array.isArray(value)) return;
    for (let index = 0; index < value.length; index += 1) {
      const entry = value[index];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const raw = entry as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(raw, field)
          && raw[field] !== undefined && !isExecutionBackendId(raw[field])) {
        throw new Error(`workspace profile: ${label}[${index}].${field} is an invalid execution backend`);
      }
    }
  };
  checkEntries(parsed.repositories, 'executionBackend', 'repositories');
  checkEntries(parsed.agents, 'homeExecutionBackend', 'agents');
}

function assertPortableLegacyContainers(parsed: Record<string, unknown>): void {
  const containers: Array<[string, number]> = [
    ['repositories', 500], ['categories', 500], ['agents', 1_000], ['agentTemplates', 1_000],
  ];
  for (const [field, limit] of containers) {
    if (!Object.prototype.hasOwnProperty.call(parsed, field)) continue;
    const value = parsed[field];
    if (!Array.isArray(value) || value.length > limit
        || value.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) {
      throw new Error(`workspace profile: ${field} must be a bounded array of objects`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(parsed, 'settings')) {
    const settings = parsed.settings;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new Error('workspace profile: settings must be an object');
    }
    const settingsRecord = settings as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(settingsRecord, 'theme')
        && settingsRecord.theme !== 'dark' && settingsRecord.theme !== 'light') {
      throw new Error('workspace profile: settings.theme is invalid');
    }
    if (Object.prototype.hasOwnProperty.call(settingsRecord, 'memory')) {
      const memory = settingsRecord.memory;
      if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
        throw new Error('workspace profile: settings.memory must be an object');
      }
      const memoryRecord = memory as Record<string, unknown>;
      for (const field of ['enabled', 'userProfileEnabled']) {
        if (Object.prototype.hasOwnProperty.call(memoryRecord, field)
            && typeof memoryRecord[field] !== 'boolean') {
          throw new Error(`workspace profile: settings.memory.${field} must be a boolean`);
        }
      }
      for (const field of ['memoryCharLimit', 'userCharLimit']) {
        if (!Object.prototype.hasOwnProperty.call(memoryRecord, field)) continue;
        const value = memoryRecord[field];
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1_000_000) {
          throw new Error(`workspace profile: settings.memory.${field} is invalid`);
        }
      }
    }
  }
}

function assertPortableResourceReferences(config: AdeConfig): void {
  const collections: Array<{ label: string; values: Array<{ photo?: unknown }> }> = [
    { label: 'categories', values: config.categories },
    { label: 'agents', values: config.agents },
    { label: 'agentTemplates', values: config.agentTemplates },
  ];
  for (const { label, values } of collections) {
    for (let index = 0; index < values.length; index += 1) {
      const photo = values[index]?.photo;
      if (photo === undefined) continue;
      // Deliberately the platform-neutral rule, not this host's addressing
      // grammar: the question here is whether the *source* profile named a
      // single managed file, which does not depend on where the export runs.
      if (typeof photo !== 'string' || photo.length === 0 || photo.length > 255
          || photo === '.' || photo === '..'
          || photo.includes('/') || photo.includes('\\') || photo.includes('\0')) {
        throw new Error(`workspace profile: ${label}[${index}].photo is not a valid managed filename`);
      }
    }
  }
}

export function exportProfileWorkspaceBundle(
  source: string,
  options: ProfileWorkspaceBundleOptions,
): WorkspaceBundleExportResult {
  const host = createManagedHost();
  const anchor = resolveProfileRootAnchor(source, host);
  try {
    return exportAnchoredProfileWorkspaceBundle(anchor, options, host);
  } finally {
    anchor.anchor.close();
  }
}

function exportAnchoredProfileWorkspaceBundle(
  anchor: ProfileRootAnchor,
  options: ProfileWorkspaceBundleOptions,
  host: ManagedHost,
): WorkspaceBundleExportResult {
  const configBytes = readBoundedRelativeFile(
    anchor,
    ['config.json'],
    MAX_SOURCE_CONFIG_BYTES,
    'config.json',
    host,
    options.auditFileOpen,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(configBytes.toString('utf8'));
  } catch {
    throw new Error('workspace profile: config.json is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('workspace profile: config.json root must be an object');
  }
  assertPortableLegacyContainers(parsed as Record<string, unknown>);
  assertPortableLegacyBackends(parsed as Record<string, unknown>);
  const normalized = normalizeConfig(parsed as Parameters<typeof normalizeConfig>[0]).config;
  assertPortableResourceReferences(normalized);

  // Validate every portable identity and relationship before invoking any external or file reader.
  exportWorkspaceBundle(normalized, {
    sourcePlatform: options.sourcePlatform,
    exportedAt: options.exportedAt,
    includeMemory: false,
    includePhotos: false,
  });

  const result = exportWorkspaceBundle(normalized, {
    sourcePlatform: options.sourcePlatform,
    exportedAt: options.exportedAt,
    includeMemory: options.includeMemory,
    includePhotos: options.includePhotos,
    resources: {
      repositoryRemote: options.repositoryRemote,
      photo: (file, maxBytes) => {
        const mime = PHOTO_MIME[extname(file).toLowerCase()];
        if (!mime) return null;
        const bytes = safelyReadManagedFile(
          anchor,
          ['photos', file],
          Math.min(maxBytes, WORKSPACE_BUNDLE_MAX_ASSET_BYTES),
          host,
          options.auditFileOpen,
        );
        return bytes ? { bytes, mime } : null;
      },
      memory: (agentId, target, maxBytes) => {
        const file = target === 'memory' ? 'MEMORY.md' : 'USER.md';
        return safelyReadManagedFile(
          anchor,
          ['agents', agentId, 'memory', file],
          Math.min(maxBytes, WORKSPACE_BUNDLE_MAX_MEMORY_CHARS * 4),
          host,
          options.auditFileOpen,
        );
      },
    },
  });

  return result;
}
