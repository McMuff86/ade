/**
 * Worker-distribution smoke test (run: pnpm tsx scripts/test-worker-dispatch.ts).
 *
 * Drives the REAL renderer dispatchTeam() against a stubbed window.ade, so it
 * exercises the exact fan-out code shipped in graphActions.ts — not a re-impl.
 * Verifies the MVP worker-distribution contract:
 *   - toWorkers:false → only the lead gets a pty session (workers stay decorative)
 *   - toWorkers:true  → lead + every worker each get their own pty session,
 *                       each carrying the task through the task-session contract
 *   - an idle team dispatches nothing
 *
 * Pure Node — the stub stands in for Electron IPC — so it runs under tsx.
 */

import type { SessionMeta } from '../src/shared/types';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.error(`FAIL  ${label}`);
    if (detail !== undefined) console.error('      detail:', JSON.stringify(detail));
  }
}

/* ---- stub browser globals BEFORE importing any renderer module ---------- */
interface PtyCreate {
  agentId: string;
  task?: string;
  dispatchId?: string;
}
const ptyCreates: PtyCreate[] = [];
let seq = 0;

const localStore = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => localStore.get(k) ?? null,
  setItem: (k: string, v: string) => void localStore.set(k, v),
  removeItem: (k: string) => void localStore.delete(k),
  clear: () => localStore.clear(),
  key: () => null,
  length: 0,
} as Storage;

(globalThis as unknown as { window: unknown }).window = {
  // dispatch's transient-status timers — no-op so nothing lingers past asserts.
  setTimeout: () => 0,
  clearTimeout: () => undefined,
  ade: {
    on: () => undefined,
    invoke: async (channel: string, payload: PtyCreate): Promise<SessionMeta> => {
      if (channel !== 'pty:create') throw new Error(`unexpected channel ${channel}`);
      ptyCreates.push({ agentId: payload.agentId, task: payload.task, dispatchId: payload.dispatchId });
      seq += 1;
      return {
        id: `sess-${seq}`,
        agentId: payload.agentId,
        title: 'stub',
        kind: payload.task ? 'task' : 'interactive',
        status: 'running',
        createdAt: 0,
      };
    },
  },
};

const TASK = 'Refactor the login flow';

/* ---- import the real modules (dynamic: after the stubs are in place) ---- */
// eslint-disable-next-line @typescript-eslint/no-floating-promises
void (async (): Promise<void> => {
const { dispatchTeam } = await import('../src/renderer/graph/graphActions');
const { useAppData } = await import('../src/renderer/stores/appdata');
const { useGraphStore } = await import('../src/renderer/graph/graphStore');

/** Inject a fake team (1 lead + N workers) straight into the app-data store. */
function seedTeam(teamId: string, workerCount: number): void {
  const agentIds = [`${teamId}-lead`, ...Array.from({ length: workerCount }, (_, i) => `${teamId}-w${i}`)];
  const agents: Record<string, unknown> = {};
  agentIds.forEach((id, i) => {
    agents[id] = {
      id,
      categoryId: teamId,
      name: i === 0 ? 'lead' : `w${i - 1}`,
      role: i === 0 ? 'lead' : 'worker',
      teamRole: i === 0 ? 'lead' : 'worker',
      runtime: 'claude',
      permissionMode: 'default',
    };
  });
  useAppData.setState({
    categories: [{ id: teamId, name: 'frontend', kind: 'team', agents: agentIds }] as never,
    agents: agents as never,
  });
}

function reset(): void {
  ptyCreates.length = 0;
  useGraphStore.setState({ busy: {}, idleTeams: {} });
}

/* ---- 1. toWorkers:false → only the lead is spawned ---------------------- */
seedTeam('t1', 2);
reset();
await dispatchTeam('t1', TASK, { toWorkers: false });
check('no fan-out: exactly 1 session (lead)', ptyCreates.length === 1, ptyCreates);
check('no fan-out: session is the lead', ptyCreates[0]?.agentId === 't1-lead');
check('no fan-out: lead got the task', ptyCreates[0]?.task === TASK);

/* ---- 2. toWorkers:true → lead + every worker gets its own session ------- */
seedTeam('t2', 3);
reset();
await dispatchTeam('t2', TASK, { toWorkers: true });
check('fan-out: 1 lead + 3 worker sessions = 4', ptyCreates.length === 4, ptyCreates);
const ids = ptyCreates.map((p) => p.agentId).sort();
check(
  'fan-out: lead + all 3 workers each spawned',
  JSON.stringify(ids) === JSON.stringify(['t2-lead', 't2-w0', 't2-w1', 't2-w2']),
  ids,
);
check('fan-out: every session carries the task', ptyCreates.every((p) => p.task === TASK));
check('fan-out: sessions share one cancellable dispatch id', new Set(ptyCreates.map((p) => p.dispatchId)).size === 1);

/* ---- 3. default (no opts) behaves like toWorkers:false ------------------ */
seedTeam('t3', 2);
reset();
await dispatchTeam('t3', TASK);
check('default: only the lead is spawned', ptyCreates.length === 1 && ptyCreates[0]?.agentId === 't3-lead');

/* ---- 4. idle team dispatches nothing ------------------------------------ */
seedTeam('t4', 2);
reset();
useGraphStore.getState().setTeamIdle('t4', true);
await dispatchTeam('t4', TASK, { toWorkers: true });
check('idle team: no sessions spawned at all', ptyCreates.length === 0, ptyCreates);

/* ---- 5. empty task is a no-op ------------------------------------------- */
seedTeam('t5', 2);
reset();
await dispatchTeam('t5', '   ', { toWorkers: true });
check('empty task: no sessions spawned', ptyCreates.length === 0, ptyCreates);

console.log(`\n${failed ? 'FAILED' : 'PASSED'} — ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
})();
