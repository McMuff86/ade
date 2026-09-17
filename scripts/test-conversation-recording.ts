import { randomUUID } from 'node:crypto';
import { ConversationDrafts, conversationDraftKey } from '../src/renderer/conversation/conversationDrafts';
import { ConversationRecording, type ConversationCapture, type ConversationRecordingPort } from '../src/renderer/conversation/ConversationRecording';
import type { DictationJobState } from '../src/shared/dictation';

let passed = 0;
const check = (name: string, value: boolean) => { if (!value) throw new Error(name); passed++; console.log(`  ok  ${name}`); };
const refuses = (fn: () => void) => { try { fn(); return false; } catch { return true; } };
const tick = () => new Promise<void>(r => setImmediate(r));
const controllers: ConversationRecording[] = [];
const make = () => {
  const data = new Map<string, string>(); let broken = false;
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { if (broken) throw new Error('storage full'); data.set(key, value); } };
  const drafts = new ConversationDrafts(storage, 'desktop'); const id = randomUUID();
  const calls: string[] = []; let state: DictationJobState = { status: 'recording', text: 'Spoken preview' };
  let stopped: ((done: Promise<void>) => void) | undefined; let captureCancelled = false; let failStart = false;
  let prepareWait: Promise<void> | undefined; let micWait: Promise<void> | undefined;
  const capture: ConversationCapture = { prepare: async () => { calls.push('microphone'); await micWait; }, start: async (_push, fn) => { calls.push('capture'); stopped = fn; }, stop: () => { stopped?.(Promise.resolve()); }, cancel: () => { captureCancelled = true; } };
  const port: ConversationRecordingPort = {
    microphone: async allow => { calls.push(`permission:${allow}`); },
    prepare: async target => { check('capture request is bound to its original conversation', target === id); await prepareWait; return { jobId: randomUUID() }; },
    start: async jobId => { calls.push('paid-start'); check('host ticket is durable before provider start', drafts.recording(id)?.jobId === jobId); if (failStart) throw new Error('lost paid reply'); },
    chunk: async () => {}, finish: async () => { calls.push('finish'); state = { status: 'complete', transcript: { text: 'Final spoken text', language: 'deu', model: 'scribe_v2_realtime', audioSeconds: 1 } }; },
    query: async () => structuredClone(state), cancel: async () => { calls.push('cancel'); },
  };
  const create = () => { const controller = new ConversationRecording(id, drafts, port, () => capture, () => {}); controllers.push(controller); return controller; };
  return { drafts, id, calls, create, data, storage, broken: () => { broken = true; }, repair: () => { broken = false; }, cancelled: () => captureCancelled,
    state: (v: DictationJobState) => { state = v; }, loseStart: () => { failStart = true; }, prepareWait: (p: Promise<void>) => { prepareWait = p; }, micWait: (p: Promise<void>) => { micWait = p; } };
};
void (async () => {
  const f = make(); const c = f.create(); f.drafts.edit(f.id, 'Typed first');
  await c.start(); await tick();
  check('live transcript remains a private preview and never alters the typed message', c.snapshot().phase === 'recording' && f.drafts.recording(f.id)?.text === 'Spoken preview' && f.drafts.text(f.id) === 'Typed first');
  c.stop(); await tick(); await new Promise(r => setTimeout(r, 400));
  check('stop waits for provider completion and retains the full final text', c.snapshot().phase === 'preview' && c.snapshot().value?.complete === true && c.snapshot().value?.text === 'Final spoken text');
  f.drafts.edit(f.id, 'Newer typed note');
  check('explicit apply appends to the latest draft exactly once', c.apply() === 'Newer typed note\nFinal spoken text' && c.apply() === undefined && !f.drafts.recording(f.id));
  const partial = make(); const p = partial.create(); await p.start(); await tick(); p.dispose();
  check('closing stops the microphone and leaves partial text on the original conversation', partial.cancelled() && partial.calls.includes('cancel') && partial.drafts.recording(partial.id)?.text === 'Spoken preview' && !partial.drafts.recording(partial.id)?.complete);
  const reload = partial.create(); partial.state({ status: 'cancelled' }); await reload.recover();
  check('reopening an interrupted recording never makes a second paid call', partial.calls.filter(c => c === 'paid-start').length === 1 && reload.snapshot().phase === 'preview' && !reload.snapshot().value?.complete);
  check('a recovered partial can be explicitly accepted without automatic model sending', reload.apply() === 'Spoken preview' && !partial.drafts.read().pending.length);
  const lost = make(); lost.loseStart(); const l = lost.create(); await l.start(); await l.start();
  check('lost start acknowledgement preserves ticket and never retries paid start', lost.calls.filter(c => c === 'paid-start').length === 1 && lost.cancelled() && !!lost.drafts.recording(lost.id) && /lost paid/.test(l.snapshot().error));
  l.discard(); check('explicit discard removes only the failed voice preview', !lost.drafts.recording(lost.id) && l.snapshot().phase === 'idle');
  const late = make(); let release!: () => void; late.prepareWait(new Promise<void>(r => { release = r; }));
  const d = late.create(); const preparing = d.start(); await tick(); d.dispose(); release(); await preparing;
  check('late ticket after closing is cancelled without provider start or draft mutation', late.calls.includes('cancel') && !late.calls.includes('paid-start') && !late.drafts.recording(late.id));
  const mic = make(); let micRelease!: () => void; mic.micWait(new Promise<void>(r => { micRelease = r; }));
  const m = mic.create(); const asking = m.start(); await tick(); m.dispose(); micRelease(); await asking;
  check('closing a pending microphone permission never prepares a paid job', !mic.calls.includes('paid-start') && mic.cancelled() && mic.calls.at(-1) === 'permission:false');
  const full = make(); full.broken(); const b = full.create(); await b.start();
  check('failed local recovery reservation cancels ticket before any paid start', !full.calls.includes('paid-start') && full.calls.includes('cancel') && full.cancelled());
  const failedSave = make(); const unsaved = failedSave.create(); await unsaved.start(); await tick(); failedSave.broken();
  unsaved.stop(); await tick(); await new Promise(r => setTimeout(r, 400)); failedSave.repair();
  check('failed final transcript save keeps the full text visible for copying', unsaved.snapshot().value?.text === 'Final spoken text' && /storage full/.test(unsaved.snapshot().error));
  check('apply cannot substitute an older persisted partial for the displayed final text', unsaved.apply() === undefined && failedSave.drafts.text(failedSave.id) === '' && unsaved.snapshot().value?.text === 'Final spoken text');
  const overflow = make(); const v = { id: overflow.id, jobId: randomUUID(), text: 'Spoken', complete: true };
  overflow.drafts.edit(overflow.id, 'a'.repeat(64 * 1024)); overflow.drafts.saveRecording(v, true);
  check('combined text beyond conversation limit preserves both texts without truncation', refuses(() => overflow.drafts.consumeRecording(v.id, v.jobId)) && overflow.drafts.text(v.id).length === 64 * 1024 && overflow.drafts.recording(v.id)?.text === 'Spoken');
  const other = randomUUID(); overflow.drafts.edit(other, 'Other conversation');
  check('foreign identity and replaced ticket cannot update or consume another preview', refuses(() => overflow.drafts.saveRecording({ ...v, jobId: randomUUID() })) && refuses(() => overflow.drafts.consumeRecording(other, v.jobId)) && overflow.drafts.text(other) === 'Other conversation');
  check('audio and native selectors are rejected by the local recovery schema', refuses(() => { overflow.data.set(conversationDraftKey('desktop'), JSON.stringify({ ...overflow.drafts.read(), recordings: [{ ...v, audio: 'private' }] })); overflow.drafts.read(); }));
  const legacy = make(); legacy.data.set(conversationDraftKey('desktop'), JSON.stringify({ version: 1, selected: legacy.id, drafts: [{ id: legacy.id, text: 'Before voice' }], pending: [] }));
  check('version one recovery migrates without losing selection or text', legacy.drafts.read().version === 2 && legacy.drafts.read().selected === legacy.id && legacy.drafts.text(legacy.id) === 'Before voice');
  legacy.drafts.saveRecording({ id: legacy.id, jobId: randomUUID(), text: 'After negatives', complete: true }, true);
  const final = legacy.create(); check('final positive control appends speech after all rejection cases', final.apply() === 'Before voice\nAfter negatives');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { controllers.forEach(c => c.dispose()); console.log(`\nConversation recording: ${passed} passed, ${process.exitCode ? 1 : 0} failed`); });
