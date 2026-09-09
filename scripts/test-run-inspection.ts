import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, symlinkSync, linkSync, rmSync } from 'node:fs';
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
  check('listing excludes metadata, secrets, hardlinks and junctions', !files.files.some((file) => /secret|hardlink|linked|\.env|\.git/.test(file.path)));
  check('listing makes workspace provenance explicit', !!files.notice?.includes('früheren'));
  check('image download preserves exact original bytes', (await app.runFile(context().principal, runId, taskId, image.id)).bytes.equals(png));
  const notes = files.files.find((file) => file.path === 'outputs/notes.md')!;
  const text = (await app.runFile(context().principal, runId, taskId, notes.id)).bytes.toString();
  check('text download removes host paths and known secrets', text.includes('# Result') && !text.includes('private'));
  await refuses('raster extension alone cannot authorize active content', () => app.runFile(context().principal, runId, taskId, files.files.find((file) => file.name === 'fake.png')!.id), 'command_rejected');
  writeFileSync(join(cwd, 'outputs', 'image.png'), Buffer.concat([png, Buffer.from('changed')]));
  await refuses('stale file identity cannot read changed content', () => app.runFile(context().principal, runId, taskId, image.id), 'not_found');
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
})().catch((error) => { failed++; console.error(error); }).finally(async () => {
  await server?.stop(); if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('unexpected fixture root');
  rmSync(root, { recursive: true, force: true }); console.log(`Run inspection: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
});
