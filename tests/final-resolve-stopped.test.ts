// With phaseTime 'final', calculate re-solves Phases 1 to 4 after the Phase 5 solve, to see whether
// each can finish sooner within the machines its later phases already build. Those re-solves share
// Phase 5's search deadline (#592), so on a slow device they can stop before they find a plan. A
// stopped search proves nothing, yet the plan said "No earlier phase could finish sooner" (#650).
// It now keeps those phases' own plans and says the search stopped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../planner.ts';

// Whole machines: every re-solve is an integer search, and with a target time of 12 hours Phase 3
// finishes sooner. (Under the balanced goal it used to be Phases 2 to 4, but only because their own
// plans' times came from the goal's rates; since all a part's whole-machine output goes to the
// elevator, #1062, those plans are as fast as the re-solves. The minimal goal pulled Phase 3 until
// #1064, whose power model changed those plans.)
const settings = {
  phase: '5',
  recipes: 'all',
  goal: 'timed',
  hours: 12,
  wholeMachines: true,
  sam: 'avoid',
  phaseTime: 'final',
};
// Runs calculate while counting the Date.now calls from Phase 5's start: the phase's deadline and
// every integer search's time left are read through it. After `jumpAfter` calls the clock jumps
// far past the deadline, so every later search stops as 'Time limit reached' without running.
// The count is exact because the searches stop at a node count, not at the clock.
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
const targetWarning = (warnings: string[]) =>
  warnings.find(warning => warning.startsWith('Your target time applies to Phase 5.'));

test('stopped phaseTime final re-solves are not reported as "could not finish sooner" (#650)', () => {
  const full = calculateCounted(settings);
  const pulled = ['3'] as const;
  for (const phase of pulled)
    assert.ok(full.plan.stages[phase].aheadOf, `on an ordinary machine Phase ${phase} is pulled`);
  // The Phase 5 solve on its own makes as many calls as with a target time on every phase, so the
  // re-solves make the rest. Jump the clock exactly between the two.
  const every = calculateCounted({ ...settings, phaseTime: 'every' });
  const cut = calculateCounted(settings, every.calls);
  for (const phase of ['1', '2', '3', '4', '5'] as const) {
    assert.equal(cut.plan.stages[phase].feasible, true, `Phase ${phase} is still planned`);
    assert.equal(cut.plan.stages[phase].aheadOf, undefined, `Phase ${phase} is not pulled`);
    assert.equal(
      cut.plan.stages[phase].hours,
      every.plan.stages[phase].hours,
      `Phase ${phase} keeps its own target time`,
    );
  }
  const warning = targetWarning(cut.plan.warnings);
  assert.ok(warning, 'the plan still explains the target time');
  assert.doesNotMatch(
    warning,
    /^Your target time applies to Phase 5\. No earlier phase could finish sooner/,
    'no claim that every earlier phase was checked',
  );
  assert.match(
    warning,
    /For Phases 2, 3 and 4, the search stopped before it could prove the best plan.*has not been checked/,
    'the plan names the phases whose search stopped',
  );
});

test('a proven phaseTime final result keeps its wording', () => {
  const warning = targetWarning(calculate({ phaseTime: 'final' }).warnings);
  assert.ok(warning);
  assert.doesNotMatch(warning, /search stopped/);
});
