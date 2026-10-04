// How an item's supply is shared out between places (#1022, #1028): shareOut in
// public/app/group-links.ts, which groupLinks (the Logistics page), a group's flow page and the
// byproduct advice all read. Each place uses its own supply first; a leftover goes to the group
// short of the most, then the next; then to storage, fuel, the Space Elevator and last the sink;
// the raw resources and existing supply cover what is still missing. So no item goes both ways
// between two places (#1028).
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupLinks, itemBooks, OUTSIDE, shareOut, sourceOf } from '../public/app/group-links.ts';
import { groupFlow } from '../public/app/group-flow.ts';
import { UNGROUPED } from '../public/app/group-order.ts';
import { defaultFactoryGroups } from '../public/state/factory-groups.ts';
import { calculate } from '../planner.ts';
import type { FactoryGroups, StoredStage } from '../public/types/index.ts';

const places = (entries: [string, number][]) => new Map(entries);
const moves = (transfers: ReturnType<typeof shareOut>) =>
  transfers.map(({ from, to, rate }) => [from, to, Math.round(rate * 1e6) / 1e6]);

test('each place uses its own supply first', () => {
  assert.deepEqual(
    moves(
      shareOut(
        places([
          ['a', 10],
          ['b', 5],
        ]),
        places([
          ['a', 6],
          ['b', 9],
        ]),
      ),
    ),
    [
      ['a', 'a', 6],
      ['b', 'b', 5],
      ['a', 'b', 4],
    ],
  );
});

test('a leftover goes to the group short of the most, then the next, the largest leftover first', () => {
  assert.deepEqual(
    moves(
      shareOut(
        places([
          ['a', 4],
          ['b', 7],
        ]),
        places([
          ['c', 5],
          ['d', 6],
        ]),
      ),
    ),
    [
      ['b', 'd', 6],
      ['a', 'c', 4],
      ['b', 'c', 1],
    ],
  );
  // One leftover reaching three groups: the largest shortfall first, and what is still missing
  // comes from the source.
  assert.deepEqual(
    moves(
      shareOut(
        places([
          ['a', 10],
          [sourceOf('Water'), 3],
        ]),
        places([
          ['b', 3],
          ['c', 8],
          ['d', 2],
        ]),
      ),
    ),
    [
      ['a', 'c', 8],
      ['a', 'b', 2],
      [sourceOf('Water'), 'd', 2],
      [sourceOf('Water'), 'b', 1],
    ],
  );
});

test('what the groups leave goes to storage, fuel, the Space Elevator and last the sink', () => {
  assert.deepEqual(
    moves(
      shareOut(
        places([['a', 12]]),
        places([
          [OUTSIDE.surplus, 2],
          ['b', 5],
          [OUTSIDE.delivery, 1],
          [OUTSIDE.storage, 3],
          [OUTSIDE.drone, 1],
        ]),
      ),
    ),
    [
      ['a', 'b', 5],
      ['a', OUTSIDE.storage, 3],
      ['a', OUTSIDE.drone, 1],
      ['a', OUTSIDE.delivery, 1],
      ['a', OUTSIDE.surplus, 2],
    ],
  );
});

test('the raw resources and existing supply cover only what the groups still miss', () => {
  // Group a makes 20 water as a byproduct and uses 5 itself; the well gives the rest.
  assert.deepEqual(
    moves(
      shareOut(
        places([
          [sourceOf('Water'), 55],
          ['a', 20],
        ]),
        places([
          ['b', 30],
          ['a', 5],
          [UNGROUPED, 40],
        ]),
      ),
    ),
    [
      ['a', 'a', 5],
      ['a', UNGROUPED, 15],
      [sourceOf('Water'), 'b', 30],
      [sourceOf('Water'), UNGROUPED, 25],
    ],
  );
});

// A stage's links, keyed "from>to>item".
const linkRates = (stage: StoredStage, groups: FactoryGroups) =>
  new Map(
    groupLinks(stage, groups).flatMap(link =>
      link.items.map(entry => [`${link.from}>${link.to}>${entry.item}`, entry.rate] as const),
    ),
  );

// The rows of a stage split between two groups, every third one half and half, the rest
// alternating, so a place both makes and uses many items.
function mixedGroups(stage: StoredStage): FactoryGroups {
  const groups = [
    { id: 'fg-one', name: 'One' },
    { id: 'fg-two', name: 'Two' },
  ];
  const assignments: FactoryGroups['assignments'] = {};
  (stage.rows || []).forEach((row, i) => {
    assignments[row.id] =
      i % 3 === 0
        ? [
            { group: 'fg-one', rate: null },
            { group: 'fg-two', rate: null },
          ]
        : [{ group: i % 2 ? 'fg-one' : 'fg-two', rate: null }];
  });
  return { groups, assignments };
}

