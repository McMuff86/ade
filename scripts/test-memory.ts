/**
 * MemoryStore smoke test (run: pnpm test:memory).
 *
 * Exercises the load-bearing semantics from docs/reports/hermes-memory.md:
 * add/dedup, cap-overflow error shape, replace ambiguity, batch atomicity,
 * and the drift guard (.bak snapshot + destructive ops refused, add allowed).
 * Pure Node — no Electron — so it runs under tsx.
 */

import { existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AGENT_ROLE_END_MARKER,
  AGENT_ROLE_START_MARKER,
  snapshotAgentInstructions,
  previewAgentInstructions,
  syncAgentInstructions,
} from '../src/main/memory/agentInstructions';
import {
  inspectLegacyClaudeInstruction,
  isEntirelyAdeManagedInstruction,
  MEMORY_END_MARKER,
  MEMORY_START_MARKER,
} from '../src/main/memory/legacyInstructions';
import { ENTRY_DELIMITER, MemoryStore } from '../src/main/memory/MemoryStore';
import type { Agent } from '../src/shared/types';
import { isValidAgentBehaviorProfile, validateAgentBehaviorProfile } from '../src/shared/agentProfile';

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
  const grokAgent: Agent = {
    ...agent,
    id: 'grok-orchestrator',
    name: 'Grok Chef',
    runtime: 'grok',
    grokModel: 'grok-4.6',
    grokReasoningEffort: 'xhigh',
    memoryDir: join(dir, 'grok-memory'),
  };
  const grokCreated = syncAgentInstructions(grokAgent);
  check('persistent AGENTS.md carries the Grok Build model and reasoning profile',
    grokCreated.includes('Runtime profile: grok | model grok-4.6 | reasoning xhigh')
      && grokCreated.includes('Identity: Grok Chef'));
  const path = join(agent.memoryDir, 'AGENTS.md');
  writeFileSync(path, `${created}\nUser-owned local guidance.\n`, 'utf8');
  const worker = syncAgentInstructions({ ...agent, teamRole: 'worker', codexReasoningEffort: 'high' });
  const legacyMemoryBlock = `${MEMORY_START_MARKER}\nlegacy ADE memory\n${MEMORY_END_MARKER}\n`;
  const legacyRoleBlock = `${AGENT_ROLE_START_MARKER}\nlegacy ADE role\n${AGENT_ROLE_END_MARKER}\n`;
  const legacyWorkspace = join(dir, 'legacy-workspace');
  mkdirSync(legacyWorkspace, { recursive: true });
  writeFileSync(join(legacyWorkspace, 'CLAUDE.md'), legacyMemoryBlock, 'utf8');
  const managedLegacy = inspectLegacyClaudeInstruction(legacyWorkspace);
  writeFileSync(join(legacyWorkspace, 'CLAUDE.md'), `User guidance.\n${legacyMemoryBlock}`, 'utf8');
  const preservedLegacy = inspectLegacyClaudeInstruction(legacyWorkspace);
  check('role updates preserve user guidance and legacy cleanup accepts only fully ADE-owned files',
    worker.includes('Orchestration role: worker')
      && worker.includes('User-owned local guidance.')
      && worker.split(AGENT_ROLE_START_MARKER).length === 2
      && worker.split(AGENT_ROLE_END_MARKER).length === 2
      && isEntirelyAdeManagedInstruction(legacyMemoryBlock)
      && isEntirelyAdeManagedInstruction(`${legacyRoleBlock}\n${legacyMemoryBlock}`)
      && !isEntirelyAdeManagedInstruction(`User guidance.\n${legacyMemoryBlock}`)
      && !isEntirelyAdeManagedInstruction(MEMORY_START_MARKER)
      && managedLegacy.status === 'managed'
      && preservedLegacy.status === 'preserved');
  const snapshot = snapshotAgentInstructions({ ...agent, teamRole: 'worker' }, 'orchestrator');
  check('managed task snapshot uses the run role and has verifiable provenance',
    snapshot.file === 'AGENTS.md'
      && snapshot.content.includes('Orchestration role: main orchestrator')
      && /^[0-9a-f]{64}$/.test(snapshot.sha256)
      && snapshot.chars === snapshot.content.length);
}

