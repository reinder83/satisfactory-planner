// The game mode's recipe part cost multiplier (#1161, the first slice of #1078):
// settings.recipeCost, one of the game's steps (RECIPE_COSTS, 0.25× to 2×), scales every recipe's
// inputs in the pool the planner and the LP plan with (recipePool in planner/recipes.ts); the
// outputs, machines and power stay, and the power generators keep their fuel. So the lines, the
// raw totals, the power and the feasibility check all follow it. It belongs to the plan snapshot,
// like ownedMiner: absent at 1×, so a 1× plan and every plan stored before it calculates, loads,
// imports and exports exactly as before, in both editions. Nothing recalculates a plan for it:
// the pages and Review name the multiplier a plan was calculated with.
import './helpers/en-us-numbers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { calculate, catalog, recipePool, settings } from '../planner.ts';
import { generators } from '../planner/recipes.ts';
import { DATA } from '../planner/data.ts';
import { solve } from '../optimizer.ts';
import { powerView } from '../public/power.ts';
import { RECIPE_COSTS, recipeCostChoices, recipeCostOf } from '../public/preferences.ts';
import { initialState, validateState } from '../public/state.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import { loadWorkspace } from '../server/persistence.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { defaultProfileName, profileSummary, settingsChanges } from '../public/app/profile-edit.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import {
  browserProfile,
  createdProfile,
  dockerProfile,
  newSaveRequest,
} from './helpers/editions.ts';
import type {
  CurrentCalculatedPlan,
  Recipe,
  SaveExport,
  StoredCalculatedPlan,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
// A plan without the time it was made, which is all that differs between two calculations.
const timeless = (plan: CurrentCalculatedPlan | StoredCalculatedPlan) =>
  JSON.stringify({ ...plan, createdAt: '' });
const close = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), message);

