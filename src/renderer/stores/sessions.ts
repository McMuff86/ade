/** Renderer mirror of the PTYs owned by Electron main. */

import { create } from 'zustand';
import type { PtyExitReason, SessionMeta, TaskQueueStatus } from '../../shared/types';
import type { PtyCancelTasksRequest } from '../../shared/ipc';

export interface SessionOperationError {
  message: string;
  agentId?: string;
  sessionId?: string;
  source: 'recovery' | 'launch' | 'attach' | 'close';
}

interface SessionsState {
  sessions: Record<string, SessionMeta>;
  orderByAgent: Record<string, string[]>;
  activeByAgent: Record<string, string | null>;
  taskQueue: TaskQueueStatus;
  hydrated: boolean;
  error: SessionOperationError | null;

  hydrate: (force?: boolean) => Promise<void>;
  createSession: (
    agentId: string,
    task?: string,
    dispatchId?: string,
    runTaskId?: string,
  ) => Promise<SessionMeta>;
  closeSession: (sessionId: string) => Promise<void>;
  restartSession: (sessionId: string) => Promise<SessionMeta | null>;
  cancelTasks: (request?: PtyCancelTasksRequest) => Promise<{
    activeCancelled: number;
    queuedCancelled: number;
  }>;
  setActive: (agentId: string, sessionId: string) => void;
  markExited: (sessionId: string, exitCode: number, reason: PtyExitReason) => void;
  forgetSession: (sessionId: string) => void;
  reportError: (error: unknown, details: Omit<SessionOperationError, 'message'>) => void;
  clearError: () => void;
}

let hydrateInFlight: Promise<void> | null = null;
const pendingExits = new Map<string, { exitCode: number; reason: PtyExitReason }>();
const pendingRemovals = new Set<string>();
const createdDuringHydrate = new Set<string>();

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+':\s*/i, '').slice(0, 500);
}

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
  error: null,

  hydrate: async (force = false) => {
    if (get().hydrated && !force) return;
    if (hydrateInFlight) return hydrateInFlight;
    set({ hydrated: false });
    hydrateInFlight = (async () => {
      try {
        const result = await window.ade.invoke('pty:list');
        const removedDuringHydrate = new Set(pendingRemovals);
        const exitsDuringHydrate = new Map(pendingExits);
        const recovered = result.sessions
          .filter((meta) => !removedDuringHydrate.has(meta.id))
          .map((meta) => {
            const exit = exitsDuringHydrate.get(meta.id);
            return exit
              ? {
                  ...meta,
                  status: 'exited' as const,
                  endedAt: meta.endedAt ?? Date.now(),
                  exitCode: exit.exitCode,
                  exitReason: exit.reason,
                }
              : meta;
          });
        set((state) => {
          const byId = new Map(recovered.map((meta) => [meta.id, meta]));
          // A user can create a session while pty:list is in flight. Its local
          // metadata is newer than the list snapshot and must not be erased.
          for (const sessionId of createdDuringHydrate) {
            const meta = state.sessions[sessionId];
            if (meta && !removedDuringHydrate.has(meta.id) && !byId.has(meta.id)) byId.set(meta.id, meta);
          }
          const merged = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
          const sessions = Object.fromEntries(merged.map((meta) => [meta.id, meta]));
          const orderByAgent: Record<string, string[]> = {};
          for (const meta of merged) (orderByAgent[meta.agentId] ??= []).push(meta.id);
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
            error: state.error?.source === 'recovery' ? null : state.error,
          };
        });
        pendingExits.clear();
        pendingRemovals.clear();
        createdDuringHydrate.clear();
      } catch (error) {
        console.error('[ade] failed to reconcile pty sessions:', error);
        set({
          hydrated: true,
          error: { message: errorMessage(error), source: 'recovery' },
        });
      } finally {
        hydrateInFlight = null;
      }
    })();
    return hydrateInFlight;
  },

  createSession: async (agentId, task, dispatchId, runTaskId) => {
    try {
      const meta = await window.ade.invoke('pty:create', { agentId, task, dispatchId, runTaskId });
      if (!get().hydrated) createdDuringHydrate.add(meta.id);
      set((state) => ({
        sessions: { ...state.sessions, [meta.id]: meta },
        orderByAgent: {
          ...state.orderByAgent,
          [agentId]: [...(state.orderByAgent[agentId] ?? []), meta.id],
        },
        activeByAgent: { ...state.activeByAgent, [agentId]: meta.id },
        error: state.error?.source === 'launch' ? null : state.error,
      }));
      return meta;
    } catch (error) {
      set({ error: { message: errorMessage(error), source: 'launch', agentId } });
      throw error;
    }
  },

  closeSession: async (sessionId) => {
    if (!get().sessions[sessionId]) return;
    try {
      await window.ade.invoke('pty:kill', { sessionId });
    } catch (error) {
      console.error('[ade] pty:kill failed:', error);
      set({ error: { message: errorMessage(error), source: 'close', sessionId } });
      throw error;
    }
    set((state) => withoutSession(state, sessionId));
  },

  restartSession: async (sessionId) => {
    const previous = get().sessions[sessionId];
    if (!previous || previous.kind !== 'interactive') return null;
    const replacement = await get().createSession(previous.agentId);
    try {
      await get().closeSession(sessionId);
    } catch {
      // The replacement is usable; retain the old tab so the close can be retried.
    }
    return replacement;
  },

  cancelTasks: (request = {}) => window.ade.invoke('pty:cancelTasks', request),

  setActive: (agentId, sessionId) => {
    set((state) => ({
      activeByAgent: { ...state.activeByAgent, [agentId]: sessionId },
    }));
  },

  markExited: (sessionId, exitCode, reason) => {
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
            exitReason: reason,
          },
        },
      };
    });
  },

  forgetSession: (sessionId) => {
    createdDuringHydrate.delete(sessionId);
    set((state) => withoutSession(state, sessionId));
  },

  reportError: (error, details) => set({
    error: { ...details, message: errorMessage(error) },
  }),

  clearError: () => set({ error: null }),
}));

if (typeof window !== 'undefined' && window.ade) {
  window.ade.on('pty:exit', ({ sessionId, exitCode, reason }) => {
    const state = useSessions.getState();
    if (!state.hydrated) {
      pendingExits.set(sessionId, { exitCode, reason });
      if (state.sessions[sessionId]) state.markExited(sessionId, exitCode, reason);
      return;
    }
    state.markExited(sessionId, exitCode, reason);
  });
  window.ade.on('pty:removed', ({ sessionId }) => {
    const state = useSessions.getState();
    if (!state.hydrated) {
      pendingRemovals.add(sessionId);
      if (state.sessions[sessionId]) state.forgetSession(sessionId);
      return;
    }
    state.forgetSession(sessionId);
  });
  window.ade.on('pty:taskQueue', (taskQueue) => {
    useSessions.setState({ taskQueue });
  });
}
