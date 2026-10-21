// The build-cost table (#1073, public/app/build-costs.ts), copied once from the SatisfactoryTools
// revision recipes.json records: every building's recipe id is the one progression.json lists for
// it, every part is an item the dataset knows, and every machine a plan's rows can name has a cost.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILD_COSTS } from '../public/app/build-costs.ts';
import { ITEM_NAMES } from '../public/state.ts';
import { settings } from '../planner.ts';
import { generators } from '../planner/recipes.ts';
import { recipes } from './helpers/data.ts';

const progression: { buildings: Record<string, string> } = JSON.parse(
  readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
// The two generators the planner names apart from progression.json.
const LISTED_AS: Record<string, string> = {
  'Coal Generator': 'Coal-Powered Generator',
  'Fuel Generator': 'Fuel-Powered Generator',
};

test('each building cost is the building recipe progression.json lists for it', () => {
  for (const [name, { recipe }] of Object.entries(BUILD_COSTS))
    assert.equal(progression.buildings[LISTED_AS[name] ?? name], recipe, name);
});

test('each part of a building cost is a known item, in whole amounts from 1', () => {
  for (const [name, { cost }] of Object.entries(BUILD_COSTS)) {
    assert.ok(Object.keys(cost).length > 0, name + ' costs something');
    for (const [item, amount] of Object.entries(cost)) {
      assert.ok(ITEM_NAMES.includes(item), `${name}: ${item} is a known item`);
      assert.ok(Number.isInteger(amount) && amount >= 1, `${name}: ${item} × ${amount}`);
    }
  }
});

test('every machine a plan row can name has a building cost', () => {
  // Nuclear power needs a waste strategy as well, so its plant is named here.
  const machines = new Set([
    ...recipes.map(recipe => recipe.machine),
    ...generators(settings({}), 5).map(generator => generator.machine),
    'Nuclear Power Plant',
  ]);
  assert.ok(machines.has('Coal Generator') && machines.has('Fuel Generator'));
  for (const machine of machines) assert.ok(BUILD_COSTS[machine], machine);
});

test('a few costs read as the game gives them', () => {
  assert.deepEqual(BUILD_COSTS.Refinery!.cost, {
    Motor: 10,
    'Encased Industrial Beam': 10,
    'Steel Pipe': 30,
    'Copper Sheet': 20,
  });
  assert.deepEqual(BUILD_COSTS['Water Extractor']!.cost, {
    'Copper Sheet': 20,
    'Reinforced Iron Plate': 10,
    Rotor: 10,
  });
  assert.deepEqual(BUILD_COSTS.Constructor!.cost, { 'Reinforced Iron Plate': 2, Cable: 8 });
});
