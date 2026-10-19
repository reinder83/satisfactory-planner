// Mining and belts per phase (#1065): the miner, its clock, and the belts and pipes each phase of
// a plan can build, the budgets they give, and how many nodes a phase's draw taps.
//
// A plan with `settings.phaseMining` (new plans; absent from every plan made before #1065, which
// keep the same budgets in every phase) gives each phase the equipment its HUB tiers unlock, as
// the planner maps tiers to phases for its recipes and milestones (phaseForTier): Miner Mk.1 in
// Phase 1, Mk.2 (Tier 4) from Phase 2 and Mk.3 (Tier 8) from Phase 4; the best belt and pipe of
// the phase (Mk.2 belts in Phase 1 up to Mk.6 belts, Tier 9, in Phase 5); Oil Extractors from
// Phase 3 (Tier 5) and resource wells from Phase 4 (Tier 8). Miners and extractors run at 100%
// in Phase 1 and up to 250% from Phase 2 (PHASE_CLOCK), with Power Shards from Power Slugs, whose
// MAM research the build plan schedules before the phase taps its nodes (#1169; Phases 4 and 5
// since #1096), and up to 250% in Phase 1 too once the player can overclock (settings.overclock,
// #1137: the MAM's Power Shards research, or "I can overclock"); a node's belt or pipe still caps
// each machine, so each node gives what its belt or pipe carries. A node survey's miner and clock cap each phase's (never
// raise it). Water Extractors are counted at 100% unless settings.waterOverclock suggests the
// phase's clock (#1137); a stage stored before it has no `water` and used its miner's clock.
// Their advice always gives both options, the counted one suggested (waterChoice in
// public/mining.ts, #1142).
// A miner or belt the player already has (settings.ownedMiner, settings.ownedBelt, #1068) raises
// each phase's to it (phaseMiner, phaseBelt).
// One node gives its yield at that miner and clock, never more than the belt or pipe it feeds
// carries: a pure node's Mk.3 at 250% gives 780/min on Phase 4's Mk.5 belts, not 1,200.
//
// A phase's budget for a resource is the entered budget scaled by what the phase's equipment
// gets from the resource's nodes against what the budget was worked out with (the survey's miner
// and clock, else Mk.3 at 250%, as the shipped budgets are): the counted nodes of the survey,
// else the world's known nodes, else the default map's as the closest known mix. So the entered
// budget stays the most any phase draws, and a phase gets its share of it. Water has no nodes:
// its allowance is the same in every phase.
//
// The planner charges each node kind's draw at its own power (one segment per kind, best nodes
// first: model.ts), and the pages say how many nodes of each kind a phase's draw taps, with the
// last machine underclocked to the remainder (miningAdvice).
import type {
  ItemRates,
  MiningSource,
  NodeCounts,
  NodeExclusions,
  StageMining,
} from '../types/index.ts';
import {
  MINER_BASE,
  MINER_MW,
  OIL_BASE,
  OIL_EXTRACTOR_MW,
  PRESSURIZER_MW,
  WATER_EXTRACTOR,
  WELL_BASE,
  WELL_SATELLITES,
  blankCounts,
  leavesNodesOut,
  oilNodeResources,
  purityFactor,
  remainingSurvey,
  resourcePool,
  uncountedResources,
  wellResources,
} from './extraction.ts';
import { knownWorld, presetSurvey } from './presets.ts';
import { rawResources } from './world.ts';

// The planner phase in which a HUB tier becomes available: Tiers 1–2 are Phase 1, 3–4 Phase 2,
// 5–6 Phase 3, 7–8 Phase 4 and 9 Phase 5. The build plan's milestones (progression.ts) and the
// belt advice (flow.ts) use the same mapping.
export const phaseForTier = (tier: number): number =>
  tier <= 2 ? 1 : tier <= 4 ? 2 : tier <= 6 ? 3 : tier <= 8 ? 4 : 5;

