import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { UsageJournal, usageDigest, validUsageBudget } from '../src/main/usage/UsageJournal';
import type { UsageSample } from '../src/main/usage/normalize';
let passed = 0;
const check = (name: string, value: boolean) => { if (!value) throw new Error(name); passed++; console.log(`  ok ${name}`); };
async function rejects(name: string, call: () => Promise<unknown>, pattern: RegExp) {
  try { await call(); } catch (error) { check(name, pattern.test(String(error))); return; }
  throw new Error(`${name}: accepted`);
}
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-usage-journal-')));
const journals: UsageJournal[] = [];
const open = (name: string) => { const journal = new UsageJournal(join(root, name)); journals.push(journal); return journal; };
const now = Date.now();
const sample = (key: string, input: number, cached: number, output: number): UsageSample => ({ kind: 'cumulative', key,
  model: 'gpt-6-astra', tokens: { input, inputUncached: input - cached, cacheRead: cached, cacheWrite: 0, output, reasoning: 0 },
  costUsd: null, costKind: 'unknown', costComplete: null });
const source = usageDigest('codex-native-session-a');
void (async () => {
  let journal = open('usage.jsonl'); const file = join(root, 'usage.jsonl');
  check('fresh journal exposes no invented cost or budget', !journal.view().error && journal.view().monthlyBudgetUsd === null && journal.view().facts.length === 0);
  const session = await journal.openSession({ provider: 'codex', product: 'coding', backend: 'native', repositoryId: 'project-a', terminalSessionId: 'sfixture', createdAt: now, coverage: 'waiting' });
  check('usage session identity differs from the private PTY id', session !== 'sfixture' && journal.view().sessions[0]!.terminalSessionId === 'sfixture');
  check('first native snapshot is durable before acknowledgement', await journal.record(session, 'codex-rollout', source, sample('one', 100, 50, 10), now) === 'recorded'
    && readFileSync(file, 'utf8').includes('"input":100'));
  check('same native event is counted once', await journal.record(session, 'codex-rollout', source, sample('one', 100, 50, 10), now) === 'duplicate' && journal.view().facts.length === 1);
  check('same cumulative values under a later event are not added again', await journal.record(session, 'codex-rollout', source, sample('same-count', 100, 50, 10), now) === 'duplicate');
  await journal.record(session, 'codex-rollout', source, sample('two', 180, 100, 30), now + 1);
  check('later cumulative snapshot stores only the disjoint delta', journal.view().facts[1]!.tokens.input === 80 && journal.view().facts[1]!.tokens.output === 20 && journal.view().facts[1]!.tokens.cacheRead === 50);
  check('changed payload under a native event marks a gap without overwriting counts', await journal.record(session, 'codex-rollout', source, sample('two', 999, 100, 30), now + 1) === 'gap'
    && journal.view().facts.length === 2 && journal.view().sessions[0]!.coverage === 'incomplete');
  check('counter rollback marks incomplete coverage', await journal.record(session, 'codex-rollout', source, sample('rollback', 1, 0, 0), now + 1) === 'gap');
  const second = await journal.openSession({ provider: 'codex', product: 'coding', backend: 'native', repositoryId: 'project-b', createdAt: now, coverage: 'waiting' });
  await journal.record(second, 'codex-rollout', usageDigest('codex-native-session-b'), sample('one', 120, 10, 12), now);
  check('two native conversations keep independent counters and projects', journal.view().facts.reduce((sum, fact) => sum + (fact.tokens.input ?? 0), 0) === 300
    && journal.view().sessions.find(item => item.id === second)!.repositoryId === 'project-b');
  const view = journal.view(); view.facts[0]!.tokens.input = 999;
  check('consumer mutation cannot change journal state', journal.view().facts[0]!.tokens.input === 100);
  await journal.setBudget(123.45); await journal.close(); journal = open('usage.jsonl');
  check('restart retains usage, coverage and budget', journal.view().facts.length === 3 && journal.view().monthlyBudgetUsd === 123.45 && journal.view().sessions[0]!.coverage === 'incomplete');
  check('restart replay does not add a second copy', await journal.record(session, 'codex-rollout', source, sample('two', 180, 100, 30), now + 1) === 'duplicate');
  await journal.record(session, 'codex-rollout', source, sample('three', 220, 130, 40), now + 2);
  check('restart restores the cumulative baseline', journal.view().facts.at(-1)!.tokens.input === 40);
  const next = sample('four', 250, 140, 50);
  const results = await Promise.all([journal.record(session, 'codex-rollout', source, next, now + 3), journal.record(session, 'codex-rollout', source, next, now + 3)]);
  check('concurrent replay serializes one durable observation', results[0] === 'recorded' && results[1] === 'duplicate');
  const mutable = sample('five', 260, 145, 51); const pending = journal.record(session, 'codex-rollout', source, mutable, now + 4); mutable.tokens.input = 123456;
  await pending;
  check('queued source sample is immutable', journal.view().facts.at(-1)!.tokens.input === 10);
  await rejects('unknown attribution cannot enter the journal', () => journal.record('missing', 'codex-rollout', source, sample('invalid', 270, 150, 52), now), /invalid fact/);
  await rejects('provider source cannot be mixed into a different runtime', () => journal.record(session, 'grok-session', source, { ...sample('invalid-provider', 270, 150, 52), kind: 'turn' }, now), /invalid fact/);
  await rejects('prompt or path metadata is refused by the numeric schema', () => journal.openSession({ provider: 'codex', product: 'coding', backend: 'native', createdAt: now, coverage: 'waiting', prompt: 'PRIVATE_PROMPT' } as never), /invalid session/);
  check('rejected text never reaches the journal file', !readFileSync(file, 'utf8').includes('PRIVATE_PROMPT'));
  for (const value of [0, -1, NaN, Infinity, '10', 1_000_001]) check('invalid budget is refused', !validUsageBudget(value));
  await journal.setBudget(null); check('budget may be explicitly disabled without changing usage', journal.view().monthlyBudgetUsd === null && journal.view().facts.length === 6);
  const countBefore = journal.view().facts.length; await journal.close();
  await rejects('closing a journal refuses new writes', () => journal.setBudget(10), /geschlossen/);
  const final = open('usage.jsonl'); check('final positive restart preserves all accepted observations', final.view().facts.length === countBefore && !final.view().error); await final.close();
  renameSync(file, join(root, 'preserved.jsonl'));
  const missing = open('usage.jsonl');
  check('missing initialized journal fails closed without creating an empty replacement', !!missing.view().error && !existsSync(file));
  const tornFile = join(root, 'torn.jsonl'); writeFileSync(tornFile, '{"type":"fact"'); const torn = open('torn.jsonl');
  check('torn journal is preserved and cannot be shown as a fresh zero', !!torn.view().error && readFileSync(tornFile, 'utf8') === '{"type":"fact"');
  const replaced = open('replaced.jsonl'); await replaced.openSession({ provider: 'codex', product: 'coding', backend: 'native', createdAt: now, coverage: 'waiting' });
  renameSync(join(root, 'replaced.jsonl'), join(root, 'replaced-original.jsonl')); writeFileSync(join(root, 'replaced.jsonl'), 'EXTERNAL\n');
  await rejects('replaced live journal is not overwritten', () => replaced.setBudget(10), /unvollständig/);
  check('replacement bytes remain unchanged', readFileSync(join(root, 'replaced.jsonl'), 'utf8') === 'EXTERNAL\n');
  const edited = open('edited.jsonl'); appendFileSync(join(root, 'edited.jsonl'), 'EXTERNAL\n');
  await rejects('external append invalidates the held journal', () => edited.setBudget(10), /unvollständig/);
  const oversizedFile = join(root, 'oversized.jsonl'); writeFileSync(oversizedFile, Buffer.alloc(32 * 1024 * 1024 + 1, 32));
  check('oversized journal is refused without loading it as valid history', !!open('oversized.jsonl').view().error);
  const clean = open('positive.jsonl'); await clean.setBudget(25);
  check('final independent positive control stays writable after negative fixtures', clean.view().monthlyBudgetUsd === 25 && clean.view().error === null);
  console.log(`Usage journal: ${passed} passed, 0 failed`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await Promise.allSettled(journals.map(journal => journal.close()));
  if (dirname(root) !== realpathSync.native(tmpdir()) || !root.includes('ade-usage-journal-')) throw new Error('Unexpected journal fixture root');
  rmSync(root, { recursive: true, force: true });
});
