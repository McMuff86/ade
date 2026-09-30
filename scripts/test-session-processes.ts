/** Native PTYs through the real ADE supervisor. Complements, never replaces, the UI driver. */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, type Agent } from '../src/shared/types';

async function nativeSessions(): Promise<void> {
  const { PtyManager } = await import('../src/main/pty/PtyManager');
  const { ConfigStore } = await import('../src/main/config/store');
  const root = mkdtempSync(join(tmpdir(), 'ade-native-sessions-'));
  let manager: InstanceType<typeof PtyManager> | undefined;
  let passed = 0;
  const check = (name: string, condition: boolean): void => {
    if (!condition) throw new Error(name);
    passed++; console.log(`  ok  ${name}`);
  };
  const until = async (name: string, condition: () => boolean): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while (!condition()) {
      if (Date.now() >= deadline) throw new Error(`${name}: timed out`);
      await new Promise(done => setTimeout(done, 25));
    }
  };
  try {
    const fixture = join(root, 'interactive.cjs');
    // The PID and counter come from the actual child, so even sibling sessions
    // in one directory cannot share a successful response accidentally.
    writeFileSync(fixture, `
const readline = require('node:readline');
console.log('ADE_READY_' + process.pid);
let count = 0;
readline.createInterface({input:process.stdin}).on('line', line => {
  if (line === 'EXIT') { process.exit(7); return; }
  console.log('ADE_REPLY_' + process.pid + '_' + (++count) + '_' + line);
});
`);
    const quote = (value: string) => `'${value.replace(/'/g, process.platform === 'win32' ? "''" : "'\\''")}'`;
    const command = `${process.platform === 'win32' ? '& ' : ''}${quote(process.execPath)} ${quote(fixture)}`;
    const agents: Agent[] = ['A', 'B', 'C'].map(name => {
      const workspaceDir = join(root, `workspace-${name}`); mkdirSync(workspaceDir);
      return { id: name, categoryId: 'fixtures', name, runtime: 'custom', permissionMode: 'default',
        customCommand: command, workspaceDir, homeWorkspaceDir: workspaceDir, memoryDir: join(root, `memory-${name}`) };
    });
    const store = new ConfigStore(join(root, 'config.json'));
    store.save({ agents, categories: [{ id: 'fixtures', name: 'Fixtures', agents: agents.map(agent => agent.id) }],
      settings: { ...store.get().settings, memory: { ...DEFAULT_CONFIG.settings.memory!, enabled: false, userProfileEnabled: false } } });
    manager = new PtyManager(store);
    const sessions = [];
    for (const agentId of ['A', 'B', 'C', 'A']) sessions.push(await manager.createRemoteInteractive(agentId, null, undefined, 'agent'));
    const output = (id: string) => Buffer.from(manager!.attach(id).replayBase64, 'base64').toString('utf8');
    const pids: string[] = [];
    for (const session of sessions) {
      await until('fixture ready', () => /ADE_READY_\d+/.test(output(session.id)) && manager!.getSessionMeta(session.id)?.program?.status === 'running');
      pids.push(/ADE_READY_(\d+)/.exec(output(session.id))![1]!);
    }
    check('four ADE sessions own four distinct native processes', new Set(pids).size === 4 && new Set(sessions.map(session => session.id)).size === 4);
    check('sibling processes share a workspace but keep separate sessions', sessions[0]!.workspaceDir === sessions[3]!.workspaceDir
      && sessions[0]!.id !== sessions[3]!.id);
    const identity = manager.list().map(session => session.id).join(',');
    for (let round = 1; round <= 2; round++) {
      for (const [index, session] of sessions.entries()) {
        const token = `target-${index}-round-${round}`;
        manager.write(session.id, Buffer.from(token + '\r'));
        await until('process-specific reply', () => output(session.id).includes(`ADE_REPLY_${pids[index]}_${round}_${token}`));
        check(`session ${index} round ${round} reaches only its own process`, sessions.every((other, otherIndex) => otherIndex === index || !output(other.id).includes(token)));
        // Reattach is a read: it must preserve both identity and invocation.
        manager.attach(session.id);
      }
    }
    check('reattaching preserves all session identities and live programs', manager.list().map(session => session.id).join(',') === identity
      && manager.list().every(session => session.program?.status === 'running'));
    const first = sessions[0]!;
    manager.write(first.id, Buffer.from('EXIT\r'));
    await until('tracked invocation exit', () => manager!.getSessionMeta(first.id)?.program?.status === 'exited');
    check('CLI exit is distinct from its custom wrapper shell remaining open', manager.getSessionMeta(first.id)?.status === 'running'
      && manager.getSessionMeta(first.id)?.program?.exitCode === 7);
    check('custom sessions never gain protected prompt capability', !manager.promptCapability(first.id).available
      && sessions.slice(1).every(session => !manager!.promptCapability(session.id).available));
    manager.kill(first.id);
    await until('target session removed', () => !manager!.getSessionMeta(first.id));
    check('ending one session preserves its sibling and the other workspaces', manager.list().length === 3
      && sessions.slice(1).every(session => manager!.getSessionMeta(session.id)?.program?.status === 'running'));
    const sibling = sessions[3]!;
    manager.write(sibling.id, Buffer.from('after-sibling-exit\r'));
    await until('sibling positive control', () => output(sibling.id).includes(`ADE_REPLY_${pids[3]}_3_after-sibling-exit`));
    check('final positive control continues in the original sibling process', true);
    manager.disposeAll();
    check('supervisor shutdown clears its entire session inventory', manager.list().length === 0);
    const childAlive = (pid: string): boolean => {
      try { process.kill(Number(pid), 0); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
    };
    await until('all fixture children exit', () => pids.every(pid => !childAlive(pid)));
    check('shutdown leaves no fixture child process running', true);
    console.log(`Native session processes (${process.platform}): ${passed} passed, 0 failed`);
  } catch (error) {
    console.error(error);
    console.log(`Native session processes (${process.platform}): ${passed} passed, 1 failed`);
    process.exitCode = 1;
  } finally {
    manager?.disposeAll();
    await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
  }
}

if (process.versions.electron) {
  void nativeSessions().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  // node-pty must run against the Electron ABI used by ADE, never be rebuilt for
  // the test runner's Node. This mode needs no BrowserWindow or network listener.
  const require = createRequire(import.meta.url);
  const child = spawn(require('electron') as string, ['--import', 'tsx', fileURLToPath(import.meta.url)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', windowsHide: true,
  });
  const timeout = setTimeout(() => { console.error('Native session process test timed out'); child.kill(); process.exitCode = 1; }, 90_000);
  child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
  child.on('close', code => { clearTimeout(timeout); if (code !== 0) process.exitCode = 1; });
}
