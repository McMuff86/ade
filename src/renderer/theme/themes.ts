/**
 * Per-theme xterm terminal themes.
 * Shape mirrors @xterm/xterm's ITheme — xterm itself is installed in Phase B1;
 * this stays a plain typed object so the contract exists now. Theme switches
 * must set `terminal.options.theme = XTERM_THEMES[theme]` on every live
 * terminal (SPEC #8: the terminal changes, not just the chrome).
 */

import type { ThemeName } from '../../shared/types';

/** Structural mirror of xterm.js ITheme (do not add fields it doesn't have). */
export interface XtermTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export const XTERM_THEMES: Record<ThemeName, XtermTheme> = {
  dark: {
    background: '#0E0F12',
    foreground: '#D7DBE1',
    cursor: '#E09A4A',
    cursorAccent: '#0E0F12',
    selectionBackground: '#8A613255', // copper wash, translucent

    black: '#1B1E24',
    red: '#E0645C',
    green: '#4EC98A',
    yellow: '#E0B15C',
    blue: '#7BA9C9',
    magenta: '#B99BD6',
    cyan: '#6FC3BE',
    white: '#D7DBE1',

    brightBlack: '#4A505A',
    brightRed: '#EC837C',
    brightGreen: '#72DCA6',
    brightYellow: '#EDC784',
    brightBlue: '#9BC2DC',
    brightMagenta: '#CDB6E4',
    brightCyan: '#93D8D4',
    brightWhite: '#F2F4F7',
  },
  light: {
    background: '#F3EFE7',
    foreground: '#2E2A24',
    cursor: '#A96B22',
    cursorAccent: '#F3EFE7',
    selectionBackground: '#C9A26B55', // same copper wash on paper

    black: '#2E2A24',
    red: '#C14B42',
    green: '#2F8A5D',
    yellow: '#A0761B',
    blue: '#3E6A8A',
    magenta: '#7A5A9A',
    cyan: '#2E7F84',
    white: '#D2CABA',

    brightBlack: '#6E675C',
    brightRed: '#A5352C',
    brightGreen: '#1F724A',
    brightYellow: '#8A6208',
    brightBlue: '#2F5570',
    brightMagenta: '#634880',
    brightCyan: '#22666B',
    brightWhite: '#FDFBF7',
  },
};
