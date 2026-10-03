import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState,
  validateState,
  mutate,
  bayCapacity,
  handbookBay,
  handbookFloor,
  checkBase,
} from '../public/state.ts';
import { STORAGE_ROOM } from '../public/storage-room.ts';
import type { SavedState, UpdateOp } from '../public/types/index.ts';

test('legacy version-1 states validate unchanged, gain empty layout edits and stay version 1', () => {
  const legacy = {
    version: 1,
    revision: 3,
    checks: { 'slot-A01-built': true, 'factory-3-iron': true },
    notes: { global: 'route notes' },
    deliveries: { '3-modular-engine': 50 },
    settings: { phase: '3' },
    customTasks: [{ id: 'custom-a', title: 'Wire station', phase: '3' }],
  };
  const clean = validateState(structuredClone(legacy));
  assert.equal(clean.version, 1);
  assert.equal(clean.revision, 3);
  assert.deepEqual(clean.checks, legacy.checks);
  assert.deepEqual(clean.notes, legacy.notes);
  assert.deepEqual(clean.deliveries, legacy.deliveries);
  assert.deepEqual(clean.customTasks, legacy.customTasks);
  assert.deepEqual(clean.storageEdits, {
    floors: [],
    floorNames: {},
    bays: [],
    bayNames: {},
    slots: {},
    clearedSlots: [],
    hiddenBays: [],
    hiddenFloors: [],
  });
});

test('layout edits round-trip, mark the state version 2 and newer versions are refused', () => {
  let state = initialState();
  state.settings.phase = '3';
  state = mutate(state, { type: 'storageFloorAdd', id: 'cf-abcd12', label: 'Basement overflow' });
  state = mutate(state, { type: 'storageBayAdd', id: 'S', name: 'Overflow', floor: 'cf-abcd12' });
  state = mutate(state, { type: 'storageSlotAssign', key: 'S01', name: 'Iron Plate' });
  state = mutate(state, { type: 'storageBayRename', id: 'S', name: 'Overflow parts' });
  state = mutate(state, { type: 'storageFloorRename', id: 'ground', label: 'Main hall' });
  assert.equal(state.version, 2);
  const round = validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(round.version, 2);
  assert.equal(round.storageEdits.slots.S01, 'Iron Plate');
  assert.equal(round.storageEdits.bayNames.S, 'Overflow parts');
  assert.equal(round.storageEdits.floorNames.ground, 'Main hall');
  assert.equal(round.storageEdits.floors[0]!.label, 'Basement overflow');
  assert.throws(
    () => validateState({ ...JSON.parse(JSON.stringify(state)), version: 14 }),
    /newer planner version/,
  );
});

test('a bay takes containers past its printed eight and marks the state version 4', () => {
  let state = initialState();
  state = mutate(state, { type: 'storageSlotAssign', key: 'A09', name: 'Alclad Aluminum Sheet' });
  state = mutate(state, { type: 'storageSlotAssign', key: 'A12', name: 'Aluminum Casing' });
  state = mutate(state, { type: 'check', key: 'slot-A09-built', value: true });
  assert.equal(state.version, 4, 'an address past 08 is new content older planners must refuse');
  const round = validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(round.version, 4);
  assert.equal(round.storageEdits.slots.A09, 'Alclad Aluminum Sheet');
  assert.equal(round.storageEdits.slots.A12, 'Aluminum Casing');
  assert.throws(
    () => validateState({ ...JSON.parse(JSON.stringify(state)), version: 14 }),
    /newer planner version/,
  );
  // An added position has no handbook container behind it, so clearing one drops
  // the address instead of reserving it, while its progress records stay put.
  state = mutate(state, { type: 'storageSlotClear', key: 'A09' });
  assert.deepEqual(state.storageEdits.clearedSlots, []);
  assert.equal(state.storageEdits.slots.A09, undefined);
  assert.equal(state.checks['slot-A09-built'], true);
  state = mutate(state, { type: 'storageSlotClear', key: 'A12' });
  assert.equal(
    state.version,
    1,
    'a layout back within the printed eight is importable by older planners again',
  );
  assert.throws(
    () =>
      mutate(structuredClone(state), {
        type: 'storageSlotAssign',
        key: 'A' + (bayCapacity + 1),
        name: 'Past the last address',
      }),
    /Invalid container/,
  );
});

