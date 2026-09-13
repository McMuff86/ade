import { create } from 'zustand';
export const useSessionLaunch = create<{ agentId: string | null; terminalHome: boolean; open: (id: string | null) => void; close: () => void }>((set) => ({
  agentId: null, terminalHome: false, open: (agentId) => set({ agentId, terminalHome: agentId === null }), close: () => set({ agentId: null, terminalHome: false }),
}));
