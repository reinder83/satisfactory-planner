// Train stations and their platforms (#1284, slice 1): the progress state's `trainStations` (state
// version 29). Every released format loads unchanged and gains no field, an upgrade from 28, 27
// and 1 keeps everything else, a malformed station or part of one is left out while the rest is
// kept, the last station deleted brings the state back to the version its other content needs,
// and a newer version is refused with the update message. The `trainStation` update adds,
// replaces and removes one station and refuses a malformed one; removing a factory leaves its
// stations without an owner. Both editions save the stations, keep them through a reload, a full
// export and import, a progress backup and its restore, and a recalculation in place; a new
// profile carried with its factories takes them, and a share keeps them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { calculate, catalog } from '../planner.ts';
import {
  checkBase,
  mutate,
  newProfileState,
  shareState,
  TRAIN_CARGO_MAX,
  TRAIN_PLATFORM_MAX,
  TRAIN_STATION_MAX,
  validateState,
} from '../public/state.ts';
import { validateTransfer } from '../public/transfer.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import {
  cargoItems,
  moveAt,
  newStationId,
  newStationName,
  nodesText,
  ownerText,
  platformCounts,
  platformOfKind,
  platformText,
  removeAt,
} from '../public/app/train-stations.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { states, version1, version27, version28, version29 } from './types/fixtures.ts';
import type {
  ProgressState,
  SaveExport,
  StoredCalculatedPlan,
  TrainPlatform,
  TrainStation,
  UpdateOp,
  WorkspaceSummary,
} from '../public/types/index.ts';

const CARGO_ITEMS = cargoItems(new Set(['Water', 'Crude Oil']));
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const MINE: TrainStation = {
  id: 'ts-mine01',
  name: 'Iron mine',
  owner: { kind: 'outpost', resource: 'Iron Ore', nodes: { pure: 3 } },
  platforms: [{ kind: 'empty' }, { kind: 'load', cargo: ['Iron Ore'], belt: 5 }],
};
const DROP: TrainStation = {
  id: 'ts-drop02',
  name: 'Plates drop-off',
  owner: { kind: 'factory', id: 'fg-plates1' },
  platforms: [{ kind: 'unload', belt: 4 }],
};
const stationOp = (station: TrainStation | string, remove = false): UpdateOp => {
  if (typeof station === 'string') return { type: 'trainStation', id: station, value: null };
  const { id, ...value } = station;
  return { type: 'trainStation', id, value: remove ? null : value };
};

test('train stations are state version 29; every released format loads unchanged', () => {
  for (const [state, version] of states) {
    const clean = validateState(json(state));
    assert.equal(clean.version, version);
    if (version < 29) assert.equal('trainStations' in clean, false, `version ${version}`);
  }
  const clean = validateState(json(version29));
  assert.equal(clean.version, 29);
  assert.deepEqual(clean.trainStations, version29.trainStations);
  assert.deepEqual(validateState(json(clean)), clean, 'a repeated load changes nothing');
  // From version 28, 27 and 1: the field comes on top, everything else as it was. Version 1 has
  // no factories, so its station is an outpost's.
  for (const older of [version28, version27, version1]) {
    const before = validateState(json(older));
    const upgraded = validateState(json({ ...older, trainStations: [MINE] }));
    assert.equal(upgraded.version, 29);
    assert.deepEqual(upgraded.trainStations, [MINE]);
    const { trainStations: _stations, ...rest } = upgraded;
    assert.deepEqual({ ...rest, version: before.version }, before);
    // No station is no content: an empty list stays at the old version.
    assert.deepEqual(validateState(json({ ...older, trainStations: [] })), before);
  }
  // A newer planner's state is refused with the update message, never stripped.
  assert.throws(
    () => validateState({ ...json(version29), version: 30 }),
    /newer planner version\. Update the app/,
  );
});