test('an added position imported as cleared is dropped rather than reserved', () => {
  const raw = {
    ...initialState(),
    storageEdits: {
      floors: [],
      floorNames: {},
      bays: [],
      bayNames: {},
      slots: { B02: 'Wire' },
      clearedSlots: ['B01', 'B09'],
    },
  };
  const clean = validateState(raw);
  assert.deepEqual(clean.storageEdits.clearedSlots, ['B01']);
  assert.equal(
    clean.version,
    2,
    'nothing past 08 remains, so the state stays readable by older planners',
  );
});

test('clearing and reassigning containers preserves saved checkmarks', () => {
  let state = initialState();
  state = mutate(state, { type: 'check', key: 'slot-G08-built', value: true });
  state = mutate(state, { type: 'storageSlotClear', key: 'G08' });
  state = mutate(state, { type: 'storageSlotClear', key: 'G08' });
  assert.deepEqual(state.storageEdits.clearedSlots, ['G08']);
  assert.equal(state.checks['slot-G08-built'], true);
  state = mutate(state, { type: 'storageSlotAssign', key: 'G08', name: 'Medicinal Inhaler' });
  assert.deepEqual(state.storageEdits.clearedSlots, []);
  assert.equal(state.storageEdits.slots.G08, 'Medicinal Inhaler');
  assert.equal(state.checks['slot-G08-built'], true);
});

test('handbook floors and bays cannot be removed; added ones can', () => {
  let state = initialState();
  assert.throws(
    () => mutate(structuredClone(state), { type: 'storageFloorRemove', id: 'ground' }),
    /added floors/i,
  );
  assert.throws(
    () => mutate(structuredClone(state), { type: 'storageBayRemove', id: 'A' }),
    /added bays/i,
  );
  state = mutate(state, { type: 'storageFloorAdd', id: 'cf-zz99aa', label: 'Attic' });
  state = mutate(state, { type: 'storageBayAdd', id: 'T', name: 'Attic bay', floor: 'cf-zz99aa' });
  assert.throws(
    () => mutate(structuredClone(state), { type: 'storageFloorRemove', id: 'cf-zz99aa' }),
    /bays on this floor/,
  );
  state = mutate(state, { type: 'storageSlotAssign', key: 'T01', name: 'Wire' });
  state = mutate(state, { type: 'check', key: 'slot-T01-built', value: true });
  state = mutate(state, { type: 'storageBayRemove', id: 'T' });
  assert.equal(state.storageEdits.bays.length, 0);
  assert.equal(state.storageEdits.slots.T01, undefined);
  assert.equal(state.checks['slot-T01-built'], undefined, 'the removed bay takes its checks along');
  state = mutate(state, { type: 'storageFloorRemove', id: 'cf-zz99aa' });
  assert.equal(state.storageEdits.floors.length, 0);
  assert.equal(
    state.version,
    1,
    'no remaining edits means the state stays importable by older planners',
  );
});

test('a bay that reuses the letter of a removed bay starts without its checks and notes', () => {
  let state = initialState();
  state = mutate(state, { type: 'storageBayAdd', id: 'T', name: 'Overflow', floor: 'ground' });
  state = mutate(state, { type: 'storageBayAdd', id: 'TA', name: 'Next door', floor: 'ground' });
  for (const address of ['T01', 'T09', 'TA01', 'A01']) {
    state = mutate(state, { type: 'check', key: `slot-${address}-built`, value: true });
    state = mutate(state, { type: 'note', key: `slot-${address}`, value: 'Wire here' });
  }
  state = mutate(state, { type: 'note', key: 'phase-3', value: 'Unrelated' });
  state = mutate(state, { type: 'storageBayRemove', id: 'T' });
  state = mutate(state, {
    type: 'storageBayAdd',
    id: 'T',
    name: 'Overflow again',
    floor: 'ground',
  });
  assert.deepEqual(Object.keys(state.checks).sort(), ['slot-A01-built', 'slot-TA01-built']);
  assert.deepEqual(Object.keys(state.notes).sort(), ['phase-3', 'slot-A01', 'slot-TA01']);
});

