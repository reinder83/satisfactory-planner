// The flow graph's storage and sink flows (#1231, part of #1201): the edges into Protected storage
// and the AWESOME Sink are quiet, and with "Show storage and sink as tags" (groups[].layout.tags,
// progress state version 23) they are drawn as tags on their lines instead, the two boxes left
// out and every flow still in the table's edges. Every label sits at the middle of its curve and
// slides along it where it would cover something (spreadLabels); lit labels that find no room are
// left out. Arrows meet a box in the order of their other ends. The saved switch: version 23 only
// while a group has it on, a tested load of every older state (all with it off), refusal of a
// malformed one and of a newer version, and both editions. The dialog is in
// tests/ui/flow-graph.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, catalog } from '../planner.ts';
import {
  initialState,
  mutate,
  newProfileState,
  shareState,
  validateState,
} from '../public/state.ts';
import { validateTransfer } from '../public/transfer.ts';
import {
  flowGraph,
  GRAPH,
  isQuietPlace,
  labelObstacles,
  tagBox,
  type FlowGraph,
  type GraphNode,
} from '../public/app/flow-graph.ts';
import {
  curveAt,
  LABEL_SLIDE,
  labelSlides,
  spreadLabels,
  type GraphCurve,
} from '../public/app/graph-labels.ts';
import { groupFlow } from '../public/app/group-flow.ts';
import { layoutToSave, placedGraph } from '../public/app/graph-layout.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { states, version22, version23 } from './types/fixtures.ts';
import type {
  CalcRow,
  FactoryGroups,
  ProgressState,
  SaveExport,
  StoredCalculatedPlan,
  StoredStage,
  UpdateOp,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// A complete row on 2 whole machines, as tests/flow-graph.test.ts builds them.
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
const rateText = (item: string, rate: number) =>
  `${Math.round(rate * 100) / 100}${item === 'Water' ? ' m³' : ''}/min`;
const caption = () => '2 × Constructor';

// Ore -> ingot -> plate, rod -> screws; plates, rods and screws go to storage and the sink, the
// screws also to the motor works.
const stage: StoredStage = {
  feasible: true,
  rows: [
    row('ingot', { Ore: 60 }, { Ingot: 60 }),
    row('plate', { Ingot: 30 }, { Plate: 20 }),
    row('rod', { Ingot: 30 }, { Rod: 30 }),
    row('screw', { Rod: 20 }, { Screws: 80 }),
    row('rotor', { Rod: 5, Screws: 20 }, { Rotor: 1 }),
  ],
  raw: { Ore: 60 },
  storage: { Plate: 2, Rod: 1, Screws: 1 },
  surplus: { Plate: 18, Rod: 4, Screws: 59 },
  delivery: { Rotor: { target: 10, rate: 1 } },
};
const groups: FactoryGroups = {
  groups: [
    { id: 'fg-iron', name: 'Iron works' },
    { id: 'fg-motor', name: 'Motor works' },
  ],
  assignments: {
    ingot: whole('fg-iron'),
    plate: whole('fg-iron'),
    rod: whole('fg-iron'),
    screw: whole('fg-iron'),
    rotor: whole('fg-motor'),
  },
};
const graphOf = (tags = false): FlowGraph => {
  const flow = groupFlow(stage, groups, 'fg-iron', () => '');
  assert.ok(flow);
  return flowGraph(flow, rateText, caption, { tags });
};
const node = (graph: FlowGraph, id: string): GraphNode => {
  const found = graph.nodes.find(entry => entry.id === id);
  assert.ok(found, id);
  return found;
};

test('the arrows into storage and the sink are quiet; every other arrow is not', () => {
  const graph = graphOf();
  const quiet = graph.edges.filter(edge => edge.quiet);
  assert.ok(quiet.length >= 4, 'the lines send to storage and the sink');
  for (const edge of graph.edges) {
    assert.equal(edge.quiet, edge.to === 'out:storage' || edge.to === 'out:sink', edge.id);
    assert.equal(edge.asTag, false, 'drawn as arrows without the switch');
    assert.ok(edge.path && edge.label && edge.curve, edge.id + ' is drawn and labelled');
  }
  assert.equal(isQuietPlace('out:storage'), true);
  assert.equal(isQuietPlace('out:sink'), true);
  assert.equal(isQuietPlace('out:fg-motor'), false);
  assert.deepEqual(graph.tags, []);
  assert.ok(graph.nodes.some(entry => entry.id === 'out:storage'));
  assert.ok(graph.nodes.some(entry => entry.id === 'out:sink'));
});

test('with tags the two boxes go, each line gets a summed tag per destination, and the table keeps every flow', () => {
  const lines = graphOf();
  const tagged = graphOf(true);
  // The same flows, in the same order and with the same ids: the table lists them all.
  assert.deepEqual(
    tagged.edges.map(edge => [edge.id, edge.from, edge.to, edge.item, edge.rate]),
    lines.edges.map(edge => [edge.id, edge.from, edge.to, edge.item, edge.rate]),
  );
  for (const edge of tagged.edges) {
    assert.equal(edge.asTag, edge.quiet, edge.id);
    if (edge.asTag) assert.equal(edge.path, null, edge.id + ' is not drawn as an arrow');
    else assert.ok(edge.path, edge.id);
  }
  assert.equal(
    tagged.nodes.some(entry => isQuietPlace(entry.id)),
    false,
    'no storage or sink box',
  );
  // One tag per line and destination, storage first, the rates summed and the items named.
  const plate = tagged.tags.filter(tag => tag.node === 'line:plate');
  assert.deepEqual(
    plate.map(tag => [tag.place, tag.index]),
    [
      ['storage', 0],
      ['sink', 1],
    ],
  );
  for (const tag of tagged.tags) {
    const edges = tagged.edges.filter(edge => tag.edges.includes(edge.id));
    assert.ok(edges.length, tag.id);
    assert.ok(edges.every(edge => edge.from === tag.node && edge.asTag));
    const sum = edges.reduce((total, edge) => total + edge.rate, 0);
    assert.equal(tag.text, `${tag.place === 'storage' ? '▣' : '♻'} ${rateText('', sum)}`);
    assert.equal(
      tag.name,
      `${tag.place === 'storage' ? 'To protected storage' : 'To the AWESOME Sink'}: ` +
        edges.map(edge => `${edge.item} ${edge.rateText}`).join(', '),
    );
  }
  // Every flow to storage or the sink is on exactly one tag.
  assert.deepEqual(
    tagged.tags.flatMap(tag => tag.edges).sort(),
    tagged.edges
      .filter(edge => edge.asTag)
      .map(edge => edge.id)
      .sort(),
  );
  // A tag sits on its line's right edge, inside the drawing, below the one before it.
  for (const tag of tagged.tags) {
    const line = node(tagged, tag.node);
    const at = tagBox(tag, line);
    assert.equal(at.x - at.width / 2, line.x + line.width + GRAPH.tagInset);
    assert.ok(at.y - at.height / 2 >= line.y && at.y + at.height / 2 <= line.y + line.height);
    assert.ok(at.x + at.width / 2 <= tagged.width);
  }
  // A line's box and tags move together when the line is moved.
  const moved = placedGraph(tagged, { plate: [900, 500] });
  assert.deepEqual(moved.tags, tagged.tags);
  const spot = tagBox(moved.tags[0]!, node(moved, moved.tags[0]!.node));
  assert.ok(spot.x + spot.width / 2 <= moved.width);
});

test('a tag sums solids and fluids each on their own', () => {
  const fluid: StoredStage = {
    feasible: true,
    rows: [row('pump', { Ore: 1 }, { Water: 30, Plate: 4 })],
    raw: { Ore: 1 },
    storage: { Plate: 1 },
    surplus: { Plate: 3, Water: 30 },
  };
  const flow = groupFlow(
    fluid,
    { groups: [{ id: 'fg-a', name: 'A' }], assignments: { pump: whole('fg-a') } },
    'fg-a',
    () => '',
  );
  assert.ok(flow);
  const tags = flowGraph(flow, rateText, caption, { tags: true }).tags;
  assert.deepEqual(
    tags.map(tag => tag.text),
    ['▣ 1/min', '♻ 30 m³/min + 3/min'],
  );
});

test('a label sits at the middle of its curve where nothing is in the way', () => {
  const graph = graphOf();
  const obstacles = labelObstacles(graph.nodes, graph.tags);
  let middles = 0;
  for (const edge of graph.edges) {
    const middle = curveAt(edge.curve!, 0.5);
    const at = (t: number) => curveAt(edge.curve!, t);
    // On its curve: at one of the spots it slides to.
    const t = labelSlides().find(
      spot =>
        Math.abs(Math.max(edge.label!.width / 2, at(spot).x) - edge.label!.x) < 0.11 &&
        Math.abs(Math.max(GRAPH.labelHeight / 2, at(spot).y) - edge.label!.y) < 0.11,
    );
    assert.ok(t !== undefined, edge.id + ' sits on its curve');
    if (t === 0.5) middles++;
    else assert.notDeepEqual([edge.label!.x, edge.label!.y], [middle.x, middle.y]);
  }
  assert.ok(middles > graph.edges.length / 2, 'most labels sit at the middle');
  // The labels shown at rest (all but the quiet ones) overlap no box and no other label.
  const shown = graph.edges.filter(edge => !edge.quiet);
  for (const edge of shown) {
    for (const box of obstacles)
      assert.ok(
        !(
          Math.abs(box.x - edge.label!.x) < (box.width + edge.label!.width) / 2 &&
          Math.abs(box.y - edge.label!.y) < (box.height + GRAPH.labelHeight) / 2
        ),
        edge.id + ' covers a box',
      );
    for (const other of shown)
      if (other !== edge)
        assert.ok(
          !(
            Math.abs(other.label!.x - edge.label!.x) <
              (other.label!.width + edge.label!.width) / 2 &&
            Math.abs(other.label!.y - edge.label!.y) < GRAPH.labelHeight
          ),
          `${edge.id} and ${other.id} overlap`,
        );
  }
});

test('spread labels slide along their own curve to the first free spot, and one without room is left out', () => {
  assert.deepEqual(labelSlides().slice(0, 5), [0.5, 0.46, 0.54, 0.42, 0.58]);
  assert.ok(labelSlides().every(t => t >= LABEL_SLIDE.min && t <= LABEL_SLIDE.max));
  assert.equal(labelSlides().at(-1), 0.94);
  // Three labels on one straight curve: the first at the middle, the others slid along it.
  const curve: GraphCurve = {
    from: { x: 0, y: 100 },
    c1: { x: 300, y: 100 },
    c2: { x: 600, y: 100 },
    to: { x: 900, y: 100 },
  };
  const labels = ['a', 'b', 'c'].map(id => ({ id, width: 100, curves: [curve] }));
  const spots = spreadLabels(labels, 30, [], false);
  assert.deepEqual(spots.get('a'), { x: 450, y: 100, curve });
  const b = spots.get('b')!,
    c = spots.get('c')!;
  assert.ok(Math.abs(b.x - 450) >= 100 && Math.abs(c.x - 450) >= 100);
  assert.ok(Math.abs(b.x - c.x) >= 100);
  for (const spot of [b, c]) assert.equal(spot.y, 100);
  // A short curve with no room: left out when lit; at rest kept at the middle, marked crowded
  // (the dialog leaves it out until pointed at, #1019), taking no room from the labels after it.
  const short: GraphCurve = {
    from: { x: 100, y: 50 },
    c1: { x: 110, y: 50 },
    c2: { x: 120, y: 50 },
    to: { x: 130, y: 50 },
  };
  const crowd = ['x', 'y'].map(id => ({ id, width: 100, curves: [short] }));
  const lit = spreadLabels(crowd, 30, [], false);
  assert.ok(lit.get('x'));
  assert.equal(lit.get('y'), null);
  const rest = spreadLabels(crowd, 30, [], true);
  assert.deepEqual(rest.get('x'), { x: 115, y: 50, curve: short });
  assert.deepEqual(rest.get('y'), { x: 115, y: 50, curve: short, crowded: true });
  const below: GraphCurve = {
    from: { x: 400, y: 60 },
    c1: { x: 410, y: 60 },
    c2: { x: 420, y: 60 },
    to: { x: 430, y: 60 },
  };
  const wide = [...crowd, { id: 'z', width: 100, curves: [below] }].map(label =>
    label.id === 'y' ? { ...label, width: 700 } : label,
  );
  // y, 700 wide at the middle of its curve, would cover z; crowded, it leaves z its middle.
  assert.deepEqual(spreadLabels(wide, 30, [], true).get('z'), { x: 415, y: 60, curve: below });
  // Top to bottom: the higher label keeps its middle even when given last.
  const high: GraphCurve = { ...short, from: { x: 100, y: 40 }, c1: { x: 110, y: 40 } };
  const order = spreadLabels(
    [
      { id: 'low', width: 100, curves: [short] },
      { id: 'high', width: 100, curves: [high] },
    ],
    30,
    [],
    false,
  );
  assert.equal(order.get('low'), null);
  assert.ok(order.get('high'));
});

// In the automatic layout an arrow that skips layers passes a gap in each, so there the order is
// that of the next gap along it; between neighbouring layers it is that of the other end's box.
test('arrows meet a box in the order of their other ends, so they do not cross before it', () => {
  const automatic = graphOf();
  for (const graph of [automatic, placedGraph(automatic, { ingot: [16, 600] })]) {
    const near = (a: string, b: string) =>
      graph !== automatic || Math.abs(node(graph, a).layer - node(graph, b).layer) === 1;
    for (const box of graph.nodes) {
      const portY = (path: string, end: 'first' | 'last') => {
        const points = [...path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(([, , y]) => +y!);
        return end === 'first' ? points[0]! : points[points.length - 1]!;
      };
      const middle = (id: string) => {
        const other = node(graph, id);
        return other.y + other.height / 2;
      };
      const into = graph.edges.filter(
        edge => edge.to === box.id && edge.path && near(edge.from, edge.to),
      );
      const sortedIn = [...into].sort((a, b) => portY(a.path!, 'last') - portY(b.path!, 'last'));
      for (let i = 1; i < sortedIn.length; i++)
        assert.ok(
          middle(sortedIn[i - 1]!.from) <= middle(sortedIn[i]!.from) + 1e-6,
          `${box.id}: arrows in follow their sources`,
        );
      const out = graph.edges.filter(
        edge => edge.from === box.id && edge.path && near(edge.from, edge.to),
      );
      const sortedOut = [...out].sort((a, b) => portY(a.path!, 'first') - portY(b.path!, 'first'));
      for (let i = 1; i < sortedOut.length; i++)
        assert.ok(
          middle(sortedOut[i - 1]!.to) <= middle(sortedOut[i]!.to) + 1e-6,
          `${box.id}: arrows out follow their targets`,
        );
    }
  }
});

// The saved switch.
const arrange = (id: string, layout: unknown): UpdateOp =>
  ({ type: 'factoryGroupLayout', id, layout }) as UpdateOp;
const grouped = (): ProgressState =>
  mutate(initialState(), { type: 'factoryGroupAdd', id: 'fg-plates1', name: 'Plates' });
const layoutOf = (state: ProgressState, id = 'fg-plates1') =>
  state.factoryGroups.groups.find(group => group.id === id)?.layout;

test('the tags switch is kept only when on, as version 23, and switching it off brings the version back', () => {
  let state = grouped();
  assert.equal(state.version, 3);
  state = mutate(state, arrange('fg-plates1', { tags: true }));
  assert.deepEqual(layoutOf(state), { tags: true });
  assert.equal(state.version, 23);
  assert.deepEqual(validateState(json(state)), state, 'it loads again as it was');
  state = mutate(state, arrange('fg-plates1', { tags: true, zoom: 0.5, nodes: { plate: [1, 2] } }));
  assert.deepEqual(layoutOf(state), { nodes: { plate: [1, 2] }, zoom: 0.5, tags: true });
  assert.equal(state.version, 23);
  // Off: the rest of the layout stays, as version 22.
  state = mutate(
    state,
    arrange('fg-plates1', { zoom: 0.5, nodes: { plate: [1, 2] }, tags: false }),
  );
  assert.deepEqual(layoutOf(state), { nodes: { plate: [1, 2] }, zoom: 0.5 });
  assert.equal(state.version, 22);
  state = mutate(state, arrange('fg-plates1', { tags: false }));
  assert.equal(layoutOf(state), undefined);
  assert.equal(state.version, 3);
  // What a save sends.
  const keep = new Set(['plate']);
  assert.deepEqual(layoutToSave({}, { zoom: 1, left: 0, top: 0 }, keep, true), { tags: true });
  assert.deepEqual(layoutToSave({ plate: [3, 4] }, null, keep, true), {
    tags: true,
    nodes: { plate: [3, 4] },
  });
  assert.equal(layoutToSave({}, { zoom: 1, left: 0, top: 0 }, keep, false), null);
  assert.equal(layoutToSave({}, null, keep), null, 'off unless asked');
});

test('a malformed tags switch is refused, in an update and in a stored state', () => {
  const state = grouped();
  for (const tags of ['yes', 1, 0, null, [], {}]) {
    assert.throws(
      () => mutate(state, arrange('fg-plates1', { tags })),
      /Invalid factory layout\./,
      JSON.stringify(tags),
    );
    const stored = json(state);
    (stored.factoryGroups.groups[0] as { layout?: unknown }).layout = { tags };
    assert.throws(() => validateState(stored), /Invalid factory layout\./, JSON.stringify(tags));
  }
});

test('every released state loads unchanged with the switch off; version 23 only while it is on', () => {
  for (const [state, version] of states) {
    const clean = validateState(json(state));
    assert.equal(clean.version, version);
    assert.deepEqual(clean.checks, state.checks);
    if (version < 23)
      assert.ok(
        clean.factoryGroups.groups.every(group => !group.layout?.tags),
        'version ' + version + ' shows storage and the sink as lines',
      );
  }
  const clean = validateState(json(version23));
  assert.deepEqual(clean.factoryGroups.groups, version23.factoryGroups.groups);
  // Without the switch it is the version-22 state it was built on.
  const plain = json(version23);
  for (const group of plain.factoryGroups.groups as { layout?: { tags?: boolean } }[])
    delete group.layout?.tags;
  delete (plain.factoryGroups.groups[1] as { layout?: unknown }).layout;
  assert.deepEqual(validateState(plain), validateState(json(version22)), 'as version 22 has it');
  // Saying less than it holds is marked for what it holds; a higher version gets the update
  // message, as a release before this one refuses a version-23 state.
  assert.equal(validateState({ ...json(version23), version: 3 }).version, 23);
  assert.throws(
    () => validateState({ ...json(version23), version: 31 }),
    /newer planner version\. Update the app to import it\./,
  );
});

test('a share and a new profile carry the switch', () => {
  const plan = calculate({ phase: '1', goal: 'timed', hours: 8, multiplier: 1, storage: 'none' });
  const source = mutate(grouped(), arrange('fg-plates1', { tags: true, zoom: 1.5 }));
  const shared = shareState(source);
  assert.deepEqual(layoutOf(shared), { zoom: 1.5, tags: true });
  assert.equal(shared.version, 23);
  const carried = newProfileState(plan, source, plan, undefined, undefined).state;
  assert.deepEqual(layoutOf(carried), { zoom: 1.5, tags: true });
  assert.equal(carried.version, 23);
});

// Both editions (the Docker server's handlers are covered with the layout in
// tests/graph-layout.test.ts, which shares validateState and mutate): the switch survives a
// reload, a full export and its import, and switching it off brings the version back.
test('the browser edition keeps the switch in IndexedDB, exports it and never recalculates', async () => {
  const records = new Map<string, unknown>();
  const open = () =>
    createBrowserApi(
      openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      catalog(),
    );
  let api = open();
  const request = (route: string, body?: unknown) =>
    api(route, body === undefined ? undefined : { body: JSON.stringify(body) });
  type Context = { plan: StoredCalculatedPlan; state: ProgressState };
  await request('/api/profiles', { saveName: 'Tag world', name: 'Tagged', settings: {} });
  const before = (await request('/api/context')) as Context;
  const group = before.state.factoryGroups.groups[0]!.id;
  await request('/api/update', arrange(group, { tags: true }));
  api = open();
  const after = (await request('/api/context')) as Context;
  assert.deepEqual(after.plan, before.plan, 'the stored plan is not recalculated');
  assert.equal(after.state.version, 23);
  assert.deepEqual(layoutOf(after.state, group), { tags: true });
  const exported = (await request('/api/export-saves')) as SaveExport;
  const carried = validateState(validateTransfer(exported).saves[0]!.profiles[0]!.state);
  assert.equal(carried.version, 23);
  assert.deepEqual(layoutOf(carried, group), { tags: true });
  await request('/api/update', arrange(group, null));
  api = open();
  const cleared = (await request('/api/context')) as Context;
  assert.ok(cleared.state.version < 22, 'version ' + cleared.state.version);
});
