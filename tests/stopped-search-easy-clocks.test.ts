// When a phase's whole-machine search stops at a solver limit and even the exact plan rounded to
// whole machines (roundedFallback, #693) does not fit within 50% more time, the phase used to be a
// draft. The owner's decision in #593: use fractions then, but easy ones to set (#694). Each
// solid-part line runs whole machines at 100% except the last, at 25%, 50% or 75%, or else at a
// whole number of items per minute; failing both, the exact plan itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, DATA, RAW } from '../planner.ts';
import type { CurrentStage } from '../public/types/index.ts';
import { durationOfHours } from '../public/app/format.ts';

// The settings of #593: with amplification off, whole machines do not fit Phase 5 even 50% longer.
const settings = {
  phase: '4',
  recipes: 'standard',
  goal: 'balanced',
  nuclear: 'sink',
  wholeMachines: true,
  multiplier: 5,
  purity: 'impure',
  somersloops: 106,
  amplifySloops: 0,
};
// Runs calculate with every integer search of `phase` stopped, as on a very slow device (see
// tests/stopped-search-rounding.test.ts): once the phase has set its search deadline, the clock
// jumps far past it. The linear solves are not timed and still run.
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
type Row = NonNullable<CurrentStage['rows']>[number];
// A row the whole-machine fit makes whole: a solid, sinkable, non-raw output, nothing nuclear
// (roundsToWholeMachines in planner.ts).
const roundsWhole = (row: Row) =>
  Object.keys(row.outputs).some(
    item => !DATA.items[item]?.fluid && !RAW.includes(item) && (DATA.items[item]?.sink ?? 0) > 0,
  ) &&
  !/uranium|plutonium|ficsonium|waste|non-fissile/i.test(
    [row.name, ...Object.keys(row.inputs), ...Object.keys(row.outputs)].join(' '),
  );
// Every item the rows use is made by the rows or drawn from a raw budget: the material balance
// was recalculated for the clocks, not just the displayed counts rounded.
function assertBalanced(stage: CurrentStage, label: string) {
  const net: Record<string, number> = {};
  for (const row of stage.rows!) {
    for (const [item, rate] of Object.entries(row.outputs)) net[item] = (net[item] || 0) + rate;
    for (const [item, rate] of Object.entries(row.inputs)) net[item] = (net[item] || 0) - rate;
  }
  for (const [item, draw] of Object.entries(stage.raw || {})) net[item] = (net[item] || 0) + draw;
  for (const [item, rate] of Object.entries(net))
    assert.ok(rate > -0.01, `${label}: ${item} is not used faster than it is made (${rate})`);
}

// #935 lowered Phase 5's power (the Space Elevator parts' Manufacturer and Blender lines), and at
// the settings of #593 the easy clocks now fit at the exact plan's own time. With 30% more power
// per machine they slow it again, the case these tests describe.
const slower = { ...settings, powerFactor: 1.3 };

test('a phase no rounded plan fits gets easy clocks on its last machines (#694)', () => {
  const plan = withStoppedPhase(slower, 5);
  const stage = plan.stages['5'];
  assert.equal(stage.feasible, true, 'the phase is planned, not a draft');
  assert.equal(stage.roundedAfterStop, undefined, 'no whole-machine rounding fit');
  // The exact plan's time: the balanced goal's rounded rates make it 8.33 hours (#708).
  assert.deepEqual(stage.fractionalAfterStop, { target: 25 / 3, clocks: 'easy' });
  const solid = stage.rows!.filter(roundsWhole);
  assert.ok(solid.length > 20, 'with many solid-part lines');
  for (const row of solid)
    assert.ok(
      [25, 50, 75, 100].some(clock => Math.abs(row.lastClock - clock) < 1e-4),
      `${row.name}: the last of ${row.machines} machines runs at an easy clock (${row.lastClock}%)`,
    );
  assert.ok(
    solid.some(row => row.lastClock < 100 - 1e-6),
    'and the phase is not whole machines',
  );
  for (const [resource, draw] of Object.entries(stage.raw || {}))
    assert.ok(draw <= plan.settings.limits[resource]! + 0.01, `${resource} ${draw} within budget`);
  assertBalanced(stage, 'Phase 5');
  // These clocks fit at the target time, where lines rounded to their nearest clock may slow it
  // by at most 5% (the balanced goal's rates make the exact plan itself take 8.33 hours).
  assert.ok(stage.hours! <= (25 / 3) * 1.05 + 0.01, `at most 5% slower (${stage.hours})`);
  const warning = plan.warnings.find(line => line.startsWith('Phase 5 is not whole machines'));
  assert.ok(warning, 'the plan says so');
  assert.match(warning, /stopped before it could prove the best plan/);
  assert.match(warning, /runs at 25%, 50% or 75%/);
  assert.match(warning, /takes about [\d.,]+ h( [\d.,]+ min)? instead of about 8 h 20 min\./);
  assert.doesNotMatch(
    warning,
    /keeps? a precise clock/,
    'every solid-part line is on an easy clock',
  );
  // The other phases searched as usual.
  for (const phase of ['1', '2', '3', '4'] as const)
    assert.equal(plan.stages[phase].fractionalAfterStop, undefined, `Phase ${phase} searched`);
  // Linear solves only: the same plan on every run.
  assert.deepEqual(withStoppedPhase(slower, 5).stages['5'].rows, stage.rows, 'deterministic');
});