test('an added bay cannot take a handbook letter, and removing an old one keeps that bay', () => {
  assert.deepEqual(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(handbookBay),
    STORAGE_ROOM.map(b => b.id),
    'handbookBay matches the printed room',
  );
  let state = initialState();
  assert.throws(
    () =>
      mutate(structuredClone(state), {
        type: 'storageBayAdd',
        id: 'A',
        name: 'x',
        floor: 'ground',
      }),
    /Hide that built-in bay first/,
  );
  // A state saved with one, through a direct request or an edited import, still loads.
  state = validateState({
    ...state,
    storageEdits: {
      bays: [{ id: 'A', name: 'Clash', floor: 'ground' }],
      bayNames: { A: 'Plates' },
      slots: { A01: 'Wire' },
      clearedSlots: ['A02'],
    },
  });
  state = mutate(state, { type: 'check', key: 'slot-A01-built', value: true });
  state = mutate(state, { type: 'note', key: 'slot-A01', value: 'Handbook note' });
  state = mutate(state, { type: 'storageBayRemove', id: 'A' });
  assert.deepEqual(state.storageEdits.bays, []);
  assert.deepEqual(state.storageEdits.bayNames, { A: 'Plates' });
  assert.deepEqual(state.storageEdits.slots, { A01: 'Wire' });
  assert.deepEqual(state.storageEdits.clearedSlots, ['A02']);
  assert.equal(state.checks['slot-A01-built'], true);
  assert.equal(state.notes['slot-A01'], 'Handbook note');
});

test('invalid layout updates are rejected without corrupting the state', () => {
  const state = initialState();
  const updates: UpdateOp[] = [
    { type: 'storageFloorAdd', id: 'ground', label: 'Nope' },
    { type: 'storageFloorAdd', id: 'cf-x', label: 'Too short id' },
    { type: 'storageBayAdd', id: 'abc', name: 'Bad letter', floor: 'ground' },
    { type: 'storageBayAdd', id: 'S', name: 'Ghost floor', floor: 'cf-000000' },
    { type: 'storageSlotAssign', key: 'S00', name: 'Bad address' },
    { type: 'storageSlotAssign', key: 'S100', name: 'Bad address' },
    { type: 'storageSlotAssign', key: 'S9', name: 'Bad address' },
    { type: 'storageSlotAssign', key: 'S01', name: '' },
    { type: 'storageSlotClear', key: '__proto__' },
    { type: 'storageFloorRename', id: 'cf-nothere1', label: 'Missing' },
  ];
  for (const update of updates)
    assert.throws(() => mutate(structuredClone(state), update), Error, JSON.stringify(update));
  const bad: SavedState = structuredClone(initialState());
  bad.storageEdits = {
    bays: [
      { id: 'S', name: 'x', floor: 'ground' },
      { id: 'S', name: 'dup', floor: 'ground' },
    ],
  };
  assert.throws(() => validateState(bad), /Invalid storage bay/);
});

test('a handbook bay can be hidden and restored, keeping every record, as version 5 (#166)', () => {
  let state = initialState();
  state = mutate(state, { type: 'check', key: 'slot-C01-built', value: true });
  state = mutate(state, { type: 'note', key: 'slot-C01', value: 'Left of the lift' });
  state = mutate(state, { type: 'storageBayRename', id: 'C', name: 'Copper bay' });
  state = mutate(state, { type: 'storageSlotAssign', key: 'C02', name: 'Wire' });
  const before = structuredClone(state);
  state = mutate(state, { type: 'storageBayHide', id: 'C' });
  state = mutate(state, { type: 'storageBayHide', id: 'C' });
  assert.deepEqual(state.storageEdits.hiddenBays, ['C'], 'hiding twice lists it once');
  assert.equal(state.version, 5, 'older planners must refuse it rather than show the bay again');
  // Nothing of the bay's own is touched.
  assert.deepEqual(state.checks, before.checks);
  assert.deepEqual(state.notes, before.notes);
  assert.equal(state.storageEdits.bayNames.C, 'Copper bay');
  assert.equal(state.storageEdits.slots.C02, 'Wire');
  const round = validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(round.storageEdits.hiddenBays, ['C']);
  assert.equal(round.version, 5);
  assert.throws(
    () => validateState({ ...JSON.parse(JSON.stringify(state)), version: 14 }),
    /newer planner version/,
  );
  // Restoring brings back exactly what was there, at the version the rest needs.
  state = mutate(state, { type: 'storageBayRestore', id: 'C' });
  assert.deepEqual(state.storageEdits, before.storageEdits);
  assert.equal(state.version, before.version);
  // Only handbook letters can be hidden; an added bay is removed instead.
  assert.throws(() => mutate(state, { type: 'storageBayHide', id: 'S' }), /Only built-in bays/);
  assert.throws(
    () => mutate(state, { type: 'storageBayRemove', id: 'C' }),
    /Hide a built-in bay instead; its progress is kept/,
  );
});

