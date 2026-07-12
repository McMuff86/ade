import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type {
  AdeConfig,
  Agent,
  ExecutionScopeSource,
  Repository,
  WorkspaceBinding,
  WorkspaceScopeDescriptor,
} from '../../shared/types';
import {
  createAgentWorktree,
  removeAgentWorktree,
  repositoryIdentity,
} from '../git/GitService';
import { WorkspaceService, type WorkspacePort } from '../orchestration/WorkspaceService';

export interface RepositoryConfigPort {
  get(): AdeConfig;
  save(partial: Partial<AdeConfig>): AdeConfig;
}

export interface ResolveScopeOptions {
  /** string = explicit repo; null = explicit plain home; undefined = agent default. */
  repositoryId?: string | null;
  /** Internal exact binding selection for restart/managed task launch. */
  workspaceBindingId?: string;
}

export interface ResolvedExecutionScope {
  source: ExecutionScopeSource;
  repositoryId?: string;
  workspaceBindingId?: string;
  workspaceDir: string;
  branch: string;
}

export interface ScopeReference {
  repositoryId?: string;
  workspaceBindingId?: string;
  workspaceDir?: string;
  scopeSource?: ExecutionScopeSource;
}

export interface RepositoryScopePort {
  resolve(agentId: string, options?: ResolveScopeOptions): Promise<ResolvedExecutionScope>;
}

/** Owns repository catalog identity and immutable agent/repository worktree bindings. */
export class RepositoryScopeService implements RepositoryScopePort {
  private readonly baseDir: string;
  private readonly bindingCreations = new Map<string, Promise<ResolvedExecutionScope>>();

  constructor(
    private readonly store: RepositoryConfigPort,
    options: { baseDir?: string; workspaces?: WorkspacePort } = {},
  ) {
    this.baseDir = options.baseDir ?? join(app.getPath('userData'), 'ade');
    this.workspaces = options.workspaces ?? new WorkspaceService();
  }

  private readonly workspaces: WorkspacePort;

  async importRepository(path: string, requestedName?: string): Promise<Repository> {
    const identity = await repositoryIdentity(path);
    const config = this.store.get();
    const existing = config.repositories.find(
      (repository) => samePath(repository.commonGitDir, identity.commonGitDir) ||
        (!repository.verified && samePath(repository.rootPath, identity.rootPath)),
    );
    if (existing) {
      const updated = this.verifiedRepository(existing, identity, requestedName);
      if (!sameRepository(existing, updated)) {
        this.store.save({
          repositories: config.repositories.map((repository) =>
            repository.id === updated.id ? updated : repository),
        });
      }
      return { ...updated };
    }

    const name = requestedName?.trim() || basename(identity.rootPath) || 'Repository';
    const repository: Repository = {
      id: randomUUID(),
      name: name.slice(0, 200),
      rootPath: identity.rootPath,
      commonGitDir: identity.commonGitDir,
      verified: true,
      createdAt: Date.now(),
    };
    this.store.save({ repositories: [...config.repositories, repository] });
    return { ...repository };
  }

  async resolve(agentId: string, options: ResolveScopeOptions = {}): Promise<ResolvedExecutionScope> {
    const agent = this.requireAgent(agentId);
    if (options.workspaceBindingId) {
      const binding = this.store.get().workspaceBindings.find(
        (candidate) => candidate.id === options.workspaceBindingId && candidate.agentId === agent.id,
      );
      if (!binding) throw new Error(`ade: workspace binding not found "${options.workspaceBindingId}"`);
      if (options.repositoryId !== undefined && options.repositoryId !== binding.repositoryId) {
        throw new Error('ade: workspace binding does not match the requested repository');
      }
      return this.resolveBinding(binding, 'explicit');
    }

    if (options.repositoryId === null) return this.plainScope(agent);
    const repositoryId = options.repositoryId ?? agent.defaultRepositoryId;
    if (!repositoryId) return this.plainScope(agent);
    const source: ExecutionScopeSource = options.repositoryId ? 'explicit' : 'agent-default';
    const repository = await this.requireVerifiedRepository(repositoryId);
    const existing = this.store.get().workspaceBindings.find(
      (binding) => binding.agentId === agent.id && binding.repositoryId === repository.id,
    );
    if (existing) return this.resolveBinding(existing, source, repository);
    const creationKey = `${agent.id}:${repository.id}`;
    const pending = this.bindingCreations.get(creationKey);
    if (pending) return { ...(await pending), source };
    const creation = this.createBinding(agent, repository, source);
    this.bindingCreations.set(creationKey, creation);
    try {
      return await creation;
    } finally {
      if (this.bindingCreations.get(creationKey) === creation) {
        this.bindingCreations.delete(creationKey);
      }
    }
  }

