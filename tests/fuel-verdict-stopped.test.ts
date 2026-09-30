// With fueled augmenters, calculate solves Phase 5 a second time without the fuel and records
// `fuelVerdict`, shown on Review. That second solve shares Phase 5's search deadline (#592), so on a
// slow device it can stop before it finds a plan. A stopped search proves no shortage, yet it
// was read as "the unfueled plan does not fit", and Review then said the fueled augmenters were
// carrying the plan (#634). It now gives no verdict and says the search stopped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../planner.ts';

// Whole machines and one fueled augmenter: Phase 5 fits with and without the fuel.
const settings = {
  phase: '5',
  recipes: 'all',
  nuclear: 'recycle',
  goal: 'balanced',
  somersloops: 20,
  augmenters: 1,
  fueledAugmenters: 1,
  wholeMachines: true,
  sam: 'avoid',
};
// Runs calculate while counting the Date.now calls from Phase 5's start: the phase's deadline and
// every integer search's time left are read through it. After `jumpAfter` calls the clock jumps
// far past the deadline, so every later search of the phase stops as 'Time limit reached' without
// running. The count is exact because the searches stop at a node count, not at the clock.
function calculateCounted(input: object, jumpAfter = Infinity) {
  const dateNow = Date.now;
  let counting = false,
    calls = 0;
  Date.now = () => {
    if (counting && ++calls > jumpAfter) return dateNow() + 1e9;
    return dateNow();
  };
  try {
    const plan = calculate(input, phase => {
      if (phase === 5) counting = true;
    });
    return { plan, calls };
  } finally {
    Date.now = dateNow;
  }
}

test('an unfueled Phase 5 search that stopped is not reported as "does not fit" (#634)', () => {
  const full = calculateCounted(settings);
  const verdict = full.plan.stages[5].fuelVerdict;
  assert.ok(verdict, 'on an ordinary machine the verdict is recorded');
  assert.equal(verdict.unfueledFeasible, true, 'and the unfueled plan fits');
  // The unfueled comparison makes as many calls as Phase 5 does on its own without the fuel, so
  // the fueled solve makes the rest. Jump the clock exactly between the two.
  const unfueled = calculateCounted({ ...settings, fueledAugmenters: 0 });
  const cut = calculateCounted(settings, full.calls - unfueled.calls);
  const stage = cut.plan.stages[5];
  assert.equal(stage.feasible, true, 'the fueled Phase 5 is still planned');
  assert.equal(stage.rows!.length, full.plan.stages[5].rows!.length, 'with the same plan');
  assert.equal(stage.fuelVerdict, undefined, 'no verdict claims the unfueled plan does not fit');
  assert.ok(
    cut.plan.warnings.some(warning =>
      /could not be compared.*search stopped before it could prove the best plan/.test(warning),
    ),
    'the plan says the comparison stopped',
  );
});