test('a malformed station or part is left out and the rest is kept', () => {
  const at = (stations: unknown) => validateState(json({ ...version28, trainStations: stations }));
  // Not a list at all: no stations, the rest of the state as it was.
  for (const bad of ['stations', { 0: MINE }, null, 7])
    assert.deepEqual(at(bad), validateState(json(version28)), JSON.stringify(bad));
  // Stations that cannot be kept go; the good ones stay in their order.
  const kept = at([
    { ...MINE, id: 'mine' },
    MINE,
    { ...DROP, name: '   ' },
    { ...DROP, name: 'x'.repeat(61) },
    'Iron mine',
    null,
    DROP,
    { ...MINE, name: 'Same id again' },
  ]);
  assert.deepEqual(kept.trainStations, [MINE, DROP]);
  // Inside a station: an owner that is no factory of the profile, an unknown resource and bad node
  // counts; unknown and repeated cargo, a belt that is no mark, a platform of no known kind.
  const cleaned = at([
    {
      ...MINE,
      name: '  Iron mine  ',
      extra: true,
      owner: { kind: 'outpost', resource: 'Iron Ore', nodes: { pure: 3, normal: 1.5, impure: -1 } },
      platforms: [
        { kind: 'empty', cargo: ['Iron Ore'] },
        { kind: 'load', cargo: ['Iron Ore', 'Unobtainium', 'Iron Ore'], belt: 7 },
        { kind: 'dock' },
        'load',
        { kind: 'unload', belt: 2, cargo: ['Coal'] },
        { kind: 'load', cargo: 'Coal', belt: 1 },
      ],
    },
    { ...DROP, owner: { kind: 'factory', id: 'fg-gone01' } },
    { ...DROP, id: 'ts-drop03', owner: { kind: 'outpost', resource: 'Water' } },
    { ...DROP, id: 'ts-drop04', owner: { kind: 'outpost', resource: 'Coal', nodes: 'many' } },
    { ...DROP, id: 'ts-drop05', owner: 'storage', platforms: 'four' },
  ]);
  assert.deepEqual(cleaned.trainStations, [
    {
      id: 'ts-mine01',
      name: 'Iron mine',
      owner: { kind: 'outpost', resource: 'Iron Ore', nodes: { pure: 3 } },
      platforms: [
        { kind: 'empty' },
        { kind: 'load', cargo: ['Iron Ore'] },
        { kind: 'unload', belt: 2 },
        { kind: 'load', cargo: [], belt: 1 },
      ],
    },
    { id: 'ts-drop02', name: 'Plates drop-off', platforms: DROP.platforms },
    { id: 'ts-drop03', name: 'Plates drop-off', platforms: DROP.platforms },
    {
      id: 'ts-drop04',
      name: 'Plates drop-off',
      owner: { kind: 'outpost', resource: 'Coal', nodes: {} },
      platforms: DROP.platforms,
    },
    { id: 'ts-drop05', name: 'Plates drop-off', platforms: [] },
  ]);
  // A key of "__proto__" as JSON gives it is just an unknown field.
  const proto = validateState({
    ...json(version28),
    trainStations: [JSON.parse('{"__proto__":{"x":1},"id":"ts-mine01","name":"A","platforms":[]}')],
  });
  assert.deepEqual(proto.trainStations, [{ id: 'ts-mine01', name: 'A', platforms: [] }]);
  // The limits: stations, platforms and cargo past them are left out.
  const many = Array.from({ length: TRAIN_STATION_MAX + 3 }, (_, i) => ({
    id: `ts-s${String(i).padStart(4, '0')}`,
    name: `Station ${i}`,
    platforms: [],
  }));
  assert.equal(at(many).trainStations!.length, TRAIN_STATION_MAX);
  const long = at([{ ...MINE, platforms: Array(TRAIN_PLATFORM_MAX + 5).fill({ kind: 'empty' }) }]);
  assert.equal(long.trainStations![0]!.platforms.length, TRAIN_PLATFORM_MAX);
  const mixed = at([
    { ...MINE, platforms: [{ kind: 'load', cargo: CARGO_ITEMS.slice(0, TRAIN_CARGO_MAX + 2) }] },
  ]);
  const cargo = mixed.trainStations![0]!.platforms[0]!;
  assert.equal(cargo.kind === 'load' && cargo.cargo.length, TRAIN_CARGO_MAX);
});

