/**
 * App-data store — the renderer-side mirror of the persisted config
 * (categories + agents). THIS API IS A CONTRACT: the rail, tab strip and
 * later phases code against exactly this shape.
 *
 *   state   { categories: Category[]; agents: Record<string, Agent>; loaded }
 *   actions { load, createCategory, createAgent, deleteCategory, deleteAgent }
 *
 * `agents` is keyed by id for O(1) lookup; `categories[].agents` holds the
 * ordered id list (rail order). Every mutation round-trips through main IPC
 * first, then updates local state from the authoritative result.
 */

import { create } from 'zustand';
import type {
  Agent,
  AgentCreateInput,
  AgentUpdateInput,
  Category,
  CategoryCreateInput,
} from '../../shared/types';

interface AppDataState {
  categories: Category[];
  agents: Record<string, Agent>;
  loaded: boolean;

  load: () => Promise<void>;
  createCategory: (input: CategoryCreateInput) => Promise<Category>;
  createAgent: (input: AgentCreateInput) => Promise<Agent>;
  updateAgent: (input: AgentUpdateInput) => Promise<Agent>;
  deleteCategory: (id: string) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
}

export const useAppData = create<AppDataState>((set) => ({
  categories: [],
  agents: {},
  loaded: false,

  load: async () => {
    try {
      const config = await window.ade.invoke('config:get');
      set({
        categories: config.categories,
        agents: Object.fromEntries(config.agents.map((a) => [a.id, a])),
        loaded: true,
      });
    } catch (err) {
      console.error('[ade] failed to load app data:', err);
      set({ loaded: true });
    }
  },

  createCategory: async (input) => {
    const category = await window.ade.invoke('category:create', input);
    set((s) => ({ categories: [...s.categories, category] }));
    return category;
  },

  createAgent: async (input) => {
    const agent = await window.ade.invoke('agent:create', input);
    set((s) => ({
      agents: { ...s.agents, [agent.id]: agent },
      categories: s.categories.map((c) =>
        c.id === agent.categoryId ? { ...c, agents: [...c.agents, agent.id] } : c,
      ),
    }));
    return agent;
  },

  updateAgent: async (input) => {
    const agent = await window.ade.invoke('agent:update', input);
    set((s) => ({
      agents: { ...s.agents, [agent.id]: agent },
    }));
    return agent;
  },

  deleteCategory: async (id) => {
    await window.ade.invoke('category:delete', { id });
    set((s) => {
      const agents = { ...s.agents };
      for (const a of Object.values(agents)) {
        if (a.categoryId === id) delete agents[a.id];
      }
      return { categories: s.categories.filter((c) => c.id !== id), agents };
    });
  },

  deleteAgent: async (id) => {
    await window.ade.invoke('agent:delete', { id });
    set((s) => {
      const agents = { ...s.agents };
      delete agents[id];
      return {
        agents,
        categories: s.categories.map((c) => ({
          ...c,
          agents: c.agents.filter((aid) => aid !== id),
        })),
      };
    });
  },
}));
