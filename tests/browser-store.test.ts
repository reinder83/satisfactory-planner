// openBrowserStore (public/browser-store.ts) against the in-memory stand-in for IndexedDB in
// tests/helpers/fake-indexeddb.ts. Enough to check what the store does with the record it finds;
// the real browser is exercised by browser-check.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowserStore, PRE_HANDBOOK, readStoredData } from '../public/browser-store.ts';
import { handbookToPlan, migrateHandbookState } from '../public/handbook-migration.ts';
import { initialState } from '../public/state.ts';
import { catalog } from '../planner.ts';
import handbookJson from '../public/plan.json' with { type: 'json' };
import recipesJson from '../recipes.json' with { type: 'json' };
import type { BrowserWorkspace, Handbook, Recipe, StoredProfile } from '../public/types/index.ts';
import { fakeIndexedDB, type FakeControls } from './helpers/fake-indexeddb.ts';

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
  const store = openBrowserStore(fakeIndexedDB(3, new Map()));
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
  const controls: FakeControls = { db: null, failNextCommit: false, writes: 0 };
  const store = openBrowserStore(fakeIndexedDB(0, records, controls));
  await store.transaction(d => (d.activeSave = 'x'));
  const lastDb = controls.db;
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

test('a refused record carries storedData, and readStoredData hands it back exactly as stored', async () => {
  // Damaged: refused with the ways out named, and flagged for the error page's download.
  const damaged = { version: 1, saves: [1], note: 'keep me' };
  const records = new Map<string, unknown>([['main', structuredClone(damaged)]]);
  const refusal = await openBrowserStore(fakeIndexedDB(1, records))
    .transaction()
    .then(
      () => null,
      (e: Error & { storedData?: boolean }) => e,
    );
  assert.equal(refusal?.storedData, true);
  assert.match(refusal!.message, /another browser or the Docker edition/);
  assert.match(refusal!.message, /Download the stored data/);
  assert.deepEqual(await readStoredData(fakeIndexedDB(1, records)), damaged);
  assert.deepEqual(records.get('main'), damaged, 'reading it changed nothing');
  // Written by a newer release: the database is at version 3, which the store refuses to open.
  const newer = new Map<string, unknown>([['main', { version: 2, saves: [] }]]);
  const newerRefusal = await openBrowserStore(fakeIndexedDB(3, newer))
    .transaction()
    .catch((e: Error & { storedData?: boolean }) => e);
  assert.equal((newerRefusal as { storedData?: boolean }).storedData, true);
  assert.deepEqual(await readStoredData(fakeIndexedDB(3, newer)), { version: 2, saves: [] });
  // No database at all: nothing to hand back, and no empty database is created.
  assert.equal(await readStoredData(fakeIndexedDB(0, new Map())), undefined);
});

// Retiring the handbook, part 4c (#497): on its first transaction the store migrates every
// original profile that carries its own handbook, keeping the record as it was under the second
// key PRE_HANDBOOK, all in one readwrite transaction.
const handbook = handbookJson as unknown as Handbook;
const recipes = (recipesJson as unknown as { recipes: Recipe[] }).recipes;
const { pureLimits } = catalog();
const conversion = handbookToPlan(handbook, recipes, pureLimits);
const factory = handbook.factories.find(f => conversion.rows['3']![f.id])!;
const row = conversion.rows['3']![factory.id]!;
// A migration loader that counts how often the store asks for the recipes.
const loader = () => {
  const load = Object.assign(
    async () => {
      load.calls++;
      return { recipes, pureLimits };
    },
    { calls: 0 },
  );
  return load;
};
const controls = (): FakeControls => ({ db: null, failNextCommit: false, writes: 0 });
const original = (id: string, extra: Partial<StoredProfile> = {}): StoredProfile => ({
  id,
  name: 'Original · ' + id,
  kind: 'original',
  handbook: structuredClone(handbook),
  state: {
    ...initialState(),
    checks: { ['factory-3-' + factory.id]: true, 'phase-3-survey': true },
    notes: { ['factory-' + factory.id]: 'By the lake', global: 'My world' },
    deliveries: { '3-versatile-framework': 4000 },
  },
  ...extra,
});
// A calculated profile, which the migration leaves exactly as it is.
const calculated: StoredProfile = {
  id: 'calc',
  name: 'Balanced',
  kind: 'calculated',
  plan: conversion.plan,
  state: { ...initialState(), checks: { ['factory-3-' + factory.id]: true } },
};
const record = (profiles: StoredProfile[]) => ({
  version: 1 as const,
  activeSave: 's',
  saves: [{ id: 's', name: 'My world', activeProfile: profiles[0]!.id, profiles }],
  lastBackup: '2026-09-20T10:00:00.000Z',
});
const main = (records: Map<string, unknown>) => records.get('main') as BrowserWorkspace;

