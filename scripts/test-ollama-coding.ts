import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { ConfigStore, validateCompleteConfig } from '../src/main/config/store';
import { assertIpcPayload } from '../src/main/ipcValidation';
import { RuntimeAdapterRegistry } from '../src/main/orchestration/runtimeAdapters';
import { SessionLaunchService } from '../src/main/pty/SessionLaunchService';
import { ExecutionBackendService } from '../src/main/execution/ExecutionBackendService';
import { DEFAULT_CONFIG, type Agent, type RunTask } from '../src/shared/types';
import { resolveLaunchCommand, resolveTaskLaunchCommand } from '../src/shared/runtimes';
import { exportWorkspaceBundle } from '../src/main/portability/WorkspaceBundleExporter';
import { parseSerializedWorkspaceBundle, serializeWorkspaceBundle } from '../src/shared/workspaceBundle';

let passed = 0;
function check(label: string, condition: unknown): void { assert.ok(condition, label); passed++; console.log(`  ok  ${label}`); }
const root = mkdtempSync(join(tmpdir(), 'ade-ollama-coding-'));
void (async () => {
  try {
    const agent: Agent = { id: 'local', categoryId: 'coding', name: 'Ollama', runtime: 'ollama', ollamaMode: 'coding',
      ollamaModel: 'coder:30b', permissionMode: 'default', workspaceDir: root, memoryDir: join(root, 'memory') };
    mkdirSync(agent.memoryDir);
    check('coding always selects the Ollama provider and model', resolveLaunchCommand(agent) === 'codex --oss --local-provider ollama --model coder:30b');
    check('accept edits keeps the Codex workspace sandbox', resolveLaunchCommand({ ...agent, permissionMode: 'accept-edits' }).includes('--sandbox workspace-write --ask-for-approval on-request'));
    check('bypass remains an explicit permission choice', resolveLaunchCommand({ ...agent, permissionMode: 'bypass' }).includes('--dangerously-bypass-approvals-and-sandbox'));
    check('legacy Ollama profiles keep direct model chat', resolveLaunchCommand({ ...agent, ollamaMode: undefined }) === 'ollama run coder:30b');
    check('custom commands preserve precedence', resolveLaunchCommand({ ...agent, customCommand: 'wrapper' }) === 'wrapper');
    assert.throws(() => resolveLaunchCommand({ ...agent, ollamaModel: '' }), /Select an Ollama model/);
    assert.throws(() => resolveLaunchCommand({ ...agent, ollamaModel: 'x;whoami' }), /unsafe Ollama/);
    check('missing or injecting coding model fails closed', true);
    const input = { categoryId: agent.categoryId, name: agent.name, runtime: agent.runtime, permissionMode: agent.permissionMode,
      ollamaModel: agent.ollamaModel, ollamaMode: agent.ollamaMode };
    assertIpcPayload('agent:create', input);
    assert.throws(() => assertIpcPayload('agent:create', { ...input, ollamaMode: 'arbitrary' } as never));
    assert.throws(() => assertIpcPayload('agent:create', { ...input, runtime: 'codex' }));
    check('IPC accepts only the two Ollama modes on the Ollama runtime', true);
    const config = { ...structuredClone(DEFAULT_CONFIG), categories: [{ id: agent.categoryId, name: 'Coding', agents: [agent.id] }], agents: [agent] };
    validateCompleteConfig(config);
    assert.throws(() => validateCompleteConfig({ ...config, agents: [{ ...agent, ollamaMode: 'bad' } as never] }));
    check('config refuses invalid persisted mode values', true);
    const configPath = join(root, 'config.json'); writeFileSync(configPath, JSON.stringify(config));
    const store = new ConfigStore(configPath);
    check('the coding mode survives config reload', store.get().agents[0]?.ollamaMode === 'coding');
    const exported = exportWorkspaceBundle(config, { sourcePlatform: process.platform as 'win32', includeMemory: false, includePhotos: false });
    const bundle = parseSerializedWorkspaceBundle(serializeWorkspaceBundle(exported.bundle));
    check('portable export retains the coding mode and model', bundle.agents[0]?.ollamaMode === 'coding' && bundle.agents[0]?.ollamaModel === 'coder:30b');
    for (const platform of ['win32', 'posix'] as const) {
      const task = resolveTaskLaunchCommand(agent, platform)!;
      check(`${platform} task receives the prompt on stdin with local provider flags`, task.transport === 'stdin'
        && task.command.includes('--oss --local-provider ollama --model coder:30b') && task.command.endsWith('--skip-git-repo-check -'));
    }
    const adapters = new RuntimeAdapterRegistry();
    const capability = adapters.capabilities(agent);
    check('Ollama coding has a distinct managed adapter identity', capability.adapterId === 'ollama-codex-jsonl-v1' && capability.reportsTokens && !capability.reportsCost);
    check('native Codex retains its existing adapter identity', adapters.capabilities({ ...agent, runtime: 'codex' }).adapterId === 'codex-jsonl-v1');
    const files = { taskDir: join(root, 'task'), resultPath: join(root, 'task', 'result.json'), schemaPath: join(root, 'task', 'schema.json'),
      inboxPath: join(root, 'task', 'inbox.jsonl'), outboxPath: join(root, 'task', 'outbox.jsonl') };
    const launch = adapters.prepare(agent, {} as RunTask, 'Fix the code', files, 'win32');
    check('managed coding retains schema, result and workspace contract', launch.command?.includes('--output-schema')
      && launch.command.includes('--local-provider ollama') && readFileSync(files.schemaPath, 'utf8').includes('summary'));
    let installed = true; let modelPresent = true; const backends: string[] = [];
    const execution = new ExecutionBackendService();
    execution.run = async (backend, file, args) => {
      backends.push(backend!); const models = file === 'ollama' || args.includes('ollama list');
      return { code: models || installed ? 0 : 1, stdout: Buffer.from(models ? `NAME ID SIZE MODIFIED\n${modelPresent ? 'coder:30b abc 18GB now\n' : ''}` : 'codex'), stderr: Buffer.alloc(0), timedOut: false, signal: null };
    };
    const service = new SessionLaunchService(store, execution);
    await service.validateOllamaCoding(agent, 'native');
    installed = false; await assert.rejects(service.validateOllamaCoding(agent, 'native'), /Codex CLI/);
    check('missing coding CLI is rejected before launch', true);
    installed = true; modelPresent = false; await assert.rejects(service.validateOllamaCoding(agent, 'native'), /Modell ist nicht verfügbar/);
    check('removed model is rejected before launch', true);
    modelPresent = true; await service.validateOllamaCoding(agent, 'wsl:Ubuntu');
    check('discovery follows the selected backend', backends.slice(-2).every(backend => backend === 'wsl:Ubuntu'));
    const chat = await service.effectiveSettings(agent, 'native', { mode: 'ollama', model: 'coder:30b' });
    check('fresh direct chat does not inherit a saved coding mode', chat.ollamaMode === undefined && resolveLaunchCommand(chat) === 'ollama run coder:30b');
    const profile = await service.effectiveSettings(agent, 'native', { mode: 'agent' });
    check('saved-profile launches preserve coding mode', profile.ollamaMode === 'coding');
    await service.validateOllamaCoding(agent, 'native'); check('positive launch preflight passes after dependency failures', true);
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    rmSync(root, { recursive: true, force: true });
  }
  console.log(`Ollama coding: ${passed} passed, 0 failed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
