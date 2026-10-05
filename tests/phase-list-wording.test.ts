// Plan warnings list phases and items as prose, "Phases 2, 3, 4 and 5", not
// "Phases 2 and 3 and 4 and 5" (#611).
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, listNames } from '../planner.ts';

test('listNames joins one, two and more names as prose', () => {
  assert.equal(listNames(['2']), '2');
  assert.equal(listNames(['2', '3']), '2 and 3');
  assert.equal(listNames(['2', '3', '4']), '2, 3 and 4');
  assert.equal(listNames(['2', '3', '4', '5']), '2, 3, 4 and 5');
});

// Runs `body` on a clock that moves `step` milliseconds every time it is read, so the solver's
// clock backstop stops the amplified searches the same on every machine (the technique of
// tests/solver-wording.test.ts). Only performance.now ticks, the clock HiGHS reads.
function onTickingClock<T>(step: number, body: () => T): T {
  const now = performance.now;
  const start = now.call(performance);
  let reads = 0;
  performance.now = () => start + ++reads * step;
  try {
    return body();
  } finally {
    performance.now = now;
  }
}

test('the issue’s dropped amplification lists Phases 2, 3, 4 and 5', () => {
  // The issue's settings: whole machines, 106 somersloops for amplification and 13.3 Circuit
  // Boards/min of production already run, with every amplified fit cut off (a step of 40 since
  // #1064, whose power model made the searches longer: at 100 Phase 3's own fit stops too).
  const result = onTickingClock(40, () =>
    calculate({
      phase: '5',
      goal: 'balanced',
      wholeMachines: true,
      limitsConfirmed: true,
      somersloops: 106,
      amplifySloops: 106,
      existingSupply: { 'Circuit Board': 13.3 },
    }),
  );
  const warning = result.warnings.find(text => /could not fit production amplification/.test(text));
  assert.ok(warning, 'the plan warns that amplification was dropped');
  assert.match(warning, /^Phases 2, 3, 4 and 5 could not fit production amplification/);
  assert.doesNotMatch(warning, /\d and \d and/);
});
