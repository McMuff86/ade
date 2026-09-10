import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, symlinkSync, linkSync, rmSync, unlinkSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { taskOutputFromStream, TASK_OUTPUT_LIMIT } from '../src/main/orchestration/taskOutput';
import { OrchestrationService } from '../src/main/orchestration/OrchestrationService';
import { RemoteApiError, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import { HostApiServer } from '../src/main/remote/HostApiServer';
import { RemoteAuthorizer, signRequest, sha256Hex } from '../src/main/remote/authorization';
import { mergeRunSummaries } from '../src/shared/runSummaryMerge';
import { RunFileTracker } from '../src/main/application/RunFileTracker';
import { taskFileChanges, validRunFileTracking } from '../src/shared/runFiles';
import { validateCompleteConfig } from '../src/main/config/store';

let passed = 0; let failed = 0;
const check = (name: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } };
async function refuses(name: string, action: () => unknown, code: string) {
  try { await action(); check(name, false); } catch (error) { check(name, error instanceof RemoteApiError && error.code === code); }
}
const root = mkdtempSync(join(tmpdir(), 'ade-run-inspection-')); let server: HostApiServer | undefined;
const event = (text: string) => JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } });
void (async () => {
  const prompt = 'PRIVATE_TASK_SENTINEL'; const answer = 'Ergebnis\nBild und Tabelle erstellt.\nZweite Zeile vollständig.';
  check('Codex keeps the complete multiline assistant answer', taskOutputFromStream(event(answer), prompt)?.text === answer);
  check('Claude result envelope yields the complete answer', taskOutputFromStream(JSON.stringify({ type: 'result', result: answer }), prompt)?.text === answer);
  check('Claude ignores tool content alongside text', taskOutputFromStream(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', input: prompt }, { type: 'text', text: answer }] } }), prompt)?.text === answer);
  check('Grok joins data deltas only after end', taskOutputFromStream([JSON.stringify({ type: 'text', data: 'Grok ' }), JSON.stringify({ type: 'text', data: 'fertig' }), '{"type":"end"}'].join('\n'), prompt)?.text === 'Grok fertig');
  check('no raw terminal or user message fallback', !taskOutputFromStream(`${answer}\n${JSON.stringify({ type: 'user', message: answer })}`, prompt));
  check('tool output is not mistaken for assistant output', !taskOutputFromStream(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', text: answer } }), prompt));
  check('echoed task prompt is removed from answer', !taskOutputFromStream(event(`${answer}\n${prompt}`), prompt)!.text.includes(prompt));
  const large = taskOutputFromStream(event('a'.repeat(TASK_OUTPUT_LIMIT + 40)), prompt)!;
  check('oversized answer is bounded and marked limited', large.limited && large.text.length === TASK_OUTPUT_LIMIT);

  const f = createRemoteWorkspaceFixture(root); const { application: app, store, devices } = f;
  devices.enroll('tablet', 'Tablet', 'd'.repeat(40)); devices.setAdminScopes('tablet', ['catalog:write', 'workspace:read']);
  const context = (): RemoteCommandContext => ({ principal: { id: 'tablet', kind: 'device', proof: 'device-signature', scopes: new Set(devices.activeDevices()[0]!.scopes) }, idempotencyKey: randomUUID(), requestId: 'inspection' });
  const created = await app.administer(context(), { operation: 'project-create', input: { name: 'Inspection' } });
  const submission = await app.submitTask(context(), { agentId: 'builder', repositoryId: created.created!.id, name: 'Image result', prompt });
  const runId = submission.run.id; const taskId = submission.taskId!;
  const deadline = Date.now() + 15000;
  while (!f.sessions.length && Date.now() < deadline) await new Promise((done) => setTimeout(done, 20));
  const session = f.sessions[0]!;
  f.observations.set(session.id, { structured: true, outputBytes: 400, lastOutputAt: 123456, lines: [{ kind: 'tool', text: `imagegen: ${prompt}` }, { kind: 'thinking', text: prompt }, { kind: 'text', text: prompt }] });
  const live = await app.inspectRun(context().principal, runId);
  check('activity confirms actual matching process and output time', live.tasks[0]?.process === 'running' && live.tasks[0].lastOutputAt === 123456 && live.tasks[0].outputBytes === 400);
  check('activity has tool name without prompts or raw output', live.tasks[0]?.activity[0]?.text === 'imagegen' && !JSON.stringify(live).includes(prompt) && !JSON.stringify(live).includes(root));
  await refuses('task from another run cannot be read', () => app.inspectRun(context().principal, runId, 'wrong-task'), 'not_found');
  session.status = 'exited'; session.exitCode = 0;
  f.coordinator.onTaskFinished(taskId, 'completed', 0, event(answer));
  const finished = await app.inspectRun(context().principal, runId, taskId);
  check('completion updates persisted run and real process separately', finished.run.status === 'completed' && finished.tasks[0]?.process === 'exited' && finished.tasks[0].exitCode === 0);
  check('late running snapshot cannot overwrite completed activity read', mergeRunSummaries([finished.run], [{ ...live.run, updatedAt: finished.run.updatedAt - 1 }])[0]?.status === 'completed');
  check('selected task exposes full answer', finished.tasks[0]?.output?.text === answer);
  check('run-wide activity and summaries omit answer bodies', !JSON.stringify(await app.inspectRun(context().principal, runId)).includes(answer) && !JSON.stringify(f.orchestration.view()).includes('Bild und Tabelle'));
  check('report retains answer after service reconstruction', new OrchestrationService(store, () => undefined).report(runId).tasks[0]?.output?.text === answer);
  f.sessions.length = 0;
  check('missing old PTY does not hide durable result', (await app.inspectRun(context().principal, runId, taskId)).tasks[0]?.output?.text === answer);

  const cwd = store.get().runTasks.find((task) => task.id === taskId)!.workspaceDir!;
  mkdirSync(join(cwd, 'outputs')); const png = PNG.sync.write(new PNG({ width: 2, height: 2 }));
  writeFileSync(join(cwd, 'outputs', 'image.png'), png); writeFileSync(join(cwd, 'outputs', 'notes.md'), '# Result\nC:\\private\\report\napi_key=private-value');
  writeFileSync(join(cwd, 'fake.png'), '<svg>invalid</svg>'); writeFileSync(join(cwd, 'book.xlsx'), Buffer.from([80,75,3,4,0]));
  writeFileSync(join(cwd, '.env'), 'secret'); mkdirSync(join(root, 'outside')); writeFileSync(join(root, 'outside', 'secret.md'), 'outside');
  symlinkSync(join(root, 'outside'), join(cwd, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  linkSync(join(root, 'outside', 'secret.md'), join(cwd, 'hardlink.md'));
  const files = await app.runFiles(context().principal, runId, taskId); const image = files.files.find((file) => file.path === 'outputs/image.png')!;
  check('listing returns relative image and opaque content identity', !!image?.image && /^[a-f0-9]{64}$/.test(image.id) && !JSON.stringify(files).includes(root));
  check('file labels do not expose prompt-derived task titles', !JSON.stringify(files).includes(prompt));
  check('listing excludes metadata, secrets, hardlinks and junctions', !files.files.some((file) => /secret|hardlink|linked|\.env|\.git/.test(file.path)));
  check('legacy listing does not invent run attribution', !!files.notice?.includes('Vorher-/Nachher') && image.change === 'unknown');
  check('image download preserves exact original bytes', (await app.runFile(context().principal, runId, taskId, image.id)).bytes.equals(png));
  const notes = files.files.find((file) => file.path === 'outputs/notes.md')!;
  const text = (await app.runFile(context().principal, runId, taskId, notes.id)).bytes.toString();
  check('text download removes host paths and known secrets', text.includes('# Result') && !text.includes('private'));
  await refuses('raster extension alone cannot authorize active content', () => app.runFile(context().principal, runId, taskId, files.files.find((file) => file.name === 'fake.png')!.id), 'command_rejected');
  writeFileSync(join(cwd, 'outputs', 'image.png'), Buffer.concat([png, Buffer.from('changed')]));
  await refuses('stale file identity cannot read changed content', () => app.runFile(context().principal, runId, taskId, image.id), 'command_rejected');
  writeFileSync(join(cwd, 'outputs', 'image.png'), png);
  const freshImage = (await app.runFiles(context().principal, runId, taskId)).files.find((file) => file.name === 'image.png')!;
  const stalePrincipal = context().principal; devices.setAdminScopes('tablet', ['catalog:write']);
  await refuses('revocation invalidates previously authorized principal', () => app.runFile(stalePrincipal, runId, taskId, freshImage.id), 'scope_not_granted');
  devices.setAdminScopes('tablet', ['catalog:write', 'workspace:read']);
  server = new HostApiServer(app, { port: 0, requireDeviceReads: true, authorizer: new RemoteAuthorizer('t'.repeat(32), [], undefined, devices) });
  const address = await server.start(); const path = `/api/v1/runs/${runId}/tasks/${taskId}/files/${freshImage.id}`;
  const url = `http://127.0.0.1:${address.port}`;
  check('unsigned artifact request is rejected', (await fetch(url + path, { headers: { authorization: `Bearer ${'t'.repeat(32)}` } })).status === 401);
  const signed = async (target: string) => { const timestamp = String(Date.now()); return fetch(url + target, { headers: { authorization: `Bearer ${'t'.repeat(32)}`, 'x-ade-device': 'tablet', 'x-ade-timestamp': timestamp,
    'x-ade-signature': signRequest('d'.repeat(40), { method: 'GET', path: target, timestamp, idempotencyKey: '', bodySha256: sha256Hex('') }) } }); };
  const response = await signed(path);
  check('protected binary HTTP response uses private safe headers', response.status === 200 && response.headers.get('content-type') === 'image/png' && response.headers.get('cache-control')?.includes('no-store') === true && response.headers.get('x-content-type-options') === 'nosniff' && response.headers.get('content-disposition')?.startsWith('attachment') === true);
  check('binary HTTP image is byte-for-byte original', Buffer.from(await response.arrayBuffer()).equals(png));
  check('path traversal cannot be a file identifier', (await signed(`/api/v1/runs/${runId}/tasks/${taskId}/files/..%2fnotes.md`)).status >= 400);
  check('signed final answer HTTP endpoint remains available', (await signed(`/api/v1/runs/${runId}/tasks/${taskId}/activity`)).status === 200);
  check('read-only inspection leaves original image unchanged', readFileSync(join(cwd, 'outputs', 'image.png')).equals(png));

  const tracker = new RunFileTracker(store, f.workbench);
  const scope = await f.workbench.resolve({ agentId: 'builder', repositoryId: created.created!.id });
  if (!scope) throw new Error('missing scope');
  // Remove the intentionally excluded hardlink before measuring a complete baseline.
  unlinkSync(join(cwd, 'hardlink.md'));
  writeFileSync(join(cwd, 'remove.txt'), 'old'); writeFileSync(join(cwd, 'edit.txt'), 'before');
  await tracker.before(taskId, { source: 'explicit', repositoryId: created.created!.id, workspaceBindingId: scope.id,
    workspaceDir: cwd, executionBackend: 'native', branch: scope.branch ?? '' });
  const before = store.get().runTasks.find((task) => task.id === taskId)!.fileTracking!.before!;
  check('baseline persists hashes without file bodies', validRunFileTracking({ before, notice: null }) && before.files.some((file) => file.path === 'edit.txt') && !JSON.stringify(before).includes('private-value'));
  writeFileSync(join(cwd, 'edit.txt'), 'after'); unlinkSync(join(cwd, 'remove.txt'));
  writeFileSync(join(cwd, 'new.xlsx'), Buffer.from([80,75,3,4,5,6])); writeFileSync(join(cwd, 'new.pdf'), '%PDF fixture'); writeFileSync(join(cwd, 'DATA'), Buffer.from([0,1,2,3]));
  await tracker.after(taskId);
  const tracking = store.get().runTasks.find((task) => task.id === taskId)!.fileTracking!;
  const delta = taskFileChanges(tracking); const byPath = new Map(delta.files.map((file) => [file.path, file.change]));
  check('actual snapshots distinguish new modified deleted and unchanged files', delta.source === 'observed' && byPath.get('edit.txt') === 'modified' && byPath.get('remove.txt') === 'deleted' && byPath.get('new.xlsx') === 'created' && !byPath.has('book.xlsx'));
  check('report includes durable observed file changes and totals', f.orchestration.report(runId).tasks[0]?.files?.files.some((file) => file.path === 'new.xlsx') === true && f.orchestration.report(runId).totals.filesChanged >= 5);
  check('renderer orchestration view does not expose private baselines', !JSON.stringify(f.orchestration.view()).includes('fileTracking') && !JSON.stringify(f.orchestration.view()).includes(before.workspaceVersion));
  check('incomplete baseline never invents a created file', taskFileChanges({ ...tracking, before: { ...before, limited: true } }).files.find((file) => file.path === 'new.xlsx')?.change === 'unknown');
  check('incomplete final snapshot never invents a deleted file', !taskFileChanges({ ...tracking, after: { ...tracking.after!, limited: true } }).files.some((file) => file.change === 'deleted'));
  check('agent-reported legacy files remain explicitly unverified', taskFileChanges(undefined, ['claimed.png']).files[0]?.change === 'reported');
  check('workspace identity drift invalidates the comparison', taskFileChanges({ ...tracking, after: { ...tracking.after!, workspaceVersion: 'f'.repeat(64) } }).source === 'unknown');
  check('snapshot contract rejects traversal duplicate paths bodies and oversized lists', !validRunFileTracking({ ...tracking, before: { ...before, files: [{ path: '../escape', bytes: 1, sha256: 'a'.repeat(64) }] } })
    && !validRunFileTracking({ ...tracking, after: { ...tracking.after!, files: [before.files[0], before.files[0]] } })
    && !validRunFileTracking({ ...tracking, content: 'secret' }) && !validRunFileTracking({ ...tracking, before: { ...before, files: Array(1001).fill(before.files[0]) } }));
  let invalidConfigRejected = false; const invalidConfig = structuredClone(store.get()); invalidConfig.runTasks.find((task) => task.id === taskId)!.fileTracking = { ...tracking, notice: 'x'.repeat(501) };
  try { validateCompleteConfig(invalidConfig); } catch { invalidConfigRejected = true; }
  check('config validation rejects malformed tracking', invalidConfigRejected);
  const observed = await app.runFiles(context().principal, runId, taskId);
  check('deleted file retains provenance without download capability', observed.files.some((file) => file.path === 'remove.txt' && file.change === 'deleted' && file.available === false));
  check('unchanged workspace file is not attributed to run', observed.files.some((file) => file.path === 'book.xlsx' && file.change === 'unchanged'));
  for (const name of ['new.xlsx', 'new.pdf', 'DATA']) {
    const file = observed.files.find((item) => item.name === name)!;
    check(`download preserves ${name} bytes`, (await app.runFile(context().principal, runId, taskId, file.id)).bytes.equals(readFileSync(join(cwd, name))));
  }
  const oldFile = observed.files.find((file) => file.path === 'DATA')!; const oldStat = statSync(join(cwd, 'DATA'));
  writeFileSync(join(cwd, 'DATA'), Buffer.from([9,8,7,6])); utimesSync(join(cwd, 'DATA'), oldStat.atime, oldStat.mtime);
  await refuses('content drift is rejected even with identical length and restored modification time', () => app.runFile(context().principal, runId, taskId, oldFile.id), 'command_rejected');
  const driftReply = await signed(`/api/v1/runs/${runId}/tasks/${taskId}/files/${oldFile.id}`); const driftBody = await driftReply.json() as { message?: string };
  check('signed download conflict returns useful redacted refresh detail', driftReply.status === 409 && !!driftBody.message?.includes('Dateien aktualisieren') && !JSON.stringify(driftBody).includes(cwd));
  const aggregate = await app.runFiles(context().principal, runId);
  check('run-wide listing identifies the owning task and later modifications', aggregate.files.some((file) => file.path === 'DATA' && file.changedSinceRun && file.taskId === taskId));
  check('signed aggregate route is reachable', (await signed(`/api/v1/runs/${runId}/files`)).status === 200);
  const activity = await app.inspectRun(context().principal, runId);
  check('graph activity exposes observed counts without digests or host paths', activity.tasks[0]?.fileChanges?.created === 3 && activity.tasks[0]?.fileChanges?.modified === 1 && !JSON.stringify(activity).includes(before.workspaceVersion) && !JSON.stringify(activity).includes(cwd));
  const directory = await f.projects.directory(); const entry = directory.entries.find((item) => item.repositoryId === created.created!.id)!;
  const workspace = await f.projects.open(entry.id);
  const projectResult = await app.queryProjects(context(), { operation: 'run-results', workspaceId: workspace.id });
  check('project results locate exact repository runs and task sources', projectResult.runResults?.runs[0]?.id === runId && projectResult.runResults.runs[0].taskIds[0] === taskId);
  check('unrelated project has no result leakage', f.inspection.projectRuns('unrelated').runs.length === 0);
  const named = store.get().runs.find((run) => run.id === runId)!; store.save({ runs: store.get().runs.map((run) => run.id === runId ? { ...run, name: prompt } : run) });
  check('legacy project run titles do not leak their prompt', !JSON.stringify(f.inspection.projectRuns(created.created!.id)).includes(prompt));
  store.save({ runs: store.get().runs.map((run) => run.id === runId ? named : run) });
  devices.setAdminScopes('tablet', ['catalog:write']);
  await refuses('project results require current workspace read permission', () => app.queryProjects(context(), { operation: 'run-results', workspaceId: workspace.id }), 'scope_not_granted');
  devices.setAdminScopes('tablet', ['catalog:write', 'workspace:read']);
  check('final positive control still downloads generated spreadsheet', (await app.runFile(context().principal, runId, taskId, observed.files.find((file) => file.name === 'new.xlsx')!.id)).bytes.length === 6);
})().catch((error) => { failed++; console.error(error); }).finally(async () => {
  await server?.stop(); if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('unexpected fixture root');
  rmSync(root, { recursive: true, force: true }); console.log(`Run inspection: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
});
