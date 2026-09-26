import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState,
  validateState,
  mutate,
  bayCapacity,
  handbookBay,
  handbookFloor,
} from '../public/state.ts';
import plan from '../public/plan.json' with { type: 'json' };
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
  let s = initialState();
  s.settings.phase = '3';
  s = mutate(s, { type: 'storageFloorAdd', id: 'cf-abcd12', label: 'Basement overflow' });
  s = mutate(s, { type: 'storageBayAdd', id: 'S', name: 'Overflow', floor: 'cf-abcd12' });
  s = mutate(s, { type: 'storageSlotAssign', key: 'S01', name: 'Iron Plate' });
  s = mutate(s, { type: 'storageBayRename', id: 'S', name: 'Overflow parts' });
  s = mutate(s, { type: 'storageFloorRename', id: 'ground', label: 'Main hall' });
  assert.equal(s.version, 2);
  const round = validateState(JSON.parse(JSON.stringify(s)));
  assert.equal(round.version, 2);
  assert.equal(round.storageEdits.slots.S01, 'Iron Plate');
  assert.equal(round.storageEdits.bayNames.S, 'Overflow parts');
  assert.equal(round.storageEdits.floorNames.ground, 'Main hall');
  assert.equal(round.storageEdits.floors[0]!.label, 'Basement overflow');
  assert.throws(
    () => validateState({ ...JSON.parse(JSON.stringify(s)), version: 10 }),
    /newer planner version/,
  );
});