test('a direct upgrade migrates original profiles and keeps the record under the second key', async () => {
  const seeded = record([original('p'), calculated]);
  const records = new Map<string, unknown>([['main', structuredClone(seeded)]]);
  const c = controls(),
    load = loader();
  const store = openBrowserStore(fakeIndexedDB(1, records, c), undefined, load);
  const read = await store.transaction();
  assert.equal(load.calls, 1);
  assert.equal(c.writes, 1, 'one transaction wrote both keys');
  assert.deepEqual(records.get(PRE_HANDBOOK), seeded, 'the pre-migration copy, as it was');
  assert.deepEqual(read, main(records));
  const [p, other] = main(records).saves[0]!.profiles;
  assert.equal(p!.id, 'p');
  assert.equal(p!.name, 'Original · p');
  assert.equal(p!.kind, 'calculated');
  assert.equal('handbook' in p!, false);
  assert.deepEqual(p!.plan, conversion.plan);
  assert.deepEqual(
    p!.state,
    migrateHandbookState(seeded.saves[0]!.profiles[0]!.state, handbook, conversion),
  );
  assert.equal(p!.state.checks['calc-3-' + row], true);
  assert.equal(p!.state.checks['phase-3-survey'], true);
  assert.equal(p!.state.notes['factory-' + row], 'By the lake');
  assert.equal(p!.state.notes.global, 'My world');
  assert.equal(p!.state.deliveries['3-versatile-framework'], 4000);
  assert.deepEqual(other, calculated, 'a calculated profile is untouched');
  // The rest of the record is kept: the selection and the last backup.
  assert.equal(main(records).activeSave, 's');
  assert.equal(main(records).saves[0]!.activeProfile, 'p');
  assert.equal(main(records).lastBackup, seeded.lastBackup);
  // Later transactions on this connection do not migrate again.
  await store.transaction(d => (d.activeSave = 's'));
  assert.equal(load.calls, 1);
});

test('a skipped-version upgrade: a first-release record with an older handbook and state', async () => {
  // As the first browser release wrote it: no lastBackup, a content-version-1 state, and a
  // handbook exported by an older release, whose factory ids differ from today's.
  const own = structuredClone(handbook);
  own.version = '2026-08-01';
  own.factories.find(f => f.id === factory.id)!.id = 'renamed-factory';
  const old = {
    version: 1,
    activeSave: 's',
    saves: [
      {
        id: 's',
        name: 'Old world',
        activeProfile: 'p',
        profiles: [
          {
            id: 'p',
            name: 'Imported original',
            kind: 'original',
            handbook: own,
            state: {
              version: 1,
              revision: 3,
              checks: { 'factory-3-renamed-factory': true, ['factory-3-' + factory.id]: true },
              notes: { 'factory-renamed-factory': 'Old note' },
              deliveries: {},
              settings: { phase: '4' },
              customTasks: [],
            },
          },
        ],
      },
    ],
  };
  const records = new Map<string, unknown>([['main', structuredClone(old)]]);
  const store = openBrowserStore(fakeIndexedDB(1, records), undefined, loader());
  const read = await store.transaction();
  assert.deepEqual(records.get(PRE_HANDBOOK), old);
  const p = read.saves[0]!.profiles[0]!;
  assert.equal(p.kind, 'calculated');
  assert.equal('handbook' in p, false);
  assert.equal(p.plan!.engine, 'handbook-2026-08-01', 'transcribed from its own handbook');
  assert.equal(p.state.checks['calc-3-' + row], true, 'its own factory id');
  assert.equal(p.state.notes['factory-' + row], 'Old note');
  assert.equal(p.state.settings.phase, '4');
  assert.equal(p.state.revision, 3);
  // Today's id is no factory of that handbook, so its tick is kept for review.
  assert.equal(p.state.handbookOrigin!.unmapped.checks['factory-3-' + factory.id], true);
  assert.equal(read.lastBackup, null);
});

