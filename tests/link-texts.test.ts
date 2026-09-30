// The texts and updates of the links on the Logistics page (ui/factories/GroupLinks.vue, #531):
// the place names (public/app/group-links.ts), and the vehicle lines, belt badge, totals and
// the factoryLinkTransport update a transport choice sends (public/app/logistics.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { num } from '../public/app/format.ts';
import { MINES, OUTSIDE, placeName, sourceOf, UNGROUPED } from '../public/app/group-links.ts';
import {
  DEFAULT_FUEL,
  DEFAULT_TRIP_MIN,
  linkBeltBadge,
  linkSiblings,
  linkTotal,
  linkTransportUpdate,
  linkVehicleText,
} from '../public/app/logistics.ts';
import type {
  CalcRow,
  FactoryGroups,
  LinkTransport,
  StoredCalculatedPlan,
} from '../public/types/index.ts';

const catalog = {
  stacks: { 'Iron Plate': 200 },
  packaged: {},
  vehicleFuels: [{ name: 'Packaged Fuel', mj: 750 }],
};
const fluids = new Set(['Water']);
const belt = { mark: 'Mk.3', cap: 270 },
  pipe = { mark: 'Mk.1', cap: 300 };
const vehicleText = (items: [string, number][], transport: LinkTransport) =>
  linkVehicleText(
    items.map(([item, rate]) => ({ item, rate })),
    transport,
    catalog,
    fluids,
    belt,
    pipe,
  );

test('a place is named by its group, its item, or its place name', () => {
  const groups = [{ id: 'fg-a', name: 'Plates' }],
    raw = { 'Iron Ore': 60 };
  assert.equal(placeName('fg-a', groups, raw), 'Plates');
  assert.equal(placeName(sourceOf('Iron Ore'), groups, raw), 'Iron Ore');
  assert.equal(placeName(sourceOf('Coal'), groups, raw), 'Coal (existing supply)');
  assert.equal(placeName(sourceOf('Iron Ore'), groups, undefined), 'Iron Ore (existing supply)');
  assert.equal(placeName(UNGROUPED, groups, raw), 'Ungrouped');
  assert.equal(placeName(OUTSIDE.storage, groups, raw), 'Protected storage');
  assert.equal(placeName(OUTSIDE.drone, groups, raw), 'Drone fuel');
  assert.equal(placeName(OUTSIDE.transport, groups, raw), 'Vehicle fuel');
  assert.equal(placeName(OUTSIDE.delivery, groups, raw), 'Space Elevator');
  assert.equal(placeName(OUTSIDE.surplus, groups, raw), 'AWESOME Sink');
  assert.equal(placeName('fg-gone', groups, raw), 'fg-gone');
});

test('a road vehicle link has its vehicles, slots and fuel', () => {
  // 100/min over a 5-minute trip is 500 plates, 3 slots of 200; one truck burns 75 MW.
  assert.deepEqual(
    vehicleText([['Iron Plate', 100]], { mode: 'truck', roundTripMin: 5, fuel: 'Packaged Fuel' }),
    {
      lines: ['1 truck, 3 of 48 slots each trip. Up to 6 Packaged Fuel/min if they never stop.'],
      badge: '1 truck',
    },
  );
  assert.deepEqual(vehicleText([['Iron Plate', 100]], { mode: 'drone', roundTripMin: 5 }), {
    lines: [
      '1 drone, 3 of 9 slots each trip. Drone fuel depends on the distance flown; see the profile’s drone-fuel supply.',
    ],
    badge: '1 drone',
  });
  // A fuel with no energy figure has no fuel line.
  assert.deepEqual(
    vehicleText([['Iron Plate', 100]], { mode: 'tractor', roundTripMin: 5, fuel: 'Unknown' }),
    { lines: ['1 tractor, 3 of 25 slots each trip.'], badge: '1 tractor' },
  );
});

test('a fluid with no package cannot go by road vehicle or drone', () => {
  assert.deepEqual(vehicleText([['Water', 60]], { mode: 'drone', roundTripMin: 5 }), {
    lines: ['Water cannot be packaged: keep it on a pipe, or send it by train.'],
    badge: 'By drone',
  });
});

test('a train link has its locomotives and cars, and says when the belt sets the cars', () => {
  // 1,000 plates/min fit one car by capacity but need four Mk.3 belts; 100 m³/min is one car; five cars take two locomotives.
  const cars = `4 freight cars and 1 fluid car (${num(1600)} m³ each)`;
  assert.deepEqual(
    vehicleText(
      [
        ['Iron Plate', 1000],
        ['Water', 100],
      ],
      { mode: 'train', roundTripMin: 5 },
    ),
    {
      lines: [
        `1 train: 2 locomotives, ${cars}. Electric: each locomotive draws 25–110 MW from the grid while moving.`,
        'A car loads and unloads at no more than one Mk.3 belt (270/min), so this flow needs that many cars.',
      ],
      badge: `1 train: 2 locomotives, ${cars}`,
    },
  );
  assert.deepEqual(vehicleText([], { mode: 'train', roundTripMin: 5 }), {
    lines: [],
    badge: 'By freight train',
  });
});

