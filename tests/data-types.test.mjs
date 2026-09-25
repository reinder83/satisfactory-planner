import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateState } from '../public/state.js';
import { validateTransfer } from '../public/transfer.js';
// Typed with public/types/ (checked by npm run typecheck); Node strips the types.
import { backup, saveExport, states } from './types/fixtures.ts';

// The fixtures the data types are checked against must also be data the planner accepts, or
// the types would describe something no save holds.
test('every typed state fixture passes validateState with its own version', () => {
  for (const [state, version] of states) {
    const clean = validateState(structuredClone(state));
    assert.equal(clean.version, version);
    assert.deepEqual(clean.checks, state.checks);
    assert.deepEqual(clean.notes, state.notes);
    assert.equal(clean.settings.phase, state.settings.phase);
  }
  assert.equal(validateState(structuredClone(backup.state)).version, 2);
});

test('a full-save export with a first-release calculated plan passes validateTransfer', () => {
  const clean = validateTransfer(structuredClone(saveExport));
  const profile = clean.saves[0].profiles[0];
  assert.equal(profile.kind, 'calculated');
  assert.deepEqual(Object.keys(profile.plan.stages), ['1', '2', '3', '4', '5']);
  assert.equal(profile.plan.settings.phase, '3');
  assert.equal(profile.state.version, 1);
});
