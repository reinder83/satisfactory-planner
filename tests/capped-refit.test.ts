// #1094: a capped re-solve (fullSpeed, and resolveEarlierPhases under phaseTime 'final') fits in
// two steps (planner/fit.ts): the exact LP picks the recipe network, then the integer fit solves over
// only that network. A looser cap could make the exact LP swap a recipe the stage builds for another,
// the integer fit over the new network was then infeasible, and the caller read that as "this phase
// cannot finish sooner". The fit now tries once more over the network widened with the recipes the
// caps allow (cappedRetry), only when the first fit is proven infeasible. The settings are those of
// tests/fixtures/on-site-sunk-central-2026-10-05.json (synthetic).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate, run, settings } from '../planner.ts';
import { stageSettings, withinRates } from '../planner/on-site.ts';
import { pullFinalPhaseForward } from '../planner/adjustments.ts';
import type { PhaseStages } from '../planner/calculate.ts';
import type { Solved } from '../planner/types.ts';
import type { CurrentSettings, StoredCalculatedPlan } from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const recorded: { plan: StoredCalculatedPlan } = JSON.parse(
  fs.readFileSync('tests/fixtures/on-site-sunk-central-2026-10-05.json', 'utf8'),
);
// The stored settings with every central line of Phases 3-5 but the Quickwire ones at exact
// clocks, as in tests/on-site-overflow.test.ts.
const exactClockSettings = (): CurrentSettings => {
  const input = json(recorded.plan.settings);
  input.exactClocks = Object.fromEntries(
    (['3', '4', '5'] as const).map(phase => [
      phase,
      (recorded.plan.stages[phase].rows || [])
        .filter(line => !line.onSite && !line.id.startsWith('amp:') && !line.outputs.Quickwire)
        .map(line => line.id),
    ]),
  );
  return input;
};
const SOONER = (phases: string) =>
  `Your target time applies to Phase 5. Earlier phases run their lines as hard as the machines a later phase already builds allow, so ${phases} sooner; no building is added that a later phase does not keep. Delivery rates for those phases are not rounded.`;

test('a looser cap never turns a capped re-solve that fits into Infeasible (#1094)', () => {
  const input = exactClockSettings();
  const plan = calculate(json(input));
  const config = settings(json(input));
  const stage = plan.stages['3'] as Solved;
  const own = Object.fromEntries(stage.rows.map(row => [row.id, row.machines]));
  const resolve = (caps: Record<string, number>) =>
    withinRates(stageSettings(config, stage), 3, settingsFor =>
      run(settingsFor, 3, { maximum: true, caps }),
    );
  // Each cap set allows everything the one before does, and more. Both machines the last two add
  // are built by Phases 4 and 5, so resolveEarlierPhases passes such caps.
  const steps: [string, Record<string, number>][] = [
    ["Phase 3's own machines", own],
    ['and 16 Rubber', { ...own, Recipe_Rubber_C: 16 }],
    ['and 2 Caterium Wire', { ...own, Recipe_Rubber_C: 16, Recipe_Alternate_Wire_2_C: 2 }],
  ];
  let before = Infinity;
  const hours: number[] = [];
  for (const [label, caps] of steps) {
    const result = resolve(caps);
    // On main the last one was Infeasible: the exact LP chose Caterium Wire over Fused Wire, and
    // the integer fit over that network alone did not fit.
    assert.ok(result.feasible, `${label}: ${result.feasible || result.solverStatus}`);
    assert.ok(result.hours <= before + 1e-6, `${label}: ${result.hours} h after ${before} h`);
    for (const row of result.rows)
      assert.ok(row.machines <= (caps[row.id] ?? 0), `${label}: ${row.id} within its cap`);
    before = result.hours;
    hours.push(result.hours);
  }
  // The first two fit the first time and come out exactly as on main; the third as the second.
  assert.equal(hours[0], 7.027092474721822);
  assert.equal(hours[1], 5.73889278927325);
  assert.ok(Math.abs(hours[2]! - hours[1]!) < 1e-6, `${hours[2]} h`);
});

test("under phaseTime 'final' with minimal construction, Phase 3 is pulled ahead, not reported as unable to (#1094)", () => {
  const plan = calculate({ ...json(recorded.plan.settings), goal: 'minimal', phaseTime: 'final' });
  // On main Phase 3's capped re-solve came back Infeasible, so it stayed at 8.33 hours and the
  // plan said "No earlier phase could finish sooner within the machines its later phases already
  // build."
  const third = plan.stages['3'];
  assert.ok(Math.abs(third.hours! - 50 / 9) < 1e-6, `Phase 3: ${third.hours} h`);
  assert.equal(third.aheadOf, 25 / 3);
  assert.ok(plan.warnings.includes(SOONER('Phase 3 finishes')), plan.warnings.join('\n'));
  // The other phases keep their plans.
  for (const phase of ['1', '2', '4', '5'] as const)
    assert.equal(plan.stages[phase].aheadOf, undefined, `Phase ${phase}`);
});

test("under phaseTime 'final', a phase whose own plan is not pulled ahead keeps its first plan when that one is (#1092)", () => {
  // Since #1094 the routed Phase 3 of the exact-clock plan at twice the costs is pulled ahead
  // itself, so calculate() no longer needs its first plan (`unrouted`, withOverflow) there. Hand
  // resolveEarlierPhases that routed plan as the first plan, beside a Phase 3 that cannot be pulled
  // ahead: the same plan without its route, whose central Quickwire line no phase builds.
  const input = { ...exactClockSettings(), multiplier: 2 };
  const plan = calculate(json(input));
  const config = settings({ ...json(input), phaseTime: 'final' });
  const stages: PhaseStages = json(plan.stages);
  const first = json(plan.stages['3']) as Solved;
  assert.deepEqual(first.onSiteOverflow, { 'fg-alpha1': ['Quickwire'] });
  const { onSiteOverflow: _route, ...unroutable } = first;
  stages[3] = unroutable;
  const warnings = pullFinalPhaseForward(config, stages, { 3: first });
  const third = stages[3]!;
  assert.ok(Math.abs(third.hours! - 6.680306587761387) < 1e-6, `Phase 3: ${third.hours} h`);
  assert.equal(third.aheadOf, first.hours);
  assert.ok(warnings[0]!.includes(SOONER('Phases 3 and 4 finish')), warnings[0]);
});
