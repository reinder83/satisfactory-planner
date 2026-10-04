// Alternates the game unlocks without a hard drive (#1044). Polyester Fabric comes from the MAM
// research Synthetic Polyester Fabric (Research_Mycelia_2_1_C), and Distilled Silica from the
// Tier 7 milestone Control System Development (Schematic_7-5_C), as the wiki gives it
// (https://satisfactory.wiki.gg/wiki/Silica); the recorded SatisfactoryTools revision gives it no
// unlock at all, so public/progression.json adds it to that milestone. Before, both were planned
// as hard-drive alternates: left out of standard plans, with an "Unlock Alternate: …" step,
// counted with the hard drives and ranked by the hard-drive payoff. Now they are planned like
// Turbofuel and Compacted Coal (MAM_RECIPES and MILESTONE_RECIPES in planner/data.ts): standard
// plans use them from the phase their unlock is available, and their lines ask for the unlock's
// own step. A stored plan keeps its rows and steps until the user recalculates, and a new profile
// carrying the unlocks ticks the unlock's step where the source ticked the recipe's old step.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate, catalog, rankAlternates, recipePool, settings } from '../planner.ts';
import { MAM_RECIPES, MILESTONE_RECIPES, STANDARD_ALTERNATES } from '../planner/data.ts';
import {
  guideContext,
  milestonePhase,
  phaseSteps,
  requiredMilestones,
} from '../public/progression.ts';
import { initialState, newProfileState, UNLOCKED_WITH, validateState } from '../public/state.ts';
import { turbofuelRecipes } from '../public/preferences.ts';
import { validateTransfer } from '../public/transfer.ts';
import { recipes } from './helpers/data.ts';
import { states } from './types/fixtures.ts';
import type {
  CalcRow,
  CurrentCalculatedPlan,
  Progression,
  SavedState,
  SaveExport,
  StoredCalculatedPlan,
} from '../public/types/index.ts';

const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const POLYESTER = 'Recipe_Alternate_PolyesterFabric_C',
  DISTILLED = 'Recipe_Alternate_Silica_Distilled_C',
  PURIFIED = 'Recipe_Alternate_Quartz_Purified_C',
  SYNTHETIC = 'Research_Mycelia_2_1_C',
  CONTROL = 'Schematic_7-5_C';
const recipeOf = (id: string) => recipes.find(recipe => recipe.id === id)!;
const entryOf = (id: string) => data.entries.find(entry => entry.id === id)!;
const unlocksOf = (id: string) => data.entries.filter(entry => entry.recipes.includes(id));
// The phases a plan builds a recipe in, with each row's alternate flag and name.
const rowsOf = (plan: StoredCalculatedPlan, id: string) =>
  Object.entries(plan.stages).flatMap(([phase, stage]) =>
    (stage.rows || []).filter(row => row.id === id).map(row => [phase, row.alternate, row.name]),
  );
const stepsOf = (plan: StoredCalculatedPlan, phase: string, checks = {}) =>
  phaseSteps(plan, { checks }, data, phase);
const ids = (plan: StoredCalculatedPlan, phase: string) =>
  stepsOf(plan, phase).map(step => step.id);