test('a bay takes containers past its printed eight and marks the state version 4', () => {
  let s = initialState();
  s = mutate(s, { type: 'storageSlotAssign', key: 'A09', name: 'Alclad Aluminum Sheet' });
  s = mutate(s, { type: 'storageSlotAssign', key: 'A12', name: 'Aluminum Casing' });
  s = mutate(s, { type: 'check', key: 'slot-A09-built', value: true });
  assert.equal(s.version, 4, 'an address past 08 is new content older planners must refuse');
  const round = validateState(JSON.parse(JSON.stringify(s)));
  assert.equal(round.version, 4);
  assert.equal(round.storageEdits.slots.A09, 'Alclad Aluminum Sheet');
  assert.equal(round.storageEdits.slots.A12, 'Aluminum Casing');
  assert.throws(
    () => validateState({ ...JSON.parse(JSON.stringify(s)), version: 10 }),
    /newer planner version/,
  );
  // An added position has no handbook container behind it, so clearing one drops
  // the address instead of reserving it, while its progress records stay put.
  s = mutate(s, { type: 'storageSlotClear', key: 'A09' });
  assert.deepEqual(s.storageEdits.clearedSlots, []);
  assert.equal(s.storageEdits.slots.A09, undefined);
  assert.equal(s.checks['slot-A09-built'], true);
  s = mutate(s, { type: 'storageSlotClear', key: 'A12' });
  assert.equal(
    s.version,
    1,
    'a layout back within the printed eight is importable by older planners again',
  );
  assert.throws(
    () =>
      mutate(structuredClone(s), {
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
  let s = initialState();
  s = mutate(s, { type: 'check', key: 'slot-G08-built', value: true });
  s = mutate(s, { type: 'storageSlotClear', key: 'G08' });
  s = mutate(s, { type: 'storageSlotClear', key: 'G08' });
  assert.deepEqual(s.storageEdits.clearedSlots, ['G08']);
  assert.equal(s.checks['slot-G08-built'], true);
  s = mutate(s, { type: 'storageSlotAssign', key: 'G08', name: 'Medicinal Inhaler' });
  assert.deepEqual(s.storageEdits.clearedSlots, []);
  assert.equal(s.storageEdits.slots.G08, 'Medicinal Inhaler');
  assert.equal(s.checks['slot-G08-built'], true);
});

test('handbook floors and bays cannot be removed; added ones can', () => {
  let s = initialState();
  assert.throws(
    () => mutate(structuredClone(s), { type: 'storageFloorRemove', id: 'ground' }),
    /added floors/i,
  );
  assert.throws(
    () => mutate(structuredClone(s), { type: 'storageBayRemove', id: 'A' }),
    /added bays/i,
  );
  s = mutate(s, { type: 'storageFloorAdd', id: 'cf-zz99aa', label: 'Attic' });
  s = mutate(s, { type: 'storageBayAdd', id: 'T', name: 'Attic bay', floor: 'cf-zz99aa' });
  assert.throws(
    () => mutate(structuredClone(s), { type: 'storageFloorRemove', id: 'cf-zz99aa' }),
    /bays on this floor/,
  );
  s = mutate(s, { type: 'storageSlotAssign', key: 'T01', name: 'Wire' });
  s = mutate(s, { type: 'check', key: 'slot-T01-built', value: true });
  s = mutate(s, { type: 'storageBayRemove', id: 'T' });
  assert.equal(s.storageEdits.bays.length, 0);
  assert.equal(s.storageEdits.slots.T01, undefined);
  assert.equal(s.checks['slot-T01-built'], undefined, 'the removed bay takes its checks along');
  s = mutate(s, { type: 'storageFloorRemove', id: 'cf-zz99aa' });
  assert.equal(s.storageEdits.floors.length, 0);
  assert.equal(
    s.version,
    1,
    'no remaining edits means the state stays importable by older planners',
  );
});

test('a bay that reuses the letter of a removed bay starts without its checks and notes', () => {
  let s = initialState();
  s = mutate(s, { type: 'storageBayAdd', id: 'T', name: 'Overflow', floor: 'ground' });
  s = mutate(s, { type: 'storageBayAdd', id: 'TA', name: 'Next door', floor: 'ground' });
  for (const addr of ['T01', 'T09', 'TA01', 'A01']) {
    s = mutate(s, { type: 'check', key: `slot-${addr}-built`, value: true });
    s = mutate(s, { type: 'note', key: `slot-${addr}`, value: 'Wire here' });
  }
  s = mutate(s, { type: 'note', key: 'phase-3', value: 'Unrelated' });
  s = mutate(s, { type: 'storageBayRemove', id: 'T' });
  s = mutate(s, { type: 'storageBayAdd', id: 'T', name: 'Overflow again', floor: 'ground' });
  assert.deepEqual(Object.keys(s.checks).sort(), ['slot-A01-built', 'slot-TA01-built']);
  assert.deepEqual(Object.keys(s.notes).sort(), ['phase-3', 'slot-A01', 'slot-TA01']);
});

test('an added bay cannot take a handbook letter, and removing an old one keeps that bay', () => {
  assert.deepEqual(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(handbookBay),
    plan.storage.map(b => b.id),
    'handbookBay matches the handbook',
  );
  let s = initialState();
  assert.throws(
    () =>
      mutate(structuredClone(s), { type: 'storageBayAdd', id: 'A', name: 'x', floor: 'ground' }),
    /handbook bay/,
  );
  // A state saved with one, through a direct request or an edited import, still loads.
  s = validateState({
    ...s,
    storageEdits: {
      bays: [{ id: 'A', name: 'Clash', floor: 'ground' }],
      bayNames: { A: 'Plates' },
      slots: { A01: 'Wire' },
      clearedSlots: ['A02'],
    },
  });
  s = mutate(s, { type: 'check', key: 'slot-A01-built', value: true });
  s = mutate(s, { type: 'note', key: 'slot-A01', value: 'Handbook note' });
  s = mutate(s, { type: 'storageBayRemove', id: 'A' });
  assert.deepEqual(s.storageEdits.bays, []);
  assert.deepEqual(s.storageEdits.bayNames, { A: 'Plates' });
  assert.deepEqual(s.storageEdits.slots, { A01: 'Wire' });
  assert.deepEqual(s.storageEdits.clearedSlots, ['A02']);
  assert.equal(s.checks['slot-A01-built'], true);
  assert.equal(s.notes['slot-A01'], 'Handbook note');
});

test('invalid layout updates are rejected without corrupting the state', () => {
  const s = initialState();
  const ops: UpdateOp[] = [
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
  for (const op of ops)
    assert.throws(() => mutate(structuredClone(s), op), Error, JSON.stringify(op));
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
  let s = initialState();
  s = mutate(s, { type: 'check', key: 'slot-C01-built', value: true });
  s = mutate(s, { type: 'note', key: 'slot-C01', value: 'Left of the lift' });
  s = mutate(s, { type: 'storageBayRename', id: 'C', name: 'Copper bay' });
  s = mutate(s, { type: 'storageSlotAssign', key: 'C02', name: 'Wire' });
  const before = structuredClone(s);
  s = mutate(s, { type: 'storageBayHide', id: 'C' });
  s = mutate(s, { type: 'storageBayHide', id: 'C' });
  assert.deepEqual(s.storageEdits.hiddenBays, ['C'], 'hiding twice lists it once');
  assert.equal(s.version, 5, 'older planners must refuse it rather than show the bay again');
  // Nothing of the bay's own is touched.
  assert.deepEqual(s.checks, before.checks);
  assert.deepEqual(s.notes, before.notes);
  assert.equal(s.storageEdits.bayNames.C, 'Copper bay');
  assert.equal(s.storageEdits.slots.C02, 'Wire');
  const round = validateState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(round.storageEdits.hiddenBays, ['C']);
  assert.equal(round.version, 5);
  assert.throws(
    () => validateState({ ...JSON.parse(JSON.stringify(s)), version: 10 }),
    /newer planner version/,
  );
  // Restoring brings back exactly what was there, at the version the rest needs.
  s = mutate(s, { type: 'storageBayRestore', id: 'C' });
  assert.deepEqual(s.storageEdits, before.storageEdits);
  assert.equal(s.version, before.version);
  // Only handbook letters can be hidden; an added bay is removed instead.
  assert.throws(() => mutate(s, { type: 'storageBayHide', id: 'S' }), /Only handbook bays/);
  assert.throws(
    () => mutate(s, { type: 'storageBayRemove', id: 'C' }),
    /Hide a handbook bay instead; its progress is kept/,
  );
});

test('a malformed hidden-bay list is refused and leaves nothing changed', () => {
  const s = mutate(initialState(), { type: 'storageBayHide', id: 'A' });
  for (const hiddenBays of ['A', ['S'], ['a'], [1], Array.from({ length: 19 }, () => 'A')])
    assert.throws(
      () =>
        validateState({ ...structuredClone(s), storageEdits: { ...s.storageEdits, hiddenBays } }),
      /Invalid hidden storage bays/,
      JSON.stringify(hiddenBays),
    );
});

test('a built-in floor can be hidden once empty and restored, as version 6 (#168)', () => {
  let s = initialState();
  s = mutate(s, { type: 'storageFloorHide', id: 'workshop' });
  s = mutate(s, { type: 'storageFloorHide', id: 'workshop' });
  assert.deepEqual(s.storageEdits.hiddenFloors, ['workshop']);
  assert.equal(s.version, 6, 'a version-5 planner must refuse it rather than show the floor');
  const round = validateState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(round.storageEdits.hiddenFloors, ['workshop']);
  assert.throws(
    () => validateState({ ...JSON.parse(JSON.stringify(s)), version: 10 }),
    /newer planner version/,
  );
  s = mutate(s, { type: 'storageFloorRestore', id: 'workshop' });
  assert.deepEqual(s.storageEdits.hiddenFloors, []);
  assert.equal(s.version, 1);
  // An added floor is removed, not hidden; a floor with added bays keeps them in reach.
  assert.throws(() => mutate(s, { type: 'storageFloorHide', id: 'cf-abcd12' }), /Only built-in/);
  s = mutate(s, { type: 'storageBayAdd', id: 'S', name: 'Extra', floor: 'upper' });
  assert.throws(() => mutate(s, { type: 'storageFloorHide', id: 'upper' }), /bays on this floor/);
  // At least one floor stays: all three built-ins only with an added floor, which then stays.
  s = mutate(s, { type: 'storageBayRemove', id: 'S' });
  s = mutate(s, { type: 'storageFloorHide', id: 'ground' });
  s = mutate(s, { type: 'storageFloorHide', id: 'upper' });
  assert.throws(
    () => mutate(s, { type: 'storageFloorHide', id: 'workshop' }),
    /at least one floor/,
  );
  s = mutate(s, { type: 'storageFloorAdd', id: 'cf-abcd12', label: 'Basement' });
  s = mutate(s, { type: 'storageFloorHide', id: 'workshop' });
  assert.deepEqual(s.storageEdits.hiddenFloors, ['ground', 'upper', 'workshop']);
  assert.throws(
    () => mutate(s, { type: 'storageFloorRemove', id: 'cf-abcd12' }),
    /at least one floor/,
  );
});

test('a malformed hidden-floor list is refused', () => {
  const s = mutate(initialState(), { type: 'storageFloorHide', id: 'workshop' });
  for (const hiddenFloors of ['workshop', ['attic'], [1], ['ground', 'upper', 'workshop']])
    assert.throws(
      () =>
        validateState({ ...structuredClone(s), storageEdits: { ...s.storageEdits, hiddenFloors } }),
      /Invalid hidden storage floors/,
      JSON.stringify(hiddenFloors),
    );
});

test('an added bay can take a hidden handbook letter, clearing that bay first (#167)', () => {
  let s = initialState();
  s = mutate(s, { type: 'check', key: 'slot-C01-built', value: true });
  s = mutate(s, { type: 'note', key: 'slot-C01', value: 'Old copper' });
  s = mutate(s, { type: 'storageBayRename', id: 'C', name: 'Copper bay' });
  s = mutate(s, { type: 'storageSlotAssign', key: 'C02', name: 'Wire' });
  s = mutate(s, { type: 'check', key: 'slot-D01-built', value: true });
  const add = { type: 'storageBayAdd', id: 'C', name: 'My parts', floor: 'ground' } as const;
  // In the room: refused. Hidden: refused until the replacement is confirmed.
  assert.throws(() => mutate(structuredClone(s), add), /Bay C is in the room/);
  s = mutate(s, { type: 'storageBayHide', id: 'C' });
  assert.throws(() => mutate(structuredClone(s), add), /still has saved progress/);
  const kept = structuredClone(s);
  s = mutate(s, { ...add, replace: true });
  assert.deepEqual(s.storageEdits.bays, [{ id: 'C', name: 'My parts', floor: 'ground' }]);
  assert.equal(s.checks['slot-C01-built'], undefined, 'the hidden bay’s records are cleared');
  assert.equal(s.notes['slot-C01'], undefined);
  assert.equal(s.storageEdits.bayNames.C, undefined);
  assert.equal(s.storageEdits.slots.C02, undefined);
  assert.equal(s.checks['slot-D01-built'], true, 'other bays keep theirs');
  assert.equal(s.version, 5);
  // The refused attempts changed nothing.
  assert.equal(kept.checks['slot-C01-built'], true);
  // The handbook bay cannot come back while the added bay holds its letter.
  assert.throws(() => mutate(s, { type: 'storageBayRestore', id: 'C' }), /Remove it before/);
  // The added bay's own records go with it (#51), and then the letter can be restored.
  s = mutate(s, { type: 'check', key: 'slot-C01-built', value: true });
  s = mutate(s, { type: 'storageBayRemove', id: 'C' });
  assert.equal(s.checks['slot-C01-built'], undefined);
  s = mutate(s, { type: 'storageBayRestore', id: 'C' });
  assert.deepEqual(s.storageEdits.hiddenBays, []);
  // A letter taken twice is refused with a clear reason.
  s = mutate(s, { type: 'storageBayAdd', id: 'S', name: 'Extra', floor: 'ground' });
  assert.throws(
    () => mutate(s, { type: 'storageBayAdd', id: 'S', name: 'Again', floor: 'ground' }),
    /Bay S already exists/,
  );
});

test('a handbook bay sharing its letter with a pre-#91 added bay is not hidden, so removing that bay keeps its records', () => {
  // Before #91 an added bay could be stored under a handbook letter; it shares that bay's
  // addresses, checks and notes.
  let s = validateState({
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
  const before = structuredClone(s);
  assert.throws(
    () => mutate(structuredClone(s), { type: 'storageBayHide', id: 'C' }),
    /An added bay uses the letter C. Remove it before hiding/,
  );
  // Removing the old added bay removes only its entry, as it always has.
  s = mutate(s, { type: 'storageBayRemove', id: 'C' });
  assert.deepEqual(s.storageEdits.bays, []);
  assert.deepEqual(s.checks, before.checks);
  assert.deepEqual(s.notes, before.notes);
  // Then the handbook bay can be hidden, keeping everything.
  s = mutate(s, { type: 'storageBayHide', id: 'C' });
  assert.deepEqual(s.storageEdits.hiddenBays, ['C']);
  assert.equal(s.checks['slot-C01-built'], true);
});

test('any bay can move to another floor with every record, as version 8 when a handbook bay moves (#190)', () => {
  let s = initialState();
  s = mutate(s, { type: 'check', key: 'slot-D01-built', value: true });
  s = mutate(s, { type: 'note', key: 'slot-D01', value: 'By the lift' });
  s = mutate(s, { type: 'storageBayRename', id: 'D', name: 'Control' });
  s = mutate(s, { type: 'storageBayMove', id: 'D', floor: 'upper' });
  assert.deepEqual(s.storageEdits.bayFloors, { D: 'upper' });
  assert.equal(s.version, 8, 'a version-7 planner must refuse it rather than put the bay back');
  assert.equal(s.checks['slot-D01-built'], true, 'the letter, and so every record, stays');
  assert.equal(s.notes['slot-D01'], 'By the lift');
  assert.equal(s.storageEdits.bayNames.D, 'Control');
  const round = validateState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(round.storageEdits.bayFloors, { D: 'upper' });
  assert.throws(() => validateState({ ...round, version: 10 }), /newer planner version/);
  // The floor it moved to counts it: upper cannot be hidden, an added floor not removed.
  assert.throws(() => mutate(s, { type: 'storageFloorHide', id: 'upper' }), /bays on this floor/);
  s = mutate(s, { type: 'storageFloorAdd', id: 'cf-base01', label: 'Basement' });
  s = mutate(s, { type: 'storageBayMove', id: 'J', floor: 'cf-base01' });
  assert.throws(
    () => mutate(s, { type: 'storageFloorRemove', id: 'cf-base01' }),
    /bays on this floor/,
  );
  // Back on its own floor it has not moved; with no moves left the version drops again.
  s = mutate(s, { type: 'storageBayMove', id: 'J', floor: 'upper' });
  s = mutate(s, { type: 'storageBayMove', id: 'D', floor: 'ground' });
  assert.equal(s.storageEdits.bayFloors, undefined);
  assert.equal(s.version, 2);
  // An added bay moves by its own floor.
  s = mutate(s, { type: 'storageBayAdd', id: 'S', name: 'Extra', floor: 'ground' });
  s = mutate(s, { type: 'storageBayMove', id: 'S', floor: 'cf-base01' });
  assert.equal(s.storageEdits.bays.find(b => b.id === 'S')!.floor, 'cf-base01');
  assert.equal(s.storageEdits.bayFloors, undefined);
});

test('a bay move to a missing or hidden floor, or of an unknown bay, is refused', () => {
  let s = mutate(initialState(), { type: 'storageFloorHide', id: 'workshop' });
  for (const [op, why] of [
    [{ type: 'storageBayMove', id: 'D', floor: 'attic' }, /Unknown floor/],
    [{ type: 'storageBayMove', id: 'D', floor: 'cf-none01' }, /Unknown floor/],
    [{ type: 'storageBayMove', id: 'D', floor: 'workshop' }, /Restore that floor/],
    [{ type: 'storageBayMove', id: 'ZZ', floor: 'upper' }, /Unknown bay/],
    [{ type: 'storageBayMove', id: 'd', floor: 'upper' }, /Invalid bay/],
  ] as [UpdateOp, RegExp][])
    assert.throws(() => mutate(structuredClone(s), op), why, JSON.stringify(op));
  for (const bayFloors of [[], { S: 'upper' }, { D: 'attic' }, { D: 'cf-none01' }, { D: 1 }])
    assert.throws(
      () => validateState({ ...s, storageEdits: { ...s.storageEdits, bayFloors } }),
      /Invalid storage bay floors/,
      JSON.stringify(bayFloors),
    );
  // A bay taking a hidden handbook letter (#167) starts on its own floor, not the old bay's.
  s = mutate(initialState(), { type: 'storageBayMove', id: 'C', floor: 'upper' });
  s = mutate(s, { type: 'storageBayHide', id: 'C' });
  s = mutate(s, {
    type: 'storageBayAdd',
    id: 'C',
    name: 'Mine',
    floor: 'ground',
    replace: true,
  });
  assert.equal(s.storageEdits.bayFloors, undefined);
});

test("handbookFloor matches every handbook bay's floor in plan.json", () => {
  for (const b of plan.storage) assert.equal(handbookFloor(b.id), b.floor, b.id);
});

test('the bays on a floor can be put in order, as version 9, without touching any record (#191)', () => {
  let s = initialState();
  s = mutate(s, { type: 'check', key: 'slot-B01-built', value: true });
  s = mutate(s, { type: 'storageBayOrder', floor: 'ground', order: ['B', 'A', 'C'] });
  assert.deepEqual(s.storageEdits.bayOrder, { ground: ['B', 'A', 'C'] });
  assert.equal(s.version, 9, 'a version-8 planner must refuse it rather than drop the order');
  assert.equal(s.checks['slot-B01-built'], true);
  const round = validateState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(round.storageEdits.bayOrder, { ground: ['B', 'A', 'C'] });
  assert.equal(round.version, 9);
  assert.throws(() => validateState({ ...round, version: 10 }), /newer planner version/);
  // Without the field nothing changes: the layout keeps its old shape and version.
  const plain = mutate(initialState(), { type: 'storageBayRename', id: 'A', name: 'Front' });
  assert.equal('bayOrder' in plain.storageEdits, false);
  assert.equal(plain.version, 2);
  // A bay moved to another floor leaves the old floor's order and joins the new one at its
  // default place; ordering the new floor may then list it.
  s = mutate(s, { type: 'storageBayMove', id: 'B', floor: 'upper' });
  assert.deepEqual(s.storageEdits.bayOrder, { ground: ['A', 'C'] });
  s = mutate(s, { type: 'storageBayOrder', floor: 'upper', order: ['B', 'J', 'I'] });
  assert.deepEqual(s.storageEdits.bayOrder!.upper, ['B', 'J', 'I']);
  // An added bay removed leaves every order; a removed floor takes its order with it.
  s = mutate(s, { type: 'storageFloorAdd', id: 'cf-base01', label: 'Basement' });
  s = mutate(s, { type: 'storageBayAdd', id: 'S', name: 'Extra', floor: 'cf-base01' });
  s = mutate(s, { type: 'storageBayAdd', id: 'T', name: 'More', floor: 'cf-base01' });
  s = mutate(s, { type: 'storageBayOrder', floor: 'cf-base01', order: ['T', 'S'] });
  s = mutate(s, { type: 'storageBayRemove', id: 'T' });
  assert.deepEqual(s.storageEdits.bayOrder!['cf-base01'], ['S']);
  s = mutate(s, { type: 'storageBayMove', id: 'S', floor: 'ground' });
  assert.equal(s.storageEdits.bayOrder!['cf-base01'], undefined);
  s = mutate(s, { type: 'storageFloorRemove', id: 'cf-base01' });
  // A hidden bay keeps its place, so restoring it puts it back where it was.
  s = mutate(s, { type: 'storageBayHide', id: 'C' });
  assert.deepEqual(s.storageEdits.bayOrder!.ground, ['A', 'C']);
  // Clearing a floor's order (an empty list) drops the field, and the version with it.
  s = mutate(s, { type: 'storageBayOrder', floor: 'ground', order: [] });
  s = mutate(s, { type: 'storageBayOrder', floor: 'upper', order: [] });
  assert.equal(s.storageEdits.bayOrder, undefined);
  assert.equal(s.version, 8, 'B is still moved');
});

test('a bay order with unknown floors, bays elsewhere or bad letters is refused (#191)', () => {
  const s = mutate(initialState(), { type: 'storageFloorAdd', id: 'cf-base01', label: 'Basement' });
  for (const [op, why] of [
    [{ type: 'storageBayOrder', floor: 'attic', order: ['A'] }, /Unknown floor/],
    [{ type: 'storageBayOrder', floor: 'ground', order: ['A', 'I'] }, /Only bays on this floor/],
    [{ type: 'storageBayOrder', floor: 'ground', order: ['A', 'A'] }, /Invalid bay order/],
    [{ type: 'storageBayOrder', floor: 'ground', order: ['a'] }, /Invalid bay order/],
    [{ type: 'storageBayOrder', floor: 'ground', order: 'AB' }, /Invalid bay order/],
    [{ type: 'storageBayOrder', floor: 'cf-base01', order: ['S'] }, /Only bays on this floor/],
  ] as unknown as [UpdateOp, RegExp][])
    assert.throws(() => mutate(structuredClone(s), op), why, JSON.stringify(op));
  for (const bayOrder of [
    [],
    { attic: ['A'] },
    { ground: 'AB' },
    { ground: ['A', 'A'] },
    { ground: ['a'] },
    { ground: [1] },
  ])
    assert.throws(
      () => validateState({ ...s, storageEdits: { ...s.storageEdits, bayOrder } }),
      /Invalid storage bay order/,
      JSON.stringify(bayOrder),
    );
  // A stored letter no longer on the floor is kept for the page to skip, and empty lists go.
  const kept = validateState({
    ...s,
    storageEdits: { ...s.storageEdits, bayOrder: { ground: ['Z', 'B'], upper: [] } },
  });
  assert.deepEqual(kept.storageEdits.bayOrder, { ground: ['Z', 'B'] });
});