test('opening again changes nothing, and a record without original profiles is never copied', async () => {
  const records = new Map<string, unknown>([['main', record([original('p'), calculated])]]);
  await openBrowserStore(fakeIndexedDB(1, records), undefined, loader()).transaction();
  const once = structuredClone(records);
  const c = controls(),
    load = loader();
  await openBrowserStore(fakeIndexedDB(1, records, c), undefined, load).transaction();
  assert.equal(load.calls, 0, 'nothing to migrate, so the recipes are not even loaded');
  assert.equal(c.writes, 0);
  assert.deepEqual(records, once);
  const plain = record([calculated]);
  const other = new Map<string, unknown>([['main', structuredClone(plain)]]);
  const d = controls();
  await openBrowserStore(fakeIndexedDB(1, other, d), undefined, loader()).transaction();
  assert.equal(d.writes, 0);
  assert.equal(other.has(PRE_HANDBOOK), false);
  assert.deepEqual(main(other), plain);
  // A new browser has nothing to migrate either.
  const fresh = new Map<string, unknown>();
  await openBrowserStore(fakeIndexedDB(0, fresh), undefined, loader()).transaction();
  assert.equal(fresh.size, 0);
});

test('an original profile without its own handbook is left as it is', async () => {
  const bare = original('bare');
  delete bare.handbook;
  const seeded = record([bare, original('p')]);
  const records = new Map<string, unknown>([['main', structuredClone(seeded)]]);
  const store = openBrowserStore(fakeIndexedDB(1, records), undefined, loader());
  const read = await store.transaction();
  assert.deepEqual(read.saves[0]!.profiles[0], bare, 'no handbook to transcribe it from');
  assert.equal(read.saves[0]!.profiles[1]!.kind, 'calculated');
  assert.deepEqual(records.get(PRE_HANDBOOK), seeded);
  // Alone, it is nothing to migrate: no copy, no write.
  const alone = new Map<string, unknown>([['main', record([bare])]]);
  const c = controls(),
    load = loader();
  await openBrowserStore(fakeIndexedDB(1, alone, c), undefined, load).transaction();
  assert.equal(load.calls, 0);
  assert.equal(c.writes, 0);
  assert.equal(alone.has(PRE_HANDBOOK), false);
});

test('an interrupted migration leaves the record as it was, and the next transaction finishes it', async () => {
  const seeded = record([original('p'), calculated]);
  const records = new Map<string, unknown>([['main', structuredClone(seeded)]]);
  const c = controls();
  c.failNextCommit = true;
  const store = openBrowserStore(fakeIndexedDB(1, records, c), undefined, loader());
  const failure = await store.transaction().then(
    () => null,
    (e: Error & { storedData?: boolean }) => e,
  );
  assert.match(String(failure), /could not be updated.*Nothing has been changed.*disk is full/s);
  assert.equal(failure?.storedData, true, 'the error page offers the download');
  assert.deepEqual(main(records), seeded, 'the record is unchanged');
  assert.equal(records.has(PRE_HANDBOOK), false, 'and no copy is half written');
  // The next transaction (the next request, or a reload) tries again.
  const read = await store.transaction();
  assert.equal(read.saves[0]!.profiles[0]!.kind, 'calculated');
  assert.deepEqual(records.get(PRE_HANDBOOK), seeded);
});

