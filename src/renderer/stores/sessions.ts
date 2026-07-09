/**
 * Session store (Phase B1) — the terminal-session state for every agent.
 *
 * THIS API IS A CONTRACT: Phase B2 (rail/tabs) codes against the exact shape
 * below. Do not rename state keys or action signatures without coordinating.
 *
 *   state:
 *     sessions:      Record<sessionId, SessionMeta>
 *     orderByAgent:  Record<agentId, sessionId[]>   // tab order per agent
 *     activeByAgent: Record<agentId, sessionId|null> // selected tab per agent
 *   actions:
 *     createSession(agentId): Promise<void>   // spawns a pty, appends + selects
 *     closeSession(sessionId): Promise<void>  // kills the pty, drops the tab
 *     setActive(agentId, sessionId): void     // switch selected tab
 *
 * On `pty:exit` the session's status flips to 'exited' (the tab shows it) but
 * the tab stays until closeSession removes it.
 */

import { create } from 'zustand';
import type { SessionMeta } from '../../shared/types';

interface SessionsState {
  sessions: Record<string, SessionMeta>;
  orderByAgent: Record<string, string[]>;
  activeByAgent: Record<string, string | null>;

  createSession: (agentId: string, initialInput?: string) => Promise<void>;
  closeSession: (sessionId: string) => Promise<void>;
  setActive: (agentId: string, sessionId: string) => void;

  /** Internal: flip a session to 'exited' when its pty ends. */
  markExited: (sessionId: string) => void;
}

export const useSessions = create<SessionsState>((set, get) => ({
  sessions: {},
  orderByAgent: {},
  activeByAgent: {},

  createSession: async (agentId, initialInput) => {
    const meta = await window.ade.invoke('pty:create', { agentId, initialInput });
    set((state) => ({
      sessions: { ...state.sessions, [meta.id]: meta },
      orderByAgent: {
        ...state.orderByAgent,
        [agentId]: [...(state.orderByAgent[agentId] ?? []), meta.id],
      },
      activeByAgent: { ...state.activeByAgent, [agentId]: meta.id },
    }));
  },

  closeSession: async (sessionId) => {
    const meta = get().sessions[sessionId];
    if (!meta) return;
    const { agentId } = meta;

    // Kill the pty first; onExit fires but markExited no-ops once we drop it.
    try {
      await window.ade.invoke('pty:kill', { sessionId });
    } catch (err) {
      console.error('[ade] pty:kill failed:', err);
    }

    set((state) => {
      const nextSessions = { ...state.sessions };
      delete nextSessions[sessionId];

      const prevOrder = state.orderByAgent[agentId] ?? [];
      const idx = prevOrder.indexOf(sessionId);
      const nextOrder = prevOrder.filter((id) => id !== sessionId);

      let nextActive = state.activeByAgent[agentId] ?? null;
      if (nextActive === sessionId) {
        // select the neighbour that slides into place (prev tab, else the new last)
        nextActive = nextOrder[Math.min(idx, nextOrder.length - 1)] ?? null;
      }

      return {
        sessions: nextSessions,
        orderByAgent: { ...state.orderByAgent, [agentId]: nextOrder },
        activeByAgent: { ...state.activeByAgent, [agentId]: nextActive },
      };
    });
  },

  setActive: (agentId, sessionId) => {
    set((state) => ({
      activeByAgent: { ...state.activeByAgent, [agentId]: sessionId },
    }));
  },

  markExited: (sessionId) => {
    set((state) => {
      const meta = state.sessions[sessionId];
      if (!meta || meta.status === 'exited') return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...meta, status: 'exited' },
        },
      };
    });
  },
}));

/* Subscribe once to pty:exit so any live tab flips to 'exited' on its own. */
if (typeof window !== 'undefined' && window.ade) {
  window.ade.on('pty:exit', ({ sessionId }) => {
    useSessions.getState().markExited(sessionId);
  });
}