test('#1044: the alternates a MAM node or a HUB milestone unlocks are the ones planned as standard', () => {
  // Every alternate has an unlock in progression.json; those no hard drive gives are exactly
  // the planner's lists, by the kind of unlock.
  const byResearch: string[] = [],
    byMilestone: Record<string, number> = {};
  for (const recipe of recipes.filter(candidate => candidate.alternate)) {
    const unlocks = unlocksOf(recipe.id);
    assert.ok(unlocks.length, `${recipe.id} has an unlock`);
    const other = unlocks.filter(entry => !entry.alternate);
    if (!other.length) continue;
    assert.equal(other.length, unlocks.length, `${recipe.id}: no hard drive unlocks it as well`);
    for (const entry of other)
      if (entry.mam) byResearch.push(recipe.id);
      else byMilestone[recipe.id] = entry.tier;
  }
  assert.deepEqual(byResearch.sort(), [...MAM_RECIPES].sort());
  assert.deepEqual(byMilestone, MILESTONE_RECIPES);
  assert.deepEqual(MILESTONE_RECIPES, { [DISTILLED]: 7 });
  assert.deepEqual(STANDARD_ALTERNATES.sort(), [...MAM_RECIPES, DISTILLED].sort());
  // The new profile's carry knows each by the unlock that gives it.
  assert.deepEqual(UNLOCKED_WITH, { [POLYESTER]: SYNTHETIC, [DISTILLED]: CONTROL });
  for (const [recipe, unlock] of Object.entries(UNLOCKED_WITH))
    assert.deepEqual(
      unlocksOf(recipe).map(entry => entry.id),
      [unlock],
    );
  assert.equal(entryOf(SYNTHETIC).name, 'Synthetic Polyester Fabric');
  assert.equal(entryOf(SYNTHETIC).mam, true);
  // The one correction to the data: Control System Development lists Distilled Silica after
  // the recipes the recorded revision gives it.
  const control = entryOf(CONTROL);
  assert.deepEqual(
    [control.name, control.tier, control.mam, control.alternate],
    ['Control System Development', 7, false, false],
  );
  assert.deepEqual(control.recipes, [
    'Recipe_SulfuricAcid_C',
    'Recipe_PackagedSulfuricAcid_C',
    'Recipe_Battery_C',
    'Recipe_RadioControlUnit_C',
    'Recipe_ComputerSuper_C',
    'Recipe_SpaceElevatorPart_7_C',
    'Recipe_Blender_C',
    DISTILLED,
  ]);
  // recipes.json is unchanged: both keep the dataset's alternate flag and name, as Turbofuel and
  // Compacted Coal do; the planner relabels them.
  assert.deepEqual(
    [recipeOf(POLYESTER).alternate, recipeOf(POLYESTER).name],
    [true, 'Alternate: Polyester Fabric'],
  );
  assert.deepEqual(
    [recipeOf(DISTILLED).alternate, recipeOf(DISTILLED).name],
    [true, 'Alternate: Distilled Silica'],
  );
});

test('#1044: each is available from the phase its unlock is', () => {
  for (const id of STANDARD_ALTERNATES) {
    const unlock = unlocksOf(id)[0]!;
    assert.ok(recipeOf(id).phase >= milestonePhase(unlock, data), `${id} not before its unlock`);
  }
  // Synthetic Polyester Fabric costs Fabric and Polymer Resin (Phase 3); Tier 7 is Phase 4.
  assert.equal(milestonePhase(entryOf(SYNTHETIC), data), 3);
  assert.equal(recipeOf(POLYESTER).phase, 3);
  assert.equal(milestonePhase(entryOf(CONTROL), data), 4);
  assert.equal(recipeOf(DISTILLED).phase, 4);
  const pool = (input: object, phase: number) =>
    recipePool(settings(input), phase, false)
      .filter(recipe => recipe.id === POLYESTER || recipe.id === DISTILLED)
      .map(recipe => [recipe.id, recipe.alternate, recipe.name]);
  const polyester = [POLYESTER, false, 'Polyester Fabric'],
    distilled = [DISTILLED, false, 'Distilled Silica'];
  for (const input of [{ recipes: 'standard' }, { recipes: 'all' }]) {
    assert.deepEqual(pool(input, 2), [], JSON.stringify(input));
    assert.deepEqual(pool(input, 3), [polyester], JSON.stringify(input));
    assert.deepEqual(pool(input, 4), [distilled, polyester], JSON.stringify(input));
    assert.deepEqual(pool(input, 5), [distilled, polyester], JSON.stringify(input));
  }
  // Under 'custom' they are picks, like the other MAM recipes.
  assert.deepEqual(pool({ recipes: 'custom' }, 5), []);
  assert.deepEqual(pool({ recipes: 'custom', alternateRecipes: [DISTILLED] }, 4), [distilled]);
  assert.deepEqual(pool({ recipes: 'custom', alternateRecipes: [POLYESTER] }, 4), [polyester]);
});

let supplies: CurrentCalculatedPlan | undefined;
// A standard profile from Phase 3 that keeps filters in storage, made once for the file: its Gas
// Filter needs Fabric, which only Polyester Fabric makes in a plan.
const suppliesPlan = () => (supplies ??= calculate({ phase: '3', storage: 'supplies' }));

