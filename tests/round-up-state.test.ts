// roundUpState and wholeMachineProfile (public/state/carry.ts): the progress and profile both
// editions' /api/round-up add. A ticked 'calc-' row is unticked for review where the rounded plan
// has a new row, more machines or more of any input (tolerance 0.001); nothing else changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../planner.ts';
import { initialState, roundUpState, wholeMachineProfile } from '../public/state.ts';
import type { PlanGuide } from '../public/types/index.ts';

const rounded = calculate({ phase: '3', wholeMachines: true });
const rows = rounded.stages['3'].rows!;
const withInput = rows.find(row => Object.keys(row.inputs).length)!;
const others = rows.filter(row => row.id !== withInput.id);
const key = (id: string) => 'calc-3-' + id;

test('roundUpState keeps a tick where the rounded row needs no more, and unticks a grown one', () => {
  const [same, moreMachines, moreInput, missing, unticked] = [
    others[0]!,
    others[1]!,
    withInput,
    others[2]!,
    others[3]!,
  ];
  assert.equal(new Set([same, moreMachines, moreInput, missing, unticked].map(r => r.id)).size, 5);
  const previousPlan = structuredClone(rounded);
  const previousRows = previousPlan.stages['3'].rows!;
  const find = (id: string) => previousRows.find(row => row.id === id)!;
  find(moreMachines.id).machines = moreMachines.machines - 1;
  const [item, rate] = Object.entries(moreInput.inputs)[0]!;
  find(moreInput.id).inputs[item] = rate - 0.01;
  previousPlan.stages['3'].rows = previousRows.filter(row => row.id !== missing.id);
  const state = initialState();
  for (const row of [same, moreMachines, moreInput, missing]) state.checks[key(row.id)] = true;
  state.checks['unlock-x'] = true;
  state.notes['global'] = 'kept';
  const before = structuredClone(state);

  const result = roundUpState(state, previousPlan, rounded);
  assert.equal(result.reviewCount, 3);
  assert.equal(result.state.checks[key(same.id)], true);
  assert.equal(result.state.checks[key(moreMachines.id)], false);
  assert.equal(result.state.checks[key(moreInput.id)], false);
  assert.equal(result.state.checks[key(missing.id)], false);
  assert.equal(result.state.checks[key(unticked.id)], undefined);
  assert.equal(result.state.checks['unlock-x'], true);
  assert.equal(result.state.notes['global'], 'kept');
  assert.deepEqual(state, before, 'the previous state is not changed');
  assert.notEqual(result.state, state);
});

test('roundUpState allows 0.001 more input and counts only ticked rows', () => {
  const previousPlan = structuredClone(rounded);
  const [item, rate] = Object.entries(withInput.inputs)[0]!;
  previousPlan.stages['3'].rows!.find(row => row.id === withInput.id)!.inputs[item] = rate - 0.0005;
  const state = initialState();
  state.checks[key(withInput.id)] = true;
  assert.equal(roundUpState(state, previousPlan, rounded).reviewCount, 0);
  assert.equal(roundUpState(state, previousPlan, rounded).state.checks[key(withInput.id)], true);
  // Without a previous plan every ticked row is new, and an unticked state has nothing to review.
  assert.equal(roundUpState(state, null, rounded).reviewCount, 1);
  assert.equal(roundUpState(initialState(), null, rounded).reviewCount, 0);
});

test('wholeMachineProfile names the copy, keeps the guide and carries the reviewed state', () => {
  const guide: PlanGuide = {
    phases: { '3': [{ id: 'phase-3-survey', title: 'Survey', body: 'Walk it.' }] },
  };
  const state = initialState();
  state.checks[key(rows[0]!.id)] = true;
  const previous = { name: 'x'.repeat(79), plan: { ...calculate({ phase: '3' }), guide }, state };
  const { profile, reviewCount } = wholeMachineProfile('new', previous, rounded);
  assert.equal(profile.id, 'new');
  assert.equal(profile.kind, 'calculated');
  assert.equal(profile.name, ('x'.repeat(79) + ' · whole machines').slice(0, 80));
  assert.equal(profile.name.length, 80);
  assert.deepEqual(profile.plan.guide, guide);
  assert.equal(profile.plan.stages, rounded.stages);
  assert.deepEqual(profile.state, roundUpState(state, previous.plan, rounded).state);
  assert.equal(reviewCount, roundUpState(state, previous.plan, rounded).reviewCount);
});
