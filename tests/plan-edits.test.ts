import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, validateState, mutate, shareState } from '../public/state.ts';
import type { UpdateOp } from '../public/types/index.ts';

test('released version 1 and 2 states validate unchanged and gain empty plan edits and groups', () => {
  const savedV1 = {
    version: 1,
    revision: 2,
    checks: { 'phase-3-iron': true },
    notes: {},
    deliveries: {},
    settings: { phase: '3' },
    customTasks: [],
  };
  const cleanV1 = validateState(structuredClone(savedV1));
  assert.equal(cleanV1.version, 1);
  assert.deepEqual(cleanV1.taskEdits, {
    order: {},
    removed: [],
    titles: {},
    bodies: {},
    links: {},
  });
  assert.deepEqual(cleanV1.factoryGroups, { groups: [], assignments: {} });
  const savedV2 = {
    ...structuredClone(savedV1),
    version: 2,
    storageEdits: { bays: [{ id: 'S', name: 'Overflow', floor: 'ground' }] },
  };
  const cleanV2 = validateState(structuredClone(savedV2));
  assert.equal(cleanV2.version, 2, 'layout edits alone keep the version 2 format');
  assert.deepEqual(cleanV2.checks, savedV1.checks);
});

test('build plan edits round-trip, mark the state version 3 and preserve checkmarks', () => {
  let state = initialState();
  state.settings.phase = '3';
  state = mutate(state, { type: 'check', key: 'phase-3-survey', value: true });
  state = mutate(state, {
    type: 'taskEdit',
    id: 'phase-3-survey',
    title: 'Survey the coast instead',
    body: 'Notes with <detail>',
    link: 'wire',
  });
  state = mutate(state, { type: 'taskRemove', id: 'phase-3-retire-power' });
  state = mutate(state, { type: 'taskOrder', phase: '3', ids: ['phase-3-iron', 'phase-3-survey'] });
  assert.equal(state.version, 3);
  const round = validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(round.version, 3);
  assert.equal(round.taskEdits.titles['phase-3-survey'], 'Survey the coast instead');
  assert.equal(round.taskEdits.bodies['phase-3-survey'], 'Notes with <detail>');
  assert.equal(round.taskEdits.links['phase-3-survey'], 'wire');
  assert.deepEqual(round.taskEdits.removed, ['phase-3-retire-power']);
  assert.deepEqual(round.taskEdits.order['3'], ['phase-3-iron', 'phase-3-survey']);
  assert.equal(round.checks['phase-3-survey'], true, 'renamed steps keep their completion');
  state = mutate(state, { type: 'taskRestore', id: 'phase-3-retire-power' });
  state = mutate(state, { type: 'taskEdit', id: 'phase-3-survey', title: '', body: '', link: '' });
  state = mutate(state, { type: 'taskOrder', phase: '3', ids: [] });
  assert.equal(
    state.version,
    1,
    'reverting every edit keeps the state importable by older planners',
  );
  assert.equal(state.checks['phase-3-survey'], true);
  assert.throws(
    () => validateState({ ...JSON.parse(JSON.stringify(state)), version: 14 }),
    /newer planner version/,
  );
});

test('deleting a personal task cleans its plan edits', () => {
  let state = initialState();
  state = mutate(state, {
    type: 'addTask',
    id: 'custom-abc123',
    title: 'Wire outpost',
    phase: '1',
  });
  state = mutate(state, {
    type: 'taskEdit',
    id: 'custom-abc123',
    title: 'Wire outpost west',
    link: 'wire',
  });
  state = mutate(state, { type: 'taskOrder', phase: '1', ids: ['custom-abc123'] });
  state = mutate(state, { type: 'removeTask', id: 'custom-abc123' });
  assert.equal(state.taskEdits.titles['custom-abc123'], undefined);
  assert.equal(state.taskEdits.links['custom-abc123'], undefined);
  assert.equal(state.taskEdits.order['1'], undefined);
  assert.equal(state.version, 1);
});

