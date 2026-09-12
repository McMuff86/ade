/** Opt-in installed-Codex/model smoke; deliberately separate from deterministic pnpm verify. */
import { mkdtempSync, readFileSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexAppServerProcess } from '../src/main/pty/CodexAppServerProcess';
import { DEFAULT_CODEX_MODEL, DEFAULT_CODEX_REASONING_EFFORT } from '../src/shared/types';
import { validQuestionItems } from '../src/shared/runQuestions';

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-native-question-')));
writeFileSync(join(root, 'AGENTS.md'), 'This is an isolated ADE protocol acceptance workspace. Do not modify files or Git. Ask the requested test question through request_user_input, then acknowledge the supplied answer.\n');
execFileSync('git', ['init', '--quiet', root], { windowsHide: true, timeout: 10000 });
const schemaPath = join(root, 'schema.json'); const resultPath = join(root, 'result.json');
writeFileSync(schemaPath, JSON.stringify({ type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false }));
let proc: CodexAppServerProcess | undefined; let asked = false; let confirmed = false; let output = '';
void (async () => {
  console.log(`Installed Codex acceptance: ${DEFAULT_CODEX_MODEL}, reasoning ${DEFAULT_CODEX_REASONING_EFFORT}, native ${process.platform}`);
  const exitCode = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => { proc?.kill(); reject(new Error('Native Codex acceptance exceeded 120 seconds.')); }, 120_000);
    proc = new CodexAppServerProcess({ cwd: root, env: process.env as Record<string, string>, schemaPath, resultPath,
      agent: { permissionMode: 'default', codexModel: DEFAULT_CODEX_MODEL, codexReasoningEffort: DEFAULT_CODEX_REASONING_EFFORT },
      prompt: 'Protocol acceptance test: invoke request_user_input now with one question asking whether to use blue or green, with options Blue and Green. You MUST wait for the provided answer. After the answer, produce the required JSON result with message ADE_ANSWER_CONFIRMED followed by the chosen option. Do not use any other tools or change files.',
      question: (items, _blocking, deliver) => {
        if (!validQuestionItems(items)) throw new Error('Invalid native question');
        asked = true; console.log('Native request_user_input received.');
        setTimeout(() => { void deliver(Object.fromEntries(items.map((item) => [item.id, { answers: [item.options?.[0]?.label ?? 'Blue'] }])))
          .then(() => { confirmed = true; console.log('Native serverRequest/resolved received.'); }).catch(reject); }, 100);
        return { id: 'native-test', expire: () => undefined };
      },
    });
    proc.onData((data) => { output += data; if (data.includes('turn.failed')) console.log(data.trim()); });
    proc.onExit((event) => { clearTimeout(timer); resolve(event.exitCode); });
  });
  if (exitCode !== 0 || !asked || !confirmed || !output.includes('ADE_ANSWER_CONFIRMED')) throw new Error(`Native question acceptance failed (exit ${exitCode}, asked ${asked}, confirmed ${confirmed}).`);
  if (!String(JSON.parse(readFileSync(resultPath, 'utf8')).message).includes('ADE_ANSWER_CONFIRMED')) throw new Error('Structured native result was not persisted');
  console.log('Native Codex questions: 5 passed, 0 failed');
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { proc?.kill(); if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected fixture root'); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
