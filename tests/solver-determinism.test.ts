// The integer search stops at a node count, not at the clock (#558), so the same settings give the
// same plan on every run, however busy or slow the machine is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../planner.ts';

// Whole machines plus amplification, Phase 4, nuclear 'sink': one integer search here needs about
// 2,650 branch-and-bound nodes, some 2.5 seconds on a fast machine. Under the old 3-second clock it
// finished on a quiet machine and ran out on a busy one, which dropped amplification for that
// phase, so run after run gave one of two plans.
const settings = {
  phase: '4',
  nuclear: 'sink',
  recipes: 'all',
  goal: 'balanced',
  wholeMachines: true,
  somersloops: 106,
  amplifySloops: 24,
};
const planJson = () => {
  const { createdAt, ...plan } = calculate(settings);
  assert.ok(createdAt, 'the plan is stamped');
  return JSON.stringify(plan);
};
// Runs `body` on a machine that seems `factor` times slower: the solver reads the time through
// performance.now and Date.now, so both run `factor` times faster while it works.
function onSlowerMachine<T>(factor: number, body: () => T): T {
  const now = performance.now,
    dateNow = Date.now;
  const start = now.call(performance),
    dateStart = dateNow();
  performance.now = () => start + (now.call(performance) - start) * factor;
  Date.now = () => dateStart + (dateNow() - dateStart) * factor;
  try {
    return body();
  } finally {
    performance.now = now;
    Date.now = dateNow;
  }
}

test('whole machines with amplification give the same plan on every run and machine (#558)', () => {
  // Three runs of about 3 seconds each: enough to compare, few enough for CI. Every run redoes the
  // search, since the search is what used to vary. A busy machine rarely made the old clock run
  // out on CI's fast runners, so the third run fakes a machine three times slower: the old limit
  // then cut the search off every time, while the node limit reaches the same plan (and the clock's
  // backstop, 30 seconds, still leaves it ten real seconds).
  const plans = [planJson(), planJson(), onSlowerMachine(3, planJson)];
  // assert.ok, not equal: a failure would otherwise print both plans, some 80 kB each.
  assert.ok(plans[1] === plans[0], 'the second run gave another plan');
  assert.ok(plans[2] === plans[0], 'a slower machine gave another plan');
  const { stages } = JSON.parse(plans[0]!) as ReturnType<typeof calculate>;
  for (const [phase, stage] of Object.entries(stages)) {
    assert.equal(stage.feasible, true, `phase ${phase} is planned`);
    assert.equal(stage.amplificationDropped, undefined, `phase ${phase} keeps its amplification`);
  }
  assert.equal(stages[4].sloopsUsed, 24, 'Phase 4 places its whole somersloop budget');
});
