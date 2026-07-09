/**
 * App mode — which top-level view is shown.
 *   'terminals' : the classic rail + tabs + terminal workspace (unchanged).
 *   'graph'     : the orchestration node canvas (Graph mode).
 * Persisted to localStorage so the choice survives reloads.
 */

import { create } from 'zustand';

export type AppMode = 'terminals' | 'graph';

const KEY = 'ade:mode';

function initial(): AppMode {
  try {
    return localStorage.getItem(KEY) === 'graph' ? 'graph' : 'terminals';
  } catch {
    return 'terminals';
  }
}

interface ModeState {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
}

export const useMode = create<ModeState>((set) => ({
  mode: initial(),
  setMode: (mode) => {
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* ignore quota / privacy-mode errors */
    }
    set({ mode });
  },
}));