// Real plans: standard recipes and all alternates, from Phase 3, in Phases 3 to 5.
const plans = [
  ['standard recipes', calculate({ phase: '3' })],
  ['all alternates', calculate({ phase: '3', recipes: 'all' })],
] as const;

test('on real plans no item goes both ways between two places, and each place nets what its books say (#1028)', () => {
  for (const [label, plan] of plans)
    for (const phase of ['3', '4', '5'] as const) {
      const stage = plan.stages[phase];
      for (const [how, groups] of [
        ['default groups', defaultFactoryGroups(plan)],
        ['no groups', { groups: [], assignments: {} }],
        ['mixed groups', mixedGroups(stage)],
      ] as const) {
        const what = `${label}, Phase ${phase}, ${how}`;
        const links = linkRates(stage, groups);
        assert.ok(links.size, what);
        for (const key of links.keys()) {
          const [from, to, item] = key.split('>');
          assert.ok(!links.has(`${to}>${from}>${item}`), `${what}: ${key} goes both ways`);
        }
        // A place that sends an item receives none of it.
        const sends = new Set(
          [...links.keys()].map(key => key.split('>')[0] + '>' + key.split('>')[2]),
        );
        for (const key of links.keys()) {
          const [, to, item] = key.split('>');
          assert.ok(!sends.has(`${to}>${item}`), `${what}: ${to} both sends and receives ${item}`);
        }
        // What leaves and enters each place is what it makes beyond its own use, or misses.
        const { supply, demand } = itemBooks(stage, groups);
        const net = new Map<string, number>();
        for (const [key, rate] of links) {
          const [from, to, item] = key.split('>');
          net.set(`${from}>${item}`, (net.get(`${from}>${item}`) || 0) + rate);
          net.set(`${to}>${item}`, (net.get(`${to}>${item}`) || 0) - rate);
        }
        for (const [item, makers] of Object.entries(supply))
          for (const [place, made] of makers) {
            const asked = demand[item]?.get(place) || 0;
            if (!demand[item]) continue;
            const expected = made - Math.min(made, asked);
            const got = net.get(`${place}>${item}`) || 0;
            // A place's leftover leaves it unless nothing asks for it (an unbalanced rounding).
            assert.ok(
              got <= expected + 1e-6,
              `${what}: ${place} sends more ${item} than it has left`,
            );
          }
        // A solid reaches storage or the sink only when no group still draws it from a source.
        for (const key of links.keys()) {
          const [from, to, item] = key.split('>');
          if (to !== OUTSIDE.surplus && to !== OUTSIDE.storage) continue;
          if (from.startsWith('supply/')) continue;
          const sourced = [...links.keys()].some(other => {
            const [source, place, otherItem] = other.split('>');
            return otherItem === item && source === sourceOf(item) && !place.includes('sink');
          });
          assert.ok(!sourced, `${what}: ${item} goes to ${to} while a source still covers a group`);
        }
      }
    }
});

test('without groups every row is in one place, so nothing moves between lines of different places', () => {
  const [, plan] = plans[1];
  const stage = plan.stages['4'];
  for (const key of linkRates(stage, { groups: [], assignments: {} }).keys()) {
    const [from, to] = key.split('>');
    assert.ok(from === UNGROUPED || from.startsWith('supply/'), key);
    assert.ok(to !== from, key);
    if (from === UNGROUPED) assert.ok(Object.values(OUTSIDE).includes(to as never), key);
  }
});

test('Water in the all-alternates plan, Phase 4, default groups: one way only, and fewer links (#1028)', () => {
  const [, plan] = plans[1];
  const stage = plan.stages['4'];
  const groups = defaultFactoryGroups(plan);
  const water = [...linkRates(stage, groups)].filter(([key]) => key.endsWith('>Water'));
  // Before #1022: Aluminum campus → Concrete & quartz 35.71 and back 12.06, and over 20 links.
  assert.ok(!water.some(([key]) => key.startsWith('fg-alumn1>')), 'Aluminum campus sends no Water');
  // Industrial parts' Battery water goes to Aluminum campus, the group short of the most.
  const parts = water.filter(([key]) => key.startsWith('fg-parts1>'));
  assert.deepEqual(
    parts.map(([key, rate]) => [key, Math.round(rate * 100) / 100]),
    [['fg-parts1>fg-alumn1>Water', 7.5]],
  );
  assert.ok(water.length < 20, `${water.length} Water links`);
  // Each group's flow page reads the same links.
  const flow = groupFlow(stage, groups, 'fg-alumn1', () => '')!;
  assert.deepEqual(
    flow.outs.filter(port => port.item === 'Water'),
    [],
    'no Water leaves Aluminum campus on its flow page',
  );
});