test('a failure mid-migration writes nothing, and an earlier copy under the second key stays intact', async () => {
  // A copy from an earlier migration, and since then original profiles imported again. The
  // second one's state is from a newer release, which validateState refuses: the first profile
  // is already converted in memory when that throws.
  const earlier = { kept: 'from the first migration' };
  const newer = original('newer');
  // @ts-expect-error: a state of a newer release, which no released version describes.
  newer.state = { ...newer.state, version: 99 };
  const seeded = record([original('p'), newer]);
  const records = new Map<string, unknown>([
    ['main', structuredClone(seeded)],
    [PRE_HANDBOOK, earlier],
  ]);
  const c = controls(),
    load = loader();
  const store = openBrowserStore(fakeIndexedDB(1, records, c), undefined, load);
  await assert.rejects(store.transaction(), /could not be updated.*newer planner/s);
  await assert.rejects(
    store.transaction(d => (d.activeSave = null)),
    /could not be updated/,
  );
  assert.equal(c.writes, 0);
  assert.deepEqual(main(records), seeded, 'the record is unchanged');
  assert.deepEqual(records.get(PRE_HANDBOOK), earlier, 'the earlier copy is never replaced');
  assert.equal(load.calls, 2, 'each transaction tried again');
  // A later migration that succeeds keeps the earlier copy too.
  main(records).saves[0]!.profiles.pop();
  await store.transaction();
  assert.equal(main(records).saves[0]!.profiles[0]!.kind, 'calculated');
  assert.deepEqual(records.get(PRE_HANDBOOK), earlier);
});

test('recipes that fail to load change nothing, and the next transaction loads them again', async () => {
  const seeded = record([original('p')]);
  const records = new Map<string, unknown>([['main', structuredClone(seeded)]]);
  let calls = 0;
  const store = openBrowserStore(fakeIndexedDB(1, records), undefined, async () => {
    if (++calls === 1) throw Error('Could not load the recipes');
    return { recipes, pureLimits };
  });
  await assert.rejects(store.transaction(), /Could not load the recipes/);
  assert.deepEqual(main(records), seeded);
  assert.equal(records.has(PRE_HANDBOOK), false);
  assert.equal((await store.transaction()).saves[0]!.profiles[0]!.kind, 'calculated');
  assert.equal(calls, 2);
});

test('a damaged or newer record is not migrated, only refused as before', async () => {
  for (const found of [
    { version: 2, saves: [{ id: 's', profiles: [original('p')] }] },
    { version: 1, saves: [{ id: 's', profiles: [{ ...original('p'), state: null }] }] },
  ]) {
    const records = new Map<string, unknown>([['main', structuredClone(found)]]);
    const load = loader();
    await assert.rejects(
      openBrowserStore(fakeIndexedDB(1, records), undefined, load).transaction(),
      /newer version|could not be read/,
    );
    assert.equal(load.calls, 0);
    assert.deepEqual(records.get('main'), found);
    assert.equal(records.has(PRE_HANDBOOK), false);
  }
});

// A tab of an earlier release, still open: its connection is at schema version 1 and, like every
// release since 2026-09-26 (`closes`), it closes when another tab upgrades the database, refusing
// its later writes with a reload message. `write` is its /api/update: one readwrite transaction
// on `main` that changes the record in place, as the earlier openBrowserStore did.
const earlierTab = (indexedDB: IDBFactory, closes = true) =>
  new Promise<{
    closed: boolean;
    close(): void;
    write(change: (d: BrowserWorkspace) => void): Promise<void>;
  }>((resolve, reject) => {
    const request = indexedDB.open('satisfactory-planner-browser-v1', 1);
    request.onsuccess = () => {
      const db = request.result;
      const tab = {
        closed: false,
        close() {
          tab.closed = true;
          db.close();
        },
        write: (change: (d: BrowserWorkspace) => void) =>
          new Promise<void>((done, fail) => {
            if (tab.closed) return fail(Error('Reload this tab to continue.'));
            const tx = db.transaction('workspace', 'readwrite'),
              store = tx.objectStore('workspace'),
              get = store.get('main');
            get.onsuccess = () => {
              const data = get.result as BrowserWorkspace;
              change(data);
              store.put(data, 'main');
            };
            tx.oncomplete = () => done();
            tx.onabort = () => fail(tx.error);
          }),
      };
      if (closes) db.onversionchange = () => tab.close();
      resolve(tab);
    };
    request.onerror = () => reject(request.error);
  });

