/**
 * Zustand settings store — mirrors config.settings and persists changes
 * through the config IPC (main writes userData/ade/config.json atomically).
 */

import { create } from 'zustand';
import { DEFAULT_INSPECTOR_SIDE, type InspectorSide, type ThemeName } from '../../shared/types';

interface SettingsState {
  theme: ThemeName;
  inspectorSide: InspectorSide;
  /** true once the persisted config has been loaded */
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;
  setInspectorSide: (inspectorSide: InspectorSide) => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  theme: 'dark',
  inspectorSide: DEFAULT_INSPECTOR_SIDE,
  hydrated: false,

  hydrate: async () => {
    try {
      const config = await window.ade.invoke('config:get');
      set({
        theme: config.settings.theme,
        inspectorSide: config.settings.inspectorSide === 'left' ? 'left' : DEFAULT_INSPECTOR_SIDE,
        hydrated: true,
      });
    } catch (err) {
      console.error('[ade] failed to load config, using defaults:', err);
      set({ hydrated: true });
    }
  },

  setTheme: (theme) => {
    set({ theme });
    window.ade.invoke('config:save', { settings: { theme } }).catch((err) => {
      console.error('[ade] failed to persist theme:', err);
    });
  },

  toggleTheme: () => {
    get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
  },

  setInspectorSide: (inspectorSide) => {
    set({ inspectorSide });
    window.ade.invoke('config:save', { settings: { inspectorSide } }).catch((err) => {
      console.error('[ade] failed to persist inspector side:', err);
    });
  },
}));