test('a malformed hidden-bay list is refused and leaves nothing changed', () => {
  const state = mutate(initialState(), { type: 'storageBayHide', id: 'A' });
  for (const hiddenBays of ['A', ['S'], ['a'], [1], Array.from({ length: 19 }, () => 'A')])
    assert.throws(
      () =>
        validateState({
          ...structuredClone(state),
          storageEdits: { ...state.storageEdits, hiddenBays },
        }),
      /Invalid hidden storage bays/,
      JSON.stringify(hiddenBays),
    );
});

test('a built-in floor can be hidden once empty and restored, as version 6 (#168)', () => {
  let state = initialState();
  state = mutate(state, { type: 'storageFloorHide', id: 'workshop' });
  state = mutate(state, { type: 'storageFloorHide', id: 'workshop' });
  assert.deepEqual(state.storageEdits.hiddenFloors, ['workshop']);
  assert.equal(state.version, 6, 'a version-5 planner must refuse it rather than show the floor');
  const round = validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(round.storageEdits.hiddenFloors, ['workshop']);
  assert.throws(
    () => validateState({ ...JSON.parse(JSON.stringify(state)), version: 14 }),
    /newer planner version/,
  );
  state = mutate(state, { type: 'storageFloorRestore', id: 'workshop' });
  assert.deepEqual(state.storageEdits.hiddenFloors, []);
  assert.equal(state.version, 1);
  // An added floor is removed, not hidden; a floor with added bays keeps them in reach.
  assert.throws(
    () => mutate(state, { type: 'storageFloorHide', id: 'cf-abcd12' }),
    /Only built-in/,
  );
  state = mutate(state, { type: 'storageBayAdd', id: 'S', name: 'Extra', floor: 'upper' });
  assert.throws(
    () => mutate(state, { type: 'storageFloorHide', id: 'upper' }),
    /bays on this floor/,
  );
  // At least one floor stays: all three built-ins only with an added floor, which then stays.
  state = mutate(state, { type: 'storageBayRemove', id: 'S' });
  state = mutate(state, { type: 'storageFloorHide', id: 'ground' });
  state = mutate(state, { type: 'storageFloorHide', id: 'upper' });
  assert.throws(
    () => mutate(state, { type: 'storageFloorHide', id: 'workshop' }),
    /at least one floor/,
  );
  state = mutate(state, { type: 'storageFloorAdd', id: 'cf-abcd12', label: 'Basement' });
  state = mutate(state, { type: 'storageFloorHide', id: 'workshop' });
  assert.deepEqual(state.storageEdits.hiddenFloors, ['ground', 'upper', 'workshop']);
  assert.throws(
    () => mutate(state, { type: 'storageFloorRemove', id: 'cf-abcd12' }),
    /at least one floor/,
  );
});

test('a malformed hidden-floor list is refused', () => {
  const state = mutate(initialState(), { type: 'storageFloorHide', id: 'workshop' });
  for (const hiddenFloors of ['workshop', ['attic'], [1], ['ground', 'upper', 'workshop']])
    assert.throws(
      () =>
        validateState({
          ...structuredClone(state),
          storageEdits: { ...state.storageEdits, hiddenFloors },
        }),
      /Invalid hidden storage floors/,
      JSON.stringify(hiddenFloors),
    );
});

