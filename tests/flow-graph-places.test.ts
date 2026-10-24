// Flow graph inputs and outputs moved too, and every move on a 5-unit grid (#1240, part of #1201):
// the boxes of what comes in (left) and what leaves (right: factories, Protected storage, the
// AWESOME Sink) can be dragged or nudged like production lines, their arrows follow, and their
// spots are stored with the factory's layout by node id (groups[].layout.places), progress state
// version 25 only while a group has one. Spots stored before the grid stay as they are; the boxes
// without a stored spot are drawn on the grid once the graph is arranged (never more than 2.5 units
// off). A tested load of every older state (none has places, a version-24 state is read as it
// was), refusal of a malformed spot and of a newer version, a share and a carry, and both editions
// (the Docker server and the browser edition). The dialog is in tests/ui/flow-graph.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { calculate, catalog } from '../planner.ts';
import {
  initialState,
  LAYOUT_LIMITS,
  mutate,
  newProfileState,
  shareState,
  validateState,
} from '../public/state.ts';
import { validateTransfer } from '../public/transfer.ts';
import { flowGraph, type FlowGraph, type GraphNode } from '../public/app/flow-graph.ts';
import { groupFlow } from '../public/app/group-flow.ts';
import {
  GRAPH_GRID,
  heldSpots,
  isPlaceNode,
  layoutToSave,
  placedGraph,
  snapSpot,
} from '../public/app/graph-layout.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { states, version24, version25 } from './types/fixtures.ts';
import type {
  CalcRow,
  FactoryGroups,
  GroupLayout,
  ProgressState,
  SaveExport,
  StoredCalculatedPlan,
  StoredStage,
  UpdateOp,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const arrange = (id: string, layout: unknown): UpdateOp =>
  ({ type: 'factoryGroupLayout', id, layout }) as UpdateOp;
const grouped = (): ProgressState =>
  mutate(initialState(), { type: 'factoryGroupAdd', id: 'fg-plates1', name: 'Plates' });
const layoutOf = (state: ProgressState, id = 'fg-plates1') =>
  state.factoryGroups.groups.find(group => group.id === id)?.layout;

test('moved inputs and outputs are kept by node id, whole units, as version 25 only while there is one', () => {
  let state = grouped();
  assert.equal(state.version, 3);
  state = mutate(
    state,
    arrange('fg-plates1', {
      places: { 'in:supply/Iron Ore': [15.4, 40], 'out:storage': [900, 94.6] },
    }),
  );
  assert.deepEqual(layoutOf(state), {
    places: { 'in:supply/Iron Ore': [15, 40], 'out:storage': [900, 95] },
  });
  assert.equal(state.version, 25);
  assert.deepEqual(validateState(json(state)), state, 'it loads again as it was');
  // With the rest of a layout it is still 25; without the places it is what the rest needs.
  const full = { nodes: { plate: [10, 20] }, places: { 'out:fg-wires1': [900, 95] }, tags: true };
  state = mutate(state, arrange('fg-plates1', full));
  assert.deepEqual(layoutOf(state), full);
  assert.equal(state.version, 25);
  state = mutate(state, arrange('fg-plates1', { ...full, places: {} }));
  assert.deepEqual(layoutOf(state), { nodes: { plate: [10, 20] }, tags: true });
  assert.equal(state.version, 23);
  state = mutate(state, arrange('fg-plates1', { places: { 'in:ungrouped': [5, 5] } }));
  assert.equal(state.version, 25);
  state = mutate(state, arrange('fg-plates1', null));
  assert.equal(state.version, 3, 'reset: the state is what older releases read again');
  // Removing the factory takes its places with it.
  state = mutate(state, arrange('fg-plates1', { places: { 'out:sink': [5, 5] } }));
  assert.equal(state.version, 25);
  state = mutate(state, { type: 'factoryGroupRemove', id: 'fg-plates1' });
  assert.ok(state.version < 22, 'version ' + state.version);
});

test('a malformed place spot is refused, in an update and in a stored state', () => {
  const state = grouped();
  const bad: unknown[] = [
    { places: [] },
    { places: 'in:sink' },
    { places: { 'line:plate': [1, 2] } },
    { places: { storage: [1, 2] } },
    { places: { 'in:': [1, 2] } },
    { places: { 'in:__proto__': [1, 2] } },
    { places: { 'in:bad key': [1, 2] } },
    { places: { 'in:supply/': [1, 2] } },
    { places: { 'out:storage': [-1, 0] } },
    { places: { 'out:storage': [1] } },
    { places: { 'out:storage': ['1', 2] } },
    { places: { 'out:storage': [1, LAYOUT_LIMITS.coordinate + 1] } },
    {
      places: Object.fromEntries(
        Array.from({ length: LAYOUT_LIMITS.places + 1 }, (_, i) => ['in:fg-' + i, [0, 0]]),
      ),
    },
  ];
  for (const layout of bad) {
    assert.throws(
      () => mutate(state, arrange('fg-plates1', layout)),
      /Invalid factory layout\./,
      JSON.stringify(layout).slice(0, 60),
    );
    const stored = json(state);
    (stored.factoryGroups.groups[0] as { layout?: unknown }).layout = layout;
    assert.throws(() => validateState(stored), /Invalid factory layout\./);
  }
});

test('every released state loads unchanged; version 25 only with a moved place; version 24 reads as it was', () => {
  for (const [state, version] of states) {
    const clean = validateState(json(state));
    assert.equal(clean.version, version);
    assert.deepEqual(clean.checks, state.checks);
    if (version < 25)
      assert.ok(
        clean.factoryGroups.groups.every(group => !group.layout?.places),
        'version ' + version + ' has its inputs and outputs at their automatic spots',
      );
  }
  const clean = validateState(json(version25));
  assert.deepEqual(clean.factoryGroups.groups, version25.factoryGroups.groups);
  assert.deepEqual(clean.sloopPins, version24.sloopPins, 'and what version 24 added');
  // A version-24 layout's line spots off the 5-unit grid are kept exactly, not snapped.
  const old = validateState(json(version24));
  assert.deepEqual(old.factoryGroups.groups[0]!.layout!.nodes, {
    'iron-plate': [420, 96],
    Recipe_IronPlate_C: [16, 260],
  });
  assert.deepEqual(validateState(json(old)), old, 'and saved again unchanged');
  // Without its places it is the version-24 state it was built on.
  const plain = json(version25);
  for (const group of plain.factoryGroups.groups as { layout?: { places?: unknown } }[])
    delete group.layout?.places;
  assert.deepEqual(validateState(plain), old, 'as version 24 has it');
  // Saying less than it holds is marked for what it holds; a higher version gets the update
  // message, as a release before this one refuses a version-25 state.
  assert.equal(validateState({ ...json(version25), version: 3 }).version, 25);
  assert.throws(
    () => validateState({ ...json(version25), version: 26 }),
    /newer planner version\. Update the app to import it\./,
  );
});

test('a share and a new profile carry the moved inputs and outputs', () => {
  const plan = calculate({ phase: '1', goal: 'timed', hours: 8, multiplier: 1, storage: 'none' });
  const layout: GroupLayout = { places: { 'out:sink': [900, 300] }, zoom: 1.5, tags: true };
  const source = mutate(grouped(), arrange('fg-plates1', layout));
  const shared = shareState(source);
  assert.deepEqual(layoutOf(shared), layout);
  assert.equal(shared.version, 25);
  const carried = newProfileState(plan, source, plan, undefined, undefined).state;
  assert.deepEqual(layoutOf(carried), layout);
  assert.equal(carried.version, 25);
});

// A complete row on 2 whole machines, as tests/graph-layout.test.ts builds them.
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
// Ore -> ingot -> plate and rod -> screws; the plates and screws go to storage.
const stage: StoredStage = {
  feasible: true,
  rows: [
    row('ingot', { Ore: 60 }, { Ingot: 60 }),
    row('plate', { Ingot: 30 }, { Plate: 20 }),
    row('rod', { Ingot: 30 }, { Rod: 30 }),
    row('screw', { Rod: 10 }, { Screws: 40 }),
  ],
  raw: { Ore: 60 },
  storage: { Plate: 20, Screws: 40 },
};
const groups: FactoryGroups = {
  groups: [{ id: 'fg-iron', name: 'Iron works' }],
  assignments: {
    ingot: whole('fg-iron'),
    plate: whole('fg-iron'),
    rod: whole('fg-iron'),
    screw: whole('fg-iron'),
  },
};
const graphOf = (tags = false): FlowGraph => {
  const flow = groupFlow(stage, groups, 'fg-iron', () => '');
  assert.ok(flow);
  return flowGraph(
    flow,
    (_, rate) => `${rate}/min`,
    () => '2 × Constructor',
    { tags },
  );
};
const box = (graph: FlowGraph, id: string): GraphNode => {
  const found = graph.nodes.find(node => node.id === id);
  assert.ok(found, id);
  return found;
};
const ends = (path: string) => {
  const points = [...path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(([, x, y]) => [+x!, +y!]);
  return { first: points[0]!, last: points[points.length - 1]! };
};
const INPUT = 'in:supply/Ore',
  STORAGE = 'out:storage';

test('a moved input or output sits at its spot and its arrows follow; every box is on the grid', () => {
  const graph = graphOf();
  assert.ok(isPlaceNode(INPUT) && isPlaceNode(STORAGE) && !isPlaceNode('line:rod'));
  assert.equal(placedGraph(graph, undefined, {}), graph, 'nothing moved: the automatic graph');
  assert.equal(placedGraph(graph, undefined, { 'in:nowhere': [5, 5] }), graph, 'no such box');
  // The first move of a place holds the lines where they are (on the grid), as a line's does.
  const held = heldSpots(graph, {});
  const placed = placedGraph(graph, held, { [INPUT]: [15, 400], [STORAGE]: [1700, 10] });
  assert.deepEqual([box(placed, INPUT).x, box(placed, INPUT).y], [15, 400]);
  assert.deepEqual([box(placed, STORAGE).x, box(placed, STORAGE).y], [1700, 10]);
  for (const node of placed.nodes) {
    assert.equal(node.x % GRAPH_GRID, 0, node.id);
    assert.equal(node.y % GRAPH_GRID, 0, node.id);
    if (node.id === INPUT || node.id === STORAGE) continue;
    const automatic = box(graph, node.id);
    assert.deepEqual([node.x, node.y], snapSpot(automatic.x, automatic.y), node.id);
  }
  // Each arrow leaves its source's right side and enters its target's left side.
  for (const edge of placed.edges) {
    if (!edge.path) continue;
    const { first, last } = ends(edge.path);
    const from = box(placed, edge.from),
      to = box(placed, edge.to);
    assert.equal(first[0], from.x + from.width, edge.id);
    assert.ok(first[1]! >= from.y && first[1]! <= from.y + from.height, edge.id);
    assert.equal(last[0], to.x, edge.id);
    assert.ok(last[1]! >= to.y && last[1]! <= to.y + to.height, edge.id);
  }
  // The same boxes in the same order (the tab order), and the drawing holds the moved ones.
  assert.deepEqual(
    placed.nodes.map(node => node.id),
    graph.nodes.map(node => node.id),
  );
  assert.ok(placed.width >= 1700 + box(placed, STORAGE).width);
  assert.ok(placed.height >= 400 + box(placed, INPUT).height);
  // A place moved alone (no line held) leaves the lines at their automatic spots, on the grid.
  const alone = placedGraph(graph, undefined, { [INPUT]: [15, 65] });
  for (const node of alone.nodes) {
    const automatic = box(graph, node.id);
    assert.ok(Math.abs(node.x - automatic.x) <= 2.5 && Math.abs(node.y - automatic.y) <= 2.5);
  }
});

test('storage and the sink keep their stored spots while they are tags, and a save keeps them', () => {
  const tagged = graphOf(true);
  assert.equal(
    tagged.nodes.some(node => node.id === STORAGE),
    false,
    'storage is a tag',
  );
  const places = {
    [STORAGE]: [1700.4, 10] as [number, number],
    [INPUT]: [15, 40] as [number, number],
  };
  const placed = placedGraph(tagged, heldSpots(tagged, {}), places);
  assert.deepEqual([box(placed, INPUT).x, box(placed, INPUT).y], [15, 40]);
  assert.equal(
    placed.nodes.some(node => node.id === STORAGE),
    false,
  );
  // What a save sends: every moved place, whole units, the hidden one too.
  const keep = new Set(['ingot']);
  assert.deepEqual(layoutToSave({}, null, keep, true, places), {
    tags: true,
    places: { [STORAGE]: [1700, 10], [INPUT]: [15, 40] },
  });
  assert.equal(layoutToSave({}, { zoom: 1, left: 0, top: 0 }, keep, false, {}), null);
  // Off again, storage is drawn where it was put.
  const lines = placedGraph(graphOf(), heldSpots(graphOf(), {}), places);
  assert.deepEqual([box(lines, STORAGE).x, box(lines, STORAGE).y], [1700.4, 10]);
  // What it gives is what the state keeps, as version 25.
  const state = mutate(
    grouped(),
    arrange('fg-plates1', layoutToSave({}, null, keep, true, places)),
  );
  assert.deepEqual(layoutOf(state)?.places, { [STORAGE]: [1700, 10], [INPUT]: [15, 40] });
  assert.equal(state.version, 25);
});

// Both editions: moved places save the progress state only (version 25), never recalculate the
// plan, survive a reload, a progress backup, a full export and its import, and a share; a reset
// brings the version back.
async function checkEdition(
  request: (route: string, body?: unknown) => Promise<unknown>,
  reload: () => Promise<void>,
) {
  type Context = { plan: StoredCalculatedPlan; state: ProgressState };
  const context = async () => (await request('/api/context')) as Context;
  await request('/api/profiles', { saveName: 'Places world', name: 'Placed', settings: {} });
  const before = await context();
  assert.ok(before.state.version < 25);
  const group = before.state.factoryGroups.groups[0]!.id;
  const layout: GroupLayout = {
    places: { 'in:supply/Iron Ore': [15, 40], 'out:storage': [900, 95] },
  };
  await request('/api/update', arrange(group, layout));
  await reload();
  const after = await context();
  assert.deepEqual(after.plan, before.plan, 'the stored plan is not recalculated');
  assert.equal(after.state.version, 25);
  assert.deepEqual(layoutOf(after.state, group), layout);
  assert.deepEqual(after.state.checks, before.state.checks, 'no progress changed');
  const backup = (await request('/api/export')) as { state: unknown };
  assert.deepEqual(layoutOf(validateState(backup.state), group), layout);
  const exported = (await request('/api/export-saves')) as SaveExport;
  const carried = validateTransfer(exported).saves[0]!.profiles[0]!.state;
  assert.equal(carried.version, 25);
  assert.deepEqual(layoutOf(validateState(carried), group), layout);
  const save = exported.saves[0]!,
    profile = save.profiles[0]!;
  const share = (await request(
    `/api/export-saves?save=${save.id}&profile=${profile.id}&share=1`,
  )) as SaveExport;
  assert.deepEqual(layoutOf(validateState(share.saves[0]!.profiles[0]!.state), group), layout);
  // Reset, then the backup puts it back.
  await request('/api/update', arrange(group, null));
  await reload();
  const cleared = await context();
  assert.ok(cleared.state.version < 22, 'version ' + cleared.state.version);
  await request('/api/import', backup);
  await reload();
  assert.deepEqual(layoutOf((await context()).state, group), layout, 'the backup restores it');
  // A version-24 save imports as it was, its spots unchanged.
  const old: SaveExport = {
    format: 'satisfactory-planner-saves',
    version: 1,
    exportedAt: '2026-10-24T10:00:00.000Z',
    saves: [
      {
        id: 'old',
        name: 'Old world',
        activeProfile: 'v24',
        profiles: [{ ...profile, id: 'v24', name: 'Version 24', state: json(version24) }],
      },
    ],
  };
  await request('/api/import-saves', old);
  await reload();
  const all = (await request('/api/export-saves')) as SaveExport;
  const imported = all.saves.find(entry => entry.name.startsWith('Old world'))!;
  const got = validateState(imported.profiles[0]!.state);
  assert.equal(got.version, 24);
  assert.deepEqual(got.factoryGroups.groups, validateState(json(version24)).factoryGroups.groups);
}

test('the Docker server keeps moved places in workspace.json', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-graph-places-'));
  let server: Awaited<ReturnType<typeof createApp>> | undefined;
  let url = '';
  const listen = async () => {
    server = await createApp({ dataDir: dir, password: '' });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  };
  const close = () => new Promise<void>(resolve => server!.close(() => resolve()));
  const request = async (route: string, body?: unknown) => {
    const res = await fetch(url + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(res.ok, route + ' ' + res.status + ' ' + (await res.clone().text()));
    return res.json();
  };
  await listen();
  try {
    await checkEdition(request, async () => {
      await close();
      await listen();
    });
    const disk = await fs.readFile(path.join(dir, 'workspace.json'), 'utf8');
    assert.match(disk, /"places":/);
  } finally {
    await close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition keeps moved places in IndexedDB', async () => {
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
  await checkEdition(
    (route, body) => api(route, body === undefined ? undefined : { body: JSON.stringify(body) }),
    async () => {
      api = open();
    },
  );
});
