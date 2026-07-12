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
  Repository,
  WorkspaceBinding,
} from '../../shared/types';

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
  createAgent: (input: AgentCreateInput) => Promise<Agent>;
  updateAgent: (input: AgentUpdateInput) => Promise<Agent>;
  setAgentDefaultRepository: (agentId: string, repositoryId: string | null) => Promise<Agent>;
  importRepository: (path: string, name?: string) => Promise<Repository>;
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

export const useAppData = create<AppDataState>((set) => ({
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

  importRepository: async (path, name) => {
    const repository = await window.ade.invoke('repository:import', { path, name });
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
