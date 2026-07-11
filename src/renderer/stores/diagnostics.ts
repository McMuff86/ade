import { create } from 'zustand';

interface DiagnosticsUiState {
  open: boolean;
  agentId?: string;
  show: (agentId?: string) => void;
  hide: () => void;
}

export const useDiagnostics = create<DiagnosticsUiState>((set) => ({
  open: false,
  show: (agentId) => set({ open: true, agentId }),
  hide: () => set({ open: false, agentId: undefined }),
}));
