// What each box of a factory's flow graph says it makes, draws or receives (#1308): the rates are
// the sums of the box's own edges, per item (fluids in m³/min, solids per minute, as the edge
// labels word them), worded once; a line's main product comes first and its by-products fold into
// "+ N more"; an input says what it draws, an output the first two items it receives, then "+N
// more". A box grew to say it, so a layout saved before that (boxes spaced for the old heights) is
// drawn with no box on another, and nothing of it is stored by the drawing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { flowGraph, GRAPH, type FlowGraph, type GraphNode } from '../public/app/flow-graph.ts';
import { groupFlow } from '../public/app/group-flow.ts';
import { GRAPH_GRID, heldSpots, placedGraph, type GraphSpots } from '../public/app/graph-layout.ts';
import type { CalcRow, FactoryGroups, StoredStage } from '../public/types/index.ts';

const row = (id: string, inputs: CalcRow['inputs'], outputs: CalcRow['outputs']): CalcRow => ({
  id,
  name: id,
  phase: 1,
  machine: 'Refinery',
  power: 30,
  inputs,
  outputs,
  equivalent: 2,
  machines: 2,
  lastClock: 100,
  peakMW: 60,
  generationMW: 0,
});
// The pages' itemRate (flow.ts, which needs the browser's modules) without the locale: the number
// to two decimals, and "m³/min" after a no-break space for a fluid, "/min" for anything else.
const FLUID_ITEMS = new Set(['Crude Oil', 'Heavy Oil Residue', 'Water', 'Fuel']);
const itemRate = (item: string, rate: number): string =>
  String(Math.round(rate * 100) / 100) + (FLUID_ITEMS.has(item) ? ' m³/min' : '/min');
const whole = (group: string) => [{ group, rate: null }];

// Crude oil is refined into plastic (the main product), heavy oil residue and water (by-products);
// the cable works takes all three, some goes to storage and the sink, and the foundry takes
// plastic only. The oil comes in as a raw resource, and the plate line (no by-product) draws
// 123.456 of the oil as well, so the oil input sums two edges.
const stage: StoredStage = {
  feasible: true,
  rows: [
    row(
      'refine',
      { 'Crude Oil': 600.125 },
      { Plastic: 400.0625, 'Heavy Oil Residue': 200.25, Water: 50.5 },
    ),
    row('cables', { Plastic: 100.1, 'Heavy Oil Residue': 50.2, Water: 20.3 }, { Cable: 40 }),
    row('plates', { 'Crude Oil': 123.456 }, { Plate: 10 }),
    row('foundry', { Plastic: 60.3 }, { Ingot: 20 }),
  ],
  raw: { 'Crude Oil': 723.581 },
  storage: { Plastic: 3.3 },
  surplus: { 'Heavy Oil Residue': 4.4 },
  delivery: { Cable: { target: 100, rate: 40 }, Ingot: { target: 100, rate: 20 } },
};
const groups: FactoryGroups = {
  groups: [
    { id: 'fg-oil', name: 'Oil works' },
    { id: 'fg-cable', name: 'Cable works' },
    { id: 'fg-foundry', name: 'Foundry' },
  ],
  assignments: {
    refine: whole('fg-oil'),
    plates: whole('fg-oil'),
    cables: whole('fg-cable'),
    foundry: whole('fg-foundry'),
  },
};
// Three lines of one factory, each making a main product and a by-product (one of them a fluid)
// that the second factory takes, so their boxes grow by two text lines each.
const manyStage: StoredStage = {
  feasible: true,
  rows: [
    row('l1', { Ore: 10 }, { 'Main 1': 10, Fuel: 5 }),
    row('l2', { Ore: 10 }, { 'Main 2': 10, 'A very long by-product name here': 5 }),
    row('l3', { Ore: 10 }, { 'Main 3': 10, 'By 3': 5 }),
    row(
      'use',
      {
        'Main 1': 10,
        Fuel: 5,
        'Main 2': 10,
        'A very long by-product name here': 5,
        'Main 3': 10,
        'By 3': 5,
      },
      { Gadget: 1 },
    ),
  ],
  raw: { Ore: 30 },
  storage: {},
  surplus: {},
  delivery: { Gadget: { target: 100, rate: 1 } },
};
const manyGroups: FactoryGroups = {
  groups: [
    { id: 'fg-many', name: 'Many' },
    { id: 'fg-use', name: 'Users' },
  ],
  assignments: {
    l1: whole('fg-many'),
    l2: whole('fg-many'),
    l3: whole('fg-many'),
    use: whole('fg-use'),
  },
};
const graphOf = (id = 'fg-oil', tags = false): FlowGraph => {
  const many = id === 'fg-many';
  const flow = groupFlow(
    many ? manyStage : stage,
    many ? manyGroups : groups,
    id,
    () => '2 × Refinery',
  );
  assert.ok(flow, id);
  return flowGraph(flow, itemRate, () => '2 × Refinery', { tags });
};
const node = (graph: FlowGraph, id: string): GraphNode => {
  const found = graph.nodes.find(entry => entry.id === id);
  assert.ok(found, 'a box for ' + id);
  return found;
};
// The sum of the rates of `edges` per item, added in the edges' order.
const sums = (edges: FlowGraph['edges']) => {
  const total = new Map<string, number>();
  for (const edge of edges) total.set(edge.item, (total.get(edge.item) ?? 0) + edge.rate);
  return total;
};

