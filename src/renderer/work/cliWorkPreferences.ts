import { create } from 'zustand';
import type { CliWorkPreference } from '../../shared/cliWork';

const KEY = 'ade:cli-work';
const LIMIT = 256;
function read(): Record<string, CliWorkPreference> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).slice(-LIMIT).flatMap(([id, value]) => {
      if (!/^s[a-z0-9]+$/i.test(id) || !value || typeof value !== 'object') return [];
      const item = value as CliWorkPreference;
      return Number.isFinite(item.updatedAt) ? [[id, { updatedAt: item.updatedAt,
        title: typeof item.title === 'string' ? item.title.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 120) : undefined,
        seenSequence: Number.isSafeInteger(item.seenSequence) && item.seenSequence! >= 0 ? item.seenSequence : 0 }]] : [];
    }));
  } catch { return {}; }
}
export const useCliWorkPreferences = create<{ entries: Record<string, CliWorkPreference>; update: (id: string, value: Partial<CliWorkPreference>) => void }>((set) => ({
  entries: read(),
  update: (id, value) => set(state => {
    const entries = Object.fromEntries(Object.entries({ ...state.entries, [id]: { ...state.entries[id], ...value, updatedAt: Date.now() } })
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, LIMIT));
    try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch { /* Current-window state remains usable. */ }
    return { entries };
  }),
}));
