import type { JSX } from 'react';
import { useLocale } from "../i18n/language";
/** Stroke icons of the graph chrome, canvas and dialogs (24-px grid). */

export const I = {
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M4 12h13M13 6l6 6-6 6" />,
  pause: <><circle cx="12" cy="12" r="8" /><path d="M9 12h6" /></>,
  play: <path d="M8 6l10 6-10 6z" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="1" />,
  term: <path d="M5 8l4 4-4 4M12 16h6" />,
  close: <path d="M7 7l10 10M17 7L7 17" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M10 11v5M14 11v5" />,
  publish: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M5 14v5h14v-5" /></>,
  report: <><path d="M6 3h9l4 4v14H6z" /><path d="M9 12h6M9 16h6M15 3v4h4" /></>,
  minus: <path d="M5 12h14" />,
  fit: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  grip: <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />,
  dockDown: <path d="M12 4v11m-5-5 5 5 5-5M5 20h14" />,
};

export function Ico({ children }: { children: React.ReactNode }): JSX.Element {
  useLocale();
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
