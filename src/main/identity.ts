/**
 * Category / agent lifecycle (Phase B2).
 *
 * Creation resolves and materializes on-disk directories; deletion only ever
 * removes config entries — user files are never deleted (per SPEC / task).
 * Persistence goes through the existing atomic ConfigStore.
 */

import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Agent,
  AgentCreateInput,
  Category,
  CategoryCreateInput,
} from '../shared/types';
import type { ConfigStore } from './config/store';
import { createMemoryScaffold } from './memory/scaffold';

/** URL/path-safe slug from a display name; never empty. */
function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'item';
}

function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function adeDir(): string {
  return join(app.getPath('userData'), 'ade');
}

export function createCategory(store: ConfigStore, input: CategoryCreateInput): Category {
  const name = input.name.trim();
  if (!name) throw new Error('ade: category name is required');

  const config = store.get();
  const category: Category = {
    id: randomUUID(),
    name,
    photo: input.photo,
    repoPath: input.repoPath,
    agents: [],
  };
  store.save({ categories: [...config.categories, category] });
  return category;
}

export function deleteCategory(store: ConfigStore, id: string): void {
  const config = store.get();
  // Remove the category and its agents from config only — leave workspace,
  // memory and photo files untouched on disk.
  store.save({
    categories: config.categories.filter((c) => c.id !== id),
    agents: config.agents.filter((a) => a.categoryId !== id),
  });
}

export function createAgent(store: ConfigStore, input: AgentCreateInput): Agent {
  const name = input.name.trim();
  if (!name) throw new Error('ade: agent name is required');

  const config = store.get();
  const category = config.categories.find((c) => c.id === input.categoryId);
  if (!category) throw new Error(`ade: category not found "${input.categoryId}"`);

  const id = randomUUID();
  const catSlug = slugify(category.name);
  const takenSlugs = new Set(
    config.agents
      .filter((a) => a.categoryId === category.id)
      .map((a) => slugify(a.name)),
  );
  const agentSlug = uniqueSlug(slugify(name), takenSlugs);

  const base = adeDir();
  // TODO(Phase C): when category.repoPath is set, create a git worktree here
  // instead of a plain directory. For now always the default workspace dir.
  const workspaceDir = join(base, 'workspaces', catSlug, agentSlug);
  // Memory files themselves are Phase D — we only make the empty dir now.
  const memoryDir = join(base, 'agents', id, 'memory');
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(memoryDir, { recursive: true });
  // Phase D: seed empty-but-valid MEMORY.md / USER.md (skipped when disabled).
  createMemoryScaffold(memoryDir, { enabled: config.settings.memory?.enabled });

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
    workspaceDir,
    memoryDir,
  };

  store.save({
    categories: config.categories.map((c) =>
      c.id === category.id ? { ...c, agents: [...c.agents, id] } : c,
    ),
    agents: [...config.agents, agent],
  });
  return agent;
}

export function deleteAgent(store: ConfigStore, id: string): void {
  const config = store.get();
  // Config entries only — never delete the agent's workspace/memory files.
  store.save({
    categories: config.categories.map((c) => ({
      ...c,
      agents: c.agents.filter((aid) => aid !== id),
    })),
    agents: config.agents.filter((a) => a.id !== id),
  });
}
