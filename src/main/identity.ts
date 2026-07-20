/**
 * Category / agent lifecycle (Phase B2).
 *
 * Creation resolves and materializes on-disk directories; deletion only ever
 * removes config entries — user files are never deleted (per SPEC / task).
 * Persistence goes through the existing atomic ConfigStore.
 */

import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, posix } from 'node:path';
import type {
  AdeConfig,
  Agent,
  AgentCreateInput,
  AgentTemplate,
  AgentTemplateCreateInput,
  AgentTemplateSpawnInput,
  AgentUpdateInput,
  Category,
  CategoryCreateInput,
  CategoryUpdateInput,
} from '../shared/types';
import {
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_REASONING_EFFORT,
} from '../shared/types';
import {
  NATIVE_EXECUTION_BACKEND,
  isExecutionBackendId,
  type ExecutionBackendId,
} from '../shared/executionBackends';
import { assertAllowedDashboardUrl } from './dashboard/dashboardUrl';
import { syncAgentInstructions } from './memory/agentInstructions';
import { createMemoryScaffold } from './memory/scaffold';
import { RepositoryScopeService } from './repositories/RepositoryScopeService';

export interface IdentityConfigPort {
  get(): AdeConfig;
  save(partial: Partial<AdeConfig>): AdeConfig;
}

export interface IdentityOptions {
  /** Test/recovery override; production identities live below Electron userData. */
  baseDir?: string;
}

function adeDir(): string {
  return join(app.getPath('userData'), 'ade');
}

export async function createCategory(
  store: IdentityConfigPort,
  input: CategoryCreateInput,
  scopes: RepositoryScopeService,
): Promise<Category> {
  const name = input.name.trim();
  if (!name) throw new Error('ade: category name is required');

  let defaultRepositoryId = input.defaultRepositoryId;
  let repoPath = input.repoPath;
  if (repoPath) {
    const repository = await scopes.importRepository(repoPath);
    defaultRepositoryId = repository.id;
    repoPath = repository.rootPath;
  } else if (defaultRepositoryId) {
    const repository = store.get().repositories.find((candidate) => candidate.id === defaultRepositoryId);
    if (!repository) throw new Error(`ade: repository not found "${defaultRepositoryId}"`);
    repoPath = repository.rootPath;
  }

  const config = store.get();
  const category: Category = {
    id: randomUUID(),
    name,
    photo: input.photo,
    repoPath,
    defaultRepositoryId,
    agents: [],
    kind: input.kind,
  };
  store.save({ categories: [...config.categories, category] });
  return category;
}

/** Rename a category and set/remove its photo; structure and repo stay put. */
export function updateCategory(store: IdentityConfigPort, input: CategoryUpdateInput): Category {
  const name = input.name.trim();
  if (!name) throw new Error('ade: category name is required');
  const config = store.get();
  const existing = config.categories.find((candidate) => candidate.id === input.id);
  if (!existing) throw new Error(`ade: category not found "${input.id}"`);
  const updated: Category = {
    ...existing,
    name,
    photo: input.photo === undefined ? existing.photo : (input.photo || undefined),
  };
  store.save({
    categories: config.categories.map((candidate) =>
      candidate.id === updated.id ? updated : candidate),
  });
  return { ...updated };
}

/** Reorder the rail: `orderedIds` must list every category exactly once. */
export function reorderCategories(store: IdentityConfigPort, orderedIds: string[]): void {
  const config = store.get();
  const byId = new Map(config.categories.map((category) => [category.id, category]));
  if (orderedIds.length !== byId.size || new Set(orderedIds).size !== orderedIds.length) {
    throw new Error('ade: category order must list every category exactly once');
  }
  const categories = orderedIds.map((id) => {
    const category = byId.get(id);
    if (!category) throw new Error(`ade: category not found "${id}"`);
    return category;
  });
  store.save({ categories });
}

/**
 * Place an agent at `index` of `categoryId`'s list (index counted with the
 * agent already removed; clamped). Also serves cross-category drag moves.
 */
