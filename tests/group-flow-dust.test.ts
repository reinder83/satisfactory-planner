// A part of a row too small to count (#906): a membership whose share of a row is at most
// LINK_DUST is no line of its group, yet with a large rate it can still carry more than LINK_DUST
// of an item. rowShares leaves such a part out, so the Logistics page's books (itemBooks) and the
// group flows lost it, and the rows of the lines sharing its items no longer added up to their
// rates. rowPlaces now gives it to the row's largest place, so a row's places add up to 1 and
// every row's links add up to its rate, while no group gets a line for the dust. rowShares, which
// the planner sizes a group's own line by, is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../planner.ts';
import { groupFlow } from '../public/app/group-flow.ts';
import type { FlowLink, GroupFlow } from '../public/app/group-flow.ts';
import { groupLinks } from '../public/app/group-links.ts';
import { LINK_DUST, rowPlaces, rowShares, rowTotal, UNGROUPED } from '../public/app/group-order.ts';
import type { CalcRow, FactoryGroups, StoredStage } from '../public/types/index.ts';

const belts = (item: string, rate: number) => `${rate} ${item}`;
const sum = (links: FlowLink[]) => links.reduce((total, link) => total + link.rate, 0);
const total = (places: Map<string, number>) => [...places.values()].reduce((a, b) => a + b, 0);
// Far tighter than LINK_DUST: a dust share of a large rate is a gap well above it, while the
// books otherwise add up to rounding.
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

// What is wrong with one group's flow, as messages: a line for a share too small to count, a line
// with no rows, a row whose links do not add up to its rate, and ports that differ from the
// Logistics page's links (groupLinks). `count` counts the rows checked.
function flowProblems(stage: StoredStage, groups: FactoryGroups, id: string, count = { rows: 0 }) {
  const problems: string[] = [];
  const flow = groupFlow(stage, groups, id, belts) as GroupFlow;
  for (const line of flow.lines) {
    if (line.share <= LINK_DUST) problems.push(`${id} ${line.id}: a line for a dust share`);
    if (!line.inputs.length && !line.outputs.length) problems.push(`${id} ${line.id}: no rows`);
    for (const flowRow of [...line.inputs, ...line.outputs]) {
      count.rows++;
      if (!near(sum(flowRow.links), flowRow.rate))
        problems.push(`${id} ${flowRow.id}: ${sum(flowRow.links)} of ${flowRow.rate}`);
    }
  }
  const links = groupLinks(stage, groups);
  const expected = (inward: boolean) =>
    links
      .filter(link => (inward ? link.to : link.from) === id)
      .flatMap(link =>
        link.items.map(entry => `${inward ? link.from : link.to}|${entry.item}|${entry.rate}`),
      )
      .sort();
  const ports = (list: GroupFlow['ins']) =>
    list.map(port => `${port.place}|${port.item}|${port.rate}`).sort();
  if (JSON.stringify(ports(flow.ins)) !== JSON.stringify(expected(true)))
    problems.push(`${id}: what comes in differs from groupLinks`);
  if (JSON.stringify(ports([...flow.outs, ...flow.fold.ports])) !== JSON.stringify(expected(false)))
    problems.push(`${id}: what leaves differs from groupLinks`);
  return problems;
}

test('a part too small to count goes to the row’s largest place, so its places add up to 1', () => {
  const row = { id: 'r', outputs: { Plate: 1000 }, generationMW: 0 };
  const groups = (assignment: FactoryGroups['assignments'][string]): FactoryGroups => ({
    groups: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ],
    assignments: { r: assignment },
  });
  const dust = 1000 * LINK_DUST * 0.5;
  // A fixed rate too small to count: the open memberships' place, the first of two on a tie.
  const fixedDust = rowPlaces(
    row,
    groups([
      { group: 'a', rate: dust },
      { group: 'b', rate: null },
      { group: 'c', rate: null },
    ]),
  );
  assert.deepEqual([...fixedDust.keys()], ['b', 'c']);
  assert.ok(near(fixedDust.get('b')!, 0.5 + LINK_DUST * 0.25), 'b takes the dust');
  assert.ok(near(total(fixedDust), 1), 'the places add up to 1');
  // An open membership left with too little: the fixed rate's place.
  const openDust = rowPlaces(
    row,
    groups([
      { group: 'a', rate: 1000 - dust },
      { group: 'b', rate: null },
    ]),
  );
  assert.deepEqual([...openDust], [['a', 1]]);
  // Only a fixed rate too small to count: the row is Ungrouped, as homeGroup builds it (#942).
  assert.deepEqual([...rowPlaces(row, groups([{ group: 'a', rate: dust }]))], [[UNGROUPED, 1]]);
  // Nothing too small to count: the shares as rowShares gives them.
  const plain = groups([
    { group: 'a', rate: 300 },
    { group: 'b', rate: null },
  ]);
  assert.deepEqual([...rowPlaces(row, plain)], [...rowShares(1000, plain.assignments.r)]);
  // rowShares, which the planner sizes a group's own line by, still leaves the dust out.
  assert.deepEqual(
    [
      ...rowShares(1000, [
        { group: 'a', rate: dust },
        { group: 'b', rate: null },
      ]),
    ],
    [['b', 1 - LINK_DUST * 0.5]],
  );
});