test('easy clocks may take longer than the target where they do not fit at it (#701)', () => {
  // Maximum output with the standard recipes runs Phase 5 against its Crude Oil budget: no
  // rounding of its lines fits at the target time or 5% longer. The owner's decision in #701:
  // try longer times, as the whole-machine rounding does, rather than fall back to precise clocks.
  const maximum = { ...settings, goal: 'maximum', multiplier: 2, limitsConfirmed: true };
  const plan = withStoppedPhase(maximum, 5);
  const stage = plan.stages['5'];
  const exact = calculate({ ...maximum, wholeMachines: false }).stages['5'];
  assert.equal(stage.feasible, true, 'the phase is planned, not a draft');
  assert.equal(stage.roundedAfterStop, undefined, 'no whole-machine rounding fit');
  assert.equal(stage.fractionalAfterStop?.target, exact.hours, 'the target is the exact time');
  assert.notEqual(stage.fractionalAfterStop?.clocks, 'precise', 'easy-to-set clocks');
  assert.ok(stage.hours! > exact.hours! * 1.05, `more than 5% longer (${stage.hours})`);
  assert.ok(stage.hours! <= exact.hours! * 1.5 + 1e-6, `at most 50% longer (${stage.hours})`);
  for (const [resource, draw] of Object.entries(stage.raw || {}))
    assert.ok(draw <= plan.settings.limits[resource]! + 0.01, `${resource} ${draw} within budget`);
  assertBalanced(stage, 'Phase 5');
  // The warning states the longer time against the target, as ADA does.
  const warning = plan.warnings.find(line => line.startsWith('Phase 5 is not whole machines'));
  assert.ok(warning, 'the plan says so');
  assert.match(warning, /its exact plan with easy clocks/);
  assert.ok(
    warning.includes(
      `It takes ${durationOfHours(stage.hours!)} instead of ${durationOfHours(exact.hours!)}.`,
    ),
    warning,
  );
  assert.deepEqual(withStoppedPhase(maximum, 5).stages['5'].rows, stage.rows, 'deterministic');
});

test('a phase no clock rounding fits is its exact plan, said so plainly (#694)', () => {
  // Maximum output with all recipes runs Phase 3 in minutes, and no rounding of its lines fits
  // even 50% longer: the phase is the exact plan with its precise clocks.
  const maximum = {
    ...settings,
    recipes: 'all',
    goal: 'maximum',
    multiplier: 1,
    limitsConfirmed: true,
  };
  const plan = withStoppedPhase(maximum, 3);
  const stage = plan.stages['3'];
  const exact = calculate({ ...maximum, wholeMachines: false }).stages['3'];
  assert.equal(stage.feasible, true, 'the phase is planned, not a draft');
  assert.deepEqual(stage.fractionalAfterStop, { target: exact.hours, clocks: 'precise' });
  assert.equal(stage.hours, exact.hours, 'at the exact plan’s time');
  assert.deepEqual(
    stage.rows!.map(row => [row.id, row.equivalent]),
    exact.rows!.map(row => [row.id, row.equivalent]),
    'with the exact plan’s lines',
  );
  const warning = plan.warnings.find(line => line.startsWith('Phase 3 is not whole machines'));
  assert.ok(warning);
  assert.match(warning, /its exact plan, with precise clocks/);
});

test('a phase whose search finishes gets no easy clocks', () => {
  const plan = calculate({ ...settings, phase: '3', multiplier: 1 });
  for (const stage of Object.values(plan.stages)) {
    assert.equal(stage.feasible, true);
    assert.equal(stage.fractionalAfterStop, undefined);
  }
  assert.ok(!plan.warnings.some(line => /is not whole machines/.test(line)));
});
