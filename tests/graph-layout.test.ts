// Flow graph slice 2 (#1224, part of #1201): a factory's flow graph remembers where the user put
// its production lines, its zoom and its scroll offsets, per factory group (groups[].layout, the
// factoryGroupLayout update). A state with a layout is progress state version 22, and only while a
// group has one. The layout is presentation: a share and a new profile carried from it keep it
// (as the factories and their owners), a carry keeps only the spots of lines the new plan has. The
// drawing side is pure arithmetic in public/app/graph-layout.ts: stored spots applied, new lines
// near their links, arrows following, and what a save keeps. Both editions: the Docker server
// (createApp, workspace.json) and the browser edition (createBrowserApi over openBrowserStore).
// The dialog itself is in tests/ui/flow-graph.test.ts.
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
  factoryLineRows,
  GRAPH_NUDGE,
  heldSpots,
  layoutToSave,
  nudgedSpot,
  placedGraph,
} from '../public/app/graph-layout.ts';
import { GRAPH_ZOOM } from '../public/app/graph-view.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { states, version21, version22 } from './types/fixtures.ts';
import type {
  CalcRow,
  FactoryGroups,
  GroupLayout,
  ProgressBackup,
  ProgressState,
  SaveExport,
  StoredCalculatedPlan,
  StoredStage,
  UpdateOp,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const arrange = (id: string, layout: unknown): UpdateOp =>
  ({ type: 'factoryGroupLayout', id, layout }) as UpdateOp;
const grouped = (): ProgressState => {
  let state = initialState();
  state = mutate(state, { type: 'factoryGroupAdd', id: 'fg-plates1', name: 'Plates' });
  state = mutate(state, { type: 'factoryGroupAdd', id: 'fg-motors1', name: 'Motors' });
  return state;
};
const layoutOf = (state: ProgressState, id = 'fg-plates1') =>
  state.factoryGroups.groups.find(group => group.id === id)?.layout;

test('a layout is kept rounded and small, reloads as it was, and an empty one drops it', () => {
  let state = grouped();
  assert.equal(state.version, 3);
  state = mutate(
    state,
    arrange('fg-plates1', { nodes: { plate: [420.4, 95.6] }, zoom: 0.8049, pan: [120.2, 0] }),
  );
  assert.deepEqual(layoutOf(state), { nodes: { plate: [420, 96] }, zoom: 0.8, pan: [120, 0] });
  assert.equal(layoutOf(state, 'fg-motors1'), undefined, 'the other factory keeps none');
  assert.equal(state.version, 22);
  assert.deepEqual(validateState(json(state)), state, 'it loads again as it was');
  // A rename keeps it; the parts that say nothing are left out.
  state = mutate(state, { type: 'factoryGroupRename', id: 'fg-plates1', name: 'Plate works' });
  assert.deepEqual(layoutOf(state)?.nodes, { plate: [420, 96] });
  state = mutate(state, arrange('fg-plates1', { nodes: {}, zoom: 1, pan: [0, 0] }));
  assert.equal(layoutOf(state), undefined, 'natural size at the corner says nothing');
  assert.equal(state.version, 3, 'and the state is what older releases read again');
  state = mutate(state, arrange('fg-plates1', { zoom: 2.5 }));
  assert.deepEqual(layoutOf(state), { zoom: 2.5 });
  state = mutate(state, arrange('fg-plates1', null));
  assert.equal('layout' in state.factoryGroups.groups[0]!, false);
  assert.equal(state.version, 3);
  // Removing the factory takes its layout with it.
  state = mutate(state, arrange('fg-motors1', { nodes: { rotor: [10, 10] } }));
  assert.equal(state.version, 22);
  state = mutate(state, { type: 'factoryGroupRemove', id: 'fg-motors1' });
  assert.equal(state.version, 3);
});

test('a malformed layout is refused, in an update and in a stored state', () => {
  const state = grouped();
  const bad: unknown[] = [
    'left',
    [],
    { nodes: [] },
    { nodes: { 'bad key': [1, 2] } },
    { nodes: { plate: [1] } },
    { nodes: { plate: [1, 2, 3] } },
    { nodes: { plate: ['1', 2] } },
    { nodes: { plate: [-1, 2] } },
    { nodes: { plate: [1, LAYOUT_LIMITS.coordinate + 1] } },
    { nodes: { plate: [Number.NaN, 2] } },
    { nodes: Object.fromEntries(Array.from({ length: 1001 }, (_, i) => ['r' + i, [0, 0]])) },
    { zoom: '1' },
    { zoom: 0.05 },
    { zoom: 3.5 },
    { zoom: Number.POSITIVE_INFINITY },
    { pan: [1, 2, 3] },
    { pan: [-5, 0] },
    { pan: [0, LAYOUT_LIMITS.pan + 1] },
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
  assert.throws(() => mutate(state, arrange('fg-nobody1', { zoom: 2 })), /Unknown factory\./);
  assert.throws(
    () => mutate(state, { type: 'factoryGroupLayout', id: 'fg-plates1' } as UpdateOp),
    /Invalid factory layout\./,
    'an update must say what the layout is',
  );
  // Unknown parts are not kept.
  const extra = mutate(state, arrange('fg-plates1', { zoom: 2, colour: 'red' }));
  assert.deepEqual(layoutOf(extra), { zoom: 2 });
});

test('every released state loads unchanged; version 22 is set only while a layout exists', () => {
  for (const [state, version] of states) {
    const clean = validateState(json(state));
    assert.equal(clean.version, version);
    assert.deepEqual(clean.checks, state.checks);
    if (version < 22)
      assert.ok(
        clean.factoryGroups.groups.every(group => !('layout' in group)),
        'version ' + version,
      );
  }
  const clean = validateState(json(version22));
  assert.deepEqual(clean.factoryGroups.groups, version22.factoryGroups.groups);
  assert.deepEqual(clean.tickedBy, version22.tickedBy, 'and what version 21 added');
  // Without its layout it is the version-21 state it was built on.
  const plain = json(version22);
  delete (plain.factoryGroups.groups[0] as { layout?: unknown }).layout;
  assert.equal(validateState(plain).version, 21);
  assert.deepEqual(validateState(plain), validateState(json(version21)), 'as version 21 has it');
  // Saying less than it holds is marked for what it holds; a higher version gets the update
  // message, so a release before this one refuses a version-22 state the same way.
  assert.equal(validateState({ ...json(version22), version: 3 }).version, 22);
  assert.throws(
    () => validateState({ ...json(version22), version: 24 }),
    /newer planner version\. Update the app to import it\./,
  );
});

test('the zoom a layout keeps is the zoom the graph allows', () => {
  assert.equal(LAYOUT_LIMITS.zoomMin, GRAPH_ZOOM.min);
  assert.equal(LAYOUT_LIMITS.zoomMax, GRAPH_ZOOM.max);
});

test('a share and a new profile carry the layout; a carry keeps the spots of lines it still has', () => {
  const plan = calculate({ phase: '1', goal: 'timed', hours: 8, multiplier: 1, storage: 'none' });
  const rows = plan.stages['1']!.rows!.map(row => row.id);
  assert.ok(rows.length >= 2);
  const layout: GroupLayout = {
    nodes: { [rows[0]!]: [300, 40], 'gone-line': [10, 10] },
    zoom: 1.5,
    pan: [60, 20],
  };
  const source = mutate(mutate(grouped(), arrange('fg-plates1', layout)), {
    type: 'check',
    key: 'space-elevator-1',
    value: true,
  });
  // A share drops progress, not how the factories are drawn.
  const shared = shareState(source);
  assert.deepEqual(shared.checks, {});
  assert.deepEqual(layoutOf(shared), layout);
  assert.equal(shared.version, 22);
  // A new profile carried from it keeps the layout, without the line its plan does not have.
  const carried = newProfileState(plan, source, plan, undefined, undefined).state;
  assert.deepEqual(layoutOf(carried), { ...layout, nodes: { [rows[0]!]: [300, 40] } });
  assert.equal(carried.version, 22);
  // A layout of lines gone only: the view is still kept.
  const gone = mutate(grouped(), arrange('fg-plates1', { nodes: { 'gone-line': [1, 1] } }));
  const bare = newProfileState(plan, gone, plan, undefined, undefined).state;
  assert.equal(layoutOf(bare), undefined);
  assert.ok(bare.version < 22);
  // Without its plan edits the new profile starts from the default groups, with no layout.
  const fresh = newProfileState(plan, source, plan, { planEdits: false }, undefined).state;
  assert.ok(fresh.factoryGroups.groups.every(group => !group.layout));
});

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
const graphOf = (from: StoredStage = stage): FlowGraph => {
  const flow = groupFlow(from, groups, 'fg-iron', () => '');
  assert.ok(flow);
  return flowGraph(
    flow,
    (_, rate) => `${rate}/min`,
    () => '2 × Constructor',
  );
};
const box = (graph: FlowGraph, id: string): GraphNode => {
  const found = graph.nodes.find(node => node.id === id);
  assert.ok(found, id);
  return found;
};
// The first and last point of a path.
const ends = (path: string) => {
  const points = [...path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(([, x, y]) => [+x!, +y!]);
  return { first: points[0]!, last: points[points.length - 1]! };
};
const overlap = (a: GraphNode, b: GraphNode) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('without a stored spot the graph is the automatic one; with one, the line sits there and its arrows follow', () => {
  const graph = graphOf();
  const before = json(graph);
  assert.equal(placedGraph(graph, undefined), graph);
  assert.equal(placedGraph(graph, {}), graph);
  assert.equal(placedGraph(graph, { 'not-here': [5, 5] }), graph, 'a spot of no line here');
  // The first move holds every other line where it is, so only the moved line moves.
  const held = heldSpots(graph, {});
  assert.deepEqual(Object.keys(held).sort(), ['ingot', 'plate', 'rod', 'screw']);
  assert.deepEqual(held.plate, [box(graph, 'line:plate').x, box(graph, 'line:plate').y]);
  assert.deepEqual(heldSpots(graph, { rod: [1, 2] }).rod, [1, 2], 'a spot it has stays');
  const placed = placedGraph(graph, { ...held, rod: [700, 400] });
  assert.deepEqual(json(graph), before, 'the automatic graph is not changed');
  const rod = box(placed, 'line:rod');
  assert.deepEqual([rod.x, rod.y], [700, 400]);
  // The other boxes stay where flowGraph put them, in the same order (the tab order).
  assert.deepEqual(
    placed.nodes.map(node => node.id),
    graph.nodes.map(node => node.id),
  );
  for (const node of placed.nodes)
    if (node.id !== 'line:rod')
      assert.deepEqual([node.x, node.y], [box(graph, node.id).x, box(graph, node.id).y], node.id);
  // Each arrow into the rod line ends on its left side, each out of it starts on its right side.
  for (const edge of placed.edges) {
    if (!edge.path) continue;
    const { first, last } = ends(edge.path);
    const from = box(placed, edge.from),
      to = box(placed, edge.to);
    assert.equal(first[0], from.x + from.width, edge.id);
    assert.ok(first[1]! >= from.y && first[1]! <= from.y + from.height, edge.id);
    assert.equal(last[0], to.x, edge.id);
    assert.ok(last[1]! >= to.y && last[1]! <= to.y + to.height, edge.id);
    // Its label sits inside the drawing.
    assert.ok(edge.label, edge.id);
    assert.ok(edge.label.x - edge.label.width / 2 >= 0 && edge.label.x <= placed.width);
  }
  // The edges are the same flows, in the same order, with the same words.
  assert.deepEqual(
    placed.edges.map(edge => [edge.id, edge.from, edge.to, edge.rateText]),
    graph.edges.map(edge => [edge.id, edge.from, edge.to, edge.rateText]),
  );
  // The drawing grows to hold the moved box.
  assert.ok(placed.width >= 700 + rod.width && placed.height >= 400 + rod.height);
});

test('a line new to the plan sits near the lines it is linked to, on no other box', () => {
  // The screw line is new: the stored spots are of the other lines, all moved 300 down.
  const graph = graphOf();
  const spots = Object.fromEntries(
    ['ingot', 'plate', 'rod'].map(id => {
      const node = box(graph, 'line:' + id);
      return [id, [node.x, node.y + 300] as [number, number]];
    }),
  );
  const placed = placedGraph(graph, spots);
  const screw = box(placed, 'line:screw'),
    automatic = box(graph, 'line:screw');
  // Its one link in is from the rod line, moved 300 down, so it moves 300 down too.
  assert.equal(screw.x, automatic.x);
  assert.equal(screw.y, automatic.y + 300);
  for (const node of placed.nodes)
    if (node.id !== screw.id) assert.equal(overlap(node, screw), false, node.id);
  // A new line whose spot is taken goes below the box there.
  const rod = box(graph, 'line:rod');
  const taken = placedGraph(graph, { ingot: [automatic.x, automatic.y], rod: [rod.x, rod.y] });
  const moved = box(taken, 'line:screw');
  assert.equal(moved.x, automatic.x);
  assert.ok(moved.y > automatic.y, 'pushed down past the box on its spot');
  for (const node of taken.nodes)
    if (node.id !== moved.id) assert.equal(overlap(node, moved), false, node.id);
});

test('a save keeps whole spots of the factory’s lines in any phase, and the view that says something', () => {
  // The rod line is in the factory in another phase only; the old line in none.
  const other: StoredStage = { feasible: true, rows: [row('rod', { Ingot: 30 }, { Rod: 30 })] };
  const later: StoredStage = { feasible: true, rows: [row('elsewhere', { Ore: 1 }, { Ingot: 1 })] };
  const keep = factoryLineRows(
    [[stage.rows![0]!, stage.rows![1]!], other.rows!, later.rows!],
    groups,
    'fg-iron',
  );
  assert.deepEqual([...keep].sort(), ['ingot', 'plate', 'rod']);
  const spots = { ingot: [10.4, 20.6], rod: [700, 400], 'old-line': [5, 5] } as const;
  assert.deepEqual(layoutToSave(spots, { zoom: 1.256, left: 40.4, top: 0 }, keep), {
    nodes: { ingot: [10, 21], rod: [700, 400] },
    zoom: 1.26,
    pan: [40, 0],
  });
  assert.deepEqual(layoutToSave(spots, { zoom: 1, left: 0, top: 0 }, keep), {
    nodes: { ingot: [10, 21], rod: [700, 400] },
  });
  assert.deepEqual(layoutToSave({}, { zoom: 0.5, left: 0, top: 9 }, keep), {
    zoom: 0.5,
    pan: [0, 9],
  });
  assert.equal(layoutToSave({ 'old-line': [5, 5] }, { zoom: 1, left: 0, top: 0 }, keep), null);
  assert.equal(layoutToSave({}, null, keep), null);
  // What it gives is what the state keeps.
  const state = mutate(
    grouped(),
    arrange('fg-plates1', layoutToSave(spots, { zoom: 1.256, left: 40.4, top: 0 }, keep)),
  );
  assert.deepEqual(layoutOf(state), {
    nodes: { ingot: [10, 21], rod: [700, 400] },
    zoom: 1.26,
    pan: [40, 0],
  });
});

test('an arrow key nudges a spot, Shift by a bigger step, never past the drawing’s edge', () => {
  assert.deepEqual(nudgedSpot([100, 100], 'ArrowRight', false), [100 + GRAPH_NUDGE.step, 100]);
  assert.deepEqual(nudgedSpot([100, 100], 'ArrowLeft', false), [100 - GRAPH_NUDGE.step, 100]);
  assert.deepEqual(nudgedSpot([100, 100], 'ArrowDown', true), [100, 100 + GRAPH_NUDGE.big]);
  assert.deepEqual(nudgedSpot([100, 100], 'ArrowUp', true), [100, 100 - GRAPH_NUDGE.big]);
  assert.deepEqual(nudgedSpot([4, 3], 'ArrowUp', false), [4, 0]);
  assert.deepEqual(nudgedSpot([4, 3], 'ArrowLeft', true), [0, 3]);
  assert.equal(nudgedSpot([4, 3], 'Enter', false), null);
  assert.ok(GRAPH_NUDGE.big > GRAPH_NUDGE.step);
});

// Both editions: a layout saves the progress state only (version 22), never recalculates the
// plan, survives a reload, a progress backup, a full export and its import, and a share; old saves
// import unchanged; clearing it brings the version back.
async function checkEdition(
  request: (route: string, body?: unknown) => Promise<unknown>,
  reload: () => Promise<void>,
) {
  type Context = { plan: StoredCalculatedPlan; state: ProgressState };
  const context = async () => (await request('/api/context')) as Context;
  await request('/api/profiles', { saveName: 'Layout world', name: 'Arranged', settings: {} });
  const before = await context();
  assert.ok(before.state.version < 22);
  const group = before.state.factoryGroups.groups[0]!.id;
  const phase = before.state.settings.phase as '3';
  const line = before.plan.stages[phase]!.rows![0]!.id;
  const layout: GroupLayout = { nodes: { [line]: [512, 128] }, zoom: 0.64, pan: [30, 12] };
  await request('/api/update', arrange(group, layout));
  await reload();
  const after = await context();
  assert.deepEqual(after.plan, before.plan, 'the stored plan is not recalculated');
  assert.equal(after.state.version, 22);
  const layouts = (state: { factoryGroups?: { groups?: { id: string; layout?: unknown }[] } }) =>
    Object.fromEntries(
      (state.factoryGroups?.groups || [])
        .filter(entry => entry.layout)
        .map(entry => [entry.id, entry.layout]),
    );
  assert.deepEqual(layouts(after.state), { [group]: layout });
  assert.deepEqual(after.state.checks, before.state.checks, 'no progress changed');
  // The progress backup and a full export carry it and pass the import's check.
  const backup = (await request('/api/export')) as ProgressBackup;
  assert.deepEqual(layouts(validateState(backup.state)), { [group]: layout });
  const exported = (await request('/api/export-saves')) as SaveExport;
  const carried = validateTransfer(exported).saves[0]!.profiles[0]!.state;
  assert.equal(carried.version, 22);
  assert.deepEqual(layouts(carried), { [group]: layout });
  const save = exported.saves[0]!,
    profile = save.profiles[0]!;
  // A share keeps how the factories are drawn, not the progress.
  const share = (await request(
    `/api/export-saves?save=${save.id}&profile=${profile.id}&share=1`,
  )) as SaveExport;
  assert.deepEqual(layouts(share.saves[0]!.profiles[0]!.state), { [group]: layout });
  // Restoring the backup onto the profile puts it back after it was cleared.
  await request('/api/update', arrange(group, null));
  assert.deepEqual(layouts((await context()).state), {});
  await request('/api/import', backup);
  await reload();
  assert.deepEqual(layouts((await context()).state), { [group]: layout }, 'the backup restores it');
  // Saves from before (versions 1, 3, 20 and 21) and a version-22 one import as they were.
  const old: SaveExport = {
    format: 'satisfactory-planner-saves',
    version: 1,
    exportedAt: '2026-10-23T10:00:00.000Z',
    saves: [
      {
        id: 'old',
        name: 'Old world',
        activeProfile: 'v1-0',
        profiles: [
          ...states
            .filter(([, version]) => [1, 3, 20, 21, 22].includes(version))
            .map(([state, version], i) => ({
              ...profile,
              id: 'v' + version + '-' + i,
              name: 'Version ' + version + ' #' + i,
              state: json(state),
            })),
          { ...profile, id: 'mine', name: 'This copy', state: json(after.state) },
        ],
      },
    ],
  };
  await request('/api/import-saves', old);
  await reload();
  const all = (await request('/api/export-saves')) as SaveExport;
  const imported = all.saves.find(entry => entry.name.startsWith('Old world'))!;
  assert.equal(imported.profiles.length, old.saves[0]!.profiles.length);
  for (const [i, sent] of old.saves[0]!.profiles.entries()) {
    const got = imported.profiles[i]!.state;
    assert.equal(got.version, sent.state.version, sent.name);
    assert.deepEqual(got.checks, sent.state.checks, sent.name);
    assert.deepEqual(
      got.factoryGroups?.groups ?? [],
      sent.state.factoryGroups?.groups ?? [],
      sent.name,
    );
  }
  // Reset: the open profile is readable by older releases again.
  await request('/api/update', arrange(group, null));
  await reload();
  const cleared = await context();
  assert.ok(cleared.state.version < 22, 'version ' + cleared.state.version);
  assert.deepEqual(layouts(cleared.state), {});
}

test('the Docker server keeps a layout in workspace.json and never recalculates', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-graph-layout-'));
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
    // workspace.json holds the imported copies' layouts, once the open profile's is gone.
    const disk = await fs.readFile(path.join(dir, 'workspace.json'), 'utf8');
    assert.equal((disk.match(/"layout":/g) || []).length, 2, 'the version-22 copy and this copy');
  } finally {
    await close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition keeps a layout in IndexedDB and never recalculates', async () => {
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
