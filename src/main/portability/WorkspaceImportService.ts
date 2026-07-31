import { createHash } from 'node:crypto';
import { basename, join, posix } from 'node:path';
import type { AdeConfig, Agent, AgentTemplate, Category, Repository } from '../../shared/types';
import { validateCompleteConfig } from '../config/store';
import type { ExecutionBackendService } from '../execution/ExecutionBackendService';
import { buildAgentRoleBlock } from '../memory/agentInstructions';
import { ManagedProfileWriter, openManagedProfileReader } from './ProfileMigrationSource';
import { ExecutionBackendHomeProvisioner } from './ExecutionBackendHomeProvisioner';
import {
  planWorkspaceImport,
  type WorkspaceImportMappings,
  type WorkspaceImportPlan,
  type WorkspaceTargetMapping,
  type WorkspaceTargetProbe,
} from './WorkspaceImportPlanner';

export interface WorkspaceImportConfigStore {
  get(): AdeConfig;
  getRevision?(): number;
  getPersistedSnapshot?(): { bytes: Buffer; sha256: string };
  acquireWorkspaceImportLock?(): () => void;
  replace(config: AdeConfig, expectedRevision?: number): AdeConfig;
}

export interface WorkspaceAgentHomeProvisioner {
  ensure(target: WorkspaceTargetMapping, canonicalPath: string, ownershipToken: string): Promise<string[]>;
  rollback(target: WorkspaceTargetMapping, createdPaths: readonly string[], ownershipToken: string): Promise<void>;
}

export interface WorkspaceImportServiceOptions {
  profileDir: string;
  store: WorkspaceImportConfigStore;
  probe: WorkspaceTargetProbe;
  hostPlatform: NodeJS.Platform;
  now?: () => number;
  fault?: (point: WorkspaceImportFaultPoint) => void;
  homeProvisioner?: WorkspaceAgentHomeProvisioner;
}

export type WorkspaceImportFaultPoint =
  | 'backup-created'
  | 'assets-staged'
  | 'memory-staged'
  | 'config-persisted'
  | 'assets-installed'
  | 'cleanup';

export interface WorkspaceImportReceipt {
  appliedAt: string;
  planToken: string;
  backupPath: string;
  receiptPath: string;
  imported: {
    repositories: number;
    categories: number;
    agents: number;
    agentTemplates: number;
  };
  items: Array<{
    kind: 'repository' | 'category' | 'agent' | 'agent-home' | 'agent-template';
    sourceId: string;
    targetId?: string;
    outcome: 'imported' | 'reused' | 'skipped';
    reasonCode?: 'user-or-dependency-skip';
  }>;
}

