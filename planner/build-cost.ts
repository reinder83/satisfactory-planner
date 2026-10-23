// What a phase's buildings cost to build, in its model (#1229, settings.buildCost). Only the check
// of a plan that counts it (build-cost-draft.ts) and that check's draft add these rows, never the
// solves that plan a phase, so a phase that passes the check keeps exactly the plan it has without
// it.
//
// The model counts machine-equivalents, so each building is counted per machine-equivalent of the
// lines it runs (the last, underclocked machine of a line in proportion to its clock): every
// recipe's level, a built line's (#1176) included, counts towards its machine's buildings, and
// every raw source's draw towards its extractors (a node's miner or Oil Extractor at the phase's
// clock, a resource-well satellite's extractor and its share of the well's pressurizer, Water
// Extractors for Water). Per building, 'standing:<building>' holds those together to at most the
// buildings that already stand plus 'newBuildings:<building>', the buildings to add: the machines
// of the phase's built lines (any recipe of the same machine, since a machine changes its recipe
// for free) and the generators you already have. Each building to add takes the parts BUILD_COSTS
// lists from their item balances, spread over the phase's time like its deliveries, so the phase
// must make them as well. A part no recipe of the phase can make is left out (a Miner's Portable
// Miners, which the Equipment Workshop makes by hand unless the Automated Miner alternate is
// allowed). The lines that make the parts are buildings too, so the solve finds the plan that
// also pays for itself.
import {
  BUILD_COSTS,
  isWellKind,
  MINER_BASE,
  nodeYield,
  oilNodeResources,
  sourceYield,
  WATER_EXTRACTOR,
  waterClock,
  WELL_SATELLITES,
  wellResources,
  wellYield,
} from '../public/preferences.ts';
import { extractionEquipment } from '../public/power.ts';
import type { LpModel } from '../optimizer.ts';
import type { ItemRates, MiningSource, StageBuildCost, StageKey } from '../public/types/index.ts';
import type { PoolRecipe, Solved } from './types.ts';
import type { PhaseContext, Solution } from './model.ts';
import { RAW } from './data.ts';
import { BUILT } from './stage.ts';

// The variable of the buildings to add of one kind, and the row that holds a kind's buildings to
// those standing plus those to add.
const NEW_BUILDINGS = 'newBuildings:';
const STANDING = 'standing:';

