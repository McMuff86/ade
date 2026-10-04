import { acknowledgeInterruptedBookend } from '../src/main/overview/sessionBookends';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { INPUT_RESUME_MS, RemoteTerminalService } from '../src/main/application/RemoteTerminalService';
import { DeviceResourceService } from '../src/main/application/DeviceResourceService';
import { remoteTerminalScreen } from '../src/main/application/RemoteTerminalScreen';
import { AdeApplicationService, RemoteApiError, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import { HostRestartController } from '../src/main/application/HostRestartController';
import type { MobileTerminalState, SubscriptionUsage } from '../src/shared/remote';
import type { TerminalControlState } from '../src/shared/ipc';
import { terminalHome } from '../src/main/pty/terminalHome';
import { validateWorkbenchQuery } from '../src/main/application/RemoteWorkbenchService';

let passed = 0; let failed = 0;
const check = (name: string, ok: boolean): void => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } };
async function refuses(name: string, action: () => unknown, code: string): Promise<void> {
  try { await action(); check(name, false); } catch (error) { check(name, error instanceof RemoteApiError && error.code === code); }
}
const root = mkdtempSync(join(tmpdir(), 'ade-terminal-')); let terminal: RemoteTerminalService | undefined;
void (async () => {
  const fixture = createRemoteWorkspaceFixture(root); const { store, devices, sessions, workbench, ledger, gate } = fixture;
  devices.enroll('tablet', 'Tablet', 'd'.repeat(40)); devices.enroll('other', 'Other', 'e'.repeat(40));
  devices.setAdminScopes('tablet', ['catalog:write', 'workspace:read']); devices.setAdminScopes('other', ['terminal:control']);
  const context = (id = 'tablet'): RemoteCommandContext => ({ principal: { id, kind: 'device', proof: 'device-signature',
    scopes: new Set(devices.activeDevices().find((device) => device.id === id)!.scopes) }, idempotencyKey: randomUUID(), requestId: 'terminal-test' });
  const repo = (await fixture.application.administer(context(), { operation: 'project-create', input: { name: 'Terminal' } })).created!.id;
  const selection = { agentId: 'builder', repositoryId: repo };
  await fixture.application.administer(context(), { operation: 'workspace-prepare', input: selection });
  const binding = store.get().workspaceBindings.find((item) => item.repositoryId === repo)!;
  const writes: string[] = []; let starts = 0; let now = Date.now(); let failWrite = false; const changes: TerminalControlState[] = [];
  const resources = new DeviceResourceService(store, (id) => devices.resourceAccess(id));
  let homeStarts = 0; let profileReads = 0;
  let screenText = 'PS C:\\private\\workspace>\r\nready\r\n';
  let displayEffect = async () => {};
  let usageEffect = async () => {}; const usageReads: string[] = [];
  terminal = new RemoteTerminalService(workbench, { list: () => sessions,
    usage: async id => {
      usageReads.push(id); await usageEffect();
      return { provider: 'claude', source: 'cli', checkedAt: now, status: 'unavailable', windows: [], message: 'Fixture',
        consumption: { status: 'recording', ended: false, checkedAt: now, lastReportedAt: now, events: 1,
          tokens: { input: 10, inputUncached: 8, cacheRead: 2, cacheWrite: 0, output: 2, reasoning: null },
          missing: { input: 0, inputUncached: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 1 },
          costs: [], eventsWithoutCost: 1, models: ['C:\\private\\model'], notice: 'Source C:\\private\\usage.jsonl' } } satisfies SubscriptionUsage;
    },
    display: async () => { await displayEffect(); return { screen: await remoteTerminalScreen(Buffer.from(screenText), 120, 32) }; },
    profileContext: () => { profileReads++; return 'Captured profile marker\nC:\\private\\profile\\AGENTS.md'; },
    createHome: async (choice, authorize) => {
      authorize(); const session = { ...terminalHome(), id: `native-home-${++homeStarts}`, scopeSource: 'terminal-home' as const,
        kind: 'interactive' as const, title: choice.mode, status: 'running' as const, createdAt: now, launchChoice: choice };
      sessions.push(session); return session;
    },
    create: async (agentId, repositoryId, bindingId, mode) => {
      const session = { id: `native-${++starts}`, agentId, repositoryId: repositoryId ?? undefined, workspaceBindingId: bindingId, workspaceDir: binding.workspaceDir,
        executionBackend: 'native' as const, kind: 'interactive' as const, title: mode, status: 'running' as const, createdAt: now };
      sessions.push(session); return session;
    }, attach: () => ({ replayBase64: Buffer.from('PS C:\\private\\workspace>\r\nready\r\n').toString('base64'), sequence: 1 }),
    write: (_id, data) => { if (failWrite) throw new Error('fixture write failed'); writes.push(data.toString()); }, resize: () => undefined,
    kill: (id) => { const session = sessions.find((item) => item.id === id); if (session) session.status = 'exited'; },
  }, (id) => devices.activeDevices().some((device) => device.id === id && device.scopes.includes('terminal:control')),
  (entry) => devices.audit(entry), (state) => changes.push(state), () => now, (id, input) => resources.assertSelection(id, input));
  devices.onRevoked((id) => terminal!.revoke(id));
  const app = new AdeApplicationService(store, fixture.orchestration, { status: () => ({ active: 0, queued: 0, maxActive: 4 }) }, {
    resourceAccess: (id) => devices.resourceAccess(id),
    workbench, terminals: terminal, administration: { ledger, restart: new HostRestartController(gate, () => [], () => undefined, 'fixture', true) },
    dismissInterruption: (sessionId) => {
      const current = store.get().sessionBookends; const next = acknowledgeInterruptedBookend(current, sessionId, now);
      if (next === current) return false; store.save({ sessionBookends: next }); return true;
    },
  });
  const command = (payload: object, ctx = context()) => app.remoteTerminal(ctx, { ...selection, ...payload }, 'command');
  const query = async (terminalId?: string, ctx = context()) => app.remoteTerminal(ctx, { ...selection, ...(terminalId ? { terminalId } : {}) }, 'query') as Promise<MobileTerminalState>;
  await refuses('source-read permission cannot open terminal', () => command({ operation: 'open', mode: 'shell' }), 'scope_not_granted');
  await refuses('session inventory requires the terminal grant', () => app.remoteSessionInventory(context().principal), 'scope_not_granted');
  await refuses('closing an interruption requires the terminal grant', () => app.dismissAttention(context(), { id: `history:${'a'.repeat(32)}` }), 'scope_not_granted');
  devices.setAdminScopes('tablet', ['catalog:write', 'workspace:read', 'terminal:control']);
  {
    // Recorded interruptions can be closed by the device that is shown them; the record stays.
    const lost = (id: string, name: string) => ({ id, agentName: name, runtime: 'codex' as const, repositoryId: null, repositoryName: null,
      startedAt: 1, endedAt: 2, exitReason: 'interrupted' as const, interruption: 'app-crash' as const });
    store.save({ sessionBookends: [lost('pty-secret-1', 'Lost one'), lost('pty-secret-2', 'Lost two'),
      { ...lost('pty-ended', 'Ended normally'), exitReason: 'exit' as const, interruption: undefined }] });
    const rows = (await app.attention(context().principal)).rows.filter(row => row.kind === 'history');
    const one = rows.find(row => row.title === 'Lost one')!;
    check('interrupted sessions are offered for closing under an opaque row id', rows.length === 2 && rows.every(row => row.dismissible === true && /^history:[a-f0-9]{32}$/.test(row.id))
      && !JSON.stringify(rows).includes('pty-secret'));
    await refuses('closing requires an idempotency key', () => app.dismissAttention({ ...context(), idempotencyKey: undefined }, { id: one.id }), 'idempotency_key_required');
    await refuses('closing rejects a raw session id', () => app.dismissAttention(context(), { id: 'history:pty-secret-1' }), 'invalid_payload');
    await refuses('closing rejects extra fields', () => app.dismissAttention(context(), { id: one.id, force: true }), 'invalid_payload');
    await refuses('an unknown row cannot be closed', () => app.dismissAttention(context(), { id: `history:${'0'.repeat(32)}` }), 'not_found');
    check('refused attempts change nothing', store.get().sessionBookends.every(item => item.acknowledgedAt === undefined));
    const closeContext = context(); const closed = await app.dismissAttention(closeContext, { id: one.id }); const again = await app.dismissAttention(closeContext, { id: one.id });
    check('closing acknowledges exactly that record and a replay changes nothing more', closed.dismissed && !closed.replayed && again.replayed
      && store.get().sessionBookends.filter(item => item.acknowledgedAt !== undefined).map(item => item.id).join() === 'pty-secret-1');
    const after = (await app.attention(context().principal)).rows.filter(row => row.kind === 'history');
    check('the closed entry is no longer listed; the other one and the record itself remain', after.length === 1 && after[0]!.title === 'Lost two'
      && store.get().sessionBookends.length === 3 && store.get().sessionBookends[0]!.exitReason === 'interrupted');
    await refuses('a closed entry cannot be closed under a new key', () => app.dismissAttention(context(), { id: one.id }), 'not_found');
    store.save({ sessionBookends: [] });
  }
  for (const payload of [{ operation: 'open', mode: 'shell', command: 'injected' }, { operation: 'open', mode: 'custom' },
    { operation: 'claim', terminalId: '../native-1' }, { operation: 'open', mode: 'shell', workspaceDir: root }]) {
    await refuses('terminal rejects caller-owned command, PTY/path or mode', () => command(payload), 'invalid_payload');
  }
  const openedContext = context(); const opened = await command({ operation: 'open', mode: 'shell' }, openedContext) as { terminalId: string };
  await command({ operation: 'open', mode: 'shell' }, openedContext);
  check('duplicate open starts exactly one interactive process', starts === 1);
  const state = await query(opened.terminalId);
  check('ordinary screen polling does not fetch session consumption', usageReads.length === 0 && state.subscriptionUsage === undefined);
  const consumption = await app.remoteTerminal(context(), { ...selection, terminalId: opened.terminalId, usage: true }, 'query') as MobileTerminalState;
  check('explicit consumption uses only the selected native session and redacts its wire labels', usageReads.length === 1 && usageReads[0] === 'native-1'
    && consumption.subscriptionUsage?.consumption?.tokens.input === 10 && !JSON.stringify(consumption.subscriptionUsage).includes('private')
    && !JSON.stringify(consumption.subscriptionUsage).includes('native-1'));
  const unchanged = await app.remoteTerminal(context(), { ...selection, terminalId: opened.terminalId, knownDisplayRevision: state.displayRevision }, 'query') as MobileTerminalState;
  check('unchanged display omits bodies while returning current lease and metadata', unchanged.displayUnchanged === true && unchanged.screen === undefined
    && unchanged.frame === undefined && unchanged.displayRevision === state.displayRevision && unchanged.leaseId === state.leaseId);
  screenText += 'new scrollback\r\n';
  const updated = await app.remoteTerminal(context(), { ...selection, terminalId: opened.terminalId, knownDisplayRevision: state.displayRevision }, 'query') as MobileTerminalState;
  check('changed output invalidates display digest and sends complete safe body', !updated.displayUnchanged && updated.displayRevision !== state.displayRevision && updated.screen?.includes('new scrollback') === true);
  for (const body of [{ ...selection, knownDisplayRevision: state.displayRevision }, { ...selection, terminalId: opened.terminalId, knownDisplayRevision: 'invalid' }]) {
    await refuses('display revision requires selected terminal and bounded digest', () => app.remoteTerminal(context(), body, 'query'), 'invalid_payload');
  }
  check('ordinary terminal polling does not load or return profile instructions', profileReads === 0 && !Object.hasOwn(state, 'profileContextText'));
  const contextText = await app.remoteTerminal(context(), { ...selection, terminalId: opened.terminalId, profileContext: true }, 'query') as MobileTerminalState;
  check('explicit profile detail is bounded and host paths are redacted', profileReads === 1 && contextText.profileContextText?.includes('Captured profile marker') === true && !contextText.profileContextText.includes('private'));
  await refuses('profile detail requires a selected terminal', () => app.remoteTerminal(context(), { ...selection, profileContext: true }, 'query'), 'invalid_payload');
  await refuses('profile detail flag rejects ambiguous values', () => app.remoteTerminal(context(), { ...selection, terminalId: opened.terminalId, profileContext: false }, 'query'), 'invalid_payload');
  check('new terminal belongs to device and raw PTY identity stays in main', state.selected?.owner === 'self' && !JSON.stringify(state).includes('native-1'));
  sessions[0]!.program = { status: 'running', startedAt: now };
  check('wire reports the foreground invocation separately from shell liveness', (await query(opened.terminalId)).selected?.program?.status === 'running');
  sessions[0]!.program = { status: 'exited', startedAt: now, endedAt: now + 10, exitCode: 7 };
  const endedProgram = await query(opened.terminalId);
  check('ended CLI retains its own exit code while remote shell input remains available', endedProgram.selected?.status === 'running'
    && endedProgram.selected.program?.status === 'exited' && endedProgram.selected.program.exitCode === 7 && !!endedProgram.leaseId);
  check('screen output is interpreted and paths redacted', state.screen!.includes('ready') && !state.screen!.includes('private'));
  check('remote owner blocks desktop input and emits desktop event', !terminal.desktopMayWrite('native-1') && changes.at(-1)?.remote === true);
  await refuses('second device cannot steal active remote control', () => command({ operation: 'claim', terminalId: opened.terminalId }, context('other')), 'command_rejected');
  const input = { ...selection, terminalId: opened.terminalId, leaseId: state.leaseId!, sequence: 1, data: 'hello\r', cols: 100, rows: 30 };
  const inputContext = context();
  await Promise.all([app.remoteTerminal(inputContext, input, 'input'), app.remoteTerminal(inputContext, input, 'input')]);
  check('concurrent duplicate input reaches PTY at most once', writes.length === 1 && writes[0] === 'hello\r');
  await refuses('changed body cannot reuse input key/sequence', () => app.remoteTerminal(inputContext, { ...input, data: 'changed\r' }, 'input'), 'idempotency_key_reused');
  await refuses('input gaps fail closed', () => app.remoteTerminal(context(), { ...input, sequence: 3 }, 'input'), 'command_rejected');
  await refuses('input requires an idempotency key', () => app.remoteTerminal({ ...context(), idempotencyKey: undefined }, { ...input, sequence: 2 }, 'input'), 'idempotency_key_required');
  check('query reconnects to the same process with input acknowledgement', (await query(opened.terminalId)).lastSequence === 1 && starts === 1);
  store.save({ runWorkspaceLeases: [{ id: 'lease', runId: 'run', participantId: 'participant', agentId: 'builder', repositoryId: repo, workspaceBindingId: binding.id,
    workspaceDir: binding.workspaceDir, isRepo: true, branch: binding.branch, commonGitDir: '', baseSha: '', status: 'active', acquiredAt: now }] });
  await refuses('managed lease also fences an older interactive session', () => app.remoteTerminal(context(), { ...input, sequence: 2 }, 'input'), 'command_rejected');
  store.save({ runWorkspaceLeases: [] });
  terminal.reclaim('native-1');
  check('desktop can immediately reclaim input', terminal.desktopMayWrite('native-1') && (await query(opened.terminalId)).selected!.owner === 'desktop');
  await refuses('old remote lease cannot type after desktop reclaim', () => app.remoteTerminal(context(), { ...input, sequence: 2 }, 'input'), 'command_rejected');
  await command({ operation: 'claim', terminalId: opened.terminalId });
  check('explicit reattach does not restart a session', starts === 1 && (await query(opened.terminalId)).leaseId !== state.leaseId);
  now += 30_001;
  check('expired lease returns input to desktop without killing process', terminal.desktopMayWrite('native-1') && sessions[0]!.status === 'running');
  const lapsed = await query(opened.terminalId);
  check('a lapsed lease is offered back to its device while the desktop holds input', lapsed.selected?.owner === 'desktop' && lapsed.selected.resumable === true && !lapsed.leaseId);
  check('no other device sees that offer', (await query(opened.terminalId, context('other'))).selected?.resumable === undefined);
  await command({ operation: 'claim', terminalId: opened.terminalId });
  const resumed = await query(opened.terminalId);
  check('taking the input back ends the offer', resumed.selected?.owner === 'self' && resumed.selected.resumable === undefined && !!resumed.leaseId);
  await command({ operation: 'release', terminalId: opened.terminalId });
  check('an explicit release is never offered back', (await query(opened.terminalId)).selected?.resumable === undefined);
  await command({ operation: 'claim', terminalId: opened.terminalId }); now += 30_001;
  check('the lapse is recorded before the desktop acts', terminal.desktopMayWrite('native-1') && (await query(opened.terminalId)).selected?.resumable === true);
  terminal.reclaim('native-1');
  check('a desktop reclaim after the lapse withdraws the offer', (await query(opened.terminalId)).selected?.resumable === undefined);
  await command({ operation: 'claim', terminalId: opened.terminalId }); now += 30_001; terminal.desktopMayWrite('native-1'); now += INPUT_RESUME_MS;
  check('the offer ends after ten minutes', (await query(opened.terminalId)).selected?.resumable === undefined);
  await command({ operation: 'claim', terminalId: opened.terminalId }); now += 30_001; terminal.desktopMayWrite('native-1');
  await command({ operation: 'claim', terminalId: opened.terminalId }); const revokedContext = context();
  devices.setAdminScopes('tablet', ['catalog:write', 'workspace:read']);
  check('scope revocation releases desktop input immediately', terminal.desktopMayWrite('native-1'));
  await refuses('stale principal cannot inspect terminal after revoke', () => query(opened.terminalId, revokedContext), 'scope_not_granted');
  devices.setAdminScopes('tablet', ['catalog:write', 'workspace:read', 'terminal:control']);
  check('a revoked lease is never offered back', (await query(opened.terminalId)).selected?.resumable === undefined);
  sessions.push({ ...sessions[0]!, id: 'managed', kind: 'task', runTaskId: 'task-1' }, { ...sessions[0]!, id: 'login', remoteAccessBlocked: true });
  check('managed tasks and credential-login sessions are absent from terminal inventory', (await query()).terminals.length === 1);
  const inventory = await app.remoteSessionInventory(context().principal);
  check('global session inventory includes only validated interactive workspaces', inventory.sessions.length === 1
    && inventory.sessions[0]!.agentId === selection.agentId && inventory.sessions[0]!.repositoryId === repo && inventory.sessions[0]!.id === opened.terminalId);
  check('session inventory never includes PTY ids, output, paths or control leases', !/native-1|workspaceDir|leaseId|screen|private/.test(JSON.stringify(inventory)) && starts === 1);
  devices.setAdminScopes('tablet', ['catalog:write', 'workspace:read', 'terminal:control'], { mode: 'selected', repositoryIds: [], agentIds: [] });
  check('removing resource grants empties global session inventory', !(await app.remoteSessionInventory(context().principal)).sessions.length);
  await refuses('remembered terminal cannot be read after resource removal', () => query(opened.terminalId), 'scope_not_granted');
  await refuses('captured profile text cannot bypass resource removal', () => app.remoteTerminal(context(), { ...selection, terminalId: opened.terminalId, profileContext: true }, 'query'), 'scope_not_granted');
  await refuses('cached terminal open cannot replay after resource removal', () => command({ operation: 'open', mode: 'shell' }, openedContext), 'scope_not_granted');
  await refuses('terminal service independently enforces current resource grants', () => terminal!.query('tablet', { ...selection, terminalId: opened.terminalId }), 'scope_not_granted');
  await refuses('old terminal input cannot bypass resource removal', () => terminal!.input(inputContext, input), 'scope_not_granted');
  devices.setAdminScopes('tablet', ['catalog:write', 'workspace:read', 'terminal:control'], { mode: 'selected', repositoryIds: [repo], agentIds: ['builder'] });
  check('positive selection restores same live session without restarting it', (await query(opened.terminalId)).selected!.id === opened.terminalId && starts === 1);
  await refuses('bearer principal cannot inspect session inventory', () => app.remoteSessionInventory({ ...context().principal, kind: 'token', proof: 'bearer' } as unknown as ReturnType<typeof context>['principal']), 'device_proof_required');
  await refuses('raw managed PTY id cannot be attached', () => query('managed'), 'command_rejected');
  const screen = await remoteTerminalScreen(Buffer.from('abc\x1b[2K\rPS C:\\private\\workspace>\r\napi_key=sensitive\r\n'), 20, 10);
  check('control sequences and soft wraps cannot bypass screen redaction', !screen.includes('private') && !screen.includes('sensitive') && !screen.includes('\x1b'));
  await command({ operation: 'claim', terminalId: opened.terminalId });
  const fresh = await query(opened.terminalId); const failedContext = context(); const failedInput = { ...input, leaseId: fresh.leaseId!, sequence: 1 };
  failWrite = true;
  await refuses('failed PTY write is reported without claiming acceptance', () => app.remoteTerminal(failedContext, failedInput, 'input'), 'command_rejected');
  check('screen state distinguishes reserved input from accepted input', (await query(opened.terminalId)).inputUncertain === true);
  failWrite = false;
  await refuses('retry after failed write cannot type into the process', () => app.remoteTerminal(failedContext, failedInput, 'input'), 'command_uncertain');
  await command({ operation: 'claim', terminalId: opened.terminalId }); await command({ operation: 'close', terminalId: opened.terminalId });
  check('owner can explicitly close the process', sessions[0]!.status === 'exited');
  // A CLI that ended by itself leaves no lease to renew; removing its session must not need one.
  let endedClose = true; try { await command({ operation: 'close', terminalId: opened.terminalId }); } catch { endedClose = false; }
  check('an already ended session can still be closed without input control', endedClose);
  await refuses('an ended session cannot be claimed for input', () => command({ operation: 'claim', terminalId: opened.terminalId }), 'command_rejected');
  await command({ operation: 'open', mode: 'agent' });
  check('final positive configured-agent control starts independently', starts === 2 && sessions.at(-1)!.title === 'agent');
  const homeCommand = (payload: object, ctx = context()) => app.remoteTerminal(ctx, { terminalHome: true, ...payload }, 'command');
  await refuses('selected-resource grant cannot launch a host-home terminal', () => homeCommand({ operation: 'open', mode: 'shell' }), 'scope_not_granted');
  devices.setAdminScopes('tablet', ['terminal:control'], { mode: 'all' });
  for (const extra of [{ agentId: 'builder', repositoryId: null }, { terminalHome: false }, { projectWorkspaceId: randomUUID() },
    { workspaceDir: root }, { profileId: 'builder' }, { mode: 'agent' }, { expectedBranch: 'main' }]) {
    await refuses('home terminal rejects mixed scope and caller-selected paths/profile', () => homeCommand({ operation: 'open', mode: 'shell', ...extra }), 'invalid_payload');
  }
  await refuses('terminal-home does not expose host home through workspace reads', () => validateWorkbenchQuery({ terminalHome: true, operation: 'tree', path: '' }), 'invalid_payload');
  const homeContext = context(); const home = await homeCommand({ operation: 'open', mode: 'shell' }, homeContext) as { terminalId: string };
  await homeCommand({ operation: 'open', mode: 'shell' }, homeContext);
  const readHome = () => app.remoteTerminal(context(), { terminalHome: true, terminalId: home.terminalId }, 'query') as Promise<MobileTerminalState>;
  const homeState = await readHome();
  check('home open is idempotent and needs no agent or repository', homeStarts === 1 && !sessions.at(-1)!.agentId && !sessions.at(-1)!.repositoryId && homeState.selected?.owner === 'self');
  const homeInventory = await app.remoteSessionInventory(context().principal);
  check('inventory reconnects agent-free sessions using an opaque terminal-home selection', homeInventory.sessions.some((item) => item.id === home.terminalId && item.terminalHome)
    && !JSON.stringify(homeInventory).includes('native-home-1') && !JSON.stringify(homeInventory).includes(terminalHome().workspaceDir));
  const homeInput = { terminalHome: true, terminalId: home.terminalId, leaseId: homeState.leaseId!, sequence: 1, data: 'home\r', cols: 80, rows: 25 };
  const writeCount = writes.length; const homeInputContext = context();
  await app.remoteTerminal(homeInputContext, homeInput, 'input'); await app.remoteTerminal(homeInputContext, homeInput, 'input');
  check('home input preserves at-most-once sequencing', writes.length === writeCount + 1);
  terminal.reclaim('native-home-1');
  await refuses('desktop reclaim invalidates home input lease', () => app.remoteTerminal(context(), { ...homeInput, sequence: 2 }, 'input'), 'command_rejected');
  devices.setAdminScopes('tablet', ['terminal:control'], { mode: 'selected', repositoryIds: [repo], agentIds: ['builder'] });
  await refuses('narrowed grant blocks a remembered home terminal', readHome, 'scope_not_granted');
  await refuses('narrowed grant also blocks replaying a successful home open', () => homeCommand({ operation: 'open', mode: 'shell' }, homeContext), 'scope_not_granted');
  check('narrowed grant hides home sessions from inventory', !(await app.remoteSessionInventory(context().principal)).sessions.some((item) => item.terminalHome));
  devices.setAdminScopes('tablet', ['terminal:control'], { mode: 'all' });
  await homeCommand({ operation: 'claim', terminalId: home.terminalId });
  await homeCommand({ operation: 'close', terminalId: home.terminalId });
  check('restored grant closes only the selected home process', sessions.find((item) => item.id === 'native-home-1')?.status === 'exited' && sessions.find((item) => item.id === 'native-2')?.status === 'running');
  const finalOpen = await command({ operation: 'open', mode: 'shell' }) as { terminalId: string };
  displayEffect = async () => { devices.setAdminScopes('tablet', ['workspace:read']); };
  await refuses('grant revoked during display read prevents any screen response', () => query(finalOpen.terminalId), 'scope_not_granted');
  displayEffect = async () => {};
  devices.setAdminScopes('tablet', ['workspace:read', 'terminal:control']);
  const bindingRecords = store.get().workspaceBindings;
  displayEffect = async () => { store.save({ workspaceBindings: bindingRecords.map(item => item.id === binding.id ? { ...item, branch: 'changed-during-display' } : item) }); };
  await refuses('scope changed during display read is rejected by final validation', () => query(finalOpen.terminalId), 'command_rejected');
  displayEffect = async () => {}; store.save({ workspaceBindings: bindingRecords });
  usageEffect = async () => { devices.setAdminScopes('tablet', ['workspace:read']); };
  await refuses('grant revoked during consumption read prevents the numeric response', () => app.remoteTerminal(context(), { ...selection, terminalId: finalOpen.terminalId, usage: true }, 'query'), 'scope_not_granted');
  usageEffect = async () => {}; devices.setAdminScopes('tablet', ['workspace:read', 'terminal:control']);
  check('final positive control returns same terminal after validation failures', (await query(finalOpen.terminalId)).selected?.id === finalOpen.terminalId);
})().catch((error) => { failed++; console.error(error); }).finally(() => {
  terminal?.dispose(); rmSync(root, { recursive: true, force: true }); console.log(`Remote terminal: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
});