// A belt or pipe mark: what one lane carries per minute (m³/min for a pipe), the
// progression.json milestone that unlocks it, its HUB tier and the building.
// tests/phase-mining.test.ts checks every tier and building against progression.json.
export interface LaneMark {
  mark: string;
  cap: number;
  entry: string;
  tier: number;
  building: string;
}
// Conveyor belt marks in unlock order. Mk.1 belts come with the HUB itself; its entry is the
// Tier 1 Logistics milestone, as the belt advice always gave it.
export const BELT_MARKS: readonly LaneMark[] = [
  { mark: 'Mk.1', cap: 60, entry: 'Schematic_1-2_C', tier: 1, building: 'Conveyor Belt Mk.1' },
  { mark: 'Mk.2', cap: 120, entry: 'Schematic_3-2_C', tier: 2, building: 'Conveyor Belt Mk.2' },
  { mark: 'Mk.3', cap: 270, entry: 'Schematic_5-3_C', tier: 4, building: 'Conveyor Belt Mk.3' },
  { mark: 'Mk.4', cap: 480, entry: 'Schematic_6-1_C', tier: 5, building: 'Conveyor Belt Mk.4' },
  { mark: 'Mk.5', cap: 780, entry: 'Schematic_7-2_C', tier: 7, building: 'Conveyor Belt Mk.5' },
  { mark: 'Mk.6', cap: 1200, entry: 'Schematic_9-5_C', tier: 9, building: 'Conveyor Belt Mk.6' },
];
// Pipeline marks, same shape; cap is m³/min per pipe.
export const PIPE_MARKS: readonly LaneMark[] = [
  { mark: 'Mk.1', cap: 300, entry: 'Schematic_3-1_C', tier: 3, building: 'Pipeline Mk.1' },
  { mark: 'Mk.2', cap: 600, entry: 'Schematic_6-5_C', tier: 6, building: 'Pipeline Mk.2' },
];
// Miner marks: the HUB tier and milestone that unlock each (Mk.1 comes with the HUB).
export const MINER_MARKS: readonly { mark: number; tier: number; entry: string | null }[] = [
  { mark: 1, tier: 0, entry: null },
  { mark: 2, tier: 4, entry: 'Schematic_4-1_C' },
  { mark: 3, tier: 8, entry: 'Schematic_8-4_C' },
];
// The other extractors: Water Extractor (Tier 3, Coal Power), Oil Extractor (Tier 5, Oil
// Processing) and the Resource Well Pressurizer and its satellite extractors (Tier 8, Advanced
// Aluminum Production).
export const EXTRACTOR_TIERS = {
  'Water Extractor': { tier: 3, entry: 'Schematic_3-1_C' },
  'Oil Extractor': { tier: 5, entry: 'Schematic_5-1_C' },
  'Resource Well Pressurizer': { tier: 8, entry: 'Schematic_8-2_C' },
} as const;
// The clock miners and extractors run at in each phase without a survey that says less: 100% in
// Phase 1, before the MAM is usable, then up to 250% (three Power Shards each), never more than a
// node's belt or pipe carries (owner, #1169: each node at its belt cap, so 2,356.75 Iron Ore/min
// on Phase 3's Mk.4 belts takes 5 Miner Mk.2, 4 at 200%, not 10 at 100%; Phases 4 and 5 since
// #1096). The shards come from Power Slugs: the MAM's Blue Power Slugs and Overclock Production,
// which the build plan asks for in every phase (requiredMilestones in progression.ts) and
// schedules before the first phase that taps its nodes overclocked (shardResearchTask);
// Synthetic Power Shards are a Phase 5 research. A stage stored before #1169 keeps the 100% it
// was calculated with in Phases 2 and 3 (its mining.miner.clock) until the user recalculates.
export const PHASE_CLOCK: Readonly<Record<number, number>> = {
  1: 1,
  2: 2.5,
  3: 2.5,
  4: 2.5,
  5: 2.5,
};
// The MAM research that lets the player overclock with Power Shards (#1137): Overclock Production
// in the Power Slugs tree, after Blue Power Slugs (SHARD_RECIPE_RESEARCH, the Power Shard recipe).
export const OVERCLOCK_RESEARCH = 'Research_PowerSlugs_2_C';
export const SHARD_RECIPE_RESEARCH = 'Research_PowerSlugs_1_C';
// The clock miners and extractors run at in every phase once the player can overclock
// (settings.overclock, #1137; since #1169 it raises only Phase 1): 250%, three Power Shards each,
// a node's belt or pipe capping it.
export const OVERCLOCK = 2.5;
// The clock of `phase` before a survey caps it: PHASE_CLOCK, or OVERCLOCK when the player can
// overclock (#1137).
export const phaseClock = (phase: number, overclock?: boolean): number =>
  overclock ? OVERCLOCK : (PHASE_CLOCK[phase] ?? 1);
