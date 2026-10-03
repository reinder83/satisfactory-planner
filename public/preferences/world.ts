// The World Randomization settings, the original map's node counts and the default resource
// budgets they give. Unknown seed totals must never masquerade as verified budgets.
import type { Choice, ItemRates } from '../types/index.ts';

// World Randomization "resource distribution" choices (`settings.distribution`). Only
// 'original' has known node totals; the rest are handled by resourceDefaults below and knownWorld
// (presets.ts).
export const distributions: Choice[] = [
  ['original', 'Default'],
  ['randomized', 'Random'],
  ['basic', 'Basic Resource Rich'],
  ['advanced', 'Advanced Resource Rich'],
  ['fossil', 'Fossil Fuel Rich'],
];
// World Randomization "node purity" choices (`settings.purity`); 'custom' means totals entered
// by hand.
export const purities: Choice[] = [
  ['vanilla', 'Default'],
  ['pure', 'All Pure'],
  ['mostly-pure', 'Mostly Pure'],
  ['normal', 'Average (all normal)'],
  ['mostly-impure', 'Mostly Impure'],
  ['impure', 'All Impure'],
  ['random', 'Random'],
  ['custom', 'Custom / manual'],
];
// The raw resources the planner extracts (RAW in planner/data.ts, which plans with this list).
// Kept here, outside the planner, so the interface can apply the planner's rules about them
// without loading recipes.json: an item made on site is never one of them (onSitePlannable in
// public/app/on-site.ts, #921). The order is the Resources table's row order (`catalog().raw`).
export const rawResources: readonly string[] = [
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
// Original map: impure / normal / pure, from the official resource-node and well tables.
// Known facts, not estimates. Nitrogen Gas counts resource-well satellites, not nodes.
// Crude Oil counts oil nodes only; its wells are not in this table.
export const nodeCounts: Record<string, [impure: number, normal: number, pure: number]> = {
  'Iron Ore': [39, 42, 46],
  'Copper Ore': [13, 29, 13],
  Limestone: [15, 50, 29],
  Coal: [15, 31, 16],
  'Caterium Ore': [0, 9, 8],
  'Raw Quartz': [3, 7, 7],
  Sulfur: [6, 5, 5],
  Bauxite: [5, 6, 6],
  Uranium: [3, 2, 0],
  SAM: [10, 6, 3],
  'Crude Oil': [10, 12, 8],
  'Nitrogen Gas': [2, 7, 36],
};
// Default resource budgets (items/min, Mk.3 miners at 250%) for a purity and distribution;
// planner.ts fills any missing limit from it and the wizard shows it. `rate` is one impure
// node's yield and `weights` multiply it per impure/normal/pure node: 1 impure, 2 normal, 4
// pure, with the Mostly settings shifting one level. `uncertain` marks a seed-dependent
// result, and `description` says which.
export function resourceDefaults(
  purity = 'vanilla',
  distribution = 'original',
): { limits: ItemRates; uncertain: boolean; description: string } {
  const uncertain = distribution !== 'original' || ['random', 'custom'].includes(purity);
  const limits: ItemRates = { Water: 1000000 };
  for (const [name, counts] of Object.entries(nodeCounts)) {
    // Rich presets have seed-dependent counts; zero is an unallocated budget, not a claim that the map lacks this resource.
    if (['basic', 'advanced', 'fossil'].includes(distribution)) {
      limits[name] = 0;
      continue;
    }
    const rate = name === 'Crude Oil' ? 150 : name === 'Nitrogen Gas' ? 75 : 300;
    const weights =
      purity === 'pure'
        ? [4, 4, 4]
        : purity === 'normal'
          ? [2, 2, 2]
          : purity === 'impure'
            ? [1, 1, 1]
            : purity === 'mostly-pure'
              ? [2, 4, 4]
              : purity === 'mostly-impure'
                ? [1, 1, 2]
                : [1, 2, 4];
    // With remapped/default or random purity use the guaranteed all-impure floor until the actual totals are entered.
    limits[name] = counts.reduce(
      (sum, count, i) =>
        sum +
        count *
          rate *
          (uncertain && !['pure', 'normal', 'impure'].includes(purity) ? 1 : weights[i]!),
      0,
    );
    if (name === 'Nitrogen Gas' && distribution !== 'original') limits[name] = 0;
  }
  return {
    limits,
    uncertain,
    description: uncertain
      ? 'Seed-dependent: verify totals with your seed or save. Zero means unallocated, not absent. Random uses known ordinary-node counts; mixed/random purity uses a conservative impure floor. Enter nitrogen wells separately.'
      : 'Original map totals at Mk.3 / 250% extraction. Oil excludes resource wells; water is a planning allowance, not a finite map total.',
  };
}