  async setAgentDefault(agentId: string, repositoryId: string | null): Promise<Agent> {
    const agent = this.requireAgent(agentId);
    const scope = repositoryId ? await this.resolve(agent.id, { repositoryId }) : this.plainScope(agent);
    const current = this.store.get();
    const updated: Agent = {
      ...this.requireAgent(agent.id),
      defaultRepositoryId: repositoryId || undefined,
      // Compatibility alias only; new execution paths always resolve a binding.
      workspaceDir: scope.workspaceDir,
      homeWorkspaceDir: homeWorkspace(agent),
    };
    this.store.save({
      agents: current.agents.map((candidate) => candidate.id === updated.id ? updated : candidate),
    });
    return { ...updated };
  }

  describe(agentId: string, reference?: ScopeReference): WorkspaceScopeDescriptor {
    const config = this.store.get();
    const agent = this.requireAgent(agentId);
    const binding = reference?.workspaceBindingId
      ? config.workspaceBindings.find((candidate) => (
          candidate.id === reference.workspaceBindingId && candidate.agentId === agent.id
        ))
      : config.workspaceBindings.find((candidate) => (
          candidate.agentId === agent.id && candidate.repositoryId === agent.defaultRepositoryId
        ));
    const repositoryId = reference?.repositoryId ?? binding?.repositoryId ?? agent.defaultRepositoryId;
    const repository = repositoryId
      ? config.repositories.find((candidate) => candidate.id === repositoryId)
      : undefined;
    const workspaceDir = reference?.workspaceDir || binding?.workspaceDir || homeWorkspace(agent);
    const source = reference?.scopeSource
      ?? (repositoryId ? 'agent-default' : 'plain-home');
    const activeLease = config.runWorkspaceLeases.some((lease) => (
      lease.status === 'active' && (
        (binding && lease.workspaceBindingId === binding.id) || samePath(lease.workspaceDir, workspaceDir)
      )
    ));
    return {
      agentId: agent.id,
      source,
      repositoryId: repository?.id,
      repositoryName: repository?.name,
      workspaceBindingId: binding?.id,
      workspaceDir,
      branch: binding?.branch ?? '',
      isRepo: Boolean(repository && binding && binding.status !== 'invalid'),
      isDefault: Boolean(repository?.id && repository.id === agent.defaultRepositoryId),
      activeLease,
    };
  }

  private async createBinding(
    agent: Agent,
    repository: Repository,
    source: ExecutionScopeSource,
  ): Promise<ResolvedExecutionScope> {
    const id = randomUUID();
    const agentSlug = `${slugify(agent.name)}-${agent.id.slice(0, 6).toLowerCase()}`;
    const repoSlug = `${slugify(repository.name)}-${repository.id.slice(0, 6).toLowerCase()}`;
    const worktreePath = join(this.baseDir, 'worktrees', repoSlug, agentSlug);
    const conflictingBinding = this.store.get().workspaceBindings.find(
      (candidate) => candidate.status !== 'invalid' && samePath(candidate.workspaceDir, worktreePath),
    );
    if (conflictingBinding) {
      throw new Error(`ade: worktree is already assigned to binding ${conflictingBinding.id}`);
    }
    // A process can stop after `git worktree add` but before config persistence.
    // Adopt that deterministic worktree on retry when its repository identity is exact.
    let inspection = await this.workspaces.inspect(worktreePath);
    let createdBranch = inspection.branch;
    let createdInThisAttempt = false;
    if (!inspection.isRepo) {
      const result = await createAgentWorktree({
        repoPath: repository.rootPath,
        agentSlug,
        worktreePath,
      });
      createdBranch = result.branch;
      createdInThisAttempt = true;
      inspection = await this.workspaces.inspect(result.worktreePath);
    }
    if (!inspection.isRepo || !samePath(inspection.commonGitDir, repository.commonGitDir)) {
      if (createdInThisAttempt) {
        try {
          await removeAgentWorktree(repository.rootPath, worktreePath, createdBranch);
        } catch (rollbackError) {
          throw new Error(
            `ade: created worktree failed identity validation and rollback failed: ${errorMessage(rollbackError)}`,
          );
        }
      }
      throw new Error('ade: created worktree does not belong to the selected repository');
    }
    const now = Date.now();
    const binding: WorkspaceBinding = {
      id,
      agentId: agent.id,
      repositoryId: repository.id,
      workspaceDir: inspection.workspaceDir,
      branch: inspection.branch || createdBranch,
      status: 'ready',
      createdAt: now,
      lastUsedAt: now,
    };
    const config = this.store.get();
    try {
      if (config.workspaceBindings.some(
        (candidate) => candidate.agentId === agent.id && candidate.repositoryId === repository.id,
      )) {
        throw new Error('ade: agent/repository binding was created concurrently');
      }
      this.store.save({ workspaceBindings: [...config.workspaceBindings, binding] });
    } catch (error) {
      // ConfigStore updates its in-memory snapshot before persisting. Restore the
      // prior record set even when the second persistence attempt also fails.
      try {
        this.store.save({ workspaceBindings: config.workspaceBindings });
      } catch {
        // The original persistence error remains the actionable failure.
      }
      if (createdInThisAttempt) {
        try {
          await removeAgentWorktree(repository.rootPath, worktreePath, createdBranch);
        } catch (rollbackError) {
          throw new Error(
            `ade: binding persistence failed and worktree rollback also failed: ${errorMessage(rollbackError)}`,
            { cause: error },
          );
        }
      }
      throw error;
    }
    return {
      source,
      repositoryId: repository.id,
      workspaceBindingId: binding.id,
      workspaceDir: binding.workspaceDir,
      branch: binding.branch,
    };
  }

