/**
 * MemoryStore smoke test (run: pnpm test:memory).
 *
 * Exercises the load-bearing semantics from docs/reports/hermes-memory.md:
 * add/dedup, cap-overflow error shape, replace ambiguity, batch atomicity,
 * and the drift guard (.bak snapshot + destructive ops refused, add allowed).
 * Pure Node — no Electron — so it runs under tsx.
 */

import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AGENT_ROLE_END_MARKER,
  AGENT_ROLE_START_MARKER,
  snapshotAgentInstructions,
  syncAgentInstructions,
} from '../src/main/memory/agentInstructions';
import { ENTRY_DELIMITER, MemoryStore } from '../src/main/memory/MemoryStore';
import type { Agent } from '../src/shared/types';

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.error(`FAIL  ${label}`);
    if (detail !== undefined) console.error('      detail:', JSON.stringify(detail));
  }
}

function section(name: string): void {
  console.log(`\n== ${name} ==`);
}

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'ade-mem-'));
}

/* ------------------------------------------------------ 1. add + dedup */
section('add + dedup');
{
  const store = new MemoryStore(freshDir());
  const r1 = store.add('memory', 'User prefers concise responses');
  check('add succeeds', r1.success && r1.entryCount === 1, r1);

  const r2 = store.add('memory', '   ');
  check('empty add rejected', !r2.success && r2.error === 'empty', r2);

  const r3 = store.add('memory', 'User prefers concise responses');
  check('exact duplicate is success no-op', r3.success && r3.note === 'no duplicate added' && r3.entryCount === 1, r3);

  const r4 = store.add('memory', 'Second distinct note');
  check('distinct add appends', r4.success && r4.entryCount === 2, r4);
  check('usage pct reported', typeof r4.usage?.pct === 'number', r4.usage);
}

/* ------------------------------------------------- 2. cap overflow shape */
section('cap overflow error shape');
{
  const store = new MemoryStore(freshDir(), { memoryLimit: 40 });
  store.add('memory', 'aaaaaaaaaaaaaaaaaaaa'); // 20 chars
  const r = store.add('memory', 'bbbbbbbbbbbbbbbbbbbb'); // 20 + delimiter(3) + 20 = 43 > 40
  check('over-cap add fails', !r.success && r.error === 'over_capacity', r);
  check('over-cap lists current entries', Array.isArray(r.currentEntries) && r.currentEntries!.length === 1, r.currentEntries);
  check('over-cap note tells caller to consolidate', /batch/i.test(r.note ?? ''), r.note);
}

/* --------------------------------------------- 3. replace ambiguity error */
section('replace ambiguity');
{
  const store = new MemoryStore(freshDir());
  store.add('memory', 'foo alpha');
  store.add('memory', 'foo beta');
  const amb = store.replace('memory', 'foo', 'X');
  check('ambiguous replace refused', !amb.success && amb.error === 'ambiguous', amb);

  const miss = store.replace('memory', 'zzz', 'X');
  check('no-match replace refused', !miss.success && miss.error === 'not_found', miss);

  const ok = store.replace('memory', 'alpha', 'gamma');
  check('unique replace applies', ok.success, ok);
  check('replaced content present', store.readEntries('memory').includes('foo gamma'), store.readEntries('memory'));
}

/* ---------------------------------------------- 4. batch atomicity */
section('batch atomicity + final-budget check');
{
  // 4a: a failing op rolls back the whole batch.
  const store = new MemoryStore(freshDir());
  store.add('memory', 'keep me');
  const before = store.readEntries('memory');
  const bad = store.batch('memory', [
    { action: 'add', content: 'would be added' },
    { action: 'remove', old_text: 'does-not-exist' }, // fails -> whole batch rolls back
  ]);
  check('batch with a failing op fails', !bad.success && bad.error === 'not_found', bad);
  check('batch rollback wrote nothing', JSON.stringify(store.readEntries('memory')) === JSON.stringify(before), store.readEntries('memory'));

  // 4b: budget checked on FINAL state — remove + add in one call clears room
  // even though the add alone would overflow.
  const tight = new MemoryStore(freshDir(), { memoryLimit: 30 });
  tight.add('memory', 'old stale entry here'); // 20 chars, near cap
  const solo = tight.add('memory', 'brand new note twenty'); // would overflow alone
  check('add alone overflows', !solo.success && solo.error === 'over_capacity', solo);
  const combo = tight.batch('memory', [
    { action: 'remove', old_text: 'old stale entry here' },
    { action: 'add', content: 'brand new note twenty' },
  ]);
  check('batch remove+add fits on final state', combo.success && combo.entryCount === 1, combo);
}