export function moveAgent(
  store: IdentityConfigPort,
  input: { agentId: string; categoryId: string; index: number },
): void {
  const config = store.get();
  const agent = config.agents.find((candidate) => candidate.id === input.agentId);
  if (!agent) throw new Error(`ade: agent not found "${input.agentId}"`);
  if (!config.categories.some((category) => category.id === input.categoryId)) {
    throw new Error(`ade: category not found "${input.categoryId}"`);
  }
  const categories = config.categories.map((category) => {
    const without = category.agents.filter((id) => id !== input.agentId);
    if (category.id !== input.categoryId) {
      return without.length === category.agents.length ? category : { ...category, agents: without };
    }
    const at = Math.max(0, Math.min(input.index, without.length));
    return { ...category, agents: [...without.slice(0, at), input.agentId, ...without.slice(at)] };
  });
  store.save({
    categories,
    agents: agent.categoryId === input.categoryId
      ? config.agents
      : config.agents.map((candidate) =>
        candidate.id === agent.id ? { ...candidate, categoryId: input.categoryId } : candidate),
  });
}

export function deleteCategory(store: IdentityConfigPort, id: string): void {
  const config = store.get();
  const removedAgentIds = new Set(
    config.agents.filter((agent) => agent.categoryId === id).map((agent) => agent.id),
  );
  // Remove the category and its agents from config only — leave workspace,
  // memory and photo files untouched on disk.
  store.save({
    categories: config.categories.filter((c) => c.id !== id),
    agents: config.agents.filter((a) => a.categoryId !== id),
    workspaceBindings: config.workspaceBindings.filter((binding) => !removedAgentIds.has(binding.agentId)),
  });
}

export async function createAgent(
  store: IdentityConfigPort,
  input: AgentCreateInput,
  scopes: RepositoryScopeService,
  options: IdentityOptions = {},
): Promise<Agent> {
  const name = input.name.trim();
  if (!name) throw new Error('ade: agent name is required');

  const config = store.get();
  const category = config.categories.find((c) => c.id === input.categoryId);
  if (!category) throw new Error(`ade: category not found "${input.categoryId}"`);

  const id = randomUUID();
  const base = options.baseDir ?? adeDir();
  const homeWorkspaceDir = join(base, 'agents', id, 'workspace');
  const memoryDir = join(base, 'agents', id, 'memory');
  mkdirSync(homeWorkspaceDir, { recursive: true });
  mkdirSync(memoryDir, { recursive: true });
  createMemoryScaffold(memoryDir, { enabled: config.settings.memory?.enabled });

  const defaultRepositoryId = input.defaultRepositoryId === undefined
    ? category.defaultRepositoryId
    : (input.defaultRepositoryId || undefined);
  if (defaultRepositoryId && !config.repositories.some((repository) => repository.id === defaultRepositoryId)) {
    throw new Error(`ade: repository not found "${defaultRepositoryId}"`);
  }

  const agent: Agent = {
    id,
    categoryId: category.id,
    name,
    role: input.role,
    photo: input.photo,
    runtime: input.runtime,
    permissionMode: input.permissionMode,
    customCommand: input.customCommand,
    ollamaModel: input.ollamaModel,
    codexModel: input.runtime === 'codex'
      ? input.codexModel?.trim() || DEFAULT_CODEX_MODEL
      : undefined,
    codexReasoningEffort: input.runtime === 'codex'
      ? input.codexReasoningEffort ?? DEFAULT_CODEX_REASONING_EFFORT
      : undefined,
    workspaceDir: homeWorkspaceDir,
    homeWorkspaceDir,
    defaultRepositoryId,
    memoryDir,
    teamRole: input.teamRole,
  };
  syncAgentInstructions(agent);

  store.save({
    categories: config.categories.map((c) =>
      c.id === category.id ? { ...c, agents: [...c.agents, id] } : c,
    ),
    agents: [...config.agents, agent],
  });

  try {
    if (defaultRepositoryId) return await scopes.setAgentDefault(agent.id, defaultRepositoryId);
    return agent;
  } catch (error) {
    const latest = store.get();
    store.save({
      categories: latest.categories.map((candidate) => candidate.id === category.id
        ? { ...candidate, agents: candidate.agents.filter((agentId) => agentId !== agent.id) }
        : candidate),
      agents: latest.agents.filter((candidate) => candidate.id !== agent.id),
      workspaceBindings: latest.workspaceBindings.filter((binding) => binding.agentId !== agent.id),
    });
    throw error;
  }
}

