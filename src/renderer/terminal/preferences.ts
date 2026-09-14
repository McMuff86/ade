import { create } from 'zustand';

const KEY = 'ade:terminal-font-size';
export const TERMINAL_FONT_SIZES = [11, 13, 15, 17, 20, 24] as const;
const valid = (size: number) => TERMINAL_FONT_SIZES.some((value) => value === size);
function initialSize(): number {
  try { const size = Number(localStorage.getItem(KEY)); return valid(size) ? size : 13; }
  catch { return 13; }
}

/** Renderer-only display preference; never changes runtime or host settings. */
export const useTerminalPreferences = create<{ fontSize: number; setFontSize: (size: number) => void }>((set) => ({
  fontSize: initialSize(),
  setFontSize: (size) => {
    if (!valid(size)) return;
    try { localStorage.setItem(KEY, String(size)); } catch { /* in-memory fallback */ }
    set({ fontSize: size });
  },
}));
