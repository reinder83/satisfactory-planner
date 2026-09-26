// A single record lets each IndexedDB transaction atomically change selection and progress.
// Opens the browser edition's database; browserRequest in browser-api.ts is the caller (tests
// hand createBrowserApi a stand-in store instead). The name, store `workspace` and key `main`
// hold existing users' saves: renaming any of them makes those saves disappear from the UI.
import type { BrowserWorkspace } from './types/index.ts';

// What an older planner says about saves a newer one wrote, whether the database itself or the
// workspace record is newer. Neither is read or written: AGENTS.md forbids downgrading them.
const NEWER =
  'The saves in this browser were written by a newer version of the planner. Open the latest ' +
  'version to use them; nothing has been changed.';

// The store browser-api.ts works through (tests pass a stand-in with the same method).
export interface BrowserStore {
  transaction(): Promise<BrowserWorkspace>;
  transaction<T>(change: (data: BrowserWorkspace) => T): Promise<T>;
}

export function openBrowserStore(
  indexedDB: IDBFactory,
  name = 'satisfactory-planner-browser-v1',
): BrowserStore {
  const opened = new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    // Schema version 1 is the only one so far: a brand-new database just gets the empty store.
    r.onupgradeneeded = () => r.result.createObjectStore('workspace');
    r.onsuccess = () => {
      // Close when another tab asks to upgrade the schema, so a future upgrade is not blocked by
      // tabs left open. Such a tab then rejects its later transactions until it is reloaded.
      r.result.onversionchange = () => r.result.close();
      resolve(r.result);
    };
    // A database a newer release has upgraded refuses this older schema version.
    r.onerror = () => reject(r.error?.name === 'VersionError' ? Error(NEWER) : r.error);
    r.onblocked = () => reject(Error('Close other planner tabs to upgrade browser storage.'));
  });
  return {
    // Without `change`, a readonly read of the whole workspace record. With it, one readwrite
    // transaction: read `main` (or a blank workspace), let `change` mutate it in place and return
    // the response, then put it back. IndexedDB serializes readwrite transactions on a store, so
    // concurrent tabs cannot interleave a read-modify-write. `change` must be synchronous: the
    // transaction commits once no request is pending.
    async transaction<T>(change?: (data: BrowserWorkspace) => T): Promise<T> {
      const db = await opened;
      return new Promise<T>((resolve, reject) => {
        const tx = db.transaction('workspace', change ? 'readwrite' : 'readonly'),
          store = tx.objectStore('workspace');
        // Without change, the answer is the record itself.
        let answer: T | undefined, failure: unknown;
        const r = store.get('main');
        r.onsuccess = () => {
          try {
            // Version 1 is the only workspace format so far; a later one is refused unread.
            if (typeof r.result?.version === 'number' && r.result.version > 1) throw Error(NEWER);
            const data: BrowserWorkspace = r.result || {
              version: 1,
              activeSave: null,
              saves: [],
              lastBackup: null,
            };
            answer = change ? change(data) : (data as T);
            if (change) store.put(data, 'main');
          } catch (e) {
            failure = e;
            tx.abort();
          }
        };
        // Resolve only after the commit is durable. If `change` throws, the abort discards its
        // edits and the promise rejects with that error.
        tx.oncomplete = () => resolve(answer as T);
        tx.onabort = () =>
          reject(failure || tx.error || Error('Browser storage could not be saved.'));
        // Request errors also abort the transaction, so onabort reports them.
        tx.onerror = () => {};
      });
    },
  };
}