export async function updateAgent(
  store: IdentityConfigPort,
  input: AgentUpdateInput,
  scopes: RepositoryScopeService,
): Promise<Agent> {
  const name = input.name.trim();
  if (!name) throw new Error('ade: agent name is required');

  const config = store.get();
  const existing = config.agents.find((a) => a.id === input.id);
  if (!existing) throw new Error(`ade: agent not found "${input.id}"`);

  const home = resolveAgentHome(existing, input);

  const dashboardUrl = input.dashboardUrl === undefined
    ? existing.dashboardUrl
    : (input.dashboardUrl.trim() || undefined);
  if (dashboardUrl) assertAllowedDashboardUrl(dashboardUrl);

  let updated: Agent = {
    ...existing,
    ...home,
    name,
    photo: input.photo === undefined ? existing.photo : (input.photo || undefined),
    dashboardUrl,
    dashboardCommand: input.dashboardCommand === undefined
      ? existing.dashboardCommand
      : (input.dashboardCommand.trim() || undefined),
    dashboardTarget: input.dashboardTarget ?? existing.dashboardTarget,
    role: input.role?.trim() || undefined,
    runtime: input.runtime,
    permissionMode: input.permissionMode,
    customCommand: input.customCommand?.trim() || undefined,
    ollamaModel:
      input.runtime === 'ollama' && input.ollamaModel?.trim()
        ? input.ollamaModel.trim()
        : undefined,
    codexModel: input.runtime === 'codex'
      ? input.codexModel?.trim() || DEFAULT_CODEX_MODEL
      : undefined,
    codexReasoningEffort: input.runtime === 'codex'
      ? input.codexReasoningEffort ?? DEFAULT_CODEX_REASONING_EFFORT
      : undefined,
    teamRole: input.teamRole ?? existing.teamRole,
  };

  syncAgentInstructions(updated);

  store.save({
    agents: config.agents.map((a) => (a.id === updated.id ? updated : a)),
  });
  if (input.defaultRepositoryId !== undefined) {
    try {
      updated = await scopes.setAgentDefault(updated.id, input.defaultRepositoryId);
    } catch (error) {
      // The scope probe (e.g. mkdir of a WSL home) failed after the record was
      // written; restore the previous agent so no broken home is persisted.
      const current = store.get();
      store.save({
        agents: current.agents.map((a) => (a.id === existing.id ? existing : a)),
      });
      throw error;
    }
  }
  return updated;
}

/**
 * Validated home scope for repo-less sessions. Switching the backend never
 * silently reuses a path from the other world: WSL requires an explicit
 * POSIX-absolute directory, and leaving WSL falls back to the ADE-owned home.
 */
function resolveAgentHome(
  existing: Agent,
  input: Pick<AgentUpdateInput, 'homeExecutionBackend' | 'homeWorkspaceDir'>,
): Pick<Agent, 'homeExecutionBackend' | 'homeWorkspaceDir'> {
  if (input.homeExecutionBackend !== undefined && !isExecutionBackendId(input.homeExecutionBackend)) {
    throw new Error('ade: home backend must be "native" or "wsl:<distribution>"');
  }
  const backend: ExecutionBackendId = input.homeExecutionBackend
    ?? existing.homeExecutionBackend
    ?? NATIVE_EXECUTION_BACKEND;
  const requested = input.homeWorkspaceDir?.trim();
  const defaultHome = join(dirname(existing.memoryDir), 'workspace');

  if (backend === NATIVE_EXECUTION_BACKEND) {
    const dir = requested === undefined
      ? (existing.homeExecutionBackend ? defaultHome : existing.homeWorkspaceDir)
      : (requested || defaultHome);
    if (dir !== undefined && !isAbsolute(dir)) {
      throw new Error('ade: agent home must be an absolute path');
    }
    return { homeExecutionBackend: undefined, homeWorkspaceDir: dir };
  }

  const dir = requested ?? (existing.homeExecutionBackend ? existing.homeWorkspaceDir : undefined);
  const normalized = dir?.replace(/\\/g, '/');
  if (!normalized || !posix.isAbsolute(normalized)) {
    throw new Error('ade: a WSL agent home requires an absolute Linux path (e.g. /home/user/project)');
  }
  return { homeExecutionBackend: backend, homeWorkspaceDir: posix.normalize(normalized) };
}

