// Each alternate recipe's unlock step is listed once, in the first planned phase whose lines use
// it (hardDriveTasks in public/progression.ts, #870), as each milestone is listed once (#758).
// Before, a recipe that Phase 3 and Phase 4 both used was a step of both, with the same check key,
// so ticking it while working on Phase 3 made Phase 4 look started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { phaseSteps } from '../public/progression.ts';
import { initialState, planStepIds, profilePhases } from '../public/state.ts';
import { calculate } from '../planner.ts';
import type {
  CalcRow,
  CurrentCalculatedPlan,
  Progression,
  StageKey,
} from '../public/types/index.ts';

const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const PLANNED = ['3', '4', '5'] as const;
const unlockIds = (plan: CurrentCalculatedPlan, phase: string, checks = {}) =>
  phaseSteps(plan, { checks }, data, phase)
    .map(step => step.id)
    .filter(id => id.startsWith('recipe-unlock-'));
const alternatesOf = (plan: CurrentCalculatedPlan, phase: StageKey) =>
  (plan.stages[phase].rows ?? []).filter(row => row.alternate);

let made: CurrentCalculatedPlan | undefined;
// A profile made for Phase 3 with every alternate allowed, made once for the file.
const phaseThreePlan = () => structuredClone((made ??= calculate({ phase: '3', recipes: 'all' })));

test('an alternate several phases use is one step, in the first phase that uses it', () => {
  const plan = phaseThreePlan();
  const firstUse = new Map<string, string>();
  for (const phase of PLANNED)
    for (const row of alternatesOf(plan, phase))
      if (!firstUse.has(row.id)) firstUse.set(row.id, phase);
  const shared = alternatesOf(plan, '4').filter(row => firstUse.get(row.id) === '3');
  assert.ok(shared.length, 'the fixture plan uses an alternate in Phases 3 and 4');
  const listedIn = new Map<string, string[]>();
  for (const phase of PLANNED)
    for (const id of unlockIds(plan, phase)) listedIn.set(id, [...(listedIn.get(id) ?? []), phase]);
  assert.deepEqual(
    new Set(listedIn.keys()),
    new Set([...firstUse.keys()].map(id => 'recipe-unlock-' + id)),
    'every alternate the plan uses still has its unlock step',
  );
  for (const [recipe, phase] of firstUse)
    assert.deepEqual(listedIn.get('recipe-unlock-' + recipe), [phase], recipe + ' once');
  // Post-game plans Phase 5's stage and lists what Phase 5 lists.
  assert.deepEqual(unlockIds(plan, 'post'), unlockIds(plan, '5'));
});

test('a phase with no new alternate has no hard-drive step', () => {
  const plan = phaseThreePlan();
  // Phase 4 builds only lines Phase 3 already uses an alternate for.
  plan.stages['4'] = { ...plan.stages['4'], rows: alternatesOf(plan, '3') };
  const four = phaseSteps(plan, { checks: {} }, data, '4').map(step => step.id);
  assert.ok(!four.some(id => id.startsWith('recipe-unlock-') || id === 'hard-drives-4'));
  assert.ok(phaseSteps(plan, { checks: {} }, data, '3').some(step => step.id === 'hard-drives-3'));
});

test('an alternate of a stage before the start phase is still listed in the start phase', () => {
  const plan = phaseThreePlan(),
    alternate = alternatesOf(plan, '3')[0]!;
  // The planner solves Phases 1 and 2 too, but the profile never builds them (#759).
  plan.stages['2'] = { ...plan.stages['2'], rows: [alternate] as CalcRow[] };
  assert.ok(unlockIds(plan, '3').includes('recipe-unlock-' + alternate.id));
  assert.deepEqual(unlockIds(plan, '2'), [], 'a milestone-only phase lists no alternates');
});

test('ticking Phase 3 unlocks does not start Phase 4 (#870)', () => {
  const plan = phaseThreePlan();
  const state = initialState();
  state.settings.phase = '3';
  for (const id of unlockIds(plan, '3')) state.checks[id] = true;
  const four = planStepIds(plan, state, data, '4');
  assert.ok(four.length, 'Phase 4 has steps');
  assert.deepEqual(
    four.filter(id => state.checks[id]),
    [],
    'no Phase 4 step is ticked',
  );
  // The checks are untouched: the same keys stay ticked, counted in Phase 3.
  const three = planStepIds(plan, state, data, '3');
  assert.equal(three.filter(id => state.checks[id]).length, unlockIds(plan, '3').length);
  // The save list sends the same counts, with Phase 4 worked on.
  state.settings.phase = '4';
  const phases = profilePhases(plan, state, data)!;
  assert.equal(phases.find(entry => entry.phase === '4')!.steps!.done, 0);
});