test('an added bay can take a hidden handbook letter, clearing that bay first (#167)', () => {
  let state = initialState();
  state = mutate(state, { type: 'check', key: 'slot-C01-built', value: true });
  state = mutate(state, { type: 'note', key: 'slot-C01', value: 'Old copper' });
  state = mutate(state, { type: 'storageBayRename', id: 'C', name: 'Copper bay' });
  state = mutate(state, { type: 'storageSlotAssign', key: 'C02', name: 'Wire' });
  state = mutate(state, { type: 'check', key: 'slot-D01-built', value: true });
  const add = { type: 'storageBayAdd', id: 'C', name: 'My parts', floor: 'ground' } as const;
  // In the room: refused. Hidden: refused until the replacement is confirmed.
  assert.throws(() => mutate(structuredClone(state), add), /Bay C is in the room/);
  state = mutate(state, { type: 'storageBayHide', id: 'C' });
  assert.throws(() => mutate(structuredClone(state), add), /still has saved progress/);
  const kept = structuredClone(state);
  state = mutate(state, { ...add, replace: true });
  assert.deepEqual(state.storageEdits.bays, [{ id: 'C', name: 'My parts', floor: 'ground' }]);
  assert.equal(state.checks['slot-C01-built'], undefined, 'the hidden bay’s records are cleared');
  assert.equal(state.notes['slot-C01'], undefined);
  assert.equal(state.storageEdits.bayNames.C, undefined);
  assert.equal(state.storageEdits.slots.C02, undefined);
  assert.equal(state.checks['slot-D01-built'], true, 'other bays keep theirs');
  assert.equal(state.version, 5);
  // The refused attempts changed nothing.
  assert.equal(kept.checks['slot-C01-built'], true);
  // The handbook bay cannot come back while the added bay holds its letter.
  assert.throws(() => mutate(state, { type: 'storageBayRestore', id: 'C' }), /Remove it before/);
  // The added bay's own records go with it (#51), and then the letter can be restored.
  state = mutate(state, { type: 'check', key: 'slot-C01-built', value: true });
  state = mutate(state, { type: 'storageBayRemove', id: 'C' });
  assert.equal(state.checks['slot-C01-built'], undefined);
  state = mutate(state, { type: 'storageBayRestore', id: 'C' });
  assert.deepEqual(state.storageEdits.hiddenBays, []);
  // A letter taken twice is refused with a clear reason.
  state = mutate(state, { type: 'storageBayAdd', id: 'S', name: 'Extra', floor: 'ground' });
  assert.throws(
    () => mutate(state, { type: 'storageBayAdd', id: 'S', name: 'Again', floor: 'ground' }),
    /Bay S already exists/,
  );
});

test('a handbook bay sharing its letter with a pre-#91 added bay is not hidden, so removing that bay keeps its records', () => {
  // Before #91 an added bay could be stored under a handbook letter; it shares that bay's
  // addresses, checks and notes.
  let state = validateState({
    ...initialState(),
    version: 2,
    checks: { 'slot-C01-built': true },
    notes: { 'slot-C01': 'Handbook copper' },
    storageEdits: {
      floors: [],
      floorNames: {},
      bays: [{ id: 'C', name: 'Old added C', floor: 'ground' }],
      bayNames: {},
      slots: {},
      clearedSlots: [],
    },
  });
  const before = structuredClone(state);
  assert.throws(
    () => mutate(structuredClone(state), { type: 'storageBayHide', id: 'C' }),
    /An added bay uses the letter C. Remove it before hiding/,
  );
  // Removing the old added bay removes only its entry, as it always has.
  state = mutate(state, { type: 'storageBayRemove', id: 'C' });
  assert.deepEqual(state.storageEdits.bays, []);
  assert.deepEqual(state.checks, before.checks);
  assert.deepEqual(state.notes, before.notes);
  // Then the handbook bay can be hidden, keeping everything.
  state = mutate(state, { type: 'storageBayHide', id: 'C' });
  assert.deepEqual(state.storageEdits.hiddenBays, ['C']);
  assert.equal(state.checks['slot-C01-built'], true);
});

test('any bay can move to another floor with every record, as version 8 when a handbook bay moves (#190)', () => {
  let state = initialState();
  state = mutate(state, { type: 'check', key: 'slot-D01-built', value: true });
  state = mutate(state, { type: 'note', key: 'slot-D01', value: 'By the lift' });
  state = mutate(state, { type: 'storageBayRename', id: 'D', name: 'Control' });
  state = mutate(state, { type: 'storageBayMove', id: 'D', floor: 'upper' });
  assert.deepEqual(state.storageEdits.bayFloors, { D: 'upper' });
  assert.equal(state.version, 8, 'a version-7 planner must refuse it rather than put the bay back');
  assert.equal(state.checks['slot-D01-built'], true, 'the letter, and so every record, stays');
  assert.equal(state.notes['slot-D01'], 'By the lift');
  assert.equal(state.storageEdits.bayNames.D, 'Control');
  const round = validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(round.storageEdits.bayFloors, { D: 'upper' });
  assert.throws(() => validateState({ ...round, version: 14 }), /newer planner version/);
  // The floor it moved to counts it: upper cannot be hidden, an added floor not removed.
  assert.throws(
    () => mutate(state, { type: 'storageFloorHide', id: 'upper' }),
    /bays on this floor/,
  );
  state = mutate(state, { type: 'storageFloorAdd', id: 'cf-base01', label: 'Basement' });
  state = mutate(state, { type: 'storageBayMove', id: 'J', floor: 'cf-base01' });
  assert.throws(
    () => mutate(state, { type: 'storageFloorRemove', id: 'cf-base01' }),
    /bays on this floor/,
  );
  // Back on its own floor it has not moved; with no moves left the version drops again.
  state = mutate(state, { type: 'storageBayMove', id: 'J', floor: 'upper' });
  state = mutate(state, { type: 'storageBayMove', id: 'D', floor: 'ground' });
  assert.equal(state.storageEdits.bayFloors, undefined);
  assert.equal(state.version, 2);
  // An added bay moves by its own floor.
  state = mutate(state, { type: 'storageBayAdd', id: 'S', name: 'Extra', floor: 'ground' });
  state = mutate(state, { type: 'storageBayMove', id: 'S', floor: 'cf-base01' });
  assert.equal(state.storageEdits.bays.find(b => b.id === 'S')!.floor, 'cf-base01');
  assert.equal(state.storageEdits.bayFloors, undefined);
});

