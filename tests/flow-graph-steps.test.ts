// Steps in a factory's flow graph (FG-8, #1345, part of #1323): the columns of the graph are the
// steps of the build order. A line the user drops in the "New step" column, or moves with the
// selection panel's menu, sits in that step at the earliest (groups[].layout.steps, a floor per
// plan row), and a step can be named in place (groups[].layout.stepNames); both are stored with the
// factory's layout and are progress state version 32, only while a group has one. A tested load of
// every released state (none has steps; version 31 loads as it was, byte for byte once validated,
// and gains them only when the user makes one), refusal of malformed steps and of a newer version,
// the step arithmetic (flow-steps.ts), the build order and the graph agreeing on the steps, a
// share and a carry, and both editions (the Docker server and the browser edition, with a
// version-31 save imported as it was). The dialog is in tests/ui/flow-graph-steps.test.ts.
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
import { flowGraph } from '../public/app/flow-graph.ts';
import {
  earliestStep,
  flowFeeds,
  lineSteps,
  movedFloors,
  stepOrder,
} from '../public/app/flow-steps.ts';
import { groupFlow } from '../public/app/group-flow.ts';
import { layoutToSave } from '../public/app/graph-layout.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { states, version30, version31, version32 } from './types/fixtures.ts';
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

test('steps and names are kept trimmed, as version 32 only while a group has one', () => {
  let state = grouped();
  assert.equal(state.version, 3);
  state = mutate(
    state,
    arrange('fg-plates1', {
      steps: { plate: 3, rod: 1, screw: 2 },
      stepNames: { '1': '  Smelting ', '2': '   ', '3': 'Steel' },
    }),
  );
  // Step 1 says nothing, a blank name is the default again.
  assert.deepEqual(layoutOf(state), {
    steps: { plate: 3, screw: 2 },
    stepNames: { '1': 'Smelting', '3': 'Steel' },
  });
  assert.equal(state.version, 32);
  assert.deepEqual(validateState(json(state)), state, 'it loads again as it was');
  // Names alone, steps alone: each is 32; with other layout parts it stays 32.
  state = mutate(state, arrange('fg-plates1', { stepNames: { '2': 'Wire' } }));
  assert.deepEqual(layoutOf(state), { stepNames: { '2': 'Wire' } });
  assert.equal(state.version, 32);
  state = mutate(state, arrange('fg-plates1', { steps: { plate: 4 }, tags: true }));
  assert.equal(state.version, 32);
  // Without them the layout is what the rest needs: tags are 23, nothing is the base version.
  state = mutate(state, arrange('fg-plates1', { steps: {}, stepNames: {}, tags: true }));
  assert.deepEqual(layoutOf(state), { tags: true });
  assert.equal(state.version, 23);
  state = mutate(state, arrange('fg-plates1', { steps: { plate: 2 } }));
  assert.equal(state.version, 32);
  state = mutate(state, arrange('fg-plates1', null));
  assert.equal(state.version, 3, 'reset: the state is what older releases read again');
  // Removing the factory takes them with it.
  state = mutate(state, arrange('fg-plates1', { stepNames: { '1': 'A' } }));
  assert.equal(state.version, 32);
  state = mutate(state, { type: 'factoryGroupRemove', id: 'fg-plates1' });
  assert.ok(state.version < 22, 'version ' + state.version);
});