test('a tab of the previous release still open is closed by the migration, so it files nothing under handbook keys (#518)', async () => {
  const seeded = record([original('p')]);
  const records = new Map<string, unknown>([['main', structuredClone(seeded)]]);
  const indexedDB = fakeIndexedDB(1, records);
  // Tab A loaded the previous release: it still shows the original profile.
  const earlier = await earlierTab(indexedDB);
  // Tab B opens this release, which migrates the record.
  const read = await openBrowserStore(indexedDB, undefined, loader()).transaction();
  assert.equal(read.saves[0]!.profiles[0]!.kind, 'calculated');
  // In tab A the user ticks the factory and edits its note, under the handbook's keys.
  const handbookCheck = 'factory-3-' + factory.id,
    handbookNote = 'factory-' + factory.id;
  const tick = await earlier
    .write(d => {
      const state = d.saves[0]!.profiles[0]!.state;
      state.checks[handbookCheck] = false;
      state.notes[handbookNote] = 'Moved to the hill';
    })
    .then(
      () => 'written',
      (error: Error) => error.message,
    );
  const migrated = main(records).saves[0]!.profiles[0]!;
  assert.equal(migrated.state.checks[handbookCheck], undefined, 'no tick under a handbook key');
  assert.equal(migrated.state.notes[handbookNote], undefined, 'no note under a handbook key');
  assert.equal(migrated.state.checks['calc-3-' + row], true, 'the migrated tick is intact');
  assert.equal(migrated.state.notes['factory-' + row], 'By the lake');
  assert.equal(earlier.closed, true, 'the earlier tab heard of the upgrade and closed');
  assert.match(tick, /Reload/, 'its write is refused with a reload message');
  // After a reload, the previous release refuses the upgraded database with a VersionError,
  // which it reports as saves written by a newer version.
  await assert.rejects(earlierTab(indexedDB), { name: 'VersionError' });
  assert.deepEqual(records.get(PRE_HANDBOOK), seeded);
});

test('a tab of a release that does not close for an upgrade blocks it, until it is closed', async () => {
  const seeded = record([original('p')]);
  const records = new Map<string, unknown>([['main', structuredClone(seeded)]]);
  const indexedDB = fakeIndexedDB(1, records);
  const earlier = await earlierTab(indexedDB, false);
  const store = openBrowserStore(indexedDB, undefined, loader());
  await assert.rejects(store.transaction(), /Close other planner tabs/);
  assert.deepEqual(main(records), seeded, 'nothing migrated while the older tab is open');
  earlier.close();
  // The next request (or a reload) upgrades and migrates.
  assert.equal((await store.transaction()).saves[0]!.profiles[0]!.kind, 'calculated');
  assert.deepEqual(records.get(PRE_HANDBOOK), seeded);
});

test('a failed migration keeps schema version 1, so the previous release still opens the saves', async () => {
  const seeded = record([original('p')]);
  const records = new Map<string, unknown>([['main', structuredClone(seeded)]]);
  const c = controls();
  c.failNextCommit = true;
  const indexedDB = fakeIndexedDB(1, records, c);
  await assert.rejects(
    openBrowserStore(indexedDB, undefined, loader()).transaction(),
    /could not be updated/,
  );
  const earlier = await earlierTab(indexedDB);
  await earlier.write(d => (d.activeSave = 's'));
  assert.deepEqual(main(records), seeded);
  assert.equal(records.has(PRE_HANDBOOK), false);
  earlier.close();
});

test('an original profile stored after the upgrade (an import) is migrated on the next open', async () => {
  // Schema version 2 already: no earlier release can have this database open.
  const seeded = record([original('p'), calculated]);
  const records = new Map<string, unknown>([['main', structuredClone(seeded)]]);
  const c = controls(),
    load = loader();
  const read = await openBrowserStore(fakeIndexedDB(2, records, c), undefined, load).transaction();
  assert.equal(load.calls, 1);
  assert.equal(c.writes, 1);
  assert.equal(read.saves[0]!.profiles[0]!.kind, 'calculated');
  assert.equal(read.saves[0]!.profiles[0]!.state.checks['calc-3-' + row], true);
  assert.deepEqual(records.get(PRE_HANDBOOK), seeded);
});