test('a bay move to a missing or hidden floor, or of an unknown bay, is refused', () => {
  let state = mutate(initialState(), { type: 'storageFloorHide', id: 'workshop' });
  for (const [update, why] of [
    [{ type: 'storageBayMove', id: 'D', floor: 'attic' }, /Unknown floor/],
    [{ type: 'storageBayMove', id: 'D', floor: 'cf-none01' }, /Unknown floor/],
    [{ type: 'storageBayMove', id: 'D', floor: 'workshop' }, /Restore that floor/],
    [{ type: 'storageBayMove', id: 'ZZ', floor: 'upper' }, /Unknown bay/],
    [{ type: 'storageBayMove', id: 'd', floor: 'upper' }, /Invalid bay/],
  ] as [UpdateOp, RegExp][])
    assert.throws(() => mutate(structuredClone(state), update), why, JSON.stringify(update));
  for (const bayFloors of [[], { S: 'upper' }, { D: 'attic' }, { D: 'cf-none01' }, { D: 1 }])
    assert.throws(
      () => validateState({ ...state, storageEdits: { ...state.storageEdits, bayFloors } }),
      /Invalid storage bay floors/,
      JSON.stringify(bayFloors),
    );
  // A bay taking a hidden handbook letter (#167) starts on its own floor, not the old bay's.
  state = mutate(initialState(), { type: 'storageBayMove', id: 'C', floor: 'upper' });
  state = mutate(state, { type: 'storageBayHide', id: 'C' });
  state = mutate(state, {
    type: 'storageBayAdd',
    id: 'C',
    name: 'Mine',
    floor: 'ground',
    replace: true,
  });
  assert.equal(state.storageEdits.bayFloors, undefined);
});

test("handbookFloor matches every printed bay's floor (storage-room.ts, #388)", () => {
  for (const bay of STORAGE_ROOM) assert.equal(handbookFloor(bay.id), bay.floor, bay.id);
});

test('the bays on a floor can be put in order, as version 10, without touching any record (#191)', () => {
  let state = initialState();
  state = mutate(state, { type: 'check', key: 'slot-B01-built', value: true });
  state = mutate(state, { type: 'storageBayOrder', floor: 'ground', order: ['B', 'A', 'C'] });
  assert.deepEqual(state.storageEdits.bayOrder, { ground: ['B', 'A', 'C'] });
  assert.equal(state.version, 10, 'a version-9 planner must refuse it rather than drop the order');
  assert.equal(state.checks['slot-B01-built'], true);
  const round = validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(round.storageEdits.bayOrder, { ground: ['B', 'A', 'C'] });
  assert.equal(round.version, 10);
  assert.throws(() => validateState({ ...round, version: 14 }), /newer planner version/);
  // Without the field nothing changes: the layout keeps its old shape and version.
  const plain = mutate(initialState(), { type: 'storageBayRename', id: 'A', name: 'Front' });
  assert.equal('bayOrder' in plain.storageEdits, false);
  assert.equal(plain.version, 2);
  // A bay moved to another floor leaves the old floor's order and joins the new one at its
  // default place; ordering the new floor may then list it.
  state = mutate(state, { type: 'storageBayMove', id: 'B', floor: 'upper' });
  assert.deepEqual(state.storageEdits.bayOrder, { ground: ['A', 'C'] });
  state = mutate(state, { type: 'storageBayOrder', floor: 'upper', order: ['B', 'J', 'I'] });
  assert.deepEqual(state.storageEdits.bayOrder!.upper, ['B', 'J', 'I']);
  // An added bay removed leaves every order; a removed floor takes its order with it.
  state = mutate(state, { type: 'storageFloorAdd', id: 'cf-base01', label: 'Basement' });
  state = mutate(state, { type: 'storageBayAdd', id: 'S', name: 'Extra', floor: 'cf-base01' });
  state = mutate(state, { type: 'storageBayAdd', id: 'T', name: 'More', floor: 'cf-base01' });
  state = mutate(state, { type: 'storageBayOrder', floor: 'cf-base01', order: ['T', 'S'] });
  state = mutate(state, { type: 'storageBayRemove', id: 'T' });
  assert.deepEqual(state.storageEdits.bayOrder!['cf-base01'], ['S']);
  state = mutate(state, { type: 'storageBayMove', id: 'S', floor: 'ground' });
  assert.equal(state.storageEdits.bayOrder!['cf-base01'], undefined);
  state = mutate(state, { type: 'storageFloorRemove', id: 'cf-base01' });
  // A hidden bay keeps its place, so restoring it puts it back where it was.
  state = mutate(state, { type: 'storageBayHide', id: 'C' });
  assert.deepEqual(state.storageEdits.bayOrder!.ground, ['A', 'C']);
  // Clearing a floor's order (an empty list) drops the field, and the version with it.
  state = mutate(state, { type: 'storageBayOrder', floor: 'ground', order: [] });
  state = mutate(state, { type: 'storageBayOrder', floor: 'upper', order: [] });
  assert.equal(state.storageEdits.bayOrder, undefined);
  assert.equal(state.version, 8, 'B is still moved');
});