test('the belt badge totals the belts and pipes per mark', () => {
  const lanes = (rate: number, fluid: boolean) => ({
    lane: { mark: fluid ? 'Mk.2' : 'Mk.4' },
    count: Math.ceil(rate / 100),
    word: fluid ? ('pipe' as const) : ('belt' as const),
  });
  const items = [
    { item: 'Iron Plate', rate: 250 },
    { item: 'Water', rate: 30 },
    { item: 'Copper Sheet', rate: 50 },
  ];
  assert.equal(linkBeltBadge(items, fluids, lanes), '4 × Mk.4 belts · 1 × Mk.2 pipe');
  assert.equal(linkBeltBadge(items.slice(1, 2), fluids, lanes), '1 × Mk.2 pipe');
});

test('a link total adds items and fluids up separately', () => {
  assert.equal(
    linkTotal([
      { rate: 200, fluid: false },
      { rate: 15, fluid: false },
      { rate: 96, fluid: true },
    ]),
    '215/min · 96 m³/min',
  );
  assert.equal(linkTotal([{ rate: 96, fluid: true }]), '96 m³/min');
  assert.equal(linkTotal([]), '');
});

test('a transport choice builds the factoryLinkTransport update, fields in order', () => {
  const belted = { from: 'fg-a', to: 'fg-b', mode: 'belt' as const, transport: undefined };
  const json = (value: unknown) => JSON.stringify(value);
  assert.equal(
    json(linkTransportUpdate(belted, { mode: 'belt' }, undefined)),
    json({ type: 'factoryLinkTransport', from: 'fg-a', to: 'fg-b', mode: 'belt' }),
  );
  // A new vehicle starts with the default trip and, when it burns fuel, the default fuel.
  assert.equal(
    json(linkTransportUpdate(belted, { mode: 'truck' }, undefined)),
    json({
      type: 'factoryLinkTransport',
      from: 'fg-a',
      to: 'fg-b',
      mode: 'truck',
      roundTripMin: DEFAULT_TRIP_MIN,
      fuel: DEFAULT_FUEL,
    }),
  );
  assert.equal(
    json(linkTransportUpdate(belted, { mode: 'train' }, undefined)),
    json({
      type: 'factoryLinkTransport',
      from: 'fg-a',
      to: 'fg-b',
      mode: 'train',
      roundTripMin: 5,
    }),
  );
  // A change keeps the rest of the saved choice.
  const trucked = {
    from: 'fg-a',
    to: 'fg-b',
    mode: 'truck' as const,
    transport: { mode: 'truck' as const, roundTripMin: 3, fuel: 'Turbofuel' },
  };
  assert.equal(
    json(linkTransportUpdate(trucked, { roundTripMin: 8 }, undefined)),
    json({
      type: 'factoryLinkTransport',
      from: 'fg-a',
      to: 'fg-b',
      mode: 'truck',
      roundTripMin: 8,
      fuel: 'Turbofuel',
    }),
  );
  assert.equal(
    json(linkTransportUpdate(trucked, { fuel: 'Packaged Fuel' }, ['supply/Coal'])),
    json({
      type: 'factoryLinkTransport',
      from: 'fg-a',
      to: 'fg-b',
      mode: 'truck',
      roundTripMin: 3,
      fuel: 'Packaged Fuel',
      siblings: ['supply/Coal'],
    }),
  );
  assert.equal(
    json(linkTransportUpdate(trucked, { mode: 'belt' }, ['supply/Coal'])),
    json({
      type: 'factoryLinkTransport',
      from: 'fg-a',
      to: 'fg-b',
      mode: 'belt',
      siblings: ['supply/Coal'],
    }),
  );
});

test('a source link with a mines choice saved before #231 has the sources going there in any phase as siblings', () => {
  // A partial row: linkSiblings reads only a row's id, inputs and outputs.
  const row = (fields: Pick<CalcRow, 'id' | 'inputs' | 'outputs'>) => fields as CalcRow;
  const stages: StoredCalculatedPlan['stages'] = {
    1: {
      feasible: true,
      raw: { 'Iron Ore': 60, Coal: 30 },
      rows: [
        row({ id: 'r1', inputs: { 'Iron Ore': 60, Coal: 30 }, outputs: { 'Steel Ingot': 30 } }),
      ],
    },
    2: {
      feasible: true,
      raw: { Limestone: 10 },
      rows: [row({ id: 'r2', inputs: { Limestone: 10 }, outputs: { Concrete: 3 } })],
    },
    3: { feasible: true, raw: { Sulfur: 5 }, rows: [] },
    // Stages without rows, which linkSiblings skips.
    4: { feasible: true },
    5: { feasible: true },
  };
  const groups: FactoryGroups = {
    groups: [{ id: 'fg-a', name: 'A' }],
    assignments: { r1: [{ group: 'fg-a', rate: null }], r2: [{ group: 'fg-a', rate: null }] },
    links: { [MINES + ':fg-a']: { mode: 'truck', roundTripMin: 4, fuel: 'Packaged Fuel' } },
  };
  const iron = { from: sourceOf('Iron Ore'), to: 'fg-a' };
  assert.deepEqual(linkSiblings(stages, groups, iron), [
    sourceOf('Iron Ore'),
    sourceOf('Coal'),
    sourceOf('Limestone'),
  ]);
  assert.equal(linkSiblings(stages, groups, { from: 'fg-a', to: OUTSIDE.surplus }), undefined);
  assert.equal(linkSiblings(stages, { ...groups, links: {} }, iron), undefined);
  assert.equal(linkSiblings(stages, { ...groups, links: undefined }, iron), undefined);
  assert.deepEqual(linkSiblings(undefined, groups, iron), []);
});
