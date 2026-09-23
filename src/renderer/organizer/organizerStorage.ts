import { t as translate } from "../../shared/i18n";
import { emptyOrganizerCache, upgradeOrganizerCache, validOrganizerCache, type OrganizerCacheState, type OrganizerCacheStorage } from './OrganizerCache';
const databaseName = 'ade-organizer-v1';
let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('profiles');
    request.onerror = () => { database = undefined; reject(new Error(translate("Local storage could not be opened."))); };
    request.onblocked = () => { database = undefined; reject(new Error(translate("Another ADE page is blocking local storage. Close that other page and try again."))); };
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); database = undefined; }; resolve(db); };
  });
}
/** Same-origin storage, additionally partitioned by paired identity. No lossy in-memory fallback. */
export class IndexedOrganizerStorage implements OrganizerCacheStorage {
  constructor(private readonly scope: string) { if (!scope || scope.length > 200) throw new Error(translate("Invalid device storage.")); }
  async transaction<T>(change: (state: OrganizerCacheState) => T): Promise<T> {
    const db = await openDatabase();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction('profiles', 'readwrite'); const store = transaction.objectStore('profiles');
      let result: T; let failure: unknown;
      const request = store.get(this.scope);
      request.onsuccess = () => {
        try {
          const previous: unknown = request.result === undefined ? undefined : upgradeOrganizerCache(structuredClone(request.result));
          if (previous && typeof previous === 'object' && 'forgotten' in previous) throw new Error(translate("This device access has been removed."));
          if (previous !== undefined && !validOrganizerCache(previous)) throw new Error(translate("The local repository is damaged and existing data is not overwritten."));
          const state = previous === undefined ? emptyOrganizerCache() : structuredClone(previous as OrganizerCacheState);
          result = change(state);
          if (!validOrganizerCache(state)) throw new Error(translate("Invalid local draft. Previous status remains."));
          // A transaction is also used for reads; do not write an identical multi-MB document each poll.
          if (previous === undefined || JSON.stringify(previous) !== JSON.stringify(state)) store.put(state, this.scope);
        } catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () => reject(failure ?? new Error(translate("Local storage failed. Please copy or export content; this draft is not yet secured.")));
    });
  }
}
export async function forgetOrganizerStorage(scope: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => { const transaction = db.transaction('profiles', 'readwrite'); transaction.objectStore('profiles').put({ forgotten: true }, scope);
    transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(new Error(translate("Local tasks and notes could not be removed."))); });
}