test('a bay order with unknown floors, bays elsewhere or bad letters is refused (#191)', () => {
  const state = mutate(initialState(), {
    type: 'storageFloorAdd',
    id: 'cf-base01',
    label: 'Basement',
  });
  for (const [update, why] of [
    [{ type: 'storageBayOrder', floor: 'attic', order: ['A'] }, /Unknown floor/],
    [{ type: 'storageBayOrder', floor: 'ground', order: ['A', 'I'] }, /Only bays on this floor/],
    [{ type: 'storageBayOrder', floor: 'ground', order: ['A', 'A'] }, /Invalid bay order/],
    [{ type: 'storageBayOrder', floor: 'ground', order: ['a'] }, /Invalid bay order/],
    [{ type: 'storageBayOrder', floor: 'ground', order: 'AB' }, /Invalid bay order/],
    [{ type: 'storageBayOrder', floor: 'cf-base01', order: ['S'] }, /Only bays on this floor/],
  ] satisfies [unknown, RegExp][]) {
    // @ts-expect-error: some of these updates are malformed on purpose; mutate must reject them.
    assert.throws(() => mutate(structuredClone(state), update), why, JSON.stringify(update));
  }
  for (const bayOrder of [
    [],
    { attic: ['A'] },
    { ground: 'AB' },
    { ground: ['A', 'A'] },
    { ground: ['a'] },
    { ground: [1] },
  ])
    assert.throws(
      () => validateState({ ...state, storageEdits: { ...state.storageEdits, bayOrder } }),
      /Invalid storage bay order/,
      JSON.stringify(bayOrder),
    );
  // A stored letter no longer on the floor is kept for the page to skip, and empty lists go.
  const kept = validateState({
    ...state,
    storageEdits: { ...state.storageEdits, bayOrder: { ground: ['Z', 'B'], upper: [] } },
  });
  assert.deepEqual(kept.storageEdits.bayOrder, { ground: ['Z', 'B'] });
});