test('the update adds, replaces and removes one station; a removed factory leaves its owner', () => {
  const added = mutate(json(version28), stationOp(MINE));
  assert.equal(added.version, 29);
  assert.deepEqual(added.trainStations, [MINE]);
  const both = mutate(json(added), stationOp(DROP));
  assert.deepEqual(both.trainStations, [MINE, DROP]);
  // Replaced where it is: a rename, another owner, platforms moved and added.
  const renamed: TrainStation = {
    ...MINE,
    name: 'Iron mine north',
    owner: { kind: 'storage' },
    platforms: [MINE.platforms[1]!, MINE.platforms[0]!, { kind: 'unload' }],
  };
  const replaced = mutate(json(both), stationOp(renamed));
  assert.deepEqual(replaced.trainStations, [renamed, DROP]);
  const removed = mutate(json(replaced), stationOp(MINE.id));
  assert.deepEqual(removed.trainStations, [DROP]);
  assert.deepEqual(mutate(json(removed), stationOp(MINE.id)), removed, 'gone stays gone');
  const none = mutate(json(removed), stationOp(DROP.id));
  assert.equal('trainStations' in none, false);
  assert.deepEqual(none, validateState(json(version28)), 'version 28 again, exactly as before');
  assert.equal(none.version, 28);
  // An update is checked whole: any malformed part refuses it.
  assert.throws(
    () =>
      mutate(json(version28), stationOp({ ...DROP, owner: { kind: 'factory', id: 'fg-x0001' } })),
    /Unknown factory/,
  );
  const bad = (value: unknown, id = 'ts-new01') =>
    ({ type: 'trainStation', id, value }) as UpdateOp;
  for (const update of [
    bad({ name: 'A', platforms: [] }, 'station'),
    bad('A'),
    bad({ name: ' ', platforms: [] }),
    bad({ name: 'A', platforms: [{ kind: 'dock' }] }),
    bad({ name: 'A', platforms: [{ kind: 'load', cargo: ['Unobtainium'] }] }),
    bad({ name: 'A', platforms: [{ kind: 'load', cargo: ['Coal', 'Coal'] }] }),
    bad({ name: 'A', platforms: [{ kind: 'unload', belt: 0 }] }),
    bad({ name: 'A', platforms: 'none' }),
    bad({ name: 'A', platforms: Array(TRAIN_PLATFORM_MAX + 1).fill({ kind: 'empty' }) }),
    bad({ name: 'A', owner: { kind: 'outpost', resource: 'Iron Ore', nodes: { pure: 100 } } }),
    bad({ name: 'A', owner: { kind: 'outpost', resource: 'Water', nodes: {} } }),
    bad({ name: 'A', owner: { kind: 'shop' }, platforms: [] }),
    { type: 'trainStation', id: 'ts-new01' } as UpdateOp,
  ])
    assert.throws(() => mutate(json(version28), update), /Invalid train station/);
  // At most TRAIN_STATION_MAX stations; replacing one of them still works.
  const full = validateState(
    json({
      ...version28,
      trainStations: Array.from({ length: TRAIN_STATION_MAX }, (_, i) => ({
        id: `ts-s${String(i).padStart(4, '0')}`,
        name: `Station ${i}`,
        platforms: [],
      })),
    }),
  );
  assert.throws(() => mutate(json(full), stationOp(MINE)), /at most 200 train stations/);
  assert.doesNotThrow(() =>
    mutate(json(full), stationOp({ id: 'ts-s0003', name: 'Renamed', platforms: [] })),
  );
  // Removing a factory on the Factories page keeps its stations, without an owner.
  const owned = mutate(json(both), { type: 'factoryGroupRemove', id: 'fg-plates1' });
  assert.deepEqual(owned.trainStations, [MINE, { ...DROP, owner: undefined }].map(json));
  // One station per write: never refused for a stale revision.
  const current = { ...validateState(json(version29)), revision: 4 };
  assert.doesNotThrow(() => checkBase(current, stationOp(MINE), '2'));
});

test('a new profile carried with its factories takes the stations; a share keeps them', () => {
  const source = validateState(json(version29));
  const carried = newProfileState(null, json(source), null, { planEdits: true }, undefined).state;
  assert.deepEqual(carried.trainStations, version29.trainStations);
  assert.equal(carried.version, 29);
  // Without its factories it starts with none.
  const without = newProfileState(null, json(source), null, { notes: true }, undefined).state;
  assert.equal('trainStations' in without, false);
  assert.deepEqual(shareState(json(source)).trainStations, version29.trainStations);
});

