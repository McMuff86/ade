/**
 * Zustand settings store — mirrors config.settings and persists changes
 * through the config IPC (main writes userData/ade/config.json atomically).
 */

import { create } from 'zustand';
import type { ThemeName } from '../../shared/types';

interface SettingsState {
  theme: ThemeName;
  /** true once the persisted config has been loaded */
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  theme: 'dark',
  hydrated: false,

  hydrate: async () => {
    try {
      const config = await window.ade.invoke('config:get');
      set({ theme: config.settings.theme, hydrated: true });
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
}));
