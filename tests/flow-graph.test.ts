// A factory group's flow graph (public/app/flow-graph.ts, #1192, part of #1079), on fixed
// synthetic plans: its edges are the group's flow figures (the links the Logistics books and the
// flow page share out, placeLinks), with the rates per minute they carry; its layers run from
// what comes in, through the lines, to what leaves; and a recycling loop and a line's own output
// going back into it are kept, the one drawn under the boxes and the other said in its box.
import test from 'node:test';
import assert from 'node:assert/strict';
import { flowGraph, GRAPH, type FlowGraph, type GraphNode } from '../public/app/flow-graph.ts';
import { groupFlow, placeLinks } from '../public/app/group-flow.ts';
import { groupLinks, itemBooks } from '../public/app/group-links.ts';
import type { CalcRow, FactoryGroups, StoredStage } from '../public/types/index.ts';

// A complete row on 2 whole machines; the flow reads its id, name, machine, machines,
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
const whole = (group: string) => [{ group, rate: null }];
const rateText = (item: string, rate: number) => `${rate}/min`;
const caption = () => '2 × Constructor';

// Ore -> ingot -> plate and rod -> screws -> reinforced plates at the iron works; the motor works
// takes rods and screws. The plates the reinforced line leaves go to storage and the sink.
const iron: StoredStage = {
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
const ironGroups: FactoryGroups = {
  groups: [
    { id: 'fg-iron', name: 'Iron works' },
    { id: 'fg-motor', name: 'Motor works' },
  ],
  assignments: {
    ingot: whole('fg-iron'),
    plate: whole('fg-iron'),
    rod: whole('fg-iron'),
    screw: whole('fg-iron'),
    reinforced: whole('fg-iron'),
    rotor: whole('fg-motor'),
  },
};

const graphOf = (stage: StoredStage, groups: FactoryGroups, id: string): FlowGraph => {
  const flow = groupFlow(stage, groups, id, () => '');
  assert.ok(flow, id);
  return flowGraph(flow, rateText, caption);
};
const node = (graph: FlowGraph, id: string): GraphNode => {
  const found = graph.nodes.find(entry => entry.id === id);
  assert.ok(found, 'a box for ' + id);
  return found;
};
// The points of a path (each "x,y" pair) that lie outside the drawing.
const outside = (graph: Pick<FlowGraph, 'width' | 'height'>, path: string): string[] =>
  [...path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)]
    .filter(([, x, y]) => +x! < 0 || +x! > graph.width || +y! < 0 || +y! > graph.height)
    .map(([point]) => point);
// An edge as from > to: item rate.
const edgeWords = (graph: FlowGraph) =>
  graph.edges.map(edge => `${edge.from} > ${edge.to}: ${edge.item} ${edge.rate}`).sort();

test('the graph’s edges are the group’s flow figures, with their rates per minute', () => {
  const graph = graphOf(iron, ironGroups, 'fg-iron');
  assert.deepEqual(edgeWords(graph), [
    'in:supply/Ore > line:ingot: Ore 60',
    'line:ingot > line:plate: Ingot 30',
    'line:ingot > line:rod: Ingot 30',
    'line:plate > line:reinforced: Plate 12',
    'line:plate > out:sink: Plate 5',
    'line:plate > out:storage: Plate 3',
    'line:reinforced > out:elevator: Reinforced Plate 2',
    'line:rod > line:screw: Rod 10',
    'line:rod > out:fg-motor: Rod 20',
    'line:screw > line:reinforced: Screws 24',
    'line:screw > out:fg-motor: Screws 16',
  ]);
  // Exactly the links the books share out to the group's lines (placeLinks, which the Logistics
  // page's recycling advice and the flow page read), once each.
  const phase = { books: itemBooks(iron, ironGroups), links: groupLinks(iron, ironGroups) };
  const end = (kind: string, id: string, side: string) =>
    kind === 'line' ? 'line:' + id : side + ':' + id;
  const books = placeLinks(iron, ironGroups, 'fg-iron', phase)
    .map(
      link =>
        `${end(link.from.kind, link.from.id, 'in')} > ${end(link.to.kind, link.to.id, 'out')}: ${link.item} ${link.rate}`,
    )
    .sort();
  assert.deepEqual(edgeWords(graph), books);
  // What leaves for the motor works is what Logistics sends it.
  const toMotor = groupLinks(iron, ironGroups).find(
    link => link.from === 'fg-iron' && link.to === 'fg-motor',
  );
  assert.deepEqual(
    graph.edges
      .filter(edge => edge.to === 'out:fg-motor')
      .map(edge => ({ item: edge.item, rate: edge.rate })),
    toMotor?.items,
  );
  // The rate words come from the page's own rate writer.
  assert.deepEqual(
    graph.edges.map(edge => edge.rateText),
    graph.edges.map(edge => `${edge.rate}/min`),
  );
});

