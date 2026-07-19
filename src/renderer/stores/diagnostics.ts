import { create } from 'zustand';

interface DiagnosticsUiState {
  open: boolean;
  agentId?: string;
  sessionId?: string;
  show: (agentId?: string, sessionId?: string) => void;
  hide: () => void;
}

export const useDiagnostics = create<DiagnosticsUiState>((set) => ({
  open: false,
  show: (agentId, sessionId) => set({ open: true, agentId, sessionId }),
  hide: () => set({ open: false, agentId: undefined, sessionId: undefined }),
}));
