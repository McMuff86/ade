/** Opt-in real local inference; deliberately excluded from pnpm verify. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RuntimeAdapterRegistry } from '../src/main/orchestration/runtimeAdapters';
import { ExecutionBackendService } from '../src/main/execution/ExecutionBackendService';
import type { Agent, RunTask } from '../src/shared/types';

void (async () => {
  assert.equal(process.platform, 'win32', 'Native Windows probe only');
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-qwen-proof-')));
  const workspace = join(root, 'workspace'); mkdirSync(workspace);
  const taskDir = join(root, 'task'); mkdirSync(taskDir);
  const qwenHome = join(root, 'qwen-home'); mkdirSync(qwenHome);
  const evidence = resolve('test-results/qwen'); mkdirSync(evidence, { recursive: true });
  writeFileSync(join(workspace, 'sum.cjs'), 'exports.sum = (a, b) => a - b;\n');
  writeFileSync(join(workspace, 'test.cjs'), "require('node:assert/strict').equal(require('./sum.cjs').sum(2, 3), 5); console.log('PASS sum(2,3)=5');\n");
  writeFileSync(join(workspace, 'AGENTS.md'), 'Work only in this workspace. Do not use Git. Fix sum.cjs and run node test.cjs. Never change test.cjs.\n');
  assert.throws(() => execFileSync(process.execPath, ['test.cjs'], { cwd: workspace, windowsHide: true, stdio: 'pipe' }));
  const originalTest = readFileSync(join(workspace, 'test.cjs'), 'utf8');
  const files = { taskDir, resultPath: join(taskDir, 'result.json'), schemaPath: join(taskDir, 'schema.json'), inboxPath: join(taskDir, 'inbox.jsonl'), outboxPath: join(taskDir, 'outbox.jsonl') };
  writeFileSync(files.inboxPath, ''); writeFileSync(files.outboxPath, '');
  const agent: Agent = { id: 'probe', categoryId: 'probe', name: 'Local Qwen probe', runtime: 'ollama', ollamaMode: 'coding', ollamaHarness: 'qwen-code',
    ollamaModel: 'qwen3-coder:30b', permissionMode: 'bypass', workspaceDir: workspace, memoryDir: taskDir };
  const registry = new RuntimeAdapterRegistry();
  const launch = registry.prepare(agent, {} as RunTask, 'Fix sum.cjs so sum(2,3) equals 5. Read AGENTS.md, edit only sum.cjs, run node test.cjs, and report its real result. Do not use Git or delegate. Complete the ADE result with assignments=[], commitSha=null, and usage fields null.', files, 'win32');
  const script = join(root, 'launch.ps1'); writeFileSync(script, `$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\n${launch.command} --max-wall-time 5m --max-tool-calls 12\nexit $LASTEXITCODE\n`);
  const execution = new ExecutionBackendService();
  console.log(`Probe directory: ${root}`);
  const run = await execution.run('native', 'powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
    cwd: workspace, env: { ...launch.env, ADE_TASK_PROMPT: launch.prompt, QWEN_HOME: qwenHome, QWEN_RUNTIME_DIR: join(root, 'qwen-runtime') }, timeoutMs: 330_000, maxBuffer: 4 * 1024 * 1024,
  });
  writeFileSync(join(evidence, 'native.stdout.jsonl'), run.stdout); writeFileSync(join(evidence, 'native.stderr.log'), run.stderr);
  assert.equal(run.timedOut, false); assert.equal(run.code, 0, 'Qwen CLI must exit successfully');
  const result = registry.readResult(launch, run.stdout.toString('utf8'));
  assert.equal(result.outcome, 'succeeded');
  assert.equal(readFileSync(join(workspace, 'test.cjs'), 'utf8'), originalTest);
  const positive = execFileSync(process.execPath, ['test.cjs'], { cwd: workspace, windowsHide: true, encoding: 'utf8' });
  const proof = { status: 'passed', root, platform: process.platform, model: agent.ollamaModel, harness: agent.ollamaHarness,
    permissionMode: agent.permissionMode, adapterId: launch.adapterId, negativeControl: 'sum test failed before model edit', positiveControl: positive.trim(), result };
  writeFileSync(join(evidence, 'native-proof.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