test('#1044: a standard plan makes Fabric with Polyester Fabric and asks for its MAM research', () => {
  const plan = suppliesPlan();
  assert.deepEqual(rowsOf(plan, POLYESTER), [
    ['3', false, 'Polyester Fabric'],
    ['4', false, 'Polyester Fabric'],
    ['5', false, 'Polyester Fabric'],
  ]);
  for (const phase of ['3', '4', '5'] as const) {
    assert.ok(plan.stages[phase].storage?.['Gas Filter'], `Phase ${phase} stores Gas Filters`);
    assert.ok(!ids(plan, phase).includes('recipe-unlock-' + POLYESTER), `Phase ${phase}`);
    // A standard plan has no hard-drive alternate, so no phase asks for hard drives.
    assert.ok(!ids(plan, phase).some(id => id.startsWith('hard-drives-')), `Phase ${phase}`);
  }
  const research = stepsOf(plan, '3').find(step => step.id === 'unlock-' + SYNTHETIC);
  assert.equal(research?.title, 'MAM: Synthetic Polyester Fabric');
  assert.ok(!ids(plan, '4').includes('unlock-' + SYNTHETIC), 'listed once, in Phase 3');
});

let everything: CurrentCalculatedPlan | undefined;
// A Phase 4 profile with every alternate allowed, made once for the file: it builds Distilled
// Silica in Phases 4 and 5.
const allPlan = () => (everything ??= calculate({ phase: '4', recipes: 'all' }));

test('#1044: Distilled Silica asks for Control System Development, not a hard drive', () => {
  const plan = allPlan();
  assert.deepEqual(rowsOf(plan, DISTILLED), [
    ['4', false, 'Distilled Silica'],
    ['5', false, 'Distilled Silica'],
  ]);
  const four = stepsOf(plan, '4');
  assert.ok(!four.some(step => step.id === 'recipe-unlock-' + DISTILLED));
  assert.equal(
    four.find(step => step.id === 'unlock-' + CONTROL)?.title,
    'Tier 7: Control System Development',
  );
  // The hard-drive step counts the plan's other alternates only.
  const alternates = new Set(
    (plan.stages['4'].rows || []).filter(row => row.alternate).map(row => row.id),
  );
  assert.ok(alternates.size > 1 && !alternates.has(DISTILLED));
  const hardDrives = four.find(step => step.id === 'hard-drives-4')!;
  assert.match(hardDrives.body, new RegExp(`^${alternates.size} selected recipe unlocks`));
  assert.equal(four.filter(step => step.id.startsWith('recipe-unlock-')).length, alternates.size);
  // The milestone comes from the recipe itself, not only from its Blender.
  const context = guideContext(plan, { checks: {} }, data, '4');
  // A partial row: requiredMilestones reads only these fields.
  const row = { id: DISTILLED, name: 'Distilled Silica', machine: 'None', inputs: {}, outputs: {} };
  const required = requiredMilestones({ ...context, rows: [row as CalcRow] });
  assert.ok(required.some(entry => entry.id === CONTROL));
});

test('#1044: the picker marks Polyester Fabric as MAM research and Distilled Silica by its milestone', () => {
  const alternates = catalog().alternates;
  const pick = (id: string) => alternates.find(entry => entry.id === id);
  assert.deepEqual(pick(POLYESTER), {
    id: POLYESTER,
    name: 'Polyester Fabric',
    phase: 3,
    machine: 'Refinery',
    inputs: { 'Polymer Resin': 30, Water: 30 },
    outputs: { Fabric: 30 },
    mam: true,
  });
  assert.equal(pick(DISTILLED)?.milestone, 7);
  assert.equal(pick(DISTILLED)?.mam, undefined);
  assert.deepEqual(
    alternates.filter(entry => entry.mam || entry.milestone).map(entry => entry.id),
    alternates.filter(entry => STANDARD_ALTERNATES.includes(entry.id)).map(entry => entry.id),
  );
  assert.ok(!catalog().standardRecipes.some(entry => STANDARD_ALTERNATES.includes(entry.id)));
});

