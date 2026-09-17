import { navigateSupervisedWork } from '../src/renderer/supervision/navigateSupervisedWork';
import { useSessions } from '../src/renderer/stores/sessions';
import { useSelection } from '../src/renderer/stores/selection';
import { useMode } from '../src/renderer/stores/mode';
import { useRuns } from '../src/renderer/stores/runs';
import type { Run, SessionMeta } from '../src/shared/types';

let passed = 0; let failed = 0;
const check = (label: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
const deferred = () => { let release!: () => void; const promise = new Promise<void>(done => { release = done; }); return { promise, release }; };
void (async () => {
  const session: SessionMeta = { id: 'a', title: 'Duplicate name', projectWorkspaceId: 'workspace-a', repositoryId: 'repo-a', branch: 'main', kind: 'interactive', status: 'running', createdAt: 1 };
  useSessions.setState({ sessions: { a: session, b: { ...session, id: 'b', projectWorkspaceId: 'workspace-b' } }, error: null });
  useMode.getState().setMode('overview'); useSelection.getState().setProjectWorkspace(null);
  let live = true; let gate = deferred();
  useSessions.setState({ hydrate: () => gate.promise });
  const dismissed = navigateSupervisedWork({ kind: 'session', id: 'a' }, () => live);
  live = false; gate.release(); await dismissed;
  check('closing during session inventory leaves the selected view and workspace untouched', useMode.getState().mode === 'overview' && !useSelection.getState().projectWorkspaceId);
  useSessions.setState({ hydrate: async () => undefined }); live = true; gate = deferred(); let branch = 'main';
  const calls: string[] = [];
  Object.assign(globalThis, { window: { ade: { invoke: async (channel: string) => { calls.push(channel); await gate.promise; return { workspace: { branch } }; } } } });
  const superseded = navigateSupervisedWork({ kind: 'session', id: 'a' }, () => live);
  await Promise.resolve(); live = false; gate.release(); await superseded;
  check('closing during workspace validation cannot later switch projects', !useSelection.getState().projectWorkspaceId && useMode.getState().mode === 'overview');
  live = true; await navigateSupervisedWork({ kind: 'session', id: 'b' }, () => live);
  check('positive navigation selects the exact sibling identity despite equal titles', useSelection.getState().projectWorkspaceId === 'workspace-b' && useSessions.getState().activeByProject['workspace-b'] === 'b');
  branch = 'different'; let refused = false;
  try { await navigateSupervisedWork({ kind: 'session', id: 'a' }, () => live); } catch { refused = true; }
  check('changed workspace branch is refused without replacing the previous selection', refused && useSelection.getState().projectWorkspaceId === 'workspace-b');
  check('navigation invokes only a workspace read and never starts a process', calls.length === 3 && calls.every(channel => channel === 'project:query'));
  useMode.getState().setMode('overview'); gate = deferred();
  useRuns.setState({ runs: [{ id: 'run-a' } as Run], activeRunId: null, refresh: () => gate.promise });
  const staleRun = navigateSupervisedWork({ kind: 'run', id: 'run-a' }, () => live);
  live = false; gate.release(); await staleRun;
  check('late run inventory cannot reopen a dismissed graph destination', useRuns.getState().activeRunId === null && useMode.getState().mode === 'overview');
  live = true; refused = false;
  try { await navigateSupervisedWork({ kind: 'run', id: 'removed' }, () => live); } catch { refused = true; }
  check('removed run is refused without selecting another run', refused && useRuns.getState().activeRunId === null);
  await navigateSupervisedWork({ kind: 'run', id: 'run-a' }, () => live);
  check('final positive run navigation follows the rejected and dismissed requests', useRuns.getState().activeRunId === 'run-a' && useMode.getState().mode === 'graph');
})().catch(error => { failed++; console.error(error); }).finally(() => {
  console.log(`Supervision navigation: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
});
