// Game data and the fixed tables the planner plans with: recipes.json, the raw resources, the
// default budgets and the Space Elevator parts per phase.
//
// build.ts finds the node:fs import and the recipes.json read below by exact string match and
// replaces them for the browser; keep those snippets unchanged.
// Re-exported by ../planner.ts.
import fs from 'node:fs';
import type { ItemRates, RecipeData } from '../public/types/index.ts';

// Game data. `recipes`: id, name, alternate, the elevator `phase` from which it is available,
// machine, per-minute `inputs`/`outputs` for one machine at 100%, and `power` in MW per machine.
// `items`: fluid, radioactive, `energy` (MJ per item or m³, used for fuel generators) and `sink`
// (AWESOME Sink points; 0 means the sink refuses it). Recipe ids become row ids and progress keys.
export const DATA: RecipeData = JSON.parse(
  fs.readFileSync(new URL('../recipes.json', import.meta.url), 'utf8'),
);
// Recorded as `plan.engine` in every calculated plan, so a stored snapshot says which engine
// produced it. Nothing in the app reads it back at the moment.
export const ENGINE = '2.0.0';
// Turbofuel and Enriched Coal come from MAM research, not hard drives, so recipePool treats them
// as standard recipes. Under 'custom' recipes they are opt-in like any alternate, and settings()
// adds them itself when the power preference needs turbofuel.
export const MAM_RECIPES = ['Recipe_Alternate_Turbofuel_C', 'Recipe_Alternate_EnrichedCoal_C'];
// Power preferences other than auto/coal/fuel run turbofuel generators (directly or as the Phase 3 bridge).
export const powerNeedsTurbofuel = (mainPower: string | undefined) =>
  !['auto', 'coal', 'fuel'].includes(mainPower || 'auto');
// Every alternate recipe id: the whitelist for a profile's `alternateRecipes`.
export const ALT_IDS = new Set(DATA.recipes.filter(r => r.alternate).map(r => r.id));
// Extracted resources. Each is supplied by a `raw:` LP variable capped by the profile's budget in
// `settings.limits` (per minute); nothing crafts them except the Phase 5 Converter recipes, which
// are only in the pool when `conversion` is on. The order is the Resources table's row order
// (`catalog().raw`).
export const RAW: string[] = [
  'Iron Ore',
  'Copper Ore',
  'Limestone',
  'Coal',
  'Caterium Ore',
  'Raw Quartz',
  'Sulfur',
  'Bauxite',
  'Uranium',
  'SAM',
  'Crude Oil',
  'Nitrogen Gas',
  'Water',
];
// Resource budgets per minute for the default map at its own purities, every node worked at 250%
// clock: Miner Mk.3 300/600/1200 on impure/normal/pure, Oil Extractor 150/300/600 (resource wells
// excluded), Resource Well Extractor 75/150/300 per nitrogen satellite. These are `nodeCounts`
// in public/preferences.ts through that extraction table, and a test (guided.test.ts) rebuilds
// both tables from it. Water is a planning allowance, not a map total. Shipped to the interface
// as `catalog().limits`; a profile's own budgets live in `settings.limits`.
export const DEFAULT_LIMITS: ItemRates = {
  'Iron Ore': 92100,
  'Copper Ore': 36900,
  Limestone: 69300,
  Coal: 42300,
  'Caterium Ore': 15000,
  'Raw Quartz': 13500,
  Sulfur: 10800,
  Bauxite: 12300,
  Uranium: 2100,
  SAM: 10200,
  'Crude Oil': 9900,
  'Nitrogen Gas': 12000,
  Water: 1000000,
};
// The same nodes and extraction rates with every node pure (the "All Pure" purity setting).
// Shipped as `catalog().pureLimits`.
export const PURE_LIMITS: ItemRates = {
  'Iron Ore': 152400,
  'Copper Ore': 66000,
  Limestone: 112800,
  Coal: 74400,
  'Caterium Ore': 20400,
  'Raw Quartz': 20400,
  Sulfur: 19200,
  Bauxite: 20400,
  Uranium: 6000,
  SAM: 22800,
  'Crude Oil': 18000,
  'Nitrogen Gas': 13500,
  Water: 1000000,
};
// Space Elevator project parts per phase, as the game asks for them at a 1x cost multiplier.
// `run` scales them by `settings.multiplier` and turns them into delivery rates over the phase's
// hours. `elevatorParts` in public/preferences.ts is kept in step with this by a test. Item names
// here are part of saved progress: delivery counts are stored under '<phase>-<slugged name>'.
export const DELIVERIES: Record<number, ItemRates> = {
  1: { 'Smart Plating': 50 },
  2: { 'Smart Plating': 1000, 'Versatile Framework': 1000, 'Automated Wiring': 100 },
  3: { 'Versatile Framework': 2500, 'Modular Engine': 500, 'Adaptive Control Unit': 100 },
  4: {
    'Assembly Director System': 500,
    'Magnetic Field Generator': 500,
    'Thermal Propulsion Rocket': 250,
    'Nuclear Pasta': 100,
  },
  5: {
    'Nuclear Pasta': 1000,
    'Biochemical Sculptor': 1000,
    'AI Expansion Server': 256,
    'Ballistic Warp Drive': 200,
  },
};
