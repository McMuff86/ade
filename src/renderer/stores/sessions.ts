/** Renderer mirror of the PTYs owned by Electron main. */

import { create } from 'zustand';
import type { SessionMeta, TaskQueueStatus } from '../../shared/types';

interface SessionsState {
  sessions: Record<string, SessionMeta>;
  orderByAgent: Record<string, string[]>;
  activeByAgent: Record<string, string | null>;
  taskQueue: TaskQueueStatus;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  createSession: (agentId: string, task?: string, dispatchId?: string) => Promise<SessionMeta>;
  closeSession: (sessionId: string) => Promise<void>;
  cancelTasks: (agentIds?: string[]) => Promise<{ activeCancelled: number; queuedCancelled: number }>;
  setActive: (agentId: string, sessionId: string) => void;
  markExited: (sessionId: string, exitCode: number) => void;
  forgetSession: (sessionId: string) => void;
}

let hydrateInFlight: Promise<void> | null = null;

function withoutSession(state: SessionsState, sessionId: string): Partial<SessionsState> {
  const meta = state.sessions[sessionId];
  if (!meta) return {};
  const { agentId } = meta;
  const sessions = { ...state.sessions };
  delete sessions[sessionId];

  const previous = state.orderByAgent[agentId] ?? [];
  const index = previous.indexOf(sessionId);
  const order = previous.filter((id) => id !== sessionId);
  let active = state.activeByAgent[agentId] ?? null;
  if (active === sessionId) active = order[Math.min(index, order.length - 1)] ?? null;

  return {
    sessions,
    orderByAgent: { ...state.orderByAgent, [agentId]: order },
    activeByAgent: { ...state.activeByAgent, [agentId]: active },
  };
}

export const useSessions = create<SessionsState>((set, get) => ({
  sessions: {},
  orderByAgent: {},
  activeByAgent: {},
  taskQueue: { active: 0, queued: 0, maxActive: 4 },
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (hydrateInFlight) return hydrateInFlight;
    hydrateInFlight = (async () => {
      try {
        const result = await window.ade.invoke('pty:list');
        const sessions = Object.fromEntries(result.sessions.map((meta) => [meta.id, meta]));
        const orderByAgent: Record<string, string[]> = {};
        for (const meta of result.sessions) {
          (orderByAgent[meta.agentId] ??= []).push(meta.id);
        }
        set((state) => {
          const activeByAgent: Record<string, string | null> = {};
          for (const [agentId, order] of Object.entries(orderByAgent)) {
            const previous = state.activeByAgent[agentId];
            activeByAgent[agentId] = previous && order.includes(previous)
              ? previous
              : (order.at(-1) ?? null);
          }
          return {
            sessions,
            orderByAgent,
            activeByAgent,
            taskQueue: result.taskQueue,
            hydrated: true,
          };
        });
      } catch (error) {
        console.error('[ade] failed to reconcile pty sessions:', error);
        set({ hydrated: true });
      } finally {
        hydrateInFlight = null;
      }
    })();
    return hydrateInFlight;
  },

  createSession: async (agentId, task, dispatchId) => {
    const meta = await window.ade.invoke('pty:create', { agentId, task, dispatchId });
    set((state) => ({
      sessions: { ...state.sessions, [meta.id]: meta },
      orderByAgent: {
        ...state.orderByAgent,
        [agentId]: [...(state.orderByAgent[agentId] ?? []), meta.id],
      },
      activeByAgent: { ...state.activeByAgent, [agentId]: meta.id },
    }));
    return meta;
  },

  closeSession: async (sessionId) => {
    if (!get().sessions[sessionId]) return;
    try {
      await window.ade.invoke('pty:kill', { sessionId });
    } catch (error) {
      console.error('[ade] pty:kill failed:', error);
    }
    set((state) => withoutSession(state, sessionId));
  },

  cancelTasks: (agentIds) => window.ade.invoke('pty:cancelTasks', { agentIds }),

  setActive: (agentId, sessionId) => {
    set((state) => ({
      activeByAgent: { ...state.activeByAgent, [agentId]: sessionId },
    }));
  },

  markExited: (sessionId, exitCode) => {
    set((state) => {
      const meta = state.sessions[sessionId];
      if (!meta) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...meta,
            status: 'exited',
            endedAt: Date.now(),
            exitCode,
          },
        },
      };
    });
  },

  forgetSession: (sessionId) => set((state) => withoutSession(state, sessionId)),
}));

if (typeof window !== 'undefined' && window.ade) {
  window.ade.on('pty:exit', ({ sessionId, exitCode }) => {
    useSessions.getState().markExited(sessionId, exitCode);
  });
  window.ade.on('pty:removed', ({ sessionId }) => {
    useSessions.getState().forgetSession(sessionId);
  });
  window.ade.on('pty:taskQueue', (taskQueue) => {
    useSessions.setState({ taskQueue });
  });
}
