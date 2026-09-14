import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent, MemorySettings } from '../src/shared/types';
import { previewAgentInstructions } from '../src/main/memory/agentInstructions';
import { buildInteractiveProfileSnapshot } from '../src/main/memory/interactiveProfileSnapshot';
import { buildMemoryBlock } from '../src/main/memory/inject';
import { MemoryStore } from '../src/main/memory/MemoryStore';

let passed = 0;
function check(name: string, action: () => void): void { action(); passed++; console.log(`ok ${name}`); }
const root = mkdtempSync(join(tmpdir(), 'ade-interactive-profile-snapshot-'));
const agent: Agent = { id: 'profile-memory', categoryId: 'test', name: 'Profile Memory', runtime: 'codex', permissionMode: 'default',
  workspaceDir: join(root, 'repo'), memoryDir: join(root, 'memory'), profile: { instructions: 'Geometry specialist.', documents: [] } };
const settings: MemorySettings = { enabled: true, userProfileEnabled: true, memoryCharLimit: 2200, userCharLimit: 1375 };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

check('missing identity and memory files remain absent after read-only snapshot', () => {
  const snapshot = buildInteractiveProfileSnapshot(agent, settings);
  assert.ok(snapshot.content.includes('Geometry specialist.'));
  assert.ok(snapshot.content.includes('How to maintain your memory'));
  assert.equal(existsSync(agent.memoryDir), false); assert.equal(existsSync(agent.workspaceDir), false);
});
mkdirSync(agent.memoryDir); mkdirSync(agent.workspaceDir);
const memoryPath = join(agent.memoryDir, 'MEMORY.md'); const userPath = join(agent.memoryDir, 'USER.md');
const memory = '  Geometry tolerance is 0.01.\n§\nUse millimetres.\n§\nUse millimetres.\n';
const user = 'User prefers German.\n§\nUse concise reports.';
writeFileSync(memoryPath, memory); writeFileSync(userPath, user);
writeFileSync(join(agent.workspaceDir, 'AGENTS.md'), '# Repository instructions untouched\n');
writeFileSync(join(agent.workspaceDir, 'CLAUDE.md'), '# Claude instructions untouched\n');
const profile = previewAgentInstructions(agent);
const first = buildInteractiveProfileSnapshot(agent, settings);
check('enabled memory and user preserve exact legacy rendering and maintenance guidance', () => {
  const expected = buildMemoryBlock(agent, new MemoryStore(agent.memoryDir, { memoryLimit: 2200, userLimit: 1375 }), settings);
  assert.equal(first.content, `${profile.content}\n\n${expected}`);
  assert.ok(first.content.includes(`MEMORY.md -> ${memoryPath}`)); assert.ok(first.content.includes(`USER.md   -> ${userPath}`));
  assert.ok(first.content.includes('HARD CAPS: MEMORY.md 2200 chars, USER.md 1375 chars.'));
});
check('full digest and memory source hashes describe captured contents independently of profile revision', () => {
  assert.equal(first.sha256, hash(first.content)); assert.equal(first.profileDigest, profile.sha256); assert.notEqual(first.sha256, first.profileDigest);
  assert.deepEqual(first.sources.filter((source) => source.kind === 'memory'), [
    { kind: 'memory', name: 'MEMORY.md', sha256: hash(memory), chars: memory.length },
    { kind: 'memory', name: 'USER.md', sha256: hash(user), chars: user.length },
  ]);
});
check('memory changes affect only full snapshot digest while prior snapshot stays immutable', () => {
  writeFileSync(memoryPath, 'New memory revision.');
  const changed = buildInteractiveProfileSnapshot(agent, settings);
  assert.equal(changed.profileDigest, first.profileDigest); assert.notEqual(changed.sha256, first.sha256);
  assert.ok(first.content.includes('Geometry tolerance is 0.01.')); assert.ok(!first.content.includes('New memory revision.'));
  writeFileSync(memoryPath, memory);
});
check('memory disabled leaves the profile snapshot exact and does not inspect disabled sources', () => {
  const target = join(root, 'disabled-target'); mkdirSync(target);
  const linked = join(agent.memoryDir, 'unused-link'); symlinkSync(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
  unlinkSync(memoryPath); mkdirSync(memoryPath);
  const disabled = buildInteractiveProfileSnapshot(agent, { ...settings, enabled: false });
  assert.equal(disabled.content, profile.content); assert.equal(disabled.sha256, profile.sha256);
  assert.ok(!disabled.content.includes('How to maintain your memory'));
});
// Restore by using a new independent identity directory, avoiding recursive removal.
const nextMemory = join(root, 'next-memory'); mkdirSync(nextMemory);
const next = { ...agent, memoryDir: nextMemory };
writeFileSync(join(nextMemory, 'MEMORY.md'), memory);
mkdirSync(join(nextMemory, 'USER.md'));
check('disabled USER is never read and is absent from guidance and provenance', () => {
  const snapshot = buildInteractiveProfileSnapshot(next, { ...settings, userProfileEnabled: false });
  assert.ok(snapshot.content.includes('Geometry tolerance'));
  assert.ok(!snapshot.content.includes('USER.md')); assert.ok(!snapshot.content.includes('USER PROFILE'));
  assert.equal(snapshot.sources.filter((source) => source.kind === 'memory').length, 1);
  assert.throws(() => buildInteractiveProfileSnapshot(next, settings), /reguläre/);
});
check('hardlinked MEMORY is rejected without modifying its original', () => {
  const directory = join(root, 'linked-memory'); mkdirSync(directory);
  const original = join(root, 'original.md'); writeFileSync(original, 'Outside memory.'); linkSync(original, join(directory, 'MEMORY.md'));
  assert.throws(() => buildInteractiveProfileSnapshot({ ...agent, memoryDir: directory }, settings), /unverknüpfte/);
  assert.equal(readFileSync(original, 'utf8'), 'Outside memory.');
});
check('symlinked MEMORY is rejected before reading', () => {
  const directory = join(root, 'redirect-memory'); mkdirSync(directory);
  symlinkSync(nextMemory, join(directory, 'MEMORY.md'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => buildInteractiveProfileSnapshot({ ...agent, memoryDir: directory }, settings), /Verknüpfung/);
});
check('oversized and invalid UTF-8 memory fail clearly instead of silently clipping or replacing', () => {
  const directory = join(root, 'invalid-memory'); mkdirSync(directory);
  const file = join(directory, 'MEMORY.md');
  writeFileSync(file, 'x'.repeat(256 * 1024 + 1));
  assert.throws(() => buildInteractiveProfileSnapshot({ ...agent, memoryDir: directory }, settings), /256 KiB/);
  writeFileSync(file, Buffer.from([0xff, 0xfe, 0xc0]));
  assert.throws(() => buildInteractiveProfileSnapshot({ ...agent, memoryDir: directory }, settings), /UTF-8/);
  writeFileSync(file, 'x'.repeat(31_000));
  assert.throws(() => buildInteractiveProfileSnapshot({ ...agent, memoryDir: directory }, settings), /32000/);
});
check('repository instructions and memory sources have no snapshot side effects', () => {
  assert.equal(readFileSync(join(agent.workspaceDir, 'AGENTS.md'), 'utf8'), '# Repository instructions untouched\n');
  assert.equal(readFileSync(join(agent.workspaceDir, 'CLAUDE.md'), 'utf8'), '# Claude instructions untouched\n');
  assert.equal(readFileSync(userPath, 'utf8'), user);
  assert.equal(readFileSync(join(nextMemory, 'MEMORY.md'), 'utf8'), memory);
  assert.deepEqual(readdirSync(nextMemory).sort(), ['MEMORY.md', 'USER.md']);
  assert.equal(existsSync(join(nextMemory, 'AGENTS.md')), false);
});
console.log(`Interactive profile snapshot: ${passed} passed, 0 failed.`);