// The clocks a fluid extractor's advice offers, as the Water Extractors' do (#1024): 100% and
// 250% with three Power Shards each, each only up to the phase's clock (fluidClocks in
// public/mining.ts).
export const EXTRACTOR_OPTIONS = [1, 2.5] as const;
// What the budgets of a profile without a survey were worked out with: Miner Mk.3 at 250%.
const REFERENCE = { mark: 3, clock: 2.5 };
// The clock power exponent every extraction building shares (WATER_EXTRACTOR.exponent).
const EXPONENT = WATER_EXTRACTOR.exponent;

// The last of `marks` whose tier's phase has come by `phase`; the first when none has.
export function bestMark<T extends { tier: number }>(marks: readonly T[], phase: number): T {
  let best = marks[0]!;
  for (const mark of marks) if (phaseForTier(mark.tier) <= phase) best = mark;
  return best;
}
// Whether an extractor's tier has come by `phase`.
export const extractorBuilt = (machine: keyof typeof EXTRACTOR_TIERS, phase: number): boolean =>
  phaseForTier(EXTRACTOR_TIERS[machine].tier) <= phase;

// What the settings say about a phase's mining: the budgets, the survey behind them and the
// world they are for.
export interface MiningSettings {
  limits: ItemRates;
  // The node survey, with the nodes it leaves out of the plan (#1183).
  extraction?:
    | ({
        mark?: number;
        clock?: number;
        nodes?: Record<string, NodeCounts>;
        wells?: Record<string, NodeCounts>;
      } & NodeExclusions)
    | null;
  purity?: string;
  distribution?: string;
  // The best miner the player already has (#1068, the wizard's "Miners you already have"): 2 or 3.
  // Raises every phase's miner to at least that mark; absent from every plan made before it.
  ownedMiner?: number;
  // The best conveyor belt the player already has (#1068, "Belts you already have"): 3 to 6 for
  // Mk.3 to Mk.6. Raises every phase's belt to at least that mark; absent unless chosen.
  ownedBelt?: number;
  // The player can overclock (#1137: the MAM's Power Shards research ticked, or "I can overclock"
  // in "What you already have"): every phase's clock is OVERCLOCK, Phase 1's too (the later
  // phases' are since #1169), and the build plan's Power Shards research step shows as done.
  // Absent unless chosen.
  overclock?: boolean;
  // Water Extractors are suggested and counted at the phase's clock instead of 100% (#1137,
  // #1142: both options are always advised). Absent unless chosen.
  waterOverclock?: boolean;
}

// The miner and clock of `phase`: the phase's best miner at its clock (phaseClock), neither
// above the survey's. A miner the player already has (`owned`, settings.ownedMiner, #1068) raises
// the phase's mark to it, still capped by the survey's; without one every phase is as before.
// `overclock` (settings.overclock, #1137) runs every phase at OVERCLOCK.
export function phaseMiner(
  phase: number,
  survey?: MiningSettings['extraction'],
  owned?: number,
  overclock?: boolean,
): { mark: number; clock: number } {
  const mark = Math.max(bestMark(MINER_MARKS, phase).mark, MINER_BASE[owned ?? 0] ? owned! : 1),
    clock = phaseClock(phase, overclock);
  return {
    mark: Math.min(mark, MINER_BASE[survey?.mark ?? 3] ? (survey?.mark ?? 3) : 3),
    clock: Math.min(clock, survey?.clock ?? REFERENCE.clock),
  };
}

