import { emptyOrganizerCache, validOrganizerCache, type OrganizerCacheState, type OrganizerCacheStorage } from './OrganizerCache';
const databaseName = 'ade-organizer-v1';
let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('profiles');
    request.onerror = () => { database = undefined; reject(new Error('Lokale Ablage konnte nicht geöffnet werden.')); };
    request.onblocked = () => { database = undefined; reject(new Error('Eine andere ADE-Seite blockiert die lokale Ablage. Diese Seite schliessen und erneut versuchen.')); };
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); database = undefined; }; resolve(db); };
  });
}
/** Same-origin storage, additionally partitioned by paired identity. No lossy in-memory fallback. */
export class IndexedOrganizerStorage implements OrganizerCacheStorage {
  constructor(private readonly scope: string) { if (!scope || scope.length > 200) throw new Error('Ungültige Geräteablage.'); }
  async transaction<T>(change: (state: OrganizerCacheState) => T): Promise<T> {
    const db = await openDatabase();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction('profiles', 'readwrite'); const store = transaction.objectStore('profiles');
      let result: T; let failure: unknown;
      const request = store.get(this.scope);
      request.onsuccess = () => {
        try {
          const previous: unknown = request.result;
          if (previous && typeof previous === 'object' && 'forgotten' in previous) throw new Error('Dieser Gerätezugang wurde entfernt.');
          if (previous !== undefined && !validOrganizerCache(previous)) throw new Error('Die lokale Ablage ist beschädigt. Vorhandene Daten werden nicht überschrieben.');
          const state = previous === undefined ? emptyOrganizerCache() : structuredClone(previous as OrganizerCacheState);
          result = change(state);
          if (!validOrganizerCache(state)) throw new Error('Ungültiger lokaler Entwurf. Vorheriger Stand bleibt erhalten.');
          // A transaction is also used for reads; do not write an identical multi-MB document each poll.
          if (previous === undefined || JSON.stringify(previous) !== JSON.stringify(state)) store.put(state, this.scope);
        } catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () => reject(failure ?? new Error('Lokales Speichern fehlgeschlagen. Bitte Inhalt kopieren oder exportieren; dieser Entwurf ist noch nicht gesichert.'));
    });
  }
}
export async function forgetOrganizerStorage(scope: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => { const transaction = db.transaction('profiles', 'readwrite'); transaction.objectStore('profiles').put({ forgotten: true }, scope);
    transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(new Error('Lokale Aufgaben und Notizen konnten nicht entfernt werden.')); });
}
