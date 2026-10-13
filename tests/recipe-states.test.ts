// The three recipe states (#1075, public/app/recipe-states.ts): owned, hunting or not allowed are
// a view of the settings every plan already has. An old profile's picks, owned alternates and
// Planner's choice map onto them with no change in its plan, owned recipes are used freely,
// hunting ones are planned with their hard-drive step kept on the hunt, and not-allowed ones are
// never used. "Add as hunting" plans exactly what the ranking tried.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate, catalog, rankAlternates, settings } from '../planner.ts';
import { recipePool } from '../planner/recipes.ts';
import { pickedRecipeUnlocks } from '../public/state.ts';
import {
  compared,
  fallbacksOf,
  fieldsOf,
  huntingSettings,
  recipeSets,
  recipeState,
  stateIn,
  withState,
} from '../public/app/recipe-states.ts';
import type { StoredCalculatedPlan } from '../public/types/index.ts';

const stored = (
  JSON.parse(
    fs.readFileSync(new URL('./fixtures/custom-plan-before-1058.json', import.meta.url), 'utf8'),
  ) as { plan: StoredCalculatedPlan }
).plan;
const STEEL_SCREWS = 'Recipe_Alternate_Screw_2_C',
  IRON_WIRE = 'Recipe_Alternate_Wire_1_C',
  CAST_SCREWS = 'Recipe_Alternate_Screw_C',
  STITCHED = 'Recipe_Alternate_ReinforcedIronPlate_2_C';
const ids = (input: object, phase = 5) =>
  recipePool(settings(input), phase, false)
    .map(recipe => recipe.id)
    .sort();
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
// The settings a picker writes back for `input` when no row is changed.
const untouched = <T extends object>(input: T) => ({
  ...input,
  ...fieldsOf(recipeSets(input)),
});

test('#1075: an old custom plan maps to owned, hunting and not allowed with no change in plan', () => {
  const old = stored.settings;
  assert.equal(recipeState(old, STEEL_SCREWS), 'hunting');
  assert.equal(recipeState(old, IRON_WIRE), 'hunting');
  assert.equal(recipeState(old, CAST_SCREWS), 'off');
  // Written back as they are: the same normalised settings and the same plan.
  const back = untouched(old);
  assert.deepEqual(settings(back), settings(old));
  assert.deepEqual(json(calculate(back).stages), json(calculate(old).stages));
});

test('#1075: owned alternates, Planner’s choice and plain picks keep their fields and their pool', () => {
  const legacy = {
    phase: '3',
    recipes: 'custom' as const,
    alternateRecipes: [CAST_SCREWS, IRON_WIRE, STEEL_SCREWS],
    preferredRecipes: [IRON_WIRE],
    plannerPicks: [STEEL_SCREWS],
    ownedAlternates: [STITCHED],
  };
  assert.equal(recipeState(legacy, STITCHED), 'owned');
  for (const id of legacy.alternateRecipes) assert.equal(recipeState(legacy, id), 'hunting', id);
  assert.deepEqual(settings(untouched(legacy)), settings(legacy));
  for (const phase of [1, 2, 3, 4, 5])
    assert.deepEqual(ids(untouched(legacy), phase), ids(legacy, phase), String(phase));
  // Standard and All: owned is owned, All allows every other alternate, Standard none.
  const standard = { recipes: 'standard' as const, ownedAlternates: [STITCHED] };
  assert.equal(recipeState(standard, STITCHED), 'owned');
  assert.equal(recipeState(standard, CAST_SCREWS), 'off');
  assert.equal(recipeState({ recipes: 'all' }, CAST_SCREWS), 'hunting');
  assert.equal(
    recipeState({ recipes: 'all', ownedAlternates: [CAST_SCREWS] }, CAST_SCREWS),
    'owned',
  );
});

