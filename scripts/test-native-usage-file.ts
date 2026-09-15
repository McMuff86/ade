import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { findNativeUsageFile, NativeUsageTail } from '../src/main/usage/NativeUsageFile';

let passed = 0;
const check = (name: string, value: boolean) => { if (!value) throw new Error(name); passed++; console.log(`  ok ${name}`); };
const refuses = (operation: () => unknown): boolean => { try { operation(); return false; } catch { return true; } };
const root = mkdtempSync(join(tmpdir(), 'ade-usage-file-'));
const put = (file: string, value: string | Buffer) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, value); };
try {
  const nativeId = '01234567-89ab-4cde-8f01-23456789abcd';
  check('missing provider history waits without guessing another session', findNativeUsageFile(root, 'claude', nativeId) === undefined);
  const claude = join(root, 'projects', 'a-project', `${nativeId}.jsonl`); put(claude, '{"known":1}\n');
  check('Claude uses the exact native identity', findNativeUsageFile(root, 'claude', nativeId) === claude);
  put(join(root, 'projects', 'newer-project', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl'), '{}\n');
  check('a more recent unrelated file cannot change the selected source', findNativeUsageFile(root, 'claude', nativeId) === claude);
  const duplicate = join(root, 'projects', 'other-project', `${nativeId}.jsonl`); put(duplicate, '{}\n');
  check('ambiguous native identities fail closed', refuses(() => findNativeUsageFile(root, 'claude', nativeId)));
  rmSync(duplicate);
  const grok = join(root, 'sessions', 'encoded-project', nativeId, 'updates.jsonl'); put(grok, '{}\n');
  check('Grok matches the explicit session directory', findNativeUsageFile(root, 'grok', nativeId) === grok);
  check('source IDs cannot escape the provider home', refuses(() => findNativeUsageFile(root, 'grok', '../../outside')));
  check('relative provider homes are refused', refuses(() => findNativeUsageFile('relative', 'claude', nativeId)));
  check('an unproven Codex UUID format is refused', refuses(() => findNativeUsageFile(root, 'codex', nativeId)));
  const now = Date.now(); const hex = now.toString(16).padStart(12, '0'); const codexId = `${hex.slice(0, 8)}-${hex.slice(8)}-7123-8123-0123456789ab`;
  const bucket = new Date(now - 86400000).toISOString().slice(0, 10).split('-');
  const codex = join(root, 'sessions', ...bucket, `rollout-fixture-${codexId}.jsonl`); put(codex, '{}\n');
  check('Codex UUIDv7 allows the adjacent local-time date bucket with an exact ID', findNativeUsageFile(root, 'codex', codexId) === codex);
  check('a tail cannot read outside its provider home', refuses(() => new NativeUsageTail(root, join(dirname(root), 'outside.jsonl'))));

  const file = join(root, 'tail.jsonl'); const text = Buffer.from('{"value":"Grüsse"}\n'); const split = text.indexOf(Buffer.from('ü')) + 1;
  put(file, text.subarray(0, split)); const tail = new NativeUsageTail(root, file);
  check('partial UTF-8 and an incomplete JSON line wait for completion', tail.read().lines.length === 0);
  appendFileSync(file, text.subarray(split)); const completed = tail.read();
  check('split UTF-8 completes without replacement or double counting', !completed.gap && (completed.lines[0]?.value as { value: string }).value === 'Grüsse');
  check('an unchanged file emits no repeated lines', tail.read().lines.length === 0);
  appendFileSync(file, '\r\n{broken}\n{"value":2}\n'); const recovery = tail.read();
  check('malformed source lines report a gap while later usage remains readable', recovery.gap && recovery.lines.length === 1 && (recovery.lines[0].value as { value: number }).value === 2);
  check('line offsets remain native byte offsets', recovery.lines[0].offset === text.length + Buffer.byteLength('\r\n{broken}\n'));
  appendFileSync(file, Buffer.from([0xff, 10]));
  check('invalid UTF-8 is a gap instead of silently replaced content', tail.read().gap);
  truncateSync(file, 0);
  check('truncated native logs cannot reset the observed counter silently', refuses(() => tail.read()));

  const bounded = join(root, 'bounded.jsonl'); put(bounded, Array.from({ length: 600 }, (_, n) => JSON.stringify({ n })).join('\n') + '\n');
  const boundedTail = new NativeUsageTail(root, bounded); const first = boundedTail.read(); const second = boundedTail.read(); const third = boundedTail.read();
  check('a read processes at most 256 complete source lines', first.lines.length === 256 && first.more);
  check('bounded reads retain remaining lines once and in order', second.lines.length === 256 && third.lines.length === 88 && !third.more && (third.lines[87].value as { n: number }).n === 599);
  const oversized = join(root, 'oversized.jsonl'); put(oversized, JSON.stringify({ private: 'x'.repeat(700 * 1024) }) + '\n{"after":true}\n');
  const oversizedTail = new NativeUsageTail(root, oversized); let gaps = 0; const values: unknown[] = []; let more = true; let reads = 0;
  while (more && reads++ < 12) { const result = oversizedTail.read(); if (result.gap) gaps++; values.push(...result.lines.map(line => line.value)); more = result.more; }
  check('oversized prompt/image lines are bounded and visibly skipped', gaps > 0 && values.length === 1 && (values[0] as { after: boolean }).after === true && !more);
  const before = readFileSync(bounded); renameSync(bounded, `${bounded}.old`); put(bounded, before);
  check('replacement at the same pathname is refused', refuses(() => boundedTail.read()));
  const linked = join(root, 'linked-projects'); symlinkSync(join(root, 'projects'), linked, process.platform === 'win32' ? 'junction' : 'dir');
  check('directory links cannot redirect a native source reader', refuses(() => new NativeUsageTail(root, join(linked, 'a-project', `${nativeId}.jsonl`)).read()));
  const final = new NativeUsageTail(root, claude).read();
  check('final positive exact source remains usable after negative controls', !final.gap && (final.lines[0].value as { known: number }).known === 1);
  console.log(`Native usage file: ${passed} passed, 0 failed`);
} finally {
  const target = resolve(root); const prefix = resolve(tmpdir());
  if (!target.startsWith(`${prefix}\\`) && !target.startsWith(`${prefix}/`)) throw new Error('Invalid test cleanup path');
  rmSync(target, { recursive: true, force: true });
}