// The belt of `phase`: the best its HUB tiers unlock (BELT_MARKS), raised to a belt the player
// already has (`owned`, settings.ownedBelt, #1068: 3 to 6 for Mk.3 to Mk.6); any other value, or
// none, leaves every phase as before. Nothing caps it: a node survey records no belt.
export function phaseBelt(phase: number, owned?: number): LaneMark {
  const unlocked = bestMark(BELT_MARKS, phase);
  const mine = owned ? BELT_MARKS.find(mark => mark.mark === `Mk.${owned}`) : undefined;
  return mine && mine.cap > unlocked.cap ? mine : unlocked;
}

// One node's output per minute at `clock` (1 = 100%), never more than its belt or pipe carries.
export const sourceYield = (source: MiningSource, clock: number): number =>
  Math.min(source.base * clock, source.cap);
// The clock that gives that output: `clock`, or less when the belt or pipe caps the node.
export const sourceClock = (source: MiningSource, clock: number): number =>
  source.base > 0 ? sourceYield(source, clock) / source.base : 0;
// MW per item a minute from such a node: its machine's draw at that clock over its output. The
// planner charges each kind's draw at it.
export function sourceMWPerUnit(source: MiningSource, clock: number): number {
  const output = sourceYield(source, clock);
  return output > 0 ? (source.machineMW * sourceClock(source, clock) ** EXPONENT) / output : 0;
}

// The node mix behind a resource's budget: the survey's counts for it, else the world's known
// counts, else the default map's. Nodes and well satellites apart. A survey's counts are the
// nodes it does not leave out of the plan (#1183), none when it leaves them all out.
function nodeMix(
  settings: MiningSettings,
  resource: string,
): { nodes: NodeCounts; wells: NodeCounts; surveyed: boolean } {
  const counted = (counts?: NodeCounts) =>
    !!counts &&
    (Number(counts.impure) || 0) + (Number(counts.normal) || 0) + (Number(counts.pure) || 0) > 0;
  const survey = settings.extraction;
  if (survey && (counted(survey.nodes?.[resource]) || counted(survey.wells?.[resource]))) {
    const rest = remainingSurvey(survey);
    return {
      nodes: { ...blankCounts(), ...rest.nodes?.[resource] },
      wells: { ...blankCounts(), ...rest.wells?.[resource] },
      surveyed: true,
    };
  }
  const world = knownWorld(settings.purity ?? 'vanilla', settings.distribution ?? 'original')
    ? presetSurvey(settings.purity ?? 'vanilla', null, settings.distribution ?? 'original')
    : null;
  const preset =
    world && (counted(world.nodes[resource]) || counted(world.wells[resource]))
      ? world
      : presetSurvey('vanilla');
  return {
    nodes: { ...blankCounts(), ...preset.nodes[resource] },
    wells: { ...blankCounts(), ...preset.wells[resource] },
    surveyed: false,
  };
}

// The node kinds a resource is extracted from at `mark`: its nodes (by a miner, or an Oil
// Extractor for crude oil) and its resource-well satellites, each with `count` nodes, one node's
// output at 100%, the lane it feeds and its machine's MW (a pressurizer's share per satellite).
// `phase` leaves out what the phase cannot build yet (and `lanes` caps a node's output); without
// a phase, every kind counts with no lane cap: the reference the entered budget was worked out
// against.
function nodeKinds(
  resource: string,
  mix: { nodes: NodeCounts; wells: NodeCounts },
  mark: number,
  phase?: number,
  lanes?: { belt: number; pipe: number },
): (MiningSource & { count: number })[] {
  const kinds: (MiningSource & { count: number })[] = [];
  const oil = oilNodeResources.includes(resource);
  const nodesBuilt = phase === undefined || !oil || extractorBuilt('Oil Extractor', phase);
  const wellsBuilt = phase === undefined || extractorBuilt('Resource Well Pressurizer', phase);
  const miner = MINER_BASE[mark] ? mark : 3;
  for (const purity of ['pure', 'normal', 'impure'] as const) {
    const factor = purityFactor[purity]!;
    const nodes = Number(mix.nodes[purity]) || 0;
    if (nodes > 0 && nodesBuilt)
      kinds.push({
        kind: purity,
        machine: oil ? 'Oil Extractor' : `Miner Mk.${miner}`,
        count: nodes,
        nodes: 0,
        base: (oil ? OIL_BASE : MINER_BASE[miner]!) * factor,
        cap: lanes ? (oil ? lanes.pipe : lanes.belt) : Infinity,
        machineMW: oil ? OIL_EXTRACTOR_MW : MINER_MW[miner]!,
      });
  }
  if (wellResources.includes(resource) && wellsBuilt)
    for (const purity of ['pure', 'normal', 'impure'] as const) {
      const satellites = Number(mix.wells[purity]) || 0;
      if (satellites > 0)
        kinds.push({
          kind:
            purity === 'pure' ? 'well-pure' : purity === 'normal' ? 'well-normal' : 'well-impure',
          machine: 'Resource Well Pressurizer',
          count: satellites,
          nodes: 0,
          base: WELL_BASE * purityFactor[purity]!,
          cap: lanes ? lanes.pipe : Infinity,
          machineMW: PRESSURIZER_MW / WELL_SATELLITES,
        });
    }
  return kinds;
}

