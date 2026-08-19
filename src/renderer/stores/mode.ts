/**
 * App mode — which top-level view is shown.
 *   'overview'  : read-only home over catalog, bindings and runs.
 *   'terminals' : the classic rail + tabs + terminal workspace.
 *   'graph'     : the orchestration node canvas.
 * Persisted to localStorage so the choice survives reloads.
 */

import { create } from 'zustand';

export const APP_MODES = ['overview', 'terminals', 'graph'] as const;
export type AppMode = (typeof APP_MODES)[number];

const KEY = 'ade:mode';

function initial(): AppMode {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'overview' || stored === 'graph' || stored === 'terminals') return stored;
  } catch {
    /* ignore */
  }
  return 'terminals';
}

export function adjacentMode(current: AppMode, direction: -1 | 1): AppMode {
  const index = APP_MODES.indexOf(current);
  return APP_MODES[(index + direction + APP_MODES.length) % APP_MODES.length]!;
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
