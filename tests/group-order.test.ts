// The build plan's production steps group by group (#869): homeGroup, groupedBuildOrder and
// groupedSteps in public/app/group-order.ts, which the build plan applies to the steps phaseSteps in
// public/progression.ts lists. Only the order may change: the same steps, the same ids.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  groupedBuildOrder,
  groupedRows,
  groupedSteps,
  homeGroup,
  UNGROUPED,
} from '../public/app/group-order.ts';
import { phaseSteps } from '../public/progression.ts';
import { calculate } from '../planner.ts';
import type { CalcRow, FactoryGroups, Progression } from '../public/types/index.ts';

const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
// A complete row; the build order reads its id, inputs, outputs and generationMW.
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
const groups = (
  assignments: FactoryGroups['assignments'],
  ids = ['fg-iron', 'fg-parts', 'fg-copper'],
): FactoryGroups => ({ groups: ids.map(id => ({ id, name: id })), assignments });
const whole = (group: string) => [{ group, rate: null }];
const ids = (rows: { id: string }[]) => rows.map(r => r.id);

// The planner's build order (suppliers first, depth first), which mixes the two sites.
const ingot = row('ingot', { 'Iron Ore': 60 }, { 'Iron Ingot': 60 }),
  plate = row('plate', { 'Iron Ingot': 30 }, { 'Iron Plate': 20 }),
  rod = row('rod', { 'Iron Ingot': 30 }, { 'Iron Rod': 30 }),
  screw = row('screw', { 'Iron Rod': 10 }, { Screws: 40 }),
  reinforced = row('reinforced', { 'Iron Plate': 12, Screws: 24 }, { 'Reinforced Plate': 2 }),
  rotor = row('rotor', { 'Iron Rod': 20, Screws: 16 }, { Rotor: 4 });
const mixed = [ingot, plate, rod, screw, reinforced, rotor];

test('without groups, or with every row in one group, the order is the planner’s', () => {
  assert.deepEqual(ids(groupedRows(mixed, undefined)), ids(mixed));
  assert.deepEqual(ids(groupedRows(mixed, { groups: [], assignments: {} })), ids(mixed));
  const one = groups(Object.fromEntries(mixed.map(r => [r.id, whole('fg-parts')])));
  assert.deepEqual(ids(groupedRows(mixed, one)), ids(mixed));
});

test('a group that feeds another is finished first, whatever the listed order of the groups', () => {
  // Smelting (ingot, rod, screw) feeds Parts (plate, reinforced, rotor); Parts is listed first.
  const split = groups(
    {
      ingot: whole('fg-iron'),
      rod: whole('fg-iron'),
      screw: whole('fg-iron'),
      plate: whole('fg-parts'),
      reinforced: whole('fg-parts'),
      rotor: whole('fg-parts'),
    },
    ['fg-parts', 'fg-iron'],
  );
  assert.deepEqual(ids(groupedRows(mixed, split)), [
    'ingot',
    'rod',
    'screw',
    'plate',
    'reinforced',
    'rotor',
  ]);
});

test('independent groups follow the listed order of the groups, then Ungrouped', () => {
  const copperIngot = row('copper', { 'Copper Ore': 30 }, { 'Copper Ingot': 30 }),
    wire = row('wire', { 'Copper Ingot': 15 }, { Wire: 30 });
  const rows = [copperIngot, ingot, wire, plate, rod];
  const assigned = groups(
    { ingot: whole('fg-iron'), plate: whole('fg-iron'), copper: whole('fg-copper') },
    ['fg-copper', 'fg-iron'],
  );
  // wire and rod are in no group; Ungrouped comes last.
  assert.deepEqual(ids(groupedRows(rows, assigned)), ['copper', 'ingot', 'plate', 'wire', 'rod']);
});

test('groups that need each other switch as few times as the suppliers allow', () => {
  // A makes a and c, B makes b and d; b needs a, c needs b, d needs c: A B A B is the least.
  const a = row('a', { Ore: 1 }, { A: 1 }),
    b = row('b', { A: 1 }, { B: 1 }),
    c = row('c', { B: 1 }, { C: 1 }),
    d = row('d', { C: 1 }, { D: 1 }),
    // e (A) and f (B) need nothing, so each joins its group's first run.
    e = row('e', { Ore: 1 }, { E: 1 }),
    f = row('f', { Ore: 1 }, { F: 1 });
  const order = groupedBuildOrder(
    [a, b, c, d, e, f],
    step => (['a', 'c', 'e'].includes(step.name) ? 'A' : 'B'),
    ['A', 'B'],
  );
  assert.deepEqual(ids(order), ['a', 'e', 'b', 'f', 'c', 'd']);
});

