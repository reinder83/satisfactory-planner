// The flow graph's layered layout (FG-1, #1343, part of #1323): the columns are the lines'
// dependency depth (what comes in, step 1 … step N, what leaves), an arrow that skips columns
// passes a waypoint in each column it skips, the boxes of each column are ordered by repeated
// barycenter sweeps from several seeded starts (the order with the fewest crossings is kept) and
// stand at the average height of their neighbours. On a busy fixture factory the crossings drop
// against the layout before (four sweeps from one start), and the layout never changes between runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  flowGraph,
  GRAPH,
  ORDERING,
  PREVIOUS_ORDERING,
  type FlowGraph,
  type GraphNode,
} from '../public/app/flow-graph.ts';
import { calculate } from '../planner.ts';
import { defaultFactoryGroups } from '../public/state/factory-groups.ts';
import { groupFlow } from '../public/app/group-flow.ts';
import type { CalcRow, FactoryGroups, StoredStage } from '../public/types/index.ts';

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
const rateText = (item: string, rate: number) => `${rate}/min`;
const caption = () => '2 × Constructor';

// A busy iron and steel works: ore and coal become ingots, plates, rods, screws, steel beams and
// pipes, and those feed frames and plating several steps later, so many arrows skip columns; a
// little of two items goes to storage and the sink.
const busy: StoredStage = {
  feasible: true,
  rows: [
    row('iron-ingot', { 'Iron Ore': 90 }, { 'Iron Ingot': 90 }),
    row('steel-ingot', { 'Iron Ore': 45, Coal: 45 }, { 'Steel Ingot': 45 }),
    row('copper-ingot', { 'Copper Ore': 30 }, { 'Copper Ingot': 30 }),
    row('concrete', { Limestone: 45 }, { Concrete: 15 }),
    row('plate', { 'Iron Ingot': 30 }, { 'Iron Plate': 20 }),
    row('rod', { 'Iron Ingot': 45 }, { 'Iron Rod': 45 }),
    row('screw', { 'Iron Rod': 10 }, { Screws: 40 }),
    row('wire', { 'Copper Ingot': 15 }, { Wire: 30 }),
    row('cable', { Wire: 30 }, { Cable: 15 }),
    row('beam', { 'Steel Ingot': 30 }, { 'Steel Beam': 20 }),
    row('pipe', { 'Steel Ingot': 15 }, { 'Steel Pipe': 20 }),
    row('reinforced', { 'Iron Plate': 12, Screws: 24 }, { 'Reinforced Plate': 2 }),
    row('rotor', { 'Iron Rod': 20, Screws: 16 }, { Rotor: 4 }),
    row('encased', { 'Steel Beam': 12, Concrete: 15 }, { 'Encased Beam': 4 }),
    row('stator', { 'Steel Pipe': 10, Wire: 20 }, { Stator: 4 }),
    row('modular', { 'Reinforced Plate': 2, 'Iron Rod': 8 }, { 'Modular Frame': 2 }),
    row('motor', { Rotor: 4, Stator: 4 }, { Motor: 4 }),
    row(
      'heavy',
      { 'Modular Frame': 2, 'Steel Pipe': 10, 'Encased Beam': 4, Screws: 10 },
      { 'Heavy Frame': 1 },
    ),
    row('plating', { 'Reinforced Plate': 1, Rotor: 1, Cable: 5 }, { 'Smart Plating': 2 }),
    row('computer', { Motor: 2, Cable: 10, 'Iron Plate': 3 }, { Assembly: 1 }),
  ],
  raw: { 'Iron Ore': 135, Coal: 45, 'Copper Ore': 30, Limestone: 45 },
  storage: { Screws: 3, 'Iron Plate': 2 },
  surplus: { 'Iron Rod': 4, Cable: 1 },
  delivery: {
    'Heavy Frame': { target: 100, rate: 1 },
    'Smart Plating': { target: 100, rate: 2 },
    Assembly: { target: 100, rate: 1 },
    Motor: { target: 100, rate: 2 },
  },
};
const whole = (group: string) => [{ group, rate: null }];
const groups: FactoryGroups = {
  groups: [{ id: 'fg-works', name: 'Iron and steel works' }],
  assignments: Object.fromEntries((busy.rows ?? []).map(r => [r.id, whole('fg-works')])),
};

