import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { AdeApplicationService, RemoteApiError, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import type { RemoteTerminalService } from '../src/main/application/RemoteTerminalService';
import { HostRestartController } from '../src/main/application/HostRestartController';
import { SupervisionService } from '../src/main/supervision/SupervisionService';
import { SupervisionStore } from '../src/main/supervision/SupervisionStore';
import type { SessionMeta } from '../src/shared/types';
import type { MobileSupervisionView, MobileSupervisionDetail, MobileSupervisionCommand, MobileMorningBriefing, MobileHandoffDetail } from '../src/shared/remote';

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-remote-supervision-')));
let passed = 0; let failed = 0;
const check = (label: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
async function refuses(label: string, action: () => unknown, code: string) { try { await action(); check(label, false); } catch (error) { check(label, error instanceof RemoteApiError && error.code === code); } }
void (async () => {
  const { application: app, devices, store, orchestration, ledger, gate } = createRemoteWorkspaceFixture(root);
  store.save({ repositories: ['a', 'b'].map(id => ({ id, name: 'Same name', rootPath: join(root, id), commonGitDir: join(root, id, '.git'), executionBackend: 'native', verified: true, createdAt: 1 })) });
  const run = orchestration.createRun({ name: 'Snapshot', repositoryId: 'a', participants: [{ agentId: 'builder', role: 'orchestrator', runtime: 'claude' }] });
  store.save({ agents: store.get().agents.map(agent => agent.id === 'builder' ? { ...agent, name: 'Renamed builder', runtime: 'codex' } : agent) });
  const participant = orchestration.summarize(run.id)[0]!.participants[0]!;
  check('run graph carries immutable runtime and agent identity after a profile rename or runtime change', participant.agentId === 'builder' && participant.agentName === 'Builder' && participant.runtime === 'claude');
  devices.enroll('tablet', 'Tablet', 'd'.repeat(40));
  const context = (): RemoteCommandContext => ({ principal: { id: 'tablet', kind: 'device', proof: 'device-signature', scopes: new Set(devices.activeDevices().find(d => d.id === 'tablet')!.scopes) }, idempotencyKey: randomUUID(), requestId: 'supervision-test' });
  const query = () => app.supervision(context(), { operation: 'overview' }, false) as Promise<MobileSupervisionView>;
  const input: MobileSupervisionCommand = { operation: 'project', repositoryId: 'a', mode: 'observe', objective: 'Private note C:\\Users\\Private\\work\\source.txt', revision: 0 };
  check('paired read can query supervision without terminal access', !(await query()).projects.length);
  await refuses('bearer cannot read supervision details', () => app.supervision({ ...context(), principal: { kind: 'bootstrap-token', id: 'token', proof: 'bearer', scopes: new Set(['read']) } }, { operation: 'overview' }, false), 'device_proof_required');
  await refuses('wire command cannot choose an internal command ID', () => app.supervision(context(), { ...input, commandId: 'injected' }, true), 'invalid_payload');
  await refuses('wire command rejects absolute target injection', () => app.supervision(context(), { ...input, cwd: root }, true), 'invalid_payload');
  const readOnly = context(); readOnly.principal.scopes = new Set(['read']);
  await refuses('read-only principal cannot change ownership', () => app.supervision(readOnly, input, true), 'scope_not_granted');
  await refuses('mutation requires a durable idempotency key', () => app.supervision({ ...context(), idempotencyKey: undefined }, input, true), 'idempotency_key_required');
  const request = context(); const first = await app.supervision(request, input, true); const replay = await app.supervision(request, input, true);
  check('lost receipt is replayed without changing revision again', 'revision' in first && 'revision' in replay && first.revision === replay.revision && 'replayed' in replay && replay.replayed);
  let state = await query(); const project = state.projects[0]!;
  check('wire summary never exposes instruction bodies or host paths', !JSON.stringify(state).includes('Private note') && !JSON.stringify(state).includes('Users') && project.objective.chars === input.objective.length);
  const detail = await app.supervision(context(), { operation: 'detail', projectId: project.id }, false) as MobileSupervisionDetail;
  check('detail masks host paths and explicitly marks a redacted copy', detail.redacted && !detail.objective.includes('Users'));
  check('remote receipts contain fingerprints, not private objectives', !readFileSync(join(root, 'remote', 'commands.json'), 'utf8').includes('Private note'));
  await refuses('changed payload cannot reuse a completed key', () => app.supervision(request, { ...input, mode: 'coordinate' }, true), 'idempotency_key_reused');
  await refuses('old revision cannot overwrite the current assignment', () => app.supervision(context(), { ...input, objective: 'stale' }, true), 'command_rejected');
  const note = { operation: 'remember', projectId: project.id, text: 'Private handoff C:\\Users\\Private\\project', nextStep: 'Review tomorrow', linkId: null, revision: state.revision };
  const noteContext = context(); await app.supervision(noteContext, note, true); await app.supervision(noteContext, note, true);
  const morning = await app.supervision(context(), { operation: 'briefing' }, false) as MobileMorningBriefing;
  const handoff = morning.projects[0].handoffs[0];
  check('mobile remember is durable and duplicate delivery creates one handoff', morning.projects[0].handoffs.length === 1 && morning.projects[0].suggestion === 'resume-handoff');
  check('mobile morning summary contains no private handoff bodies', !JSON.stringify(morning).includes('Private handoff') && !JSON.stringify(morning).includes('Users'));
  const handoffDetail = await app.supervision(context(), { operation: 'handoff', projectId: project.id, handoffId: handoff.id }, false) as MobileHandoffDetail;
  check('mobile handoff detail redacts host paths and keeps the complete next step', handoffDetail.redacted === true && !handoffDetail.text.includes('Users') && handoffDetail.nextStep === 'Review tomorrow');
  check('remote command ledger never stores handoff bodies', !readFileSync(join(root, 'remote', 'commands.json'), 'utf8').includes('Private handoff'));
  // A completed inventory can become stale at its await boundary. Keep project
  // access, revoke only the launch profile, then return that old inventory.
  const session: SessionMeta = { id: 'native-session', title: 'Profile work', kind: 'interactive', runtime: 'codex', status: 'running', repositoryId: 'a', createdAt: 1, launchProfileId: 'builder' };
  const supervision = new SupervisionService(new SupervisionStore(join(root, 'supervision.json')), store, id => id === session.id ? session : undefined);
  supervision.command({ operation: 'link', projectId: project.id, target: { kind: 'session', id: session.id }, revision: supervision.query().revision, commandId: 'race-link' });
  let revokeProfile = false;
  const grantProfile = () => devices.setAdminScopes('tablet', ['terminal:control'], { mode: 'selected', repositoryIds: ['a'], agentIds: ['builder'] });
  grantProfile();
  const raceApp = new AdeApplicationService(store, orchestration, { status: () => ({ active: 1, queued: 0, maxActive: 4 }) }, {
    supervision: () => supervision, resourceAccess: id => devices.resourceAccess(id), deviceActive: id => devices.activeDevices().some(d => d.id === id),
    administration: { ledger, restart: new HostRestartController(gate, () => [], () => undefined, 'fixture', true) },
    terminals: { supervisionSessions: async () => {
      if (revokeProfile) devices.setAdminScopes('tablet', ['terminal:control'], { mode: 'selected', repositoryIds: ['a'], agentIds: [] });
      return [{ session, wire: { id: 'opaque-session', repositoryId: 'a', launchProfileId: 'builder' } }];
    } } as unknown as RemoteTerminalService,
  });
  const raceBriefing = () => raceApp.supervision(context(), { operation: 'briefing' }, false) as Promise<MobileMorningBriefing>;
  check('authorized morning briefing includes linked profile work', (await raceBriefing()).projects[0].work.length === 1);
  revokeProfile = true;
  await refuses('morning read rechecks a launch-profile grant revoked during inventory', raceBriefing, 'scope_not_granted');
  grantProfile();
  await refuses('graph read rechecks a launch-profile grant revoked during inventory', () => raceApp.supervision(context(), { operation: 'overview' }, false), 'scope_not_granted');
  revokeProfile = false; grantProfile();
  check('final morning read succeeds after profile access is restored', (await raceBriefing()).projects[0].work.length === 1);
  state = await query();
  devices.setAdminScopes('tablet', [], { mode: 'selected', agentIds: ['builder'], repositoryIds: ['b'] });
  check('selected-resource device sees only its projects', !(await query()).projects.length);
  check('revoked project disappears from morning summary', !(await app.supervision(context(), { operation: 'briefing' }, false) as MobileMorningBriefing).projects.length);
  await refuses('revoked project handoff detail is refused', () => app.supervision(context(), { operation: 'handoff', projectId: project.id, handoffId: handoff.id }, false), 'scope_not_granted');
  await refuses('revoked remember receipt is refused before replay', () => app.supervision(noteContext, note, true), 'scope_not_granted');
  await refuses('selected-resource device cannot read another project instruction', () => app.supervision(context(), { operation: 'detail', projectId: project.id }, false), 'scope_not_granted');
  await refuses('revoked project access blocks a prior receipt replay', () => app.supervision(request, input, true), 'scope_not_granted');
  await refuses('selected-resource device cannot change the global ADE profile', () => app.supervision(context(), { operation: 'profile', agentId: 'builder', revision: state.revision }, true), 'scope_not_granted');
  const final = await app.supervision(context(), { operation: 'project', repositoryId: 'b', mode: 'direct', objective: 'Own project', revision: state.revision }, true);
  check('final positive write succeeds in the still-authorized project', 'revision' in final && final.revision > state.revision && (await query()).projects[0]?.repositoryId === 'b');
  const stale = context(); devices.revoke('tablet');
  await refuses('device revocation invalidates even a previously valid principal', () => app.supervision(stale, { operation: 'overview' }, false), 'unknown_device');
})().catch(error => { failed++; console.error(error); }).finally(() => {
  if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected fixture root'); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  console.log(`Remote supervision: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
});
