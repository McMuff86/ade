import { t as translate } from "../../shared/i18n";
import type { OrganizerDocument } from '../../shared/organizer';
import { cachedDocument, type CachedOrganizerEntry, type OrganizerCache } from './OrganizerCache';

/** Keeps uncommitted edits alive across page changes; never claims RAM is durable. */
export class OrganizerEditing {
  private value: OrganizerDocument;
  private version: number;
  private generation = 0;
  private savedGeneration = 0;
  private running: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  error = '';
  committed: CachedOrganizerEntry | null = null;
  constructor(private readonly cache: OrganizerCache, entry: CachedOrganizerEntry) {
    this.value = structuredClone(cachedDocument(entry)!); this.version = entry.localVersion;
  }
  document(): OrganizerDocument { return structuredClone(this.value); }
  get dirty(): boolean { return this.generation !== this.savedGeneration; }
  get saving(): boolean { return this.running !== null; }
  subscribe(changed: () => void): () => void { this.listeners.add(changed); return () => { this.listeners.delete(changed); }; }
  private notify(): void { for (const changed of this.listeners) changed(); }
  receive(entry: CachedOrganizerEntry): void {
    if (this.dirty || this.running || entry.localVersion < this.version) return;
    const document = cachedDocument(entry); if (!document) return;
    if (JSON.stringify(document) === JSON.stringify(this.value)) { this.version = entry.localVersion; return; }
    this.value = structuredClone(document); this.version = entry.localVersion; this.notify();
  }
  edit(document: OrganizerDocument): Promise<void> {
    this.value = structuredClone(document); this.generation++; this.error = ''; this.notify(); return this.flush();
  }
  flush(): Promise<void> {
    if (this.running) return this.running;
    if (!this.dirty) return Promise.resolve();
    // Defer work until running is assigned, including synchronous storage rejection.
    this.running = Promise.resolve().then(async () => {
      while (this.dirty) {
        const generation = this.generation;
        const saved = await this.cache.edit(this.value, this.version);
        this.version = saved.localVersion; this.savedGeneration = generation; this.committed = saved;
        // Subsequent keystrokes belong to the same conflict copy, never the old ID.
        this.value.id = saved.id; this.error = ''; this.notify();
      }
    }).catch(reason => { this.error = reason instanceof Error ? reason.message : translate("Local storage failed."); throw reason; })
      .finally(() => { this.running = null; this.notify(); });
    this.notify(); return this.running;
  }
}
const retained = new Map<string, { scope: string; editor: OrganizerEditing; users: number }>();
let unloadGuard = false;
export function organizerEditing(scope: string, cache: OrganizerCache, entry: CachedOrganizerEntry): OrganizerEditing {
  return retained.get(`${scope}/${entry.id}`)?.editor ?? new OrganizerEditing(cache, entry);
}
export function retainOrganizerEditing(scope: string, cache: OrganizerCache, entry: CachedOrganizerEntry, candidate?: OrganizerEditing): OrganizerEditing {
  if (!unloadGuard && typeof window !== 'undefined') {
    window.addEventListener('beforeunload', event => { if (hasUnsavedOrganizerEditing()) { event.preventDefault(); event.returnValue = ''; } }); unloadGuard = true;
  }
  const key = `${scope}/${entry.id}`; let record = retained.get(key);
  if (!record) { record = { scope, editor: candidate ?? new OrganizerEditing(cache, entry), users: 0 }; retained.set(key, record); }
  record.users++; return record.editor;
}
export function releaseOrganizerEditing(scope: string, id: string): void {
  const key = `${scope}/${id}`; const record = retained.get(key); if (!record) return;
  record.users--;
  const prune = () => { if (!record.users && !record.editor.dirty && !record.editor.saving && retained.get(key) === record) retained.delete(key); };
  prune(); if (!record.users && record.editor.saving) void record.editor.flush().then(prune, () => undefined);
}
export function hasUnsavedOrganizerEditing(scope?: string): boolean { return [...retained.values()].some(record => (!scope || record.scope === scope) && record.editor.dirty); }
export function forgetOrganizerEditing(scope: string): void { for (const [key, record] of retained) if (record.scope === scope) retained.delete(key); }
