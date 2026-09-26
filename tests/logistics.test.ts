// Vehicle transport on factory-group links (#205): the saved choice (factoryGroups.links,
// state version 7) and the vehicle math (public/app/logistics.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState,
  linkPlaces,
  mutate,
  newProfileState,
  validateState,
} from '../public/state.ts';
import { linkLoad } from '../public/app/logistics.ts';
import { MINES, OUTSIDE, UNGROUPED } from '../public/app/group-links.ts';
import { calculate, catalog } from '../planner.ts';
import { vehicleFuels } from '../public/preferences.ts';
import type { LinkTransport, ProgressState, UpdateOp } from '../public/types/index.ts';

const c = catalog();
const fluids = new Set(['Water', 'Nitrogen Gas', 'Excited Photonic Matter']);
const load = (items: [string, number][], t: LinkTransport) =>
  linkLoad(
    items.map(([item, rate]) => ({ item, rate })),
    t,
    c,
    fluids,
  );

const grouped = (): ProgressState => {
  let s = initialState();
  s = mutate(s, { type: 'factoryGroupAdd', id: 'fg-plates1', name: 'Plates' });
  s = mutate(s, { type: 'factoryGroupAdd', id: 'fg-motors1', name: 'Motors' });
  return s;
};
const link = (over: Partial<Extract<UpdateOp, { type: 'factoryLinkTransport' }>>): UpdateOp => ({
  type: 'factoryLinkTransport',
  from: 'fg-plates1',
  to: 'fg-motors1',
  mode: 'truck',
  roundTripMin: 4,
  fuel: 'Packaged Fuel',
  ...over,
});

test('a link’s vehicle is saved as version 7 and going back to belts restores the old version', () => {
  let s = grouped();
  assert.equal(s.version, 3);
  s = mutate(s, link({}));
  s = mutate(s, link({ from: MINES, to: 'fg-plates1', mode: 'train', fuel: undefined }));
  assert.deepEqual(s.factoryGroups.links, {
    'fg-plates1:fg-motors1': { mode: 'truck', roundTripMin: 4, fuel: 'Packaged Fuel' },
    'mines:fg-plates1': { mode: 'train', roundTripMin: 4 },
  });
  assert.equal(s.version, 7, 'a version-6 planner must refuse it rather than drop the choice');
  const round = validateState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(round.factoryGroups.links, s.factoryGroups.links);
  assert.throws(() => validateState({ ...round, version: 10 }), /newer planner version/);
  // Removing a group takes its links along; belts again forget the entry.
  s = mutate(s, { type: 'factoryGroupRemove', id: 'fg-motors1' });
  assert.deepEqual(Object.keys(s.factoryGroups.links!), ['mines:fg-plates1']);
  s = mutate(s, link({ from: MINES, to: 'fg-plates1', mode: 'belt' }));
  assert.equal(s.factoryGroups.links, undefined);
  assert.equal(s.version, 3);
  // A state without links keeps its exact shape.
  assert.deepEqual(Object.keys(grouped().factoryGroups), ['groups', 'assignments']);
});

test('a link to or from the vehicle fuel place marks version 9, which older releases refuse with the update message (#220)', () => {
  let s = mutate(grouped(), link({}));
  assert.equal(s.version, 7);
  s = mutate(s, link({ from: 'fg-plates1', to: OUTSIDE.transport, mode: 'tractor' }));
  assert.equal(s.version, 9, 'a release before #218 does not know the place');
  const round = validateState(JSON.parse(JSON.stringify(s)));
  assert.equal(round.version, 9);
  assert.deepEqual(round.factoryGroups.links, s.factoryGroups.links);
  assert.throws(() => validateState({ ...round, version: 10 }), /newer planner version/);
  // Back to belts, the link goes and the version with it.
  s = mutate(s, link({ from: 'fg-plates1', to: OUTSIDE.transport, mode: 'belt' }));
  assert.equal(s.version, 7);
  // A state saved as 7 with such a link (made by #218 before this fix) still loads, marked 9.
  const early = validateState({ ...JSON.parse(JSON.stringify(round)), version: 7 });
  assert.equal(early.version, 9);
});

test('a malformed link choice is refused and changes nothing', () => {
  const s = grouped();
  for (const [op, why] of [
    [link({ to: 'fg-gone001' }), /Unknown factory group link/],
    [link({ to: 'fg-plates1' }), /Unknown factory group link/],
    [link({ from: 'attic' }), /Unknown factory group link/],
    [link({ mode: 'boat' as never }), /Invalid transport/],
    [link({ roundTripMin: 0 }), /Invalid transport/],
    [link({ roundTripMin: 2000 }), /Invalid transport/],
    [link({ fuel: undefined }), /Invalid vehicle fuel/],
    [link({ fuel: 'Uranium Fuel Rod' }), /Invalid vehicle fuel/],
    [link({ mode: 'drone', fuel: 'Packaged Fuel' }), /Invalid vehicle fuel/],
  ] as [UpdateOp, RegExp][])
    assert.throws(() => mutate(structuredClone(s), op), why, JSON.stringify(op));
  const saved = mutate(grouped(), link({}));
  const withLinks = (links: unknown) =>
    validateState({ ...saved, factoryGroups: { ...saved.factoryGroups, links } });
  for (const links of [
    [],
    { 'fg-plates1:fg-motors1:x': { mode: 'train', roundTripMin: 3 } },
    { 'fg-plates1-fg-motors1': { mode: 'train', roundTripMin: 3 } },
    { 'fg-other01:fg-motors1': { mode: 'train', roundTripMin: 3 } },
    { 'fg-plates1:fg-motors1': { mode: 'train', roundTripMin: '3' } },
  ])
    assert.throws(() => withLinks(links), /Invalid/, JSON.stringify(links));
  // Every place group-links.ts can report is a valid end of a link.
  assert.deepEqual([...linkPlaces].sort(), [UNGROUPED, MINES, ...Object.values(OUTSIDE)].sort());
  assert.deepEqual(
    c.vehicleFuels.map(f => f.name),
    vehicleFuels,
  );
  assert.ok(c.vehicleFuels.every(f => f.mj > 0));
});