function importedConfig(
  plan: WorkspaceImportPlan,
  current: AdeConfig,
  now: number,
  profileDir: string,
  assetNames: ReadonlyMap<string, string>,
): AdeConfig {
  const readyRepositoryIds = new Set(plan.repositories
    .filter((item) => item.status === 'ready' || item.status === 'reused').map((item) => item.sourceId));
  const readyAgentIds = new Set(plan.agents
    .filter((item) => item.status === 'ready').map((item) => item.sourceId));
  const repositoryBySource = new Map(plan.bundle.repositories.map((item) => [item.id, item]));
  const repositories: Repository[] = plan.repositories.filter((item) => item.status === 'ready').map((item) => {
    const source = repositoryBySource.get(item.sourceId)!;
    if (!item.canonicalPath || !item.commonGitDir || !item.target) {
      throw new Error(`workspace import: repository ${source.id} lacks verified target metadata`);
    }
    return {
      id: item.targetId!,
      name: item.name,
      rootPath: item.canonicalPath,
      commonGitDir: item.commonGitDir,
      executionBackend: item.target.backend,
      verified: true,
      createdAt: now,
    };
  });
  const categoryBySource = new Map(plan.bundle.categories.map((item) => [item.id, item]));
  const categories: Category[] = plan.categories.filter((item) => item.status === 'ready').map((item) => {
    const source = categoryBySource.get(item.sourceId)!;
    return {
      id: item.targetId!,
      name: item.name,
      agents: source.agentIds.filter((sourceId) => readyAgentIds.has(sourceId))
        .map((sourceId) => plan.idMap.agents[sourceId]!),
      ...(source.defaultRepositoryId && readyRepositoryIds.has(source.defaultRepositoryId)
        ? { defaultRepositoryId: plan.idMap.repositories[source.defaultRepositoryId] }
        : {}),
      ...(source.kind ? { kind: source.kind } : {}),
      ...(source.photoAssetId ? { photo: assetNames.get(source.photoAssetId) } : {}),
    };
  });
  const homeBySource = new Map(plan.agentHomes.map((item) => [item.sourceId, item]));
  const agentBySource = new Map(plan.bundle.agents.map((item) => [item.id, item]));
  const agents: Agent[] = plan.agents.filter((item) => item.status === 'ready').map((item) => {
    const source = agentBySource.get(item.sourceId)!;
    const home = homeBySource.get(item.sourceId)!;
    const homePath = home.canonicalPath!;
    return {
      id: item.targetId!,
      categoryId: plan.idMap.categories[source.categoryId]!,
      name: item.name,
      ...(source.role ? { role: source.role } : {}),
      runtime: source.runtime,
      permissionMode: source.permissionMode,
      ...(source.ollamaModel ? { ollamaModel: source.ollamaModel } : {}),
      ...(source.codexModel ? { codexModel: source.codexModel } : {}),
      ...(source.codexReasoningEffort ? { codexReasoningEffort: source.codexReasoningEffort } : {}),
      ...(source.defaultRepositoryId && readyRepositoryIds.has(source.defaultRepositoryId)
        ? { defaultRepositoryId: plan.idMap.repositories[source.defaultRepositoryId] }
        : {}),
      ...(source.teamRole ? { teamRole: source.teamRole } : {}),
      ...(source.photoAssetId ? { photo: assetNames.get(source.photoAssetId) } : {}),
      workspaceDir: homePath,
      homeWorkspaceDir: homePath,
      ...(home.target?.backend && home.target.backend !== 'native'
        ? { homeExecutionBackend: home.target.backend }
        : {}),
      memoryDir: join(profileDir, 'agents', item.targetId!, 'memory'),
    };
  });
  const templateBySource = new Map(plan.bundle.agentTemplates.map((item) => [item.id, item]));
  const agentTemplates: AgentTemplate[] = plan.agentTemplates
    .filter((item) => item.status === 'ready').map((item) => {
    const source = templateBySource.get(item.sourceId)!;
    return {
      id: item.targetId!,
      name: item.name,
      ...(source.role ? { role: source.role } : {}),
      runtime: source.runtime,
      permissionMode: source.permissionMode,
      ...(source.ollamaModel ? { ollamaModel: source.ollamaModel } : {}),
      ...(source.codexModel ? { codexModel: source.codexModel } : {}),
      ...(source.codexReasoningEffort ? { codexReasoningEffort: source.codexReasoningEffort } : {}),
      ...(source.photoAssetId ? { photo: assetNames.get(source.photoAssetId) } : {}),
      memorySeed: structuredClone(source.memorySeed),
      createdAt: now,
      updatedAt: now,
    };
  });
  return {
    ...structuredClone(current),
    repositories: [...current.repositories, ...repositories],
    categories: [...current.categories, ...categories],
    agents: [...current.agents, ...agents],
    agentTemplates: [...current.agentTemplates, ...agentTemplates],
    settings: {
      ...current.settings,
      ...(plan.settingsDecision === 'use-bundle' ? {
        theme: plan.bundle.settings.theme,
        memory: structuredClone(plan.bundle.settings.memory),
      } : {}),
    },
  };
}

const unavailableBackend = {
  async run(): Promise<never> {
    throw new Error('workspace import: an execution backend provisioner is required');
  },
} as unknown as ExecutionBackendService;
const nativeHomeProvisioner: WorkspaceAgentHomeProvisioner =
  new ExecutionBackendHomeProvisioner(unavailableBackend);

