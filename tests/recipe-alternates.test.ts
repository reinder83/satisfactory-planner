// Which recipes are alternates (#1040). recipes.json comes from the SatisfactoryTools revision it
// records (THIRD_PARTY.md), whose `alternate` flag is whether the recipe's class name contains
// "Alternate" (true of all its 825 recipes). The game makes a recipe an alternate by unlocking
// it with a hard-drive schematic (EST_Alternate), and one such recipe has no "Alternate" in its
// class name: Recipe_PureAluminumIngot_C, "Alternate: Pure Aluminum Ingot", which
// Schematic_Alternate_PureAluminumIngot_C unlocks (the dataset's 1.0 revision still had it as an
// alternate). So the mapping: the dataset's flag, or a hard-drive schematic named like the recipe
// unlocks it (public/progression.json holds those schematics from the same revision). Before,
// Pure Aluminum Ingot was a standard recipe: 'standard' plans and 'custom' ones without it used
// it in Phases 4 and 5 with no unlock step.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate, catalog, rankAlternates, recipePool, settings } from '../planner.ts';
import { phaseSteps } from '../public/progression.ts';
import { initialState, planStepIds, profilePhases, validateState } from '../public/state.ts';
import { validateTransfer } from '../public/transfer.ts';
import { recipes } from './helpers/data.ts';
import {
  MAM_IDS,
  PURE_ALUMINUM,
  STANDARD_BEFORE_1040,
  STANDARD_BEFORE_1044,
} from './helpers/standard-before-1040.ts';
import type {
  CurrentCalculatedPlan,
  Progression,
  SaveExport,
  StoredCalculatedPlan,
} from '../public/types/index.ts';

const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const UNLOCK = 'recipe-unlock-' + PURE_ALUMINUM;
// The phases a plan uses Pure Aluminum Ingot in, with each row's alternate flag.
const pureAluminumRows = (plan: StoredCalculatedPlan) =>
  Object.entries(plan.stages).flatMap(([phase, stage]) =>
    (stage.rows || [])
      .filter(row => row.id === PURE_ALUMINUM)
      .map(row => [phase, row.alternate] as const),
  );
// The hard-drive schematics, by the recipes they unlock under their own name.
const hardDriveNamed = (id: string, name: string) =>
  data.entries.some(entry => entry.alternate && entry.name === name && entry.recipes.includes(id));

test('#1040: Pure Aluminum Ingot is a hard-drive alternate', () => {
  const recipe = recipes.find(candidate => candidate.id === PURE_ALUMINUM)!;
  assert.equal(recipe.name, 'Alternate: Pure Aluminum Ingot');
  assert.equal(recipe.alternate, true);
  const unlock = data.entries.find(entry => entry.recipes.includes(PURE_ALUMINUM))!;
  assert.equal(unlock.id, 'Schematic_Alternate_PureAluminumIngot_C');
  assert.equal(unlock.alternate, true, 'unlocked by a hard drive');
  // The wizard offers it among the alternates, as a pure ingot recipe, and no longer as standard.
  const alternate = catalog().alternates.find(entry => entry.id === PURE_ALUMINUM);
  assert.deepEqual(
    { name: alternate?.name, pure: alternate?.pure, mam: alternate?.mam },
    { name: 'Pure Aluminum Ingot', pure: true, mam: undefined },
  );
  assert.ok(!catalog().standardRecipes.some(entry => entry.id === PURE_ALUMINUM));
});

test('#1040: every recipe is an alternate exactly when the data says so or a hard drive of its name unlocks it', () => {
  // The revision's own flag is "Alternate" in the class name (the recipe id here).
  const upstream = (id: string) => id.includes('Alternate');
  const overridden: string[] = [];
  for (const { id, name, alternate } of recipes) {
    assert.equal(alternate, upstream(id) || hardDriveNamed(id, name), `${id} (${name})`);
    if (alternate !== upstream(id)) overridden.push(id);
  }
  assert.deepEqual(overridden, [PURE_ALUMINUM], 'only Pure Aluminum Ingot differs from the data');
  assert.equal(recipes.length, 276);
  assert.equal(recipes.filter(recipe => recipe.alternate).length, 111);
  // Every hard-drive schematic that unlocks a recipe of the planner under its own name unlocks
  // an alternate. The others it unlocks are packaging (Packaged and Unpackage Turbofuel, which
  // the Turbofuel alternates' hard drives also give) and stay standard.
  const alsoUnlocked = new Set<string>();
  for (const entry of data.entries.filter(candidate => candidate.alternate))
    for (const id of entry.recipes) {
      const recipe = recipes.find(candidate => candidate.id === id);
      if (recipe && recipe.name === entry.name) assert.equal(recipe.alternate, true, id);
      else if (recipe) alsoUnlocked.add(id);
    }
  assert.deepEqual([...alsoUnlocked].sort(), [
    'Recipe_PackagedTurboFuel_C',
    'Recipe_UnpackageTurboFuel_C',
  ]);
});