test('malformed steps and names are refused, in an update and in a stored state', () => {
  const bad: unknown[] = [
    { steps: [] },
    { steps: { plate: 0 } },
    { steps: { plate: -1 } },
    { steps: { plate: 2.5 } },
    { steps: { plate: '3' } },
    { steps: { plate: LAYOUT_LIMITS.stepMax + 1 } },
    { steps: { 'bad key!': 2 } },
    { steps: { __proto__x: 2, constructor: 2 } },
    { stepNames: [] },
    { stepNames: { '0': 'Zero' } },
    { stepNames: { '01': 'Leading zero' } },
    { stepNames: { x: 'Name' } },
    { stepNames: { [LAYOUT_LIMITS.stepMax + 1]: 'Too far' } },
    { stepNames: { '1': 7 } },
    { stepNames: { '1': 'x'.repeat(LAYOUT_LIMITS.stepNameChars + 1) } },
    { stepNames: { '1': null } },
  ];
  for (const layout of bad) {
    assert.throws(
      () => mutate(grouped(), arrange('fg-plates1', layout)),
      /Invalid factory layout/,
      JSON.stringify(layout),
    );
    const stored = json(version31);
    stored.factoryGroups.groups[0] = { ...stored.factoryGroups.groups[0]!, layout } as never;
    assert.throws(() => validateState(stored), /Invalid factory layout/, JSON.stringify(layout));
  }
  // The longest name and the last step are fine.
  const ok = mutate(
    grouped(),
    arrange('fg-plates1', {
      steps: { plate: LAYOUT_LIMITS.stepMax },
      stepNames: { [LAYOUT_LIMITS.stepMax]: 'x'.repeat(LAYOUT_LIMITS.stepNameChars) },
    }),
  );
  assert.equal(ok.version, 32);
});

test('every released state loads unchanged; version 32 only with a step; version 31 reads as it was', () => {
  for (const [state, version] of states) {
    const clean = validateState(json(state));
    assert.equal(clean.version, version, `version ${version}`);
    if (version < 32)
      for (const group of clean.factoryGroups.groups) {
        assert.equal(group.layout?.steps, undefined, `version ${version}`);
        assert.equal(group.layout?.stepNames, undefined, `version ${version}`);
      }
  }
  // The migration from 31: the same state with a step and a name is the version-31 state, whole,
  // plus those two fields and version 32; nothing else changes.
  const before = validateState(json(version31));
  assert.equal(before.version, 31);
  const upgraded = validateState(json(version32));
  assert.equal(upgraded.version, 32);
  assert.deepEqual(layoutOf(upgraded)?.steps, { 'iron-plate': 3 });
  assert.deepEqual(layoutOf(upgraded)?.stepNames, { '1': 'Smelting', '3': 'Plates' });
  const { steps: _steps, stepNames: _names, ...kept } = layoutOf(upgraded)!;
  assert.deepEqual(kept, layoutOf(before), 'the layout it had is as it was');
  const withoutSteps = json(upgraded);
  withoutSteps.factoryGroups.groups[0]!.layout = layoutOf(before)!;
  assert.deepEqual({ ...withoutSteps, version: 31 }, before, 'everything else is as it was');
  assert.deepEqual(validateState(json(upgraded)), upgraded, 'a repeated load changes nothing');
  // A version-31 state that gains a step through the update gains exactly that.
  const moved = mutate(before, arrange('fg-plates1', { ...layoutOf(before), steps: { x: 2 } }));
  assert.equal(moved.version, 32);
  assert.deepEqual(layoutOf(moved), { ...layoutOf(before), steps: { x: 2 } });
  assert.deepEqual(moved.checks, before.checks);
  assert.deepEqual(moved.notes, before.notes);
  // A version-30 planner's older neighbour: 30 reads as it was too.
  assert.equal(validateState(json(version30)).version, 30);
  // A release before this one refuses version 32 with its update message; this one refuses above.
  assert.throws(
    () => validateState({ ...json(version32), version: 33 }),
    /newer planner version\. Update the app to import it\./,
  );
});

