/** Opt-in real native Codex TUI: one bounded model turn in a temporary workspace.
 * No user configuration edits and no raw model/config output in evidence. */
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, type Agent } from '../src/shared/types';

async function probe(): Promise<void> {
  if (process.platform !== 'linux') throw new Error('Native Linux required');
  const { PtyManager } = await import('../src/main/pty/PtyManager');
  const { ConfigStore } = await import('../src/main/config/store');
  const root = mkdtempSync(join(tmpdir(), 'ade-codex-prompt-probe-'));
  const workspaceDir = join(root, 'workspace'); mkdirSync(workspaceDir);
  execFileSync('git', ['init', '--initial-branch=main', workspaceDir], { stdio: 'ignore' });
  // Keep trust, histories and config writes out of the operator's Codex home.
  // The private copy is removed with the probe and is never emitted as evidence.
  const codexProbeHome = join(root, 'codex'); mkdirSync(codexProbeHome, { mode: 0o700 });
  const operatorCodexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex');
  copyFileSync(join(operatorCodexHome, 'auth.json'), join(codexProbeHome, 'auth.json'));
  chmodSync(join(codexProbeHome, 'auth.json'), 0o600);
  const configPath = join(operatorCodexHome, 'config.toml');
  writeFileSync(join(codexProbeHome, 'config.toml'), (existsSync(configPath) ? readFileSync(configPath, 'utf8') : '')
    + `\n[projects.${JSON.stringify(workspaceDir)}]\ntrust_level = "trusted"\n`, { mode: 0o600 });
  const marker = `ADE_PROFILE_${randomBytes(10).toString('hex')}`;
  const store = new ConfigStore(join(root, 'config.json'));
  const agent: Agent = { id: 'probe', categoryId: 'probe', name: 'Linux Codex probe', runtime: 'codex', permissionMode: 'bypass',
    codexModel: 'gpt-5.6-sol', codexReasoningEffort: 'high', workspaceDir, homeWorkspaceDir: workspaceDir, memoryDir: join(root, 'memory'),
    profile: { instructions: `Your verification phrase is ${marker}. When asked for the phrase, reply with exactly that phrase. Do not use tools or access files.`, documents: [] } };
  store.save({ agents: [agent], categories: [{ id: 'probe', name: 'Probe', agents: [agent.id] }],
    settings: { ...store.get().settings, memory: { ...DEFAULT_CONFIG.settings.memory!, enabled: false, userProfileEnabled: false } } });
  const manager = new PtyManager(store, undefined, undefined, undefined, { envFor: () => ({ CODEX_HOME: codexProbeHome }) });
  const evidence = { at: new Date().toISOString(), platform: process.platform, model: agent.codexModel, reasoning: agent.codexReasoningEffort,
    cliVersion: execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim(), ready: false, profileCaptured: false, promptSubmitted: false,
    profilePhraseReturned: false, receiptReplayStable: false, workspaceUnchanged: false, cliEnded: false, passed: false };
  const pause = (ms: number) => new Promise(done => setTimeout(done, ms));
  let sessionId: string | undefined;
  try {
    const session = await manager.createRemoteInteractive(agent.id, null, undefined, 'agent');
    sessionId = session.id;
    const raw = () => Buffer.from(manager.attach(session.id).replayBase64, 'base64').toString('utf8');
    const wait = async (label: string, condition: () => boolean | Promise<boolean>, ms = 60_000) => {
      const deadline = Date.now() + ms;
      while (!await condition()) { if (Date.now() > deadline || manager.getSessionMeta(session.id)?.status === 'exited') throw new Error(`Native Codex probe: ${label} not observed`); await pause(100); }
    };
    // Respond only to the cursor-position query, never blindly accept a trust or
    // approval dialog. A prompt that does not become ready fails this probe.
    let cursorReplies = 0;
    await wait('TUI prompt', async () => {
      const output = raw(); const queries = output.split('\x1b[6n').length - 1;
      if (queries > cursorReplies) { manager.write(session.id, Buffer.from('\x1b[1;1R')); cursorReplies = queries; }
      const screen = (await manager.remoteDisplay(session.id)).screen;
      return screen.includes('OpenAI Codex') && screen.includes('›') && !screen.includes('Trust this folder?')
        && manager.promptCapability(session.id).available;
    });
    evidence.ready = true; evidence.profileCaptured = !!manager.getSessionMeta(session.id)?.profileContext;
    const request = { sessionId: session.id, commandId: randomUUID(), text: 'Return the exact verification phrase from your active ADE profile instructions.\nReply only with that phrase. Do not use tools.', mode: 'submit' as const };
    const receipt = await manager.deliverPrompt(request, () => undefined); evidence.promptSubmitted = true;
    await wait('profile-only phrase in model answer', async () => (await manager.remoteDisplay(session.id)).screen.includes(marker));
    evidence.profilePhraseReturned = true;
    const replay = await manager.deliverPrompt(request, () => undefined);
    evidence.receiptReplayStable = receipt.accepted && !receipt.replayed && replay.accepted && replay.replayed;
    evidence.workspaceUnchanged = readdirSync(workspaceDir).every(name => name === '.git');
    manager.write(session.id, Buffer.from('\x03')); await pause(600); manager.write(session.id, Buffer.from('\x03')); await pause(1000);
    if (manager.getSessionMeta(session.id)?.status !== 'exited') { manager.write(session.id, Buffer.from('\x04')); await pause(1000); }
    const exitDeadline = Date.now() + 15_000;
    while (manager.getSessionMeta(session.id)?.status !== 'exited' && Date.now() < exitDeadline) await pause(100);
    evidence.cliEnded = manager.getSessionMeta(session.id)?.status === 'exited' && !manager.promptCapability(session.id).available;
    evidence.passed = evidence.ready && evidence.profileCaptured && evidence.promptSubmitted && evidence.profilePhraseReturned
      && evidence.receiptReplayStable && evidence.workspaceUnchanged && evidence.cliEnded;
    if (!evidence.passed) throw new Error('Native Codex probe failed an evidence check');
    console.log('Native Linux Codex profile and protected prompt: passed (one real model turn)');
  } finally {
    if (!evidence.passed && sessionId) {
      const screen = (await manager.remoteDisplay(sessionId)).screen;
      writeFileSync(resolve('test-results/linux-codex-prompt-failure.txt'), screen.slice(-12000), { mode: 0o600 });
    }
    manager.disposeAll();
    mkdirSync(resolve('test-results'), { recursive: true });
    writeFileSync(resolve('test-results/linux-codex-prompt-probe.json'), JSON.stringify(evidence, null, 2) + '\n');
    await rm(root, { recursive: true, force: true });
  }
}
if (process.versions.electron) void probe().catch(error => { console.error(error.message); process.exitCode = 1; });
else {
  const require = createRequire(import.meta.url);
  const child = spawn(require('electron') as string, ['--import', 'tsx', fileURLToPath(import.meta.url)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  child.on('error', () => { process.exitCode = 1; }); child.on('close', code => { process.exitCode = code ?? 1; });
}