function managedAssetManifest(profileDir: string, config: AdeConfig): Array<{
  relativePath: string;
  size: number;
  sha256: string;
}> {
  // Existing assets are never overwritten. On hosts without descriptor-relative reads,
  // omit hashes rather than risk following a reparse-point ancestor during backup.
  if (process.platform !== 'linux') return [];
  const relativePaths = new Set<string>();
  for (const identity of [...config.categories, ...config.agents, ...config.agentTemplates]) {
    if (!identity.photo) continue;
    if (basename(identity.photo) !== identity.photo || !/^[A-Za-z0-9._-]{1,255}$/.test(identity.photo)) {
      throw new Error('workspace import: current profile has an invalid managed photo reference');
    }
    relativePaths.add(`photos/${identity.photo}`);
  }
  for (const agent of config.agents) {
    for (const filename of ['MEMORY.md', 'USER.md', 'AGENTS.md']) {
      relativePaths.add(`agents/${agent.id}/memory/${filename}`);
    }
  }
  if (relativePaths.size > 5_000) throw new Error('workspace import: managed asset manifest is too large');
  let totalBytes = 0;
  const result: Array<{ relativePath: string; size: number; sha256: string }> = [];
  const reader = openManagedProfileReader(profileDir);
  try {
    for (const relativePath of Array.from(relativePaths).sort()) {
      const bytes = reader.readStrict(relativePath.split('/'), 4 * 1024 * 1024);
      if (!bytes) continue;
      totalBytes += bytes.length;
      if (totalBytes > 20 * 1024 * 1024) {
        throw new Error('workspace import: managed asset manifest byte budget exceeded');
      }
      result.push({
        relativePath,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  } finally {
    reader.close();
  }
  return result;
}

export class WorkspaceImportService {
  private readonly options: WorkspaceImportServiceOptions;
  private applying = false;

  constructor(options: WorkspaceImportServiceOptions) {
    this.options = options;
  }

  async recoverPending(): Promise<void> {
    if (this.applying) throw new Error('A workspace import is already running for this profile.');
    this.applying = true;
    let releaseLock: (() => void) | undefined;
    try {
      releaseLock = this.options.store.acquireWorkspaceImportLock?.();
      await this.recoverPendingUnlocked();
    } finally {
      releaseLock?.();
      this.applying = false;
    }
  }

  async apply(plan: WorkspaceImportPlan, mappings: WorkspaceImportMappings): Promise<WorkspaceImportReceipt> {
    if (this.applying) throw new Error('A workspace import is already running for this profile.');
    this.applying = true;
    let releaseLock: (() => void) | undefined;
    try {
      releaseLock = this.options.store.acquireWorkspaceImportLock?.();
      await this.recoverPendingUnlocked();
      return await this.applyUnlocked(plan, mappings);
    } finally {
      releaseLock?.();
      this.applying = false;
    }
  }

  private async recoverPendingUnlocked(): Promise<void> {
    if (this.options.hostPlatform !== 'linux') return;
    const journalParts = ['import-transactions', 'pending.json'];
    const reader = openManagedProfileReader(this.options.profileDir);
    let bytes: Buffer | null;
    try { bytes = reader.readStrict(journalParts, 2 * 1024 * 1024); } finally { reader.close(); }
    if (!bytes) return;
    const journal = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
    const journalKeys = ['format', 'version', 'phase', 'backup', 'stage', 'stagePaths', 'receipt',
      'receiptSha256', 'managedPaths', 'homes', 'beforeConfigSha256', 'targetConfigSha256'];
    if (journal.format !== 'ade-workspace-import-journal' || journal.version !== 1
        || (journal.phase !== 'prepared' && journal.phase !== 'committed')
        || Object.keys(journal).some((key) => !journalKeys.includes(key))
        || Object.keys(journal).length !== journalKeys.length
        || typeof journal.backup !== 'string' || !/^workspace-import-[A-Za-z0-9-]{1,80}$/.test(journal.backup)
        || typeof journal.beforeConfigSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(journal.beforeConfigSha256)
        || typeof journal.targetConfigSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(journal.targetConfigSha256)
        || typeof journal.receiptSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(journal.receiptSha256)
        || !Array.isArray(journal.stage) || !Array.isArray(journal.stagePaths) || !Array.isArray(journal.receipt)
        || !Array.isArray(journal.managedPaths) || !Array.isArray(journal.homes)) {
      throw new Error('workspace import: pending recovery journal is invalid');
    }
    const safeParts = (value: unknown): string[] => {
      if (!Array.isArray(value) || value.length === 0 || value.length > 8
          || value.some((part) => typeof part !== 'string' || !part || part === '.' || part === '..'
            || part.length > 255 || /[/\\\0]/.test(part))) {
        throw new Error('workspace import: pending recovery path is invalid');
      }
      return value as string[];
    };
    const ownedPaths = (values: unknown[]): Array<{
      path: string[]; kind: 'file' | 'directory'; ownership: string;
    }> => values.map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('workspace import: pending recovery managed path is invalid');
      }
      const item = raw as Record<string, unknown>;
      if (Object.keys(item).length !== 3 || !['file', 'directory'].includes(item.kind as string)
          || typeof item.ownership !== 'string' || !/^[a-f0-9]{64}$/.test(item.ownership)) {
        throw new Error('workspace import: pending recovery managed ownership is invalid');
      }
      return { path: safeParts(item.path), kind: item.kind as 'file' | 'directory', ownership: item.ownership };
    });
    const managedPaths = ownedPaths(journal.managedPaths as unknown[]);
    const stagePaths = ownedPaths(journal.stagePaths as unknown[]);
    const receiptParts = safeParts(journal.receipt);
    const stageParts = safeParts(journal.stage);
    const managedPathAllowed = (item: { path: string[]; kind: 'file' | 'directory' }): boolean => {
      const [root, id, child, leaf] = item.path;
      if (item.kind === 'file' && root === 'photos' && item.path.length === 2) {
        return /^import-[a-f0-9]{32}\.(?:png|jpg|webp)$/.test(id!);
      }
      if (root !== 'agents' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id!)) return false;
      if (item.kind === 'directory') {
        return item.path.length === 2 || (item.path.length === 3 && child === 'memory');
      }
      return item.path.length === 4 && child === 'memory'
        && ['MEMORY.md', 'USER.md', 'AGENTS.md'].includes(leaf!);
    };
    if (managedPaths.length > 4096 || managedPaths.some((item) => !managedPathAllowed(item))
        || new Set(managedPaths.map((item) => item.path.join('\0'))).size !== managedPaths.length) {
      throw new Error('workspace import: pending recovery managed paths are invalid');
    }
    if (stageParts.length !== 2 || stageParts[0] !== '.workspace-import-staging'
        || !/^[A-Za-z0-9-]{1,128}$/.test(stageParts[1]!)
        || receiptParts.length !== 2 || receiptParts[0] !== 'import-receipts'
        || !/^workspace-import-[A-Za-z0-9-]{1,128}\.json$/.test(receiptParts[1]!)
        || journal.backup !== `workspace-import-${stageParts[1]}`
        || receiptParts[1] !== `${journal.backup}.json`) {
      throw new Error('workspace import: pending recovery stage or receipt path is invalid');
    }
    if (stagePaths.length === 0 || stagePaths.length > 4096
        || !stagePaths.some((item) => item.kind === 'directory'
          && item.path.length === stageParts.length
          && stageParts.every((part, index) => item.path[index] === part))
        || stagePaths.some((item) => item.path.length < stageParts.length
          || stageParts.some((part, index) => item.path[index] !== part))) {
      throw new Error('workspace import: pending recovery stage ownership is invalid');
    }
    const homes = (journal.homes as unknown[]).map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('workspace import: pending recovery home is invalid');
      }
      const homeRecord = raw as Record<string, unknown>;
      if (Object.keys(homeRecord).length !== 3
          || !Object.prototype.hasOwnProperty.call(homeRecord, 'target')
          || !Object.prototype.hasOwnProperty.call(homeRecord, 'canonicalPath')
          || !Object.prototype.hasOwnProperty.call(homeRecord, 'ownershipToken')) {
        throw new Error('workspace import: pending recovery home has unknown fields');
      }
      const home = homeRecord as { target?: unknown; canonicalPath?: unknown; ownershipToken?: unknown };
      const target = home.target as WorkspaceTargetMapping;
      if (!target || typeof target !== 'object' || Array.isArray(target)
          || Object.keys(target as unknown as Record<string, unknown>).length !== 2
          || !Object.prototype.hasOwnProperty.call(target as unknown as Record<string, unknown>, 'backend')
          || !Object.prototype.hasOwnProperty.call(target as unknown as Record<string, unknown>, 'path')) {
        throw new Error('workspace import: pending recovery home target has unknown fields');
      }
      if (!target || (target.backend !== 'native' && !/^wsl:[A-Za-z0-9._-]{1,64}$/.test(target.backend))
          || typeof target.path !== 'string' || typeof home.canonicalPath !== 'string'
          || typeof home.ownershipToken !== 'string' || !/^[a-f0-9]{64}$/.test(home.ownershipToken)
          || target.path !== home.canonicalPath || target.path.length > 4_096
          || !target.path.startsWith('/') || posix.normalize(target.path) !== target.path
          || /[\0-\x1f\x7f]/.test(target.path)) {
        throw new Error('workspace import: pending recovery home target is invalid');
      }
      return { target, canonicalPath: home.canonicalPath, ownershipToken: home.ownershipToken };
    });
    const writer = new ManagedProfileWriter(this.options.profileDir);
    try {
      let diskSha = this.options.store.getPersistedSnapshot?.().sha256;
      if (!diskSha) {
        const configReader = openManagedProfileReader(this.options.profileDir);
        try {
          const configBytes = configReader.readStrict(['config.json'], 8 * 1024 * 1024);
          if (!configBytes) throw new Error('workspace import: current config is missing during recovery');
          diskSha = createHash('sha256').update(configBytes).digest('hex');
        } finally { configReader.close(); }
      }
      if (journal.phase === 'committed') {
        if (diskSha !== journal.targetConfigSha256) {
          throw new Error('workspace import: committed recovery config generation does not match the journal');
        }
        const receiptReader = openManagedProfileReader(this.options.profileDir);
        let receiptBytes: Buffer | null;
        try { receiptBytes = receiptReader.readStrict(receiptParts, 2 * 1024 * 1024); }
        finally { receiptReader.close(); }
        if (!receiptBytes || createHash('sha256').update(receiptBytes).digest('hex') !== journal.receiptSha256) {
          throw new Error('workspace import: committed recovery receipt is missing or unauthenticated');
        }
        writer.remove(journalParts);
        return;
      }
      const backupReader = openManagedProfileReader(this.options.profileDir);
      let backupBytes: Buffer | null;
      try {
        backupBytes = backupReader.readStrict(['backups', journal.backup, 'config.json'], 8 * 1024 * 1024);
      } finally { backupReader.close(); }
      if (!backupBytes) throw new Error('workspace import: pending recovery backup is missing');
      if (createHash('sha256').update(backupBytes).digest('hex') !== journal.beforeConfigSha256) {
        throw new Error('workspace import: pending recovery backup does not match the journal generation');
      }
      const beforeConfig = JSON.parse(backupBytes.toString('utf8')) as AdeConfig;
      validateCompleteConfig(beforeConfig);
      let shouldCleanManagedPaths = false;
      if (diskSha === journal.targetConfigSha256) {
        const targetConfig = structuredClone(this.options.store.get());
        validateCompleteConfig(targetConfig);
        const beforeAgentIds = new Set(beforeConfig.agents.map((agent) => agent.id));
        const beforeCategoryIds = new Set(beforeConfig.categories.map((item) => item.id));
        const beforeTemplateIds = new Set(beforeConfig.agentTemplates.map((item) => item.id));
        const importedAgents = targetConfig.agents.filter((agent) => !beforeAgentIds.has(agent.id));
        const importedAgentIds = new Set(importedAgents.map((agent) => agent.id));
        const importedPhotos = new Set([
          ...importedAgents.map((item) => item.photo),
          ...targetConfig.categories.filter((item) => !beforeCategoryIds.has(item.id)).map((item) => item.photo),
          ...targetConfig.agentTemplates.filter((item) => !beforeTemplateIds.has(item.id)).map((item) => item.photo),
        ].filter((item): item is string => typeof item === 'string'));
        if (managedPaths.some((item) => (item.path[0] === 'agents'
          ? !importedAgentIds.has(item.path[1]!)
          : !importedPhotos.has(item.path[1]!)))) {
          throw new Error('workspace import: pending recovery resources are not bound to the target generation');
        }
        const agentRoots = managedPaths.filter((item) => item.kind === 'directory'
          && item.path.length === 2 && item.path[0] === 'agents');
        if (Array.from(importedAgentIds).some((id) => !agentRoots.some((item) => item.path[1] === id))
            || managedPaths.some((item) => item.path[0] === 'agents'
              && !agentRoots.some((root) => root.path[1] === item.path[1]))) {
          throw new Error('workspace import: pending recovery agent ownership roots are incomplete');
        }
        for (const root of agentRoots) writer.assertOwnedDirectory(root.path, root.ownership);
        shouldCleanManagedPaths = true;
        this.options.store.replace(
          beforeConfig,
          this.options.store.getRevision?.(),
        );
      } else if (diskSha !== journal.beforeConfigSha256) {
        throw new Error('workspace import: recovery refused to overwrite an unrelated config generation');
      }
      const cleanupErrors: Error[] = [];
      for (const item of (shouldCleanManagedPaths ? managedPaths.reverse() : [])) {
        try {
          if (item.kind === 'directory') writer.removeOwnedDirectory(item.path, item.ownership);
          else writer.removeOwnedFile(item.path, item.ownership);
        } catch (error) { cleanupErrors.push(error as Error); }
      }
      // A prepared journal has no authenticated receipt yet. Leave any orphan fail-closed.
      for (const item of stagePaths.reverse()) {
        try {
          if (item.kind === 'directory') writer.removeOwnedDirectory(item.path, item.ownership);
          else writer.removeOwnedFile(item.path, item.ownership);
        } catch (error) { cleanupErrors.push(error as Error); }
      }
      const homeProvisioner = this.options.homeProvisioner ?? nativeHomeProvisioner;
      for (const home of homes.reverse()) {
        try { await homeProvisioner.rollback(home.target, [home.canonicalPath], home.ownershipToken); }
        catch (error) { cleanupErrors.push(error as Error); }
      }
      if (cleanupErrors.length > 0) {
        throw new Error(`workspace import: recovery cleanup did not complete (${cleanupErrors.length} error(s))`);
      }
      writer.remove(journalParts);
    } finally { writer.close(); }
  }

  private async applyUnlocked(
    plan: WorkspaceImportPlan,
    mappings: WorkspaceImportMappings,
  ): Promise<WorkspaceImportReceipt> {
    const persistedSnapshot = this.options.store.getPersistedSnapshot?.();
    const current = structuredClone(this.options.store.get());
    const expectedRevision = this.options.store.getRevision?.();
    const refreshed = await planWorkspaceImport(
      plan.bundle,
      current,
      mappings,
      this.options.probe,
      { hostPlatform: this.options.hostPlatform },
    );
    if (refreshed.token !== plan.token) {
      throw new Error('workspace import: preview is stale; generate a fresh plan before applying');
    }
    if (!refreshed.canApplyFully) {
      throw new Error('workspace import: unresolved plan items must be repaired before applying');
    }

    const now = this.options.now?.() ?? Date.now();
    validateCompleteConfig(current);
    const selectedAssetIds = new Set<string>();
    for (const item of [
      ...refreshed.categories.filter((entry) => entry.status === 'ready'),
      ...refreshed.agents.filter((entry) => entry.status === 'ready'),
      ...refreshed.agentTemplates.filter((entry) => entry.status === 'ready'),
    ]) {
      const source = [...refreshed.bundle.categories, ...refreshed.bundle.agents, ...refreshed.bundle.agentTemplates]
        .find((entry) => entry.id === item.sourceId);
      if (source?.photoAssetId) selectedAssetIds.add(source.photoAssetId);
    }
    const assetNames = new Map<string, string>();
    for (const asset of refreshed.bundle.assets.filter((item) => selectedAssetIds.has(item.id))) {
      const extension = asset.mime === 'image/png' ? 'png' : asset.mime === 'image/jpeg' ? 'jpg' : 'webp';
      const filenameKey = createHash('sha256')
        .update(asset.id).update('\0').update(asset.sha256).digest('hex').slice(0, 32);
      assetNames.set(asset.id, `import-${filenameKey}.${extension}`);
    }
    const next = importedConfig(refreshed, current, now, this.options.profileDir, assetNames);
    validateCompleteConfig(next);
    const operationId = `${now}-${plan.token.slice(0, 12)}`;
    const backupPath = join(this.options.profileDir, 'backups', `workspace-import-${operationId}`);
    const backupTempPath = `${backupPath}.tmp`;
    const stageDir = join(this.options.profileDir, '.workspace-import-staging', operationId);
    const receiptPath = join(this.options.profileDir, 'import-receipts', `workspace-import-${operationId}.json`);
    const receiptTempPath = `${receiptPath}.tmp`;
    const journalPath = join(this.options.profileDir, 'import-transactions', 'pending.json');
    const journalTempPath = `${journalPath}.tmp`;
    const createdHomes: Array<{ target: WorkspaceTargetMapping; paths: string[] }> = [];
    const homeProvisioner = this.options.homeProvisioner ?? nativeHomeProvisioner;
    const managedWriter = new ManagedProfileWriter(this.options.profileDir);
    const managedParts = (path: string): string[] => managedWriter.relative(path);
    const removeManaged = (path: string): void => {
      try { managedWriter.remove(managedParts(path)); } catch { /* absent or parent not created */ }
    };
    const writeJournal = (value: Record<string, unknown>): void => {
      managedWriter.mkdir(['import-transactions']);
      removeManaged(journalTempPath);
      managedWriter.write(managedParts(journalTempPath), `${JSON.stringify(value, null, 2)}\n`);
      managedWriter.rename(managedParts(journalTempPath), managedParts(journalPath));
    };
    let configReplaceAttempted = false;
    let committedRevision: number | undefined;
    let journalBase: Record<string, unknown> | undefined;
    let intendedManagedPaths: Array<{ path: string[]; kind: string; ownership: string }> = [];
    let intendedStagePaths: Array<{ path: string[]; kind: string; ownership: string }> = [];
    try {
      const existingManagedAssets = managedAssetManifest(this.options.profileDir, current);
      managedWriter.mkdir(['backups']);
      managedWriter.mkdir(managedParts(backupTempPath));
      managedWriter.write(
        managedParts(join(backupTempPath, 'config.json')),
        persistedSnapshot?.bytes ?? `${JSON.stringify(current, null, 2)}\n`,
      );
      managedWriter.write(managedParts(join(backupTempPath, 'manifest.json')), `${JSON.stringify({
        version: 1,
        planToken: plan.token,
        createdAt: new Date(now).toISOString(),
        managedAssetsStatus: process.platform === 'linux' ? 'complete' : 'omitted-unsupported-host',
        managedAssets: existingManagedAssets,
      }, null, 2)}\n`);
      managedWriter.rename(managedParts(backupTempPath), managedParts(backupPath));
      this.options.fault?.('backup-created');

      managedWriter.mkdir(['.workspace-import-staging']);
      managedWriter.mkdir(managedParts(stageDir));
      managedWriter.write(managedParts(join(stageDir, '.ade-workspace-import-owner')), plan.token);
      if (selectedAssetIds.size > 0) {
        managedWriter.mkdir(managedParts(join(stageDir, 'photos')));
        managedWriter.write(managedParts(join(stageDir, 'photos', '.ade-workspace-import-owner')), plan.token);
      }
      for (const asset of refreshed.bundle.assets.filter((item) => selectedAssetIds.has(item.id))) {
        const filename = assetNames.get(asset.id)!;
        const stagedPhotos = join(stageDir, 'photos');
        managedWriter.write(managedParts(join(stagedPhotos, filename)), Buffer.from(asset.dataBase64, 'base64'));
      }
      this.options.fault?.('assets-staged');

      const readyAgentIds = new Set(refreshed.agents
        .filter((item) => item.status === 'ready').map((item) => item.sourceId));
      if (readyAgentIds.size > 0) {
        managedWriter.mkdir(managedParts(join(stageDir, 'agents')));
        managedWriter.write(managedParts(join(stageDir, 'agents', '.ade-workspace-import-owner')), plan.token);
      }
      for (const source of refreshed.bundle.agents.filter((item) => readyAgentIds.has(item.id))) {
        const targetId = refreshed.idMap.agents[source.id]!;
        const targetAgent = next.agents.find((item) => item.id === targetId)!;
        managedWriter.mkdir(managedParts(join(stageDir, 'agents', targetId)));
        managedWriter.write(managedParts(join(stageDir, 'agents', targetId, '.ade-workspace-import-owner')), plan.token);
        const stagedMemory = join(stageDir, 'agents', targetId, 'memory');
        managedWriter.mkdir(managedParts(stagedMemory));
        managedWriter.write(managedParts(join(stagedMemory, 'MEMORY.md')), source.memory?.memory ?? '');
        managedWriter.write(managedParts(join(stagedMemory, 'USER.md')), source.memory?.user ?? '');
        managedWriter.write(managedParts(join(stagedMemory, 'AGENTS.md')), buildAgentRoleBlock(targetAgent));
        managedWriter.write(managedParts(join(stagedMemory, '.ade-workspace-import-owner')), plan.token);
      }
      this.options.fault?.('memory-staged');

      const finalPreflight = await planWorkspaceImport(
        plan.bundle,
        structuredClone(this.options.store.get()),
        mappings,
        this.options.probe,
        { hostPlatform: this.options.hostPlatform },
      );
      if (finalPreflight.token !== refreshed.token
          || (expectedRevision !== undefined && this.options.store.getRevision?.() !== expectedRevision)) {
        throw new Error('workspace import: target changed during staging; generate a fresh preview');
      }
      const stagedReader = openManagedProfileReader(this.options.profileDir);
      try {
        for (const asset of refreshed.bundle.assets.filter((item) => selectedAssetIds.has(item.id))) {
          const bytes = stagedReader.readStrict(managedParts(
            join(stageDir, 'photos', assetNames.get(asset.id)!),
          ), asset.dataBase64.length);
          if (!bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
            throw new Error('workspace import: staged photo failed integrity verification');
          }
        }
      } finally { stagedReader.close(); }

      const finalDiskSnapshot = this.options.store.getPersistedSnapshot?.();
      if (persistedSnapshot && finalDiskSnapshot?.sha256 !== persistedSnapshot.sha256) {
        throw new Error('workspace import: config changed on disk during staging');
      }

      intendedManagedPaths = [
        ...Array.from(assetNames.entries()).map(([assetId, filename]) => ({
          path: managedParts(join(this.options.profileDir, 'photos', filename)),
          kind: 'file',
          ownership: refreshed.bundle.assets.find((asset) => asset.id === assetId)!.sha256,
        })),
        ...refreshed.agentHomes.filter((item) => item.status === 'ready').flatMap((home) => {
          const source = refreshed.bundle.agents.find((agent) => agent.id === home.sourceId)!;
          const targetAgent = next.agents.find((agent) => agent.id === home.targetId)!;
          const files = {
            'MEMORY.md': source.memory?.memory ?? '',
            'USER.md': source.memory?.user ?? '',
            'AGENTS.md': buildAgentRoleBlock(targetAgent),
          };
          const directory = {
            path: managedParts(join(this.options.profileDir, 'agents', home.targetId!, 'memory')),
            kind: 'directory',
            ownership: plan.token,
          };
          const agentDirectory = {
            path: managedParts(join(this.options.profileDir, 'agents', home.targetId!)),
            kind: 'directory',
            ownership: plan.token,
          };
          return [agentDirectory, directory, ...Object.entries(files).map(([name, contents]) => ({
            path: [...directory.path, name], kind: 'file',
            ownership: createHash('sha256').update(contents).digest('hex'),
          }))];
        }),
      ];
      intendedStagePaths = [
        { path: managedParts(stageDir), kind: 'directory', ownership: plan.token },
        ...(selectedAssetIds.size > 0 ? [{
          path: managedParts(join(stageDir, 'photos')), kind: 'directory', ownership: plan.token,
        }] : []),
        ...Array.from(assetNames.entries()).map(([assetId, filename]) => ({
          path: managedParts(join(stageDir, 'photos', filename)), kind: 'file',
          ownership: refreshed.bundle.assets.find((asset) => asset.id === assetId)!.sha256,
        })),
        ...(readyAgentIds.size > 0 ? [{
          path: managedParts(join(stageDir, 'agents')), kind: 'directory', ownership: plan.token,
        }] : []),
        ...refreshed.agentHomes.filter((item) => item.status === 'ready').flatMap((home) => {
          const source = refreshed.bundle.agents.find((agent) => agent.id === home.sourceId)!;
          const targetAgent = next.agents.find((agent) => agent.id === home.targetId)!;
          const agentStage = join(stageDir, 'agents', home.targetId!);
          const memoryStage = join(agentStage, 'memory');
          const files = {
            'MEMORY.md': source.memory?.memory ?? '',
            'USER.md': source.memory?.user ?? '',
            'AGENTS.md': buildAgentRoleBlock(targetAgent),
          };
          return [
            { path: managedParts(agentStage), kind: 'directory', ownership: plan.token },
            { path: managedParts(memoryStage), kind: 'directory', ownership: plan.token },
            ...Object.entries(files).map(([name, contents]) => ({
              path: managedParts(join(memoryStage, name)), kind: 'file',
              ownership: createHash('sha256').update(contents).digest('hex'),
            })),
          ];
        }),
      ];
      journalBase = {
        format: 'ade-workspace-import-journal',
        version: 1,
        beforeConfigSha256: persistedSnapshot?.sha256
          ?? createHash('sha256').update(`${JSON.stringify(current, null, 2)}\n`).digest('hex'),
        targetConfigSha256: createHash('sha256').update(`${JSON.stringify(next, null, 2)}\n`).digest('hex'),
        receiptSha256: '0'.repeat(64),
        backup: basename(backupPath),
        stage: managedParts(stageDir),
        receipt: managedParts(receiptPath),
        stagePaths: intendedStagePaths,
        managedPaths: intendedManagedPaths,
        homes: refreshed.agentHomes.filter((item) => item.status === 'ready').map((home) => ({
          target: home.target,
          canonicalPath: home.canonicalPath,
          ownershipToken: plan.token,
        })),
      };
      writeJournal({ ...journalBase, phase: 'prepared' });

      if (assetNames.size > 0) {
        const photosDir = join(this.options.profileDir, 'photos');
        managedWriter.mkdir(managedParts(photosDir));
        for (const filename of Array.from(assetNames.values())) {
          const staged = join(stageDir, 'photos', filename);
          const installed = join(photosDir, filename);
          managedWriter.link(managedParts(staged), managedParts(installed));
          managedWriter.remove(managedParts(staged));
        }
      }
      for (const home of refreshed.agentHomes.filter((item) => item.status === 'ready')) {
        const createdPaths = await homeProvisioner.ensure(home.target!, home.canonicalPath!, plan.token);
        createdHomes.push({ target: home.target!, paths: createdPaths });
        managedWriter.mkdir(['agents']);
        const targetAgentDir = join(this.options.profileDir, 'agents', home.targetId!);
        managedWriter.mkdir(managedParts(targetAgentDir));
        managedWriter.write(managedParts(join(targetAgentDir, '.ade-workspace-import-owner')), plan.token);
        const installedMemory = join(targetAgentDir, 'memory');
        managedWriter.rename(
          managedParts(join(stageDir, 'agents', home.targetId!, 'memory')),
          managedParts(installedMemory),
        );

      }
      this.options.fault?.('assets-installed');
      this.options.fault?.('cleanup');
      for (const item of intendedStagePaths.slice().reverse()) {
        if (item.kind === 'directory') managedWriter.removeOwnedDirectory(item.path, item.ownership);
        else managedWriter.removeOwnedFile(item.path, item.ownership);
      }

      this.options.store.replace(next, expectedRevision);
      configReplaceAttempted = true;
      committedRevision = this.options.store.getRevision?.();
      this.options.fault?.('config-persisted');

      const receipt: WorkspaceImportReceipt = {
        appliedAt: new Date(now).toISOString(),
        planToken: plan.token,
        backupPath,
        receiptPath,
        imported: {
          repositories: refreshed.repositories.filter((item) => item.status === 'ready').length,
          categories: refreshed.categories.filter((item) => item.status === 'ready').length,
          agents: refreshed.agents.filter((item) => item.status === 'ready').length,
          agentTemplates: refreshed.agentTemplates.filter((item) => item.status === 'ready').length,
        },
        items: ([
          ...refreshed.repositories.map((item) => ({ kind: 'repository' as const, item })),
          ...refreshed.categories.map((item) => ({ kind: 'category' as const, item })),
          ...refreshed.agents.map((item) => ({ kind: 'agent' as const, item })),
          ...refreshed.agentHomes.map((item) => ({ kind: 'agent-home' as const, item })),
          ...refreshed.agentTemplates.map((item) => ({ kind: 'agent-template' as const, item })),
        ]).filter(({ item }) => ['ready', 'reused', 'skipped'].includes(item.status)).map(({ kind, item }) => ({
          kind,
          sourceId: item.sourceId,
          ...(item.targetId ? { targetId: item.targetId } : {}),
          outcome: item.status === 'ready' ? 'imported' as const
            : item.status === 'reused' ? 'reused' as const : 'skipped' as const,
          ...(item.status === 'skipped' ? { reasonCode: 'user-or-dependency-skip' as const } : {}),
        })),
      };
      managedWriter.mkdir(['import-receipts']);
      const durableReceipt = {
        format: 'ade-workspace-import-receipt',
        version: 1,
        status: 'committed',
        appliedAt: receipt.appliedAt,
        planToken: receipt.planToken,
        targetStateHash: refreshed.targetStateHash,
        backup: basename(backupPath),
        imported: receipt.imported,
        items: receipt.items,
        skipped: {
          repositories: refreshed.repositories.filter((item) => item.status === 'skipped').length,
          categories: refreshed.categories.filter((item) => item.status === 'skipped').length,
          agents: refreshed.agents.filter((item) => item.status === 'skipped').length,
          agentTemplates: refreshed.agentTemplates.filter((item) => item.status === 'skipped').length,
        },
      };
      const durableReceiptBytes = `${JSON.stringify(durableReceipt, null, 2)}\n`;
      managedWriter.write(managedParts(receiptTempPath), durableReceiptBytes);
      managedWriter.rename(managedParts(receiptTempPath), managedParts(receiptPath));
      writeJournal({
        ...journalBase,
        phase: 'committed',
        receiptSha256: createHash('sha256').update(durableReceiptBytes).digest('hex'),
      });
      managedWriter.remove(managedParts(journalPath));
      return receipt;
    } catch (error) {
      removeManaged(backupTempPath);
      removeManaged(receiptTempPath);
      removeManaged(receiptPath);
      let rollbackError: unknown;
      let configRestored = true;
      if (configReplaceAttempted) {
        try { this.options.store.replace(current, committedRevision); } catch (caught) {
          rollbackError = caught;
          configRestored = false;
        }
      }
      if (configRestored) {
        for (const item of intendedManagedPaths.slice().reverse()) {
          try {
            if (item.kind === 'directory') managedWriter.removeOwnedDirectory(item.path, item.ownership);
            else managedWriter.removeOwnedFile(item.path, item.ownership);
          } catch (caught) { rollbackError ??= caught; }
        }
        for (const home of createdHomes.reverse()) {
          try { await homeProvisioner.rollback(home.target, home.paths, plan.token); } catch (caught) {
            rollbackError ??= caught;
          }
        }
      }
      for (const item of intendedStagePaths.slice().reverse()) {
        try {
          if (item.kind === 'directory') managedWriter.removeOwnedDirectory(item.path, item.ownership);
          else managedWriter.removeOwnedFile(item.path, item.ownership);
        } catch (caught) { rollbackError ??= caught; }
      }
      if (rollbackError) {
        const original = error instanceof Error ? error.message : String(error);
        const rollback = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        throw new Error(`${original}; rollback failed: ${rollback}`);
      }
      removeManaged(journalPath);
      removeManaged(journalTempPath);
      throw error;
    } finally {
      managedWriter.close();
    }
  }
}
