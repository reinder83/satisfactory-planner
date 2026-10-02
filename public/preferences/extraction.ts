// Working out resource budgets from the nodes you actually have.
//
// The thirteen budget boxes ask for a rate per minute, which nobody knows off
// the top of their head. What a player can read off the interactive map is how
// many impure, normal and pure nodes their world gives them, so that is what
// this asks for and this is the arithmetic that turns it into a rate.
//
// Yields are the in-game extraction rates for a normal-purity node at 100%
// clock; impure is half and pure is double. A test pins the whole table by
// rebuilding the shipped DEFAULT_LIMITS from the known node counts, so a wrong
// number here cannot pass unnoticed.
import type { ItemRates, NodeCounts, Survey } from '../types/index.ts';

// The purities a node count is kept for.
type NodePurity = keyof NodeCounts;
export const MINER_BASE: Record<number, number> = { 1: 60, 2: 120, 3: 240 }; // Miner Mk.1 / Mk.2 / Mk.3
export const OIL_BASE = 120; // Oil Extractor, crude oil node
export const WELL_BASE = 60; // Resource Well Extractor, per satellite
export const purityFactor: Record<string, number> = { impure: 0.5, normal: 1, pure: 2 };
// The per-node purity levels, in the order the node-count inputs show them.
export const purities3: [purity: NodePurity, label: string][] = [
  ['impure', 'Impure'],
  ['normal', 'Normal'],
  ['pure', 'Pure'],
];
// [mark, label] for the miner select; the tier is where the game unlocks that miner.
export const minerMarks: [mark: number, label: string][] = [
  [1, 'Mk.1 — Tier 0'],
  [2, 'Mk.2 — Tier 4'],
  [3, 'Mk.3 — Tier 7'],
];
// 250% is the usual endgame assumption and what the shipped default budgets use.
export const clockChoices: [clock: number, label: string][] = [
  [1, '100% — no shards'],
  [1.5, '150% — one shard'],
  [2, '200% — two shards'],
  [2.5, '250% — three shards'],
];
// Extracted by Oil Extractor rather than a miner.
export const oilNodeResources: string[] = ['Crude Oil'];
// Come out of resource wells: a pressurizer plus its satellite nodes.
export const wellResources: string[] = ['Crude Oil', 'Nitrogen Gas', 'Water'];
// Ordinary mineable nodes, in the order the node-count screen lists them.
export const minedResources: string[] = [
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
];
// Water is deliberately not counted. Extractors sit on any lake or ocean and
// the map has more coastline than any factory can use, so a node count would be
// a fiction; the planner keeps its large water allowance instead, editable in
// All settings like any other budget.
export const uncountedResources: string[] = ['Water'];

// Survey shapes (`settings.extraction`, edited in app/wizard/extraction.ts): `nodes` and
// `wells` hold per-resource { impure, normal, pure } counts, `used` the items/min already
// committed elsewhere.
export const blankCounts = (): NodeCounts => ({ impure: 0, normal: 0, pure: 0 });
export const blankExtraction = (): Required<Survey> => ({
  mark: 3,
  clock: 2.5,
  nodes: {},
  wells: {},
  used: {},
});
// A survey's miner and clock, the only parts the yields depend on.
type Equipment = { mark?: number; clock?: number };

// One node's output per minute, at the chosen miner mark and clock.
export function nodeYield(
  resource: string,
  purity: string,
  { mark = 3, clock = 2.5 }: Equipment = {},
): number {
  const factor = purityFactor[purity];
  if (!factor) return 0;
  if (oilNodeResources.includes(resource)) return OIL_BASE * factor * clock;
  return (MINER_BASE[mark] || MINER_BASE[3]!) * factor * clock;
}
// One resource-well satellite's output per minute. Wells have no marks; the
// pressurizer's clock drives every satellite it feeds.
export function wellYield(purity: string, { clock = 2.5 }: Equipment = {}): number {
  const factor = purityFactor[purity];
  return factor ? WELL_BASE * factor * clock : 0;
}
// One resource's counts from a nodes/wells map, with missing purities as 0.
const countsOf = (map: Record<string, NodeCounts> | undefined, name: string): NodeCounts => ({
  ...blankCounts(),
  ...(map?.[name] || {}),
});
// What a resource yields in total, before anything is deducted.
export function resourcePool(extraction: Survey | null | undefined, resource: string): number {
  const survey = { ...blankExtraction(), ...(extraction || {}) };
  const equipment = { mark: survey.mark, clock: survey.clock };
  const nodes = countsOf(survey.nodes, resource),
    wells = countsOf(survey.wells, resource);
  let total = 0;
  for (const [key] of purities3) {
    total += (Number(nodes[key]) || 0) * nodeYield(resource, key, equipment);
    if (wellResources.includes(resource))
      total += (Number(wells[key]) || 0) * wellYield(key, equipment);
  }
  return total;
}
// The pool less whatever is already committed to factories this plan does not
// include, which is what the planner's budgets are supposed to mean.
export function resourceAvailable(extraction: Survey | null | undefined, resource: string): number {
  const used = Number(extraction?.used?.[resource]) || 0;
  return Math.max(0, resourcePool(extraction, resource) - used);
}
// Every counted resource as a budget, rounded to whole items per minute.
// Water and anything else uncounted keeps whatever the profile already had.
export function extractionLimits(
  extraction: Survey | null | undefined,
  current: ItemRates = {},
): ItemRates {
  const limits = { ...current };
  for (const name of [...minedResources, ...wellResources]) {
    if (uncountedResources.includes(name)) continue;
    limits[name] = Math.round(resourceAvailable(extraction, name));
  }
  return limits;
}
