/** Opt-in installed-CLI evidence; never substitutes deterministic fixtures for a model. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { CodexAppServerProcess, type CodexConversationIdentity, type CodexConversationResult } from '../src/main/pty/CodexAppServerProcess';
import { DEFAULT_CODEX_MODEL, DEFAULT_CODEX_REASONING_EFFORT } from '../src/shared/types';
import { redactedErrorDetail } from '../src/main/errors';
import { launchCoordinatorCodex } from '../src/main/pty/CoordinatorCodexPolicy';

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-native-conversation-')));
writeFileSync(join(root, 'AGENTS.md'), 'Isolated ADE protocol acceptance. Answer only the user message. Do not use tools or modify files or Git.\n');
execFileSync('git', ['init', '--quiet', root], { windowsHide: true, timeout: 10000 });
const processes: CodexAppServerProcess[] = []; const evidence = resolve('test-results/main-agent-planning'); mkdirSync(evidence, { recursive: true });
const closed = new Set<CodexAppServerProcess>();
const coordinator = process.argv.includes('--coordinator');
const toolNonce = 'ADE_TOOL_' + randomUUID(); let nativeToolCalls = 0;
const deadline = Date.now() + 180_000;
async function until(test: () => boolean) { while (!test()) { if (Date.now() > deadline) throw new Error('Native conversation acceptance exceeded 180 seconds'); await new Promise(done => setTimeout(done, 100)); } }
function start(prompt: string, resumeThreadId?: string) {
  let identity: CodexConversationIdentity | undefined; let exitCode: number | undefined; let failure = '';
  const results: CodexConversationResult[] = [];
  const process = new CodexAppServerProcess({ cwd: root, env: globalThis.process.env as Record<string, string>, prompt,
    ...(coordinator ? { launch: () => {
      const child = launchCoordinatorCodex(root, globalThis.process.env as Record<string, string>); let frames = '';
      child.stdout.on('data', (chunk: Buffer | string) => {
        frames += chunk.toString(); if (frames.length > 2 * 1024 * 1024) { frames = ''; return; }
        const lines = frames.split('\n'); frames = lines.pop()!;
        for (const line of lines) {
          // The production transport owns malformed-frame rejection; this
          // observation must not bypass its cleanup with an uncaught exception.
          try { const message = JSON.parse(line) as { method?: string; params?: Record<string, unknown> };
            if (message.method === 'item/tool/call') console.log('Native probe tool metadata: ' + JSON.stringify({ tool: message.params?.tool, namespace: message.params?.namespace, argumentsType: typeof message.params?.arguments }));
          } catch { /* Transport reports the protocol failure. */ }
        }
      }); return child;
    } } : {}),
    agent: { permissionMode: coordinator ? 'bypass' : 'default', codexModel: DEFAULT_CODEX_MODEL, codexReasoningEffort: DEFAULT_CODEX_REASONING_EFFORT },
    conversation: { resumeThreadId, ...(coordinator ? { coordinator: true } : {}), ready: value => { identity = value; }, completed: value => { results.push(value); },
      tools: [{ name: 'ade_probe', description: 'Read the current ADE protocol acceptance marker. Read only; no external action.',
        inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
        invoke: async (args, context) => { context.signal.throwIfAborted(); if (!args || typeof args !== 'object' || Object.keys(args).length) throw new Error('Unexpected probe arguments'); nativeToolCalls++; return toolNonce; } }],
    },
    question: () => { throw new Error('This acceptance does not authorize question delivery'); },
  });
  processes.push(process); process.onExit(event => { exitCode = event.exitCode; closed.add(process); });
  process.onData(data => { const event = JSON.parse(data); if (event.type === 'turn.failed') failure = event.error.message; });
  return { process, results, get identity() { return identity; }, get exitCode() { return exitCode; }, get failure() { return failure; } };
}
void (async () => {
  const version = execFileSync(process.platform === 'win32' ? 'powershell.exe' : 'codex', process.platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-Command', '& codex --version'] : ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
  console.log(`Native ${version}: model ${DEFAULT_CODEX_MODEL}, reasoning ${DEFAULT_CODEX_REASONING_EFFORT}, ${process.platform}, read-only`);
  const nonce = 'ADE_' + randomUUID();
  const first = start(coordinator ? `Remember this exact marker for later in this conversation: ${nonce}. Call ade_probe once with an empty object and return its exact result. If the tool is invoked through an execution wrapper, explicitly print or emit its return value using the wrapper's text helper. Use only ade_probe and the wrapper needed to invoke it.`
    : `Remember this exact marker for later in this conversation: ${nonce}. Reply only RECORDED. Do not use tools.`);
  await until(() => first.results.length > 0 || first.exitCode !== undefined);
  if (!first.results.length) throw new Error(first.failure || 'First native turn failed');
  if (coordinator && (nativeToolCalls !== 1 || !first.results[0].text.includes(toolNonce))) throw new Error(`Initial coordinator tool probe failed (${nativeToolCalls} calls): ${redactedErrorDetail(first.results[0].text).slice(0, 1000)}`);
  console.log('Native first turn completed.');
  await first.process.sendTurn('Return only the exact marker from my previous message. Do not use tools.');
  await until(() => first.results.length === 2 || first.exitCode !== undefined);
  if (!first.results[1]?.text.includes(nonce)) throw new Error(first.failure || 'Second native turn did not retain context');
  console.log('Native second turn retained context.');
  const threadId = first.identity!.threadId;
  first.process.kill(); await until(() => first.exitCode !== undefined);
  const resumed = start('Return only the exact marker I asked you to remember earlier in this conversation. Do not use tools.', threadId);
  await until(() => resumed.results.length > 0 || resumed.exitCode !== undefined);
  if (!resumed.results[0]?.text.includes(nonce) || resumed.identity?.threadId !== threadId) throw new Error(resumed.failure || 'Native resume did not retain context');
  if (resumed.identity.model !== DEFAULT_CODEX_MODEL || resumed.identity.reasoningEffort !== DEFAULT_CODEX_REASONING_EFFORT) throw new Error('Native thread did not confirm the requested model/reasoning defaults');
  console.log('Native process restart resumed the same conversation and context.');
  if (coordinator) {
    await resumed.process.sendTurn('For this isolated acceptance only, I authorize creating coordinator-write-test.txt in the current directory containing TEST. Use a native shell or file tool if one is available. Do not call ade_probe, which only reads a marker. If no native shell or file tool is available, return exactly ADE_NATIVE_WRITE_UNAVAILABLE. Do not claim a file was written without a tool result.');
    await until(() => resumed.results.length === 2 || resumed.exitCode !== undefined);
    if (resumed.exitCode !== undefined || !resumed.results[1]?.text.includes('ADE_NATIVE_WRITE_UNAVAILABLE') || nativeToolCalls !== 1 || existsSync(join(root, 'coordinator-write-test.txt'))) {
      throw new Error(resumed.failure || 'Coordinator did not reject the native write probe');
    }
    console.log('Native coordinator has no shell/file tool for the authorized isolated write probe.');
  }
  await resumed.process.sendTurn('Call the ade_probe tool exactly once with an empty object. If using an execution wrapper, explicitly print or emit the returned tool value with its text helper. Return only the exact marker provided by that tool. Use only ade_probe and the wrapper needed to invoke it.');
  await until(() => resumed.results.length === (coordinator ? 3 : 2) || resumed.exitCode !== undefined);
  if (!resumed.results.at(-1)?.text.includes(toolNonce) || nativeToolCalls !== (coordinator ? 2 : 1)) throw new Error(resumed.failure || `Native dynamic tool probe failed (${nativeToolCalls} calls): ${redactedErrorDetail(resumed.results.at(-1)?.text ?? 'No answer').slice(0, 1000)}`);
  console.log('Native dynamic ADE tool returned its correlated result.');
  writeFileSync(join(evidence, coordinator ? 'codex-native-coordinator.json' : 'codex-native-conversation.json'), JSON.stringify({ at: new Date().toISOString(), version, platform: process.platform, coordinator,
    requestedModel: DEFAULT_CODEX_MODEL, requestedReasoning: DEFAULT_CODEX_REASONING_EFFORT, profilePermissionMode: coordinator ? 'bypass' : 'default', effectiveSandbox: 'read-only',
    observed: { model: resumed.identity.model ?? null, reasoningEffort: resumed.identity.reasoningEffort ?? null },
    checks: { firstTurn: true, nextTurnSameContext: true, processRestartSameThreadAndContext: true, dynamicToolRoundTrip: true, ...(coordinator ? { nativeWriteUnavailable: true } : {}) }, native: true }, null, 2));
  console.log(`Native Codex conversations: ${coordinator ? 5 : 4} passed, 0 failed`);
})().catch(error => { console.error(redactedErrorDetail(error)); process.exitCode = 1; }).finally(async () => {
  for (const process of processes) process.kill();
  const closeDeadline = Date.now() + 10_000;
  while (processes.some(process => !closed.has(process)) && Date.now() < closeDeadline) await new Promise(done => setTimeout(done, 50));
  if (processes.some(process => !closed.has(process))) throw new Error('Native Codex process did not close; acceptance workspace retained.');
  if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected acceptance workspace');
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
