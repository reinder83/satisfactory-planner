// The flow of one factory group (public/app/group-flow.ts, #893, part of #883): its lines in the
// build plan's order, their rows and links, what crosses the group's edge, the Sink & storage
// fold and the item lanes, on hand-made stages and on a real plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignLanes,
  groupFlow,
  laneGutter,
  laneOffset,
  LANE_METRICS,
} from '../public/app/group-flow.ts';
import type { FlowLink, GroupFlow } from '../public/app/group-flow.ts';
import { groupLinks, OUTSIDE, sourceOf } from '../public/app/group-links.ts';
import { defaultFactoryGroups } from '../public/state/factory-groups.ts';
import { calculate } from '../planner.ts';
import type { CalcRow, FactoryGroups, StoredStage } from '../public/types/index.ts';

const close = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${what}: ${actual} is not ${expected}`);
// A complete row on `machines` whole machines; the flow reads its id, name, machine, machines,
// lastClock, inputs, outputs and generationMW.
const row = (id: string, inputs: CalcRow['inputs'], outputs: CalcRow['outputs']): CalcRow => ({
  id,
  name: id,
  phase: 1,
  machine: 'Constructor',
  power: 4,
  inputs,
  outputs,
  equivalent: 2,
  machines: 2,
  lastClock: 100,
  peakMW: 8,
  generationMW: 0,
});
// The belts a test can recognise: the page passes the factory dialog's itemBelts instead.
const belts = (item: string, rate: number) => `belts for ${rate} ${item}`;
const sum = (links: FlowLink[]) => links.reduce((total, link) => total + link.rate, 0);

// Ore -> ingot -> plate and rod -> screws -> reinforced plates at the iron works, and a rotor
// line at the motor works fed with its rods and screws. The plates the reinforced line leaves
// go to storage and the sink.
const stage: StoredStage = {
  feasible: true,
  rows: [
    row('ingot', { Ore: 60 }, { Ingot: 60 }),
    row('plate', { Ingot: 30 }, { Plate: 20 }),
    row('rod', { Ingot: 30 }, { Rod: 30 }),
    row('screw', { Rod: 10 }, { Screws: 40 }),
    row('reinforced', { Plate: 12, Screws: 24 }, { 'Reinforced Plate': 2 }),
    row('rotor', { Rod: 20, Screws: 16 }, { Rotor: 4 }),
  ],
  raw: { Ore: 60 },
  storage: { Plate: 3 },
  surplus: { Plate: 5 },
  delivery: { 'Reinforced Plate': { target: 100, rate: 2 }, Rotor: { target: 100, rate: 4 } },
};
const whole = (group: string) => [{ group, rate: null }];
const groups = (assignments: FactoryGroups['assignments']): FactoryGroups => ({
  groups: [
    { id: 'fg-iron', name: 'Iron works' },
    { id: 'fg-motor', name: 'Motor works' },
    { id: 'fg-empty', name: 'Not built yet' },
  ],
  assignments,
});
const ironAndMotor = groups({
  ingot: whole('fg-iron'),
  plate: whole('fg-iron'),
  rod: whole('fg-iron'),
  screw: whole('fg-iron'),
  reinforced: whole('fg-iron'),
  rotor: whole('fg-motor'),
});
const flowOf = (plan: StoredStage, factoryGroups: FactoryGroups, id: string): GroupFlow => {
  const flow = groupFlow(plan, factoryGroups, id, belts);
  assert.ok(flow, id);
  return flow;
};

// Every check of "the rates add up", for one group of a plan that makes what it asks for:
// each row's links carry its whole rate, and what crosses the group's edge is groupLinks' links.
function assertAddsUp(plan: StoredStage, factoryGroups: FactoryGroups, id: string) {
  const flow = flowOf(plan, factoryGroups, id);
  for (const line of flow.lines)
    for (const flowRow of [...line.inputs, ...line.outputs])
      close(sum(flowRow.links), flowRow.rate, `${id} ${flowRow.id}`);
  const links = groupLinks(plan, factoryGroups);
  const expected = (inward: boolean) =>
    links
      .filter(link => (inward ? link.to : link.from) === id)
      .flatMap(link =>
        link.items.map(entry => `${inward ? link.from : link.to}|${entry.item}|${entry.rate}`),
      )
      .sort();
  const ports = (list: GroupFlow['ins']) =>
    list.map(port => `${port.place}|${port.item}|${port.rate}`).sort();
  assert.deepEqual(ports(flow.ins), expected(true), `${id}: what comes in`);
  assert.deepEqual(ports([...flow.outs, ...flow.fold.ports]), expected(false), `${id}: leaves`);
  // Each port's rate is shared out among the lines, so the lines' links to it add up to it.
  const lineLinks = flow.lines.flatMap(line =>
    [...line.inputs, ...line.outputs].flatMap(flowRow => flowRow.links),
  );
  for (const [dir, list] of [
    ['in', flow.ins],
    ['out', [...flow.outs, ...flow.fold.ports]],
  ] as const)
    for (const port of list) {
      const carried = lineLinks.filter(link => {
        const end = dir === 'in' ? link.from : link.to;
        return end.kind === 'place' && end.id === port.place && link.item === port.item;
      });
      close(sum(carried), port.rate, `${id} ${dir} ${port.place} ${port.item}`);
    }
}

test('the lines are the group’s rows in the build plan’s order, with recipe, machines and clock', () => {
  const flow = flowOf(stage, ironAndMotor, 'fg-iron');
  assert.deepEqual(
    flow.lines.map(line => [line.no, line.id]),
    [
      [1, 'ingot'],
      [2, 'plate'],
      [3, 'rod'],
      [4, 'screw'],
      [5, 'reinforced'],
    ],
  );
  const reinforced = flow.lines[4]!;
  assert.equal(reinforced.recipe, 'reinforced');
  assert.equal(reinforced.machine, 'Constructor');
  assert.equal(reinforced.machines, 2);
  assert.equal(reinforced.lastClock, 100);
  assert.equal(reinforced.share, 1);
  assert.equal(reinforced.machinesHere, 2);
  assert.deepEqual(
    reinforced.inputs.map(input => [input.id, input.rate, input.belts]),
    [
      ['in|reinforced|Plate', 12, 'belts for 12 Plate'],
      ['in|reinforced|Screws', 24, 'belts for 24 Screws'],
    ],
  );
  assert.equal(flow.split, false);
});

test('the rates add up against the Logistics page (groupLinks)', () => {
  for (const id of ['fg-iron', 'fg-motor']) assertAddsUp(stage, ironAndMotor, id);
  const flow = flowOf(stage, ironAndMotor, 'fg-iron');
  // The ore comes in from its mine, and the rods and screws the rotors need leave for the motor
  // works.
  assert.deepEqual(
    flow.ins.map(port => [port.place, port.kind, port.label, port.item, port.rate]),
    [[sourceOf('Ore'), 'raw', 'Ore', 'Ore', 60]],
  );
  assert.deepEqual(
    flow.outs.map(port => [port.place, port.kind, port.item, port.rate]),
    [
      ['fg-motor', 'group', 'Rod', 20],
      ['fg-motor', 'group', 'Screws', 16],
      [OUTSIDE.delivery, 'outside', 'Reinforced Plate', 2],
    ],
  );
  // The screw line's screws: 24 to the reinforced line, 16 to the motor works.
  const screws = flow.lines[3]!.outputs[0]!;
  assert.deepEqual(
    screws.links.map(link => [link.to, link.rate, link.belts]),
    [
      [{ kind: 'line', id: 'reinforced' }, 24, 'belts for 24 Screws'],
      [{ kind: 'place', id: 'fg-motor' }, 16, 'belts for 16 Screws'],
    ],
  );
});

test('a split row counts only the group’s share, in each group it is in', () => {
  // Half the rod line (15 of its 30 rods) at the iron works, the rest at the motor works.
  const split = groups({
    ...ironAndMotor.assignments,
    rod: [
      { group: 'fg-iron', rate: 15 },
      { group: 'fg-motor', rate: null },
    ],
  });
  const iron = flowOf(stage, split, 'fg-iron'),
    motor = flowOf(stage, split, 'fg-motor');
  const rodIn = (flow: GroupFlow) => flow.lines.find(line => line.id === 'rod')!;
  for (const flow of [iron, motor]) {
    const rod = rodIn(flow);
    assert.equal(rod.share, 0.5);
    assert.equal(rod.machinesHere, 1);
    assert.equal(rod.machines, 2, 'the row’s own machine count stays');
    assert.deepEqual(
      [...rod.inputs, ...rod.outputs].map(flowRow => [flowRow.id, flowRow.rate]),
      [
        ['in|rod|Ingot', 15],
        ['out|rod|Rod', 15],
      ],
    );
    assert.equal(flow.split, true);
  }
  for (const id of ['fg-iron', 'fg-motor']) assertAddsUp(stage, split, id);
  // The motor works now makes rods of its own, so less comes in from the iron works.
  const rodsFromIron = motor.ins.find(port => port.place === 'fg-iron' && port.item === 'Rod');
  close(rodsFromIron!.rate, 10, 'rods the motor works still takes from the iron works');
});

test('the sink and protected storage fold into one summary that keeps the details', () => {
  const flow = flowOf(stage, ironAndMotor, 'fg-iron');
  assert.equal(flow.fold.items, 1);
  assert.equal(flow.fold.rate, 8);
  assert.deepEqual(
    flow.fold.ports.map(port => [port.place, port.label, port.item, port.rate]),
    [
      [OUTSIDE.surplus, 'AWESOME Sink', 'Plate', 5],
      [OUTSIDE.storage, 'Protected storage', 'Plate', 3],
    ],
  );
  assert.ok(flow.outs.every(port => port.place !== OUTSIDE.surplus));
  // The plate line's row still names both places.
  const plates = flow.lines[1]!.outputs[0]!;
  assert.deepEqual(
    plates.links.map(link => [link.to.id, link.rate]),
    [
      ['reinforced', 12],
      [OUTSIDE.surplus, 5],
      [OUTSIDE.storage, 3],
    ],
  );
});

test('each output row gets one lane, the shortest nearest the cards, reused where free', () => {
  const flow = flowOf(stage, ironAndMotor, 'fg-iron');
  // The rows down the cards: 0 Ore in, 1 Ingot out | 2 Ingot in, 3 Plate out | 4 Ingot in,
  // 5 Rod out | 6 Rod in, 7 Screws out | 8 Plate in, 9 Screws in, 10 Reinforced Plate out.
  // Rods (5-6), screws (7-9) and ingots (1-4) do not overlap and share the inner lane; the plates
  // (3-8) cross them all and take the next.
  assert.deepEqual(
    flow.lanes.map(lane => [lane.from, lane.lane, lane.to]),
    [
      ['out|ingot|Ingot', 0, ['in|plate|Ingot', 'in|rod|Ingot']],
      ['out|plate|Plate', 1, ['in|reinforced|Plate']],
      ['out|rod|Rod', 0, ['in|screw|Rod']],
      ['out|screw|Screws', 0, ['in|reinforced|Screws']],
    ],
  );
  assert.equal(flow.laneCount, 2);
  // All links from one output row share its lane: both ingot links ride lane 0.
  assert.equal(flow.lanes[0]!.links.length, 2);
  // Links to places outside the group get no lane.
  assert.ok(flow.lanes.every(lane => lane.links.every(link => link.to.kind === 'line')));
});

test('the lane assignment is stable', () => {
  const first = flowOf(stage, ironAndMotor, 'fg-iron');
  // The same plan again, from copies with the assignments listed in another order.
  const reordered = groups(Object.fromEntries(Object.entries(ironAndMotor.assignments).reverse()));
  const again = flowOf(structuredClone(stage), reordered, 'fg-iron');
  assert.deepEqual(again.lanes, first.lanes);
  assert.deepEqual(assignLanes(first.lines), first.lanes);
  // Lanes depend on the rows only: every line placed again gives the same lanes.
  assert.deepEqual(assignLanes(structuredClone(first.lines)), first.lanes);
});

test('the gutter is sized to the lanes needed, at an even step', () => {
  for (const [metrics, step, inner] of [
    [LANE_METRICS.wide, 10, 18],
    [LANE_METRICS.narrow, 8, 14],
  ] as const) {
    assert.equal(laneGutter(0, metrics), 0, 'no lanes, no gutter');
    assert.equal(laneGutter(1, metrics), 4 + inner);
    assert.equal(laneGutter(6, metrics), 4 + 5 * step + inner);
    const offsets = [0, 1, 2, 3, 4, 5].map(lane => laneOffset(lane, metrics));
    assert.equal(offsets[0], inner, 'the innermost lane keeps the gap to the cards');
    assert.ok(offsets.every((offset, i) => !i || offset - offsets[i - 1]! === step));
    // The outermost lane sits `outer` px from the gutter's left edge.
    assert.equal(laneGutter(6, metrics) - offsets[5]!, 4);
  }
  assert.equal(laneGutter(6, LANE_METRICS.wide), 72);
  assert.equal(laneGutter(6, LANE_METRICS.narrow), 58);
});

test('a link to a line built earlier is marked as a loop', () => {
  // A recycling pair: the second line hands part of its output back to the first.
  const loop: StoredStage = {
    feasible: true,
    rows: [
      row('mix', { Ore: 10, Scrap: 5 }, { Mixture: 15 }),
      row('press', { Mixture: 15 }, { Scrap: 5, Brick: 10 }),
    ],
    raw: { Ore: 10 },
    delivery: { Brick: { target: 100, rate: 10 } },
  };
  const factoryGroups = groups({ mix: whole('fg-iron'), press: whole('fg-iron') });
  const flow = flowOf(loop, factoryGroups, 'fg-iron');
  const scrap = flow.lines[1]!.outputs.find(output => output.item === 'Scrap')!;
  assert.deepEqual(
    scrap.links.map(link => [link.to.id, link.loop]),
    [['mix', true]],
  );
  assert.equal(flow.lines[0]!.outputs[0]!.links[0]!.loop, false);
  assertAddsUp(loop, factoryGroups, 'fg-iron');
});

test('an empty group, an unknown group and a one-line group', () => {
  const empty = flowOf(stage, ironAndMotor, 'fg-empty');
  assert.deepEqual(empty, {
    group: 'fg-empty',
    lines: [],
    ins: [],
    outs: [],
    fold: { items: 0, rate: 0, ports: [] },
    lanes: [],
    laneCount: 0,
    split: false,
  });
  assert.equal(groupFlow(stage, ironAndMotor, 'fg-gone', belts), null);
  // A phase without production: no rows at all.
  assert.deepEqual(flowOf({ feasible: false }, ironAndMotor, 'fg-iron').lines, []);

  const motor = flowOf(stage, ironAndMotor, 'fg-motor');
  assert.deepEqual(
    motor.lines.map(line => [line.no, line.id]),
    [[1, 'rotor']],
  );
  assert.deepEqual(motor.lanes, []);
  assert.equal(motor.laneCount, 0);
  assert.deepEqual(
    motor.ins.map(port => [port.place, port.item, port.rate]),
    [
      ['fg-iron', 'Rod', 20],
      ['fg-iron', 'Screws', 16],
    ],
  );
  assert.deepEqual(
    motor.outs.map(port => [port.place, port.item, port.rate]),
    [[OUTSIDE.delivery, 'Rotor', 4]],
  );
  assertAddsUp(stage, ironAndMotor, 'fg-motor');
});

test('on a real plan with the default groups, every group’s rates add up', () => {
  const plan = calculate({});
  const real = plan.stages['3'];
  const factoryGroups = defaultFactoryGroups(plan);
  assert.ok(factoryGroups.groups.length > 1);
  for (const group of factoryGroups.groups) assertAddsUp(real, factoryGroups, group.id);
  // Every grouped row of the phase is a line of its group, once.
  const lines = factoryGroups.groups.flatMap(group =>
    flowOf(real, factoryGroups, group.id).lines.map(line => line.id),
  );
  const grouped = real.rows!.filter(r => factoryGroups.assignments[r.id]?.length);
  assert.ok(grouped.length > 10, 'a plan with lines in its groups');
  assert.deepEqual([...lines].sort(), grouped.map(r => r.id).sort());
});
