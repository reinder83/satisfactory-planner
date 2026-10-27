// Game version slice 2 (#1177, part of #1081): a road link that carries a fluid can go by Fluid
// Truck, 3,200 m³ a tank, unpackaged, from Tier 5 (Phase 3) on. The vehicle math follows the
// truck's (a round trip, a fuel, 75 MW); packaging for the other road vehicles stays. A link on
// it is progress state version 18 ('fluidTruck'); every link saved before keeps its mode, its
// version and its numbers. The progress side covers both editions: the Docker server
// (createApp, workspace.json) and the browser edition (createBrowserApi over openBrowserStore).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import recipes from '../recipes.json' with { type: 'json' };
import { calculate, catalog } from '../planner.ts';
import { phaseForTier } from '../public/preferences.ts';
import {
  FLUID_TRUCK_M3,
  FLUID_TRUCK_TIER,
  fluidTruckLater,
  fluidTruckLoads,
  fluidTruckPhase,
  fluidTruckUnlocked,
  linkItemWords,
  linkLoad,
  linkModeOptions,
  linkTransportUpdate,
  linkVehicleText,
  transportFuel,
  VEHICLES,
} from '../public/app/logistics.ts';
import { groupLinks } from '../public/app/group-links.ts';
import { num } from '../public/app/format.ts';
import { initialState, mutate, newProfileState, validateState } from '../public/state.ts';
import { validateTransfer } from '../public/transfer.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { states, version11, version17, version18 } from './types/fixtures.ts';
import type {
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
const BELT = { mark: 'Mk.4', cap: 480 },
  PIPE = { mark: 'Mk.2', cap: 600 };
const tank = (rate: number, roundTripMin = 5, fuel = 'Packaged Fuel') =>
  linkLoad(
    [{ item: 'Fuel', rate }],
    { mode: 'fluidTruck', roundTripMin, fuel },
    gameCatalog,
    FLUIDS,
  );

const grouped = (): ProgressState => {
  let state = initialState();
  state = mutate(state, { type: 'factoryGroupAdd', id: 'fg-plates1', name: 'Plates' });
  state = mutate(state, { type: 'factoryGroupAdd', id: 'fg-motors1', name: 'Motors' });
  return state;
};
const link = (mode: LinkTransport['mode'] | 'belt', fuel?: string): UpdateOp => ({
  type: 'factoryLinkTransport',
  from: 'fg-plates1',
  to: 'fg-motors1',
  mode,
  ...(mode === 'belt' ? {} : { roundTripMin: 4 }),
  ...(fuel ? { fuel } : {}),
});

test('a Fluid Truck fills 3,200 m³ tanks: loads a minute, trucks per round trip and fuel', () => {
  assert.equal(FLUID_TRUCK_M3, 3200);
  // Loads a minute are the flow over a tank, whatever the round trip.
  assert.equal(fluidTruckLoads(160), 0.05);
  assert.equal(fluidTruckLoads(3200), 1);
  assert.equal(fluidTruckLoads(400), 0.125);
  // 400 m³/min on a 5-minute round trip: 2,000 m³ a trip, one truck.
  const one = tank(400);
  assert.equal(one.vehicles, 1);
  assert.deepEqual(one.tanks, [{ item: 'Fuel', vehicles: 1, m3: 2000, loadsPerMin: 0.125 }]);
  // It burns what a truck burns: 75 MW on Packaged Fuel (750 MJ) is 6 a minute.
  assert.equal(VEHICLES.fluidTruck.burnMW, VEHICLES.truck.burnMW);
  assert.equal(one.fuelPerMin, 6);
  // 800 m³/min on 6 minutes: 4,800 m³ a trip, two trucks of 2,400 m³.
  const two = tank(800, 6);
  assert.equal(two.vehicles, 2);
  assert.equal(two.tanks[0]!.m3, 2400);
  assert.equal(two.fuelPerMin, 12);
  // A full tank exactly is one truck, a drop more two.
  assert.equal(tank(640, 5).vehicles, 1);
  assert.equal(tank(640.01, 5).vehicles, 2);
  // The vehicles follow the round trip: twice as long, twice the trucks.
  assert.equal(tank(1280, 5).vehicles, 2);
  assert.equal(tank(1280, 10).vehicles, 4);
  // Battery: 6,000 MJ, so a truck burns 0.75 a minute.
  assert.equal(tank(400, 5, 'Battery').fuelPerMin, 0.75);
});

test('each fluid fills tanks of its own, and a solid item cannot go in one', () => {
  const load = linkLoad(
    [
      { item: 'Fuel', rate: 400 },
      { item: 'Heavy Oil Residue', rate: 100 },
      { item: 'Plastic', rate: 60 },
    ],
    { mode: 'fluidTruck', roundTripMin: 5, fuel: 'Packaged Fuel' },
    gameCatalog,
    FLUIDS,
  );
  assert.deepEqual(load.tanks, [
    { item: 'Fuel', vehicles: 1, m3: 2000, loadsPerMin: 0.125 },
    { item: 'Heavy Oil Residue', vehicles: 1, m3: 500, loadsPerMin: 0.03125 },
  ]);
  assert.equal(load.vehicles, 2);
  assert.deepEqual(load.notFluid, ['Plastic']);
  assert.deepEqual(load.unpackable, [], 'nothing is packaged');
  const text = linkVehicleText(
    [
      { item: 'Fuel', rate: 400 },
      { item: 'Heavy Oil Residue', rate: 100 },
      { item: 'Plastic', rate: 60 },
    ],
    { mode: 'fluidTruck', roundTripMin: 5, fuel: 'Packaged Fuel' },
    gameCatalog,
    FLUIDS,
    BELT,
    PIPE,
  );
  assert.deepEqual(text, {
    lines: [
      `Fuel: 1 fluid truck, ${num(2000)} of ${num(3200)} m³ each trip (${num(0.125)} tank loads/min).`,
      `Heavy Oil Residue: 1 fluid truck, 500 of ${num(3200)} m³ each trip (${num(0.03125)} tank loads/min).`,
      '2 fluid trucks in all, one fluid each. Up to 12 Packaged Fuel/min if they never stop.',
      'Plastic is not a fluid: a Fluid Truck carries only fluids, so keep it on a belt.',
    ],
    badge: '2 fluid trucks',
  });
  assert.deepEqual(
    linkVehicleText(
      [{ item: 'Fuel', rate: 800 }],
      { mode: 'fluidTruck', roundTripMin: 6, fuel: 'Packaged Fuel' },
      gameCatalog,
      FLUIDS,
      BELT,
      PIPE,
    ),
    {
      lines: [
        `2 fluid trucks, ${num(2400)} of ${num(3200)} m³ each trip (${num(0.25)} tank loads/min). Up to 12 Packaged Fuel/min if they never stop.`,
      ],
      badge: '2 fluid trucks',
    },
  );
  // A flow page names the fluids "by fluid truck" and keeps the solid on its belts.
  const words = linkItemWords(
    {
      from: 'fg-plates1',
      to: 'fg-motors1',
      items: [
        { item: 'Fuel', rate: 400 },
        { item: 'Plastic', rate: 60 },
      ],
    },
    { 'fg-plates1:fg-motors1': { mode: 'fluidTruck', roundTripMin: 5, fuel: 'Packaged Fuel' } },
    FLUIDS,
    (rate, fluid) => ({
      lane: fluid ? PIPE : BELT,
      count: Math.ceil(rate / (fluid ? PIPE : BELT).cap),
      word: fluid ? 'pipe' : 'belt',
    }),
    (item, rate) => `${rate}/min of ${item} on belts`,
  );
  assert.equal(words('Fuel', 400), 'by fluid truck');
  assert.equal(words('Plastic', 60), '60/min of Plastic on belts');
});

test('packaging for a road vehicle stays as it was', () => {
  // The same flow on a truck still goes as Packaged Fuel, slot by slot.
  const items = [{ item: 'Fuel', rate: 400 }];
  const truck = linkLoad(
    items,
    { mode: 'truck', roundTripMin: 5, fuel: 'Packaged Fuel' },
    gameCatalog,
    FLUIDS,
  );
  assert.ok(truck.slotsUsed > 0);
  assert.deepEqual(truck.tanks, []);
  assert.deepEqual(truck.notFluid, []);
  const text = linkVehicleText(
    items,
    { mode: 'truck', roundTripMin: 5, fuel: 'Packaged Fuel' },
    gameCatalog,
    FLUIDS,
    BELT,
    PIPE,
  );
  assert.match(text.lines[0]!, /^\d+ trucks?, \d+ of 48 slots each trip\./);
});

test('the Fluid Truck comes with Tier 5: offered from Phase 3, on links that carry a fluid', () => {
  assert.equal(FLUID_TRUCK_TIER, 5);
  assert.equal(fluidTruckPhase(), phaseForTier(5));
  assert.equal(fluidTruckPhase(), 3);
  assert.equal(
    fluidTruckLater(),
    'Fluid Trucks come with Tier 5 (Phase 3): until then, package the fluids for a road vehicle.',
  );
  assert.deepEqual(['1', '2', '3', '4', '5'].map(fluidTruckUnlocked), [
    false,
    false,
    true,
    true,
    true,
  ]);
  const fuel = [{ item: 'Fuel' }],
    plates = [{ item: 'Iron Plate' }];
  const option = (items: { item: string }[], current: 'belt' | LinkTransport['mode'], at: string) =>
    linkModeOptions(items, FLUIDS, current, at).find(entry => entry.mode === 'fluidTruck');
  // A solid link never offers it.
  assert.equal(option(plates, 'belt', '3'), undefined);
  assert.deepEqual(
    linkModeOptions(plates, FLUIDS, 'belt', '3').map(entry => entry.mode),
    ['belt', 'truck', 'tractor', 'explorer', 'train', 'drone'],
  );
  // A fluid link offers it after Truck, disabled with when it comes before Phase 3.
  assert.deepEqual(
    linkModeOptions(fuel, FLUIDS, 'belt', '3').map(entry => entry.mode),
    ['belt', 'truck', 'fluidTruck', 'tractor', 'explorer', 'train', 'drone'],
  );
  assert.deepEqual(option(fuel, 'belt', '2'), {
    mode: 'fluidTruck',
    label: 'Fluid Truck (Tier 5, from Phase 3)',
    disabled: true,
  });
  assert.deepEqual(option(fuel, 'truck', '3'), {
    mode: 'fluidTruck',
    label: 'Fluid Truck',
    disabled: false,
  });
  // A link saved on it keeps it listed and picked, in an earlier phase and on a solid link too.
  assert.equal(option(fuel, 'fluidTruck', '2')!.disabled, false);
  assert.equal(option(plates, 'fluidTruck', '4')!.disabled, false);
  // No other mode is ever disabled.
  for (const at of ['1', '2', '3'])
    assert.ok(
      linkModeOptions(fuel, FLUIDS, 'belt', at)
        .filter(entry => entry.mode !== 'fluidTruck')
        .every(entry => !entry.disabled),
    );
  // Picking it starts on the truck's defaults: 5 minutes and Packaged Fuel.
  assert.deepEqual(
    linkTransportUpdate(
      { from: 'fg-plates1', to: 'fg-motors1', mode: 'belt', transport: undefined },
      { mode: 'fluidTruck' },
      undefined,
    ),
    {
      type: 'factoryLinkTransport',
      from: 'fg-plates1',
      to: 'fg-motors1',
      mode: 'fluidTruck',
      roundTripMin: 5,
      fuel: 'Packaged Fuel',
    },
  );
});

test('a link on Fluid Trucks is state version 18; switching back restores the old version', () => {
  let state = mutate(grouped(), link('truck', 'Packaged Fuel'));
  assert.equal(state.version, 7);
  state = mutate(state, link('fluidTruck', 'Packaged Fuel'));
  assert.equal(state.version, 18);
  assert.deepEqual(state.factoryGroups.links, {
    'fg-plates1:fg-motors1': { mode: 'fluidTruck', roundTripMin: 4, fuel: 'Packaged Fuel' },
  });
  // It loads again as it was; a newer version is refused with the update message.
  const round = validateState(json(state));
  assert.deepEqual(round, state);
  assert.throws(() => validateState({ ...json(round), version: 27 }), /newer planner version/);
  // A state that says less than it needs is marked for what it holds.
  assert.equal(validateState({ ...json(state), version: 7 }).version, 18);
  // A later fuel on it is still 18; a Fluid Truck burns a fuel like a truck, never none.
  assert.equal(mutate(state, link('fluidTruck', 'Battery')).version, 18);
  assert.throws(() => mutate(state, link('fluidTruck')), /Invalid vehicle fuel/);
  // Back to packaging in a truck: an older release reads it again.
  assert.equal(mutate(state, link('truck', 'Packaged Fuel')).version, 7);
  assert.equal(mutate(state, link('truck', 'Battery')).version, 17);
  // Back to a pipe: the entry goes, as for any vehicle.
  const piped = mutate(state, link('belt'));
  assert.equal(piped.version, 3);
  assert.equal(piped.factoryGroups.links, undefined);
});

test('every released state loads with the same links and version', () => {
  for (const [state, version] of states) {
    const clean = validateState(json(state));
    assert.equal(clean.version, version);
    if (state.factoryGroups && 'links' in state.factoryGroups)
      assert.deepEqual(clean.factoryGroups.links, state.factoryGroups.links);
  }
  assert.equal(validateState(json(version17)).version, 17);
  assert.deepEqual(
    validateState(json(version18)).factoryGroups.links?.['supply/Crude Oil:fg-plates1'],
    { mode: 'fluidTruck', roundTripMin: 6, fuel: 'Packaged Fuel' },
  );
});

test('a plan’s transport fuel counts Fluid Trucks like trucks, and other links as before', () => {
  const plan = calculate({ phase: '3' });
  let state = newProfileState(plan, null, null, undefined, undefined).state;
  const fluidLink = groupLinks(plan.stages['3'], state.factoryGroups).find(
    l =>
      l.from.startsWith('fg-') && l.to.startsWith('fg-') && l.items.some(i => FLUIDS.has(i.item)),
  )!;
  assert.ok(fluidLink, 'the default factories have a fluid link between them');
  const set = (mode: LinkTransport['mode']) =>
    mutate(state, {
      type: 'factoryLinkTransport',
      from: fluidLink.from,
      to: fluidLink.to,
      mode,
      roundTripMin: 6,
      fuel: 'Packaged Fuel',
    });
  const packaged = transportFuel(plan, set('truck').factoryGroups, gameCatalog, FLUIDS);
  state = set('fluidTruck');
  const tanked = transportFuel(plan, state.factoryGroups, gameCatalog, FLUIDS);
  const trucks = linkLoad(
    fluidLink.items,
    { mode: 'fluidTruck', roundTripMin: 6, fuel: 'Packaged Fuel' },
    gameCatalog,
    FLUIDS,
  ).vehicles;
  assert.ok(trucks > 0);
  // From the start phase on, each phase whose books draw the link: trucks × 75 MW on 750 MJ.
  assert.ok(Object.keys(tanked).length);
  assert.equal(
    tanked['3']!['Packaged Fuel'],
    Math.ceil(((trucks * 75 * 60) / 750) * 100 - 1e-9) / 100,
  );
  assert.notDeepEqual(tanked, packaged, 'packaged trucks and tanks differ');
});

// Both editions: picking a Fluid Truck saves the progress state only (version 18), never
// recalculates the plan, survives a reload and an export; old saves import unchanged.
async function checkEdition(
  request: (route: string, body?: unknown) => Promise<unknown>,
  reload: () => Promise<void>,
) {
  type Context = { plan: StoredCalculatedPlan; state: ProgressState };
  const context = async () => (await request('/api/context')) as Context;
  await request('/api/profiles', { saveName: 'World', name: 'Tanks', settings: {} });
  await request('/api/update', { type: 'factoryGroupAdd', id: 'fg-plates1', name: 'Plates' });
  await request('/api/update', { type: 'factoryGroupAdd', id: 'fg-motors1', name: 'Motors' });
  await request('/api/update', link('truck', 'Packaged Fuel'));
  const before = await context();
  assert.equal(before.state.version, 7);
  await request('/api/update', link('fluidTruck', 'Packaged Fuel'));
  await reload();
  const after = await context();
  assert.deepEqual(after.plan, before.plan, 'the stored plan is not recalculated');
  assert.equal(after.state.version, 18);
  assert.deepEqual(after.state.factoryGroups.links, {
    'fg-plates1:fg-motors1': { mode: 'fluidTruck', roundTripMin: 4, fuel: 'Packaged Fuel' },
  });
  // A full export carries it and passes the import's check.
  const exported = (await request('/api/export-saves')) as SaveExport;
  const carried = validateTransfer(exported).saves[0]!.profiles[0]!.state;
  assert.equal(carried.version, 18);
  assert.deepEqual(carried.factoryGroups!.links, after.state.factoryGroups.links);
  // Saves from before (a version-11 and a version-17 profile) and a version-18 one import with
  // their links and versions as they were.
  const profile = exported.saves[0]!.profiles[0]!;
  const old: SaveExport = {
    format: 'satisfactory-planner-saves',
    version: 1,
    exportedAt: '2026-10-19T10:00:00.000Z',
    saves: [
      {
        id: 'old',
        name: 'Old world',
        activeProfile: 'v11',
        profiles: [
          { ...profile, id: 'v11', name: 'Eleven', state: json(version11) },
          { ...profile, id: 'v17', name: 'Seventeen', state: json(version17) },
          { ...profile, id: 'v18', name: 'Eighteen', state: json(version18) },
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
  assert.equal(byName('Eighteen').version, 18);
  assert.deepEqual(byName('Eighteen').factoryGroups!.links, version18.factoryGroups.links);
  // Back to packaging in a truck: the open profile is readable by older releases again.
  await request('/api/update', link('truck', 'Packaged Fuel'));
  await reload();
  assert.equal((await context()).state.version, 7);
}

test('the Docker server keeps a Fluid Truck link and old links without recalculating', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-fluid-truck-'));
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

test('the browser edition keeps a Fluid Truck link and old links without recalculating', async () => {
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
