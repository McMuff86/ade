import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { RemoteTerminalService } from '../src/main/application/RemoteTerminalService';
import { remoteTerminalScreen } from '../src/main/application/RemoteTerminalScreen';
import { AdeApplicationService, RemoteApiError, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import { HostRestartController } from '../src/main/application/HostRestartController';
import type { MobileTerminalState } from '../src/shared/remote';
import type { TerminalControlState } from '../src/shared/ipc';

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
  terminal = new RemoteTerminalService(workbench, { list: () => sessions,
    create: async (agentId, repositoryId, bindingId, mode) => {
      const session = { id: `native-${++starts}`, agentId, repositoryId: repositoryId ?? undefined, workspaceBindingId: bindingId, workspaceDir: binding.workspaceDir,
        executionBackend: 'native' as const, kind: 'interactive' as const, title: mode, status: 'running' as const, createdAt: now };
      sessions.push(session); return session;
    }, attach: () => ({ replayBase64: Buffer.from('PS C:\\private\\workspace>\r\nready\r\n').toString('base64'), sequence: 1 }),
    write: (_id, data) => { if (failWrite) throw new Error('fixture write failed'); writes.push(data.toString()); }, resize: () => undefined,
    kill: (id) => { const session = sessions.find((item) => item.id === id); if (session) session.status = 'exited'; },
  }, (id) => devices.activeDevices().some((device) => device.id === id && device.scopes.includes('terminal:control')),
  (entry) => devices.audit(entry), (state) => changes.push(state), () => now);
  devices.onRevoked((id) => terminal!.revoke(id));
  const app = new AdeApplicationService(store, fixture.orchestration, { status: () => ({ active: 0, queued: 0, maxActive: 4 }) }, {
    workbench, terminals: terminal, administration: { ledger, restart: new HostRestartController(gate, () => [], () => undefined, 'fixture', true) },
  });
  const command = (payload: object, ctx = context()) => app.remoteTerminal(ctx, { ...selection, ...payload }, 'command');
  const query = async (terminalId?: string, ctx = context()) => app.remoteTerminal(ctx, { ...selection, ...(terminalId ? { terminalId } : {}) }, 'query') as Promise<MobileTerminalState>;
  await refuses('source-read permission cannot open terminal', () => command({ operation: 'open', mode: 'shell' }), 'scope_not_granted');
  await refuses('session inventory requires the terminal grant', () => app.remoteSessionInventory(context().principal), 'scope_not_granted');
  devices.setAdminScopes('tablet', ['catalog:write', 'workspace:read', 'terminal:control']);
  for (const payload of [{ operation: 'open', mode: 'shell', command: 'injected' }, { operation: 'open', mode: 'custom' },
    { operation: 'claim', terminalId: '../native-1' }, { operation: 'open', mode: 'shell', workspaceDir: root }]) {
    await refuses('terminal rejects caller-owned command, PTY/path or mode', () => command(payload), 'invalid_payload');
  }
  const openedContext = context(); const opened = await command({ operation: 'open', mode: 'shell' }, openedContext) as { terminalId: string };
  await command({ operation: 'open', mode: 'shell' }, openedContext);
  check('duplicate open starts exactly one interactive process', starts === 1);
  const state = await query(opened.terminalId);
  check('new terminal belongs to device and raw PTY identity stays in main', state.selected?.owner === 'self' && !JSON.stringify(state).includes('native-1'));
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
  await command({ operation: 'claim', terminalId: opened.terminalId }); const revokedContext = context();
  devices.setAdminScopes('tablet', ['catalog:write', 'workspace:read']);
  check('scope revocation releases desktop input immediately', terminal.desktopMayWrite('native-1'));
  await refuses('stale principal cannot inspect terminal after revoke', () => query(opened.terminalId, revokedContext), 'scope_not_granted');
  devices.setAdminScopes('tablet', ['catalog:write', 'workspace:read', 'terminal:control']);
  sessions.push({ ...sessions[0]!, id: 'managed', kind: 'task', runTaskId: 'task-1' }, { ...sessions[0]!, id: 'login', remoteAccessBlocked: true });
  check('managed tasks and credential-login sessions are absent from terminal inventory', (await query()).terminals.length === 1);
  const inventory = await app.remoteSessionInventory(context().principal);
  check('global session inventory includes only validated interactive workspaces', inventory.sessions.length === 1
    && inventory.sessions[0]!.agentId === selection.agentId && inventory.sessions[0]!.repositoryId === repo && inventory.sessions[0]!.id === opened.terminalId);
  check('session inventory never includes PTY ids, output, paths or control leases', !/native-1|workspaceDir|leaseId|screen|private/.test(JSON.stringify(inventory)) && starts === 1);
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
  await command({ operation: 'open', mode: 'agent' });
  check('final positive configured-agent control starts independently', starts === 2 && sessions.at(-1)!.title === 'agent');
})().catch((error) => { failed++; console.error(error); }).finally(() => {
  terminal?.dispose(); rmSync(root, { recursive: true, force: true }); console.log(`Remote terminal: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
});