test('#1044: the hard-drive payoff never offers them', () => {
  // A budget below zero ranks nothing, but counts the candidates (one base plan only).
  const total = (input: object, phase: '3' | '4') =>
    rankAlternates(input, { phase, budgetMs: -1 }).total;
  const available = (phase: number) =>
    recipes.filter(recipe => recipe.alternate && recipe.phase <= phase).map(recipe => recipe.id);
  // Standard has every alternate no hard drive gives; the hard-drive ones are candidates.
  assert.equal(
    total({ phase: '4' }, '4'),
    available(4).filter(id => !STANDARD_ALTERNATES.includes(id)).length,
  );
  // Custom without picks: Turbofuel's and Compacted Coal's research each cost a Hard Drive, so
  // they stay candidates; Polyester Fabric's research and Distilled Silica's milestone cost none.
  for (const id of turbofuelRecipes) assert.equal(unlocksOf(id)[0]!.cost['Hard Drive'], 1, id);
  for (const id of [POLYESTER, DISTILLED])
    assert.equal(unlocksOf(id)[0]!.cost['Hard Drive'], undefined, id);
  assert.equal(
    total({ phase: '4', recipes: 'custom' }, '4'),
    available(4).filter(id => id !== POLYESTER && id !== DISTILLED).length,
  );
  assert.equal(
    total({ phase: '3', recipes: 'custom' }, '3'),
    available(3).filter(id => id !== POLYESTER).length,
  );
});

test('#1044: settings keep both among the picked and preferred alternates', () => {
  const config = settings({
    recipes: 'custom',
    alternateRecipes: [POLYESTER, DISTILLED, PURIFIED],
    preferredRecipes: [DISTILLED],
  });
  assert.deepEqual(config.alternateRecipes, [PURIFIED, DISTILLED, POLYESTER].sort());
  assert.deepEqual(config.preferredRecipes, [DISTILLED]);
  // A turbofuel route locks in its own two MAM recipes, not Polyester Fabric.
  assert.deepEqual(settings({ recipes: 'custom', mainPower: 'turbofuel' }).alternateRecipes, [
    'Recipe_Alternate_EnrichedCoal_C',
    'Recipe_Alternate_Turbofuel_C',
  ]);
  // Picked, they are planned as standard lines with their unlock's step.
  const plan = calculate({
    phase: '4',
    recipes: 'custom',
    alternateRecipes: [POLYESTER, DISTILLED, PURIFIED],
    storage: 'supplies',
  });
  assert.deepEqual(plan.settings.alternateRecipes, [PURIFIED, DISTILLED, POLYESTER].sort());
  assert.deepEqual(rowsOf(plan, DISTILLED)[0], ['4', false, 'Distilled Silica']);
  // From Phase 3, which this profile has as milestone-only, as its research is.
  assert.deepEqual(rowsOf(plan, POLYESTER)[0], ['3', false, 'Polyester Fabric']);
  const four = ids(plan, '4');
  assert.deepEqual(
    four.filter(id => id.startsWith('recipe-unlock-')),
    ['recipe-unlock-' + PURIFIED],
  );
  assert.ok(four.includes('unlock-' + CONTROL));
  assert.ok(stepsOf(plan, '3').some(step => step.id === 'unlock-' + SYNTHETIC));
});

// A plan the released planner (before #1044) froze for a Phase 4 custom profile that picked both
// and Quartz Purification: its rows have them as hard-drive alternates, and steps the recorded
// ids and titles.
const recorded: {
  settings: object;
  plan: StoredCalculatedPlan;
  steps: Record<string, [string, string][]>;
} = JSON.parse(
  fs.readFileSync(
    new URL('./fixtures/mam-milestone-alternates-2026-10-04.json', import.meta.url),
    'utf8',
  ),
);

