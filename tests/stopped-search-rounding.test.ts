// When a phase's whole-machine search stops at a solver limit (the node limit, the 30-second
// backstop or the phase's deadline) while the exact fractional plan fits, the phase used to be a
// draft: "The whole-machine search stopped before it could prove the best plan" (#593). The
// owner's decision: round the exact plan to whole machines instead, letting the phase take
// slightly longer where it must (#693). A phase whose search finishes keeps its plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, DATA, RAW } from '../planner.ts';
import type { CurrentStage, StageKey } from '../public/types/index.ts';
import { STANDARD_BEFORE_1044 } from './helpers/standard-before-1040.ts';

// The issue's settings, on the standard recipes as they were before #1044: the two recipes it
// added to them (Polyester Fabric and Distilled Silica) are no line of these plans, but the wider
// pool lets the solver settle on another of its equal plans, and #714's Phase 5 then rounds
// without the Rubber line these tests describe.
const settings = {
  phase: '4',
  ...STANDARD_BEFORE_1044,
  goal: 'balanced',
  nuclear: 'sink',
  wholeMachines: true,
  multiplier: 5,
  purity: 'impure',
  somersloops: 106,
  amplifySloops: 106,
};
// Runs calculate with every integer search of `phase` stopped, as on a very slow device: once the
// phase has set its search deadline, the clock jumps far past it, so each search of that phase
// ends as 'Time limit reached' without running. The linear solves are not timed and still run.
// Later phases set their deadline on the jumped clock and search as usual. Deterministic, since
// no search is cut off part way.
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
// A row the whole-machine fit makes whole: a solid, sinkable, non-raw output, nothing nuclear
// (roundsToWholeMachines in planner.ts).
const roundsWhole = (row: NonNullable<CurrentStage['rows']>[number]) =>
  Object.keys(row.outputs).some(
    item => !DATA.items[item]?.fluid && !RAW.includes(item) && (DATA.items[item]?.sink ?? 0) > 0,
  ) &&
  !/uranium|plutonium|ficsonium|waste|non-fissile/i.test(
    [row.name, ...Object.keys(row.inputs), ...Object.keys(row.outputs)].join(' '),
  );
// The stage is a whole-machine plan within the plan's budgets, apart from the `fractional` lines.
function assertWholePlan(
  stage: CurrentStage,
  limits: Record<string, number>,
  label: string,
  fractional: string[] = [],
) {
  assert.equal(stage.feasible, true, `${label} is planned`);
  const rows = stage.rows!;
  assert.ok(rows.length, `${label} has rows`);
  for (const row of rows.filter(row => roundsWhole(row) && !fractional.includes(row.name))) {
    assert.ok(
      Math.abs(row.equivalent - Math.round(row.equivalent)) < 1e-6,
      `${label}: ${row.name} runs whole machines (${row.equivalent})`,
    );
    assert.equal(row.lastClock, 100, `${label}: ${row.name} runs at 100%`);
  }
  for (const [resource, draw] of Object.entries(stage.raw || {}))
    assert.ok(draw <= limits[resource]! + 0.01, `${label}: ${resource} ${draw} within budget`);
  assert.ok((stage.sloopsUsed || 0) <= 106, `${label} stays within the somersloop budget`);
}

test('a stopped whole-machine search is rounded from the exact plan at the target time (#593)', () => {
  const plan = withStoppedPhase(settings, 4);
  const stage = plan.stages['4'];
  assertWholePlan(stage, plan.settings.limits, 'Phase 4');
  const exact = calculate({ ...settings, wholeMachines: false, amplifySloops: 0 }).stages['4'];
  assert.equal(stage.roundedAfterStop, exact.hours, 'it records the exact plan’s time (#708)');
  assert.ok(stage.hours! <= 8.01, 'and keeps it');
  assert.equal(stage.amplificationDropped, undefined, 'the amplified rounding fits');
  assert.ok((stage.sloopsUsed || 0) > 0, 'with somersloops placed');
  const warning = plan.warnings.find(line => line.startsWith('Phase 4: the whole-machine search'));
  assert.ok(warning, 'the plan says what happened');
  assert.match(warning, /stopped before it could prove the best plan/);
  assert.match(warning, /rounded to whole machines/);
  assert.doesNotMatch(warning, /instead of/, 'no longer time is claimed');
  // The phases whose searches ran are not rounded.
  for (const phase of ['1', '2', '3', '5'] as StageKey[])
    assert.equal(plan.stages[phase].roundedAfterStop, undefined, `Phase ${phase} is not rounded`);
  // Linear solves only: the same plan on every run.
  const again = withStoppedPhase(settings, 4);
  assert.deepEqual(again.stages['4'].rows, stage.rows, 'the rounded plan is deterministic');
});

