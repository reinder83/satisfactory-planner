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
// [mark, label] for the miner select; the tier is where the game unlocks that miner (Miner Mk.3:
// Tier 8, Leading-Edge Production; MINER_MARKS in mining.ts, which a test checks against
// progression.json).
export const minerMarks: [mark: number, label: string][] = [
  [1, 'Mk.1 — Tier 0'],
  [2, 'Mk.2 — Tier 4'],
  [3, 'Mk.3 — Tier 8'],
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

// --- Water Extractors (#1024) ---
//
// Figures from the SatisfactoryTools dataset at the revision recipes.json records
// (Desc_WaterPump_C): 120 m³/min at 100% (its description: "Default Extraction Rate: 120 m³ of
// water per minute"), 20 MW (metadata powerConsumption) and the overclock exponent 1.321929
// (metadata powerConsumptionExponent: log2 2.5, which the wiki's Patch 0.7.0.0 notes round to
// 1.321928; both give the same MW to the hundredth). Three Power Shards allow 250%, one per 50%
// above 100% (wiki, Clock speed and Water Extractor: 300 m³/min and 67.2 MW at 250%). The game
// takes a clock from 1% to 250%, to four decimals (wiki, Clock speed).
export const WATER_EXTRACTOR = {
  rate: 120,
  mw: 20,
  exponent: 1.321929,
  minClock: 1,
  maxClock: 250,
} as const;
// --- Extraction power (#1064) ---
//
// What the miners and extractors draw, from the same dataset (metadata powerConsumption): Miner
// Mk.1/Mk.2/Mk.3 5/15/45 MW, Oil Extractor 40 MW, Resource Well Pressurizer 150 MW (its
// satellite extractors draw nothing), Water Extractor 20 MW (WATER_EXTRACTOR). Every one follows
// the clock by the same exponent: MW x clock^1.321929.
export const MINER_MW: Record<number, number> = { 1: 5, 2: 15, 3: 45 };
export const OIL_EXTRACTOR_MW = 40;
export const PRESSURIZER_MW = 150;
// Satellites per resource well on the map: one well of ten, two of eight, eight of seven and six
// of six (see presetSurvey), so a pressurizer feeds 118 / 17 of them on average.
export const WELL_SATELLITES = 118 / 17;
// The equipment the plan's extraction power assumes when the profile has no node survey: Miner
// Mk.3 at 250%, as the shipped budgets do (`blankExtraction`).
export const DEFAULT_EXTRACTION = { mark: 3, clock: 2.5 } as const;

// MW per item (or m³) per minute of a raw resource, at `mark` and `clock` (1 = 100%) on normal
// nodes: one machine's draw at that clock over what it extracts there. Crude Oil from Oil
// Extractors, Nitrogen Gas from resource wells, Water from Water Extractors, the rest from miners
// of `mark`. The planner charges it on every raw resource it draws (#1064).
export function extractionMWPerUnit(
  resource: string,
  { mark = 3, clock = 2.5 }: Equipment = {},
): number {
  const scale = clock ** (WATER_EXTRACTOR.exponent - 1);
  if (resource === 'Water') return (WATER_EXTRACTOR.mw / WATER_EXTRACTOR.rate) * scale;
  if (oilNodeResources.includes(resource)) return (OIL_EXTRACTOR_MW / OIL_BASE) * scale;
  if (wellResources.includes(resource))
    return (PRESSURIZER_MW / (WELL_BASE * WELL_SATELLITES)) * scale;
  const miner = MINER_BASE[mark] ? mark : 3;
  return (MINER_MW[miner]! / MINER_BASE[miner]!) * scale;
}

// The advice writes a clock to two decimals (0.01%), which the game's clock input takes.
export const EXTRACTOR_CLOCK_DECIMALS = 2;
// Less Water than one extractor gives at its lowest clock (1.2 m³/min).
export const EXTRACTOR_MIN_RATE = (WATER_EXTRACTOR.rate * WATER_EXTRACTOR.minClock) / 100;
// A rate this close to a whole number of extractors is that number (rounding noise, m³/min).
const EXTRACTOR_DUST = 1e-6;

// One Water Extractor's draw at `clock` percent: 20 MW × (clock / 100)^1.321929.
export const extractorMW = (clock: number): number =>
  WATER_EXTRACTOR.mw * (clock / 100) ** WATER_EXTRACTOR.exponent;

// The Power Shards one extractor at `clock` percent needs: none up to 100%, then one per 50%
// started, so 1 up to 150%, 2 up to 200% and 3 up to 250%.
export const extractorShards = (clock: number): number =>
  clock <= 100 ? 0 : Math.min(3, Math.ceil((clock - 100) / 50 - 1e-9));

// The exact clocks (percent, unrounded) of the extractors that make `rate` m³/min of Water with
// whole extractors at `full` percent (100, or 250 with three Power Shards each): the last one
// underclocked to the remainder, never more than the rate (#1024: a fluid is never
// overproduced). A remainder below the game's lowest clock (1%) is made by underclocking the
// last full extractor by what the 1% one adds. [] for no Water, and null when the rate is
// below what one extractor gives at 1% (EXTRACTOR_MIN_RATE), which no extractor can make
// without overproducing.
export function extractorClocks(rate: number, full: number): number[] | null {
  if (!(rate > EXTRACTOR_DUST)) return [];
  if (rate < EXTRACTOR_MIN_RATE - EXTRACTOR_DUST) return null;
  const perFull = (WATER_EXTRACTOR.rate * full) / 100;
  const whole = Math.floor((rate + EXTRACTOR_DUST) / perFull);
  const rest = rate - whole * perFull;
  const clocks: number[] = Array.from({ length: whole }, () => full);
  if (rest <= EXTRACTOR_DUST) return clocks;
  const last = (rest / WATER_EXTRACTOR.rate) * 100;
  // A rate within rounding noise of the lowest clock is that clock.
  if (last >= WATER_EXTRACTOR.minClock || !whole)
    return [...clocks, Math.max(last, WATER_EXTRACTOR.minClock)];
  // Below 1%: the extractor before it gives up what the 1% one makes beyond the remainder.
  clocks[whole - 1] = full - (WATER_EXTRACTOR.minClock - last);
  return [...clocks, WATER_EXTRACTOR.minClock];
}

// The Water one step of the written clock (0.01%) gives: 0.012 m³/min.
export const EXTRACTOR_RATE_STEP = WATER_EXTRACTOR.rate / 100 / 10 ** EXTRACTOR_CLOCK_DECIMALS;

// The Water the written clocks make: `rate` rounded down to a whole number of clock steps
// (EXTRACTOR_RATE_STEP), so less than 0.012 m³/min under the rate and never over it. Every
// clock extractorClocks gives for it is then a whole number of steps, so the clocks as written
// add up to exactly this. The tolerance (a millionth of a step) only absorbs floating-point
// noise.
export const settableRate = (rate: number): number =>
  Math.floor(rate / EXTRACTOR_RATE_STEP + 1e-6) * EXTRACTOR_RATE_STEP;

// One way to build a line's Water Extractors: its runs of extractors at one clock in order
// ("2 at 100% + 1 at 15.03%"), each clock as the player sets it, how many extractors, Power
// Shards and MW in all, the whole-extractor clock it is built around (`full`) and the Water the
// clocks make (`rate`, settableRate).
export interface ExtractorOption {
  full: number;
  rate: number;
  runs: { count: number; clock: number }[];
  extractors: number;
  shards: number;
  mw: number;
}

// The extractors for `rate` m³/min at whole clock `full`, with the clocks written to two decimals:
// extractorClocks of the rate rounded down to what such clocks can make (settableRate), or null
// as there.
export function extractorOption(rate: number, full: number): ExtractorOption | null {
  const written = settableRate(rate);
  const exact = extractorClocks(written, full);
  if (!exact) return null;
  // Whole steps already; the rounding only clears floating-point noise (15.030000000000001).
  const scale = 10 ** EXTRACTOR_CLOCK_DECIMALS;
  const clocks = exact.map(clock => Math.round(clock * scale) / scale);
  const runs: ExtractorOption['runs'] = [];
  for (const clock of clocks) {
    const run = runs.at(-1);
    if (run?.clock === clock) run.count++;
    else runs.push({ count: 1, clock });
  }
  return {
    full,
    rate: written,
    runs,
    extractors: clocks.length,
    shards: clocks.reduce((sum, clock) => sum + extractorShards(clock), 0),
    mw: clocks.reduce((sum, clock) => sum + extractorMW(clock), 0),
  };
}

// The owner's two options for `rate` m³/min of Water (#1024): whole extractors at 100%, and
// whole extractors at 250% with three Power Shards each, each with the last one underclocked to
// the remainder. null for no Water, or less than one extractor gives at its lowest clock.
export function waterExtractors(
  rate: number,
): { plain: ExtractorOption; sharded: ExtractorOption } | null {
  if (!(rate >= EXTRACTOR_MIN_RATE - EXTRACTOR_DUST)) return null;
  const plain = extractorOption(rate, 100),
    sharded = extractorOption(rate, WATER_EXTRACTOR.maxClock);
  return plain && sharded ? { plain, sharded } : null;
}