test('settings keep a recipe part cost of the game’s steps other than 1×, and refuse any other', () => {
  assert.deepEqual(RECIPE_COSTS, [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
  for (const cost of RECIPE_COSTS.filter(cost => cost !== 1))
    assert.equal(settings({ recipeCost: cost }).recipeCost, cost, String(cost));
  assert.equal('recipeCost' in settings({}), false, 'absent unless chosen');
  assert.equal('recipeCost' in settings({ recipeCost: 1 }), false, '1× is the default: absent');
  for (const wrong of [0, 0.3, 3, -1, '2', null, Number.NaN, Infinity, [2], { cost: 2 }])
    assert.throws(
      () => settings({ recipeCost: wrong }),
      (error: Error & { status?: number }) =>
        error.status === 400 && error.message === 'Choose a recipe part cost from 0.25× to 2×.',
      JSON.stringify(wrong),
    );
  // The wizard's select offers every step, 1× marked as the default.
  assert.deepEqual(recipeCostChoices, [
    ['0.25', '0.25×'],
    ['0.5', '0.5×'],
    ['0.75', '0.75×'],
    ['1', '1× (default)'],
    ['1.25', '1.25×'],
    ['1.5', '1.5×'],
    ['1.75', '1.75×'],
    ['2', '2×'],
  ]);
  assert.equal(recipeCostOf({}), 1);
  assert.equal(recipeCostOf({ recipeCost: 0.5 }), 0.5);
});

test('the LP’s recipes take the multiplier times their inputs, with the same outputs, machines and power', () => {
  let packagers = 0;
  for (const phase of [1, 3, 5])
    for (const cost of [0.25, 2]) {
      const plain = recipePool(settings({ recipes: 'all' }), phase, true),
        scaled = recipePool(settings({ recipes: 'all', recipeCost: cost }), phase, true);
      assert.equal(scaled.length, plain.length, 'the same recipes');
      plain.forEach((recipe, i) => {
        const other = scaled[i]!;
        assert.deepEqual(
          { ...other, inputs: {} },
          { ...recipe, inputs: {} },
          'outputs, machine, power and the rest',
        );
        assert.deepEqual(Object.keys(other.inputs), Object.keys(recipe.inputs));
        // The Packager's recipes keep their 1× inputs (a pack and unpack pair would otherwise
        // make the fluid from nothing below 1×).
        if (recipe.machine === 'Packager') packagers++;
        const factor = recipe.machine === 'Packager' ? 1 : cost;
        for (const [item, rate] of Object.entries(recipe.inputs))
          close(other.inputs[item]!, rate * factor, `${recipe.id} ${item}`);
      });
      // The power generators are not recipes: they burn the same fuel.
      assert.deepEqual(
        generators(settings({ recipeCost: cost }), phase),
        generators(settings({}), phase),
      );
    }
  assert.ok(packagers > 0, 'the Packager recipes were checked');
});

// Whether `pool` can make anything from nothing: an LP that runs each recipe at most once, may
// not take in any item (not even a raw resource) more than it makes, and maximises everything it
// makes on balance. Excited Photonic Matter is left out: the Converter makes it from no inputs
// at every multiplier, and the plans treat it as free. Returns the net surplus, 0 when none.
const fromNothing = (pool: Recipe[]): number => {
  const variables: Record<string, Record<string, number>> = {},
    constraints: Record<string, { min?: number; max?: number }> = {};
  for (const recipe of pool.filter(recipe => Object.keys(recipe.inputs).length)) {
    const column: Record<string, number> = { surplus: 0, ['once:' + recipe.id]: 1 };
    for (const [item, rate] of Object.entries(recipe.outputs))
      column['item:' + item] = (column['item:' + item] || 0) + rate;
    for (const [item, rate] of Object.entries(recipe.inputs))
      column['item:' + item] = (column['item:' + item] || 0) - rate;
    for (const [key, rate] of Object.entries(column)) {
      if (key.startsWith('item:')) {
        column.surplus! += rate;
        constraints[key] = { min: 0 };
      }
    }
    variables[recipe.id] = column;
    constraints['once:' + recipe.id] = { max: 1 };
  }
  const { values } = solve({ optimize: 'surplus', opType: 'max', constraints, variables });
  return Object.entries(values).reduce(
    (sum, [id, rate]) => sum + (variables[id]?.surplus || 0) * rate,
    0,
  );
};

test('below 1× nothing is made from nothing: the Packager keeps 1×, so no pack and unpack loop', () => {
  // With every alternate and the Converter's ore conversions, at each step below 1×, no set of
  // recipes makes any item without taking in more of another (#1164's review: a Packaged and
  // Unpackage Rocket Fuel pair made Rocket Fuel from nothing at 0.5×).
  for (const cost of [0.25, 0.5, 0.75]) {
    const config = settings({ recipes: 'all', recipeCost: cost, nuclear: 'recycle' });
    for (const phase of [3, 5])
      assert.ok(fromNothing(recipePool(config, phase, true)) < 1e-6, `${cost}× phase ${phase}`);
  }
  // A Phase 5 plan at 0.5× and 0.25×, standard and with every alternate, packs no fluid only to
  // unpack it, and its Packager lines take their recipe's 1× inputs.
  const byId = new Map(DATA.recipes.map(recipe => [recipe.id, recipe]));
  for (const cost of [0.5, 0.25])
    for (const recipes of ['standard', 'all'] as const) {
      const plan = calculate({ phase: '5', recipes, recipeCost: cost });
      for (const [phase, stage] of Object.entries(plan.stages)) {
        const rows = (stage.rows || []).filter(row => row.equivalent > 0);
        const names = new Set(rows.map(row => row.name));
        for (const row of rows) {
          const fluid = /^Packaged (.+)$/.exec(row.name)?.[1];
          assert.ok(
            !fluid || !names.has('Unpackage ' + fluid),
            `${cost}× ${recipes} phase ${phase}: ${row.name} and its Unpackage`,
          );
          const recipe = byId.get(row.id);
          if (recipe?.machine !== 'Packager') continue;
          for (const [item, rate] of Object.entries(recipe.inputs))
            close(row.inputs[item]! / row.equivalent, rate, `${cost}× ${row.name} ${item}`);
        }
      }
    }
});

test('a plan at 2× takes twice the inputs per line, and its totals, power and feasibility follow', () => {
  const plain = calculate({ phase: '4' }),
    doubled = calculate({ phase: '4', recipeCost: 2 }),
    halved = calculate({ phase: '4', recipeCost: 0.5 });
  assert.equal(doubled.settings.recipeCost, 2);
  // Every production line takes twice the inputs of its recipe per machine at 100%, and makes
  // what the recipe makes.
  const byId = new Map(recipePool(settings({ phase: '4' }), 5, false).map(r => [r.id, r]));
  for (const phase of ['2', '3'] as const) {
    let lines = 0;
    for (const row of doubled.stages[phase].rows || []) {
      const recipe = byId.get(row.id);
      if (!recipe || row.equivalent <= 0) continue;
      lines++;
      for (const [item, rate] of Object.entries(recipe.inputs))
        close(row.inputs[item]! / row.equivalent, rate * 2, `${phase} ${row.id} ${item}`);
      for (const [item, rate] of Object.entries(recipe.outputs))
        close(row.outputs[item]! / row.equivalent, rate, `${phase} ${row.id} ${item}`);
    }
    assert.ok(lines > 10, `${phase}: ${lines} lines checked`);
  }
  // The same deliveries cost more raw resources, machines and power at 2×, and less at 0.5×.
  const total = (plan: CurrentCalculatedPlan, phase: '3') =>
    Object.values(plan.stages[phase].raw || {}).reduce((sum, rate) => sum + rate, 0);
  const buildings = (plan: CurrentCalculatedPlan, phase: '3') =>
    (plan.stages[phase].rows || []).reduce((sum, row) => sum + row.machines, 0);
  const need = (plan: CurrentCalculatedPlan, phase: '3') =>
    powerView(plan.stages[phase], plan.settings).needMW;
  for (const measure of [total, buildings, need]) {
    assert.ok(measure(doubled, '3') > measure(plain, '3'), measure.name);
    assert.ok(measure(halved, '3') < measure(plain, '3'), measure.name);
  }
  assert.deepEqual(
    Object.keys(doubled.stages['3'].delivery || {}),
    Object.keys(plain.stages['3'].delivery || {}),
    'the same deliveries',
  );
  // The default budgets fit Phase 4 at 1×, not at 2×, and the plan says why.
  assert.equal(plain.stages['4'].feasible, true);
  assert.equal(doubled.stages['4'].feasible, false);
  assert.match(String(doubled.stages['4'].reason), /needs more .* than the entered budgets/);
});

test('1× is the plan it was, byte for byte', () => {
  const plain = calculate({ phase: '3' });
  for (const absent of [undefined, 1]) {
    const again = calculate({ phase: '3', recipeCost: absent });
    assert.equal('recipeCost' in again.settings, false);
    assert.equal(timeless(again), timeless(plain));
  }
});

test('Review names a change of the recipe part cost, a plan made before the setting as 1×', () => {
  const goals = catalog().goals;
  const before = json(calculate({ phase: '3' })).settings;
  const named = (from: object, to: object) =>
    settingsChanges(from, to, goals).changes.filter(change => change.label === 'Recipe part cost');
  assert.deepEqual(named(before, { ...before, recipeCost: 2 }), [
    { label: 'Recipe part cost', before: '1×', after: '2×' },
  ]);
  assert.deepEqual(named({ ...before, recipeCost: 0.5 }, before), [
    { label: 'Recipe part cost', before: '0.5×', after: '1×' },
  ]);
  assert.deepEqual(named(before, before), []);
  assert.deepEqual(named({ ...before, recipeCost: 1.5 }, { ...before, recipeCost: 1.5 }), []);
  assert.equal(settingsChanges(before, { ...before, recipeCost: 2 }, goals).others, 0);
  // A profile card names it when it is not 1×, and so does a new profile's name.
  assert.equal(
    profileSummary({ purity: 'vanilla', multiplier: 1, powerFactor: 1 }),
    'vanilla purity · 1× elevator · 1× power',
  );
  assert.equal(
    profileSummary({ purity: 'vanilla', multiplier: 1, powerFactor: 1, recipeCost: 2 }),
    'vanilla purity · 1× elevator · 1× power · 2× recipe parts',
  );
  const date = new Date('2026-10-07T12:00:00');
  assert.match(
    defaultProfileName({ goal: 'balanced', phase: '1', recipeCost: 2 }, null, goals, date),
    /^Balanced progression · 2× recipe parts · /,
  );
  assert.doesNotMatch(
    defaultProfileName({ goal: 'balanced', phase: '1' }, null, goals, date),
    /recipe parts/,
  );
});

// A full export of one save holding `plan`.
const exported = (plan: StoredCalculatedPlan): SaveExport => ({
  format: 'satisfactory-planner-saves',
  version: 1,
  exportedAt: '2026-10-14T08:00:00.000Z',
  saves: [
    {
      id: 's1',
      name: 'World',
      activeProfile: 'p1',
      profiles: [{ id: 'p1', name: 'Stored', kind: 'calculated', plan, state: initialState() }],
    },
  ],
});
const fixture = (name: string): StoredCalculatedPlan => {
  const file = JSON.parse(
    fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'),
  ) as { plan?: StoredCalculatedPlan } & StoredCalculatedPlan;
  return file.plan ?? file;
};
const before = fixture('plan-before-1065.json');
const doubledPlan = (): StoredCalculatedPlan => json(calculate({ phase: '3', recipeCost: 2 }));

test('migration: plans stored before the setting recalculate unchanged, as 1×', () => {
  for (const plan of [before, fixture('calculated-plan-2026-09-12.json')]) {
    assert.equal('recipeCost' in plan.settings, false);
    assert.equal(recipeCostOf(plan.settings), 1);
    assert.equal('recipeCost' in settings(plan.settings), false);
  }
  assert.equal(JSON.stringify(calculate(before.settings).stages), JSON.stringify(before.stages));
});

test('migration: plans with and without the multiplier load, import and export unchanged (Docker)', async () => {
  for (const plan of [before, doubledPlan()]) {
    const file = exported(plan);
    const checked = validateTransfer(json(file)).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(checked), JSON.stringify(plan));
    const imported = (await importableTransfer(json(file))).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(imported), JSON.stringify(plan));
    const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-recipe-cost-'));
    try {
      const workspace = await loadWorkspace(dataDir, validateState);
      workspace.saves.push({
        id: 's1',
        name: 'World',
        userId: 'owner',
        activeProfile: 'p1',
        profiles: [{ id: 'p1', name: 'Stored', kind: 'calculated', plan, state: initialState() }],
      });
      await fsp.writeFile(path.join(dataDir, 'workspace.json'), JSON.stringify(workspace));
      const loaded = await loadWorkspace(dataDir, validateState);
      assert.equal(JSON.stringify(loaded.saves[0]!.profiles[0]!.plan), JSON.stringify(plan));
    } finally {
      await fsp.rm(dataDir, { recursive: true, force: true });
    }
  }
});

