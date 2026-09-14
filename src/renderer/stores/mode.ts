/**
 * App mode — which top-level view is shown.
 *   'overview'  : read-only home over catalog, bindings and runs.
 *   'projects'  : discovered folders and independent project workspaces.
 *   'terminals' : the classic rail + tabs + terminal workspace.
 *   'graph'     : the orchestration node canvas.
 * Persisted to localStorage so the choice survives reloads.
 */

import { create } from 'zustand';
import { APP_VIEWS, type AppView } from '../../shared/appViews';

export const APP_MODES = APP_VIEWS.map(view => view.id);
export type AppMode = AppView;

const KEY = 'ade:mode';

function initial(): AppMode {
  try {
    const stored = localStorage.getItem(KEY);
    if (APP_MODES.includes(stored as AppMode)) return stored as AppMode;
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
