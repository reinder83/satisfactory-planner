// The guided start's budget screen for maximum output (#1072, ui/guided/GuidedBudgets.vue) sends
// what All settings step 4 sends: the budgets (settings.limits) and their confirmation
// (limitsConfirmed), with goal 'maximum' and the answers of the questions after it. Nothing new is
// stored, so both editions must create the same profile from the same answers. The screen itself
// is covered in tests/ui/guided-max-output.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, DEFAULT_LIMITS } from '../planner.ts';
import { guidedBudgetsQuestion, guidedQuestions } from '../public/preferences.ts';
import {
  browserProfile,
  createdProfile,
  dockerProfile,
  newSaveRequest,
} from './helpers/editions.ts';

// A new save's guided start for Phase 3 (mining per phase on, as freshSettings starts it) that
// chose "As fast as the map allows", lowered one budget and confirmed them, then answered the
// questions after it: stock, exactness and power.
const option = (question: string, value: string) =>
  guidedQuestions.find(q => q.id === question)!.options!.find(o => o.value === value)!.set;
const ANSWERED = {
  phase: '3',
  phaseMining: true,
  ...option('goal', 'maximum'),
  limits: { ...DEFAULT_LIMITS, 'Iron Ore': 30000 },
  limitsConfirmed: true,
  ...option('stock', 'none'),
  ...option('exact', 'precise'),
  ...option('power', 'coal'),
  availablePowerGW: 0.5,
};

test('the maximum-output answers create the same profile in both editions', async () => {
  const docker = await dockerProfile(newSaveRequest(ANSWERED));
  const browser = await browserProfile(newSaveRequest(ANSWERED));
  assert.deepEqual(createdProfile(browser), createdProfile(docker));
  const settings = docker.plan!.settings;
  assert.equal(settings.goal, 'maximum');
  assert.equal(settings.limitsConfirmed, true);
  assert.equal(settings.limits['Iron Ore'], 30000, 'the budget entered on the screen');
  assert.deepEqual(settings.limits, ANSWERED.limits);
  // The questions after the budget screen count as for any other goal.
  assert.equal(settings.storage, 'none');
  assert.equal(settings.wholeMachines, false);
  assert.equal(settings.mainPower, 'coal');
  assert.equal(settings.availablePowerGW, 0.5);
  // Confirmed budgets are not called provisional, and the plan is the one calculate() makes.
  assert.equal(
    docker.plan!.warnings.some(warning => /provisional/.test(warning)),
    false,
  );
  assert.deepEqual(docker.plan!.settings, calculate(ANSWERED).settings);
});

test('maximum output is refused unconfirmed, which is why the screen asks for the box', () => {
  assert.throws(
    () => calculate({ ...ANSWERED, limitsConfirmed: false }),
    /Confirm your available resource budgets before maximizing output/,
  );
  // The screen names the All settings step that owns the same fields: step 4.
  assert.equal(guidedBudgetsQuestion.step, 4);
});
