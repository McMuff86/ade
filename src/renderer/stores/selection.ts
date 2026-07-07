import { create } from 'zustand';

/**
 * Cross-cutting selection state shared between the rail (sets it) and the
 * tab strip / terminal area (read it). Kept minimal on purpose — session
 * state lives in stores/sessions.ts, app data in stores/appdata.ts.
 */
interface SelectionState {
  selectedAgentId: string | null;
  setSelectedAgent: (id: string | null) => void;
}

export const useSelection = create<SelectionState>((set) => ({
  selectedAgentId: null,
  setSelectedAgent: (id) => set({ selectedAgentId: id }),
}));
