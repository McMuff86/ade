import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync, existsSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { RemoteApiError, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import { validateTerminal, RemoteTerminalService } from '../src/main/application/RemoteTerminalService';
import type { SessionMeta } from '../src/shared/types';
import type { ExecutionBackendId } from '../src/shared/executionBackends';

let passed = 0;
const check = (name: string, ok: boolean) => { if (!ok) throw new Error(name); passed++; console.log(`  ok  ${name}`); };
const reject = async (name: string, fn: () => unknown, code = 'command_rejected') => {
  try { await fn(); } catch (error) { check(name, error instanceof RemoteApiError && error.code === code); return; } throw new Error(name);
};
const root = mkdtempSync(join(tmpdir(), 'ade-home-'));
void (async () => {
  const fixture = createRemoteWorkspaceFixture(root); const { store, devices, workbench, application: app, sessions } = fixture;
  const wsl = process.argv.includes('--wsl');
  const backend: ExecutionBackendId = wsl ? 'wsl:Ubuntu-24.04' : 'native';
  const home = wsl ? `/tmp/ade-home-${randomUUID()}` : join(root, 'home');
  const execution = workbench.execution;
  const write = async (path: string, text: string) => {
    if (!wsl) { writeFileSync(join(home, path), text); return; }
    await execution.checked(backend, 'python3', ['-I', '-c', 'import sys,json,pathlib; p=json.load(sys.stdin); pathlib.Path(p["path"]).write_bytes(p["text"].encode())'],
      { input: JSON.stringify({ path: `${home}/${path}`, text }) });
  };
  let terminal: RemoteTerminalService | undefined;
  try {
    store.save({ agents: store.get().agents.map((a) => a.id === 'builder' ? { ...a, homeWorkspaceDir: wsl ? `${home}/` : home, homeExecutionBackend: backend } : a) });
    devices.enroll('tablet', 'Tablet', 'd'.repeat(40)); devices.setAdminScopes('tablet', ['workspace:read', 'workspace:write', 'terminal:control']);
    const context = (): RemoteCommandContext => ({ principal: { id: 'tablet', kind: 'device', proof: 'device-signature', scopes: new Set(devices.activeDevices()[0]!.scopes) }, idempotencyKey: randomUUID(), requestId: 'home' });
    const selection = { agentId: 'builder', repositoryId: null };
    const query = (operation: Record<string, unknown>) => app.queryWorkspace(context(), { ...selection, ...operation });
    check('explicit home terminal selection is valid', !!validateTerminal({ ...selection }, 'query'));
    await reject('omitted repository is not implicit home', () => app.queryWorkspace(context(), { agentId: 'builder', operation: 'overview' }), 'invalid_payload');
    check('missing home overview does not create directories', !(await query({ operation: 'overview' })).overview!.ready);
    if (!wsl) check('native read leaves home absent', !existsSync(home));
    terminal = new RemoteTerminalService(workbench, {
      list: () => sessions,
      create: async (agentId, repositoryId, bindingId, mode) => {
        const session: SessionMeta = { id: randomUUID(), agentId, repositoryId: repositoryId ?? undefined, workspaceBindingId: bindingId,
          workspaceDir: home, executionBackend: backend, kind: 'interactive', title: mode, status: 'running', createdAt: Date.now() }; sessions.push(session); return session;
      }, attach: () => ({ replayBase64: Buffer.from('HOME_READY').toString('base64'), sequence: 1 }), write: () => undefined, resize: () => undefined,
      kill: (id) => { sessions.find((s) => s.id === id)!.status = 'exited'; },
    }, () => true, () => undefined);
    const opened = await terminal.command('tablet', { ...selection, operation: 'open', mode: 'shell' });
    check('explicit terminal open prepares home without Git binding', !!opened.terminalId && store.get().workspaceBindings.length === 0);
    check('projectless session can reconnect', (await terminal.query('tablet', { ...selection, terminalId: opened.terminalId })).screen!.includes('HOME_READY'));
    await write('notes.txt', '\uFEFForiginal\r\n');
    const file = await query({ operation: 'file', path: 'notes.txt' });
    const save = { ...selection, path: 'notes.txt', workspaceVersion: file.workspaceVersion, revision: file.file!.revision, text: 'edited\n' };
    await reject('home edit fenced by live terminal', () => app.saveWorkspaceFile(context(), save));
    await terminal.command('tablet', { ...selection, operation: 'close', terminalId: opened.terminalId });
    sessions.push({ id: 'unrelated', agentId: 'reviewer', title: 'Other home', kind: 'interactive', status: 'running', createdAt: Date.now(), workspaceDir: wsl ? '/tmp/unrelated' : join(root, 'other'), executionBackend: backend });
    check('unrelated home session does not block edit', (await app.saveWorkspaceFile(context(), save)).saved);
    check('home save retains BOM and CRLF', (await query({ operation: 'file', path: 'notes.txt' })).file!.text === '\uFEFFedited\r\n');
    check('stale home edit reports conflict', !(await app.saveWorkspaceFile(context(), save)).saved);
    check('home overview has no fabricated Git status', (await query({ operation: 'overview' })).overview!.branch === '');
    await reject('Git diff requires explicit project', () => query({ operation: 'diff', path: 'notes.txt', staged: false }));
    await write('.env', 'secret'); await write('huge.txt', 'x'.repeat(25 * 1024)); await write('redacted.txt', 'C:\\private\\path');
    check('home tree hides secret files', !(await query({ operation: 'tree', path: '' })).entries!.some((e) => e.path === '.env'));
    check('home filename search works', (await query({ operation: 'search', search: 'notes' })).entries!.length === 1);
    check('home read is bounded', (await query({ operation: 'file', path: 'huge.txt' })).file!.text === '');
    check('home redacted text is read-only', !(await query({ operation: 'file', path: 'redacted.txt' })).file!.editable);
    await reject('home traversal fails closed', () => query({ operation: 'file', path: '../outside' }));
    if (wsl) {
      await execution.checked(backend, 'ln', ['-s', '/etc', `${home}/linked`]);
      await execution.checked(backend, 'ln', [`${home}/notes.txt`, `${home}/hard.txt`]);
    } else {
      mkdirSync(join(root, 'outside')); writeFileSync(join(root, 'outside', 'passwd'), 'private');
      symlinkSync(join(root, 'outside'), join(home, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
      linkSync(join(home, 'notes.txt'), join(home, 'hard.txt'));
    }
    await reject('home directory link cannot escape', () => query({ operation: 'file', path: 'linked/passwd' }));
    await reject('home hardlink is refused', () => query({ operation: 'file', path: 'hard.txt' }));
    const scope = (await workbench.resolve(selection))!;
    if (wsl) { await execution.checked(backend, 'mv', [home, `${home}-old`]); await execution.checked(backend, 'mkdir', [home]); }
    else { renameSync(home, `${home}-old`); mkdirSync(home); }
    await reject('replaced home directory invalidates resolved scope', () => workbench.revalidate(scope));
    check('replacement cannot inherit an old terminal', (await terminal.query('tablet', selection)).terminals.length === 0);
    await write('positive.txt', 'final positive');
    check('final positive read uses current home', (await query({ operation: 'file', path: 'positive.txt' })).file!.text === 'final positive');
  } finally {
    terminal?.dispose();
    if (wsl && /^\/tmp\/ade-home-[a-f0-9-]+$/.test(home)) await execution.checked(backend, 'python3', ['-I', '-c',
      'import sys,json,shutil; p=json.load(sys.stdin); [shutil.rmtree(x,ignore_errors=True) for x in p]'], { input: JSON.stringify([home, `${home}-old`]) });
    else if (!wsl && existsSync(`${home}-old`)) rmSync(`${home}-old`, { recursive: true, force: true });
  }
  console.log(`Home workspace${wsl ? ' WSL' : ''}: ${passed} passed, 0 failed`);
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => rmSync(root, { recursive: true, force: true }));