section('profile snapshots and safe identity files');
{
  const dir = freshDir();
  const agent: Agent = { id: 'profile', categoryId: 'cat', name: 'Profile Agent', runtime: 'codex', permissionMode: 'default',
    workspaceDir: join(dir, 'repo'), memoryDir: join(dir, 'identity'), profile: {
      instructions: 'Specialize in geometry.\nKeep the tolerance explicit.',
      documents: [{ id: 'quality', name: 'QUALITY.md', text: 'Run geometry checks.' },
        { id: 'context', name: 'Project Context.md', text: 'Dimensions are millimetres.' }],
    } };
  const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
  const rejects = (action: () => unknown, expected: RegExp) => {
    try { action(); return false; } catch (error) { return expected.test(String(error)); }
  };
  const preview = previewAgentInstructions(agent);
  check('profile preview writes neither identity nor repository files', !existsSync(agent.memoryDir) && !existsSync(agent.workspaceDir));
  const snapshot = snapshotAgentInstructions(agent);
  check('preview and launch use the same exact effective context', preview.content === snapshot.content && preview.sha256 === snapshot.sha256);
  check('profile instructions and ordered documents work without a MEMORY scaffold',
    snapshot.content.includes(agent.profile!.instructions)
    && snapshot.content.indexOf('Run geometry checks.') < snapshot.content.indexOf('Dimensions are millimetres.')
    && !existsSync(join(agent.memoryDir, 'MEMORY.md')) && !existsSync(agent.workspaceDir));
  check('snapshot source provenance hashes actual document contents', snapshot.sha256 === hash(snapshot.content)
    && snapshot.sources.map((source) => source.kind).join(',') === 'identity,instructions,document,document'
    && snapshot.sources[2]!.sha256 === hash(agent.profile!.documents[0]!.text)
    && snapshot.sources[2]!.id === 'quality' && snapshot.sources[3]!.chars === agent.profile!.documents[1]!.text.length);
  const persistedPath = join(agent.memoryDir, 'AGENTS.md');
  const persisted = readFileSync(persistedPath, 'utf8');
  check('sync never duplicates profile text into the persistent identity contract', !persisted.includes('Specialize in geometry.')
    && !persisted.includes('Run geometry checks.') && snapshotAgentInstructions(agent).sha256 === snapshot.sha256);
  writeFileSync(persistedPath, `${persisted}\nUser-owned instructions.`, 'utf8');
  const augmented = snapshotAgentInstructions(agent);
  check('user-owned identity content remains effective and changes full-context hash', augmented.content.includes('User-owned instructions.')
    && augmented.sha256 !== snapshot.sha256 && augmented.profileRevision === snapshot.profileRevision);
  const changed: Agent = { ...agent, profile: { ...agent.profile!, documents: [...agent.profile!.documents].reverse() } };
  check('document ordering changes revision without mutating prior snapshot', previewAgentInstructions(changed).profileRevision !== snapshot.profileRevision
    && snapshot.sources[2]!.id === 'quality');
  const edited: Agent = { ...agent, profile: { ...agent.profile!, instructions: 'Different instructions.' } };
  const updated = previewAgentInstructions(edited);
  check('new profile revision differs while prior snapshot stays fixed', updated.profileRevision !== snapshot.profileRevision
    && updated.sha256 !== snapshot.sha256 && snapshot.content.includes('Specialize in geometry.'));
  const beforePreview = readFileSync(persistedPath, 'utf8');
  previewAgentInstructions({ ...agent, name: 'Renamed agent' });
  check('preview does not synchronize stale persisted role blocks', readFileSync(persistedPath, 'utf8') === beforePreview);

  const profile = agent.profile!;
  check('strict validator accepts detached canonical imported profile copies', validateAgentBehaviorProfile(profile) !== profile
    && validateAgentBehaviorProfile(profile).documents[0] !== profile.documents[0]);
  const invalidProfiles: unknown[] = [null, {}, { ...profile, extra: true }, { instructions: 1, documents: [] },
    { ...profile, instructions: 'x'.repeat(8001) }, { ...profile, instructions: 'bad\0text' },
    { ...profile, documents: [...profile.documents, profile.documents[0]] },
    { ...profile, documents: [{ id: 'unsafe/id', name: 'Safe.md', text: '' }] },
    { ...profile, documents: [{ id: 'safe', name: '../Unsafe.md', text: '' }] },
    { ...profile, documents: [{ id: 'safe', name: 'Unsafe.txt', text: '' }] },
    { ...profile, documents: [{ id: 'safe', name: 'Safe.md', text: 'x'.repeat(8001) }] },
    { ...profile, documents: [{ id: 'safe', name: 'Safe.md', text: '', extra: true }] },
    { instructions: '', documents: Array.from({ length: 9 }, (_, i) => ({ id: `d${i}`, name: 'Doc.md', text: '' })) },
    { instructions: 'x', documents: Array.from({ length: 3 }, (_, i) => ({ id: `d${i}`, name: 'Doc.md', text: 'x'.repeat(8000) })) }];
  check('strict validator rejects wrong keys, bounds, paths, duplicate IDs and NUL', invalidProfiles.every((value) =>
    !isValidAgentBehaviorProfile(value) && rejects(() => validateAgentBehaviorProfile(value), /Ungültige Profilanweisungen/)));
  check('total content exact boundary remains accepted', isValidAgentBehaviorProfile({ instructions: '',
    documents: Array.from({ length: 3 }, (_, i) => ({ id: `d${i}`, name: 'Doc.md', text: 'x'.repeat(8000) })) }));
  writeFileSync(persistedPath, 'x'.repeat(32_001), 'utf8');
  check('oversized effective instructions fail instead of truncating', rejects(() => previewAgentInstructions(agent), /32000/)
    && rejects(() => snapshotAgentInstructions(agent), /32000/));
  writeFileSync(persistedPath, 'x'.repeat(256 * 1024 + 1), 'utf8');
  check('oversized stored identity file is rejected before reading', rejects(() => syncAgentInstructions(agent), /256 KiB/));
  const linkedMemory = join(dir, 'hardlink-identity'); mkdirSync(linkedMemory);
  const original = join(dir, 'original.md'); writeFileSync(original, 'Original instructions.');
  linkSync(original, join(linkedMemory, 'AGENTS.md'));
  check('hardlinked identity cannot be read or synchronized', rejects(() => previewAgentInstructions({ ...agent, memoryDir: linkedMemory }), /unverknüpfte/)
    && rejects(() => syncAgentInstructions({ ...agent, memoryDir: linkedMemory }), /unverknüpfte/)
    && readFileSync(original, 'utf8') === 'Original instructions.');
  const target = join(dir, 'target'); mkdirSync(target);
  const redirected = join(dir, 'redirected'); symlinkSync(target, redirected, process.platform === 'win32' ? 'junction' : 'dir');
  check('linked parent directories are rejected even when identity file is absent',
    rejects(() => previewAgentInstructions({ ...agent, memoryDir: redirected }), /Verknüpfung/)
    && rejects(() => syncAgentInstructions({ ...agent, memoryDir: redirected }), /Verknüpfung/)
    && !existsSync(join(target, 'AGENTS.md')));
  const directoryMemory = join(dir, 'directory-identity'); mkdirSync(join(directoryMemory, 'AGENTS.md'), { recursive: true });
  check('invalid identity file is not silently replaced by empty content', rejects(() => syncAgentInstructions({ ...agent, memoryDir: directoryMemory }), /reguläre/));
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