test('#1040: standard recipes and custom recipes without it plan no Pure Aluminum Ingot', () => {
  for (const input of [
    { phase: '4', recipes: 'standard' },
    { phase: '4', recipes: 'custom', alternateRecipes: [] },
    { phase: '5' },
    { phase: '3', recipes: 'standard', wholeMachines: true },
  ]) {
    const plan = calculate(input);
    assert.deepEqual(pureAluminumRows(plan), [], JSON.stringify(input));
    for (const phase of ['4', '5'] as const) {
      const stage = plan.stages[phase];
      assert.equal(stage.feasible, true, `${JSON.stringify(input)}, Phase ${phase}`);
      // Its Aluminum Ingot comes from the standard Foundry recipe instead.
      assert.ok(stage.rows?.some(row => row.id === 'Recipe_IngotAluminum_C'));
    }
  }
});

let allowed: CurrentCalculatedPlan | undefined;
// A Phase 4 profile that picked Pure Aluminum Ingot and nothing else, made once for the file.
const allowedPlan = () =>
  (allowed ??= calculate({ phase: '4', recipes: 'custom', alternateRecipes: [PURE_ALUMINUM] }));
const hardDriveSteps = (plan: StoredCalculatedPlan, phase: string, checks = {}) =>
  phaseSteps(plan, { checks }, data, phase).filter(
    step => step.id.startsWith('recipe-unlock-') || step.id.startsWith('hard-drives-'),
  );

test('#1040: allowed, it is planned as an alternate with its unlock step, counted with the hard drives', () => {
  const plan = allowedPlan();
  assert.deepEqual(plan.settings.alternateRecipes, [PURE_ALUMINUM], 'the pick is kept');
  assert.deepEqual(pureAluminumRows(plan), [
    ['4', true],
    ['5', true],
  ]);
  const four = hardDriveSteps(plan, '4');
  assert.deepEqual(
    four.map(step => step.id),
    ['hard-drives-4', UNLOCK],
  );
  assert.equal(four[1]!.title, 'Unlock Alternate: Pure Aluminum Ingot');
  assert.match(four[1]!.body, /First unlock: Bauxite Refinement\./);
  assert.match(four[0]!.body, /^1 selected recipe unlocks remain unconfirmed\./);
  assert.match(
    hardDriveSteps(plan, '4', { [UNLOCK]: true })[0]!.body,
    /^0 selected recipe unlocks/,
  );
  // Listed once, in the first phase that uses it (#870).
  assert.deepEqual(hardDriveSteps(plan, '5'), []);
});

test('#1040: with pure ingots required it is planned as an alternate with its unlock step', () => {
  const plan = calculate({ phase: '4', recipes: 'standard', pureIngots: true });
  assert.deepEqual(pureAluminumRows(plan), [
    ['4', true],
    ['5', true],
  ]);
  const ids = hardDriveSteps(plan, '4').map(step => step.id);
  assert.ok(ids.includes(UNLOCK), ids.join(', '));
});

