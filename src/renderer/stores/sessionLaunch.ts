import { create } from 'zustand';
export const useSessionLaunch = create<{ agentId: string | null; open: (id: string) => void; close: () => void }>((set) => ({
  agentId: null, open: (agentId) => set({ agentId }), close: () => set({ agentId: null }),
}));
