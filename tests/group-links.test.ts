// groupLinks (public/app/group-links.ts): what moves between a calculated profile's factory
// groups, on hand-made stages and on a real plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupLinks,
  isSource,
  linkTransportFor,
  rowShares,
  sourceOf,
  MINES,
  OUTSIDE,
  UNGROUPED,
} from '../public/app/group-links.ts';
import { calculate } from '../planner.ts';
import type { CalcRow, FactoryGroups, StoredStage } from '../public/types/index.ts';

const close = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${what}: ${actual} is not ${expected}`);
// A complete row; groupLinks reads its id, inputs, outputs and generationMW.
const row = (id: string, inputs: CalcRow['inputs'], outputs: CalcRow['outputs']): CalcRow => ({
  id,
  name: id,
  phase: 1,
  machine: 'Constructor',
  power: 4,
  inputs,
  outputs,
  equivalent: 1,
  machines: 1,
  lastClock: 100,
  peakMW: 4,
  generationMW: 0,
});
// Ore (mined) -> ingot -> plate -> Space Elevator.
const chain: StoredStage = {
  feasible: true,
  rows: [row('ingot', { Ore: 30 }, { Ingot: 30 }), row('plate', { Ingot: 30 }, { Plate: 20 })],
  raw: { Ore: 30 },
  delivery: { Plate: { target: 1000, rate: 20 } },
};
const groups = (assignments: FactoryGroups['assignments']): FactoryGroups => ({
  groups: [
    { id: 'fg-smelt1', name: 'Smelting' },
    { id: 'fg-parts1', name: 'Parts' },
    { id: 'fg-parts2', name: 'Parts two' },
  ],
  assignments,
});
const rate = (links: ReturnType<typeof groupLinks>, from: string, to: string, item: string) =>
  links.find(l => l.from === from && l.to === to)?.items.find(x => x.item === item)?.rate ?? 0;

test("a row's group shares follow its memberships and add up to one", () => {
  assert.deepEqual([...rowShares(100, undefined)], [[UNGROUPED, 1]]);
  assert.deepEqual(
    [
      ...rowShares(100, [
        { group: 'a', rate: 30 },
        { group: 'b', rate: null },
      ]),
    ],
    [
      ['a', 0.3],
      ['b', 0.7],
    ],
  );
  // Only fixed rates: the rest of the row is ungrouped.
  const part = rowShares(100, [{ group: 'a', rate: 30 }]);
  close(part.get('a')!, 0.3, 'a');
  close(part.get(UNGROUPED)!, 0.7, 'ungrouped');
  // Fixed rates past the total are capped.
  assert.deepEqual([...rowShares(10, [{ group: 'a', rate: 25 }])], [['a', 1]]);
});

test('each link carries what one place hands the next, and flows inside a group are left out', () => {
  const links = groupLinks(
    chain,
    groups({
      ingot: [{ group: 'fg-smelt1', rate: null }],
      plate: [{ group: 'fg-parts1', rate: null }],
    }),
  );
  close(rate(links, sourceOf('Ore'), 'fg-smelt1', 'Ore'), 30, 'ore to smelting');
  close(rate(links, 'fg-smelt1', 'fg-parts1', 'Ingot'), 30, 'ingots to parts');
  close(rate(links, 'fg-parts1', OUTSIDE.delivery, 'Plate'), 20, 'plates to the elevator');
  assert.equal(links.length, 3);
  // Both rows in one group: its ingots stay inside.
  const one = groupLinks(
    chain,
    groups({
      ingot: [{ group: 'fg-smelt1', rate: null }],
      plate: [{ group: 'fg-smelt1', rate: null }],
    }),
  );
  assert.deepEqual(
    one.map(l => [l.from, l.to]),
    [
      [sourceOf('Ore'), 'fg-smelt1'],
      ['fg-smelt1', OUTSIDE.delivery],
    ],
  );
});

test('a row split between groups splits its inputs and outputs the same way', () => {
  const links = groupLinks(
    chain,
    groups({
      ingot: [{ group: 'fg-smelt1', rate: null }],
      plate: [
        { group: 'fg-parts1', rate: 5 },
        { group: 'fg-parts2', rate: null },
      ],
    }),
  );
  // 5 of the 20 plates a minute in Parts, the other 15 in Parts two.
  close(rate(links, 'fg-smelt1', 'fg-parts1', 'Ingot'), 7.5, 'Parts');
  close(rate(links, 'fg-smelt1', 'fg-parts2', 'Ingot'), 22.5, 'Parts two');
  close(rate(links, 'fg-parts2', OUTSIDE.delivery, 'Plate'), 15, 'Parts two to the elevator');
  // A membership in a deleted group counts as ungrouped.
  const stale = groupLinks(chain, groups({ plate: [{ group: 'fg-gone01', rate: null }] }));
  close(rate(stale, UNGROUPED, OUTSIDE.delivery, 'Plate'), 20, 'ungrouped plates');
});

test('on a real plan the flows add up to its rows, its mining and its deliveries', () => {
  const plan = calculate({});
  const stage = plan.stages['3'];
  const rows = stage.rows!;
  // Alternate rows between two groups.
  const assignments = Object.fromEntries(
    rows.map((r, i) => [r.id, [{ group: i % 2 ? 'fg-parts1' : 'fg-smelt1', rate: null }]]),
  );
  const links = groupLinks(stage, groups(assignments));
  for (const [item, delivery] of Object.entries(stage.delivery!)) {
    const delivered = links
      .filter(l => l.to === OUTSIDE.delivery)
      .reduce((total, link) => total + (link.items.find(x => x.item === item)?.rate ?? 0), 0);
    close(delivered, delivery.rate, 'delivered ' + item);
  }
  for (const [item, rawRate] of Object.entries(stage.raw!)) {
    if (rawRate < 1e-6) continue;
    const mined = links
      .filter(l => l.from === sourceOf(item))
      .reduce((total, link) => total + (link.items.find(x => x.item === item)?.rate ?? 0), 0);
    close(mined, rawRate, 'mined ' + item);
  }
  assert.ok(links.some(l => l.from === 'fg-smelt1' && l.to === 'fg-parts1'));
});

test('memberships without a rate split what is left evenly (#197)', () => {
  // A row just added to a second group: neither has a rate.
  assert.deepEqual(
    [
      ...rowShares(100, [
        { group: 'a', rate: null },
        { group: 'b', rate: null },
      ]),
    ],
    [
      ['a', 0.5],
      ['b', 0.5],
    ],
  );
  // With a fixed rate too, the rest is shared by the other two.
  const mixed = rowShares(100, [
    { group: 'a', rate: null },
    { group: 'b', rate: 20 },
    { group: 'c', rate: null },
  ]);
  close(mixed.get('a')!, 0.4, 'a');
  close(mixed.get('b')!, 0.2, 'b');
  close(mixed.get('c')!, 0.4, 'c');
  close(
    [...mixed.values()].reduce((total, share) => total + share, 0),
    1,
    'the shares add up to one',
  );
  // Both groups get their half of the row's inputs.
  const links = groupLinks(
    chain,
    groups({
      ingot: [{ group: 'fg-smelt1', rate: null }],
      plate: [
        { group: 'fg-parts1', rate: null },
        { group: 'fg-parts2', rate: null },
      ],
    }),
  );
  close(rate(links, 'fg-smelt1', 'fg-parts1', 'Ingot'), 15, 'Parts');
  close(rate(links, 'fg-smelt1', 'fg-parts2', 'Ingot'), 15, 'Parts two');
});

test('each raw resource and existing-supply item is a source of its own (#231)', () => {
  // The plan builds only what the existing supply leaves (#231): 25 of the 30 ingots. (Before
  // #1022 this stage made 35 ingots for 30 asked; the rule now uses every group's own supply before
  // existing supply, so an unbalanced stage would leave the existing ingots unused.)
  const stage = {
    ...chain,
    rows: [row('ingot', { Ore: 25 }, { Ingot: 25 }), chain.rows![1]!],
    raw: { Ore: 25, Coal: 12 },
    supplied: { Ingot: 5 },
  } as typeof chain;
  const links = groupLinks(
    stage,
    groups({
      ingot: [{ group: 'fg-smelt1', rate: null }],
      plate: [{ group: 'fg-parts1', rate: null }],
    }),
  );
  // One link per source item and destination, never a mixed mines link.
  for (const link of links.filter(l => isSource(l.from)))
    assert.deepEqual(
      link.items.map(x => sourceOf(x.item)),
      [link.from],
    );
  assert.ok(!links.some(l => l.from === MINES));
  assert.ok(links.some(l => l.from === sourceOf('Ingot') && l.to === 'fg-parts1'));
  // A vehicle saved on the whole mines link before #231 applies to each source until one has its
  // own choice; other links fall back to nothing.
  const truck = { mode: 'truck' as const, roundTripMin: 4, fuel: 'Coal' };
  const train = { mode: 'train' as const, roundTripMin: 9 };
  const links2 = { 'mines:fg-smelt1': truck, [sourceOf('Coal') + ':fg-smelt1']: train };
  assert.deepEqual(linkTransportFor(links2, sourceOf('Ore'), 'fg-smelt1'), truck);
  assert.deepEqual(linkTransportFor(links2, sourceOf('Coal'), 'fg-smelt1'), train);
  assert.equal(linkTransportFor(links2, 'fg-smelt1', 'fg-parts1'), undefined);
  assert.equal(linkTransportFor(undefined, sourceOf('Ore'), 'fg-smelt1'), undefined);
});