test('every box’s rates are the sums of its edges per item, fluids and solids alike, worded once', () => {
  for (const id of ['fg-oil', 'fg-cable', 'fg-foundry']) {
    for (const tags of [false, true]) {
      const graph = graphOf(id, tags);
      for (const box of graph.nodes) {
        const own = graph.edges.filter(
          edge => (box.kind === 'out' ? edge.to : edge.from) === box.id,
        );
        const expected = sums(own);
        assert.deepEqual(
          box.rates.map(rate => rate.item).sort(),
          [...expected.keys()].sort(),
          box.id,
        );
        for (const rate of box.rates) {
          assert.equal(rate.rate, expected.get(rate.item), `${box.id} ${rate.item}`);
          assert.equal(rate.text, itemRate(rate.item, rate.rate), 'the edge labels’ wording');
        }
      }
    }
  }
});

test('a line says what it makes (what its edges carry), the main product first, by-products as "+ N more"', () => {
  const graph = graphOf();
  const refine = node(graph, 'line:refine');
  // The recipe's own order, not the size of the rate: the plastic, then the residue and the water.
  assert.deepEqual(
    refine.rates.map(rate => rate.item),
    ['Plastic', 'Heavy Oil Residue', 'Water'],
  );
  assert.deepEqual(refine.rateLines, ['→ Plastic 163.7/min', '+ 2 more']);
  assert.equal(
    refine.rateTitle,
    `Plastic 163.7/min, Heavy Oil Residue 54.6 m³/min, Water 20.3 m³/min`,
  );
  // The line's output is what its edges carry: 100.1 + 60.3 + 3.3 plastic (this plan's demand).
  assert.equal(refine.rates[0]!.rate, 100.1 + 60.3 + 3.3);
  // Where every output is sent somewhere it is the flow's own output rate for the line.
  const many = groupFlow(manyStage, manyGroups, 'fg-many', () => '')!;
  const l1 = many.lines.find(line => line.id === 'l1')!.outputs;
  for (const rate of node(graphOf('fg-many'), 'line:l1').rates)
    assert.ok(Math.abs(rate.rate - l1.find(out => out.item === rate.item)!.rate) < 1e-9);
  // A line whose output goes nowhere says nothing and keeps its height.
  assert.deepEqual(node(graph, 'line:plates').rateLines, []);
  assert.equal(node(graph, 'line:plates').height, GRAPH.nodeHeight);
});

test('two outputs fit on two lines, a fluid is in m³/min, a long name is cut and never the rate', () => {
  const graph = graphOf('fg-many');
  const first = node(graph, 'line:l1');
  assert.deepEqual(first.rateLines, ['→ Main 1 10/min', '→ Fuel 5 m³/min']);
  assert.equal(first.height, GRAPH.nodeHeight + 2 * GRAPH.textLine);
  const flow = groupFlow(manyStage, manyGroups, 'fg-many', () => '')!;
  const long = flowGraph(
    flow,
    (item, rate) => `${rate}/min`,
    () => '',
  );
  const lines = node(long, 'line:l2').rateLines;
  for (const text of lines) assert.ok([...text].length <= GRAPH.captionChars, text);
  assert.match(lines[1]!, /^→ A very.*… 5\/min$/);
});

test('an input says what it draws, summed over its edges; an output the first two items, then "+N more"', () => {
  const graph = graphOf();
  const oil = node(graph, 'in:supply/Crude Oil');
  const oilEdges = graph.edges.filter(edge => edge.from === oil.id);
  assert.equal(oilEdges.length, 2, 'two lines draw the oil');
  const total = 600.125 + 123.456;
  assert.equal(oil.rates.length, 1);
  assert.equal(oil.rates[0]!.rate, total);
  assert.deepEqual(oil.rateLines, [`Crude Oil · ${itemRate('Crude Oil', total)}`]);
  assert.equal(oil.rateLines[0], 'Crude Oil · 723.58 m³/min');
  // The cable works receives three items (all of them from the refinery), the largest two shown.
  const cable = node(graph, 'out:fg-cable');
  assert.deepEqual(cable.rateLines, [
    'Plastic 100.1/min',
    'Heavy Oil Residue 50.2 m³/min',
    '+1 more',
  ]);
  assert.equal(cable.height, Math.max(GRAPH.nodeHeight + 3 * GRAPH.textLine, cable.baseHeight));
  assert.match(cable.rateTitle, /Water 20.3/);
  // Protected storage and the sink receive what the lines send.
  assert.deepEqual(node(graph, 'out:storage').rateLines, ['Plastic 3.3/min']);
  assert.deepEqual(node(graph, 'out:sink').rateLines, ['Heavy Oil Residue 4.4 m³/min']);
});

