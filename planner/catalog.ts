// The static data the interface needs before any calculation (catalog()).
// Re-exported by ../planner.ts.
import {
  vehicleFuels,
  constructionItems,
  elevatorParts,
  storageOptions,
  distributions,
  purities,
  powerOptions,
} from '../public/preferences.ts';
import type { Catalog } from '../public/types/index.ts';
import {
  DATA,
  ENGINE,
  MAM_RECIPES,
  MILESTONE_RECIPES,
  RAW,
  DEFAULT_LIMITS,
  PURE_LIMITS,
} from './data.ts';
import { storable, SLOOP_USES } from './settings.ts';
import { pureNames } from './recipes.ts';

// What a storage container can be named after when one is added (#295): every item the game
// has that is not a fluid, since a fluid does not go in a container, and not the two entries
// of the recipe data that are not items at all. The Hard Drive is in no recipe, so the data
// does not list it, but it is an item a container can hold.
const CONTAINER_ITEMS = [
  ...new Set([
    ...Object.keys(DATA.items).filter(
      name => !DATA.items[name]?.fluid && name !== 'Sink point' && name !== 'Power',
    ),
    'Hard Drive',
  ]),
].sort((a, b) => a.localeCompare(b));
// Static data the interface needs before any calculation: recipe lists for the wizard's
// alternate picker, storage, supply and raw-resource options, default budgets and goal labels.
// The Docker edition sends it with the session summary (server/scope.ts); build.ts writes it to
// catalog.json for the Pages edition, which public/browser-api.ts loads. The UI reads it as
// `workspace.catalog`.
export const catalog = (): Catalog => ({
  engine: ENGINE,
  alternates: DATA.recipes
    .filter(r => r.alternate && r.phase <= 5)
    .map(recipe => ({
      id: recipe.id,
      name: recipe.name.replace('Alternate: ', ''),
      phase: recipe.phase,
      machine: recipe.machine,
      inputs: recipe.inputs,
      outputs: recipe.outputs,
      ...(MAM_RECIPES.includes(recipe.id) ? { mam: true } : {}),
      ...(MILESTONE_RECIPES[recipe.id] ? { milestone: MILESTONE_RECIPES[recipe.id] } : {}),
      ...(pureNames.includes(recipe.name) ? { pure: true } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name)),
  standardRecipes: DATA.recipes
    .filter(r => !r.alternate)
    .map(recipe => ({
      id: recipe.id,
      name: recipe.name,
      phase: recipe.phase,
      machine: recipe.machine,
      inputs: recipe.inputs,
      outputs: recipe.outputs,
    })),
  storageOptions,
  supplyItems: [
    ...new Set(DATA.recipes.filter(r => r.phase <= 5).flatMap(r => Object.keys(r.outputs))),
  ]
    .filter(item => !RAW.includes(item) && !!DATA.items[item])
    .sort((a, b) => a.localeCompare(b)),
  containerItems: CONTAINER_ITEMS,
  storageItems: Object.keys(DATA.items)
    .filter(storable)
    .map(name => ({
      name,
      build: constructionItems.includes(name),
      delivered: elevatorParts.includes(name),
    }))
    .sort((a, b) => Number(b.build) - Number(a.build) || a.name.localeCompare(b.name)),
  distributions,
  purities,
  powerOptions,
  sloopUses: SLOOP_USES,
  raw: RAW,
  limits: DEFAULT_LIMITS,
  pureLimits: PURE_LIMITS,
  stacks: Object.fromEntries(
    Object.entries(DATA.items)
      .filter(([, item]) => !item.fluid)
      .map(([name, item]) => [name, item.stack]),
  ),
  // A fluid's packaged form, from the standard Packager recipe that takes it in: the item and
  // the m³ of fluid one item holds (4 for nitrogen gas, 1 for the others).
  packaged: Object.fromEntries(
    DATA.recipes
      .filter(r => r.machine === 'Packager' && !r.alternate)
      .flatMap(recipe => {
        const fluid = Object.keys(recipe.inputs).find(name => DATA.items[name]?.fluid);
        const item = Object.keys(recipe.outputs).find(name => !DATA.items[name]?.fluid);
        return fluid && item && Object.keys(recipe.outputs).length === 1
          ? [[fluid, { item, m3: recipe.inputs[fluid]! / recipe.outputs[item]! }]]
          : [];
      }),
  ),
  vehicleFuels: vehicleFuels.map(name => ({ name, mj: DATA.items[name]?.energy || 0 })),
  goals: [
    {
      id: 'minimal',
      name: 'Minimal construction',
      description: '24-hour deliveries; minimize production-building equivalents.',
    },
    {
      id: 'balanced',
      name: 'Balanced progression',
      description: '8-hour deliveries with the selected storage and recipe preferences.',
    },
    {
      id: 'timed',
      name: 'Target completion time',
      description: 'Calculate rates from your chosen hours per phase.',
    },
    {
      id: 'maximum',
      name: 'Maximum elevator output',
      description: 'Fastest simultaneous delivery within confirmed resource budgets.',
    },
  ],
});
