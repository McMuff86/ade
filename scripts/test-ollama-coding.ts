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
import { QwenActivityParser, qwenTerminalResult } from '../src/main/orchestration/qwenStream';

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
    let installed = true; let modelPresent = true; const backends: string[] = []; let modelHost: string | undefined;
    const execution = new ExecutionBackendService();
    execution.run = async (backend, file, args, options) => {
      backends.push(backend!); const models = file === 'ollama' || args.includes('ollama list');
      if (models) modelHost = options?.env?.OLLAMA_HOST;
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
    const qwen: Agent = { ...agent, ollamaHarness: 'qwen-code' };
    const qwenCommand = resolveLaunchCommand(qwen);
    check('Qwen pins auth, local endpoint, public placeholder and chosen model per launch', qwenCommand === 'qwen --auth-type openai --openai-base-url http://127.0.0.1:11434/v1 --openai-api-key ollama --model coder:30b --approval-mode default');
    check('Qwen permission choices are explicit', resolveLaunchCommand({ ...qwen, permissionMode: 'accept-edits' }).endsWith('--approval-mode auto-edit')
      && resolveLaunchCommand({ ...qwen, permissionMode: 'bypass' }).endsWith('--approval-mode yolo'));
    check('chat ignores a previously selected coding harness', resolveLaunchCommand({ ...qwen, ollamaMode: 'chat' }) === 'ollama run coder:30b');
    assert.throws(() => resolveLaunchCommand({ ...qwen, ollamaModel: '$(bad)' }));
    assert.throws(() => resolveLaunchCommand({ ...qwen, ollamaHarness: 'other' } as never));
    check('invalid harness or model cannot reach a shell', true);
    assertIpcPayload('agent:create', { ...input, ollamaHarness: 'qwen-code' });
    const { categoryId: _categoryId, ...updateInput } = input;
    assertIpcPayload('agent:update', { ...updateInput, id: agent.id, ollamaHarness: 'qwen-code' });
    assertIpcPayload('agentTemplate:spawn', { templateId: 'template', categoryId: 'coding', ollamaHarness: 'qwen-code' });
    for (const ollamaHarness of ['other', {}, 1]) assert.throws(() => assertIpcPayload('agent:create', { ...input, ollamaHarness } as never));
    assert.throws(() => assertIpcPayload('agent:create', { ...input, runtime: 'codex', ollamaMode: undefined, ollamaHarness: 'qwen-code' }));
    check('all profile IPC contracts validate the harness and runtime', true);
    const qwenConfig = { ...config, agents: [qwen] };
    validateCompleteConfig(qwenConfig);
    assert.throws(() => validateCompleteConfig({ ...config, agents: [{ ...qwen, ollamaHarness: 'other' } as never] }));
    assert.throws(() => validateCompleteConfig({ ...config, agents: [{ ...qwen, runtime: 'shell', ollamaMode: undefined }] }));
    writeFileSync(configPath, JSON.stringify(qwenConfig));
    check('Qwen harness survives durable reload and rejects invalid config', new ConfigStore(configPath).get().agents[0]?.ollamaHarness === 'qwen-code');
    const qwenBundle = exportWorkspaceBundle(qwenConfig, { sourcePlatform: process.platform as 'win32', includeMemory: false, includePhotos: false }).bundle;
    check('Qwen harness survives portable export and parsing', parseSerializedWorkspaceBundle(serializeWorkspaceBundle(qwenBundle)).agents[0]?.ollamaHarness === 'qwen-code');
    assert.throws(() => parseSerializedWorkspaceBundle(JSON.stringify({ ...qwenBundle, agents: [{ ...qwenBundle.agents[0], ollamaHarness: 'bad' }] })));
    check('portable imports refuse unknown harness choices', true);
    for (const platform of ['win32', 'posix'] as const) {
      const launch = adapters.prepare(qwen, {} as RunTask, 'Quotes " and $ stay in stdin', files, platform);
      check(`${platform} Qwen tasks use stdin, stream events and the schema file`, launch.transport === 'stdin'
        && launch.command?.startsWith(platform === 'win32' ? '$env:ADE_TASK_PROMPT | qwen ' : `printf '%s\\n' "$ADE_TASK_PROMPT" | qwen `)
        && launch.command.includes('--json-schema') && !launch.command.includes('Quotes') && launch.activityFormat === 'qwen-stream-json');
      check(`${platform} non-managed Qwen tasks also select the correct harness`, resolveTaskLaunchCommand(qwen, platform)?.activityFormat === 'qwen-stream-json');
    }
    check('Qwen coding remains distinct from native Codex and the Ollama Codex adapter', adapters.capabilities(qwen).adapterId === 'ollama-qwen-stream-json-v1');
    check('custom Qwen commands retain the generic adapter', adapters.capabilities({ ...qwen, customCommand: 'wrapper' }).adapterId === 'file-mailbox-v1');
    installed = false; await assert.rejects(service.validateOllamaCoding(qwen, 'native'), /Qwen Code/);
    check('missing Qwen never silently falls back to installed Codex', true);
    installed = true; await service.validateOllamaCoding(qwen, 'native');
    check('Qwen preflight checks the same local Ollama endpoint as its invocation', modelHost === 'http://127.0.0.1:11434');
    check('saved PC and tablet profile selection preserves the Qwen harness', (await service.effectiveSettings(qwen, 'native', { mode: 'agent' })).ollamaHarness === 'qwen-code');
    check('direct starts clear the saved coding harness', (await service.effectiveSettings(qwen, 'native', { mode: 'ollama', model: 'coder:30b' })).ollamaHarness === undefined);
    const result = { version: 1, outcome: 'succeeded', summary: 'Fixed', assignments: [], filesChanged: ['sum.cjs'], tests: [], commitSha: null, risks: [], usage: { inputTokens: 9999, outputTokens: 9999, costUsd: 99 } };
    const envelope = { type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(result), usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 30 }, total_cost_usd: 10 };
    const transcript = JSON.stringify(envelope);
    const qwenLaunch = adapters.prepare(qwen, {} as RunTask, 'Fix', files, 'win32');
    const actual = adapters.readResult(qwenLaunch, transcript);
    check('terminal telemetry replaces model guesses without double-counting cached tokens or inventing costs', actual.usage.inputTokens === 100 && actual.usage.outputTokens === 20 && actual.usage.costUsd === null);
    check('main writes validated Qwen results for run history', JSON.parse(readFileSync(files.resultPath, 'utf8')).summary === 'Fixed');
    check('missing token telemetry remains unknown', adapters.readResult(qwenLaunch, JSON.stringify({ ...envelope, usage: {} })).usage.inputTokens === null);
    for (const value of ['', JSON.stringify({ ...envelope, is_error: true }), JSON.stringify({ ...envelope, is_error: undefined }), JSON.stringify({ ...envelope, result: 'not JSON' }), JSON.stringify({ ...envelope, result: JSON.stringify({ ...result, outcome: 'other' }) })]) {
      assert.throws(() => adapters.readResult(qwenLaunch, value));
    }
    check('missing, failed, malformed and invalid result contracts fail closed', true);
    assert.throws(() => qwenTerminalResult(transcript + JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true })));
    check('a later terminal failure cannot be hidden by an earlier success', true);
    const parser = new QwenActivityParser();
    const events = JSON.stringify({ type: 'system', subtype: 'session_start', model: 'coder:30b' })
      + JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'edit', input: { path: 'sum.cjs' } }] } }) + transcript;
    const lines = [...parser.push(events.slice(0, 55)), ...parser.push(events.slice(55))];
    check('split Qwen activity renders init, tool and exact result token counts', lines.some(l => l.kind === 'init') && lines.some(l => l.text.includes('edit: sum.cjs'))
      && lines.some(l => l.text.includes('100 in / 20 out')) && lines.every(l => !l.text.includes('$'))
      && new QwenActivityParser().push(JSON.stringify({ type: 'system', subtype: 'init', model: 'coder:30b' })).some(l => l.kind === 'init'));
    check('positive Qwen result still passes after all negative controls', adapters.readResult(qwenLaunch, transcript).outcome === 'succeeded');
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    rmSync(root, { recursive: true, force: true });
  }
  console.log(`Ollama coding: ${passed} passed, 0 failed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
