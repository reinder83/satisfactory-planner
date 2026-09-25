import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, validateState, mutate, bayCapacity } from '../public/state.ts';

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
  assert.equal(round.storageEdits.floors[0].label, 'Basement overflow');
  assert.throws(
    () => validateState({ ...JSON.parse(JSON.stringify(s)), version: 5 }),
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
    () => validateState({ ...JSON.parse(JSON.stringify(s)), version: 5 }),
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

test('handbook floors and bays cannot be removed; added ones can, keeping progress records', () => {
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
  assert.equal(s.checks['slot-T01-built'], true, 'progress records survive bay removal');
  s = mutate(s, { type: 'storageFloorRemove', id: 'cf-zz99aa' });
  assert.equal(s.storageEdits.floors.length, 0);
  assert.equal(
    s.version,
    1,
    'no remaining edits means the state stays importable by older planners',
  );
});

test('invalid layout updates are rejected without corrupting the state', () => {
  const s = initialState();
  for (const op of [
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
  ])
    assert.throws(() => mutate(structuredClone(s), op), Error, JSON.stringify(op));
  const bad = structuredClone(initialState());
  bad.storageEdits = {
    bays: [
      { id: 'S', name: 'x', floor: 'ground' },
      { id: 'S', name: 'dup', floor: 'ground' },
    ],
  };
  assert.throws(() => validateState(bad), /Invalid storage bay/);
});
