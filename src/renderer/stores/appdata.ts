/** Renderer mirror of the persistent catalog and Goal 5 repository model. */

import { create } from 'zustand';
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
  Repository,
  WorkspaceBinding,
} from '../../shared/types';
import type { ExecutionBackendId } from '../../shared/executionBackends';

interface CatalogSlice {
  categories: Category[];
  agents: Record<string, Agent>;
  repositories: Repository[];
  workspaceBindings: WorkspaceBinding[];
  agentTemplates: AgentTemplate[];
}

interface AppDataState extends CatalogSlice {
  loaded: boolean;

  load: () => Promise<void>;
  refresh: () => Promise<void>;
  createCategory: (input: CategoryCreateInput) => Promise<Category>;
  updateCategory: (input: CategoryUpdateInput) => Promise<Category>;
  reorderCategories: (orderedIds: string[]) => Promise<void>;
  moveAgent: (agentId: string, categoryId: string, index: number) => Promise<void>;
  createAgent: (input: AgentCreateInput) => Promise<Agent>;
  updateAgent: (input: AgentUpdateInput) => Promise<Agent>;
  setAgentDefaultRepository: (agentId: string, repositoryId: string | null) => Promise<Agent>;
  importRepository: (
    path: string,
    name?: string,
    executionBackend?: ExecutionBackendId,
  ) => Promise<Repository>;
  createAgentTemplate: (input: AgentTemplateCreateInput) => Promise<AgentTemplate>;
  deleteAgentTemplate: (id: string) => Promise<void>;
  spawnAgentTemplate: (input: AgentTemplateSpawnInput) => Promise<Agent>;
  deleteCategory: (id: string) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
}

function catalogState(config: AdeConfig): CatalogSlice {
  return {
    categories: config.categories,
    agents: Object.fromEntries(config.agents.map((agent) => [agent.id, agent])),
    repositories: config.repositories,
    workspaceBindings: config.workspaceBindings,
    agentTemplates: config.agentTemplates,
  };
}

async function readCatalog(): Promise<CatalogSlice> {
  return catalogState(await window.ade.invoke('config:get'));
}

export const useAppData = create<AppDataState>((set, get) => ({
  categories: [],
  agents: {},
  repositories: [],
  workspaceBindings: [],
  agentTemplates: [],
  loaded: false,

  load: async () => {
    try {
      set({ ...(await readCatalog()), loaded: true });
    } catch (error) {
      console.error('[ade] failed to load app data:', error);
      set({ loaded: true });
    }
  },

  refresh: async () => set({ ...(await readCatalog()), loaded: true }),

  createCategory: async (input) => {
    const category = await window.ade.invoke('category:create', input);
    set(await readCatalog());
    return category;
  },

  updateCategory: async (input) => {
    const category = await window.ade.invoke('category:update', input);
    set(await readCatalog());
    return category;
  },

  // Drag & drop: apply optimistically so the drop lands instantly, then
  // reconcile with the persisted catalog (also reverts on rejection).
  reorderCategories: async (orderedIds) => {
    const byId = new Map(get().categories.map((category) => [category.id, category]));
    const optimistic = orderedIds
      .map((id) => byId.get(id))
      .filter((category): category is Category => Boolean(category));
    if (optimistic.length === byId.size) set({ categories: optimistic });
    try {
      await window.ade.invoke('category:reorder', { orderedIds });
    } finally {
      set(await readCatalog());
    }
  },

  moveAgent: async (agentId, categoryId, index) => {
    const current = get();
    const agent = current.agents[agentId];
    if (agent) {
      const categories = current.categories.map((category) => {
        const without = category.agents.filter((id) => id !== agentId);
        if (category.id !== categoryId) {
          return without.length === category.agents.length ? category : { ...category, agents: without };
        }
        const at = Math.max(0, Math.min(index, without.length));
        return { ...category, agents: [...without.slice(0, at), agentId, ...without.slice(at)] };
      });
      set({ categories, agents: { ...current.agents, [agentId]: { ...agent, categoryId } } });
    }
    try {
      await window.ade.invoke('agent:move', { agentId, categoryId, index });
    } finally {
      set(await readCatalog());
    }
  },

  createAgent: async (input) => {
    const agent = await window.ade.invoke('agent:create', input);
    set(await readCatalog());
    return agent;
  },

  updateAgent: async (input) => {
    const agent = await window.ade.invoke('agent:update', input);
    set(await readCatalog());
    return agent;
  },

  setAgentDefaultRepository: async (agentId, repositoryId) => {
    const agent = await window.ade.invoke('agent:setDefaultRepository', { agentId, repositoryId });
    set(await readCatalog());
    return agent;
  },

  importRepository: async (path, name, executionBackend) => {
    const repository = await window.ade.invoke('repository:import', { path, name, executionBackend });
    set(await readCatalog());
    return repository;
  },

  createAgentTemplate: async (input) => {
    const template = await window.ade.invoke('agentTemplate:create', input);
    set(await readCatalog());
    return template;
  },

  deleteAgentTemplate: async (id) => {
    await window.ade.invoke('agentTemplate:delete', { id });
    set(await readCatalog());
  },

  spawnAgentTemplate: async (input) => {
    const agent = await window.ade.invoke('agentTemplate:spawn', input);
    set(await readCatalog());
    return agent;
  },

  deleteCategory: async (id) => {
    await window.ade.invoke('category:delete', { id });
    set(await readCatalog());
  },

  deleteAgent: async (id) => {
    await window.ade.invoke('agent:delete', { id });
    set(await readCatalog());
  },
}));