test('a line rounds to its nearest whole count, so the phase may take slightly longer (#693)', () => {
  // The owner's correction in #593: round each line to the nearest whole count, which may be
  // lower, and let the phase take slightly longer, rather than always rounding up.
  const plan = withStoppedPhase(settings, 4);
  const stage = plan.stages['4'];
  const exact = calculate({ ...settings, wholeMachines: false, amplifySloops: 0 }).stages['4'];
  // Machine-equivalents of a recipe's line, an amplified machine counting twice.
  const line = (of: CurrentStage, id: string) =>
    of
      .rows!.filter(row => row.id.replace(/^amp:/, '') === id)
      .reduce((total, row) => total + row.equivalent * (row.amplified ? 2 : 1), 0);
  const delivered = Object.keys(stage.delivery!);
  const roundedDown = exact.rows!.filter(
    row =>
      Object.keys(row.outputs).some(item => delivered.includes(item)) &&
      line(stage, row.id) < row.equivalent - 1e-6 &&
      line(stage, row.id) >= Math.floor(row.equivalent),
  );
  assert.ok(roundedDown.length, 'a delivered part’s line is rounded down to its nearest count');
  assert.ok(stage.hours! > exact.hours! + 0.01, `so the phase takes longer (${stage.hours})`);
  assert.ok(stage.hours! <= 8 * 1.05, 'but at most 5% longer than its target at the target time');
  assertWholePlan(stage, plan.settings.limits, 'Phase 4');
});

test('the issue’s Phase 5 is rounded to whole machines and takes slightly longer (#593)', () => {
  // On an ordinary machine the amplified search fits Phase 5 at 8 hours, and without amplification
  // whole machines do not fit these budgets at all. With the searches stopped, the phase was a
  // draft; now it is the exact plan rounded to whole machines, at a longer time that fits.
  const plan = withStoppedPhase(settings, 5);
  const stage = plan.stages['5'];
  assertWholePlan(stage, plan.settings.limits, 'Phase 5');
  // The balanced goal's rounded rates make the exact plan itself take 8.33 hours (#708).
  assert.equal(stage.roundedAfterStop, 25 / 3);
  assert.ok(stage.hours! > 8.01 && stage.hours! <= 12.01, `at most 50% longer (${stage.hours})`);
  assert.ok((stage.sloopsUsed || 0) > 0, 'with somersloops placed');
  const warning = plan.warnings.find(line => line.startsWith('Phase 5: the whole-machine search'));
  assert.ok(warning);
  assert.match(
    warning,
    /this phase takes about [\d.,]+ h( [\d.,]+ min)? instead of about 8 h 20 min\b/,
  );
  // The shortest time that fits is used: a smaller multiplier needs less extra time.
  const smaller = withStoppedPhase({ ...settings, multiplier: 4 }, 5).stages['5'];
  assertWholePlan(smaller, plan.settings.limits, 'Phase 5 at multiplier 4');
  assert.ok(smaller.hours! < stage.hours!, `${smaller.hours} is sooner than ${stage.hours}`);
});

