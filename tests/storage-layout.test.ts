import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, validateState, mutate, bayCapacity, handbookBay } from '../public/state.ts';
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