test('factory groups support production splits and removal keeps factories and progress', () => {
  let state = initialState();
  state = mutate(state, { type: 'check', key: 'factory-3-wire', value: true });
  state = mutate(state, { type: 'factoryGroupAdd', id: 'fg-cable01', name: 'Cable factory' });
  state = mutate(state, { type: 'factoryGroupAdd', id: 'fg-plates1', name: 'Stitched plates' });
  state = mutate(state, {
    type: 'factoryAssign',
    key: 'wire',
    groups: [{ group: 'fg-cable01', rate: 300 }, { group: 'fg-plates1' }],
  });
  assert.equal(state.version, 3);
  const round = validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(round.factoryGroups.assignments.wire, [
    { group: 'fg-cable01', rate: 300 },
    { group: 'fg-plates1', rate: null },
  ]);
  state = mutate(state, { type: 'factoryGroupRename', id: 'fg-cable01', name: 'Cable hall' });
  assert.equal(state.factoryGroups.groups[0]!.name, 'Cable hall');
  state = mutate(state, { type: 'factoryGroupRemove', id: 'fg-plates1' });
  assert.deepEqual(state.factoryGroups.assignments.wire, [{ group: 'fg-cable01', rate: 300 }]);
  state = mutate(state, { type: 'factoryGroupRemove', id: 'fg-cable01' });
  assert.deepEqual(state.factoryGroups.assignments, {});
  assert.equal(state.checks['factory-3-wire'], true, 'ungrouping never touches progress');
  assert.equal(state.version, 1);
});

test('invalid plan edits and group updates are rejected without corrupting the state', () => {
  const state = initialState();
  const updates: UpdateOp[] = [
    { type: 'taskEdit', id: '__proto__', title: 'x' },
    { type: 'taskEdit', id: 'ok', title: 'x'.repeat(241) },
    // @ts-expect-error: '9' is not a phase; mutate must reject it.
    { type: 'taskOrder', phase: '9', ids: ['a'] },
    { type: 'taskOrder', phase: '3', ids: ['a', 'a'] },
    { type: 'factoryGroupAdd', id: 'not-a-group', name: 'Bad id' },
    { type: 'factoryGroupRename', id: 'fg-nothere1', name: 'Missing' },
    { type: 'factoryAssign', key: 'wire', groups: [{ group: 'fg-nothere1', rate: 1 }] },
  ];
  for (const update of updates)
    assert.throws(() => mutate(structuredClone(state), update), Error, JSON.stringify(update));
  let withGroup = mutate(structuredClone(state), {
    type: 'factoryGroupAdd',
    id: 'fg-abcd12',
    name: 'Hall',
  });
  for (const rate of [0, -5, '12', NaN, Infinity])
    assert.throws(
      () =>
        mutate(structuredClone(withGroup), {
          type: 'factoryAssign',
          key: 'wire',
          // @ts-expect-error: the string rate '12' is invalid input that mutate must reject.
          groups: [{ group: 'fg-abcd12', rate }],
        }),
      Error,
      String(rate),
    );
  const bad = structuredClone(initialState());
  bad.factoryGroups = { groups: [], assignments: { wire: [{ group: 'fg-ghost1', rate: 1 }] } };
  assert.throws(() => validateState(bad), /Invalid factory group assignment/);
});

test('a shared profile keeps plan-shaped content but starts with fresh progress', () => {
  let state = initialState();
  state.settings.phase = '3';
  state = mutate(state, { type: 'check', key: 'factory-3-wire', value: true });
  state = mutate(state, { type: 'note', key: 'global', value: 'My seed' });
  state = mutate(state, { type: 'delivery', key: '3-modular-engine', value: 12 });
  state = mutate(state, { type: 'addTask', id: 'custom-share1', title: 'Shared step', phase: '3' });
  state = mutate(state, { type: 'storageSlotAssign', key: 'S01', name: 'Iron Plate' });
  state = mutate(state, { type: 'factoryGroupAdd', id: 'fg-cable01', name: 'Cable factory' });
  state = mutate(state, { type: 'taskEdit', id: 'phase-3-survey', title: 'Renamed step' });
  const shared = shareState(state);
  assert.deepEqual(shared.checks, {});
  assert.deepEqual(shared.notes, {});
  assert.deepEqual(shared.deliveries, {});
  assert.equal(shared.revision, 0);
  assert.equal(shared.customTasks.length, 1);
  assert.equal(shared.storageEdits.slots.S01, 'Iron Plate');
  assert.equal(shared.factoryGroups.groups[0]!.name, 'Cable factory');
  assert.equal(shared.taskEdits.titles['phase-3-survey'], 'Renamed step');
  assert.equal(shared.settings.phase, '3');
  assert.equal(shared.version, 3);
  assert.deepEqual(
    shareState(initialState()).version,
    1,
    'a share without edits stays importable by older planners',
  );
});

