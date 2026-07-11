import { useEffect } from 'react';
import { useMode } from '../stores/mode';
import { useSelection } from '../stores/selection';
import { useSessions } from '../stores/sessions';

export const SHORTCUTS = {
  newSession: 'Ctrl+Shift+T',
  closeSession: 'Ctrl+Shift+W',
  previousSession: 'Ctrl+PageUp',
  nextSession: 'Ctrl+PageDown',
} as const;

function isMac(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

function modalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

/** App-level terminal tab shortcuts; xterm input keeps every unclaimed chord. */
export function useSessionShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (modalOpen()) return;
      const primary = isMac() ? event.metaKey : event.ctrlKey;

      if (primary && !event.altKey && !event.shiftKey && (event.key === '1' || event.key === '2')) {
        event.preventDefault();
        useMode.getState().setMode(event.key === '1' ? 'terminals' : 'graph');
        return;
      }
      if (useMode.getState().mode !== 'terminals') return;

      const agentId = useSelection.getState().selectedAgentId;
      if (!agentId) return;
      const sessions = useSessions.getState();
      const order = sessions.orderByAgent[agentId] ?? [];
      const active = sessions.activeByAgent[agentId] ?? null;

      if (primary && event.shiftKey && !event.altKey && event.key.toLowerCase() === 't') {
        if (event.repeat) return;
        event.preventDefault();
        void sessions.createSession(agentId).catch(() => undefined);
        return;
      }
      if (primary && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'w') {
        if (event.repeat || !active) return;
        event.preventDefault();
        void sessions.closeSession(active).catch(() => undefined);
        return;
      }

      const direction = primary && !event.altKey && !event.shiftKey
        ? (event.key === 'PageUp' ? -1 : event.key === 'PageDown' ? 1 : 0)
        : 0;
      if (direction !== 0 && order.length > 1) {
        event.preventDefault();
        const currentIndex = active ? order.indexOf(active) : 0;
        const index = currentIndex < 0 ? 0 : currentIndex;
        const next = order[(index + direction + order.length) % order.length];
        if (next) sessions.setActive(agentId, next);
        return;
      }

      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && /^[1-9]$/.test(event.key)) {
        const next = order[Number(event.key) - 1];
        if (!next) return;
        event.preventDefault();
        sessions.setActive(agentId, next);
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, []);
}