test('a container moves or swaps with its checks and note, into any bay and past 08 (#208)', () => {
  const move = (
    state: SavedState,
    from: string,
    to: string,
    fromName: string,
    toName: string | null = null,
  ) => mutate(state, { type: 'storageSlotMove', from, to, fromName, toName });
  let state = initialState();
  for (const step of ['built', 'labelled', 'connected', 'verified'])
    state = mutate(state, { type: 'check', key: `slot-A02-${step}`, value: true });
  state = mutate(state, { type: 'note', key: 'slot-A02', value: 'Left of the door' });
  state = mutate(state, { type: 'check', key: 'slot-C05-built', value: true });
  // A move into another bay's reserved position: the handbook address left behind is reserved,
  // and the four checks and the note go along.
  state = mutate(state, { type: 'storageSlotClear', key: 'C05' });
  state = move(state, 'A02', 'C05', 'Iron Plate');
  assert.equal(state.storageEdits.slots.C05, 'Iron Plate');
  assert.ok(!state.storageEdits.clearedSlots.includes('C05'));
  assert.ok(state.storageEdits.clearedSlots.includes('A02'));
  for (const step of ['built', 'labelled', 'connected', 'verified'])
    assert.equal(state.checks[`slot-C05-${step}`], true, step);
  assert.equal(state.notes['slot-C05'], 'Left of the door');
  // The reserved position's leftover check went to the address left behind, not away.
  assert.equal(state.checks['slot-A02-built'], true);
  assert.equal(state.checks['slot-A02-labelled'], undefined);
  assert.equal(state.notes['slot-A02'], undefined);
  // A swap within a bay trades the items and both sets of records.
  state = mutate(state, { type: 'check', key: 'slot-C06-verified', value: true });
  state = move(state, 'C05', 'C06', 'Iron Plate', 'Screws');
  assert.equal(state.storageEdits.slots.C06, 'Iron Plate');
  assert.equal(state.storageEdits.slots.C05, 'Screws');
  assert.equal(state.checks['slot-C06-built'], true);
  assert.equal(state.checks['slot-C05-verified'], true);
  assert.equal(state.checks['slot-C05-built'], undefined);
  assert.equal(state.notes['slot-C06'], 'Left of the door');
  // Onto a position past 08, which is new content (version 4); leaving an added position drops
  // that address, as clearing it does.
  state = move(state, 'C06', 'C09', 'Iron Plate');
  assert.equal(state.storageEdits.slots.C09, 'Iron Plate');
  assert.equal(state.version, 4);
  assert.equal(state.notes['slot-C09'], 'Left of the door');
  state = move(state, 'C09', 'B01', 'Iron Plate', 'Modular Frame');
  assert.equal(state.storageEdits.slots.C09, 'Modular Frame');
  state = move(state, 'C09', 'C04', 'Modular Frame', null);
  assert.equal(state.storageEdits.slots.C09, undefined);
  assert.ok(!state.storageEdits.clearedSlots.includes('C09'), 'an added position is not reserved');
  // Into an added bay, and it round-trips.
  state = mutate(state, { type: 'storageBayAdd', id: 'S', name: 'Extra', floor: 'ground' });
  state = move(state, 'B01', 'S03', 'Iron Plate');
  assert.equal(state.storageEdits.slots.S03, 'Iron Plate');
  assert.equal(state.checks['slot-S03-built'], true);
  const round = validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(round.storageEdits, state.storageEdits);
  assert.deepEqual(round.checks, state.checks);
});

test('a container move to the same, an unknown or a malformed address is refused (#208)', () => {
  const state = mutate(initialState(), { type: 'check', key: 'slot-A01-built', value: true });
  for (const [fields, why] of [
    [{ from: 'A01', to: 'A01', fromName: 'Concrete', toName: null }, /Invalid container move/],
    [{ from: 'A01', to: 'A00', fromName: 'Concrete', toName: null }, /Invalid container move/],
    [{ from: 'A1', to: 'A02', fromName: 'Concrete', toName: null }, /Invalid container move/],
    [{ from: 'A01', to: 'Z01', fromName: 'Concrete', toName: null }, /Unknown bay/],
    [{ from: 'A01', to: 'A02', fromName: ' ', toName: null }, /Invalid container/],
    [{ from: 'A01', to: 'A02', fromName: 'Concrete', toName: 5 }, /Invalid container/],
  ] as const) {
    const before = structuredClone(state);
    assert.throws(
      // @ts-expect-error: some of these moves are malformed on purpose; mutate must reject them.
      () => mutate(before, { type: 'storageSlotMove', ...fields }),
      why,
      JSON.stringify(fields),
    );
  }
  assert.equal(state.checks['slot-A01-built'], true);
  // It carries what the tab showed at both addresses, so a stale tab cannot send it.
  const update = {
    type: 'storageSlotMove',
    from: 'A01',
    to: 'A02',
    fromName: 'Concrete',
    toName: null,
  };
  assert.throws(() => checkBase({ ...state, revision: 3 }, update, '2'), /changed in another tab/);
  assert.doesNotThrow(() => checkBase({ ...state, revision: 3 }, update, '3'));
});

test('a storage update type the layout edits do not know is refused as before', () => {
  for (const type of ['storageBayPaint', 'storage', 'storageFloorAdd ']) {
    const state = initialState();
    // @ts-expect-error: an update type no release sends
    assert.throws(() => mutate(state, { type, id: 'A' }), /Unknown update/, type);
  }
});
