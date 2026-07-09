/**
 * Graph-mode view state that does NOT belong in the persisted app config:
 *   - node positions (persisted to localStorage; the graph is a view over the
 *     real category/agent data, so layout is purely presentational)
 *   - transient per-agent status during task dispatch ('working' → 'done')
 *   - which teams the user has explicitly paused (idle)
 *   - the currently selected graph node
 *
 * Real structure (teams, leads, workers) is derived from stores/appdata.ts;
 * real "running" status is derived from stores/sessions.ts. See graphModel.ts.
 */

import { create } from 'zustand';

export interface Pos {
  x: number;
  y: number;
}

export type TransientStatus = 'working' | 'done';

/** What a graph node points at. `id` is an agentId (nodes) or categoryId (team frame). */
export interface GraphSelection {
  kind: 'orchestrator' | 'lead' | 'worker' | 'team';
  id: string;
  /** categoryId for lead/worker/team selections. */
  teamId?: string;
}

const POS_KEY = 'ade:graph:pos';

function loadPositions(): Record<string, Pos> {
  try {
    const raw = localStorage.getItem(POS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Pos>) : {};
  } catch {
    return {};
  }
}

interface GraphStoreState {
  positions: Record<string, Pos>;
  busy: Record<string, TransientStatus>;
  idleTeams: Record<string, true>;
  selection: GraphSelection | null;

  setPosition: (key: string, pos: Pos) => void;
  clearPositions: () => void;
  setBusy: (agentId: string, status: TransientStatus) => void;
  clearBusy: (agentId: string) => void;
  setTeamIdle: (teamId: string, idle: boolean) => void;
  select: (sel: GraphSelection | null) => void;
}

export const useGraphStore = create<GraphStoreState>((set) => ({
  positions: loadPositions(),
  busy: {},
  idleTeams: {},
  selection: null,

  setPosition: (key, pos) =>
    set((s) => {
      const positions = { ...s.positions, [key]: pos };
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(positions));
      } catch {
        /* ignore */
      }
      return { positions };
    }),

  clearPositions: () =>
    set(() => {
      try {
        localStorage.removeItem(POS_KEY);
      } catch {
        /* ignore */
      }
      return { positions: {} };
    }),

  setBusy: (agentId, status) => set((s) => ({ busy: { ...s.busy, [agentId]: status } })),
  clearBusy: (agentId) =>
    set((s) => {
      const busy = { ...s.busy };
      delete busy[agentId];
      return { busy };
    }),

  setTeamIdle: (teamId, idle) =>
    set((s) => {
      const idleTeams = { ...s.idleTeams };
      if (idle) idleTeams[teamId] = true;
      else delete idleTeams[teamId];
      return { idleTeams };
    }),

  select: (selection) => set({ selection }),
}));
