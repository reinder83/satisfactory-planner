// An amplified line's unlock and milestone are its recipe's (#901). An amplified twin is a row of
// its own, 'amp:<recipe>' (amplified() in planner/recipes.ts). Before, the unlock steps and the
// milestones read its row id as a recipe: an amplified alternate line got a second unlock step,
// 'recipe-unlock-amp:<recipe>' ("Unlock … (somersloop amplified)"), which ticking the recipe's own
// step left open, and a milestone only an amplified line needed was missed. recipeIdOf in
// public/progression.ts now strips the prefix, for every place that reads a recipe from a row.
// The merge of the keys earlier releases saved is in amplified-unlock-migration.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  AMPLIFIED_ID,
  guideContext,
  hardDriveTasks,
  phaseSteps,
  recipeIdOf,
  requiredMilestones,
} from '../public/progression.ts';
import { pickedRecipeUnlocks } from '../public/state.ts';
import { calculate } from '../planner.ts';
import { amplified } from '../planner/recipes.ts';
import { recipes } from './helpers/data.ts';
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
// The recipe a row runs, worked out here without recipeIdOf, so the test does not lean on it.
const recipeOf = (row: CalcRow) =>
  row.onSite?.recipe ?? (row.id.startsWith('amp:') ? row.id.slice(4) : row.id);
const unlockSteps = (plan: CurrentCalculatedPlan, phase: string) =>
  phaseSteps(plan, { checks: {} }, data, phase).filter(step =>
    step.id.startsWith('recipe-unlock-'),
  );
const unlockIds = (plan: CurrentCalculatedPlan, phase: string) =>
  unlockSteps(plan, phase).map(step => step.id);

let made: CurrentCalculatedPlan | undefined;
// A Phase 3 profile with every alternate allowed and 40 somersloops for amplification, made once.
const amplifiedPlan = () =>
  structuredClone(
    (made ??= calculate({ phase: '3', recipes: 'all', somersloops: 40, amplifySloops: 40 })),
  );
// The amplified twin of a row as the planner writes it.
const twinOf = (row: CalcRow): CalcRow => ({
  ...row,
  id: 'amp:' + row.id,
  name: row.name + ' (somersloop amplified)',
  amplified: true,
});
// The plan with these rows as the whole of each listed stage.
const withRows = (plan: CurrentCalculatedPlan, rows: Partial<Record<StageKey, CalcRow[]>>) => ({
  ...plan,
  stages: Object.fromEntries(
    Object.entries(plan.stages).map(([phase, stage]) => [
      phase,
      phase in rows ? { ...stage, rows: rows[phase as StageKey] } : stage,
    ]),
  ) as CurrentCalculatedPlan['stages'],
});
// An alternate line of the plan's Phase 3.
const alternateLine = (plan: CurrentCalculatedPlan) =>
  plan.stages['3'].rows!.find(row => row.alternate && !row.id.startsWith('amp:'))!;

test('a calculated plan with amplified alternates lists each recipe once, under its own id', () => {
  const plan = amplifiedPlan();
  const amplifiedAlternates = PLANNED.flatMap(phase =>
    (plan.stages[phase].rows ?? []).filter(row => row.alternate && row.id.startsWith('amp:')),
  );
  assert.ok(amplifiedAlternates.length, 'the fixture plan amplifies alternate lines');
  const firstUse = new Map<string, string>();
  for (const phase of PLANNED)
    for (const row of plan.stages[phase].rows ?? [])
      if (row.alternate && !firstUse.has(recipeOf(row))) firstUse.set(recipeOf(row), phase);
  const listed = new Map<string, string[]>();
  for (const phase of PLANNED)
    for (const id of unlockIds(plan, phase)) listed.set(id, [...(listed.get(id) ?? []), phase]);
  assert.deepEqual(
    [...listed.keys()].filter(id => id.includes('amp:')),
    [],
    'no amplified unlock step',
  );
  for (const [recipe, phase] of firstUse)
    assert.deepEqual(listed.get('recipe-unlock-' + recipe), [phase], recipe + ' once');
  assert.equal(listed.size, firstUse.size);
  for (const phase of PLANNED)
    for (const step of unlockSteps(plan, phase))
      assert.doesNotMatch(step.title, /somersloop amplified/, step.id);
});

