// Made on site (#967): once a group marks a part, its "Made on site" picker also offers the
// ingredients of the part's recipe, because a recalculation gives the group its own line of that
// recipe, which takes the ingredients the group marks from its own lines (siteCopies in
// planner/on-site.ts). The picker follows only the recipes the planner copies for a group
// (onSiteCopyable in public/app/on-site.ts), so it never offers an ingredient of a line no
// recalculation makes, such as a nuclear one (#933), or one that makes the part only as a
// byproduct (#1012). This checks the two rules agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../planner.ts';
import { siteCopies } from '../planner/on-site.ts';
import { onSiteCopyable, onSitePlannable } from '../public/app/on-site.ts';
import { recipes } from './helpers/data.ts';
import type { Recipe } from '../public/types/index.ts';

const ALPHA = 'fg-alpha1';

// Whether the planner copies `recipe` for Alpha when Alpha marks `part` and its one consumer
// takes it.
function plannerCopies(recipe: Recipe, part: string): boolean {
  const consumer = {
    id: 'Consumer',
    name: 'Consumer',
    phase: 1,
    machine: 'Constructor',
    power: 4,
    inputs: { [part]: 1 },
    outputs: {},
  };
  const config = settings({
    onSite: { [ALPHA]: { items: [part], shares: { '3': { Consumer: 1 } } } },
  });
  return siteCopies(config, 3, [consumer, recipe]).some(copy => copy.onSite?.recipe === recipe.id);
}

test('the picker follows a part to its ingredients exactly where the planner copies its recipe', () => {
  let copied = 0,
    skipped = 0;
  for (const recipe of recipes)
    for (const part of Object.keys(recipe.outputs).filter(onSitePlannable)) {
      const planner = plannerCopies(recipe, part);
      assert.equal(onSiteCopyable(recipe, part), planner, `${recipe.name} for ${part}`);
      if (planner) copied++;
      else skipped++;
    }
  // Both kinds are there: most recipes are copied, nuclear ones and byproducts are not.
  assert.ok(copied > 100 && skipped > 0, `${copied} copied, ${skipped} not`);
});

test('#1012: a recipe is copied only for its primary product, never for a byproduct', () => {
  const recipe = (id: string) => recipes.find(candidate => candidate.id === id)!;
  for (const [id, product, byproduct] of [
    ['Recipe_RocketFuel_C', 'Rocket Fuel', 'Compacted Coal'],
    ['Recipe_AluminaSolution_C', 'Alumina Solution', 'Silica'],
    ['Recipe_LiquidFuel_C', 'Fuel', 'Polymer Resin'],
    ['Recipe_Plastic_C', 'Plastic', 'Heavy Oil Residue'],
    ['Recipe_Rubber_C', 'Rubber', 'Heavy Oil Residue'],
    ['Recipe_SpaceElevatorPart_12_C', 'AI Expansion Server', 'Dark Matter Residue'],
    ['Recipe_SuperpositionOscillator_C', 'Superposition Oscillator', 'Dark Matter Residue'],
  ] as const) {
    assert.equal(plannerCopies(recipe(id), product), true, `${id} for ${product}`);
    assert.equal(onSiteCopyable(recipe(id), product), true, `${id} for ${product}`);
    assert.equal(plannerCopies(recipe(id), byproduct), false, `${id} for ${byproduct}`);
    assert.equal(onSiteCopyable(recipe(id), byproduct), false, `${id} for ${byproduct}`);
  }
});