test('the issue’s case: a power line’s dust share of Rocket Fuel is no line, and the rows add up (#906)', () => {
  const stage = calculate({ phase: '4', recipes: 'all' }).stages['4'];
  const rows = stage.rows || [];
  const power = rows.find(row => row.id === 'power-rocket-fuel');
  const nitro = rows.find(row => row.id === 'Recipe_Alternate_RocketFuel_Nitro_C');
  assert.ok(power && nitro, 'the plan burns Rocket Fuel made by Nitro Rocket Fuel');
  // fg-s0's share of the power line is half of LINK_DUST: too small to count, yet more than
  // LINK_DUST of the Rocket Fuel it burns.
  const dustRate = rowTotal(power) * LINK_DUST * 0.5;
  assert.ok((power.inputs['Rocket Fuel'] || 0) * LINK_DUST * 0.5 > LINK_DUST);
  const groups: FactoryGroups = {
    groups: ['fg-s0', 'fg-s1', 'fg-s2'].map(id => ({ id, name: id })),
    assignments: {
      [nitro.id]: [
        { group: 'fg-s2', rate: 0.336 },
        { group: 'fg-s0', rate: null },
      ],
      [power.id]: [
        { group: 'fg-s0', rate: dustRate },
        { group: 'fg-s1', rate: null },
      ],
    },
  };
  for (const group of groups.groups)
    assert.deepEqual(flowProblems(stage, groups, group.id), [], group.id);
  assert.deepEqual([...rowPlaces(power, groups)], [['fg-s1', 1]]);
  const s0 = groupFlow(stage, groups, 'fg-s0', belts)!;
  assert.ok(!s0.lines.some(line => line.id === power.id), 'no power line in fg-s0');
  // The Rocket Fuel fg-s1's power line burns all comes in from the two Nitro lines.
  const s1 = groupFlow(stage, groups, 'fg-s1', belts)!;
  const burnt = s1.lines.find(line => line.id === power.id)!.inputs[0]!;
  assert.equal(burnt.rate, power.inputs['Rocket Fuel']);
  assert.ok(near(sum(burnt.links), burnt.rate), `${sum(burnt.links)} of ${burnt.rate}`);
});

// A small seeded generator, so a failure can be replayed.
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
  return { next, pick };
}

// Random groups on a stage: two or three groups, each row in none, wholly in one, or split
// between two with a fixed rate on the first: too small to count, so large that the open rest is
// too small to count, or anywhere between. `dusty` counts the splits with a part too small to count.
function randomGroups(stage: StoredStage, seed: number): { groups: FactoryGroups; dusty: number } {
  const { next, pick } = random(seed);
  const groups = Array.from({ length: 2 + Math.floor(next() * 2) }, (_, i) => ({
    id: `fg-s${i}`,
    name: `S${i}`,
  }));
  const assignments: FactoryGroups['assignments'] = {};
  let dusty = 0;
  for (const row of stage.rows || []) {
    const roll = next();
    if (roll < 0.2) continue;
    const first = pick(groups).id;
    if (roll < 0.5) {
      assignments[row.id] = [{ group: first, rate: null }];
      continue;
    }
    const second = pick(groups.filter(group => group.id !== first)).id;
    const kind = next(),
      dust = LINK_DUST * (0.2 + 0.79 * next());
    const fraction = kind < 0.4 ? dust : kind < 0.7 ? 1 - dust : next();
    if (kind < 0.7) dusty++;
    assignments[row.id] = [
      { group: first, rate: rowTotal(row) * fraction },
      { group: second, rate: null },
    ];
  }
  return { groups: { groups, assignments }, dusty };
}

test('on random split groups every row’s links add up to its rate, with no dust lines (#906)', () => {
  const stages = [calculate({ phase: '4', recipes: 'all' }), calculate({ phase: '3' })]
    .flatMap(plan => Object.values(plan.stages))
    .filter(stage => stage.feasible && stage.rows?.length);
  assert.ok(stages.length >= 6, 'several stages that make what they ask for');
  const problems: string[] = [],
    unplaced: string[] = [];
  const count = { rows: 0 };
  let dusty = 0;
  for (let seed = 1; seed <= 12; seed++)
    for (const [index, stage] of stages.entries()) {
      const placed = randomGroups(stage, seed);
      dusty += placed.dusty;
      for (const row of stage.rows as CalcRow[])
        if (Math.abs(total(rowPlaces(row, placed.groups)) - 1) > 1e-12)
          unplaced.push(`seed ${seed} stage ${index} ${row.id}`);
      for (const group of placed.groups.groups)
        problems.push(
          ...flowProblems(stage, placed.groups, group.id, count).map(
            problem => `seed ${seed} stage ${index} ${problem}`,
          ),
        );
    }
  assert.ok(dusty > 500, `${dusty} splits with a part too small to count`);
  assert.ok(count.rows > 10000, `${count.rows} rows checked`);
  assert.deepEqual(problems.slice(0, 10), [], `${problems.length} problems`);
  assert.deepEqual(unplaced.slice(0, 10), [], 'rows whose places add up to less than 1');
});