const graphOf = (options = {}): FlowGraph => {
  const flow = groupFlow(busy, groups, 'fg-works', () => '');
  assert.ok(flow);
  return flowGraph(flow, rateText, caption, options);
};
const at = (graph: FlowGraph, id: string): GraphNode => graph.nodes.find(n => n.id === id)!;
const lines = (graph: FlowGraph) => graph.nodes.filter(node => node.kind === 'line');
const boxesMeet = (a: GraphNode, b: GraphNode) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('the columns are dependency depth: inputs, then each step after the lines that feed it, then what leaves', () => {
  const graph = graphOf();
  assert.ok(graph.layers >= 6, 'a deep factory has many columns');
  const column = (id: string) => at(graph, id).layer;
  for (const id of graph.nodes.filter(n => n.kind === 'in').map(n => n.id))
    assert.equal(column(id), 0);
  // Every forward flow between lines goes to a later column; a line stands one past its latest feeder.
  for (const edge of graph.edges) {
    if (edge.note || !edge.from.startsWith('line:') || !edge.to.startsWith('line:')) continue;
    assert.ok(column(edge.to) > column(edge.from), `${edge.from} feeds ${edge.to}`);
  }
  assert.equal(
    column('line:heavy'),
    Math.max(
      column('line:modular'),
      column('line:pipe'),
      column('line:encased'),
      column('line:screw'),
    ) + 1,
  );
  const last = Math.max(...lines(graph).map(n => n.layer));
  for (const out of graph.nodes.filter(n => n.kind === 'out')) assert.equal(out.layer, last + 1);
  assert.equal(graph.layers, last + 2);
  // The columns are evenly spaced.
  assert.equal(
    at(graph, 'line:iron-ingot').x,
    GRAPH.pad + column('line:iron-ingot') * (GRAPH.nodeWidth + GRAPH.gap),
  );
});

test('an arrow that skips columns runs through a waypoint in each, as a straight lane between the boxes', () => {
  const graph = graphOf();
  const skipping = graph.edges.filter(
    edge => edge.path && at(graph, edge.to).layer - at(graph, edge.from).layer > 1,
  );
  assert.ok(skipping.length >= 5, 'the fixture has many arrows that skip columns');
  for (const edge of skipping) {
    const skipped = at(graph, edge.to).layer - at(graph, edge.from).layer - 1;
    // One "H" (straight across a column) per column skipped.
    assert.equal((edge.path!.match(/ H/g) ?? []).length, skipped, edge.id);
  }
  // A waypoint is level: the run across a column stays on one height.
  for (const edge of skipping) {
    const runs = [...edge.path!.matchAll(/ C[\d.]+,[\d.]+ [\d.]+,([\d.]+) ([\d.]+),\1 H/g)];
    assert.ok(runs.length >= 1, edge.id);
  }
});

test('the boxes of a column never overlap and keep the gap between them', () => {
  const graph = graphOf();
  for (const a of graph.nodes)
    for (const b of graph.nodes)
      if (a !== b && a.layer === b.layer)
        assert.ok(
          !boxesMeet(a, b) &&
            (a.y >= b.y + b.height + GRAPH.rowGap || b.y >= a.y + a.height + GRAPH.rowGap),
          `${a.id} / ${b.id}`,
        );
  assert.ok(
    graph.nodes.every(node => node.y >= GRAPH.pad),
    'nothing above the padding',
  );
});

test('a box with one neighbour stands level with it: heights are averaged, not stacked from the top', () => {
  const graph = graphOf();
  const middle = (node: GraphNode) => node.y + node.height / 2;
  // The copper line has one feeder and one consumer: it sits between them, not at the top of its column.
  const wire = at(graph, 'line:wire');
  const feeders = [at(graph, 'line:copper-ingot')];
  const gap = Math.abs(middle(wire) - middle(feeders[0]!));
  assert.ok(gap <= GRAPH.nodeHeight, `wire is ${gap} from its feeder`);
});

test('fewer crossings than the layout before, on the busy fixture and on the planner’s own factories', () => {
  const before = graphOf({ ordering: PREVIOUS_ORDERING }).crossings;
  const after = graphOf().crossings;
  console.log(
    `busy fixture crossings: before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`,
  );
  assert.ok(after.all < before.all, `${after.all} < ${before.all}`);
  assert.ok(after.loud < before.loud);
  // The default is the new ordering.
  assert.deepEqual(graphOf({ ordering: ORDERING }).crossings, after);

  // The planner's default Phase 5 plan and factories (Iron works, Parts, Projects, Electronics …).
  const plan = calculate({ phase: '5', goal: 'timed', hours: 8, multiplier: 1, storage: 'none' });
  const factories = defaultFactoryGroups(plan);
  const stage = plan.stages['5']!;
  const sums = { before: 0, after: 0 };
  const per: string[] = [];
  for (const group of factories.groups) {
    const flow = groupFlow(stage, factories, group.id, () => '');
    if (!flow?.lines.length) continue;
    const old = flowGraph(flow, rateText, caption, { ordering: PREVIOUS_ORDERING }).crossings.all;
    const now = flowGraph(flow, rateText, caption).crossings.all;
    assert.ok(now <= old, `${group.id}: ${now} <= ${old}`);
    sums.before += old;
    sums.after += now;
    per.push(`${group.id} ${old} -> ${now}`);
  }
  console.log(
    `Phase 5 factories crossings: ${per.join(', ')}; total ${sums.before} -> ${sums.after}`,
  );
  assert.ok(sums.after <= sums.before * 0.75, `${sums.after} <= 75% of ${sums.before}`);
});

test('the layout is the same every time', () => {
  const key = (graph: FlowGraph) =>
    JSON.stringify([
      graph.nodes.map(n => [n.id, n.x, n.y, n.layer]),
      graph.edges.map(e => e.path),
      graph.crossings,
      graph.width,
      graph.height,
    ]);
  assert.equal(key(graphOf()), key(graphOf()));
  assert.equal(key(graphOf({ tags: true })), key(graphOf({ tags: true })));
});