test('road vehicles fill whole slots per item and burn their fuel', () => {
  // 200 plates a minute on a 4-minute round trip: 800 plates, 4 slots of 200, one truck.
  const plates = load([['Iron Plate', 200]], {
    mode: 'truck',
    roundTripMin: 4,
    fuel: 'Packaged Fuel',
  });
  assert.equal(plates.vehicles, 1);
  assert.equal(plates.slotsUsed, 4);
  // 75 MW for a minute is 4,500 MJ: 6 Packaged Fuel at 750 MJ.
  assert.equal(plates.fuelPerMin, 6);
  // 15,000 Concrete (30 slots) and 7,500 plates (37.5 slots) do not fit one truck; two carry
  // 15 + 19 slots each.
  const mixed = load(
    [
      ['Concrete', 1000],
      ['Iron Plate', 500],
    ],
    { mode: 'truck', roundTripMin: 15, fuel: 'Coal' },
  );
  assert.equal(mixed.vehicles, 2);
  assert.equal(mixed.slotsUsed, 34);
  assert.equal(mixed.fuelPerMin, (2 * 75 * 60) / 300);
  // Fluids travel packaged: 600 m³ of water is 6 slots; nitrogen packs 4 m³ to an item.
  const tractor = load(
    [
      ['Water', 120],
      ['Nitrogen Gas', 240],
    ],
    { mode: 'tractor', roundTripMin: 5, fuel: 'Solid Biofuel' },
  );
  assert.deepEqual([tractor.vehicles, tractor.slotsUsed], [1, 9]);
  const photons = load([['Excited Photonic Matter', 50]], {
    mode: 'explorer',
    roundTripMin: 2,
    fuel: 'Coal',
  });
  assert.deepEqual(photons.unpackable, ['Excited Photonic Matter']);
  assert.equal(photons.vehicles, 0);
});

test('the fewest vehicles are found, and more item types than slots get vehicles each', () => {
  const items: [string, number][] = [
    ['Iron Plate', 37],
    ['Screws', 410],
    ['Wire', 95],
    ['Cable', 52],
  ];
  for (const trip of [1, 3.5, 7, 22]) {
    const l = load(items, { mode: 'explorer', roundTripMin: trip, fuel: 'Coal' });
    assert.ok(l.slotsUsed <= 12, `${trip} min fits`);
    if (l.vehicles > 1) {
      const fewer = items.reduce(
        (t, [n, r]) => t + Math.ceil((r * trip) / (l.vehicles - 1) / c.stacks[n]!),
        0,
      );
      assert.ok(fewer > 12, `${trip} min: one explorer fewer would not fit`);
    }
  }
  const many = load(
    [
      ['Iron Plate', 10],
      ['Iron Rod', 10],
      ['Screws', 10],
      ['Wire', 10],
      ['Cable', 10],
      ['Concrete', 10],
      ['Copper Sheet', 10],
      ['Quickwire', 10],
      ['Steel Beam', 10],
      ['Steel Pipe', 10],
    ],
    { mode: 'drone', roundTripMin: 1 },
  );
  assert.equal(many.vehicles, 10, 'ten item types on a nine-slot drone: one drone each');
  assert.equal(many.fuelPerMin, 0, 'a drone’s fuel depends on the distance flown');
});

test('a train counts freight cars for solids and one fluid car per 1,600 m³ of each fluid', () => {
  const t = load(
    [
      ['Iron Plate', 2000],
      ['Water', 300],
      ['Nitrogen Gas', 100],
    ],
    { mode: 'train', roundTripMin: 10 },
  );
  // 20,000 plates is 100 slots: four 32-slot cars. 3,000 m³ of water: 2 cars; 1,000 of nitrogen: 1.
  assert.deepEqual([t.vehicles, t.freightCars, t.fluidCars, t.fuelPerMin], [1, 4, 3, 0]);
  assert.equal(t.unpackable.length, 0, 'a fluid car takes any fluid');
});

test('a new profile carrying plan edits keeps the links of the groups it carries', () => {
  const s = mutate(grouped(), link({}));
  const plan = calculate({});
  const next = newProfileState(plan, s, plan, { planEdits: true }, undefined).state;
  assert.deepEqual(next.factoryGroups.links, s.factoryGroups.links);
  assert.equal(next.version, 7);
  const fresh = newProfileState(plan, s, plan, { planEdits: false }, undefined).state;
  assert.equal(fresh.factoryGroups.links, undefined);
});
