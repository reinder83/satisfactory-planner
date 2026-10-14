// The MAM recipes are their own setting (#1058). Before, ticking any custom set dropped the MAM
// Turbofuel and Compacted Coal recipes (and Polyester Fabric, and Distilled Silica's milestone
// recipe), so a custom plan burned nearly all the map's crude oil in Phase 5, and "custom with
// nothing ticked" differed from Standard although the picker said it was the same.
// settings.mamRecipes (true or false; the wizard sets it for every plan it calculates) now brings
// them in whatever the recipe access; Distilled Silica is in every plan with the field. A plan
// stored before it has no field and keeps the old pool: 'standard' and 'all' with them, 'custom'
// only with the ones picked, so its numbers stay until the user recalculates (tested against a
// plan origin/main calculated, tests/fixtures/custom-plan-before-1058.json, in both editions).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { calculate, catalog, rankAlternates, settings } from '../planner.ts';
import { mamRecipesOn, recipePool, standardAlternateIn } from '../planner/recipes.ts';
import { MAM_RECIPES } from '../planner/data.ts';
import { initialState, validateState } from '../public/state.ts';
import { settingsChanges } from '../public/app/profile-edit.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import { loadWorkspace } from '../server/persistence.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import type { SaveExport, StoredCalculatedPlan } from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const TURBOFUEL = 'Recipe_Alternate_Turbofuel_C',
  COMPACTED = 'Recipe_Alternate_EnrichedCoal_C',
  POLYESTER = 'Recipe_Alternate_PolyesterFabric_C',
  DISTILLED = 'Recipe_Alternate_Silica_Distilled_C';
// Two hard-drive picks, as a custom set: Steel Screws and Iron Wire.
const PICKS = ['Recipe_Alternate_Screw_2_C', 'Recipe_Alternate_Wire_1_C'];
// A new plan as the wizard makes it (freshSettings: whole machines, mining per phase).
const BASE = { phase: '3', wholeMachines: true, phaseMining: true, storageFromSurplus: true };
const stored = (
  JSON.parse(
    fs.readFileSync(new URL('./fixtures/custom-plan-before-1058.json', import.meta.url), 'utf8'),
  ) as { plan: StoredCalculatedPlan }
).plan;
const pool = (input: object, phase = 5) =>
  recipePool(settings(input), phase, false)
    .map(recipe => recipe.id)
    .filter(id => [...MAM_RECIPES, DISTILLED].includes(id))
    .sort();
// A plan's Phase 5 crude oil draw as a share of the map's budget.
const oilShare = (plan: StoredCalculatedPlan) =>
  (plan.stages['5']!.raw?.['Crude Oil'] ?? 0) / plan.settings.limits['Crude Oil']!;
const recipesOf = (plan: StoredCalculatedPlan, phase: '5') =>
  (plan.stages[phase]!.rows || []).map(row => row.id);

test('#1058: settings keep the MAM box as a boolean and leave it out otherwise', () => {
  assert.equal(settings({ mamRecipes: true }).mamRecipes, true);
  assert.equal(settings({ mamRecipes: false }).mamRecipes, false);
  for (const none of [undefined, null, 'false', 0, 1, {}])
    assert.equal('mamRecipes' in settings({ mamRecipes: none }), false, String(none));
  // Absent: Standard and All as before with them, a custom plan only with its picks.
  assert.equal(mamRecipesOn(settings({})), true);
  assert.equal(mamRecipesOn(settings({ recipes: 'all' })), true);
  assert.equal(mamRecipesOn(settings({ recipes: 'custom' })), false);
  assert.equal(mamRecipesOn(settings({ recipes: 'custom', mamRecipes: true })), true);
  assert.equal(mamRecipesOn(settings({ mamRecipes: false })), false);
});