test('lineSteps: one step after the latest line feeding it; a floor pushes a line later', () => {
  const ids = ['ingot', 'plate', 'rod', 'screw'];
  const feeds = [
    ['ingot', 'plate'],
    ['ingot', 'rod'],
    ['rod', 'screw'],
  ] as const;
  const steps = (floors = {}) => Object.fromEntries(lineSteps(ids, feeds, floors));
  assert.deepEqual(steps(), { ingot: 1, plate: 2, rod: 2, screw: 3 });
  // Plate pushed to step 3: it sits there, the rest stay.
  assert.deepEqual(steps({ plate: 3 }), { ingot: 1, plate: 3, rod: 2, screw: 3 });
  // A line it feeds follows it.
  assert.deepEqual(steps({ rod: 4 }), { ingot: 1, plate: 2, rod: 3, screw: 4 });
  // A floor below what feeds it changes nothing, and steps nobody sits in are closed up.
  assert.deepEqual(steps({ plate: 1 }), steps());
  assert.deepEqual(steps({ plate: 9 }), { ingot: 1, plate: 4, rod: 2, screw: 3 });
  assert.deepEqual(steps({ plate: 9, screw: 9 }), { ingot: 1, plate: 3, rod: 2, screw: 3 });
  // A link back to a line built later is a loop and counts for nothing.
  assert.deepEqual(Object.fromEntries(lineSteps(['a', 'b'], [['b', 'a']])), { a: 1, b: 1 });
  // The order follows the steps, lines of one step keep theirs; no floor leaves it alone.
  assert.deepEqual(stepOrder(ids, feeds, {}), ids);
  assert.deepEqual(stepOrder(ids, feeds, { plate: 3 }), ['ingot', 'rod', 'plate', 'screw']);
  assert.deepEqual(stepOrder(ids, feeds, { plate: 1 }), ids);
});