// The most a resource's budget may be when the node survey leaves some of its nodes or well
// satellites out of the plan (#1183): what the rest give at the survey's miner and clock, the
// equipment the survey's budgets are worked out with (resourceAvailable). null when the survey
// leaves none of them out. The budgets the survey writes are within it already; it holds the plan
// to the rest whatever budget was entered, and to none when every node is left out.
export function leftOutCap(
  settings: Pick<MiningSettings, 'extraction'>,
  resource: string,
): number | null {
  const survey = settings.extraction;
  if (!survey || !(survey.excludedNodes?.[resource] || survey.excludedWells?.[resource]))
    return null;
  return resourcePool(
    remainingSurvey({
      ...survey,
      mark: survey.mark ?? REFERENCE.mark,
      clock: survey.clock ?? REFERENCE.clock,
    }),
    resource,
  );
}
// A resource's entered budget, held to what the nodes the survey does not leave out give
// (leftOutCap, #1183).
export function budgetLimit(
  settings: Pick<MiningSettings, 'limits' | 'extraction'>,
  resource: string,
): number {
  const limit = Math.max(0, Number(settings.limits[resource]) || 0),
    cap = leftOutCap(settings, resource);
  return cap === null ? limit : Math.min(limit, cap);
}
// The entered budgets, each held as budgetLimit holds it: `limits` itself when the survey leaves no
// node out, so a plan without left-out nodes plans with exactly its budgets.
export function budgetLimits(settings: Pick<MiningSettings, 'limits' | 'extraction'>): ItemRates {
  if (!leavesNodesOut(settings.extraction)) return settings.limits;
  const limits: ItemRates = { ...settings.limits };
  for (const resource of Object.keys(limits))
    if (leftOutCap(settings, resource) !== null) limits[resource] = budgetLimit(settings, resource);
  return limits;
}

// Rounds a budget down to 0.01/min, so floating-point noise never adds to it.
const budgetOf = (value: number) => Math.floor(value * 100 + 1e-6) / 100;

