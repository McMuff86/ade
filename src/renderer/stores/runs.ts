/** Renderer mirror of persisted orchestration runs, tasks, events and artifacts. */

import { create } from 'zustand';
import type {
  OrchestrationSnapshot,
  Run,
  RunCreateInput,
  RunTask,
  RunTaskCreateInput,
} from '../../shared/types';

const ACTIVE_RUN_KEY = 'ade:activeRun';

interface RunsState extends OrchestrationSnapshot {
  activeRunId: string | null;
  loaded: boolean;

  load: () => Promise<void>;
  refresh: () => Promise<void>;
  setActiveRun: (runId: string | null) => void;
  createRun: (input: RunCreateInput) => Promise<Run>;
  deleteRun: (runId: string) => Promise<void>;
  createTask: (input: RunTaskCreateInput) => Promise<RunTask>;
  failTask: (taskId: string, error: string) => Promise<void>;
  startRun: (runId: string) => Promise<Run>;
  cancelRun: (runId: string) => Promise<void>;
  resolveApproval: (approvalId: string, decision: 'approve' | 'reject') => Promise<void>;
}

const EMPTY_SNAPSHOT: OrchestrationSnapshot = {
  runs: [],
  participants: [],
  tasks: [],
  events: [],
  artifacts: [],
  results: [],
  approvals: [],
  workspaceLeases: [],
  messages: [],
  usageByRun: {},
};

let loadInFlight: Promise<void> | null = null;

function readSavedRunId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_RUN_KEY);
  } catch {
    return null;
  }
}

function persistRunId(runId: string | null): void {
  try {
    if (runId) localStorage.setItem(ACTIVE_RUN_KEY, runId);
    else localStorage.removeItem(ACTIVE_RUN_KEY);
  } catch {
    // localStorage can be unavailable in hardened renderer contexts.
  }
}

function selectRunId(snapshot: OrchestrationSnapshot, preferred: string | null): string | null {
  if (preferred && snapshot.runs.some((run) => run.id === preferred)) return preferred;
  const saved = readSavedRunId();
  if (saved && snapshot.runs.some((run) => run.id === saved)) return saved;
  return [...snapshot.runs].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null;
}

function snapshotState(
  snapshot: OrchestrationSnapshot,
  preferred: string | null,
): Pick<RunsState, keyof OrchestrationSnapshot | 'activeRunId'> {
  const activeRunId = selectRunId(snapshot, preferred);
  persistRunId(activeRunId);
  return { ...snapshot, activeRunId };
}

export const useRuns = create<RunsState>((set, get) => ({
  ...EMPTY_SNAPSHOT,
  activeRunId: null,
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    if (loadInFlight) return loadInFlight;
    loadInFlight = (async () => {
      try {
        const snapshot = await window.ade.invoke('run:get');
        set((state) => ({ ...snapshotState(snapshot, state.activeRunId), loaded: true }));
      } catch (error) {
        console.error('[ade] failed to load runs:', error);
        set({ loaded: true });
      } finally {
        loadInFlight = null;
      }
    })();
    return loadInFlight;
  },

  refresh: async () => {
    const snapshot = await window.ade.invoke('run:get');
    set((state) => ({ ...snapshotState(snapshot, state.activeRunId), loaded: true }));
  },

  setActiveRun: (runId) => {
    const valid = runId && get().runs.some((run) => run.id === runId) ? runId : null;
    persistRunId(valid);
    set({ activeRunId: valid });
  },

  createRun: async (input) => {
    const run = await window.ade.invoke('run:create', input);
    const snapshot = await window.ade.invoke('run:get');
    persistRunId(run.id);
    set({ ...snapshotState(snapshot, run.id), loaded: true });
    return run;
  },

  deleteRun: async (runId) => {
    await window.ade.invoke('run:delete', { runId });
    const snapshot = await window.ade.invoke('run:get');
    set((state) => ({ ...snapshotState(snapshot, state.activeRunId === runId ? null : state.activeRunId) }));
  },

  createTask: (input) => window.ade.invoke('runTask:create', input),

  failTask: (taskId, error) => window.ade.invoke('runTask:fail', { taskId, error }),

  startRun: (runId) => window.ade.invoke('run:start', { runId }),

  cancelRun: (runId) => window.ade.invoke('run:cancel', { runId }),

  resolveApproval: (approvalId, decision) =>
    window.ade.invoke('runApproval:resolve', { approvalId, decision }),
}));

if (typeof window !== 'undefined' && window.ade) {
  window.ade.on('orchestration:changed', (snapshot) => {
    useRuns.setState((state) => ({
      ...snapshotState(snapshot, state.activeRunId),
      loaded: true,
    }));
  });
}
