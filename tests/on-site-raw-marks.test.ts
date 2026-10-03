// Made on site (#921): a saved state may mark an item the planner cannot make on site, such as
// the raw resource Water (validateState accepts any known item, so such saves keep loading). The
// app's onSiteSettings leaves those marks out, so a stored mark never blocks a recalculation,
// while the planner keeps refusing a request that names one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, catalog, settings } from '../planner.ts';
import { onSitePlannable, onSiteSettings } from '../public/app/on-site.ts';
import { rawResources } from '../public/preferences.ts';
import { ITEM_NAMES, initialState, validateState } from '../public/state.ts';
import type { CurrentCalculatedPlan, FactoryGroups } from '../public/types/index.ts';

const BASE = { phase: '3', wholeMachines: true, limitsConfirmed: true };
const ALPHA = 'fg-alpha1';
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

let plain: CurrentCalculatedPlan | undefined;
// Phase 3 with whole machines and no item made on site, made once for the file. Its Phase 2
// coal power line uses Water, its Phase 3 Stator line Wire.
const plainPlan = () => (plain ??= calculate(BASE));

// A saved progress state whose group Alpha holds the coal power and Stator lines and marks
// `local` as made on site, loaded through validateState as the app loads a save.
function savedGroups(local: string[]): FactoryGroups {
  const state = validateState(
    json({
      ...initialState(),
      factoryGroups: {
        groups: [{ id: ALPHA, name: 'Alpha' }],
        assignments: {
          'power-coal': [{ group: ALPHA, rate: null }],
          Recipe_Stator_C: [{ group: ALPHA, rate: null }],
        },
        local: { [ALPHA]: local },
      },
    }),
  );
  assert.equal(state.version, 14, 'a state with marks is version 14');
  assert.deepEqual(
    state.factoryGroups.local,
    { [ALPHA]: local },
    'the saved marks load as they are',
  );
  return state.factoryGroups;
}

test('the plan uses Water in a line the group holds, so a Water mark has a share', () => {
  const plan = plainPlan();
  const coal = plan.stages['2'].rows?.find(row => row.id === 'power-coal');
  assert.ok((coal?.inputs.Water || 0) > 0, 'Phase 2 coal power uses Water');
  const stator = plan.stages['3'].rows?.find(row => row.id === 'Recipe_Stator_C');
  assert.ok((stator?.inputs.Wire || 0) > 0, 'Phase 3 Stators use Wire');
});

test('a saved Water mark is left out, and the recalculation succeeds as without it', () => {
  const plan = plainPlan();
  const onSite = onSiteSettings(plan, savedGroups(['Water']));
  assert.equal(onSite, undefined, 'nothing the planner can make on site is marked');
  const recalculated = calculate({ ...BASE, onSite });
  assert.equal('onSite' in recalculated.settings, false, 'the setting stays absent');
  for (const phase of ['1', '2', '3'] as const) {
    assert.equal(recalculated.stages[phase].feasible, true, `Phase ${phase} fits`);
    assert.deepEqual(
      recalculated.stages[phase].rows?.map(row => row.id),
      plan.stages[phase].rows?.map(row => row.id),
      `Phase ${phase} has the same lines as the plan without marks`,
    );
  }
});

test('Water and Wire marked together: Water is left out and Wire still gets its own line', () => {
  const plan = plainPlan();
  const onSite = onSiteSettings(plan, savedGroups(['Water', 'Wire']))!;
  assert.deepEqual(Object.keys(onSite), [ALPHA]);
  assert.deepEqual(onSite[ALPHA]!.items, ['Wire'], 'Water is dropped from the request');
  assert.ok(!JSON.stringify(onSite).includes('Water'), 'nowhere in the request');
  assert.equal(onSite[ALPHA]!.shares['2']?.['power-coal'], undefined, 'no share for Water');
  assert.equal(onSite[ALPHA]!.shares['3']!.Recipe_Stator_C, 1, 'the Stator line uses Wire');
  const recalculated = calculate({ ...BASE, onSite });
  assert.deepEqual(recalculated.settings.onSite, onSite, 'frozen with the plan as sent');
  const stage = recalculated.stages['3'];
  assert.equal(stage.feasible, true);
  const line = stage.rows?.find(row => row.id === `Recipe_Wire_C:${ALPHA}`);
  assert.ok(line, 'Alpha has its own Wire line');
  assert.deepEqual(line.onSite, { group: ALPHA, recipe: 'Recipe_Wire_C' });
  assert.ok((line.outputs.Wire || 0) > 0);
  assert.equal(
    stage.rows?.some(row => row.onSite && 'Water' in row.outputs),
    false,
    'no group makes Water on site',
  );
});

test('the planner keeps refusing a request that names a raw resource', () => {
  for (const items of [['Water'], ['Water', 'Wire']])
    assert.throws(
      () =>
        settings({
          phase: '5',
          wholeMachines: false,
          limitsConfirmed: true,
          onSite: { [ALPHA]: { items, shares: { '3': { Recipe_Stator_C: 1 } } } },
        }),
      /Invalid items made on site/,
      JSON.stringify(items),
    );
});

test('onSitePlannable agrees with the planner on every item name and raw resource', () => {
  const accepted = (item: string) => {
    try {
      settings({ onSite: { [ALPHA]: { items: [item], shares: { '3': { Recipe_Stator_C: 1 } } } } });
      return true;
    } catch {
      return false;
    }
  };
  for (const item of new Set([...ITEM_NAMES, ...rawResources, 'Nonsense']))
    assert.equal(onSitePlannable(item), accepted(item), item);
  for (const resource of rawResources) assert.equal(onSitePlannable(resource), false, resource);
  // The interface's list is the planner's: the Resources table reads the same one.
  assert.deepEqual(catalog().raw, [...rawResources]);
});
