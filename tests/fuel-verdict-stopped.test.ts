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
// running. The count is exact because the searches stop at a node count, not at the clock. With
// `jumpUntil` the clock is back after that many calls, so the searches after it run as usual.
function calculateCounted(input: object, jumpAfter = Infinity, jumpUntil = Infinity) {
  const dateNow = Date.now;
  let counting = false,
    calls = 0;
  Date.now = () => {
    if (counting && ++calls > jumpAfter && calls <= jumpUntil) return dateNow() + 1e9;
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

// A large installed grid makes the fuel's multiplier worth 40 GW: whole machines fit Phase 5 with
// the fuel but not without it, with or without SAM conversion, and that is proven, not a stop.
const shortOfPower = {
  ...settings,
  sam: 'needed',
  multiplier: 20,
  powerFactor: 2,
  installedPowerGW: 200,
};

test('a stopped first unfueled attempt does not hide a proven "does not fit" (#665)', () => {
  const full = calculateCounted(shortOfPower);
  const verdict = full.plan.stages[5].fuelVerdict;
  assert.ok(verdict, 'on an ordinary machine the verdict is recorded');
  assert.equal(verdict.unfueledFeasible, false, 'and the unfueled plan does not fit');
  // Under 'avoid' the comparison makes one attempt, the same solve as the first of the two
  // 'needed' makes (without conversion). The fueled Phase 5 solve before it makes `fueled`
  // calls: the fewest after which a jump still leaves the fueled phase planned by its own search,
  // not rounded from the exact plan after a stopped one (#693) or given its easy clocks (#694).
  const avoid = { ...shortOfPower, sam: 'avoid' };
  let low = 0,
    high = calculateCounted(avoid).calls;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const stage = calculateCounted(avoid, middle).plan.stages[5];
    const ownSearch =
      stage.feasible && stage.roundedAfterStop === undefined && !stage.fractionalAfterStop;
    if (ownSearch) high = middle;
    else low = middle + 1;
  }
  const fueled = low;
  // A jump right after the fueled solve stops that one attempt, and drops the verdict.
  const avoidCut = calculateCounted(avoid, fueled);
  assert.equal(avoidCut.plan.stages[5].feasible, true, 'the fueled Phase 5 is still planned');
  assert.equal(
    avoidCut.plan.stages[5].fuelVerdict,
    undefined,
    'a stopped attempt gives no verdict',
  );
  const stoppedFirst = avoidCut.calls - fueled;
  // Stop only the first of the two attempts under 'needed': the retry with conversion allows
  // every recipe the first could use, and it proves the plan does not fit, so the verdict stands
  // as on an ordinary machine and the plan does not say the comparison stopped.
  const firstCut = calculateCounted(shortOfPower, fueled, fueled + stoppedFirst).plan;
  assert.deepEqual(firstCut.stages[5].fuelVerdict, verdict, 'the proven verdict is kept');
  assert.ok(
    !firstCut.warnings.some(warning => /could not be compared/.test(warning)),
    'and the plan does not say the comparison stopped',
  );
  // A retry that stops too proves nothing: no verdict, and the plan says the search stopped.
  const bothCut = calculateCounted(shortOfPower, fueled).plan;
  assert.equal(bothCut.stages[5].feasible, true, 'the fueled Phase 5 is still planned');
  assert.equal(bothCut.stages[5].fuelVerdict, undefined, 'a stopped retry gives no verdict');
  assert.ok(
    bothCut.warnings.some(warning =>
      /could not be compared.*search stopped before it could prove the best plan/.test(warning),
    ),
    'the plan says the comparison stopped',
  );
});
