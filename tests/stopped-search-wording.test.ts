// How the plan and ADA describe a phase rounded after its whole-machine search stopped
// (roundedFallback in planner.ts, #593).
// #698: at each time the fallback tries the nearest rounding and the plan with every line rounded
// up, and uses the rounded-up one where the nearest does not fit or is not leaner (in the issue's
// Phase 5, only the rounded-up plan fits, #695). So neither may say "rounded to the nearest".
// #708: under the balanced goal the rounded rates make the exact plan itself take 8.33 hours, so
// "instead of 8" blamed the rounding for time it did not add. The stage records the exact plan's
// time and the sentence compares with that.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../planner.ts';
import { adaRemarks } from '../public/ada.ts';

// The settings of #593.
const settings = {
  phase: '4',
  recipes: 'standard',
  goal: 'balanced',
  nuclear: 'sink',
  wholeMachines: true,
  multiplier: 5,
  purity: 'impure',
  somersloops: 106,
  amplifySloops: 106,
};
// Runs calculate with every integer search of `phase` stopped, as on a very slow device (see
// tests/stopped-search-rounding.test.ts).
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

test('a phase rounded after a stopped search is not said to be rounded to the nearest (#698)', () => {
  const plan = withStoppedPhase(settings, 5);
  assert.notEqual(plan.stages['5'].roundedAfterStop, undefined, 'Phase 5 is rounded');
  const warning = plan.warnings.find(line => line.startsWith('Phase 5: the whole-machine search'));
  assert.ok(warning);
  assert.match(warning, /its exact plan is rounded to whole machines instead\./);
  assert.doesNotMatch(warning, /nearest/);
  const remark = adaRemarks({
    phaseLabel: 'Phase 5',
    hours: '11.9 h',
    rounded: { target: '8.33 h', longer: true },
  }).find(line => line.id === 'rounded-after-stop');
  assert.ok(remark);
  assert.match(remark.text, /this phase is the exact plan rounded to whole machines, and it takes/);
  assert.doesNotMatch(remark.text, /nearest/);
});

test('a phase rounded after a stopped search is compared with its exact plan’s time (#708)', () => {
  // Phase 3 at multiplier 2: the balanced goal's rates make the exact plan take 8.33 hours, and
  // the rounded plan takes as long. It used to say "about 8.33 hours instead of 8".
  const input = { ...settings, multiplier: 2 };
  const plan = withStoppedPhase(input, 3);
  const stage = plan.stages['3'];
  const exact = calculate({ ...input, wholeMachines: false, amplifySloops: 0 }).stages['3'];
  assert.ok(exact.hours! > 8.08, `the exact plan takes longer than 8 hours (${exact.hours})`);
  assert.equal(stage.roundedAfterStop, exact.hours, 'the stage records the exact plan’s time');
  assert.ok(stage.hours! <= exact.hours! * 1.01, `the rounding adds no time (${stage.hours})`);
  const warning = plan.warnings.find(line => line.startsWith('Phase 3: the whole-machine search'));
  assert.ok(warning);
  assert.doesNotMatch(warning, /instead of/, 'no longer time is claimed');
  // Where the rounding does slow the phase, the warning compares with the exact plan's 8.33.
  const slower = withStoppedPhase(settings, 5);
  const longer = slower.warnings.find(line => line.startsWith('Phase 5: the whole-machine search'));
  assert.ok(longer);
  assert.match(
    longer,
    /this phase takes about [\d.,]+ h( [\d.,]+ min)? instead of about 8 h 20 min\b/,
  );
});

test('easy clocks after a stopped search are compared with the exact plan’s time (#708)', () => {
  const plan = withStoppedPhase({ ...settings, amplifySloops: 0 }, 5);
  const stage = plan.stages['5'];
  const exact = calculate({ ...settings, wholeMachines: false, amplifySloops: 0 }).stages['5'];
  assert.equal(stage.fractionalAfterStop?.target, exact.hours);
  const warning = plan.warnings.find(line => line.startsWith('Phase 5 is not whole machines'));
  assert.ok(warning);
  assert.ok(stage.hours! > exact.hours! * 1.01, `the easy clocks slow it (${stage.hours})`);
  assert.match(warning, /It takes about [\d.,]+ h( [\d.,]+ min)? instead of about 8 h 20 min\./);
});