// Adds the build-cost rows to a phase's model (see the header). `hours` is the time the phase's
// deliveries are spread over (goalHours), `reachable` the items its pool can make.
export function addBuildCosts(
  model: LpModel,
  context: PhaseContext,
  pool: PoolRecipe[],
  hours: number,
  reachable: Set<string>,
) {
  const counted = buildingVariables(model, context, pool);
  const standing = standingBuildings(context, pool);
  for (const [building, variables] of counted) {
    const row = STANDING + building;
    model.constraints[row] = { max: standing.get(building) ?? 0 };
    for (const [variable, perUnit] of variables) model.variables[variable]![row] = perUnit;
    const takes: Record<string, number> = { [row]: -1 };
    for (const [item, amount] of Object.entries(BUILD_COSTS[building]!.cost))
      if (reachable.has(item) && model.constraints['item:' + item])
        takes['item:' + item] = -amount / (hours * 60);
    model.variables[NEW_BUILDINGS + building] = takes;
  }
}
// Per building with a cost, the model's variables that run it and how many of it one unit of each
// takes: a recipe's machine per machine-equivalent (its built twin's too), and each raw source's
// extractors per item or m³ a minute.
function buildingVariables(
  model: LpModel,
  context: PhaseContext,
  pool: PoolRecipe[],
): Map<string, Map<string, number>> {
  const counted = new Map<string, Map<string, number>>();
  const count = (building: string, variable: string, perUnit: number) => {
    if (!BUILD_COSTS[building] || !model.variables[variable] || !(perUnit > 0)) return;
    const variables = counted.get(building) ?? new Map<string, number>();
    variables.set(variable, (variables.get(variable) ?? 0) + perUnit);
    counted.set(building, variables);
  };
  for (const recipe of pool)
    for (const variable of [recipe.id, BUILT + recipe.id]) count(recipe.machine, variable, 1);
  for (const item of RAW) {
    for (const [building, perUnit] of extractorsPerUnit(context, item))
      count(building, 'raw:' + item, perUnit);
    for (const kind of context.mining?.sources[item] ?? [])
      for (const [building, perUnit] of extractorsPerUnit(context, item, kind))
        count(building, 'raw:' + item + '@' + kind.kind, perUnit);
  }
  return counted;
}
// The extractors one item (or m³) a minute of a raw resource takes, by building. From a node kind
// of a phase with mining per phase (#1065): its machine at the phase's clock, never more than its
// belt or pipe carries (sourceYield), and for a resource-well satellite its extractor and a share
// of the well's pressurizer (WELL_SATELLITES to a well, as the power model counts it). Otherwise
// at the phase's miner and clock (the survey's, else Mk.3 at 250%) on normal nodes, as the
// extraction power is counted (extractionMWPerUnit): Water from Water Extractors, Nitrogen Gas
// from resource wells, Crude Oil from Oil Extractors and the rest from miners.
function extractorsPerUnit(
  { config, mining }: PhaseContext,
  item: string,
  kind?: MiningSource,
): [building: string, perUnit: number][] {
  const well = (output: number): [string, number][] => [
    ['Resource Well Extractor', 1 / output],
    ['Resource Well Pressurizer', 1 / (output * WELL_SATELLITES)],
  ];
  if (kind && mining) {
    const output = sourceYield(kind, mining.miner.clock);
    if (!(output > 0)) return [];
    return isWellKind(kind.kind) ? well(output) : [[kind.machine, 1 / output]];
  }
  const equipment = mining ? mining.miner : extractionEquipment(config);
  if (item === 'Water')
    return [
      [
        'Water Extractor',
        1 / (WATER_EXTRACTOR.rate * (mining ? waterClock(mining) : equipment.clock)),
      ],
    ];
  if (wellResources.includes(item) && !oilNodeResources.includes(item))
    return well(wellYield('normal', equipment));
  const output = nodeYield(item, 'normal', equipment);
  if (!(output > 0)) return [];
  const miner = MINER_BASE[equipment.mark] ? equipment.mark : 3;
  return [[oilNodeResources.includes(item) ? 'Oil Extractor' : `Miner Mk.${miner}`, 1 / output]];
}
// The buildings that already stand in the phase, by building: the machines of its built lines
// (settings.builtLines, #1176; an amplified twin's by its recipe's machine) and the generators you
// already have (settings.ownedGenerators, #1068).
function standingBuildings(
  { config, phase }: PhaseContext,
  pool: PoolRecipe[],
): Map<string, number> {
  const standing = new Map<string, number>();
  const add = (building: string, count: number) =>
    standing.set(building, (standing.get(building) ?? 0) + count);
  for (const [id, count] of Object.entries(config.builtLines?.[String(phase) as StageKey] ?? {})) {
    const recipeId = id.startsWith('amp:') ? id.slice(4) : id;
    const recipe = pool.find(entry => entry.id === recipeId);
    if (recipe) add(recipe.machine, count);
  }
  for (const [building, count] of Object.entries(config.ownedGenerators ?? {}))
    if (count) add(building, count);
  return standing;
}
// The stage of a solve with the build-cost rows, with what its buildings to add cost
// (StageBuildCost): each building rounded up to whole buildings and the parts those take that the
// model counted, the largest building first. What the parts take a minute is no surplus, so it
// comes off the stage's surplus.
export function withBuildCost(
  stage: Solved,
  model: LpModel,
  solved: Solution,
  hours: number,
): Solved {
  const buildings: Record<string, number> = {},
    parts: ItemRates = {},
    surplus = { ...stage.surplus };
  const sorted = Object.keys(model.variables)
    .filter(name => name.startsWith(NEW_BUILDINGS) && (solved.values[name] || 0) > 1e-6)
    .sort((first, second) => (solved.values[second] || 0) - (solved.values[first] || 0));
  for (const name of sorted) {
    const level = solved.values[name]!,
      count = Math.ceil(level - 1e-6);
    const building = name.slice(NEW_BUILDINGS.length);
    buildings[building] = count;
    for (const [row, coefficient] of Object.entries(model.variables[name]!)) {
      if (!row.startsWith('item:') || !(coefficient < 0)) continue;
      const item = row.slice('item:'.length);
      parts[item] = (parts[item] ?? 0) + BUILD_COSTS[building]!.cost[item]! * count;
      if (surplus[item] !== undefined) surplus[item] = surplus[item]! + coefficient * level;
    }
  }
  const buildCost: StageBuildCost = { hours, buildings, parts };
  return {
    ...stage,
    surplus: Object.fromEntries(Object.entries(surplus).filter(([, rate]) => rate > 0.002)),
    buildCost,
  };
}
