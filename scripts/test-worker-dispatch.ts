/** Drive the real Graph dispatch actions against a typed-enough IPC stub. */

import type { RunTask, SessionMeta } from '../src/shared/types';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}`, detail ?? '');
  }
}

interface PtyCreate {
  agentId: string;
  task?: string;
  dispatchId?: string;
  runTaskId?: string;
}

interface TaskCreate {
  runId: string;
  participantId: string;
  prompt: string;
}

const ptyCreates: PtyCreate[] = [];
const taskCreates: TaskCreate[] = [];
let sessionSequence = 0;
let taskSequence = 0;

const localStore = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => localStore.get(key) ?? null,
  setItem: (key: string, value: string) => void localStore.set(key, value),
  removeItem: (key: string) => void localStore.delete(key),
  clear: () => localStore.clear(),
  key: () => null,
  length: 0,
} as Storage;

(globalThis as unknown as { window: unknown }).window = {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
  ade: {
    on: () => () => undefined,
    invoke: async (channel: string, payload: PtyCreate | TaskCreate): Promise<unknown> => {
      if (channel === 'runTask:create') {
        const request = payload as TaskCreate;
        taskCreates.push({ ...request });
        taskSequence += 1;
        const task: RunTask = {
          id: `run-task-${taskSequence}`,
          runId: request.runId,
          participantId: request.participantId,
          prompt: request.prompt,
          status: 'queued',
          createdAt: taskSequence,
          updatedAt: taskSequence,
        };
        return task;
      }
      if (channel === 'pty:create') {
        const request = payload as PtyCreate;
        ptyCreates.push({ ...request });
        sessionSequence += 1;
        const session: SessionMeta = {
          id: `session-${sessionSequence}`,
          agentId: request.agentId,
          title: 'stub',
          kind: request.task ? 'task' : 'interactive',
          status: 'running',
          createdAt: sessionSequence,
          dispatchId: request.dispatchId,
          runTaskId: request.runTaskId,
        };
        return session;
      }
      if (channel === 'runTask:fail') return undefined;
      throw new Error(`unexpected channel ${channel}`);
    },
  },
};

const TASK = 'Refactor the login flow';

void (async (): Promise<void> => {
  const { dispatchTeam } = await import('../src/renderer/graph/graphActions');
  const { useAppData } = await import('../src/renderer/stores/appdata');
  const { useGraphStore } = await import('../src/renderer/graph/graphStore');
  const { useRuns } = await import('../src/renderer/stores/runs');

  function seedTeam(teamId: string, workerCount: number): void {
    const agentIds = [
      `${teamId}-lead`,
      ...Array.from({ length: workerCount }, (_, index) => `${teamId}-worker-${index}`),
    ];
    const agents = Object.fromEntries(agentIds.map((id, index) => [id, {
      id,
      categoryId: 'catalog',
      name: index === 0 ? 'lead' : `worker-${index - 1}`,
      runtime: 'claude',
      permissionMode: 'default',
      workspaceDir: `C:\\workspace\\${id}`,
      memoryDir: `C:\\memory\\${id}`,
    }]));
    const participants = agentIds.map((agentId, index) => ({
      id: `${agentId}-participant`,
      runId: 'active-run',
      agentId,
      agentName: index === 0 ? 'lead' : `worker-${index - 1}`,
      runtime: 'claude' as const,
      role: index === 0 ? 'lead' as const : 'worker' as const,
      teamId,
      teamName: 'frontend',
      createdAt: index,
    }));
    useAppData.setState({
      categories: [{ id: 'catalog', name: 'Catalog', agents: agentIds }],
      agents,
      loaded: true,
    });
    useRuns.setState({
      runs: [{
        id: 'active-run',
        name: 'Test run',
        goal: 'Test dispatch',
        status: 'draft',
        mode: 'manual',
        phase: 'draft',
        budget: {
          maxConcurrentTasks: 2,
          maxInputTokens: null,
          maxOutputTokens: null,
          maxCostUsd: null,
          maxApprovals: 1,
        },
        createdAt: 1,
        updatedAt: 1,
      }],
      participants,
      tasks: [],
      events: [],
      artifacts: [],
      results: [],
      approvals: [],
      workspaceLeases: [],
      messages: [],
      usageByRun: { 'active-run': {
        inputTokens: 0, outputTokens: 0, costUsd: 0, approvals: 0, unreportedCostTasks: 0,
      } },
      activeRunId: 'active-run',
      loaded: true,
    });
  }

  function reset(): void {
    ptyCreates.length = 0;
    taskCreates.length = 0;
    useGraphStore.setState({ busy: {}, idleTeams: {} });
  }

  seedTeam('team-1', 2);
  reset();
  await dispatchTeam('team-1', TASK, { toWorkers: false });
  check('lead-only dispatch creates one persisted task', taskCreates.length === 1, taskCreates);
  check('lead-only dispatch creates one PTY', ptyCreates.length === 1, ptyCreates);
  check('lead receives the exact prompt', ptyCreates[0]?.agentId === 'team-1-lead' && ptyCreates[0]?.task === TASK);
  check('PTY is linked to its persisted run task', Boolean(ptyCreates[0]?.runTaskId));

  seedTeam('team-2', 3);
  reset();
  await dispatchTeam('team-2', TASK, { toWorkers: true });
  check('fan-out creates one task per run participant', taskCreates.length === 4, taskCreates);
  check('fan-out creates lead plus three worker PTYs', ptyCreates.length === 4, ptyCreates);
  check('fan-out task ids are unique', new Set(ptyCreates.map((request) => request.runTaskId)).size === 4);
  check('fan-out shares one cancellable dispatch id', new Set(ptyCreates.map((request) => request.dispatchId)).size === 1);
  check('fan-out does not create catalog identities',
    useAppData.getState().categories.length === 1 && Object.keys(useAppData.getState().agents).length === 4);

  seedTeam('team-3', 2);
  reset();
  await dispatchTeam('team-3', TASK);
  check('default dispatch targets only the lead',
    ptyCreates.length === 1 && ptyCreates[0]?.agentId === 'team-3-lead');

  seedTeam('team-4', 2);
  reset();
  useGraphStore.getState().setTeamIdle('team-4', true);
  await dispatchTeam('team-4', TASK, { toWorkers: true });
  check('paused team dispatch is a no-op', ptyCreates.length === 0 && taskCreates.length === 0);

  seedTeam('team-5', 2);
  reset();
  await dispatchTeam('team-5', '   ', { toWorkers: true });
  check('blank task is a no-op', ptyCreates.length === 0 && taskCreates.length === 0);

  console.log(`\n${failed ? 'FAILED' : 'PASSED'} - ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
