/**
 * Per-runtime visual identity for Graph mode: a display label, an accent colour
 * (drawn from the Avatar HUES family so the graph matches the rail), and a small
 * inline SVG glyph. `currentColor` is set by the caller via CSS `color`.
 */

import type { JSX } from 'react';
import type { RuntimeId } from '../../shared/types';

export interface RuntimeVisual {
  label: string;
  short: string;
  color: string;
  Glyph: () => JSX.Element;
}

const starburst = (): JSX.Element => (
  <svg viewBox="0 0 24 24" width="100%" height="100%">
    <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1" />
      <path d="M12 6l1.4 4.6L18 12l-4.6 1.4L12 18l-1.4-4.6L6 12l4.6-1.4z" fill="currentColor" stroke="none" />
    </g>
  </svg>
);

const spiral = (): JSX.Element => (
  <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="1.7">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 4a8 8 0 0 1 0 16 5 5 0 0 1 0-10 2.5 2.5 0 0 1 0 5" />
  </svg>
);

const brackets = (): JSX.Element => (
  <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6L3 12l6 6M15 6l6 6-6 6" />
  </svg>
);

const spark = (): JSX.Element => (
  <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M6 6l12 12M18 6L6 18M12 3v3M12 18v3M3 12h3M18 12h3" />
  </svg>
);

const gem = (): JSX.Element => (
  <svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor">
    <path d="M12 2c.6 5.4 4.6 9.4 10 10-5.4.6-9.4 4.6-10 10-.6-5.4-4.6-9.4-10-10 5.4-.6 9.4-4.6 10-10z" />
  </svg>
);

const blob = (): JSX.Element => (
  <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M7 10a5 5 0 0 1 10 0v3a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4z" />
    <circle cx="10" cy="11" r="1" fill="currentColor" stroke="none" />
    <circle cx="14" cy="11" r="1" fill="currentColor" stroke="none" />
  </svg>
);

const term = (): JSX.Element => (
  <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 7l4 4-4 4M12 15h6" />
  </svg>
);

const gear = (): JSX.Element => (
  <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="1.7">
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
  </svg>
);

export const RUNTIME_VISUALS: Record<RuntimeId, RuntimeVisual> = {
  claude: { label: 'Claude Code', short: 'Claude', color: '#E09A4A', Glyph: starburst },
  codex: { label: 'Codex', short: 'Codex', color: '#7BC9A0', Glyph: spiral },
  opencode: { label: 'OpenCode', short: 'OpenCode', color: '#D6C05A', Glyph: brackets },
  grok: { label: 'Grok Build', short: 'Grok', color: '#7BA9C9', Glyph: spark },
  gemini: { label: 'Gemini', short: 'Gemini', color: '#C98A7B', Glyph: gem },
  ollama: { label: 'Ollama', short: 'Ollama', color: '#B99BD6', Glyph: blob },
  shell: { label: 'Shell', short: 'Shell', color: '#7C838E', Glyph: term },
  custom: { label: 'Custom', short: 'Custom', color: '#9AA0AA', Glyph: gear },
};

export function runtimeVisual(id: RuntimeId): RuntimeVisual {
  return RUNTIME_VISUALS[id] ?? RUNTIME_VISUALS.shell;
}

/** The runtimes offered when spawning a team lead, in menu order. */
export const TEAM_RUNTIME_ORDER: RuntimeId[] = [
  'claude',
  'codex',
  'grok',
  'opencode',
  'gemini',
  'ollama',
];
