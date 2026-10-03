// A profile migrated from the handbook carries handbookOrigin (#387, #485): which handbook it came
// from, and the ticks, notes and group assignments the migration could not place, kept for
// review. It makes the state version 12, so an older release refuses it with the update message
// instead of opening it and dropping what was kept. No update op edits it; a share drops it with
// the rest of the progress, and a full transfer keeps it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mutate, shareState, validateState } from '../public/state.ts';
import { validateTransfer } from '../public/transfer.ts';
import { saveExport, version11, version12 } from './types/fixtures.ts';
import type { SavedState, UpdateOp } from '../public/types/index.ts';

test('handbookOrigin makes a state version 12 and is kept exactly', () => {
  const clean = validateState(structuredClone(version12));
  assert.equal(clean.version, 12);
  assert.deepEqual(clean.handbookOrigin, version12.handbookOrigin);
  // Without it the version is what the rest of the state needs, as before.
  assert.equal(validateState(structuredClone(version11)).version, 11);
  assert.equal('handbookOrigin' in validateState(structuredClone(version11)), false);
});

test('a version newer than 14 is refused with the update message', () => {
  assert.throws(
    () => validateState({ ...structuredClone(version12), version: 15 }),
    /newer planner version/,
  );
});

test('a malformed handbookOrigin is refused', () => {
  const origin = version12.handbookOrigin;
  for (const bad of [
    null,
    'origin',
    { ...origin, version: '' },
    { ...origin, version: 'with spaces' },
    { ...origin, unmapped: undefined },
    { ...origin, unmapped: { ...origin.unmapped, checks: { 'bad key': true } } },
    { ...origin, unmapped: { ...origin.unmapped, checks: { 'factory-3-plastic': 'yes' } } },
    { ...origin, unmapped: { ...origin.unmapped, notes: { a: 'x'.repeat(6001) } } },
    { ...origin, unmapped: { ...origin.unmapped, assignments: { a: [] } } },
    { ...origin, unmapped: { ...origin.unmapped, assignments: { a: [{ group: 'nope' }] } } },
    {
      ...origin,
      unmapped: { ...origin.unmapped, assignments: { a: [{ group: 'fg-plates1', rate: -1 }] } },
    },
  ])
    assert.throws(
      () => validateState({ ...structuredClone(version12), handbookOrigin: bad }),
      /Invalid record of an earlier profile conversion\./,
      JSON.stringify(bad),
    );
});

test('no update op creates, changes or removes handbookOrigin', () => {
  const updates: UpdateOp[] = [
    { type: 'check', key: 'factory-3-plastic', value: false },
    { type: 'checks', keys: ['a', 'b'], value: true },
    { type: 'note', key: 'factory-old-campus', value: '' },
    { type: 'delivery', key: '3-modular-engine', value: 5 },
    { type: 'phase', value: '4' },
    { type: 'addTask', id: 'custom-a1', title: 'Look', phase: '3' },
  ];
  let state: SavedState = validateState(structuredClone(version12));
  for (const update of updates) {
    state = mutate(structuredClone(state), update);
    assert.deepEqual(state.handbookOrigin, version12.handbookOrigin, update.type);
    assert.equal(state.version, 12, update.type);
  }
  // A state without one never gains it.
  assert.equal(
    'handbookOrigin' in mutate(validateState(structuredClone(version11)), updates[0]!),
    false,
  );
});

test('a share drops handbookOrigin; a full transfer keeps it', () => {
  const shared = shareState(structuredClone(version12));
  assert.equal('handbookOrigin' in shared, false);
  assert.equal(shared.version, 11, 'the rest of the state still needs version 11');
  const exported = structuredClone(saveExport);
  exported.saves[0]!.profiles[0]!.state = structuredClone(version12);
  const state = validateTransfer(exported).saves[0]!.profiles[0]!.state;
  assert.equal(state.version, 12);
  assert.deepEqual(state.handbookOrigin, version12.handbookOrigin);
});