// The browser edition over a fake IndexedDB that keeps `records` between opens.
const browserApi = (records: Map<string, unknown>) =>
  createBrowserApi(
    openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
      throw Error('not needed');
    }),
    calculate,
    catalog(),
  );

test('migration: the browser edition keeps both plans unchanged across a reload', async () => {
  const records = new Map<string, unknown>();
  const plans = [before, doubledPlan()];
  let api = browserApi(records);
  for (const plan of plans)
    await api('/api/import-saves', { body: JSON.stringify(exported(plan)) });
  api = browserApi(records);
  const out = (await api('/api/export-saves')) as SaveExport;
  assert.deepEqual(
    out.saves.map(save => JSON.stringify(save.profiles[0]!.plan)),
    plans.map(plan => JSON.stringify(plan)),
  );
});

test('both editions create a plan with the multiplier the wizard sends', async () => {
  const body = newSaveRequest({ phase: '2', recipeCost: 1.5 });
  const docker = createdProfile(await dockerProfile(body)),
    browser = createdProfile(await browserProfile(body));
  assert.equal(docker.settings.recipeCost, 1.5);
  assert.deepEqual(json(browser), json(docker));
  // A value the game does not offer is refused, never rounded to a step.
  await assert.rejects(
    browserProfile(newSaveRequest({ phase: '2', recipeCost: 3 })),
    /Choose a recipe part cost from 0\.25× to 2×\./,
  );
});