test('an update type no table knows is refused, Object.prototype keys included (#520)', () => {
  for (const type of [
    'toString',
    'constructor',
    '__proto__',
    'hasOwnProperty',
    'Check',
    'checks ',
    '',
    'task',
    'taskRename',
    'factory',
    'factoryGroupPaint',
  ]) {
    assert.throws(
      () => {
        // @ts-expect-error: an update type no release sends
        mutate(initialState(), { type, key: 'a', id: 'a' });
      },
      /Unknown update/,
      type,
    );
  }
  for (const type of [undefined, null, 3, ['check'], { toString: () => 'check' }])
    assert.throws(() => {
      // @ts-expect-error: a type that is not a string
      mutate(initialState(), { type, key: 'a' });
    }, /Unknown update/);
  for (const update of [null, [], 'check', 3])
    assert.throws(() => {
      // @ts-expect-error: an update that is not an object
      mutate(initialState(), update);
    }, /Invalid update/);
});

test('the first choice on a source splits a mines link saved before #231, keeping every choice (#520)', () => {
  const truck = { mode: 'truck' as const, roundTripMin: 4, fuel: 'Packaged Fuel' };
  const train = { mode: 'train' as const, roundTripMin: 9 };
  const ore = 'supply/Iron Ore',
    coal = 'supply/Coal',
    water = 'supply/Water';
  let legacy = mutate(initialState(), {
    type: 'factoryGroupAdd',
    id: 'fg-plates1',
    name: 'Plates',
  });
  legacy = mutate(legacy, { type: 'factoryGroupAdd', id: 'fg-motors1', name: 'Motors' });
  legacy.factoryGroups.links = { 'mines:fg-plates1': truck, [coal + ':fg-plates1']: train };
  // A sibling with a choice of its own keeps it; the others take the old mines choice.
  const split = mutate(structuredClone(legacy), {
    type: 'factoryLinkTransport',
    from: ore,
    to: 'fg-plates1',
    mode: 'train',
    roundTripMin: 12,
    siblings: [ore, coal, water],
  });
  assert.deepEqual(split.factoryGroups.links, {
    [ore + ':fg-plates1']: { mode: 'train', roundTripMin: 12 },
    [coal + ':fg-plates1']: train,
    [water + ':fg-plates1']: truck,
  });
  // Without siblings the old entry still goes.
  const alone = mutate(structuredClone(legacy), {
    type: 'factoryLinkTransport',
    from: ore,
    to: 'fg-plates1',
    mode: 'belt',
  });
  assert.deepEqual(alone.factoryGroups.links, { [coal + ':fg-plates1']: train });
  // A link between two groups, or to another place, leaves the mines link as it is.
  const between = mutate(structuredClone(legacy), {
    type: 'factoryLinkTransport',
    from: 'fg-motors1',
    to: 'fg-plates1',
    mode: 'train',
    roundTripMin: 9,
    siblings: [ore],
  });
  assert.deepEqual(between.factoryGroups.links?.['mines:fg-plates1'], truck);
  assert.deepEqual(between.factoryGroups.links?.[ore + ':fg-plates1'], undefined);
  const elsewhere = mutate(structuredClone(legacy), {
    type: 'factoryLinkTransport',
    from: ore,
    to: 'fg-motors1',
    mode: 'train',
    roundTripMin: 9,
  });
  assert.deepEqual(elsewhere.factoryGroups.links?.['mines:fg-plates1'], truck);
  // Too many or malformed siblings are refused.
  for (const siblings of [Array(201).fill(ore), [ore, 'fg-plates1'], 'supply/Coal'])
    assert.throws(
      () =>
        mutate(structuredClone(legacy), {
          type: 'factoryLinkTransport',
          from: ore,
          to: 'fg-plates1',
          mode: 'belt',
          // @ts-expect-error: a sibling list the page never sends
          siblings,
        }),
      /Invalid factory group link/,
    );
});