test('a step never goes ahead of a step that makes one of its inputs', () => {
  const plan = calculate({});
  for (const key of ['2', '3', '4'] as const) {
    const rows = plan.stages[key].rows!;
    // Every third row in each of three groups, so the groups need each other often.
    const names = ['fg-iron', 'fg-parts', 'fg-copper'];
    const assigned = groups(
      Object.fromEntries(rows.map((r, i) => [r.id, whole(names[i % 3]!)])),
      names,
    );
    const ordered = groupedRows(rows, assigned);
    assert.deepEqual(ids(ordered).sort(), ids(rows).sort(), `phase ${key}: the same rows`);
    const position = new Map(ordered.map((r, i) => [r.id, i]));
    rows.forEach((consumer, i) => {
      for (const supplier of rows.slice(0, i))
        if (Object.keys(consumer.inputs).some(item => supplier.outputs[item]))
          assert.ok(
            position.get(supplier.id)! < position.get(consumer.id)!,
            `phase ${key}: ${supplier.id} before ${consumer.id}`,
          );
    });
    // Fewer switches between groups than the planner's order.
    const switches = (list: CalcRow[]) =>
      list.filter((r, i) => i && homeGroup(r, assigned) !== homeGroup(list[i - 1]!, assigned))
        .length;
    assert.ok(switches(ordered) < switches(rows), `phase ${key}: fewer switches`);
    assert.deepEqual(ids(groupedRows(rows, assigned)), ids(ordered), 'deterministic');
  }
});

test('a row in several groups is built with its largest share', () => {
  const plateRow = row('plate', { 'Iron Ingot': 30 }, { 'Iron Plate': 20 });
  const of = (memberships: FactoryGroups['assignments'][string]) =>
    homeGroup(plateRow, groups({ plate: memberships }));
  assert.equal(
    of([
      { group: 'fg-iron', rate: 5 },
      { group: 'fg-parts', rate: null },
    ]),
    'fg-parts',
  );
  assert.equal(
    of([
      { group: 'fg-iron', rate: 15 },
      { group: 'fg-parts', rate: null },
    ]),
    'fg-iron',
  );
  // A tie goes to the earlier membership.
  assert.equal(of([...whole('fg-parts'), ...whole('fg-iron')]), 'fg-parts');
  // A part in no group does not count: 5 of 20 here, 15 ungrouped, is still built here.
  assert.equal(of([{ group: 'fg-iron', rate: 5 }]), 'fg-iron');
  // A removed group is no group.
  assert.equal(of([...whole('fg-gone'), { group: 'fg-iron', rate: 1 }]), 'fg-iron');
  assert.equal(of(whole('fg-gone')), UNGROUPED);
  assert.equal(homeGroup(plateRow, undefined), UNGROUPED);
});

test('groupedSteps reorders only the production steps, with the same ids', () => {
  const plan = calculate({});
  for (const phase of ['2', '3', '4', '5', 'post']) {
    const plain = phaseSteps(plan, { checks: {} }, data, phase);
    const rows = plain.filter(step => step.row);
    const names = ['fg-iron', 'fg-parts'];
    const factoryGroups = groups(
      Object.fromEntries(rows.map((step, i) => [step.row!.id, whole(names[i % 2]!)])),
      names,
    );
    const grouped = groupedSteps(plain, factoryGroups);
    assert.deepEqual(ids(grouped).sort(), ids(plain).sort(), `phase ${phase}: the same ids`);
    // Every step that is not a production row keeps its place.
    plain.forEach((step, i) => {
      if (!step.row) assert.equal(grouped[i]!.id, step.id, `phase ${phase}: ${step.id} stays`);
    });
    // Each row step keeps its key, calc-<stage>-<row id>.
    for (const step of grouped.filter(s => s.row))
      assert.equal(step.id, `calc-${phase === 'post' ? '5' : phase}-${step.row!.id}`);
    if (rows.length > 3) assert.notDeepEqual(ids(grouped), ids(plain), `phase ${phase}: reordered`);
  }
});