// A phase's mining (#1065): its miner and clock, best belt and pipe, and per raw resource the
// budget and the node kinds behind it (see the header). `settings` is a plan's settings.
export function phaseMining(settings: MiningSettings, phase: number): StageMining {
  const survey = settings.extraction ?? null;
  const miner = phaseMiner(phase, survey, settings.ownedMiner, settings.overclock);
  const belt = phaseBelt(phase, settings.ownedBelt),
    pipe = bestMark(PIPE_MARKS, phase);
  const reference = {
    mark: survey?.mark && MINER_BASE[survey.mark] ? survey.mark : REFERENCE.mark,
    clock: survey?.clock ?? REFERENCE.clock,
  };
  const budgets: ItemRates = {},
    sources: Record<string, MiningSource[]> = {};
  for (const resource of rawResources) {
    const limit = budgetLimit(settings, resource);
    if (uncountedResources.includes(resource)) {
      budgets[resource] = limit;
      continue;
    }
    // A survey that leaves every node of the resource out of the plan (#1183) keeps its node
    // kinds, with none of their nodes, so the budget is none while a diagnostic, which drops the
    // per-kind caps, still finds the resource: the phase's draft then names the shortfall and
    // why (draftStage), rather than calling the recipes unable to make the phase.
    const none = leftOutCap(settings, resource) === 0;
    const mix = nodeMix(
      none && settings.extraction
        ? { ...settings, extraction: { ...settings.extraction, excludedNodes: {}, excludedWells: {} } }
        : settings,
      resource,
    );
    // What the budget was worked out with: every node kind, no lane cap.
    const pool = nodeKinds(resource, mix, reference.mark).reduce(
      (sum, kind) => sum + kind.count * kind.base * reference.clock,
      0,
    );
    const scale = pool > 0 ? limit / pool : 0;
    const kinds = nodeKinds(resource, mix, miner.mark, phase, { belt: belt.cap, pipe: pipe.cap })
      .map(({ count, ...kind }) => ({ ...kind, nodes: none ? 0 : count * scale }))
      .filter(kind => none || kind.nodes > 0);
    sources[resource] = kinds;
    budgets[resource] = budgetOf(
      kinds.reduce((sum, kind) => sum + kind.nodes * sourceYield(kind, miner.clock), 0),
    );
  }
  return {
    miner,
    water: settings.waterOverclock ? phaseClock(phase, settings.overclock) : 1,
    belt: { mark: belt.mark, cap: belt.cap },
    pipe: { mark: pipe.mark, cap: pipe.cap },
    budgets,
    sources,
  };
}

// MW per m³/min of Water at the phase's clock: Water Extractors, which need no node.
export const waterMWPerUnit = (clock: number): number =>
  (WATER_EXTRACTOR.mw / WATER_EXTRACTOR.rate) * clock ** (EXPONENT - 1);
// The clock a phase's Water Extractors run at: its `water` (#1137), or, for a stage stored before
// it, its miner's clock, as that stage was calculated.
export const waterClock = (mining: Pick<StageMining, 'miner' | 'water'>): number =>
  mining.water ?? mining.miner.clock;

// --- How many nodes a draw taps ---

// The nodes of one kind a draw taps: how many run at `clock` (percent), and the last one's
// clock when it runs slower for the remainder.
export interface MiningRun {
  kind: MiningSource['kind'];
  machine: string;
  full: number;
  clock: number;
  last: number | null;
}
// A draw's nodes, best kind first: the runs, the nodes and machines in all (a resource well's
// pressurizers counted as a share of its satellites), the Power Shards and MW they take, the
// clock they were sized at (1 = 100%) and what no node is left for (`short`, 0 when the nodes
// cover the draw).
export interface MiningAdvice {
  rate: number;
  clock: number;
  runs: MiningRun[];
  nodes: number;
  satellites: number;
  pressurizers: number;
  shards: number;
  mw: number;
  short: number;
}

// Rounding noise in a rate, per minute.
const RATE_DUST = 1e-6;
// Power Shards one machine at `clock` (1 = 100%) needs: one per 50% started above 100%.
const shardsAt = (clock: number): number =>
  clock <= 1 + 1e-9 ? 0 : Math.min(3, Math.ceil((clock - 1) / 0.5 - 1e-9));
// Whether a kind is a resource-well satellite.
export const isWellKind = (kind: MiningSource['kind']): boolean => kind.startsWith('well-');

