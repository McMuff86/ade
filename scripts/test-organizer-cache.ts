import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { OrganizerCache, cachedDocument, emptyOrganizerCache, validOrganizerCache, type OrganizerCacheState, type OrganizerCacheStorage, type OrganizerPort } from '../src/renderer/organizer/OrganizerCache';
import { OrganizerService } from '../src/main/organizer/OrganizerService';
import { OrganizerEditing, retainOrganizerEditing, releaseOrganizerEditing, hasUnsavedOrganizerEditing, forgetOrganizerEditing } from '../src/renderer/organizer/OrganizerEditing';
import { newOrganizerDocument } from '../src/shared/organizer';
let passed = 0; let failed = 0;
function check(name: string, ok: boolean) { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } }
async function refuses(action: () => unknown) { try { await action(); return false; } catch { return true; } }
class Memory implements OrganizerCacheStorage {
  state = emptyOrganizerCache(); denied = false;
  async transaction<T>(change: (state: OrganizerCacheState) => T): Promise<T> {
    const next = structuredClone(this.state); const result = change(next);
    if (this.denied || !validOrganizerCache(next)) throw new Error('Storage denied');
    this.state = next; return result;
  }
}
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-organizer-cache-')));
void (async () => {
  const service = new OrganizerService(join(root, 'organizer.json')); const storage = new Memory(); const cache = new OrganizerCache(storage);
  const port: OrganizerPort = { list: async () => service.store.index(), detail: async id => ({ entry: service.store.detail(id), redacted: false }),
    sequence: async id => service.store.writerSequence(id, 'tablet'), save: async input => service.command(input, 'tablet') };
  const document = newOrganizerDocument('note'); document.title = 'Offline'; document.text = 'Zuerst lokal';
  await cache.edit(document, null);
  check('first edit is durable locally before any network request', (await new OrganizerCache(storage).snapshot()).entries[0]?.draft?.text === document.text && service.store.index().entries.length === 0);
  check('independent device storage has no drafts from this identity', !(await new OrganizerCache(new Memory()).snapshot()).entries.length);
  check('flush creates one server document and clears only confirmed draft', await cache.flush(port) === 1 && service.store.index().entries.length === 1 && !(await cache.snapshot()).entries[0]?.draft);
  const entry = (await cache.snapshot()).entries[0]!;
  await cache.edit({ ...document, text: 'Antwort verloren' }, entry.localVersion);
  let lost = true;
  const unreliable: OrganizerPort = { ...port, save: async input => { const result = await port.save(input); if (lost) { lost = false; throw new Error('Network lost after write'); } return result; } };
  check('lost save reply retains exact pending command', await refuses(() => cache.flush(unreliable)) && !!(await cache.snapshot()).pending);
  const pending = structuredClone((await cache.snapshot()).pending);
  check('reopening restores writer and exact unsent/retry body', JSON.stringify((await new OrganizerCache(storage).snapshot()).pending) === JSON.stringify(pending));
  await new OrganizerCache(storage).flush(unreliable);
  check('retry confirms accepted change without a duplicate conflict', service.store.index().entries.length === 1 && !(await cache.snapshot()).pending && service.store.detail(document.id)?.document.text === 'Antwort verloren');
  const other = new OrganizerCache(new Memory()); await other.refresh(port);
  check('second browser fetches complete saved notes', cachedDocument((await other.snapshot()).entries[0]!)?.text === 'Antwort verloren');
  const beforeOther = (await other.snapshot()).entries[0]!;
  await other.edit({ ...document, text: 'Tablet offline' }, beforeOther.localVersion);
  const beforeLocal = (await cache.snapshot()).entries[0]!;
  await cache.edit({ ...document, text: 'PC edit' }, beforeLocal.localVersion); await cache.flush(port);
  await other.refresh(port);
  check('refresh keeps unsynced draft and its original base revision', (await other.snapshot()).entries[0]?.draft?.text === 'Tablet offline' && (await other.snapshot()).entries[0]?.base?.revision === beforeOther.base?.revision);
  await other.flush(port); await other.refresh(port);
  check('offline conflict preserves both devices and links the copy', service.store.index().entries.length === 2 && service.store.index().entries.some(item => item.conflictOf === document.id)
    && service.store.index().entries.some(item => service.store.detail(item.id)?.document.text === 'Tablet offline') && service.store.detail(document.id)?.document.text === 'PC edit');
  const firstView = (await cache.snapshot()).entries.find(item => item.id === document.id)!;
  await cache.edit({ ...document, text: 'Browser tab A' }, firstView.localVersion);
  const tabB = await cache.edit({ ...document, text: 'Browser tab B' }, firstView.localVersion);
  check('two local editor versions create a conflict copy rather than overwrite', tabB.id !== document.id && (await cache.snapshot()).entries.find(item => item.id === document.id)?.draft?.text === 'Browser tab A');
  const lateStorage = new Memory(); const late = new OrganizerCache(lateStorage);
  const lateDoc = newOrganizerDocument('note'); const lateLocal = await late.edit({ ...lateDoc, text: 'v1' }, null);
  let once = true;
  await late.flush({ ...port, save: async input => {
    const result = await port.save(input);
    if (once) { once = false; await late.edit({ ...lateDoc, text: 'v2 while saving' }, lateLocal.localVersion); }
    return result;
  } });
  check('edits typed while request is pending are sent after its acknowledgement', service.store.detail(lateDoc.id)?.document.text === 'v2 while saving' && !((await late.snapshot()).entries[0]?.draft));
  const racingStorage = new Memory(); const racing = new OrganizerCache(racingStorage); const racingDoc = newOrganizerDocument('note');
  const racingLocal = await racing.edit({ ...racingDoc, text: 'v1' }, null); let race = true;
  await racing.flush({ ...port, save: async input => {
    const result = await port.save(input);
    if (race) { race = false; await racing.edit({ ...racingDoc, text: 'local v2' }, racingLocal.localVersion);
      service.command({ writerId: randomUUID(), sequence: 1, baseRevision: result.revision, operation: 'put', document: { ...racingDoc, text: 'other device v2' } }, 'desktop'); }
    return result;
  } });
  check('new remote edit between save and detail cannot become a false base for newer typing', service.store.detail(racingDoc.id)?.document.text === 'other device v2'
    && service.store.index().entries.some(item => item.conflictOf === racingDoc.id && service.store.detail(item.id)?.document.text === 'local v2'));
  const deletedLocal = await cache.edit(newOrganizerDocument('task'), null); await cache.remove(deletedLocal.id, deletedLocal.localVersion);
  check('never-sent local draft can be removed without issuing server delete', !(await cache.snapshot()).entries.some(item => item.id === deletedLocal.id));
  check('stale editor cannot delete a newer local version', await refuses(() => cache.remove(document.id, firstView.localVersion)));
  storage.denied = true; const bytes = JSON.stringify(storage.state);
  check('quota failure never pretends a draft is saved or changes previous state', await refuses(() => cache.edit(newOrganizerDocument('note'), null)) && JSON.stringify(storage.state) === bytes);
  storage.denied = false;
  const converted = await cache.taskFromNote({ ...document, text: 'Full note', images: [], sketch: document.sketch }, 'Selected paragraph');
  check('note conversion keeps provenance and only requested text', converted.draft?.kind === 'task' && converted.draft.sourceNoteId === document.id && converted.draft.text === 'Selected paragraph' && converted.id !== document.id);
  check('invalid restored queue cannot execute arbitrary operations', !validOrganizerCache({ ...storage.state, pending: { input: { operation: 'shell', writerId: storage.state.writerId }, localVersion: 0 } }));
  let calls = 0; await cache.flush({ ...port, save: async input => { calls++; return port.save(input); } }, () => false);
  check('identity cancellation prevents network submission', calls === 0);
  const rejectedStorage = new Memory(); const rejected = new OrganizerCache(rejectedStorage); await rejected.edit(newOrganizerDocument('task'), null);
  await refuses(() => rejected.flush({ ...port, save: async () => { throw new Error('definitive rejection'); } }));
  await rejected.releaseRejected(port);
  check('confirmed unexecuted rejection releases queue without dropping original draft', !(await rejected.snapshot()).pending && (await rejected.snapshot()).sequence === 0 && !!(await rejected.snapshot()).entries[0]?.draft);
  await rejected.flush(port);
  check('final positive control synchronizes retained draft after rejection', !(await rejected.snapshot()).pending && !(await rejected.snapshot()).entries[0]?.draft);
  const editStorage = new Memory(); const editCache = new OrganizerCache(editStorage); const editable = await editCache.edit(newOrganizerDocument('note'), null);
  const editor = retainOrganizerEditing('test', editCache, editable); editStorage.denied = true;
  check('failed editor write reports a storage failure and keeps original cache', await refuses(() => editor.edit({ ...editor.document(), text: 'Nicht verlieren' }))
    && editor.error === 'Storage denied' && editor.dirty && cachedDocument((await editCache.snapshot().catch(() => null))?.entries[0] ?? editable)?.text === '');
  releaseOrganizerEditing('test', editable.id);
  const reopened = retainOrganizerEditing('test', editCache, editable);
  check('switching away and back preserves the actual unsaved text and warning', reopened === editor && reopened.document().text === 'Nicht verlieren' && hasUnsavedOrganizerEditing('test'));
  editStorage.denied = false; await reopened.flush();
  check('retry makes retained draft durable before clearing its warning', !reopened.error && !reopened.dirty && cachedDocument((await editCache.snapshot()).entries[0]!)?.text === 'Nicht verlieren');
  releaseOrganizerEditing('test', editable.id);
  const fresh = retainOrganizerEditing('test', editCache, (await editCache.snapshot()).entries[0]!);
  check('saved unmounted editor releases its memory retention', fresh !== editor && !hasUnsavedOrganizerEditing());
  releaseOrganizerEditing('test', editable.id);
  let resume!: () => void; const barrier = new Promise<void>(resolve => { resume = resolve; }); let slow = true;
  const serialCache = new OrganizerCache({ transaction: async change => { if (slow) await barrier; return editStorage.transaction(change); } });
  const serial = new OrganizerEditing(serialCache, (await editCache.snapshot()).entries[0]!);
  const firstSave = serial.edit({ ...serial.document(), text: 'Erster Text' });
  await Promise.resolve(); const latestSave = serial.edit({ ...serial.document(), text: 'Während Speichern ergänzt' });
  slow = false; resume(); await Promise.all([firstSave, latestSave]);
  check('typing during local save coalesces into the latest durable document', !serial.dirty && cachedDocument((await editCache.snapshot()).entries[0]!)?.text === 'Während Speichern ergänzt');
  const stale = new OrganizerEditing(editCache, (await editCache.snapshot()).entries[0]!);
  const otherEditorEntry = (await editCache.snapshot()).entries[0]!; await editCache.edit({ ...cachedDocument(otherEditorEntry)!, text: 'Zweite Ansicht' }, otherEditorEntry.localVersion);
  await stale.edit({ ...stale.document(), text: 'Erste Ansicht weiterhin' });
  await stale.edit({ ...stale.document(), text: 'Erste Ansicht fertig' });
  const copies = (await editCache.snapshot()).entries;
  check('stale local editor continues in one preserved conflict copy', copies.length === 2 && copies.some(item => cachedDocument(item)?.text === 'Zweite Ansicht') && copies.some(item => cachedDocument(item)?.text === 'Erste Ansicht fertig'));
  const privateEditor = retainOrganizerEditing('device-old', editCache, copies[0]!); editStorage.denied = true;
  await refuses(() => privateEditor.edit({ ...privateEditor.document(), text: 'Private ungesicherte Notiz' })); forgetOrganizerEditing('device-old');
  check('forgetting identity removes retained private drafts', !hasUnsavedOrganizerEditing('device-old'));
  editStorage.denied = false;
  const task = await editCache.taskFromNote(cachedDocument(copies[0]!)!); const dispatch = await editCache.reserveDispatch({ documentId: task.id, repositoryId: 'repo', agentId: 'agent', prompt: 'Ausführen' });
  const retry = await new OrganizerCache(editStorage).reserveDispatch({ documentId: task.id, repositoryId: 'other', agentId: 'other', prompt: 'Nicht ersetzen' });
  check('agent dispatch retry retains original key and reviewed payload', JSON.stringify(dispatch) === JSON.stringify(retry));
  await editCache.confirmDispatch(dispatch, 'run-confirmed'); await editCache.confirmDispatch(dispatch, 'run-confirmed');
  check('agent result links once without marking personal task complete', cachedDocument((await editCache.snapshot()).entries.find(item => item.id === task.id)!)?.runIds.join(',') === 'run-confirmed'
    && !cachedDocument((await editCache.snapshot()).entries.find(item => item.id === task.id)!)?.done && !(await editCache.snapshot()).dispatches.length);
  const deleteStorage = new Memory(); const deleteCache = new OrganizerCache(deleteStorage); const deletionDoc = newOrganizerDocument('note'); deletionDoc.text = 'Ursprünglich';
  await deleteCache.edit(deletionDoc, null); await deleteCache.flush(port); const deletionEntry = (await deleteCache.snapshot()).entries[0]!;
  service.command({ operation: 'put', writerId: randomUUID(), sequence: 1, baseRevision: deletionEntry.base!.revision, document: { ...deletionDoc, text: 'Änderung am PC' } }, 'desktop');
  await deleteCache.remove(deletionDoc.id, deletionEntry.localVersion);
  check('definitively rejected stale deletion restores the newer entry', await refuses(() => deleteCache.flush({ ...port, wasRejected: () => true }))
    && !(await deleteCache.snapshot()).pending && !(await deleteCache.snapshot()).entries[0]?.deletePending && cachedDocument((await deleteCache.snapshot()).entries[0]!)?.text === 'Änderung am PC');
  const nextAfterRejection = newOrganizerDocument('note'); nextAfterRejection.title = 'Danach'; await deleteCache.edit(nextAfterRejection, null); await deleteCache.flush(port);
  check('rejected deletion does not block subsequent independent changes', !!service.store.detail(nextAfterRejection.id) && service.store.detail(deletionDoc.id)?.document.text === 'Änderung am PC');
})().catch(error => { failed++; console.error(error); }).finally(() => {
  if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected temporary directory');
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  console.log(`Organizer cache: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
});
