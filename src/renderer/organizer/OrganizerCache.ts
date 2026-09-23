import { t as translate } from "../../shared/i18n";
import { newOrganizerDocument, ORGANIZER_LIMITS, organizerId, organizerReference, upgradeOrganizerDocument, upgradeOrganizerMutation, validOrganizerDocument, validOrganizerMutation,
  type OrganizerDocument, type OrganizerEntry, type OrganizerMutation, type OrganizerReceipt, type OrganizerIndex } from '../../shared/organizer';

export interface CachedOrganizerEntry {
  id: string; base: OrganizerEntry | null; draft: OrganizerDocument | null; deletePending: boolean;
  localVersion: number; editedAt: number; redacted: boolean;
}
interface PendingSave { input: OrganizerMutation; localVersion: number }
export interface OrganizerDispatch { documentId: string; key: string; agentId: string; repositoryId: string; prompt: string }
export interface OrganizerCacheState { version: 1; writerId: string; sequence: number; entries: CachedOrganizerEntry[]; pending: PendingSave | null; dispatches: OrganizerDispatch[] }
export interface OrganizerCacheStorage {
  /** A synchronous transform committed in one transaction, serialized across browser tabs. */
  transaction<T>(change: (state: OrganizerCacheState) => T): Promise<T>;
}
export interface OrganizerPort {
  list(): Promise<OrganizerIndex>;
  detail(id: string): Promise<{ entry: OrganizerEntry | null; redacted: boolean }>;
  sequence(writerId: string): Promise<number>;
  save(input: OrganizerMutation): Promise<OrganizerReceipt>;
  wasRejected?(error: unknown): boolean;
}
export function emptyOrganizerCache(): OrganizerCacheState { return { version: 1, writerId: crypto.randomUUID(), sequence: 0, entries: [], pending: null, dispatches: [] }; }
/** Cached drafts and bases from before sheets became a list; see `upgradeOrganizerDocument`. Mutates and returns the given object. */
export function upgradeOrganizerCache(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { entries?: unknown }).entries)) return value;
  const state = value as { entries: Array<{ draft?: unknown; base?: { document?: unknown } | null }>; pending?: { input?: unknown } | null };
  for (const item of state.entries) {
    if (item && typeof item === 'object') { if (item.draft) item.draft = upgradeOrganizerDocument(item.draft); if (item.base && typeof item.base === 'object') item.base.document = upgradeOrganizerDocument(item.base.document); }
  }
  if (state.pending && typeof state.pending === 'object') state.pending.input = upgradeOrganizerMutation(state.pending.input);
  return value;
}
export function validOrganizerCache(value: unknown): value is OrganizerCacheState {
  if (!value || typeof value !== 'object') return false;
  const state = value as OrganizerCacheState;
  return state.version === 1 && organizerId(state.writerId) && Number.isSafeInteger(state.sequence) && state.sequence >= 0
    && Array.isArray(state.entries) && state.entries.length <= ORGANIZER_LIMITS.documents
    && state.entries.every(item => item && organizerId(item.id) && Number.isSafeInteger(item.localVersion) && item.localVersion >= 0
      && Number.isFinite(item.editedAt) && typeof item.deletePending === 'boolean' && typeof item.redacted === 'boolean'
      && (item.draft === null || validOrganizerDocument(item.draft) && item.draft.id === item.id)
      && (item.base === null || validOrganizerDocument(item.base.document) && item.base.document.id === item.id && Number.isSafeInteger(item.base.revision) && item.base.revision > 0))
    && new Set(state.entries.map(item => item.id)).size === state.entries.length
    && Array.isArray(state.dispatches) && state.dispatches.length <= 32 && new Set(state.dispatches.map(item => item.documentId)).size === state.dispatches.length
    && state.dispatches.every(item => organizerId(item.documentId) && organizerId(item.key) && organizerReference(item.agentId) && organizerReference(item.repositoryId)
      && typeof item.prompt === 'string' && item.prompt.length > 0 && item.prompt.length <= 8000 && !item.prompt.includes('\0'))
    && (state.pending === null || !!state.pending && validOrganizerMutation(state.pending.input) && state.pending.input.writerId === state.writerId
      && state.pending.input.sequence === state.sequence && Number.isSafeInteger(state.pending.localVersion));
}
export const cachedDocument = (entry: CachedOrganizerEntry): OrganizerDocument | null => entry.draft ?? entry.base?.document ?? null;
export class OrganizerCache {
  constructor(readonly storage: OrganizerCacheStorage, private readonly now = Date.now) {}
  snapshot(): Promise<OrganizerCacheState> { return this.storage.transaction(state => structuredClone(state)); }
  async edit(document: OrganizerDocument, expectedVersion: number | null): Promise<CachedOrganizerEntry> {
    if (!validOrganizerDocument(document) || new TextEncoder().encode(JSON.stringify(document)).byteLength > ORGANIZER_LIMITS.documentBytes) throw new Error(translate("The task or note is too large or contains invalid data."));
    return this.storage.transaction(state => {
      let entry = state.entries.find(item => item.id === document.id); const data = structuredClone(document);
      if (entry?.redacted) throw new Error(translate("Edit hidden content on the PC or create a new copy."));
      // Two views may have opened the same local draft. Preserve the second edit as a copy.
      if (entry && expectedVersion !== entry.localVersion && JSON.stringify(cachedDocument(entry)) !== JSON.stringify(data)) {
        data.id = crypto.randomUUID(); data.title = translate("{{value1}} · local conflict copy", { value1: data.title || (data.kind === 'task' ? translate("Task") : translate("Note")) }).slice(0, 200); entry = undefined;
      }
      if (!entry) {
        if (state.entries.length >= ORGANIZER_LIMITS.documents) throw new Error(translate("The local storage is full."));
        entry = { id: data.id, base: null, draft: null, deletePending: false, localVersion: 0, editedAt: this.now(), redacted: false }; state.entries.push(entry);
      }
      entry.draft = data; entry.deletePending = false; entry.localVersion++; entry.editedAt = this.now(); return structuredClone(entry);
    });
  }
  remove(id: string, expectedVersion: number): Promise<void> {
    return this.storage.transaction(state => {
      const entry = state.entries.find(item => item.id === id);
      if (!entry || entry.localVersion !== expectedVersion) throw new Error(translate("This entry has changed. Reload it before deleting."));
      const pendingId = state.pending?.input.operation === 'put' ? state.pending.input.document.id : state.pending?.input.id;
      if (!entry.base && pendingId !== id) { state.entries = state.entries.filter(item => item !== entry); return; }
      entry.deletePending = true; entry.draft = null; entry.localVersion++; entry.editedAt = this.now();
    });
  }
  private reserve(): Promise<PendingSave | null> {
    return this.storage.transaction(state => {
      if (state.pending) return structuredClone(state.pending);
      const entry = state.entries.filter(item => item.draft || item.deletePending).sort((a, b) => a.editedAt - b.editedAt)[0];
      if (!entry) return null;
      if (entry.deletePending && !entry.base) throw new Error(translate("The original storage process must be confirmed first."));
      const common = { writerId: state.writerId, sequence: state.sequence + 1, baseRevision: entry.base?.revision ?? 0 };
      const input: OrganizerMutation = entry.deletePending ? { ...common, operation: 'delete', id: entry.id } : { ...common, operation: 'put', document: structuredClone(entry.draft!) };
      state.sequence = input.sequence; state.pending = { input, localVersion: entry.localVersion }; return structuredClone(state.pending);
    });
  }
  private acknowledge(pending: PendingSave, receipt: OrganizerReceipt, received: { entry: OrganizerEntry | null; redacted: boolean }): Promise<void> {
    if (!received.entry || received.entry.document.id !== receipt.id || received.entry.revision < receipt.revision) throw new Error(translate("The stored status has not yet been confirmed, and the local draft remains intact."));
    const confirmed = received.entry;
    return this.storage.transaction(state => {
      if (!state.pending || state.pending.input.sequence !== pending.input.sequence) return;
      const originalId = pending.input.operation === 'put' ? pending.input.document.id : pending.input.id;
      const local = state.entries.find(item => item.id === originalId);
      if (!local) throw new Error(translate("The local draft is missing. The confirmation remains stored for resumption."));
      const newer = local.localVersion !== pending.localVersion;
      const exactBase: OrganizerEntry = { ...structuredClone(confirmed), revision: receipt.revision, createdAt: receipt.createdAt, updatedAt: receipt.updatedAt,
        document: { ...structuredClone(pending.input.operation === 'put' ? pending.input.document : local.base!.document), id: receipt.id }, deleted: receipt.deleted };
      const next: CachedOrganizerEntry = { ...local, id: receipt.id, base: newer ? exactBase : structuredClone(confirmed), redacted: received.redacted,
        draft: newer && local.draft ? { ...structuredClone(local.draft), id: receipt.id } : null,
        deletePending: newer && local.deletePending };
      if (receipt.id !== originalId) {
        local.draft = null; local.deletePending = false;
        if (!local.base) state.entries = state.entries.filter(item => item !== local);
      }
      state.entries = state.entries.filter(item => item.id !== next.id); state.entries.push(next); state.pending = null;
    });
  }
  /** One caller may retry while another tab is flushing: writer receipts make that safe. */
  async flush(port: OrganizerPort, active: () => boolean = () => true): Promise<number> {
    let saved = 0;
    while (active()) {
      const pending = await this.reserve(); if (!pending) break;
      let receipt: OrganizerReceipt;
      try { receipt = await port.save(pending.input); }
      catch (error) { if (active() && port.wasRejected?.(error)) await this.releaseRejected(port); throw error; }
      if (!active()) break;
      const received = await port.detail(receipt.id); if (!active()) break;
      await this.acknowledge(pending, receipt, received); saved++;
    }
    return saved;
  }
  /** Refresh only replaces the saved base. Unsynced edits retain their original revision. */
  async refresh(port: OrganizerPort, active: () => boolean = () => true): Promise<void> {
    const index = await port.list(); if (!active()) return;
    const snapshot = await this.snapshot();
    for (const summary of index.entries) {
      if (!active()) return;
      const local = snapshot.entries.find(item => item.id === summary.id);
      if (local?.draft || local?.deletePending || local?.base?.revision === summary.revision) continue;
      const received = await port.detail(summary.id); if (!active()) return;
      await this.storage.transaction(state => {
        const current = state.entries.find(item => item.id === summary.id);
        if (current?.draft || current?.deletePending) return;
        state.entries = state.entries.filter(item => item.id !== summary.id);
        if (received.entry) state.entries.push({ id: summary.id, base: received.entry, draft: null, deletePending: false,
          localVersion: (current?.localVersion ?? 0) + 1, editedAt: received.entry.updatedAt, redacted: received.redacted });
      });
    }
    if (!active()) return;
    await this.storage.transaction(state => { const ids = new Set(index.entries.map(item => item.id)); state.entries = state.entries.filter(item => item.draft || item.deletePending || ids.has(item.id)); });
  }
  /** Only a definitive rejected reply permits release, and only while no other save is in flight. */
  async releaseRejected(port: OrganizerPort): Promise<void> {
    const before = await this.snapshot(); if (!before.pending) return;
    const sequence = await port.sequence(before.writerId);
    if (sequence >= before.pending.input.sequence) throw new Error(translate("The change is already saved. Synchronize again first."));
    const deletion = before.pending.input.operation === 'delete' ? await port.detail(before.pending.input.id) : null;
    await this.storage.transaction(state => {
      if (state.pending?.input.sequence !== before.pending!.input.sequence) return;
      const input = before.pending!.input; const id = input.operation === 'put' ? input.document.id : input.id;
      const local = state.entries.find(item => item.id === id);
      if (local && deletion && local.localVersion === before.pending!.localVersion) {
        // Restore a stale deletion as the latest visible entry; never keep blindly deleting it.
        if (!deletion.entry) state.entries = state.entries.filter(item => item !== local);
        else { local.base = deletion.entry; local.redacted = deletion.redacted; local.deletePending = false; local.draft = null; local.localVersion++; }
      } else if (local?.deletePending && !local.base && !local.draft && input.operation === 'put') state.entries = state.entries.filter(item => item !== local);
      state.pending = null; state.sequence = sequence;
    });
  }
  async taskFromNote(note: OrganizerDocument, selectedText?: string): Promise<CachedOrganizerEntry> {
    const task = newOrganizerDocument('task'); task.title = note.title; task.text = selectedText ?? note.text;
    task.repositoryId = note.repositoryId; task.sourceNoteId = note.id; task.images = structuredClone(note.images); task.sketches = structuredClone(note.sketches);
    return this.edit(task, null);
  }
  reserveDispatch(input: Omit<OrganizerDispatch, 'key'>): Promise<OrganizerDispatch> {
    return this.storage.transaction(state => {
      const current = state.dispatches.find(item => item.documentId === input.documentId); if (current) return structuredClone(current);
      const entry = state.entries.find(item => item.id === input.documentId); const document = entry && cachedDocument(entry);
      if (!document || document.kind !== 'task' || entry?.redacted || entry?.deletePending) throw new Error(translate("This task cannot be handed over."));
      const pending = { ...input, key: crypto.randomUUID() }; state.dispatches.push(pending); return structuredClone(pending);
    });
  }
  confirmDispatch(pending: OrganizerDispatch, runId: string): Promise<void> {
    if (!organizerReference(runId)) return Promise.reject(new Error(translate("Invalid job confirmation.")));
    return this.storage.transaction(state => {
      if (!state.dispatches.some(item => item.key === pending.key)) return;
      const local = state.entries.find(item => item.id === pending.documentId); const document = local && cachedDocument(local);
      if (!local || !document) throw new Error(translate("Task is missing locally. The job confirmation remains open for resumption."));
      local.draft = { ...structuredClone(document), runIds: [...new Set([...document.runIds, runId])] };
      local.localVersion++; local.editedAt = this.now(); state.dispatches = state.dispatches.filter(item => item.key !== pending.key);
    });
  }
}