test('the station words: owners, platforms, counts and a new name', () => {
  const groups = [{ id: 'fg-plates1', name: 'Plates' }];
  assert.equal(ownerText(DROP.owner, groups), 'Factory: Plates');
  assert.equal(ownerText(DROP.owner, []), 'No owner set');
  assert.equal(ownerText(undefined, groups), 'No owner set');
  assert.equal(ownerText({ kind: 'storage' }, groups), 'Storage');
  assert.equal(ownerText(MINE.owner, groups), 'Mining outpost: Iron Ore on 3 pure nodes');
  assert.equal(
    ownerText({ kind: 'outpost', resource: 'Coal', nodes: {} }, groups),
    'Mining outpost: Coal',
  );
  assert.equal(nodesText({ pure: 1 }), '1 pure node');
  assert.equal(nodesText({ impure: 2, pure: 1, normal: 1 }), '1 pure, 1 normal and 2 impure nodes');
  assert.equal(platformText({ kind: 'empty' }), 'Empty platform');
  assert.equal(platformText({ kind: 'unload' }), 'Unload');
  assert.equal(platformText({ kind: 'unload', belt: 3 }), 'Unload · Mk.3 (270/min) belt');
  assert.equal(platformText({ kind: 'load', cargo: [] }), 'Load (no cargo picked)');
  assert.equal(
    platformText({ kind: 'load', cargo: ['Iron Plate', 'Iron Rod'], belt: 6 }),
    'Load Iron Plate and Iron Rod · Mk.6 (1,200/min) belt',
  );
  assert.equal(platformCounts([]), 'No platforms yet');
  assert.equal(platformCounts(MINE.platforms), '2 platforms: 1 load, 1 empty');
  assert.equal(platformCounts([{ kind: 'unload' }]), '1 platform: 1 unload');
  assert.equal(newStationName([]), 'Station 1');
  assert.equal(newStationName([{ name: 'Station 2' }]), 'Station 3');
  assert.equal(newStationName([{ name: 'Station 2' }, { name: 'Station 3' }]), 'Station 4');
  assert.match(newStationId(), /^ts-[a-z0-9]{10}$/);
  assert.equal(CARGO_ITEMS.includes('Water'), false, 'fluids go by pipe, not on a belt');
  assert.equal(CARGO_ITEMS.includes('Iron Ore'), true);
  // The editor's list operations never change their input.
  const list = ['a', 'b', 'c'];
  assert.deepEqual(moveAt(list, 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(moveAt(list, 2, -1), ['a', 'c', 'b']);
  assert.deepEqual(moveAt(list, 0, -1), list);
  assert.deepEqual(moveAt(list, 2, 1), list);
  assert.deepEqual(removeAt(list, 1), ['a', 'c']);
  assert.deepEqual(list, ['a', 'b', 'c']);
  // A platform changing kind keeps its belt between load and unload, its cargo while loading.
  const load: TrainPlatform = { kind: 'load', cargo: ['Coal'], belt: 2 };
  assert.deepEqual(platformOfKind('unload', load), { kind: 'unload', belt: 2 });
  assert.deepEqual(platformOfKind('load', load), load);
  assert.deepEqual(platformOfKind('load', { kind: 'unload' }), { kind: 'load', cargo: [] });
  assert.deepEqual(platformOfKind('empty', load), { kind: 'empty' });
  assert.deepEqual(platformOfKind('unload', { kind: 'empty' }), { kind: 'unload' });
});

// Both editions: the stations are saved, kept through a reload, a full export and import, a
// progress backup and its restore, and a recalculation in place that carries nothing, which keeps
// every station and the owner of each whose factory the recalculated profile still has.
const BASE = { phase: '3', recipes: 'standard' };
async function checkEdition(
  request: (route: string, body?: unknown) => Promise<unknown>,
  reload: () => Promise<void>,
) {
  type Context = { profile: { id: string }; plan: StoredCalculatedPlan; state: ProgressState };
  const context = async () => (await request('/api/context')) as Context;
  await request('/api/profiles', { saveName: 'World', name: 'Stations', settings: BASE });
  const planned = (await context()).state.factoryGroups.groups[0]!;
  assert.ok(planned, 'the plan has a factory');
  await request('/api/update', { type: 'factoryGroupAdd', id: 'fg-mine01', name: 'Mine' });
  const plannedDrop = { ...DROP, owner: { kind: 'factory', id: planned.id } } as TrainStation;
  const handDrop = { ...DROP, id: 'ts-hand03', owner: { kind: 'factory', id: 'fg-mine01' } };
  await request('/api/update', stationOp(MINE));
  await request('/api/update', stationOp(plannedDrop));
  await request('/api/update', stationOp(handDrop as TrainStation));
  await reload();
  const after = await context();
  assert.equal(after.state.version, 29);
  const all = [MINE, plannedDrop, handDrop];
  assert.deepEqual(after.state.trainStations, all);
  // A full export carries them and an import brings them back on the copy.
  const exported = (await request('/api/export-saves')) as SaveExport;
  assert.deepEqual(validateTransfer(exported).saves[0]!.profiles[0]!.state.trainStations, all);
  await request('/api/import-saves', exported);
  const summary = (await request('/api/workspace')) as WorkspaceSummary;
  assert.equal(summary.saves.length, 2);
  // The progress backup and its restore.
  const backup = (await request('/api/export')) as { state: ProgressState };
  assert.deepEqual(backup.state.trainStations, all);
  for (const station of all) await request('/api/update', stationOp(station.id));
  assert.equal('trainStations' in (await context()).state, false);
  await request('/api/import', backup);
  const restored = await context();
  assert.deepEqual(restored.state.trainStations, all);
  // A recalculation in place that carries nothing: the plan's own factories again, so the station
  // of the factory added by hand stays without its owner, and the others are kept as they were.
  await request('/api/recalculate', {
    name: 'Stations',
    backupName: 'Stations (before edit)',
    settings: restored.plan.settings,
    planCreatedAt: restored.plan.createdAt,
    carry: {},
  });
  const recalculated = await context();
  assert.notEqual(recalculated.plan.createdAt, restored.plan.createdAt, 'recalculated');
  const { owner: _owner, ...unowned } = handDrop;
  assert.deepEqual(recalculated.state.trainStations, [MINE, plannedDrop, unowned]);
  return { exported, all };
}

async function dockerEdition<T>(
  run: (
    request: (route: string, body?: unknown) => Promise<unknown>,
    reload: () => Promise<void>,
  ) => Promise<T>,
) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'satisfactory-stations-'));
  let server: Awaited<ReturnType<typeof createApp>> | undefined;
  let url = '';
  const listen = async () => {
    server = await createApp({ dataDir: dir, password: '' });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  };
  const close = () => new Promise<void>(resolve => server!.close(() => resolve()));
  const request = async (route: string, body?: unknown) => {
    const res = await fetch(url + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(res.ok, route + ' ' + res.status + ' ' + (res.ok ? '' : await res.clone().text()));
    return res.json();
  };
  await listen();
  try {
    return await run(request, async () => {
      await close();
      await listen();
    });
  } finally {
    await close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
}
const browserEdition = (records = new Map<string, unknown>()) => {
  const open = () =>
    createBrowserApi(
      openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      catalog(),
    );
  let api = open();
  return {
    records,
    request: (route: string, body?: unknown) =>
      api(route, body === undefined ? undefined : { body: JSON.stringify(body) }),
    reload: async () => {
      api = open();
    },
  };
};

test('the Docker server keeps train stations, and a browser edition imports its export', async () => {
  const { exported, all } = await dockerEdition(checkEdition);
  const browser = browserEdition();
  await browser.request('/api/import-saves', exported);
  const stored = (
    browser.records.get('main') as { saves: { profiles: { state: ProgressState }[] }[] }
  ).saves[0]!.profiles[0]!.state;
  assert.deepEqual(stored.trainStations, all);
  assert.equal(stored.version, 29);
});

test('the browser edition keeps train stations, and the Docker server imports its export', async () => {
  const browser = browserEdition();
  const { exported, all } = await checkEdition(browser.request, browser.reload);
  await dockerEdition(async request => {
    await request('/api/import-saves', exported);
    const { state } = (await request('/api/context')) as { state: ProgressState };
    assert.deepEqual(state.trainStations, all);
  });
});

// The browser edition serves stored progress without validateState (AGENTS.md): a version-29
// record keeps its stations and a version-28 one loads as it was, without them.
test('the browser edition loads stored progress of version 28 and 29 unchanged', async () => {
  for (const state of [version28, version29]) {
    const browser = browserEdition();
    await browser.request('/api/profiles', { saveName: 'World', name: 'Old', settings: BASE });
    const main = browser.records.get('main') as { saves: { profiles: { state: unknown }[] }[] };
    main.saves[0]!.profiles[0]!.state = json(state);
    await browser.reload();
    const loaded = (await browser.request('/api/context')) as { state: ProgressState };
    assert.deepEqual(loaded.state, validateState(json(state)));
    assert.equal(loaded.state.version, state.version);
  }
});