test('a line that shares a fluid with another whole line keeps a fractional clock (#593)', () => {
  // All alternates: Rubber and Petroleum Coke share Heavy Oil Residue, which balances exactly, so
  // rounding one up leaves the other fractional, pass after pass. The line that keeps coming back
  // is left fractional; the plan names it, and every other solid-part line is whole.
  const plan = withStoppedPhase({ ...settings, recipes: 'all', multiplier: 2 }, 5);
  const stage = plan.stages['5'];
  const warning = plan.warnings.find(line => line.startsWith('Phase 5: the whole-machine search'));
  assert.ok(warning);
  const named = /\. ([^.]+) shares? a fluid with another whole-machine line/.exec(warning);
  assert.ok(named, 'the warning names the fractional lines');
  const fractional = named[1]!.split(/, | and /);
  assertWholePlan(stage, plan.settings.limits, 'Phase 5', fractional);
  for (const name of fractional) {
    const row = stage.rows!.find(candidate => candidate.name === name);
    assert.ok(row && row.lastClock < 100, `${name} is fractional`);
  }
});

test('only lines tied by a fluid are said to share one; the others were raised by their chain (#714)', () => {
  // Compacted Coal and Rocket Fuel share no fluid with another whole-machine line of this plan:
  // they reach the raise limit because each line they feed that is rounded up raises them again. The
  // warning used to say they share a fluid. (Iron Plate was raised too before #935 corrected the
  // Space Elevator parts' power, which changed this plan's network.)
  const issue = { ...settings, nuclear: 'recycle', multiplier: 1, amplifySloops: 0 };
  const warning = withStoppedPhase(issue, 5).warnings.find(line =>
    line.startsWith('Phase 5: the whole-machine search'),
  );
  assert.ok(warning);
  assert.doesNotMatch(warning, /shares? a fluid/, 'no line is said to share a fluid');
  assert.match(
    warning,
    /Compacted Coal and Rocket Fuel kept being rounded up as the lines they feed were rounded, so they keep a fractional clock on the last machine\./,
  );
  // Rubber makes Heavy Oil Residue and Petroleum Coke takes it, which balances exactly: Rubber is
  // still said to share a fluid, and Aluminum Ingot, raised by the lines it feeds, is worded
  // apart. (The standard recipes at three times the costs showed this until #1064, whose power
  // model changed that plan; every alternate at the issue's costs shows it now.)
  const tied = withStoppedPhase({ ...issue, recipes: 'all', amplifySloops: 0 }, 5);
  const both = tied.warnings.find(line => line.startsWith('Phase 5: the whole-machine search'));
  assert.ok(both);
  assert.match(
    both,
    /\. Rubber and [^.]+ share a fluid with another whole-machine line, so they keep/,
  );
  assert.match(both, /\. [^.]*\bAluminum Ingot[^.]* kept being rounded up as the lines they feed/);
  assert.doesNotMatch(both, /Aluminum Ingot[^.]*shares? a fluid/);
  const rubber = tied.stages['5'].rows!.find(row => row.name === 'Rubber');
  assert.ok(rubber && rubber.outputs['Heavy Oil Residue'], 'Rubber makes Heavy Oil Residue');
  assert.ok(
    tied.stages['5'].rows!.some(
      row => row.name === 'Petroleum Coke' && row.inputs['Heavy Oil Residue'],
    ),
    'and Petroleum Coke takes it',
  );
});

test('a phase no rounding fits within 50% longer is not rounded to whole machines', () => {
  // Without amplification the issue's Phase 5 needs about twice the time in whole machines. It
  // gets easy clocks instead (#694, tests/stopped-search-easy-clocks.test.ts).
  const stage = withStoppedPhase({ ...settings, amplifySloops: 0 }, 5).stages['5'];
  assert.equal(stage.roundedAfterStop, undefined);
  assert.equal(stage.fractionalAfterStop?.clocks, 'easy');
});

test('a phase whose search finishes is not rounded', () => {
  const plan = calculate({ ...settings, phase: '3', multiplier: 1 });
  for (const stage of Object.values(plan.stages)) {
    assert.equal(stage.feasible, true);
    assert.equal(stage.roundedAfterStop, undefined);
  }
  assert.ok(!plan.warnings.some(line => /exact plan is rounded to/.test(line)));
});