test('#1040: the standard pool before #1040 is custom with Pure Aluminum Ingot and the MAM recipes', () => {
  // tests/helpers/standard-before-1040.ts: the cases recorded on the old standard recipes. The
  // MAM recipes then were the two the catalog marks other than Polyester Fabric, which #1044
  // made a MAM recipe, as it made Distilled Silica a milestone recipe.
  const POLYESTER = 'Recipe_Alternate_PolyesterFabric_C',
    DISTILLED = 'Recipe_Alternate_Silica_Distilled_C';
  assert.deepEqual(
    [...MAM_IDS, POLYESTER].sort(),
    catalog()
      .alternates.filter(alternate => alternate.mam)
      .map(alternate => alternate.id)
      .sort(),
  );
  const ids = (input: object, phase: number) =>
    recipePool(settings(input), phase, false)
      .map(recipe => recipe.id)
      .sort();
  for (const phase of [1, 2, 3, 4, 5]) {
    // Standard since #1044 has Polyester Fabric from Phase 3 and Distilled Silica from Phase 4.
    const added = [...(phase >= 3 ? [POLYESTER] : []), ...(phase >= 4 ? [DISTILLED] : [])];
    const standard = ids({ recipes: 'standard' }, phase);
    assert.deepEqual(
      added.filter(id => standard.includes(id)),
      added,
      `Phase ${phase} standard`,
    );
    const between = ids(STANDARD_BEFORE_1044, phase);
    assert.deepEqual(
      between,
      standard.filter(id => !added.includes(id)),
      `Phase ${phase}, before #1044`,
    );
    const before = ids(STANDARD_BEFORE_1040, phase);
    assert.deepEqual(
      before,
      phase >= 4 ? [...between, PURE_ALUMINUM].sort() : between,
      `Phase ${phase}, before #1040`,
    );
  }
});

test('#1040: the hard-drive payoff offers it to a standard profile, unless pure ingots bring it in', () => {
  const offered = (input: object) =>
    rankAlternates(input, { phase: '4' }).candidates.some(entry => entry.id === PURE_ALUMINUM);
  assert.equal(offered({ phase: '4', recipes: 'standard' }), true);
  assert.equal(offered({ phase: '4', recipes: 'standard', pureIngots: true }), false);
});

test('#1040: a stored plan with Pure Aluminum Ingot as a standard line keeps its rows, steps and ticks', () => {
  // Frozen by the first release's planner, a 'standard' profile from Phase 3: it builds Pure
  // Aluminum Ingot in Phases 4 and 5, as a standard recipe.
  const stored: StoredCalculatedPlan = JSON.parse(
    fs.readFileSync(new URL('./fixtures/calculated-plan-2026-09-12.json', import.meta.url), 'utf8'),
  );
  assert.equal(stored.settings.recipes, 'standard');
  assert.deepEqual(pureAluminumRows(stored), [
    ['4', false],
    ['5', false],
  ]);
  const state = initialState();
  state.settings.phase = '4';
  state.checks['calc-4-' + PURE_ALUMINUM] = true;
  state.checks['calc-5-' + PURE_ALUMINUM] = true;
  // The progress loads with its ticks, and a full export of the profile imports byte for byte.
  const loaded = validateState(json(state));
  assert.deepEqual(loaded.checks, state.checks);
  const file: SaveExport = {
    format: 'satisfactory-planner-saves',
    version: 1,
    exportedAt: '2026-10-04T12:00:00.000Z',
    saves: [
      {
        id: 's1',
        name: 'World',
        activeProfile: 'p1',
        profiles: [{ id: 'p1', name: 'Standard', kind: 'calculated', plan: stored, state }],
      },
    ],
  };
  const imported = validateTransfer(json(file)).saves[0]!.profiles[0]!;
  assert.equal(JSON.stringify(imported.plan), JSON.stringify(stored));
  assert.deepEqual(imported.state!.checks, state.checks);
  // Its build plan is the one it had: the line's steps, ticked, and no unlock step until the
  // user recalculates (the rows carry their own flag).
  for (const phase of ['4', '5'] as const) {
    const ids = planStepIds(stored, loaded, data, phase);
    assert.ok(ids.includes(`calc-${phase}-${PURE_ALUMINUM}`), `Phase ${phase} keeps the line`);
    assert.ok(!ids.includes(UNLOCK), `Phase ${phase} asks no unlock`);
  }
  const phases = profilePhases(stored, loaded, data)!;
  const four = phases.find(entry => entry.phase === '4')!;
  assert.equal(four.steps!.done, 1, 'the ticked line counts in Phase 4');
});

test('#1040: settings keep Pure Aluminum Ingot among the picked alternates', () => {
  // Before, settings() dropped it as an unknown alternate, so no stored plan has it in its list.
  const config = settings({
    recipes: 'custom',
    alternateRecipes: [PURE_ALUMINUM, 'Recipe_Alternate_PureIronIngot_C'],
    preferredRecipes: [PURE_ALUMINUM],
  });
  assert.deepEqual(config.alternateRecipes, ['Recipe_Alternate_PureIronIngot_C', PURE_ALUMINUM]);
  assert.deepEqual(config.preferredRecipes, [PURE_ALUMINUM]);
});
