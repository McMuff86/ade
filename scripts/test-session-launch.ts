import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { SessionLaunchService } from '../src/main/pty/SessionLaunchService';
import { ExecutionBackendService } from '../src/main/execution/ExecutionBackendService';
import { validateTerminal } from '../src/main/application/RemoteTerminalService';
import { assertIpcPayload as validateInvoke } from '../src/main/ipcValidation';
import { resolveLaunchCommand } from '../src/shared/runtimes';
import type { SessionLaunchChoice } from '../src/shared/remote';

let passed = 0;
const check = (name: string, ok: boolean) => { if (!ok) throw new Error(name); passed++; console.log(`  ok  ${name}`); };
const reject = async (name: string, fn: () => unknown) => { try { await fn(); } catch { check(name, true); return; } throw new Error(name); };
const root = mkdtempSync(join(tmpdir(), 'ade-launch-'));
void (async () => {
  const { store } = createRemoteWorkspaceFixture(root);
  let models = 'NAME    ID    SIZE    MODIFIED\nfixture:small abc 1GB today\nfixture:large def 2GB today\n';
  let available = true; const calls: Array<{ backend: string | undefined; file: string; args: string[] }> = [];
  const execution = new ExecutionBackendService();
  execution.run = async (backend, file, args) => { calls.push({ backend, file, args });
    return { code: available ? 0 : 1, stdout: Buffer.from(file === 'ollama' || args[1] === 'ollama list' ? models : 'fixture'), stderr: Buffer.alloc(0), timedOut: false, signal: null }; };
  const service = new SessionLaunchService(store, execution);
  const original = { ...store.get().agents.find((a) => a.id === 'builder')!, runtime: 'custom' as const, permissionMode: 'bypass' as const,
    customCommand: 'general --tui', codexModel: 'pinned', codexReasoningEffort: 'high' as const };
  store.save({ agents: store.get().agents.map((a) => a.id === original.id ? original : a) });
  const before = JSON.stringify(store.get().agents);
  const selection = { agentId: original.id, repositoryId: null };
  const options = await service.options(selection);
  check('all fixed choices discovered without launching models', options.choices.every((c) => c.available) && options.models.join(',') === 'fixture:small,fixture:large');
  check('discovery uses only fixed read-only commands', calls.every((c) => c.args.length === 1 && ['list', 'hermes', 'codex'].includes(c.args[0]!)
    || c.file === '/bin/bash' && c.args[0] === '-lc' && ['command -v codex', 'command -v hermes', 'ollama list'].includes(c.args[1]!)));
  const shell = await service.effectiveAgent(original, 'native', { mode: 'shell' });
  check('empty terminal drops configured command and bypass', shell.runtime === 'shell' && shell.permissionMode === 'default' && resolveLaunchCommand(shell) === '');
  const profile = await service.effectiveAgent(original, 'native', { mode: 'agent' });
  check('configured profile preserves Hermes wrapper and permissions', resolveLaunchCommand(profile) === 'general --tui' && profile.permissionMode === 'bypass');
  const codex = await service.effectiveAgent(original, 'native', { mode: 'codex' });
  check('fresh Codex uses its defaults without foreign model pins', resolveLaunchCommand(codex) === 'codex' && codex.runtime === 'codex');
  const hermes = await service.effectiveAgent(original, 'native', { mode: 'hermes' });
  check('fresh Hermes uses the fixed interactive entrypoint', resolveLaunchCommand(hermes) === 'hermes' && hermes.permissionMode === 'default');
  const ollama = await service.effectiveAgent(original, 'native', { mode: 'ollama', model: 'fixture:large' });
  check('selected available model reaches fixed Ollama command', resolveLaunchCommand(ollama) === 'ollama run fixture:large');
  check('per-session choices never mutate saved agent', JSON.stringify(store.get().agents) === before);
  models = 'NAME ID SIZE MODIFIED\nfixture:small abc 1GB today\n';
  await reject('removed model is revalidated before launch', () => service.effectiveAgent(original, 'native', { mode: 'ollama', model: 'fixture:large' }));
  available = false;
  check('missing CLI and models are honest unavailable choices', (await service.options(selection)).choices.filter((c) => c.available).map((c) => c.mode).join(',') === 'shell,agent');
  await reject('missing Codex fails closed', () => service.effectiveAgent(original, 'native', { mode: 'codex' }));
  check('configured wrapper can still launch when discovery unavailable', (await service.effectiveAgent(original, 'native', { mode: 'agent' })).customCommand === original.customCommand);
  available = true; models = 'NAME ID SIZE MODIFIED\nfixture:small abc 1GB today\nbad;command def 1GB today\n';
  check('unsafe model names are omitted from discovery', (await service.options(selection)).models.join(',') === 'fixture:small');
  for (const bad of [{ mode: 'custom', command: 'evil' }, { mode: 'ollama', model: 'a;evil' }, { mode: 'ollama' }, { mode: 'codex', model: 'pin' }]) {
    await reject('desktop refuses unsafe or ambiguous launch', () => validateInvoke('session:launch', { ...selection, ...bad }));
    await reject('remote refuses unsafe or ambiguous launch', () => validateTerminal({ ...selection, operation: 'open', ...bad }, 'command'));
  }
  await reject('main refuses bypass of typed selection', () => service.effectiveAgent(original, 'native', { mode: 'ollama', model: 'a;evil' } as SessionLaunchChoice));
  await reject('desktop refuses client workspace path', () => validateInvoke('session:launch', { ...selection, mode: 'shell', workspaceDir: root }));
  check('desktop restart may carry its exact existing binding', (() => { validateInvoke('session:launch', { ...selection, repositoryId: 'project', mode: 'shell', workspaceBindingId: 'binding' }); return true; })());
  await reject('remote launch still refuses a caller-owned binding', () => validateTerminal({ ...selection, operation: 'open', mode: 'shell', workspaceBindingId: 'binding' }, 'command'));
  await reject('options require explicit home null', () => validateInvoke('session:options', { agentId: original.id }));
  store.save({ agents: store.get().agents.map((a) => a.id === original.id ? { ...a, homeExecutionBackend: 'wsl:Ubuntu-24.04' } : a) });
  calls.length = 0; const wsl = await service.options(selection);
  check('home discovery follows WSL backend rather than native PATH', wsl.environment === 'wsl:Ubuntu-24.04' && calls.every((c) => c.backend === 'wsl:Ubuntu-24.04'));
  check('final positive model launch remains valid', (await service.effectiveAgent(original, 'wsl:Ubuntu-24.04', { mode: 'ollama', model: 'fixture:small' })).ollamaModel === 'fixture:small');
  console.log(`Session launch: ${passed} passed, 0 failed`);
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => rmSync(root, { recursive: true, force: true }));