test('#1058: the MAM recipes follow their own setting, whatever the recipe access', () => {
  const all = [COMPACTED, POLYESTER, DISTILLED, TURBOFUEL].sort();
  for (const recipes of ['standard', 'all', 'custom']) {
    assert.deepEqual(pool({ recipes, mamRecipes: true }), all, recipes);
    assert.deepEqual(pool({ recipes, alternateRecipes: PICKS, mamRecipes: true }), all, recipes);
    // Off leaves the MAM recipes out; Distilled Silica comes with its milestone all the same.
    assert.deepEqual(pool({ recipes, mamRecipes: false }), [DISTILLED], recipes);
    // A turbofuel power route keeps Turbofuel and Compacted Coal.
    assert.deepEqual(
      pool({ recipes, mamRecipes: false, mainPower: 'turbofuel' }),
      [COMPACTED, DISTILLED, TURBOFUEL].sort(),
      recipes,
    );
  }
  // An owned MAM recipe is in, as any owned alternate (#1068).
  assert.ok(
    standardAlternateIn(settings({ mamRecipes: false, ownedAlternates: [POLYESTER] }), POLYESTER),
  );
  // Before #1058 (no field): Standard and All with all four, custom with the picks only.
  assert.deepEqual(pool({}), all);
  assert.deepEqual(pool({ recipes: 'all' }), all);
  assert.deepEqual(pool({ recipes: 'custom', alternateRecipes: PICKS }), []);
  assert.deepEqual(pool({ recipes: 'custom', alternateRecipes: [POLYESTER] }), [POLYESTER]);
  assert.deepEqual(
    pool({ recipes: 'custom', mainPower: 'turbofuel' }),
    [COMPACTED, TURBOFUEL].sort(),
  );
});

test('#1058: custom with nothing ticked plans exactly what Standard plans', () => {
  const standard = calculate({ ...BASE, recipes: 'standard', mamRecipes: true });
  const custom = calculate({ ...BASE, recipes: 'custom', alternateRecipes: [], mamRecipes: true });
  assert.deepEqual(json(custom.stages), json(standard.stages));
  // And Standard with the box on is Standard as it always was.
  assert.deepEqual(json(calculate({ ...BASE }).stages), json(standard.stages));
});

test('#1058: a custom set keeps the MAM fuels, and Phase 5 oil is back to what Standard draws', () => {
  const standard = calculate({ ...BASE, recipes: 'standard', mamRecipes: true });
  const custom = calculate({
    ...BASE,
    recipes: 'custom',
    alternateRecipes: PICKS,
    mamRecipes: true,
  });
  for (const id of [TURBOFUEL, COMPACTED])
    assert.ok(recipesOf(custom, '5').includes(id), `${id} in Phase 5`);
  // Standard burns about a third of the map's oil in Phase 5; so does the custom set, which only
  // changes screws and wire. Without the MAM recipes it was nearly all of it (the stored plan).
  assert.ok(oilShare(standard) < 0.4, `standard ${oilShare(standard)}`);
  assert.ok(Math.abs(oilShare(custom) - oilShare(standard)) < 0.02, `custom ${oilShare(custom)}`);
  assert.ok(oilShare(stored) > 0.9, `before ${oilShare(stored)}`);
  // The box off: the custom set plans as it did before #1058.
  const off = calculate({ ...BASE, recipes: 'custom', alternateRecipes: PICKS, mamRecipes: false });
  assert.ok(!recipesOf(off, '5').includes(TURBOFUEL));
  assert.ok(oilShare(off) > 0.9, `off ${oilShare(off)}`);
});

test('#1058: the hard-drive payoff compares against the same pool', () => {
  // With the box on, Turbofuel and Compacted Coal are in the pool, so they are not ranked; off,
  // their MAM research costs a hard drive, so they are. A budget below zero skips every trial,
  // and `total` still counts the candidates.
  const total = (input: object) => rankAlternates(input, { phase: '3', budgetMs: -1 }).total;
  const standard = total({});
  const custom = { recipes: 'custom', alternateRecipes: [PICKS[0]] };
  assert.equal(total({ mamRecipes: true }), standard);
  assert.equal(total({ mamRecipes: false }), standard + 2);
  assert.equal(total({ ...custom, mamRecipes: true }), standard - 1);
  assert.equal(total({ ...custom, mamRecipes: false }), standard - 1 + 2);
  // Before #1058 a custom profile without them ranked them, as it still does.
  assert.equal(total(custom), standard - 1 + 2);
});

// A full export of one save holding `plan`.
const exported = (plan: StoredCalculatedPlan): SaveExport => ({
  format: 'satisfactory-planner-saves',
  version: 1,
  exportedAt: '2026-10-11T09:00:00.000Z',
  saves: [
    {
      id: 's1',
      name: 'World',
      activeProfile: 'p1',
      profiles: [{ id: 'p1', name: 'Stored', kind: 'calculated', plan, state: initialState() }],
    },
  ],
});
const withBox = (): StoredCalculatedPlan =>
  json(
    calculate({
      ...BASE,
      recipes: 'custom',
      alternateRecipes: PICKS,
      mamRecipes: true,
      plannerPicks: [PICKS[0]],
    }),
  );

