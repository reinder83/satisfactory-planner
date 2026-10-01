// An original profile's progress cannot move before Phase 3, where its plan starts, by an
// update or a restored backup. Both editions refuse it with one shared message, which describes
// the plan rather than the retired handbook (owner decision 8 on #387, #653) and says what to do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforePlanStart, checkPlanStart, initialState } from '../public/state.ts';
import type { Phase, ProgressState } from '../public/types/index.ts';

const at = (phase: Phase): ProgressState => {
  const state = initialState();
  state.settings.phase = phase;
  return state;
};

test('an original profile is refused a phase before 3, with the shared message', () => {
  for (const phase of ['1', '2'] as Phase[])
    assert.throws(() => checkPlanStart('original', at(phase)), {
      status: 400,
      message: beforePlanStart,
    });
  for (const phase of ['3', '4', '5', 'post'] as Phase[])
    assert.doesNotThrow(() => checkPlanStart('original', at(phase)));
  for (const phase of ['1', '2', '3', '4', '5', 'post'] as Phase[])
    assert.doesNotThrow(() => checkPlanStart('calculated', at(phase)));
});

test('the refusal names neither the handbook nor an original profile, and says what to do', () => {
  assert.doesNotMatch(beforePlanStart, /handbook|original profile/i);
  assert.match(beforePlanStart, /Pick Phase 3 or later, or restore a backup/);
});

test('both editions refuse through checkPlanStart, with no wording of their own', () => {
  for (const file of ['../public/browser-api.ts', '../server/profile-routes.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /checkPlanStart\(/, file);
    assert.doesNotMatch(source, /covers Phase 3/, file);
  }
});