/* ---------------------------------------------- 5. drift guard */
section('drift guard (.bak + destructive refused, add allowed)');
{
  const dir = freshDir();
  const store = new MemoryStore(dir);
  const file = join(dir, 'MEMORY.md');
  // Hand-write a non-round-tripping file: trailing junk + duplicate spacing.
  writeFileSync(file, `first entry${ENTRY_DELIMITER}first entry${ENTRY_DELIMITER}   \n\n`, 'utf8');

  const rep = store.replace('memory', 'first', 'second');
  check('destructive op refused on drift', !rep.success && rep.error === 'drift', rep);

  const baks = readdirSync(dir).filter((f) => f.startsWith('MEMORY.md.bak.'));
  check('.bak snapshot created', baks.length >= 1, baks);

  const add = store.add('memory', 'a healthy new entry');
  check('add still allowed under drift', add.success, add);
  const healed = readFileSync(file, 'utf8');
  check('add heals the file to round-trip', healed.trim() === store.readEntries('memory').join(ENTRY_DELIMITER), healed);
}

/* ---------------------------------------------- 6. renderBlock format */
section('renderBlock header format');
{
  const store = new MemoryStore(freshDir());
  store.add('memory', 'entry one');
  store.add('memory', 'entry two');
  const block = store.renderBlock('memory');
  const lines = block.split('\n');
  check('bar is 46 U+2550', lines[0] === '═'.repeat(46), lines[0]);
  check('header label + capacity', /^MEMORY \(your personal notes\) \[\d+% — \d[\d,]*\/2,200 chars\]$/.test(lines[1]), lines[1]);
  check('entries joined by \\n§\\n', block.includes(`entry one${ENTRY_DELIMITER}entry two`), block);

  const user = new MemoryStore(freshDir()).renderBlock('user');
  check('user header label', user.split('\n')[1].startsWith('USER PROFILE (who the user is) [0% — 0/1,375 chars]'), user.split('\n')[1]);
}

/* ------------------------------------------ 7. durable role AGENTS.md */
section('role-aware AGENTS.md');
{
  const dir = freshDir();
  const agent: Agent = {
    id: 'orchestrator',
    categoryId: 'cat',
    name: 'Main Chef',
    role: 'Architecture and delivery',
    runtime: 'codex',
    permissionMode: 'bypass',
    codexModel: 'gpt-5.6-sol',
    codexReasoningEffort: 'xhigh',
    workspaceDir: join(dir, 'workspace'),
    memoryDir: join(dir, 'memory'),
    teamRole: 'orchestrator',
  };
  const created = syncAgentInstructions(agent);
  check('persistent AGENTS.md carries the orchestrator identity and Codex profile',
    created.includes('Orchestration role: main orchestrator')
      && created.includes('model gpt-5.6-sol')
      && created.includes('reasoning xhigh'));
  const path = join(agent.memoryDir, 'AGENTS.md');
  writeFileSync(path, `${created}\nUser-owned local guidance.\n`, 'utf8');
  const worker = syncAgentInstructions({ ...agent, teamRole: 'worker', codexReasoningEffort: 'high' });
  check('role updates replace exactly one managed block and preserve user guidance',
    worker.includes('Orchestration role: worker')
      && worker.includes('User-owned local guidance.')
      && worker.split(AGENT_ROLE_START_MARKER).length === 2
      && worker.split(AGENT_ROLE_END_MARKER).length === 2);
  const snapshot = snapshotAgentInstructions({ ...agent, teamRole: 'worker' }, 'orchestrator');
  check('managed task snapshot uses the run role and has verifiable provenance',
    snapshot.file === 'AGENTS.md'
      && snapshot.content.includes('Orchestration role: main orchestrator')
      && /^[0-9a-f]{64}$/.test(snapshot.sha256)
      && snapshot.chars === snapshot.content.length);
}

/* ---------------------------------------------------------- summary */
console.log(`\n${'-'.repeat(40)}`);
console.log(`RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
console.log('All MemoryStore checks passed.');

// Show one real rendered block for the record.
{
  const dir = freshDir();
  const store = new MemoryStore(dir);
  store.add('memory', 'Dev machine is Windows 11, Node 22, pnpm. ADE is an Electron app.');
  store.add('memory', 'User dislikes verbose explanations; keep answers tight.');
  store.add('user', 'Name: Adi. Role: owner/architect of ADE.');
  console.log('\nSample MEMORY block:\n');
  console.log(store.renderBlock('memory'));
  console.log('\nSample USER block:\n');
  console.log(store.renderBlock('user'));
}
