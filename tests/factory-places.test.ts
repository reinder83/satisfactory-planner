// Factories placed on the world map (#1283, slice 3): the progress state's `factoryPlaces` (state
// version 28), by factory group id. Every released format loads unchanged and gains no field, an
// upgrade from 27, 26 and 1 keeps everything else, the field is checked (group ids of the
// profile's factories, finite spots in range, a bounded count), the last place taken off and a
// removed factory bring the state back to the version its other content needs, and a newer
// version is refused with the update message. Both editions save the places, keep them through a
// reload, a full export and import, a progress backup and its restore, and a recalculation in
// place (for the factories it still has); a new profile carried with its factories takes their
// places, and a share keeps them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { calculate, catalog } from '../planner.ts';
import {
  checkBase,
  FACTORY_PLACE_MAX,
  mutate,
  newProfileState,
  shareState,
  validateState,
} from '../public/state.ts';
import { validateTransfer } from '../public/transfer.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import {
  PIN_CLEAR,
  PLACE_STEP,
  factoryAria,
  freePlace,
  placedFactories,
  unplacedFactories,
} from '../public/app/map-factories.ts';
import { onMap } from '../public/app/map-markers.ts';
import { imageToWorld, worldToImage } from '../public/app/world-map.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { states, version1, version26, version27, version28 } from './types/fixtures.ts';
import type {
  FactoryPlaces,
  ProgressState,
  SaveExport,
  StoredCalculatedPlan,
  UpdateOp,
  WorkspaceSummary,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const PLATES = { x: -98000, y: 61250 };
const WIRE = { x: 12500, y: -40000 };
const placeOp = (id: string, value: { x: number; y: number } | null): UpdateOp => ({
  type: 'mapFactory',
  id,
  value,
});

test('factory places are state version 28; every released format loads unchanged', () => {
  for (const [state, version] of states) {
    const clean = validateState(json(state));
    assert.equal(clean.version, version);
    if (version < 28) assert.equal('factoryPlaces' in clean, false, `version ${version}`);
  }
  const clean = validateState(json(version28));
  assert.equal(clean.version, 28);
  assert.deepEqual(clean.factoryPlaces, version28.factoryPlaces);
  assert.deepEqual(validateState(json(clean)), clean, 'a repeated load changes nothing');
  // From version 27, 26 and 1: the field comes on top, everything else as it was. Version 1 has
  // no factories, so it gets one to place.
  const withGroup = {
    ...version1,
    factoryGroups: { groups: [{ id: 'fg-plates1', name: 'Plates' }], assignments: {} },
  };
  for (const older of [version27, version26, withGroup]) {
    const before = validateState(json(older));
    const upgraded = validateState(json({ ...older, factoryPlaces: { 'fg-plates1': PLATES } }));
    assert.equal(upgraded.version, 28);
    assert.deepEqual(upgraded.factoryPlaces, { 'fg-plates1': PLATES });
    const { factoryPlaces: _places, ...rest } = upgraded;
    assert.deepEqual({ ...rest, version: before.version }, before);
    // No place is no content: an empty map stays at the old version.
    assert.deepEqual(validateState(json({ ...older, factoryPlaces: {} })), before);
  }
});

test('the field is checked: the profile’s factories, finite spots in range, a bounded count', () => {
  const at = (places: unknown) => json({ ...version27, factoryPlaces: places });
  // Kept in whole game units, in the Factories page's order; unknown fields are left out.
  const kept = validateState(
    at({ 'fg-wires1': { ...WIRE, x: 12500.4, z: 3 }, 'fg-plates1': { x: -0.3, y: 61250.5 } }),
  );
  assert.deepEqual(kept.factoryPlaces, { 'fg-plates1': { x: 0, y: 61251 }, 'fg-wires1': WIRE });
  assert.deepEqual(Object.keys(kept.factoryPlaces!), ['fg-plates1', 'fg-wires1']);
  for (const bad of [
    { 'fg-other1': PLATES },
    { ungrouped: PLATES },
    { 'fg-PLATES': PLATES },
    { 'fg-plates1': { x: 'east', y: 0 } },
    { 'fg-plates1': { x: 0 } },
    { 'fg-plates1': { x: Number.NaN, y: 0 } },
    { 'fg-plates1': { x: 0, y: 1_000_001 } },
    { 'fg-plates1': [0, 0] },
    { 'fg-plates1': null },
    [PLATES],
    'fg-plates1',
    null,
  ])
    assert.throws(
      () => validateState(at(bad)),
      /Invalid factory places/,
      JSON.stringify(bad ?? null),
    );
  // A key of "__proto__" as JSON gives it, an own property.
  assert.throws(
    () =>
      validateState({
        ...json(version27),
        factoryPlaces: JSON.parse('{"__proto__":{"x":0,"y":0}}'),
      }),
    /Invalid factory places/,
  );
  assert.throws(
    () =>
      validateState({ ...json(version27), factoryPlaces: { 'fg-plates1': { x: Infinity, y: 0 } } }),
    /Invalid factory places/,
  );
  // At most one place per factory, and so at most as many as there can be factories.
  const groups = Array.from({ length: FACTORY_PLACE_MAX }, (_, i) => ({
    id: `fg-g${String(i).padStart(4, '0')}`,
    name: `Factory ${i}`,
  }));
  const many = Object.fromEntries(groups.map(group => [group.id, PLATES]));
  const full = validateState(
    json({ ...version1, factoryGroups: { groups, assignments: {} }, factoryPlaces: many }),
  );
  assert.equal(Object.keys(full.factoryPlaces!).length, FACTORY_PLACE_MAX);
  assert.throws(
    () =>
      validateState(
        json({
          ...version1,
          factoryGroups: { groups, assignments: {} },
          factoryPlaces: { ...many, 'fg-extra1': PLATES },
        }),
      ),
    /Invalid factory places/,
  );
  // A newer planner's state is refused with the update message, never stripped.
  assert.throws(
    () => validateState({ ...json(version28), version: 31 }),
    /newer planner version\. Update the app/,
  );
});

test('the update places, moves and takes off one factory; removing a factory drops its place', () => {
  const placed = mutate(json(version27), placeOp('fg-wires1', WIRE));
  assert.equal(placed.version, 28);
  assert.deepEqual(placed.factoryPlaces, { 'fg-wires1': WIRE });
  const both = mutate(json(placed), placeOp('fg-plates1', PLATES));
  assert.deepEqual(both.factoryPlaces, { 'fg-plates1': PLATES, 'fg-wires1': WIRE });
  const moved = mutate(json(both), placeOp('fg-plates1', { x: 1.6, y: -2 }));
  assert.deepEqual(moved.factoryPlaces, { 'fg-plates1': { x: 2, y: -2 }, 'fg-wires1': WIRE });
  const off = mutate(json(moved), placeOp('fg-plates1', null));
  assert.deepEqual(off.factoryPlaces, { 'fg-wires1': WIRE });
  assert.deepEqual(mutate(json(off), placeOp('fg-plates1', null)), off, 'off stays off');
  const none = mutate(json(off), placeOp('fg-wires1', null));
  assert.equal('factoryPlaces' in none, false);
  assert.deepEqual(none, validateState(json(version27)), 'version 27 again, exactly as before');
  // The same from version 26 (no markers or layers): every place taken off gives back the
  // version-26 state exactly, field for field.
  const on26 = mutate(
    mutate(json(version26), placeOp('fg-plates1', PLATES)),
    placeOp('fg-wires1', WIRE),
  );
  assert.equal(on26.version, 28);
  const back26 = mutate(
    mutate(json(on26), placeOp('fg-wires1', null)),
    placeOp('fg-plates1', null),
  );
  assert.deepEqual(back26, validateState(json(version26)));
  assert.equal(back26.version, 26);
  // Only a factory of the profile, and only a real spot.
  assert.throws(() => mutate(json(version27), placeOp('fg-other1', PLATES)), /Unknown factory/);
  for (const bad of [
    placeOp('ungrouped', PLATES),
    placeOp('fg-plates1', { x: Number.NaN, y: 0 }),
    { type: 'mapFactory', id: 'fg-plates1', value: 'here' },
    { type: 'mapFactory', id: 'fg-plates1' },
  ])
    assert.throws(() => mutate(json(version27), bad as UpdateOp), /Invalid factory place/);
  // Removing a factory on the Factories page takes it off the map too.
  const removed = mutate(json(version28), { type: 'factoryGroupRemove', id: 'fg-plates1' });
  assert.deepEqual(removed.factoryPlaces, { 'fg-wires1': WIRE });
  const empty = mutate(json(removed), { type: 'factoryGroupRemove', id: 'fg-wires1' });
  assert.equal('factoryPlaces' in empty, false);
  assert.equal(empty.version, 27, 'the markers and layers still need 27');
  // Other factory edits leave the places alone.
  const renamed = mutate(json(version28), {
    type: 'factoryGroupRename',
    id: 'fg-plates1',
    name: 'Plates and rods',
  });
  assert.deepEqual(renamed.factoryPlaces, version28.factoryPlaces);
  // One factory per write: never refused for a stale revision.
  const current = { ...validateState(json(version28)), revision: 4 };
  assert.doesNotThrow(() => checkBase(current, placeOp('fg-plates1', WIRE), '2'));
});

test('a new profile carried with its factories takes their places; a share keeps them', () => {
  const source = validateState(json(version28));
  const carried = newProfileState(null, json(source), null, { planEdits: true }, undefined).state;
  assert.deepEqual(carried.factoryPlaces, version28.factoryPlaces);
  assert.equal(carried.version, 28);
  // Without its factories it starts with none on the map.
  const without = newProfileState(null, json(source), null, { notes: true }, undefined).state;
  assert.equal('factoryPlaces' in without, false);
  assert.deepEqual(without.mapMarkers, version28.mapMarkers, 'the markers come with the notes');
  // A share keeps the factories and so their places (the hidden layers stay the sharer's).
  const shared = shareState(json(source));
  assert.deepEqual(shared.factoryPlaces, version28.factoryPlaces);
  assert.equal('mapLayers' in shared, false);
});

test('the map helpers: placed and unplaced factories in order, and the words', () => {
  const groups = [
    { id: 'fg-a0001', name: 'Alpha' },
    { id: 'fg-b0002', name: 'Beta' },
    { id: 'fg-c0003', name: 'Gamma' },
  ];
  const places: FactoryPlaces = { 'fg-c0003': WIRE, 'fg-a0001': PLATES };
  assert.deepEqual(placedFactories(groups, places), [
    { id: 'fg-a0001', name: 'Alpha', place: PLATES },
    { id: 'fg-c0003', name: 'Gamma', place: WIRE },
  ]);
  assert.deepEqual(unplacedFactories(groups, places), [{ id: 'fg-b0002', name: 'Beta' }]);
  assert.deepEqual(placedFactories(groups, undefined), []);
  assert.equal(unplacedFactories(groups, undefined).length, 3);
  assert.equal(
    factoryAria('Alpha'),
    'Alpha, factory. Enter opens its build order, the arrow keys move it, Delete takes it off the map.',
  );
});

test('a new factory’s place steps aside diagonally from every pin, kept on the map', () => {
  const zoom = 0.5;
  const step = PLACE_STEP / zoom;
  const middle = imageToWorld({ x: 1000, y: 1000 });
  const at = (x: number, y: number) => onMap(imageToWorld({ x, y }));
  const drawn = (spot: { x: number; y: number }) => {
    const point = worldToImage(spot);
    return { x: Math.round(point.x), y: Math.round(point.y) };
  };
  assert.deepEqual(freePlace(middle, [], zoom), onMap(middle), 'a free middle');
  assert.deepEqual(freePlace(middle, [at(1000 + 70, 1000)], zoom), onMap(middle), '35 px away');
  // A pin on the middle: one step down and right; that one taken too, one step up and left.
  assert.deepEqual(drawn(freePlace(middle, [middle], zoom)), { x: 1072, y: 1072 });
  assert.deepEqual(drawn(freePlace(middle, [middle, at(1072, 1072)], zoom)), { x: 928, y: 928 });
  const taken = [middle, at(1000 + step, 1000 + step), at(1000 - step, 1000 - step)];
  assert.deepEqual(drawn(freePlace(middle, taken, zoom)), { x: 1144, y: 1144 });
  // Close to a pin, under PIN_CLEAR px on screen, also counts as covered.
  const near = PIN_CLEAR / zoom - 2;
  assert.notDeepEqual(freePlace(middle, [at(1000 + near, 1000)], zoom), onMap(middle));
  // In the bottom-right corner the steps down and right stay in the corner: up and left instead.
  const corner = imageToWorld({ x: 2000, y: 2000 });
  assert.deepEqual(drawn(freePlace(corner, [onMap(corner)], zoom)), { x: 1928, y: 1928 });
  // The steps are px on screen: at a higher zoom they are shorter on the map.
  assert.deepEqual(drawn(freePlace(middle, [middle], 2)), { x: 1018, y: 1018 });
});

// Both editions: the places are saved, kept through a reload, a full export and import, a
// progress backup and its restore, and a recalculation in place that carries nothing, which keeps
// the places of the factories the recalculated profile still has.
const BASE = { phase: '3', recipes: 'standard' };
async function checkEdition(
  request: (route: string, body?: unknown) => Promise<unknown>,
  reload: () => Promise<void>,
) {
  type Context = { profile: { id: string }; plan: StoredCalculatedPlan; state: ProgressState };
  const context = async () => (await request('/api/context')) as Context;
  await request('/api/profiles', { saveName: 'World', name: 'Placed', settings: BASE });
  const planned = (await context()).state.factoryGroups.groups[0]!;
  assert.ok(planned, 'the plan has a factory');
  await request('/api/update', { type: 'factoryGroupAdd', id: 'fg-mine01', name: 'Mine' });
  await request('/api/update', placeOp(planned.id, PLATES));
  await request('/api/update', placeOp('fg-mine01', WIRE));
  await reload();
  const after = await context();
  assert.equal(after.state.version, 28);
  const both = { [planned.id]: PLATES, 'fg-mine01': WIRE };
  assert.deepEqual(after.state.factoryPlaces, both);
  // A full export carries them and an import brings them back on the copy.
  const exported = (await request('/api/export-saves')) as SaveExport;
  assert.deepEqual(validateTransfer(exported).saves[0]!.profiles[0]!.state.factoryPlaces, both);
  await request('/api/import-saves', exported);
  const summary = (await request('/api/workspace')) as WorkspaceSummary;
  assert.equal(summary.saves.length, 2);
  // The progress backup and its restore.
  const backup = (await request('/api/export')) as { state: ProgressState };
  assert.deepEqual(backup.state.factoryPlaces, both);
  await request('/api/update', placeOp(planned.id, null));
  await request('/api/update', { type: 'factoryGroupRemove', id: 'fg-mine01' });
  assert.equal('factoryPlaces' in (await context()).state, false);
  await request('/api/import', backup);
  const restored = await context();
  assert.deepEqual(restored.state.factoryPlaces, both);
  // A recalculation in place that carries nothing: the plan's own factories again, so the one
  // added by hand goes with its place, and the plan's factory keeps its place.
  await request('/api/recalculate', {
    name: 'Placed',
    backupName: 'Placed (before edit)',
    settings: restored.plan.settings,
    planCreatedAt: restored.plan.createdAt,
    carry: {},
  });
  const recalculated = await context();
  assert.notEqual(recalculated.plan.createdAt, restored.plan.createdAt, 'recalculated');
  assert.deepEqual(recalculated.state.factoryPlaces, { [planned.id]: PLATES });
  return { exported, both };
}

async function dockerEdition<T>(
  run: (
    request: (route: string, body?: unknown) => Promise<unknown>,
    reload: () => Promise<void>,
  ) => Promise<T>,
) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'satisfactory-places-'));
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

test('the Docker server keeps factory places, and a browser edition imports its export', async () => {
  const { exported, both } = await dockerEdition(checkEdition);
  const browser = browserEdition();
  await browser.request('/api/import-saves', exported);
  const stored = (
    browser.records.get('main') as { saves: { profiles: { state: ProgressState }[] }[] }
  ).saves[0]!.profiles[0]!.state;
  assert.deepEqual(stored.factoryPlaces, both);
  assert.equal(stored.version, 28);
});

test('the browser edition keeps factory places, and the Docker server imports its export', async () => {
  const browser = browserEdition();
  const { exported, both } = await checkEdition(browser.request, browser.reload);
  await dockerEdition(async request => {
    await request('/api/import-saves', exported);
    // The server had no save, so the imported copy is the one open.
    const { state } = (await request('/api/context')) as { state: ProgressState };
    assert.deepEqual(state.factoryPlaces, both);
  });
});

// The browser edition serves stored progress without validateState (AGENTS.md): a version-28
// record keeps its places and a version-27 one loads as it was, without them.
test('the browser edition loads stored progress of version 27 and 28 unchanged', async () => {
  for (const state of [version27, version28]) {
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
