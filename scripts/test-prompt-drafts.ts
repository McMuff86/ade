import { PromptDraftStore } from '../src/renderer/terminal/promptDrafts';
import { randomUUID } from 'node:crypto';

let passed = 0;
function check(name: string, ok: boolean) { if (!ok) throw new Error(name); passed++; console.log(`  ok ${name}`); }
function refuses(name: string, operation: () => unknown) {
  try { operation(); } catch { check(name, true); return; } throw new Error(`${name}: unexpectedly allowed`);
}
try {
  let raw: string | null = null; let blocked = false;
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { if (blocked) throw new Error('quota'); raw = value; } };
  const store = new PromptDraftStore(storage);
  check('new session begins with an empty draft', store.read('desktop/session-a').text === '');
  store.save('desktop/session-a', { text: 'Task A' }); store.save('desktop/session-b', { text: 'Task B' });
  check('project switch cannot replace another session draft', store.read('desktop/session-a').text === 'Task A' && store.read('desktop/session-b').text === 'Task B');
  check('reload recovers the same draft without a terminal action', new PromptDraftStore(storage).read('desktop/session-a').text === 'Task A');
  const commandId = randomUUID(); const recordingJob = randomUUID();
  store.save('mobile/device/session-a', { text: 'Noch prüfen', recordingJob, delivery: { commandId, mode: 'submit' } });
  check('recording ticket and uncertain delivery survive reload', new PromptDraftStore(storage).read('mobile/device/session-a').delivery?.commandId === commandId
    && store.read('mobile/device/session-a').recordingJob === recordingJob);
  check('desktop and device drafts never alias', store.read('desktop/session-a').text === 'Task A');
  store.save('desktop/session-a', { text: 'Task A\nPartial speech', recordingInterrupted: true });
  check('interrupted speech stays marked on its original target after reload', new PromptDraftStore(storage).read('desktop/session-a').recordingInterrupted === true
    && store.read('desktop/session-b').text === 'Task B');
  refuses('interrupted recording flag cannot contain arbitrary data', () => store.save('desktop/session-a', { text: 'x', recordingInterrupted: 'audio' } as never));
  store.save('desktop/session-a', { text: 'Task A' });
  refuses('oversized prompt is refused', () => store.save('desktop/session-a', { text: 'x'.repeat(12001) }));
  refuses('caller cannot store audio or provider fields', () => store.save('desktop/session-a', { text: 'x', audio: 'forbidden' } as never));
  blocked = true; const previous = raw;
  refuses('storage denial is surfaced before claiming durability', () => store.save('desktop/session-a', { text: 'new' })); blocked = false;
  check('failed save leaves older durable drafts unchanged', raw === previous && store.read('desktop/session-a').text === 'Task A');
  for (let index = 0; index < 13; index++) store.save(`desktop/extra-${index}`, { text: 'retained' });
  refuses('seventeenth draft cannot evict existing unsent text', () => store.save('desktop/overflow', { text: 'new' }));
  check('full store retains original draft', store.read('desktop/session-a').text === 'Task A');
  store.save('desktop/extra-0', { text: '' }); store.save('desktop/overflow', { text: 'new' });
  check('explicitly deleting a draft frees one slot', store.read('desktop/overflow').text === 'new' && store.read('desktop/extra-0').text === '');
  raw = '{corrupt';
  refuses('corrupt storage produces a recovery error', () => store.read('desktop/session-a'));
  refuses('corrupt storage is not overwritten by an unrelated new draft', () => store.save('desktop/session-a', { text: 'replacement' }));
  check('corrupt original is preserved byte-for-byte', raw === '{corrupt');
  raw = null; store.save('desktop/final', { text: 'Abschluss' });
  check('final positive draft recovery passes', new PromptDraftStore(storage).read('desktop/final').text === 'Abschluss');
  console.log(`Prompt drafts: ${passed} passed, 0 failed`);
} catch (error) { console.error(error); console.log(`Prompt drafts: ${passed} passed, 1 failed`); process.exitCode = 1; }
