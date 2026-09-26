// openBrowserStore (public/browser-store.ts) against a small in-memory stand-in for IndexedDB:
// one database with one object store, requests that settle on a later tick, and readwrite
// transactions that apply their puts only if they complete. Enough to check what the store
// does with the record it finds; the real browser is exercised by browser-check.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowserStore } from '../public/browser-store.ts';

interface FakeRequest {
  result?: unknown;
  error?: unknown;
  onsuccess?: () => void;
  onerror?: () => void;
  onupgradeneeded?: () => void;
  onblocked?: () => void;
}
const later = (fn: () => void) => setTimeout(fn, 0);

// A database already at `version`, whose `workspace` store holds `records`.
function fakeIndexedDB(version: number, records: Map<string, unknown>) {
  const db = {
    onversionchange: null as unknown,
    close() {},
    createObjectStore() {},
    transaction(_store: string, mode: string) {
      const puts = new Map<string, unknown>();
      let aborted = false;
      const tx = {
        oncomplete: () => {},
        onabort: () => {},
        onerror: () => {},
        error: null,
        abort() {
          aborted = true;
        },
        objectStore: () => ({
          get(key: string) {
            const r: FakeRequest = {};
            later(() => {
              r.result = structuredClone(records.get(key));
              r.onsuccess?.();
              later(() => {
                if (aborted) return tx.onabort();
                if (mode === 'readwrite') for (const [k, v] of puts) records.set(k, v);
                tx.oncomplete();
              });
            });
            return r;
          },
          put(value: unknown, key: string) {
            puts.set(key, structuredClone(value));
          },
        }),
      };
      return tx;
    },
  };
  // Only open() is used; a partial stand-in, so one cast from the wider `object`.
  const factory: object = {
    open(_name: string, wanted: number) {
      const r: FakeRequest = {};
      later(() => {
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
        if (version < wanted) r.onupgradeneeded?.();
        r.onsuccess?.();
      });
      return r;
    },
  };
  return factory as IDBFactory;
}

test('a workspace written by a newer planner is refused, not read or written back', async () => {
  const newer = { version: 2, activeSave: 's', saves: [{ id: 's' }], lastBackup: null, extra: 1 };
  const records = new Map<string, unknown>([['main', structuredClone(newer)]]);
  const store = openBrowserStore(fakeIndexedDB(1, records));
  await assert.rejects(store.transaction(), /newer version of the planner/);
  await assert.rejects(
    store.transaction(d => (d.saves = [])),
    /newer version of the planner/,
  );
  assert.deepEqual(records.get('main'), newer, 'the record is untouched');
});

test('a database upgraded by a newer planner explains itself instead of a VersionError', async () => {
  const store = openBrowserStore(fakeIndexedDB(2, new Map()));
  await assert.rejects(store.transaction(), /newer version of the planner/);
});

test('a current workspace reads and writes as before, and a missing one starts blank', async () => {
  const records = new Map<string, unknown>();
  const store = openBrowserStore(fakeIndexedDB(0, records));
  assert.deepEqual(await store.transaction(), {
    version: 1,
    activeSave: null,
    saves: [],
    lastBackup: null,
  });
  await store.transaction(d => (d.activeSave = 'x'));
  assert.equal((records.get('main') as { activeSave: string }).activeSave, 'x');
});
