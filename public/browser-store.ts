// A single record lets each IndexedDB transaction atomically change selection and progress.
// Opens the browser edition's database; browserRequest in browser-api.ts is the caller (tests
// hand createBrowserApi a stand-in store instead). The name, store `workspace` and key `main`
// hold existing users' saves: renaming any of them makes those saves disappear from the UI.
import type { BrowserWorkspace } from './types/index.ts';

// What an older planner says about saves a newer one wrote, whether the database itself or the
// workspace record is newer. Neither is read or written: AGENTS.md forbids downgrading them.
const NEWER =
  'The saves in this browser were written by a newer version of the planner. Open the latest ' +
  'version to use them; nothing has been changed. You can also download the stored data below ' +
  'to keep a copy.';
// A record that is there but is not a workspace. It is refused rather than treated as missing,
// which would put a blank workspace in its place on the next write. This browser cannot restore
// anything while it is refused (every route reads the record first), so the message names the
// ways out (#142).
const UNREADABLE =
  'The saves in this browser could not be read, so the planner cannot open here. Nothing has ' +
  "been changed: reload to try again, and keep this browser's site data. Download the stored " +
  'data below to keep a copy, and restore your last full save export in another browser or ' +
  'the Docker edition (Backup & notes → Import saves).';
// Errors about the stored data itself carry storedData, so the start-up error page (boot() in
// app/session.ts) offers readStoredData's download next to the message.
const refused = (message: string) => Object.assign(Error(message), { storedData: true });

// Whether a stored record has the shape browser-api.ts reads without checking: a saves list
// whose saves each have an id and a profiles list, and whose profiles each have an id and a
// progress state with checks and settings. Every release wrote records like this; anything
// else is damaged and is refused (UNREADABLE) instead of failing later with a raw TypeError.
// Deeper checks (the state's own fields) stay with validateState where the state is used.
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x);
function workspaceRecord(found: unknown): found is BrowserWorkspace {
  return (
    object(found) &&
    Array.isArray(found.saves) &&
    found.saves.every(
      (s: unknown) =>
        object(s) &&
        typeof s.id === 'string' &&
        Array.isArray(s.profiles) &&
        s.profiles.every(
          (p: unknown) =>
            object(p) &&
            typeof p.id === 'string' &&
            object(p.state) &&
            object(p.state.checks) &&
            object(p.state.settings),
        ),
    )
  );
}

// The store browser-api.ts works through (tests pass a stand-in with the same method).
export interface BrowserStore {
  transaction(): Promise<BrowserWorkspace>;
  transaction<T>(change: (data: BrowserWorkspace) => T): Promise<T>;
}

export function openBrowserStore(
  indexedDB: IDBFactory,
  name = 'satisfactory-planner-browser-v1',
): BrowserStore {
  // Set once another tab upgrades the schema and this connection closes for it.
  let upgradedElsewhere = false;
  const opened = new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    // Schema version 1 is the only one so far: a brand-new database just gets the empty store.
    r.onupgradeneeded = () => r.result.createObjectStore('workspace');
    r.onsuccess = () => {
      // Close when another tab asks to upgrade the schema, so a future upgrade is not blocked by
      // tabs left open. Such a tab then refuses its later transactions, saying why, until it is
      // reloaded (rather than the browser's raw "connection is closing" error).
      r.result.onversionchange = () => {
        upgradedElsewhere = true;
        r.result.close();
      };
      resolve(r.result);
    };
    // A database a newer release has upgraded refuses this older schema version.
    r.onerror = () => reject(r.error?.name === 'VersionError' ? refused(NEWER) : r.error);
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
      if (upgradedElsewhere)
        throw Error(
          'A newer version of the planner was opened in another tab. Reload this tab to continue; nothing has been changed.',
        );
      return new Promise<T>((resolve, reject) => {
        const tx = db.transaction('workspace', change ? 'readwrite' : 'readonly'),
          store = tx.objectStore('workspace');
        // Without change, the answer is the record itself.
        let answer: T | undefined, failure: unknown;
        const r = store.get('main');
        r.onsuccess = () => {
          try {
            // Saved data is unknown until checked (AGENTS.md).
            const found: unknown = r.result;
            // Version 1 is the only workspace format so far; a later one is refused unread.
            if (object(found) && typeof found.version === 'number' && found.version > 1)
              throw refused(NEWER);
            // Only a missing record (a new browser) starts blank; anything else not shaped like
            // a workspace, falsy values included, is refused unread.
            if (found !== undefined && !workspaceRecord(found)) throw refused(UNREADABLE);
            const data: BrowserWorkspace = found ?? {
              version: 1,
              activeSave: null,
              saves: [],
              lastBackup: null,
            };
            // Records written before lastBackup existed have no such field: read it as null
            // ("never exported"), as the type says. A change writes the field back (#72).
            data.lastBackup ??= null;
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

// The stored workspace record exactly as it is, unchecked, for the start-up error page's
// download when the planner refuses it (#142): damaged, or written by a newer release. Opens the
// database at whatever version it has, so a newer schema is readable too, and never writes. A
// browser without the database resolves undefined: the upgrade that opening would start is
// aborted, so no empty database is left behind for the real open to trip over.
export function readStoredData(
  indexedDB: IDBFactory,
  name = 'satisfactory-planner-browser-v1',
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name);
    let missing = false;
    r.onupgradeneeded = () => {
      missing = true;
      r.transaction?.abort();
    };
    r.onerror = () => (missing ? resolve(undefined) : reject(r.error));
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('workspace')) {
        db.close();
        return resolve(undefined);
      }
      const get = db.transaction('workspace', 'readonly').objectStore('workspace').get('main');
      get.onsuccess = () => {
        db.close();
        resolve(get.result);
      };
      get.onerror = () => {
        db.close();
        reject(get.error);
      };
    };
  });
}