test('with storage and sink as tags their flows still count in the line’s rates', () => {
  const plain = graphOf('fg-oil', false),
    tagged = graphOf('fg-oil', true);
  assert.deepEqual(
    node(tagged, 'line:refine').rates,
    node(plain, 'line:refine').rates,
    'a tag is no change to what the line makes',
  );
});

// A saved layout of the graph before the boxes showed rates: spots spaced for the boxes' old
// heights, a row's gap apart.
function legacySpots(graph: FlowGraph): GraphSpots {
  const spots: Record<string, [number, number]> = {};
  // The lines of the oil works stacked in one column, each a rowGap under the old height of the
  // one above it; a column of its own for the foundry's input.
  let y = 40;
  for (const box of graph.nodes.filter(entry => entry.kind === 'line')) {
    spots[box.id.replace(/^line:/, '')] = [300, y];
    y += box.baseHeight + GRAPH.rowGap;
  }
  return spots;
}
const meets = (a: GraphNode, b: GraphNode) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('a layout saved before the rates drew boxes close together is drawn with none on another', () => {
  const graph = graphOf('fg-many');
  const spots = legacySpots(graph);
  // With the old heights it was clear; with the new ones it would overlap.
  const crude = placedGraph(graph, spots, undefined, false);
  assert.ok(
    crude.nodes.some(a => crude.nodes.some(b => a !== b && meets(a, b))),
    'the taller boxes cover each other where they were stored',
  );
  const settled = placedGraph(graph, spots, undefined, true);
  for (const a of settled.nodes)
    for (const b of settled.nodes) if (a !== b) assert.equal(meets(a, b), false, `${a.id} ${b.id}`);
  // The stored spots are untouched; the boxes that moved are named, on the grid, below where stored.
  assert.ok(settled.nudged && Object.keys(settled.nudged).length, 'something was settled');
  for (const [id, [x, y]] of Object.entries(settled.nudged!)) {
    assert.equal(y % GRAPH_GRID, 0, id);
    const stored = spots[id.replace(/^line:/, '')]!;
    assert.equal(x, stored[0]);
    assert.ok(y > stored[1], id);
    assert.deepEqual([node(settled, id).x, node(settled, id).y], [x, y]);
  }
  // The first move keeps them as drawn: held spots from the settled graph stay put.
  const held = heldSpots(settled, spots);
  assert.deepEqual(Object.keys(held).sort(), Object.keys(spots).sort());
  // Arrows run to the boxes as drawn, and the drawing holds them all.
  for (const edge of settled.edges)
    if (edge.path) assert.match(edge.path, /^M[\d.]+,[\d.]+ C/, edge.id);
  for (const box of settled.nodes) {
    assert.ok(box.y + box.height <= settled.height && box.x + box.width <= settled.width);
  }
});

test('a layout that was clear needs no settling, and one that overlapped by choice stays as it was', () => {
  const graph = graphOf('fg-many');
  const roomy: Record<string, [number, number]> = {};
  graph.nodes
    .filter(box => box.kind === 'line')
    .forEach((box, i) => (roomy[box.id.replace(/^line:/, '')] = [300, 40 + i * 200]));
  const clear = placedGraph(graph, roomy, undefined, true);
  assert.equal(clear.nudged, undefined);
  // Two lines dropped on each other before the rates: still on each other, not shoved apart.
  const lines = graph.nodes.filter(box => box.kind === 'line');
  const stacked: Record<string, [number, number]> = Object.fromEntries(
    lines.map(box => [box.id.replace(/^line:/, ''), [300, 40] as [number, number]]),
  );
  const kept = placedGraph(graph, stacked, undefined, true);
  for (const box of lines)
    assert.deepEqual([node(kept, box.id).x, node(kept, box.id).y], [300, 40]);
  assert.equal(kept.nudged, undefined);
});

test('the automatic layout of the taller boxes has none on another', () => {
  for (const id of ['fg-oil', 'fg-cable', 'fg-foundry']) {
    const graph = graphOf(id);
    for (const a of graph.nodes)
      for (const b of graph.nodes) if (a !== b) assert.equal(meets(a, b), false, `${a.id} ${b.id}`);
  }
});