test('the boxes run left to right: what comes in, the lines in layers, what leaves', () => {
  const graph = graphOf(iron, ironGroups, 'fg-iron');
  const layers = Object.fromEntries(graph.nodes.map(entry => [entry.id, entry.layer]));
  assert.deepEqual(layers, {
    'in:supply/Ore': 0,
    'line:ingot': 1,
    'line:plate': 2,
    'line:rod': 2,
    'line:screw': 3,
    'line:reinforced': 4,
    'out:sink': 5,
    'out:storage': 5,
    'out:elevator': 5,
    'out:fg-motor': 5,
  });
  assert.equal(graph.layers, 6);
  assert.equal(node(graph, 'line:ingot').label, '01 ingot');
  assert.equal(node(graph, 'in:supply/Ore').caption, 'Raw resource');
  assert.equal(node(graph, 'out:fg-motor').label, 'Motor works');
  assert.equal(node(graph, 'out:fg-motor').caption, 'Factory');
  // Each layer is one column, and no two boxes of a column overlap.
  for (const box of graph.nodes) {
    assert.equal(box.x, GRAPH.pad + box.layer * (GRAPH.nodeWidth + GRAPH.gap), box.id);
    for (const other of graph.nodes)
      if (other !== box && other.layer === box.layer)
        assert.ok(
          other.y >= box.y + box.height || box.y >= other.y + other.height,
          `${box.id} and ${other.id} overlap`,
        );
  }
  // Every edge is drawn from its source's right side to its target's left side, with a label
  // inside the drawing.
  for (const edge of graph.edges) {
    const from = node(graph, edge.from),
      to = node(graph, edge.to);
    assert.ok(
      edge.path?.startsWith(`M${from.x + from.width},`),
      edge.id + ' leaves the right side',
    );
    assert.match(edge.path!, new RegExp(` ${to.x},[\\d.]+$`), edge.id + ' enters the left side');
    assert.ok(edge.label, edge.id + ' has a label');
    assert.ok(edge.label.y > 0 && edge.label.y < graph.height, edge.id + ' label inside');
    assert.deepEqual(outside(graph, edge.path!), [], edge.id + ' stays inside the drawing');
  }
  assert.equal(graph.width, GRAPH.pad + 6 * GRAPH.nodeWidth + 5 * GRAPH.gap + GRAPH.pad);
  // Deterministic: the same flow gives the same drawing.
  assert.deepEqual(graphOf(iron, ironGroups, 'fg-iron'), graph);
});

test('a recycling loop runs under the boxes, and a line’s own output back into it is said in its box', () => {
  // Alumina Solution's Silica feeds the glass line, the scrap line's Water goes back to the
  // alumina line built before it (a loop), and the glass line takes back its own Water.
  const stage: StoredStage = {
    feasible: true,
    rows: [
      row('alumina', { Bauxite: 60, Water: 90 }, { 'Alumina Solution': 60, Silica: 25 }),
      row('scrap', { 'Alumina Solution': 60, Coal: 30 }, { 'Aluminum Scrap': 90, Water: 30 }),
      row('glass', { Silica: 25, Water: 10 }, { Glass: 10, Water: 10 }),
    ],
    raw: { Bauxite: 60, Coal: 30, Water: 60 },
    storage: {},
    surplus: {},
    delivery: {
      'Aluminum Scrap': { target: 100, rate: 90 },
      Glass: { target: 100, rate: 10 },
    },
  };
  const groups: FactoryGroups = {
    groups: [{ id: 'fg-al', name: 'Aluminium' }],
    assignments: { alumina: whole('fg-al'), scrap: whole('fg-al'), glass: whole('fg-al') },
  };
  const graph = graphOf(stage, groups, 'fg-al');
  const loop = graph.edges.find(edge => edge.note === 'loop');
  assert.ok(loop, 'the loop is an edge');
  assert.equal(
    `${loop.from} > ${loop.to}: ${loop.item} ${loop.rate}`,
    'line:scrap > line:alumina: Water 30',
  );
  const bottom = Math.max(...graph.nodes.map(box => box.y + box.height));
  assert.ok(loop.label!.y > bottom, 'its label is under every box');
  assert.ok(loop.label!.y < graph.height, 'and inside the drawing');
  const self = graph.edges.find(edge => edge.note === 'self');
  assert.ok(self, 'the self link is listed');
  assert.equal(self.from, 'line:glass');
  assert.equal(self.to, 'line:glass');
  assert.equal(self.toText, 'itself');
  assert.equal(self.path, null, 'but not drawn');
  const glass = node(graph, 'line:glass');
  assert.equal(glass.selfNote, '↻ 10/min Water back in');
  assert.equal(glass.height, GRAPH.selfHeight);
});

test('a long name is cut in its box and kept whole for the table', () => {
  const name = 'Northern copper and caterium works by the big waterfall';
  const groups: FactoryGroups = {
    ...ironGroups,
    groups: [ironGroups.groups[0]!, { id: 'fg-motor', name }],
  };
  const motor = node(graphOf(iron, groups, 'fg-iron'), 'out:fg-motor');
  assert.equal(motor.label, name);
  assert.equal([...motor.shortLabel].length, GRAPH.nameChars);
  assert.ok(motor.shortLabel.endsWith('…'));
  const edge = graphOf(iron, groups, 'fg-iron').edges.find(entry => entry.to === 'out:fg-motor');
  assert.equal(edge?.toText, name);
});