// The nodes that give `rate` per minute from `sources` at `clock`, the cheapest per item first
// (pure before normal before impure, as the planner draws them): whole nodes at the clock and the
// last one of a kind underclocked to what remains. A resource well's satellites share their
// pressurizer's clock, so the wells' part runs every tapped satellite at one clock instead.
export function miningAdvice(rate: number, sources: MiningSource[], clock: number): MiningAdvice {
  const ordered = [...sources].sort(
    (first, second) => sourceMWPerUnit(first, clock) - sourceMWPerUnit(second, clock),
  );
  const advice: MiningAdvice = {
    rate,
    clock,
    runs: [],
    nodes: 0,
    satellites: 0,
    pressurizers: 0,
    shards: 0,
    mw: 0,
    short: 0,
  };
  let left = Math.max(0, rate);
  const wells: { source: MiningSource; count: number; rate: number }[] = [];
  for (const source of ordered) {
    if (left <= RATE_DUST) break;
    const output = sourceYield(source, clock),
      at = sourceClock(source, clock);
    if (!(output > 0)) continue;
    const take = Math.min(left, source.nodes * output);
    left -= take;
    const full = Math.floor(take / output + RATE_DUST),
      rest = take - full * output;
    const last = rest > RATE_DUST ? (at * rest) / output : null;
    if (isWellKind(source.kind)) {
      wells.push({ source, count: full + (last === null ? 0 : 1), rate: take });
      continue;
    }
    advice.runs.push({ kind: source.kind, machine: source.machine, full, clock: at, last });
    advice.nodes += full + (last === null ? 0 : 1);
    advice.shards += full * shardsAt(at) + (last === null ? 0 : shardsAt(last));
    advice.mw +=
      source.machineMW * (full * at ** EXPONENT + (last === null ? 0 : last ** EXPONENT));
  }
  addWells(advice, wells, clock);
  advice.short = left > RATE_DUST ? left : 0;
  return advice;
}

// The wells' part of an advice: every tapped satellite at the one clock that gives their rate,
// on about one pressurizer per WELL_SATELLITES satellites.
function addWells(
  advice: MiningAdvice,
  wells: { source: MiningSource; count: number; rate: number }[],
  clock: number,
) {
  const satellites = wells.reduce((sum, well) => sum + well.count, 0);
  if (!satellites) return;
  const capacity = wells.reduce(
    (sum, well) => sum + well.count * sourceYield(well.source, clock),
    0,
  );
  const rate = wells.reduce((sum, well) => sum + well.rate, 0);
  const at = Math.min(...wells.map(well => sourceClock(well.source, clock))) * (rate / capacity);
  for (const well of wells)
    advice.runs.push({
      kind: well.source.kind,
      machine: well.source.machine,
      full: well.count,
      clock: at,
      last: null,
    });
  advice.satellites = satellites;
  advice.pressurizers = Math.ceil(satellites / WELL_SATELLITES - 1e-9);
  advice.shards += advice.pressurizers * shardsAt(at);
  advice.mw += satellites * (PRESSURIZER_MW / WELL_SATELLITES) * at ** EXPONENT;
}

// The MW a phase's draw of each raw resource takes at its miners and extractors, as the power
// model counts it (#1065): the nodes the draw taps (miningAdvice) for a resource with nodes,
// and Water Extractors at the phase's clock for Water.
export function miningMW(raw: ItemRates, mining: StageMining): ItemRates {
  const out: ItemRates = {};
  for (const [resource, rate] of Object.entries(raw)) {
    if (!(rate > RATE_DUST)) continue;
    const sources = mining.sources[resource];
    out[resource] = sources
      ? miningAdvice(rate, sources, mining.miner.clock).mw
      : rate * waterMWPerUnit(waterClock(mining));
  }
  return out;
}

// What a phase's draw of each raw resource is charged at its nodes' linear power, best kind
// first, as the planner's power constraint charges it: never less than miningMW.
export function miningLinearMW(raw: ItemRates, mining: StageMining): number {
  let total = 0;
  for (const [resource, rate] of Object.entries(raw)) {
    if (!(rate > RATE_DUST)) continue;
    const sources = mining.sources[resource];
    if (!sources) {
      total += rate * waterMWPerUnit(waterClock(mining));
      continue;
    }
    let left = rate;
    for (const source of [...sources].sort(
      (first, second) =>
        sourceMWPerUnit(first, mining.miner.clock) - sourceMWPerUnit(second, mining.miner.clock),
    )) {
      const take = Math.min(left, source.nodes * sourceYield(source, mining.miner.clock));
      total += take * sourceMWPerUnit(source, mining.miner.clock);
      left -= take;
    }
  }
  return total;
}
