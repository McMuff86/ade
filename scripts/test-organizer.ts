import { randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ORGANIZER_LIMITS, legacySketchId, newOrganizerDocument, newOrganizerSketch, organizerCommandKey, organizerId, upgradeOrganizerDocument, validOrganizerDocument, validOrganizerMutation, validOrganizerQuery, type OrganizerDocument, type OrganizerMutation } from '../src/shared/organizer';
import { OrganizerError, OrganizerStore } from '../src/main/organizer/OrganizerStore';
import { OrganizerReminders } from '../src/main/organizer/OrganizerReminders';
let passed = 0; let failed = 0;
function check(name: string, ok: boolean): void { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } }
function refuses(action: () => unknown, code?: OrganizerError['code']): boolean { try { action(); return false; } catch (error) { return !code || error instanceof OrganizerError && error.code === code; } }
const root = mkdtempSync(join(tmpdir(), 'ade-organizer-'));
try {
  const file = join(root, 'profile', 'organizer.json'); let now = 1_000;
  const store = new OrganizerStore(file, () => now);
  const note = newOrganizerDocument('note'); note.title = 'Idee'; note.text = 'Skizze für morgen';
  const writer = randomUUID(); const otherWriter = randomUUID(); const owner = 'desktop';
  const input: OrganizerMutation = { operation: 'put', writerId: writer, sequence: 1, baseRevision: 0, document: note };
  check('new profile reads empty without writing', store.index().revision === 0 && !existsSync(file));
  check('valid note and writer command', validOrganizerDocument(note) && validOrganizerMutation(input));
  check('command key binds writer and sequence', organizerCommandKey(input) === `${writer}:1`);
  check('strict query shapes accept only declared operations', validOrganizerQuery({ operation: 'list' }) && validOrganizerQuery({ operation: 'detail', id: note.id }) && !validOrganizerQuery({ operation: 'list', path: 'C:\\secret' }));
  const first = store.mutate(input, owner);
  check('first save returns persisted version', first.revision === 1 && first.id === note.id && !first.conflict);
  check('restart restores full document and writer checkpoint', new OrganizerStore(file).detail(note.id)?.document.text === note.text && new OrganizerStore(file).writerSequence(writer, owner) === 1);
  const beforeReplay = readFileSync(file, 'utf8'); const repeated = new OrganizerStore(file).mutate(input, owner);
  check('lost reply replays after process restart without another write', repeated.replayed && readFileSync(file, 'utf8') === beforeReplay);
  check('same key with changed body is refused', refuses(() => store.mutate({ ...input, document: { ...note, text: 'Changed payload' } }, owner), 'key_reused'));
  check('writer cannot move to another principal', refuses(() => store.mutate(input, 'device:foreign'), 'writer_owner'));
  check('writer checkpoint itself is owner-protected', refuses(() => store.writerSequence(writer, 'device:foreign'), 'writer_owner'));
  check('gaps cannot skip pending edits', refuses(() => store.mutate({ ...input, sequence: 3 }, owner), 'sequence_gap'));
  first.id = randomUUID(); const detached = store.detail(note.id)!; detached.document.text = 'external mutation';
  check('returned receipt and document cannot mutate storage', store.detail(note.id)?.document.text === note.text && store.mutate(input, owner).id === note.id);
  now = 2_000;
  const second = store.mutate({ ...input, sequence: 2, baseRevision: 1, document: { ...note, text: 'PC version' } }, owner);
  check('editing advances global revision and preserves creation time', second.revision === 2 && store.detail(note.id)?.createdAt === 1_000 && store.detail(note.id)?.updatedAt === 2_000);
  const staleInput: OrganizerMutation = { ...input, writerId: otherWriter, baseRevision: 1, document: { ...note, text: 'Offline tablet version' } };
  const conflict = store.mutate(staleInput, 'device:tablet');
  check('concurrent edit creates a separate conflict document', conflict.conflict && conflict.id !== note.id && store.detail(conflict.id)?.conflictOf === note.id);
  check('conflict preserves both original and offline body', store.detail(note.id)?.document.text === 'PC version' && store.detail(conflict.id)?.document.text === 'Offline tablet version');
  check('conflict retry never creates a second copy', store.mutate(staleInput, 'device:tablet').id === conflict.id && store.index().entries.length === 2);
  check('old sequence cannot execute again after later save', refuses(() => store.mutate(input, owner), 'sequence_old'));
  const deletion: OrganizerMutation = { operation: 'delete', writerId: writer, sequence: 3, baseRevision: 1, id: note.id };
  check('stale delete preserves newer content', refuses(() => store.mutate(deletion, owner), 'changed') && !store.detail(note.id)?.deleted);
  check('rejected change does not consume writer sequence', store.writerSequence(writer, owner) === 2);
  const deleted = store.mutate({ ...deletion, baseRevision: 2 }, owner);
  check('delete keeps tombstone and version', deleted.deleted && store.detail(note.id)?.deleted === true);
  const afterDelete = store.mutate({ ...staleInput, sequence: 2 }, 'device:tablet');
  check('offline save after deletion becomes conflict, preserving tombstone', afterDelete.conflict && store.detail(note.id)?.deleted === true && !store.detail(afterDelete.id)?.deleted);
  const absent = newOrganizerDocument('task');
  check('unknown base record is refused without discarding draft', refuses(() => store.mutate({ ...input, sequence: 4, baseRevision: 99, document: absent }, owner), 'missing'));
  check('existing document cannot change task/note type', refuses(() => store.mutate({ ...input, sequence: 4, baseRevision: deleted.revision, document: { ...note, kind: 'task' } }, owner), 'invalid'));
  const task = newOrganizerDocument('task'); task.title = 'Rhino prüfen'; task.repositoryId = 'rhino'; task.dueAt = 4_000; task.reminderAt = 3_000;
  task.checklist = [{ id: randomUUID(), text: 'Modell öffnen', done: false }]; task.sourceNoteId = note.id;
  const taskResult = store.mutate({ ...input, sequence: 4, baseRevision: 0, document: task }, owner);
  check('task checklist, project, dates and source note survive reload', JSON.stringify(new OrganizerStore(file).detail(task.id)?.document) === JSON.stringify(task));
  const invalids: Array<[string, unknown]> = [
    ['host path reference', { ...task, repositoryId: 'C:\\private' }], ['unknown field', { ...task, command: 'exec' }],
    ['overlong title', { ...task, title: 'x'.repeat(201) }], ['NUL text', { ...task, text: '\0' }],
    ['invalid date', { ...task, dueAt: Infinity }], ['negative date', { ...task, reminderAt: -1 }],
    ['duplicate checklist IDs', { ...task, checklist: [task.checklist[0], task.checklist[0]] }],
    ['oversized text', { ...task, text: 'a'.repeat(ORGANIZER_LIMITS.text + 1) }],
    ['unknown image type', { ...task, images: [{ id: randomUUID(), name: 'svg', mime: 'image/svg+xml', base64: 'AAAA', width: 10, height: 10 }] }],
    ['script color', { ...note, sketches: [{ ...newOrganizerSketch(), strokes: [{ id: randomUUID(), color: 'url(http://evil)', width: 2, points: [{ x: 1, y: 1, pressure: .5 }] }] }] }],
    ['out of canvas point', { ...note, sketches: [{ ...newOrganizerSketch(), strokes: [{ id: randomUUID(), color: '#abcdef', width: 2, points: [{ x: 2000, y: 1, pressure: .5 }] }] }] }],
    ['note cannot hide task fields', { ...note, done: true }],
    ['unknown brush', { ...note, sketches: [{ ...newOrganizerSketch(), strokes: [{ id: randomUUID(), color: '#abcdef', width: 2, points: [{ x: 1, y: 1, pressure: .5 }], brush: 'spray' }] }] }],
    ['opacity above one', { ...note, sketches: [{ ...newOrganizerSketch(), strokes: [{ id: randomUUID(), color: '#abcdef', width: 2, points: [{ x: 1, y: 1, pressure: .5 }], opacity: 1.5 }] }] }],
    ['opacity below the floor', { ...note, sketches: [{ ...newOrganizerSketch(), strokes: [{ id: randomUUID(), color: '#abcdef', width: 2, points: [{ x: 1, y: 1, pressure: .5 }], opacity: 0.01 }] }] }],
    ['stroke with a foreign key', { ...note, sketches: [{ ...newOrganizerSketch(), strokes: [{ id: randomUUID(), color: '#abcdef', width: 2, points: [{ x: 1, y: 1, pressure: .5 }], texture: 'x' }] }] }],
  ];
  for (const [name, bad] of invalids) check(`validation rejects ${name}`, !validOrganizerDocument(bad));
  check('strokes may carry a known brush and a bounded opacity, and older strokes without them stay valid', validOrganizerDocument({ ...note, sketches: [{ ...newOrganizerSketch(), strokes: [
    { id: randomUUID(), color: '#abcdef', width: 2, points: [{ x: 1, y: 1, pressure: .5 }] },
    { id: randomUUID(), color: '#abcdef', width: 6, points: [{ x: 1, y: 1, pressure: .5 }], brush: 'highlighter', opacity: .35 },
    { id: randomUUID(), color: '#abcdef', width: 6, points: [{ x: 1, y: 1, pressure: .5 }], brush: 'pen' }] }] }));
  // Sheets are a bounded list; notes from before the list migrate deterministically on PC, tablet and wire.
  const sheet = (strokes: unknown[] = []) => ({ ...newOrganizerSketch(), strokes });
  const sameId = randomUUID();
  const moreInvalids: Array<[string, unknown]> = [
    ['seven sheets', { ...note, sketches: Array.from({ length: 7 }, () => sheet()) }],
    ['duplicate sheet ids', { ...note, sketches: [{ ...sheet(), id: sameId }, { ...sheet(), id: sameId }] }],
    ['overlong sheet title', { ...note, sketches: [{ ...sheet(), title: 'x'.repeat(ORGANIZER_LIMITS.sketchTitle + 1) }] }],
    ['sheet on a missing photo', { ...note, sketches: [{ ...sheet(), backgroundImageId: randomUUID() }] }],
    ['sheet without an id', { ...note, sketches: [(({ id: _id, ...rest }) => rest)(sheet())] }],
    ['legacy single sketch field without upgrade', (({ sketches: _sketches, ...rest }) => ({ ...rest, sketch: { width: 1600, height: 1000, backgroundImageId: null, strokes: [] } }))(note)],
  ];
  for (const [name, bad] of moreInvalids) check(`validation rejects ${name}`, !validOrganizerDocument(bad));
  check('six titled sheets with distinct ids are valid', validOrganizerDocument({ ...note, sketches: Array.from({ length: 6 }, (_item, index) => ({ ...sheet(), title: `Blatt ${index + 1}` })) }));
  const legacy = (({ sketches: _sketches, ...rest }) => ({ ...rest, sketch: { width: 1600, height: 1000, backgroundImageId: null, strokes: [{ id: randomUUID(), color: '#abcdef', width: 2, points: [{ x: 1, y: 1, pressure: .5 }] }] } }))(note);
  const upgraded = upgradeOrganizerDocument(legacy) as OrganizerDocument;
  check('a legacy note upgrades to one untitled sheet with a deterministic id', validOrganizerDocument(upgraded) && upgraded.sketches.length === 1 && upgraded.sketches[0]!.id === legacySketchId(note.id)
    && upgraded.sketches[0]!.strokes.length === 1 && upgraded.sketches[0]!.title === '' && !('sketch' in upgraded) && JSON.stringify(upgradeOrganizerDocument(legacy)) === JSON.stringify(upgraded));
  check('a legacy note without marks upgrades to an empty sheet list', (upgradeOrganizerDocument({ ...legacy, sketch: { ...legacy.sketch, strokes: [] } }) as OrganizerDocument).sketches.length === 0);
  check('the legacy sheet id is well formed and distinct from the note id', organizerId(legacySketchId(note.id)) && legacySketchId(note.id) !== note.id && legacySketchId(note.id) !== legacySketchId(task.id));
  check('the upgrade leaves current documents alone and malformed ones invalid', upgradeOrganizerDocument(note) === note && !validOrganizerDocument(upgradeOrganizerDocument({ ...legacy, sketch: 'nope' })) && !validOrganizerDocument(upgradeOrganizerDocument({ ...legacy, sketches: [] })));
  const legacyFile = join(root, 'legacy', 'organizer.json'); mkdirSync(dirname(legacyFile), { recursive: true });
  const legacyState = { version: 1, revision: 1, entries: [{ document: legacy, revision: 1, createdAt: 1, updatedAt: 1, deleted: false, conflictOf: null }], writers: [] };
  writeFileSync(legacyFile, JSON.stringify(legacyState));
  const legacyStore = new OrganizerStore(legacyFile, () => now);
  check('a stored legacy note opens as a sheet list without rewriting the file', legacyStore.detail(note.id)?.document.sketches[0]?.id === legacySketchId(note.id) && readFileSync(legacyFile, 'utf8') === JSON.stringify(legacyState));
  const legacyPut = { operation: 'put', writerId: randomUUID(), sequence: 1, baseRevision: 1, document: { ...legacy, text: 'from an old tablet build' } } as unknown as OrganizerMutation;
  const legacyReceipt = legacyStore.mutate(legacyPut, 'tablet');
  check('a put from a build before sheet lists is upgraded, saved and replay-safe', !legacyReceipt.conflict && legacyStore.detail(note.id)?.document.text === 'from an old tablet build' && legacyStore.detail(note.id)?.document.sketches.length === 1
    && legacyStore.mutate(legacyPut, 'tablet').replayed && (JSON.parse(readFileSync(legacyFile, 'utf8')) as { entries: Array<{ document: OrganizerDocument }> }).entries[0]!.document.sketches.length === 1);
  check('mutation rejects unknown operation and extra authority fields', !validOrganizerMutation({ ...input, operation: 'run' }) && !validOrganizerMutation({ ...input, owner: 'desktop' }));
  let revision = taskResult.revision;
  for (let sequence = 5; sequence <= 610; sequence++) revision = store.mutate({ ...input, sequence, baseRevision: revision, document: { ...task, text: `Edit ${sequence}` } }, owner).revision;
  const disk = JSON.parse(readFileSync(file, 'utf8')) as { writers: unknown[] };
  check('hundreds of autosaves do not exhaust the generic remote ledger', store.writerSequence(writer, owner) === 610 && store.detail(task.id)?.document.text === 'Edit 610');
  check('writer receipt count is bounded by clients, not edits', disk.writers.length === 2 && readFileSync(file).length < 16_000);
  check('atomic writes leave no temporary siblings', readdirSync(dirname(file)).every(name => !name.endsWith('.tmp')));
  const originalBytes = readFileSync(file, 'utf8'); writeFileSync(file, originalBytes + ' ');
  check('external modification fails before replacing the file', refuses(() => store.mutate({ ...input, sequence: 611, baseRevision: revision, document: task }, owner), 'changed') && readFileSync(file, 'utf8') === originalBytes + ' ');
  writeFileSync(file, '{broken');
  check('corrupted original fails closed and stays untouched', refuses(() => new OrganizerStore(file), 'unavailable') && readFileSync(file, 'utf8') === '{broken');
  writeFileSync(file, originalBytes);
  const linked = join(root, 'linked.json'); linkSync(file, linked);
  check('hard-linked data file is rejected', refuses(() => new OrganizerStore(linked)));
  rmSync(linked);
  const outside = join(root, 'elsewhere'); mkdirSync(outside); const redirected = join(root, 'redirected'); symlinkSync(outside, redirected, 'junction');
  check('junction parent is rejected before writing', refuses(() => new OrganizerStore(join(redirected, 'new.json'))));
  check('final positive control restores valid profile and latest draft', new OrganizerStore(file).detail(task.id)?.document.text === 'Edit 610');
  const reminderStore = new OrganizerStore(join(root, 'reminders.json'), () => now); const notices: number[] = [];
  const reminder = newOrganizerDocument('task'); reminder.reminderAt = now + 100; reminder.title = 'Vertraulicher Titel';
  const reminderWriter = randomUUID(); let reminderSequence = 0; let reminderRevision = 0;
  const saveReminder = () => { reminderRevision = reminderStore.mutate({ operation: 'put', document: reminder, baseRevision: reminderRevision, writerId: reminderWriter, sequence: ++reminderSequence }, owner).revision; };
  const reminders = new OrganizerReminders(() => reminderStore.index(), count => notices.push(count), () => now);
  saveReminder(); reminders.check(); check('future reminder emits no premature notification', notices.length === 0);
  now += 100; reminders.check(); reminders.check(); check('due reminder emits one count-only notification per due time', notices.join(',') === '1');
  reminder.text = 'Beschreibung geändert'; saveReminder(); reminders.check(); check('autosave does not repeat an already delivered reminder', notices.length === 1);
  reminder.reminderSeenAt = now; saveReminder(); new OrganizerReminders(() => reminderStore.index(), count => notices.push(count), () => now).check();
  check('acknowledged reminder stays acknowledged across scheduler restart', notices.length === 1);
  reminder.reminderAt = now + 100; reminder.reminderSeenAt = null; saveReminder(); now += 100; reminders.check(); check('rescheduled reminder emits at its new due time', notices.length === 2);
  reminder.done = true; saveReminder(); new OrganizerReminders(() => reminderStore.index(), count => notices.push(count), () => now).check(); check('completed task produces no reminder', notices.length === 2);
} finally {
  const absolute = resolve(root);
  if (dirname(absolute) !== resolve(tmpdir()) || !absolute.split(/[\\/]/).at(-1)?.startsWith('ade-organizer-')) throw new Error('Unsafe temporary test cleanup');
  rmSync(absolute, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