export function deleteAgent(store: IdentityConfigPort, id: string): void {
  const config = store.get();
  // Config entries only — never delete the agent's workspace/memory files.
  // A repo-backed agent's worktree is left on disk and its metadata is NOT
  // pruned here.
  // TODO(Phase C+): optionally `git worktree prune` / remove the branch when a
  // repo-backed agent is deleted (kept off for now so nothing is destroyed).
  store.save({
    categories: config.categories.map((c) => ({
      ...c,
      agents: c.agents.filter((aid) => aid !== id),
    })),
    agents: config.agents.filter((a) => a.id !== id),
    workspaceBindings: config.workspaceBindings.filter((binding) => binding.agentId !== id),
  });
}

export function createAgentTemplate(
  store: IdentityConfigPort,
  input: AgentTemplateCreateInput,
): AgentTemplate {
  const name = input.name.trim();
  if (!name) throw new Error('ade: template name is required');
  const config = store.get();
  const agent = config.agents.find((candidate) => candidate.id === input.sourceAgentId);
  if (!agent) throw new Error(`ade: template source agent not found "${input.sourceAgentId}"`);
  syncAgentInstructions(agent);
  const now = Date.now();
  const template: AgentTemplate = {
    id: randomUUID(),
    name,
    role: agent.role,
    photo: agent.photo,
    runtime: agent.runtime,
    permissionMode: agent.permissionMode,
    customCommand: agent.customCommand,
    ollamaModel: agent.ollamaModel,
    codexModel: agent.codexModel,
    codexReasoningEffort: agent.codexReasoningEffort,
    memorySeed: {
      memory: readMemorySeed(join(agent.memoryDir, 'MEMORY.md')),
      user: readMemorySeed(join(agent.memoryDir, 'USER.md')),
    },
    createdAt: now,
    updatedAt: now,
  };
  store.save({ agentTemplates: [...config.agentTemplates, template] });
  return structuredClone(template);
}

export function deleteAgentTemplate(store: IdentityConfigPort, id: string): void {
  const config = store.get();
  if (!config.agentTemplates.some((template) => template.id === id)) return;
  store.save({ agentTemplates: config.agentTemplates.filter((template) => template.id !== id) });
}

export async function spawnAgentTemplate(
  store: IdentityConfigPort,
  input: AgentTemplateSpawnInput,
  scopes: RepositoryScopeService,
  options: IdentityOptions = {},
): Promise<Agent> {
  const template = store.get().agentTemplates.find((candidate) => candidate.id === input.templateId);
  if (!template) throw new Error(`ade: agent template not found "${input.templateId}"`);
  const agent = await createAgent(store, {
    categoryId: input.categoryId,
    name: input.name?.trim() || template.name,
    role: input.role?.trim() || template.role,
    photo: input.photo ?? template.photo,
    runtime: input.runtime ?? template.runtime,
    permissionMode: input.permissionMode ?? template.permissionMode,
    customCommand: input.customCommand?.trim() || template.customCommand,
    ollamaModel: input.ollamaModel?.trim() || template.ollamaModel,
    codexModel: input.codexModel?.trim() || template.codexModel,
    codexReasoningEffort: input.codexReasoningEffort ?? template.codexReasoningEffort,
    defaultRepositoryId: input.defaultRepositoryId,
  }, scopes, options);
  writeFileSync(join(agent.memoryDir, 'MEMORY.md'), template.memorySeed.memory, 'utf8');
  writeFileSync(join(agent.memoryDir, 'USER.md'), template.memorySeed.user, 'utf8');
  return agent;
}

const TEMPLATE_MEMORY_CAP = 32_000;

function readMemorySeed(path: string): string {
  try {
    return sanitizeTemplateSeed(readFileSync(path, 'utf8').slice(0, TEMPLATE_MEMORY_CAP));
  } catch {
    return '';
  }
}

function sanitizeTemplateSeed(seed: string): string {
  const redacted = '[redacted by ADE template]';
  return seed
    .replace(
      /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi,
      redacted,
    )
    .replace(
      /^(\s*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret|private[_-]?key)\s*[:=]\s*).+$/gim,
      `$1${redacted}`,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, `Bearer ${redacted}`)
    .replace(/(https?:\/\/)[^/\s:@]+:[^@\s/]+@/gi, `$1${redacted}@`);
}
