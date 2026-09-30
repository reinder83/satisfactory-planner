// The integer search stops at a branch-and-bound node limit, with a clock only as a far-off
// backstop (#558), so the messages shown when it stops must not speak of a time limit (#588).
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../planner.ts';

const STOPPED = /search stopped before it could prove the best plan/i;
const OLD = /time limit/i;

// Runs `body` on a clock that moves `step` milliseconds every time it is read, so the solver's
// clock backstop stops the searches that read it often enough, the same on every machine (the
// technique of tests/amplified-supply-fallback.test.ts).
function onTickingClock<T>(step: number, body: () => T): T {
  const now = performance.now,
    dateNow = Date.now;
  const start = now.call(performance),
    dateStart = dateNow();
  let reads = 0;
  performance.now = () => start + ++reads * step;
  Date.now = () => dateStart + ++reads * step;
  try {
    return body();
  } finally {
    performance.now = now;
    Date.now = dateNow;
  }
}

const settings = {
  phase: '3',
  goal: 'balanced',
  wholeMachines: true,
  limitsConfirmed: true,
  somersloops: 106,
  existingSupply: { 'Circuit Board': 13.3 },
};

test('a dropped amplification says the search stopped, not that a time limit ran out', () => {
  const result = onTickingClock(100, () => calculate({ ...settings, amplifySloops: 106 }));
  assert.equal(result.stages[3].amplificationDropped, true, 'the amplified searches stopped');
  const warning = result.warnings.find(text => /could not fit production amplification/.test(text));
  assert.ok(warning, 'the plan warns that amplification was dropped');
  assert.match(warning, STOPPED);
  assert.doesNotMatch(warning, OLD);
});

test('a stopped whole-machine search says so without naming a time limit', () => {
  const result = onTickingClock(100000, () => calculate({ ...settings, amplifySloops: 0 }));
  const stage = result.stages[3];
  assert.equal(stage.feasible, false, 'every whole-machine search stopped at once');
  assert.match(stage.reason || '', STOPPED);
  assert.match(stage.reason || '', /no resource shortage has been established/);
  assert.doesNotMatch(stage.reason || '', OLD);
});
