// A small in-memory stand-in for IndexedDB, enough for openBrowserStore and readStoredData
// (public/browser-store.ts): one database with one object store, requests that settle on a later
// tick, and readwrite transactions that apply their puts only if they complete. A transaction
// commits once every request it made has settled, as a real one does. The real browser is
// exercised by browser-check.ts.

interface FakeRequest {
  result?: unknown;
  error?: unknown;
  // The upgrade transaction, while onupgradeneeded runs.
  transaction?: { abort(): void };
  onsuccess?: () => void;
  onerror?: () => void;
  onupgradeneeded?: () => void;
  onblocked?: () => void;
}
const later = (fn: () => void) => setTimeout(fn, 0);

export interface FakeDatabase {
  onversionchange: unknown;
  closed: boolean;
}
// What a test can change on the fake after creating it.
export interface FakeControls {
  // The database object the latest open() handed out, so a test can fire its events.
  db: FakeDatabase | null;
  // Set to make the next readwrite transaction that puts something fail at commit, like a full
  // disk (QuotaExceededError) or a closed tab: its puts are dropped and it aborts.
  failNextCommit: boolean;
  // How many readwrite transactions committed a put.
  writes: number;
}

// A database already at `version`, whose `workspace` store holds `records`. Version 0 stands for
// a browser without the database.
export function fakeIndexedDB(
  version: number,
  records: Map<string, unknown>,
  controls: FakeControls = { db: null, failNextCommit: false, writes: 0 },
): IDBFactory {
  const db = {
    onversionchange: null as unknown,
    closed: false,
    close() {
      db.closed = true;
    },
    createObjectStore() {},
    // Version 0 has no store yet.
    objectStoreNames: { contains: (store: string) => version > 0 && store === 'workspace' },
    transaction(_store: string, mode: string) {
      const puts = new Map<string, unknown>();
      let aborted = false,
        pending = 0,
        done = false;
      const finish = () => {
        if (done || pending) return;
        done = true;
        if (aborted) return tx.onabort();
        if (mode === 'readwrite' && puts.size && controls.failNextCommit) {
          controls.failNextCommit = false;
          tx.error = Object.assign(new Error('The disk is full.'), { name: 'QuotaExceededError' });
          return tx.onabort();
        }
        if (mode === 'readwrite') for (const [k, v] of puts) records.set(k, v);
        if (mode === 'readwrite' && puts.size) controls.writes++;
        tx.oncomplete();
      };
      const tx = {
        oncomplete: () => {},
        onabort: () => {},
        onerror: () => {},
        error: null as Error | null,
        abort() {
          aborted = true;
        },
        objectStore: () => ({
          get(key: string) {
            const r: FakeRequest = {};
            pending++;
            later(() => {
              r.result = structuredClone(records.get(key));
              r.onsuccess?.();
              pending--;
              later(finish);
            });
            return r;
          },
          put(value: unknown, key: string) {
            if (mode !== 'readwrite') throw Error('ReadOnlyError');
            puts.set(key, structuredClone(value));
          },
        }),
      };
      return tx;
    },
  };
  // Only open() is used; a partial stand-in, so one cast from the wider `object`.
  const factory: object = {
    // Without `wanted` (readStoredData), a database opens at the version it has; a missing one
    // would be created at 1, which that caller aborts.
    open(_name: string, wanted = version || 1) {
      const r: FakeRequest = {};
      later(() => {
        if (version === 0 && arguments.length < 2) {
          let aborted = false;
          r.transaction = { abort: () => (aborted = true) };
          r.onupgradeneeded?.();
          if (aborted) {
            r.error = Object.assign(new Error('aborted'), { name: 'AbortError' });
            return r.onerror?.();
          }
        }
        if (version > wanted) {
          r.error = Object.assign(
            new Error('The requested version is less than the existing version.'),
            {
              name: 'VersionError',
            },
          );
          return r.onerror?.();
        }
        r.result = db;
        controls.db = db;
        if (version < wanted) r.onupgradeneeded?.();
        r.onsuccess?.();
      });
      return r;
    },
  };
  return factory as IDBFactory;
}