test('#1044: a stored plan keeps its hard-drive rows, steps and ticks until a recalculation', () => {
  const stored = recorded.plan;
  // Phase 3 is milestone-only for this profile, but solved too.
  assert.deepEqual(rowsOf(stored, POLYESTER), [
    ['3', true, 'Alternate: Polyester Fabric'],
    ['4', true, 'Alternate: Polyester Fabric'],
    ['5', true, 'Alternate: Polyester Fabric'],
  ]);
  assert.deepEqual(rowsOf(stored, DISTILLED)[0], ['4', true, 'Alternate: Distilled Silica']);
  for (const [phase, steps] of Object.entries(recorded.steps))
    assert.deepEqual(
      stepsOf(stored, phase).map(step => [step.id, step.title]),
      steps,
      `Phase ${phase}`,
    );
  const four = ids(stored, '4');
  for (const id of [POLYESTER, DISTILLED])
    assert.ok(four.includes('recipe-unlock-' + id), `${id} keeps its unlock step`);
  // The progress loads with its ticks, and a full export imports the plan byte for byte.
  const state = initialState();
  state.settings.phase = '4';
  state.checks['recipe-unlock-' + POLYESTER] = true;
  state.checks['recipe-unlock-' + DISTILLED] = true;
  state.checks['calc-4-' + POLYESTER] = true;
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
        profiles: [{ id: 'p1', name: 'Picked', kind: 'calculated', plan: stored, state }],
      },
    ],
  };
  const imported = validateTransfer(json(file)).saves[0]!.profiles[0]!;
  assert.equal(JSON.stringify(imported.plan), JSON.stringify(stored));
  assert.deepEqual(imported.state!.checks, state.checks);
  // Its settings recalculate: the recorded picks are still known alternates.
  assert.deepEqual(
    settings(recorded.settings).alternateRecipes,
    [PURIFIED, DISTILLED, POLYESTER].sort(),
  );
});

test('#1044: a recalculation carries a ticked old recipe step onto its unlock, from every released version', () => {
  const plan = recorded.plan;
  const recalculated = calculate(recorded.settings);
  for (const [released, version] of states) {
    const source: SavedState = {
      ...structuredClone(released),
      checks: {
        ...released.checks,
        ['recipe-unlock-' + POLYESTER]: true,
        ['recipe-unlock-' + DISTILLED]: true,
      },
    };
    const before = JSON.stringify(source);
    const { state } = newProfileState(recalculated, source, plan, undefined, undefined);
    assert.equal(state.checks['unlock-' + SYNTHETIC], true, `version ${version}`);
    assert.equal(state.checks['unlock-' + CONTROL], true, `version ${version}`);
    // The old records stay as they were, and the source is only read.
    assert.equal(state.checks['recipe-unlock-' + POLYESTER], true);
    assert.equal(state.checks['recipe-unlock-' + DISTILLED], true);
    assert.equal(JSON.stringify(source), before);
    // The new plan shows the ticked unlock steps in place of the recipe steps.
    const four = stepsOf(recalculated, '4', state.checks);
    assert.ok(!four.some(step => step.id === 'recipe-unlock-' + DISTILLED));
    assert.ok(four.some(step => step.id === 'unlock-' + CONTROL));
    assert.ok(stepsOf(recalculated, '3').some(step => step.id === 'unlock-' + SYNTHETIC));
  }
  const base = structuredClone(states[0]![0]);
  const carried = (checks: Record<string, boolean>, raw?: unknown) =>
    newProfileState(recalculated, { ...base, checks }, plan, raw, undefined).state.checks;
  // An unticked or absent old step carries nothing; nor does a carry without the unlocks.
  assert.equal(
    carried({ ['recipe-unlock-' + POLYESTER]: false })['unlock-' + SYNTHETIC],
    undefined,
  );
  assert.equal(carried({})['unlock-' + CONTROL], undefined);
  assert.equal(
    carried({ ['recipe-unlock-' + DISTILLED]: true }, { factories: true })['unlock-' + CONTROL],
    undefined,
  );
  // The source's own record of the unlock wins, as every carried record does.
  assert.equal(
    carried({ ['recipe-unlock-' + DISTILLED]: true, ['unlock-' + CONTROL]: false })[
      'unlock-' + CONTROL
    ],
    false,
  );
  // Only the two recipes' steps: any other ticked alternate carries just its own record.
  // (Unlocks only: the 'picked' option would tick the new plan's picks as well.)
  const other = carried({ ['recipe-unlock-' + PURIFIED]: true }, { unlocks: true });
  assert.deepEqual(
    Object.keys(other).filter(key => key.startsWith('unlock-') || key.startsWith('recipe-unlock-')),
    ['recipe-unlock-' + PURIFIED],
  );
});
