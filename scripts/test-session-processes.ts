/** Native PTYs through the real ADE supervisor. Complements, never replaces, the UI driver. */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, type Agent } from '../src/shared/types';
import { posixProfileFixture } from './helpers/posixProfileFixture';

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
    // H1b: clients are reached only through host ports.
    const { NO_HOST_NOTIFIER } = await import('../src/main/host/ports');
    const emitted: Array<{ channel: string; sessionId?: string }> = []; const exitNotices: string[] = [];
    manager.setClientPorts({ emit: (channel, payload) => emitted.push({ channel, sessionId: (payload as { sessionId?: string } | null)?.sessionId }) },
      { ...NO_HOST_NOTIFIER, sessionExit: (meta) => exitNotices.push(meta.id) });
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
    check('PTY output reaches clients only through the HostEvents port, per session', sessions.every(session =>
      emitted.some(event => event.channel === 'pty:data' && event.sessionId === session.id)));
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
    await until('exit notice through the HostNotifier port', () => exitNotices.includes(first.id));
    check('a session exit notice goes through the HostNotifier port exactly once', exitNotices.filter(id => id === first.id).length === 1);
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
    if (process.platform === 'linux') {
      const bin = join(root, 'bin'); const proofs = join(root, 'proofs'); mkdirSync(proofs);
      posixProfileFixture(bin);
      const startupMarker = join(root, 'STARTUP_MUST_NOT_RUN'); const startup = join(root, 'bash-env');
      writeFileSync(startup, `printf BAD > '${startupMarker}'\n`);
      const originalEnv = { ...process.env };
      Object.assign(process.env, { PATH: `${bin}:${process.env.PATH}`, ADE_PROFILE_FIXTURE_PROOFS: proofs, BASH_ENV: startup });
      const cliAgents: Agent[] = ['codex', 'claude', 'grok'].map((runtime, i) => ({ ...agents[i]!, runtime: runtime as Agent['runtime'], customCommand: '' }));
      store.save({ agents: cliAgents });
      const known = new Set<string>();
      type Proof = { cli: string; inputFile: string; pid: number };
      const proof = async (cli: string): Promise<Proof> => {
        let result: Proof | undefined;
        await until('native CLI fixture proof', () => {
          for (const name of readdirSync(proofs).filter(name => name.endsWith('.json') && !known.has(name))) {
            const item = JSON.parse(readFileSync(join(proofs, name), 'utf8')) as Proof;
            if (item.cli === cli) { known.add(name); result = item; return true; }
          }
          return false;
        }); return result!;
      };
      try {
        const protectedSessions = [];
        for (const agent of cliAgents) {
          const session = await manager.createRemoteInteractive(agent.id, null, undefined, 'agent');
          const evidence = await proof(agent.runtime); protectedSessions.push({ session, evidence });
          await until('protected paste ready', () => manager!.promptCapability(session.id).available);
          const text = 'Diktat: Prüfe "Zeile eins".\nDann ä 漢字 und $dollar.';
          const request = { sessionId: session.id, commandId: randomUUID(), text, mode: 'submit' as const };
          await manager.deliverPrompt(request, () => undefined);
          const expected = `\x1b[200~${text}\x1b[201~\r`;
          await until('exact multiline prompt received', () => readFileSync(evidence.inputFile, 'utf8') === expected);
          check(`${agent.runtime}: native PTY receives one exact multiline paste and one separate Enter`, true);
          await manager.deliverPrompt(request, () => undefined);
          check(`${agent.runtime}: receipt replay cannot duplicate prompt delivery`, readFileSync(evidence.inputFile, 'utf8') === expected);
          manager.write(session.id, Buffer.from('DIRECT'));
          await until('direct input after prompt', () => readFileSync(evidence.inputFile, 'utf8').endsWith('DIRECT'));
        }
        check('protected native launches ignore inherited Bash startup hooks', !existsSync(startupMarker));
        const first = protectedSessions[0]!; writeFileSync(first.evidence.inputFile, '');
        let authorizations = 0; let refusal = '';
        try {
          await manager.deliverPrompt({ sessionId: first.session.id, commandId: randomUUID(), text: 'revoked', mode: 'submit' }, () => {
            if (++authorizations >= 4) throw new Error('ownership revoked');
          });
        } catch (error) { refusal = String(error); }
        check('ownership lost during real PTY settle refuses the delayed Enter', refusal.includes('ownership revoked')
          && readFileSync(first.evidence.inputFile, 'utf8') === '\x1b[200~revoked\x1b[201~');
        const after = { sessionId: first.session.id, commandId: randomUUID(), text: 'positive-after-revocation', mode: 'insert' as const };
        await manager.deliverPrompt(after, () => undefined);
        await until('positive insertion after revoked delivery', () => readFileSync(first.evidence.inputFile, 'utf8').includes(after.text));
        check('another authorized insertion succeeds after revocation without Enter', !readFileSync(first.evidence.inputFile, 'utf8').endsWith('\r'));
        for (const { session, evidence } of protectedSessions) {
          manager.write(session.id, Buffer.from([4]));
          await until('protected CLI and wrapper exit', () => manager!.getSessionMeta(session.id)?.status === 'exited');
          check(`${evidence.cli}: CLI exit ends its PTY with the original code and disables prompt delivery`, manager.getSessionMeta(session.id)?.exitCode === 7
            && !manager.promptCapability(session.id).available);
        }
        process.env.ADE_FIXTURE_EXIT_ON_PASTE = '1';
        const session = await manager.createRemoteInteractive(cliAgents[0]!.id, null, undefined, 'agent');
        const evidence = await proof('codex');
        delete process.env.ADE_FIXTURE_EXIT_ON_PASTE;
        await until('exiting CLI ready', () => manager!.promptCapability(session.id).available);
        const marker = join(root, 'DELAYED_PROMPT_MUST_NOT_EXECUTE');
        const dangerous = `printf WRONG > '${marker}'`;
        refusal = '';
        try { await manager.deliverPrompt({ sessionId: session.id, commandId: randomUUID(), text: dangerous, mode: 'submit' }, () => undefined); }
        catch (error) { refusal = String(error); }
        check('CLI exit during the real settle window rejects completion and never runs a shell command', !!refusal
          && !existsSync(marker) && readFileSync(evidence.inputFile, 'utf8') === `\x1b[200~${dangerous}\x1b[201~`);
        manager.disposeAll();
      } finally {
        for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
        Object.assign(process.env, originalEnv);
      }
    }
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