  private async resolveBinding(
    binding: WorkspaceBinding,
    source: ExecutionScopeSource,
    knownRepository?: Repository,
  ): Promise<ResolvedExecutionScope> {
    if (binding.status === 'invalid') {
      throw new Error(`ade: workspace binding requires repair: ${binding.workspaceDir}`);
    }
    const conflict = this.store.get().workspaceBindings.find((candidate) => (
      candidate.id !== binding.id && candidate.status !== 'invalid' &&
        samePath(candidate.workspaceDir, binding.workspaceDir)
    ));
    if (conflict) {
      this.markBindingInvalid(binding.id);
      throw new Error(`ade: workspace is assigned to multiple bindings (${binding.id}, ${conflict.id})`);
    }
    const repository = knownRepository ?? await this.requireVerifiedRepository(binding.repositoryId);
    const inspection = await this.workspaces.inspect(binding.workspaceDir);
    if (!inspection.isRepo || !samePath(inspection.commonGitDir, repository.commonGitDir)) {
      this.markBindingInvalid(binding.id);
      throw new Error(`ade: workspace binding no longer belongs to ${repository.name}`);
    }
    const updated: WorkspaceBinding = {
      ...binding,
      workspaceDir: inspection.workspaceDir,
      branch: inspection.branch,
      status: 'ready',
      lastUsedAt: Date.now(),
    };
    const config = this.store.get();
    this.store.save({
      workspaceBindings: config.workspaceBindings.map((candidate) =>
        candidate.id === updated.id ? updated : candidate),
    });
    return {
      source,
      repositoryId: repository.id,
      workspaceBindingId: updated.id,
      workspaceDir: updated.workspaceDir,
      branch: updated.branch,
    };
  }

  private plainScope(agent: Agent): ResolvedExecutionScope {
    const workspaceDir = homeWorkspace(agent);
    mkdirSync(workspaceDir, { recursive: true });
    return { source: 'plain-home', workspaceDir, branch: '' };
  }

  private async requireVerifiedRepository(repositoryId: string): Promise<Repository> {
    const repository = this.store.get().repositories.find((candidate) => candidate.id === repositoryId);
    if (!repository) throw new Error(`ade: repository not found "${repositoryId}"`);
    const identity = await repositoryIdentity(repository.rootPath);
    const verified = this.verifiedRepository(repository, identity);
    if (!sameRepository(repository, verified)) {
      const config = this.store.get();
      this.store.save({
        repositories: config.repositories.map((candidate) =>
          candidate.id === verified.id ? verified : candidate),
      });
    }
    return verified;
  }

  private verifiedRepository(
    repository: Repository,
    identity: { rootPath: string; commonGitDir: string },
    requestedName?: string,
  ): Repository {
    return {
      ...repository,
      name: requestedName?.trim().slice(0, 200) || repository.name,
      rootPath: identity.rootPath,
      commonGitDir: identity.commonGitDir,
      verified: true,
    };
  }

  private markBindingInvalid(bindingId: string): void {
    const config = this.store.get();
    this.store.save({
      workspaceBindings: config.workspaceBindings.map((binding) =>
        binding.id === bindingId ? { ...binding, status: 'invalid' } : binding),
    });
  }

  private requireAgent(agentId: string): Agent {
    const agent = this.store.get().agents.find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(`ade: agent not found "${agentId}"`);
    return agent;
  }
}

export function homeWorkspace(agent: Agent): string {
  return resolve(agent.homeWorkspaceDir?.trim() || agent.workspaceDir);
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'item';
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const path = resolve(value).replace(/\\/g, '/').replace(/\/$/, '');
    return process.platform === 'win32' ? path.toLowerCase() : path;
  };
  return normalize(left) === normalize(right);
}

function sameRepository(left: Repository, right: Repository): boolean {
  return left.name === right.name
    && samePath(left.rootPath, right.rootPath)
    && samePath(left.commonGitDir, right.commonGitDir)
    && left.verified === right.verified;
}

function errorMessage(error: unknown): string {
  const detail = error as { stderr?: string; message?: string };
  return (detail.stderr?.trim() || detail.message || String(error)).slice(0, 2_000);
}
