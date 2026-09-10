import { create } from 'zustand';

/**
 * Cross-cutting selection state shared between the rail (sets it) and the
 * tab strip / terminal area (read it). Kept minimal on purpose — session
 * state lives in stores/sessions.ts, app data in stores/appdata.ts.
 */
interface SelectionState {
  projectWorkspaceId: string | null;
  projectRepositoryId: string | null;
  projectSessionId: string | null;
  openProjectRepository: (id: string) => void;
  openProjectSession: (workspaceId: string, sessionId: string) => void;
  setProjectWorkspace: (id: string | null) => void;
  selectedAgentId: string | null;
  selectedRepositoryId: string | null;
  setSelectedAgent: (id: string | null) => void;
  setSelectedRepository: (id: string | null) => void;
}

export const useSelection = create<SelectionState>((set) => ({
  projectWorkspaceId: null,
  projectRepositoryId: null,
  projectSessionId: null,
  openProjectRepository: (id) => set({ projectRepositoryId: id, projectWorkspaceId: null, projectSessionId: null }),
  openProjectSession: (workspaceId, sessionId) => set({ projectWorkspaceId: workspaceId, projectRepositoryId: null, projectSessionId: sessionId }),
  setProjectWorkspace: (id) => set({ projectWorkspaceId: id, projectRepositoryId: null, projectSessionId: null }),
  selectedAgentId: null,
  selectedRepositoryId: null,
  setSelectedAgent: (id) => set({ selectedAgentId: id }),
  setSelectedRepository: (id) => set({ selectedRepositoryId: id }),
}));