test('earliestStep names the line to wait for; movedFloors keeps the steps the user sees', () => {
  const ids = ['ingot', 'plate', 'rod', 'screw'];
  const feeds = [
    ['ingot', 'plate'],
    ['ingot', 'rod'],
    ['rod', 'screw'],
  ] as const;
  const shown = lineSteps(ids, feeds, {});
  assert.deepEqual(earliestStep('ingot', ids, feeds, shown), { step: 1, after: null });
  assert.deepEqual(earliestStep('plate', ids, feeds, shown), { step: 2, after: 'ingot' });
  assert.deepEqual(earliestStep('screw', ids, feeds, shown), { step: 3, after: 'rod' });
  // Two feeders in the same step: the one built last is the one to wait for.
  const both = [
    ['plate', 'screw'],
    ['rod', 'screw'],
  ] as const;
  assert.equal(earliestStep('screw', ids, both, lineSteps(ids, both)).after, 'rod');
  // Moving a line to its own step takes its floor out; elsewhere it gets one.
  assert.deepEqual(movedFloors({}, shown, 'plate', 2, 2), {});
  assert.deepEqual(movedFloors({}, shown, 'plate', 3, 2), { plate: 3 });
  assert.deepEqual(
    movedFloors({ plate: 3 }, lineSteps(ids, feeds, { plate: 3 }), 'plate', 2, 2),
    {},
  );
  // A floor past the step it shows as (steps closed up) comes down to it, so what the user sees as
  // step 3 stays step 3 when another line is moved.
  const gappy = { plate: 9 };
  const seen = lineSteps(ids, feeds, gappy);
  assert.equal(seen.get('plate'), 4);
  assert.deepEqual(movedFloors(gappy, seen, 'screw', 3, 3), { plate: 4 });
  // A floor of a line this phase does not have stays as it was.
  assert.deepEqual(movedFloors({ other: 5 }, shown, 'plate', 3, 2), { other: 5, plate: 3 });
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
const flowOf = (floors?: Record<string, number>) => {
  const flow = groupFlow(
    stage,
    groups,
    'fg-iron',
    () => '',
    undefined,
    undefined,
    undefined,
    floors,
  );
  assert.ok(flow);
  return flow;
};
const graphOf = (floors?: Record<string, number>) =>
  flowGraph(
    flowOf(floors),
    (_, rate) => `${rate}/min`,
    () => '2 × Constructor',
    { steps: floors ?? {} },
  );

test('the build order and the graph follow a pushed line, and agree on every step', () => {
  // Without a floor nothing changes: the same order, numbers and graph as before this feature.
  const plain = flowOf();
  assert.deepEqual(
    plain.lines.map(line => line.id),
    ['ingot', 'plate', 'rod', 'screw'],
  );
  assert.deepEqual(flowOf({}), plain);
  const automatic = flowGraph(
    plain,
    (_, rate) => `${rate}/min`,
    () => '2 × Constructor',
  );
  assert.deepEqual(graphOf(), automatic, 'an empty floor list is the automatic graph');
  assert.deepEqual(
    automatic.columns.map(column => column.step),
    [1, 2, 3],
  );
  // Plate pushed to step 3: it is built after the rod, numbers follow the new order.
  const pushed = flowOf({ plate: 3 });
  assert.deepEqual(
    pushed.lines.map(line => [line.id, line.no]),
    [
      ['ingot', 1],
      ['rod', 2],
      ['plate', 3],
      ['screw', 4],
    ],
  );
  const graph = graphOf({ plate: 3 });
  const layer = (id: string) => graph.nodes.find(node => node.id === 'line:' + id)!.layer;
  // The graph's layers, from the input column's layer 1, are the steps the build order reads.
  const steps = lineSteps(
    pushed.lines.map(line => line.id),
    flowFeeds(pushed.lines),
    { plate: 3 },
  );
  for (const [id, step] of steps) assert.equal(layer(id), step, id);
  assert.deepEqual(
    graph.columns.map(column => column.step),
    [1, 2, 3],
  );
  // Every line is in the column of its step, and a line that feeds another sits left of it.
  assert.ok(layer('plate') > layer('rod') - 1);
  for (const edge of graph.edges)
    if (edge.from.startsWith('line:') && edge.to.startsWith('line:') && edge.note === '')
      assert.ok(layer(edge.to.slice(5)) > layer(edge.from.slice(5)), edge.id);
  // What was a link back is none now: a line that fed an earlier one is not a loop once it is
  // built first. Here nothing loops, in either order.
  assert.ok(
    pushed.lines.every(line => line.inputs.every(input => input.links.every(link => !link.loop))),
  );
  // A step nobody would sit in is closed up: a floor far past the end is one step after.
  assert.deepEqual(
    graphOf({ plate: 9 }).columns.map(column => column.step),
    [1, 2, 3, 4],
  );
});

test('a save keeps the pushed lines of the factory and the names, whole', () => {
  const keep = new Set(['plate', 'rod']);
  const saved = layoutToSave(
    {},
    null,
    keep,
    false,
    {},
    { plate: 3, gone: 4, rod: 1 },
    { '1': ' Smelting ', '2': '' },
  );
  assert.deepEqual(saved, { steps: { plate: 3 }, stepNames: { '1': 'Smelting' } });
  assert.equal(layoutToSave({}, null, keep), null);
  const state = mutate(grouped(), arrange('fg-plates1', saved));
  assert.equal(state.version, 32);
});

test('a share and a new profile carry the steps of lines the plan still has, and the names', () => {
  const plan = calculate({ phase: '1', goal: 'timed', hours: 8, multiplier: 1, storage: 'none' });
  const rows = Object.values(plan.stages).flatMap(stage => stage?.rows ?? []);
  const known = rows[0]!.id;
  const layout: GroupLayout = {
    steps: { [known]: 3, 'a-row-no-plan-has': 2 },
    stepNames: { '1': 'Smelting' },
    zoom: 1.5,
  };
  const source = mutate(grouped(), arrange('fg-plates1', layout));
  assert.equal(source.version, 32);
  const shared = shareState(source);
  assert.deepEqual(layoutOf(shared), layout);
  const carried = newProfileState(plan, source, plan, undefined, undefined).state;
  assert.deepEqual(layoutOf(carried), {
    steps: { [known]: 3 },
    stepNames: { '1': 'Smelting' },
    zoom: 1.5,
  });
  assert.equal(carried.version, 32);
  // A layout that was only steps of rows the plan no longer has is dropped with them, names stay.
  const only = mutate(grouped(), arrange('fg-plates1', { steps: { gone: 2 } }));
  const gone = newProfileState(plan, only, plan, undefined, undefined).state;
  assert.equal(layoutOf(gone), undefined);
  assert.ok(gone.version < 22, 'version ' + gone.version);
});

// Both editions: steps and names save the progress state only (version 32), never recalculate the
// plan, survive a reload, a progress backup, a full export and its import, and a share; a version
// 31 save imports as it was; a reset brings the version back.
async function checkEdition(
  request: (route: string, body?: unknown) => Promise<unknown>,
  reload: () => Promise<void>,
) {
  type Context = { plan: StoredCalculatedPlan; state: ProgressState };
  const context = async () => (await request('/api/context')) as Context;
  await request('/api/profiles', { saveName: 'Steps world', name: 'Stepped', settings: {} });
  const before = await context();
  assert.ok(before.state.version < 32);
  const group = before.state.factoryGroups.groups[0]!.id;
  const layout: GroupLayout = {
    steps: { 'iron-plate': 3 },
    stepNames: { '1': 'Smelting', '3': 'Plates' },
  };
  await request('/api/update', arrange(group, layout));
  await reload();
  const after = await context();
  assert.deepEqual(after.plan, before.plan, 'the stored plan is not recalculated');
  assert.equal(after.state.version, 32);
  assert.deepEqual(layoutOf(after.state, group), layout);
  assert.deepEqual(after.state.checks, before.state.checks, 'no progress changed');
  const backup = (await request('/api/export')) as { state: unknown };
  assert.deepEqual(layoutOf(validateState(backup.state), group), layout);
  const exported = (await request('/api/export-saves')) as SaveExport;
  const carried = validateTransfer(exported).saves[0]!.profiles[0]!.state;
  assert.equal(carried.version, 32);
  assert.deepEqual(layoutOf(validateState(carried), group), layout);
  const save = exported.saves[0]!,
    profile = save.profiles[0]!;
  const share = (await request(
    `/api/export-saves?save=${save.id}&profile=${profile.id}&share=1`,
  )) as SaveExport;
  assert.deepEqual(layoutOf(validateState(share.saves[0]!.profiles[0]!.state), group), layout);
  // The export imports as a new copy that keeps them.
  await request('/api/import-saves', exported);
  await reload();
  const all = (await request('/api/export-saves')) as SaveExport;
  const copy = all.saves.find(entry => entry.id !== save.id)!;
  assert.deepEqual(layoutOf(validateState(copy.profiles[0]!.state), group), layout);
  // Reset, then the backup puts it back.
  await request('/api/update', arrange(group, null));
  await reload();
  const cleared = await context();
  assert.ok(cleared.state.version < 22, 'version ' + cleared.state.version);
  await request('/api/import', backup);
  await reload();
  assert.deepEqual(layoutOf((await context()).state, group), layout, 'the backup restores it');
  // A version-31 save imports as it was, its layout unchanged and no step added.
  const old: SaveExport = {
    format: 'satisfactory-planner-saves',
    version: 1,
    exportedAt: '2026-11-14T10:00:00.000Z',
    saves: [
      {
        id: 'old',
        name: 'Old world',
        activeProfile: 'v31',
        profiles: [{ ...profile, id: 'v31', name: 'Version 31', state: json(version31) }],
      },
    ],
  };
  await request('/api/import-saves', old);
  await reload();
  const everything = (await request('/api/export-saves')) as SaveExport;
  const imported = everything.saves.find(entry => entry.name.startsWith('Old world'))!;
  const got = validateState(imported.profiles[0]!.state);
  assert.equal(got.version, 31);
  assert.deepEqual(got, validateState(json(version31)), 'every part of it is as it was');
}

test('the Docker server keeps steps in workspace.json', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-graph-steps-'));
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
    assert.match(disk, /"stepNames":/);
  } finally {
    await close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition keeps steps in IndexedDB', async () => {
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
