// A small in-memory stand-in for IndexedDB, enough for openBrowserStore and readStoredData
// (public/browser-store.ts): one database with one object store, requests that settle on a later
// tick, and readwrite transactions that apply their puts only if they complete. A transaction
// commits once every request it made has settled, as a real one does. Several connections can be
// open at once, like tabs: opening at a higher version first sends the open ones a versionchange
// (onblocked while any stays open), then runs onupgradeneeded in an upgrade transaction whose
// puts and version bump are kept only if it completes. A closed connection refuses transactions.
// The real browser is exercised by browser-check.ts.

interface FakeRequest {
  result?: unknown;
  error?: unknown;
  // The upgrade transaction, while onupgradeneeded runs.
  transaction?: FakeTransaction;
  onsuccess?: () => void;
  onerror?: () => void;
  onupgradeneeded?: () => void;
  onblocked?: () => void;
}
interface FakeTransaction {
  oncomplete: () => void;
  onabort: () => void;
  onerror: () => void;
  error: Error | null;
  abort(): void;
  objectStore(): {
    get(key: string): FakeRequest;
    put(value: unknown, key: string): void;
  };
}
const later = (callback: () => void) => setTimeout(callback, 0);

export interface FakeDatabase {
  onversionchange: unknown;
  closed: boolean;
  close(): void;
}
// What a test can change on the fake after creating it.
export interface FakeControls {
  // The database object the latest open() handed out, so a test can fire its events.
  db: FakeDatabase | null;
  // Set to make the next readwrite or upgrade transaction that puts something fail at commit,
  // like a full disk (QuotaExceededError) or a closed tab: its puts are dropped and it aborts.
  failNextCommit: boolean;
  // How many readwrite or upgrade transactions committed a put.
  writes: number;
}

// A database already at `version`, whose `workspace` store holds `records`. Version 0 stands for
// a browser without the database.
export function fakeIndexedDB(
  version: number,
  records: Map<string, unknown>,
  controls: FakeControls = { db: null, failNextCommit: false, writes: 0 },
): IDBFactory {
  const connections = new Set<FakeDatabase>();
  // `onDone` runs once the transaction has settled, whether it committed or aborted.
  const transaction = (mode: string, onDone: (committed: boolean) => void = () => {}) => {
    const puts = new Map<string, unknown>();
    let aborted = false,
      pending = 0,
      done = false;
    const finish = () => {
      if (done || pending) return;
      done = true;
      if (aborted) {
        fakeTransaction.onabort();
        return onDone(false);
      }
      if (mode !== 'readonly' && puts.size && controls.failNextCommit) {
        controls.failNextCommit = false;
        fakeTransaction.error = Object.assign(new Error('The disk is full.'), {
          name: 'QuotaExceededError',
        });
        fakeTransaction.onabort();
        return onDone(false);
      }
      if (mode !== 'readonly') for (const [key, value] of puts) records.set(key, value);
      if (mode !== 'readonly' && puts.size) controls.writes++;
      fakeTransaction.oncomplete();
      onDone(true);
    };
    const fakeTransaction: FakeTransaction = {
      oncomplete: () => {},
      onabort: () => {},
      onerror: () => {},
      error: null,
      abort() {
        aborted = true;
        later(finish);
      },
      objectStore: () => ({
        get(key: string) {
          const request: FakeRequest = {};
          pending++;
          later(() => {
            if (!aborted) {
              request.result = structuredClone(records.get(key));
              request.onsuccess?.();
            }
            pending--;
            later(finish);
          });
          return request;
        },
        put(value: unknown, key: string) {
          if (mode === 'readonly') throw Error('ReadOnlyError');
          if (aborted) throw Error('TransactionInactiveError');
          puts.set(key, structuredClone(value));
        },
      }),
    };
    // A transaction that makes no request commits on its own.
    later(finish);
    return fakeTransaction;
  };
  const connect = () => {
    const db = {
      onversionchange: null as unknown,
      closed: false,
      close() {
        db.closed = true;
        connections.delete(db);
      },
      // The upgrade decides whether the store exists (version 0 has none yet).
      createObjectStore() {},
      objectStoreNames: { contains: (store: string) => version > 0 && store === 'workspace' },
      transaction(_store: string, mode: string) {
        if (db.closed)
          throw Object.assign(Error('The connection is closing.'), { name: 'InvalidStateError' });
        return transaction(mode);
      },
    };
    connections.add(db);
    return db;
  };
  const open = (request: FakeRequest, wanted: number) => {
    if (version > wanted) {
      request.error = Object.assign(
        new Error('The requested version is less than the existing version.'),
        { name: 'VersionError' },
      );
      return request.onerror?.();
    }
    if (version === wanted) {
      const db = connect();
      request.result = db;
      controls.db = db;
      return request.onsuccess?.();
    }
    // An upgrade: every other open connection hears of it first, and it waits for them to close.
    for (const other of connections)
      (other.onversionchange as ((event: object) => void) | null)?.({
        oldVersion: version,
        newVersion: wanted,
      });
    if (connections.size) request.onblocked?.();
    const upgrade = () => {
      if (connections.size) return later(upgrade);
      const before = version,
        db = connect();
      request.result = db;
      controls.db = db;
      request.transaction = transaction('versionchange', committed => {
        request.transaction = undefined;
        if (!committed) {
          version = before;
          db.close();
          request.error = Object.assign(new Error('The upgrade was aborted.'), {
            name: 'AbortError',
          });
          return request.onerror?.();
        }
        request.onsuccess?.();
      });
      // During the upgrade the database already has its new version; an abort restores the old.
      version = wanted;
      const hadStore = before > 0;
      db.objectStoreNames.contains = (store: string) => store === 'workspace' && hadStore;
      request.onupgradeneeded?.();
    };
    upgrade();
  };
  // Only open() is used; a partial stand-in, so one cast from the wider `object`.
  const factory: object = {
    // Without `wanted` (readStoredData), a database opens at the version it has; a missing one
    // would be created at 1, which that caller aborts.
    open(_name: string, wanted?: number) {
      const request: FakeRequest = {};
      later(() => open(request, wanted ?? (version || 1)));
      return request;
    },
  };
  return factory as IDBFactory;
}
