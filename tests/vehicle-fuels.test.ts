// The complete vehicle fuel list (#1165, part of #1081): a truck, tractor or explorer on a link
// between factories can burn Packaged Oil, Packaged Heavy Oil Residue, Battery and Petroleum Coke
// besides the first eight fuels, each with the game data's energy (recipes.json `items`). A link
// burning one of them is progress state version 17 (laterVehicleFuels); every link saved before
// keeps its fuel, its version and its numbers. The progress side covers both editions: the
// Docker server (createApp, workspace.json) and the browser edition (createBrowserApi over
// openBrowserStore).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import recipes from '../recipes.json' with { type: 'json' };
import { calculate, catalog, settings } from '../planner.ts';
import { laterVehicleFuels, vehicleFuels } from '../public/preferences.ts';
import {
  DEFAULT_FUEL,
  LINK_MODES,
  linkLoad,
  linkTransportUpdate,
  transportFuel,
  VEHICLES,
} from '../public/app/logistics.ts';
import { groupLinks } from '../public/app/group-links.ts';
import { initialState, mutate, newProfileState, validateState } from '../public/state.ts';
import { validateTransfer } from '../public/transfer.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { states, version11, version16, version17 } from './types/fixtures.ts';
import type {
  Catalog,
  LinkTransport,
  ProgressState,
  SaveExport,
  StoredCalculatedPlan,
  UpdateOp,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const gameCatalog = catalog();
const FLUIDS = new Set(
  Object.entries(recipes.items)
    .filter(([, item]) => item.fluid)
    .map(([name]) => name),
);
const energy = (name: string) =>
  (recipes.items as Record<string, { energy: number }>)[name]!.energy;

// The list as it was before #1165, with the energy the catalog gave each (MJ per item).
const FIRST_FUELS: [string, number][] = [
  ['Packaged Fuel', 750],
  ['Packaged Turbofuel', 2000],
  ['Packaged Rocket Fuel', 7200],
  ['Packaged Ionized Fuel', 10000],
  ['Packaged Liquid Biofuel', 750],
  ['Coal', 300],
  ['Compacted Coal', 630],
  ['Solid Biofuel', 450],
];
// The fuels #1165 adds, with the game data's energy (recipes.json, SatisfactoryTools b5210ae9).
const ADDED_FUELS: [string, number][] = [
  ['Packaged Oil', 320],
  ['Packaged Heavy Oil Residue', 400],
  ['Battery', 6000],
  ['Petroleum Coke', 180],
];

const grouped = (): ProgressState => {
  let state = initialState();
  state = mutate(state, { type: 'factoryGroupAdd', id: 'fg-plates1', name: 'Plates' });
  state = mutate(state, { type: 'factoryGroupAdd', id: 'fg-motors1', name: 'Motors' });
  return state;
};
const link = (mode: LinkTransport['mode'], fuel: string | undefined): UpdateOp => ({
  type: 'factoryLinkTransport',
  from: 'fg-plates1',
  to: 'fg-motors1',
  mode,
  roundTripMin: 4,
  ...(fuel ? { fuel } : {}),
});

test('the vehicle fuels add Packaged Oil, Packaged Heavy Oil Residue, Battery and Petroleum Coke with the game data’s energy', () => {
  const listed = new Map(gameCatalog.vehicleFuels.map(fuel => [fuel.name, fuel.mj]));
  for (const [name, mj] of ADDED_FUELS) {
    assert.equal(listed.get(name), mj, name);
    assert.equal(energy(name), mj, `${name} is the item data's energy`);
  }
  assert.deepEqual([...laterVehicleFuels].sort(), ADDED_FUELS.map(([name]) => name).sort());
  // Every listed fuel burns: none is in the list without an energy in the game data.
  for (const { name, mj } of gameCatalog.vehicleFuels) {
    assert.ok(mj > 0, name);
    assert.equal(mj, energy(name), name);
    assert.equal(
      (recipes.items as Record<string, { fluid: boolean; radioactive: boolean }>)[name]!.fluid,
      false,
      `${name} fits a vehicle's fuel slot: a solid or packaged item`,
    );
  }
  assert.equal(vehicleFuels.length, new Set(vehicleFuels).size, 'each fuel listed once');
});

test('the first eight fuels and the default stay exactly as they were', () => {
  const listed = new Map(gameCatalog.vehicleFuels.map(fuel => [fuel.name, fuel.mj]));
  for (const [name, mj] of FIRST_FUELS) assert.equal(listed.get(name), mj, name);
  assert.deepEqual(
    vehicleFuels.filter(name => !laterVehicleFuels.includes(name)),
    FIRST_FUELS.map(([name]) => name),
    'the first fuels keep their names and order',
  );
  assert.equal(DEFAULT_FUEL, 'Packaged Fuel');
  // A newly picked truck still starts on Packaged Fuel.
  const picked = linkTransportUpdate(
    { from: 'fg-plates1', to: 'fg-motors1', mode: 'belt', transport: undefined },
    { mode: 'truck' },
    undefined,
  );
  assert.equal((picked as { fuel?: string }).fuel, 'Packaged Fuel');
  assert.deepEqual(
    LINK_MODES.map(([mode]) => mode),
    ['belt', 'truck', 'fluidTruck', 'tractor', 'explorer', 'train', 'drone'],
  );
});

test('a vehicle on a new fuel burns what the game data gives', () => {
  const items = [{ item: 'Iron Plate', rate: 600 }];
  for (const [fuel, mj] of ADDED_FUELS)
    for (const mode of ['truck', 'tractor', 'explorer'] as const) {
      const load = linkLoad(items, { mode, roundTripMin: 5, fuel }, gameCatalog, FLUIDS);
      assert.ok(load.vehicles > 0);
      assert.equal(load.fuelPerMin, (load.vehicles * VEHICLES[mode].burnMW * 60) / mj, fuel);
    }
  // One truck burns 75 MW: 0.75 Battery, 25 Petroleum Coke a minute.
  const one = (fuel: string) =>
    linkLoad(
      [{ item: 'Iron Plate', rate: 10 }],
      { mode: 'truck', roundTripMin: 5, fuel },
      gameCatalog,
      FLUIDS,
    );
  assert.equal(one('Battery').fuelPerMin, 0.75);
  assert.equal(one('Petroleum Coke').fuelPerMin, 25);
  assert.equal(one('Packaged Oil').fuelPerMin, 14.0625);
  assert.equal(one('Packaged Heavy Oil Residue').fuelPerMin, 11.25);
});

test('links on the first fuels give the same loads and transport fuel as before', () => {
  // The catalog as it was: only the first eight fuels.
  const before: Catalog = {
    ...gameCatalog,
    vehicleFuels: FIRST_FUELS.map(([name, mj]) => ({ name, mj })),
  };
  const items = [
    { item: 'Iron Plate', rate: 600 },
    { item: 'Water', rate: 300 },
  ];
  for (const [fuel] of FIRST_FUELS)
    for (const mode of ['truck', 'tractor', 'explorer'] as const)
      assert.deepEqual(
        linkLoad(items, { mode, roundTripMin: 7, fuel }, gameCatalog, FLUIDS),
        linkLoad(items, { mode, roundTripMin: 7, fuel }, before, FLUIDS),
      );
  // A plan's transport fuel over all its group links, one first fuel per link.
  const plan = calculate({ phase: '3' });
  let state = newProfileState(plan, null, null, undefined, undefined).state;
  const links = groupLinks(plan.stages['3'], state.factoryGroups).filter(
    l => l.from.startsWith('fg-') && l.to.startsWith('fg-'),
  );
  assert.ok(links.length >= 2);
  links.forEach((l, i) => {
    state = mutate(state, {
      type: 'factoryLinkTransport',
      from: l.from,
      to: l.to,
      mode: 'truck',
      roundTripMin: 6,
      fuel: FIRST_FUELS[i % FIRST_FUELS.length]![0],
    });
  });
  assert.equal(state.version, 7, 'links on the first fuels keep version 7');
  const fuel = transportFuel(plan, state.factoryGroups, gameCatalog, FLUIDS);
  assert.ok(Object.keys(fuel).length);
  assert.deepEqual(fuel, transportFuel(plan, state.factoryGroups, before, FLUIDS));
});

test('the planner plans a new fuel as transport fuel, and plans without one are unchanged', () => {
  assert.deepEqual(settings({}).transportFuel, {});
  for (const [name] of ADDED_FUELS)
    assert.deepEqual(settings({ transportFuel: { '4': { [name]: 2 } } }).transportFuel, {
      '4': { [name]: 2 },
    });
  assert.throws(
    () => settings({ transportFuel: { '4': { 'Uranium Fuel Rod': 2 } } }),
    /not a vehicle fuel/,
  );
  const base = calculate({ phase: '3' });
  const plan = calculate({ phase: '3', transportFuel: { '3': { 'Petroleum Coke': 25 } } });
  assert.deepEqual(plan.stages['3'].transport, { 'Petroleum Coke': 25 });
  assert.deepEqual(base.stages['3'].transport, {});
  const made = (p: StoredCalculatedPlan) =>
    (p.stages['3'].rows || []).reduce((sum, r) => sum + (r.outputs['Petroleum Coke'] || 0), 0);
  assert.ok(made(plan) >= made(base) + 25 - 1e-6, 'the plan makes the coke the trucks burn');
});

test('a link on a new fuel is state version 17; going back to a first fuel restores the old version', () => {
  let state = mutate(grouped(), link('truck', 'Packaged Fuel'));
  assert.equal(state.version, 7);
  for (const [fuel] of ADDED_FUELS)
    for (const mode of ['truck', 'tractor', 'explorer'] as const) {
      const next = mutate(state, link(mode, fuel));
      assert.equal(next.version, 17, `${mode} on ${fuel}`);
      assert.deepEqual(next.factoryGroups.links?.['fg-plates1:fg-motors1'], {
        mode,
        roundTripMin: 4,
        fuel,
      });
      // It loads again as it was, and a newer version is refused with the update message.
      const round = validateState(json(next));
      assert.deepEqual(round, next);
      assert.throws(() => validateState({ ...json(round), version: 22 }), /newer planner version/);
    }
  state = mutate(state, link('truck', 'Battery'));
  assert.equal(state.version, 17);
  state = mutate(state, link('truck', 'Coal'));
  assert.equal(state.version, 7, 'a first fuel again: an older release reads it');
  // A state that says less than it needs is marked for what it holds.
  const early = validateState({ ...json(mutate(state, link('truck', 'Battery'))), version: 7 });
  assert.equal(early.version, 17);
  // A train or a drone still burns nothing of its own.
  assert.throws(() => mutate(grouped(), link('drone', 'Battery')), /Invalid vehicle fuel/);
  assert.throws(() => mutate(grouped(), link('train', 'Petroleum Coke')), /Invalid vehicle fuel/);
});

test('every released state loads with the same fuels and version', () => {
  for (const [state, version] of states) {
    const clean = validateState(json(state));
    assert.equal(clean.version, version);
    if (state.factoryGroups && 'links' in state.factoryGroups)
      assert.deepEqual(clean.factoryGroups.links, state.factoryGroups.links);
  }
  assert.equal(validateState(json(version16)).version, 16);
  assert.deepEqual(validateState(json(version17)).factoryGroups.links?.['fg-plates1:elevator'], {
    mode: 'truck',
    roundTripMin: 4,
    fuel: 'Battery',
  });
});

// Both editions: picking a new fuel saves the progress state only (version 17), never
// recalculates the plan, survives a reload and an export; an old save imported keeps its fuel.
async function checkEdition(
  request: (route: string, body?: unknown) => Promise<unknown>,
  reload: () => Promise<void>,
) {
  type Context = { plan: StoredCalculatedPlan; state: ProgressState };
  const context = async () => (await request('/api/context')) as Context;
  await request('/api/profiles', { saveName: 'World', name: 'Trucks', settings: {} });
  await request('/api/update', { type: 'factoryGroupAdd', id: 'fg-plates1', name: 'Plates' });
  await request('/api/update', { type: 'factoryGroupAdd', id: 'fg-motors1', name: 'Motors' });
  await request('/api/update', link('truck', 'Packaged Fuel'));
  const before = await context();
  assert.equal(before.state.version, 7);
  await request('/api/update', link('truck', 'Battery'));
  await reload();
  const after = await context();
  assert.deepEqual(after.plan, before.plan, 'the stored plan is not recalculated');
  assert.equal(after.state.version, 17);
  assert.deepEqual(after.state.factoryGroups.links, {
    'fg-plates1:fg-motors1': { mode: 'truck', roundTripMin: 4, fuel: 'Battery' },
  });
  // A full export carries it and passes the import's check.
  const exported = (await request('/api/export-saves')) as SaveExport;
  const carried = validateTransfer(exported).saves[0]!.profiles[0]!.state;
  assert.equal(carried.version, 17);
  assert.deepEqual(carried.factoryGroups!.links, after.state.factoryGroups.links);
  // Saves from before: a version-11 profile (Packaged Fuel on a tractor) and a version-17 one
  // import with their fuels and versions as they were.
  const old: SaveExport = {
    format: 'satisfactory-planner-saves',
    version: 1,
    exportedAt: '2026-10-14T10:00:00.000Z',
    saves: [
      {
        id: 'old',
        name: 'Old world',
        activeProfile: 'v11',
        profiles: [
          { ...exported.saves[0]!.profiles[0]!, id: 'v11', name: 'Eleven', state: json(version11) },
          {
            ...exported.saves[0]!.profiles[0]!,
            id: 'v17',
            name: 'Seventeen',
            state: json(version17),
          },
        ],
      },
    ],
  };
  await request('/api/import-saves', old);
  await reload();
  const all = (await request('/api/export-saves')) as SaveExport;
  const imported = all.saves.find(save => save.name.startsWith('Old world'))!;
  const byName = (name: string) => imported.profiles.find(p => p.name === name)!.state;
  assert.equal(byName('Eleven').version, 11);
  assert.deepEqual(byName('Eleven').factoryGroups!.links, version11.factoryGroups.links);
  assert.equal(byName('Seventeen').version, 17);
  assert.deepEqual(byName('Seventeen').factoryGroups!.links, version17.factoryGroups.links);
  // Back to a first fuel: the open profile is readable by older releases again.
  await request('/api/update', link('truck', 'Packaged Fuel'));
  assert.equal((await context()).state.version, 7);
}

test('the Docker server keeps a new fuel and old fuels without recalculating', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-fuels-'));
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
    assert.ok(res.ok, route + ' ' + res.status + ' ' + (await res.clone().text()));
    return res.json();
  };
  await listen();
  try {
    await checkEdition(request, async () => {
      await close();
      await listen();
    });
  } finally {
    await close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition keeps a new fuel and old fuels without recalculating', async () => {
  const records = new Map<string, unknown>();
  const open = () =>
    createBrowserApi(
      openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      catalog(),
    );
  let api = open();
  await checkEdition(
    (route, body) => api(route, body === undefined ? undefined : { body: JSON.stringify(body) }),
    async () => {
      api = open();
    },
  );
});

// The game data the planner names (#1165): the dataset revision recipes.json records, the 1.1
// update, whose balance the game kept through 1.2.4.0. README, THIRD_PARTY and the server Backup
// page say so in the same words.
test('README, THIRD_PARTY and the Backup page name the game data recipes.json holds', async () => {
  const words =
    'Satisfactory 1.1 data (SatisfactoryTools b5210ae9), balance unchanged through 1.2.4.0';
  assert.ok(recipes.revision.startsWith('b5210ae9'), recipes.revision);
  assert.equal(recipes.source, 'https://github.com/greeny/SatisfactoryTools');
  for (const file of ['README.md', 'THIRD_PARTY.md', 'public/app/ui/pages/BackupPage.vue'])
    assert.ok(
      (await fs.readFile(new URL('../' + file, import.meta.url), 'utf8'))
        .replace(/\s+/g, ' ')
        .includes(words),
      file,
    );
});
