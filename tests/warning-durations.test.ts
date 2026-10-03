// The plan's warnings and draft reasons give phase times in the words ADA, the plan header and
// the Review step use (#740): "about 7 h 52 min", not "about 7.86 hours". Both use the one
// durationOfHours in public/wording.ts (#763; tests/wording.test.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, DEFAULT_LIMITS, warningDuration } from '../planner.ts';
import { durationOfHours } from '../public/app/format.ts';

// The settings of #593 (tests/stopped-search-easy-clocks.test.ts): with the whole-machine searches
// stopped, Phase 5's warnings compare a longer time with the exact plan's 8.33 hours.
const settings = {
  phase: '4',
  recipes: 'standard',
  goal: 'balanced',
  nuclear: 'sink',
  wholeMachines: true,
  multiplier: 5,
  purity: 'impure',
  somersloops: 106,
};
// calculate with every integer search of `phase` stopped, as on a very slow device.
function withStoppedPhase(input: object, phase: number) {
  const dateNow = Date.now;
  let stopped = false,
    calls = 0;
  Date.now = () => (stopped && ++calls > 1 ? dateNow() + 1e9 : dateNow());
  try {
    return calculate(input, started => {
      if (started === phase) stopped = true;
    });
  } finally {
    Date.now = dateNow;
  }
}

test('warning durations match durationOfHours for a range of phase times (#740)', () => {
  const values = [0, 0.001, 1 / 60, 0.0083, 0.25, 0.5, 0.75, 59.4 / 60, 59.6 / 60, 1, 1.0001];
  for (let hours = 0; hours <= 30; hours += 0.0137) values.push(hours);
  values.push(25 / 3, 7.86, 8, 12.5, 100.25, 1999.75, 2000);
  for (const hours of values)
    assert.equal(warningDuration(hours), durationOfHours(hours), `at ${hours} hours`);
  assert.equal(warningDuration(0.75), '45 minutes');
  assert.equal(warningDuration(1 / 60), '1 minute');
  assert.equal(warningDuration(7.86), 'about 7 h 52 min');
  assert.equal(warningDuration(8), 'about 8 h');
});

test('a rounded phase after a stopped search states its time in hours and minutes (#740)', () => {
  const plan = withStoppedPhase({ ...settings, amplifySloops: 106 }, 5);
  const stage = plan.stages['5'];
  assert.equal(stage.roundedAfterStop, 25 / 3);
  const warning = plan.warnings.find(line => line.startsWith('Phase 5: the whole-machine search'));
  assert.ok(warning);
  assert.ok(
    warning.includes(
      `this phase takes ${durationOfHours(stage.hours!)} instead of about 8 h 20 min.`,
    ),
    warning,
  );
  assert.doesNotMatch(warning, /\d hours/);
});

test('easy clocks after a stopped search state their time in hours and minutes (#740)', () => {
  const plan = withStoppedPhase({ ...settings, amplifySloops: 0 }, 5);
  const stage = plan.stages['5'];
  assert.equal(stage.fractionalAfterStop?.target, 25 / 3);
  const warning = plan.warnings.find(line => line.startsWith('Phase 5 is not whole machines'));
  assert.ok(warning);
  assert.ok(
    warning.includes(`It takes ${durationOfHours(stage.hours!)} instead of about 8 h 20 min.`),
    warning,
  );
  assert.doesNotMatch(warning, /\d hours/);
});

test('an over-budget draft names its fitting phase time in hours and minutes (#740)', () => {
  // tests/profiles.test.ts: a squeezed Iron Ore budget makes a quarter-hour Phase 1 a draft.
  const stage = calculate({
    phase: '1',
    goal: 'timed',
    hours: 0.25,
    multiplier: 100,
    storage: 'none',
    limits: { ...DEFAULT_LIMITS, 'Iron Ore': 300 },
  }).stages[1];
  assert.equal(stage.feasible, false);
  assert.ok(stage.minHours);
  assert.ok(
    stage.reason!.includes(
      ` It fits the current budgets at ${durationOfHours(stage.minHours)} for this phase.`,
    ),
    stage.reason,
  );
  assert.doesNotMatch(stage.reason!, /\d hours/);
});