test('#1075: owned recipes are used freely, hunting ones stay on the hunt, not-allowed ones never', () => {
  const base = { phase: '3', recipes: 'standard' as const, mamRecipes: true };
  // Owned: in the pool whatever Recipe access says.
  assert.ok(ids({ ...base, ownedAlternates: [CAST_SCREWS] }, 3).includes(CAST_SCREWS));
  // Not allowed: never in the pool.
  assert.ok(!ids(base, 5).includes(CAST_SCREWS));
  // Hunting, set in the picker: picked (so planned) and on the hunt, so a new profile's "Treat
  // this plan's alternate recipes as unlocked" leaves its hard-drive step open.
  let sets = recipeSets({ recipes: 'custom', alternateRecipes: [IRON_WIRE] });
  sets = withState(sets, CAST_SCREWS, 'hunting');
  assert.equal(stateIn(sets, CAST_SCREWS), 'hunting');
  const hunting = { ...base, recipes: 'custom' as const, ...fieldsOf(sets) };
  assert.deepEqual(hunting.plannerPicks, [CAST_SCREWS]);
  assert.ok(ids(hunting, 3).includes(CAST_SCREWS));
  const plan = calculate(hunting);
  assert.ok(
    Object.values(plan.stages).some(stage => stage.rows?.some(row => row.id === CAST_SCREWS)),
    'the plan uses it',
  );
  const unlocked = pickedRecipeUnlocks(plan);
  assert.ok(!unlocked.includes(CAST_SCREWS), 'its hard-drive step stays open');
  assert.ok(unlocked.includes(IRON_WIRE), 'a plain pick counts as before');
  // Owned, then not allowed: off drops the pick, the hunt and the star.
  sets = withState(sets, CAST_SCREWS, 'owned');
  assert.deepEqual(fieldsOf(sets).ownedAlternates, [CAST_SCREWS]);
  assert.equal(fieldsOf(sets).plannerPicks, undefined);
  sets = withState({ ...sets, starred: new Set([CAST_SCREWS]) }, CAST_SCREWS, 'off');
  assert.deepEqual(fieldsOf(sets), { alternateRecipes: [IRON_WIRE], preferredRecipes: [] });
  assert.ok(!ids({ ...base, recipes: 'custom', ...fieldsOf(sets) }, 5).includes(CAST_SCREWS));
  // A row set to the state it has is left exactly as it is.
  const same = recipeSets({ recipes: 'custom', alternateRecipes: [IRON_WIRE] });
  assert.equal(withState(same, IRON_WIRE, 'hunting'), same);
});

test('#1075: Add as hunting plans what the ranking tried, and the product’s fallback is named', () => {
  const standard = { phase: '2', recipes: 'standard' as const, alternateRecipes: [IRON_WIRE] };
  const ranking = rankAlternates(standard, { phase: '2' });
  const better = ranking.candidates.find(c => c.status === 'better' && c.buildings < 0);
  assert.ok(better, 'some alternate saves buildings');
  const next = huntingSettings(standard, better.id)!;
  // An old pick a standard plan ignored is not brought back.
  assert.deepEqual(next.alternateRecipes, [better.id]);
  assert.deepEqual(next.plannerPicks, [better.id]);
  assert.equal(next.recipes, 'custom');
  const buildings = (input: object) =>
    calculate(input).stages['2']!.rows!.reduce((sum, row) => sum + row.machines, 0);
  assert.equal(buildings(next) - ranking.base.buildings, better.buildings);
  // Custom adds the pick; already allowed or owned gives nothing to do.
  assert.deepEqual(
    huntingSettings({ recipes: 'custom', alternateRecipes: [IRON_WIRE] }, CAST_SCREWS)!
      .alternateRecipes,
    [CAST_SCREWS, IRON_WIRE],
  );
  assert.equal(huntingSettings({ recipes: 'all' }, CAST_SCREWS), null);
  assert.equal(
    huntingSettings({ recipes: 'custom', alternateRecipes: [IRON_WIRE] }, IRON_WIRE),
    null,
  );
  assert.equal(huntingSettings({ ownedAlternates: [CAST_SCREWS] }, CAST_SCREWS), null);
  // Cast Screws makes Screws from Iron Ingot: it skips the standard recipe's Iron Rod.
  const { alternates, standardRecipes } = catalog();
  const cast = alternates.find(a => a.id === CAST_SCREWS)!;
  assert.deepEqual(
    fallbacksOf(cast, standardRecipes).map(r => r.name),
    ['Screws'],
  );
  assert.deepEqual(compared(cast, standardRecipes), { skips: ['Iron Rod'], adds: ['Iron Ingot'] });
});
