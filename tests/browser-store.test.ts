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
// The database object the latest fake open() handed out, so a test can fire its events.
let lastDb: { onversionchange: unknown; closed: boolean } | null = null;

// A database already at `version`, whose `workspace` store holds `records`.
function fakeIndexedDB(version: number, records: Map<string, unknown>) {
  const db = {
    onversionchange: null as unknown,
    closed: false,
    close() {
      db.closed = true;
    },
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
        lastDb = db;
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

test('a corrupt workspace record is refused, never replaced by a blank workspace', async () => {
  // A profile as every release stored it, to damage one part at a time below.
  const profile = { id: 'p', name: 'P', kind: 'calculated', state: { checks: {}, settings: {} } };
  const save = (profiles: unknown[]) => ({ version: 1, saves: [{ id: 's', profiles }] });
  for (const corrupt of [
    0,
    '',
    false,
    null,
    'text',
    42,
    [],
    { saves: 'x' },
    // Damage below the saves list, which summary() and the routes would hit as a TypeError (#143).
    { version: 1, saves: [1] },
    { version: 1, saves: [{ id: 's' }] },
    save([null]),
    save([{ ...profile, id: 7 }]),
    save([{ ...profile, state: null }]),
    save([{ ...profile, state: { settings: {} } }]),
    save([{ ...profile, state: { checks: {}, settings: [] } }]),
  ]) {
    const records = new Map<string, unknown>([['main', corrupt]]);
    const store = openBrowserStore(fakeIndexedDB(1, records));
    await assert.rejects(store.transaction(), /could not be read/, JSON.stringify(corrupt));
    await assert.rejects(
      store.transaction(d => (d.activeSave = 'x')),
      /could not be read/,
      JSON.stringify(corrupt),
    );
    assert.deepEqual(records.get('main'), corrupt, 'left as it was');
  }
});

test('after another tab upgrades the database, this tab says to reload', async () => {
  const records = new Map<string, unknown>();
  const store = openBrowserStore(fakeIndexedDB(0, records));
  await store.transaction(d => (d.activeSave = 'x'));
  // A newer planner in another tab asks to upgrade: this connection closes.
  (lastDb!.onversionchange as () => void)();
  assert.equal(lastDb!.closed, true);
  await assert.rejects(store.transaction(), /opened in another tab\. Reload this tab/);
  await assert.rejects(
    store.transaction(d => (d.activeSave = 'y')),
    /Reload this tab/,
  );
  assert.equal((records.get('main') as { activeSave: string }).activeSave, 'x', 'nothing written');
});

test('a record saved before lastBackup existed reads as never exported, and keeps its saves', async () => {
  // A version-1 record from before the field was added.
  const old = {
    version: 1,
    activeSave: 's',
    saves: [
      {
        id: 's',
        name: 'Old world',
        activeProfile: 'p',
        profiles: [{ id: 'p', name: 'P', kind: 'calculated', state: { checks: {}, settings: {} } }],
      },
    ],
  };
  const records = new Map<string, unknown>([['main', structuredClone(old)]]);
  const store = openBrowserStore(fakeIndexedDB(1, records));
  const read = await store.transaction();
  assert.equal(read.lastBackup, null);
  assert.deepEqual(read.saves, old.saves);
  assert.deepEqual(records.get('main'), old, 'a read writes nothing');
  await store.transaction(d => (d.activeSave = 's'));
  assert.deepEqual(
    records.get('main'),
    { ...old, lastBackup: null },
    'a write only adds the field',
  );
});