test('migration: a custom plan stored before #1058 calculates with the pool it had', () => {
  assert.equal('mamRecipes' in stored.settings, false);
  assert.equal('mamRecipes' in settings(stored.settings), false);
  assert.equal('plannerPicks' in settings(stored.settings), false);
  // Until #1169 a recalculation gave exactly the stored plan. Since then Phases 2 and 3 plan their
  // nodes overclocked (the stored ones are at 100%), so the numbers move; the recipe pool does not:
  // no MAM recipe comes in, in any phase, as in the stored plan.
  const again = calculate(stored.settings);
  const mam = (plan: StoredCalculatedPlan) =>
    Object.values(plan.stages).flatMap(stage =>
      (stage.rows || []).map(row => row.id).filter(id => [...MAM_RECIPES, DISTILLED].includes(id)),
    );
  assert.deepEqual(mam(stored), []);
  assert.deepEqual(mam(again), []);
  assert.deepEqual(again.stages['3'].mining!.miner, { mark: 2, clock: 2.5 });
  assert.deepEqual(stored.stages['3'].mining!.miner, { mark: 2, clock: 1 });
});

test('migration: plans with and without the new fields load, import and export unchanged (Docker)', async () => {
  const plan = withBox();
  assert.equal(plan.settings.mamRecipes, true);
  assert.deepEqual(plan.settings.plannerPicks, [PICKS[0]]);
  for (const each of [stored, plan]) {
    const file = exported(each);
    const checked = validateTransfer(json(file)).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(checked), JSON.stringify(each));
    const imported = (await importableTransfer(json(file))).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(imported), JSON.stringify(each));
    const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-mam-recipes-'));
    try {
      const workspace = await loadWorkspace(dataDir, validateState);
      workspace.saves.push({
        id: 's1',
        name: 'World',
        userId: 'owner',
        activeProfile: 'p1',
        profiles: [
          { id: 'p1', name: 'Stored', kind: 'calculated', plan: each, state: initialState() },
        ],
      });
      await fsp.writeFile(path.join(dataDir, 'workspace.json'), JSON.stringify(workspace));
      const loaded = await loadWorkspace(dataDir, validateState);
      assert.equal(JSON.stringify(loaded.saves[0]!.profiles[0]!.plan), JSON.stringify(each));
    } finally {
      await fsp.rm(dataDir, { recursive: true, force: true });
    }
  }
  // A plan with the box recalculated with its own settings is the plan it was.
  assert.deepEqual(json(calculate(plan.settings).stages), json(plan.stages));
});

test('migration: the browser edition keeps both plans unchanged across a reload', async () => {
  const records = new Map<string, unknown>();
  const open = () =>
    createBrowserApi(
      openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      catalog(),
    );
  const plans = [stored, withBox()];
  let api = open();
  for (const plan of plans)
    await api('/api/import-saves', { body: JSON.stringify(exported(plan)) });
  api = open();
  const out = (await api('/api/export-saves')) as SaveExport;
  assert.deepEqual(
    out.saves.map(save => JSON.stringify(save.profiles[0]!.plan)),
    plans.map(plan => JSON.stringify(plan)),
  );
});

test('#1058: Review names a change of the MAM recipes, a plan made before the box included', () => {
  const change = (before: object, after: object) =>
    settingsChanges(settings(before), settings(after), []).changes.filter(
      entry => entry.label === 'MAM recipes',
    );
  // A Standard plan from before the box planned with them: ticked is no change.
  assert.deepEqual(change({}, { mamRecipes: true }), []);
  assert.deepEqual(change({}, { mamRecipes: false }), [
    { label: 'MAM recipes', before: 'On', after: 'Off' },
  ]);
  // A custom plan from before it only with the ones it picked.
  const custom = { recipes: 'custom', alternateRecipes: PICKS };
  assert.deepEqual(change(custom, { ...custom, mamRecipes: true }), [
    { label: 'MAM recipes', before: 'Only the ones picked', after: 'On' },
  ]);
  assert.deepEqual(change({ mamRecipes: true }, { mamRecipes: true, recipes: 'custom' }), []);
});