test('an amplified alternate line without its twin has the recipe’s step and title', () => {
  const plan = amplifiedPlan(),
    line = alternateLine(plan);
  const only = withRows(plan, { '3': [twinOf(line)] });
  const steps = unlockSteps(only, '3');
  assert.deepEqual(
    steps.map(step => [step.id, step.title]),
    [['recipe-unlock-' + line.id, 'Unlock ' + line.name]],
  );
});

test('an amplified alternate line and its twin share one step, in one phase or two', () => {
  const plan = amplifiedPlan(),
    line = alternateLine(plan);
  const both = withRows(plan, { '3': [line, twinOf(line)] });
  assert.deepEqual(unlockIds(both, '3'), ['recipe-unlock-' + line.id]);
  // The twin in a later phase only: the recipe is listed where it is first used, and not again.
  for (const [three, four] of [
    [line, twinOf(line)],
    [twinOf(line), line],
  ]) {
    const split = withRows(plan, { '3': [three!], '4': [four!], '5': [] });
    assert.deepEqual(unlockIds(split, '3'), ['recipe-unlock-' + line.id], three!.id);
    assert.deepEqual(unlockIds(split, '4'), [], 'not again in Phase 4 after ' + three!.id);
  }
  // Ticking the recipe's step leaves no unlock open, whichever line the plan builds.
  const steps = hardDriveTasks({
    ...guideContext(both, { checks: { ['recipe-unlock-' + line.id]: true } }, data, '3'),
  });
  assert.match(steps[0]!.body, /^0 selected recipe unlocks remain unconfirmed/);
});

test('a milestone only an amplified line needs is required (requiredMilestones)', () => {
  const context = guideContext(calculate({ phase: '1' }), { checks: {} }, data, '1');
  const beam = recipes.find(recipe => recipe.id === 'Recipe_EncasedIndustrialBeam_C')!;
  const steel = data.entries.find(entry => entry.name === 'Advanced Steel Production')!;
  assert.ok(steel.recipes.includes(beam.id));
  // A partial row: requiredMilestones reads only these fields.
  const line = {
    id: beam.id,
    name: beam.name,
    machine: beam.machine,
    inputs: {},
    outputs: {},
  } as CalcRow;
  const required = (row: CalcRow) =>
    requiredMilestones({ ...context, rows: [row] }).map(entry => entry.id);
  assert.ok(required(line).includes(steel.id), 'the unamplified line needs it');
  assert.ok(required(twinOf(line)).includes(steel.id), 'the amplified line alone needs it too');
});

test('recipeIdOf strips what amplified() adds, and the title its name suffix', () => {
  const recipe = recipes.find(candidate => candidate.id === 'Recipe_Alternate_CokeSteelIngot_C')!;
  const twin = amplified(recipe);
  assert.equal(twin.id, AMPLIFIED_ID + recipe.id, 'the prefix the planner writes');
  // A partial row: hardDriveTasks reads only these fields.
  const row = { id: twin.id, name: twin.name, machine: twin.machine, alternate: true } as CalcRow;
  assert.equal(recipeIdOf(row), recipe.id);
  const context = guideContext(calculate({ phase: '1' }), { checks: {} }, data, '1');
  assert.equal(hardDriveTasks({ ...context, rows: [row] })[1]!.title, 'Unlock ' + recipe.name);
  // A row of the recipe itself and a group's own line are unchanged.
  assert.equal(recipeIdOf({ id: recipe.id }), recipe.id);
  assert.equal(
    recipeIdOf({ id: recipe.id + ':fg-alpha1', onSite: { group: 'fg-alpha1', recipe: recipe.id } }),
    recipe.id,
  );
});

test('a new profile’s picked alternates tick the recipe’s step, never a row’s (carry)', () => {
  const plan = amplifiedPlan(),
    line = alternateLine(plan);
  const custom = withRows(
    { ...plan, settings: { ...plan.settings, recipes: 'custom', alternateRecipes: [] } },
    {
      '1': [],
      '2': [],
      '3': [
        twinOf(line),
        { ...line, id: line.id + ':fg-alpha1', onSite: { group: 'fg-alpha1', recipe: line.id } },
      ],
      '4': [],
      '5': [],
    },
  );
  assert.deepEqual(pickedRecipeUnlocks(custom), [line.id]);
});
