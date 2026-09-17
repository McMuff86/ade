import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { CodexAppServerProcess, type CodexConversationIdentity, type CodexConversationResult } from '../src/main/pty/CodexAppServerProcess';
import { COORDINATOR_DISABLED_FEATURES } from '../src/main/pty/CoordinatorCodexPolicy';

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-conversation-')));
let passed = 0; let failed = 0;
const check = (label: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
const procs: CodexAppServerProcess[] = [];
const closed = new Set<CodexAppServerProcess>();
async function until(test: () => boolean) { const end = Date.now() + 6000; while (!test()) { if (Date.now() > end) throw new Error('Fixture protocol did not settle'); await new Promise(done => setTimeout(done, 10)); } }
const rejected = async (call: () => Promise<unknown>) => { try { await call(); return false; } catch { return true; } };
function start(prompt: string, resumeThreadId?: string, wrong = false, coordinator?: 'valid' | 'bad-config' | 'bad-sandbox') {
  let identity: CodexConversationIdentity | undefined; let exitCode: number | undefined; let output = '';
  const results: CodexConversationResult[] = [];
  let toolCalls = 0;
  const process = new CodexAppServerProcess({ cwd: root, env: {}, prompt, agent: { permissionMode: coordinator ? 'bypass' : 'default', codexModel: 'requested-is-not-observed' },
    conversation: { resumeThreadId, ...(coordinator ? { coordinator: true } : {}), ready: value => { identity = value; }, completed: value => { results.push(value); },
      tools: [{ name: 'ade_test', description: 'Fixture ADE tool', inputSchema: { type: 'object' }, invoke: async (args, context) => {
        toolCalls++; if ((args as { operation: string }).operation === 'tool-interrupt') {
          await process.interruptTurn(); return context.signal.aborted ? 'aborted' : 'interrupt requested';
        } return 'ADE_TOOL_RESULT';
      } }] },
    question: () => { throw new Error('Unexpected question'); },
    launch: () => spawn(globalThis.process.execPath, [resolve('scripts/fixtures/codex-conversation.cjs')], { cwd: root, windowsHide: true, stdio: 'pipe',
      env: { ...globalThis.process.env, ...(wrong ? { ADE_WRONG_WORKSPACE: dirname(root) } : {}),
        ...(coordinator ? { ADE_COORDINATOR_CONFIG: JSON.stringify({ features: { ...Object.fromEntries(COORDINATOR_DISABLED_FEATURES.map(name => [name, false])), code_mode_host: true },
          mcp_servers: coordinator === 'bad-config' ? { unexpected: {} } : {}, agents: { enabled: false }, web_search: 'disabled', sandbox_mode: 'read-only', approval_policy: 'never' }) } : {}),
        ...(coordinator === 'bad-sandbox' ? { ADE_WRONG_SANDBOX: '1' } : {}),
      } }),
  });
  process.onExit(event => { exitCode = event.exitCode; closed.add(process); }); process.onData(data => { output += data; }); procs.push(process);
  return { process, results, get identity() { return identity; }, get exitCode() { return exitCode; }, get output() { return output; }, get toolCalls() { return toolCalls; } };
}
void (async () => {
  const first = start('remember:PROJECT_A_ONLY'); await until(() => first.results.length === 1);
  check('first turn has a native thread and turn identity', first.results[0]?.threadId === 'thread-' + createHash('sha256').update(root).digest('hex').slice(0, 32) && first.results[0]?.turnId === 'turn-1');
  check('observed model comes from native response', first.identity?.model === 'fixture-observed');
  check('conversation process stays alive after its first result', first.exitCode === undefined);
  await first.process.sendTurn('recall'); await until(() => first.results.length === 2);
  check('second turn returns context within the same native thread', first.results[1]?.text === 'PROJECT_A_ONLY' && first.results[1]?.threadId === first.results[0]?.threadId);
  check('turn identities remain separate', first.results[1]?.turnId !== first.results[0]?.turnId);
  check('foreign, stale and duplicate events never enter the answer stream', !/STALE_|DUPLICATE|WRONG_PROJECT/.test(first.output));
  await first.process.sendTurn('hold');
  check('concurrent message is rejected instead of delivered twice', await rejected(() => first.process.sendTurn('second concurrent')));
  await first.process.interruptTurn(); await until(() => first.results.length === 3);
  check('interruption is confirmed by the native turn event', first.results[2]?.status === 'interrupted');
  await first.process.sendTurn('recall'); await until(() => first.results.length === 4);
  check('context survives interruption and a subsequent turn', first.results[3]?.text === 'PROJECT_A_ONLY');
  check('invalid prompt is rejected without ending the conversation', await rejected(() => first.process.sendTurn('\0')) && first.exitCode === undefined);
  first.process.kill(); await until(() => first.exitCode !== undefined);
  check('closed process cannot receive another turn', await rejected(() => first.process.sendTurn('recall')));
  const resumed = start('recall', first.identity!.threadId); await until(() => resumed.results.length === 1);
  check('explicit native resume retains context across processes', resumed.results[0]?.text === 'PROJECT_A_ONLY');
  check('native conversation ID is distinct from a live process session', resumed.identity?.threadId === first.identity?.threadId && resumed.identity?.sessionId !== first.identity?.sessionId);
  resumed.process.kill(); await until(() => resumed.exitCode !== undefined);
  const wrong = start('recall', first.identity!.threadId, true); await until(() => wrong.exitCode !== undefined);
  check('resume refuses a different stored workspace before any turn', wrong.exitCode === 1 && !wrong.results.length && !wrong.identity);
  const unknown = start('recall', 'missing-thread'); await until(() => unknown.exitCode !== undefined);
  check('missing native conversation does not silently create a new one', unknown.exitCode === 1 && !unknown.results.length);
  const final = start('recall', first.identity!.threadId); await until(() => final.results.length === 1);
  check('final positive resume passes after failed scope controls', final.results[0]?.text === 'PROJECT_A_ONLY');
  await final.process.sendTurn('tool-duplicate'); await until(() => final.results.length === 2);
  check('dynamic tool result reaches the native turn and duplicate request runs once', final.results[1]?.text === 'ADE_TOOL_RESULT' && final.toolCalls === 1);
  await final.process.sendTurn('tool-interrupt'); await until(() => final.results.length === 3);
  check('tool awaiting native interruption cannot deadlock the protocol input queue', final.results[2]?.status === 'interrupted' && final.toolCalls === 2);
  await final.process.sendTurn('recall'); await until(() => final.results.length === 4);
  check('late tool reply cannot complete the next turn', final.results[3]?.text === 'PROJECT_A_ONLY');
  final.process.kill(); await until(() => final.exitCode !== undefined);
  const badConfig = start('tool', undefined, false, 'bad-config'); await until(() => badConfig.exitCode !== undefined);
  check('coordinator refuses inherited MCP configuration before any turn or tool', badConfig.exitCode === 1 && !badConfig.identity && !badConfig.results.length && !badConfig.toolCalls);
  const badSandbox = start('tool', undefined, false, 'bad-sandbox'); await until(() => badSandbox.exitCode !== undefined);
  check('coordinator refuses a mismatched native sandbox before sending its prompt', badSandbox.exitCode === 1 && !badSandbox.identity && !badSandbox.results.length && !badSandbox.toolCalls);
  const central = start('tool', undefined, false, 'valid'); await until(() => central.results.length === 1 || central.exitCode !== undefined);
  check('verified coordinator runs only after read-only policy overrides a coding bypass profile', central.results[0]?.text === 'ADE_TOOL_RESULT' && central.toolCalls === 1);
})().catch(error => { failed++; console.error(error); }).finally(async () => {
  for (const process of procs) process.kill();
  // taskkill is asynchronous; a live Windows process still owns its cwd.
  await until(() => procs.every(process => closed.has(process)));
  if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected fixture root');
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  console.log(`Codex conversations: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
});
