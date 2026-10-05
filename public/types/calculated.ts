// A calculated profile's plan (planner.ts calculate()), frozen on the profile when it is
// created and never recalculated. Two shapes:
//   Current*  what calculate() returns today, every field present;
//   Stored*   what a saved profile may hold: a plan frozen by any earlier release, which
//             lacks the fields added since (settings added 2026-09-13 to 09-24, and the
//             stage's supply and somersloop fields added 2026-09-23/24).
// Code that reads a stored plan must treat those as optional; code that only handles a
// fresh calculation (the wizard's preview) can use Current*.
import type { ItemRates, StageKey } from './common.ts';

export type Goal = 'minimal' | 'balanced' | 'timed' | 'maximum';
export type Purity =
  | 'vanilla'
  | 'pure'
  | 'mostly-pure'
  | 'normal'
  | 'mostly-impure'
  | 'impure'
  | 'random'
  | 'custom';
export type Distribution = 'original' | 'randomized' | 'basic' | 'advanced' | 'fossil';
export type MainPower =
  | 'auto'
  | 'coal'
  | 'nuclear'
  | 'fuel'
  | 'turbofuel'
  | 'rocket'
  | 'turbofuel-nuclear'
  | 'rocket-nuclear';
export type StorageChoice =
  | 'none'
  | 'construction'
  | 'electronics'
  | 'supplies'
  | 'packaged'
  | 'all';
export type DroneFuel =
  | 'none'
  | 'Battery'
  | 'Packaged Fuel'
  | 'Packaged Turbofuel'
  | 'Packaged Rocket Fuel'
  | 'Packaged Ionized Fuel'
  | 'Uranium Fuel Rod'
  | 'Plutonium Fuel Rod';
export type SloopUse = 'shards' | 'dna' | 'biofuel';

// Node or well-satellite counts by purity.
export interface NodeCounts {
  impure: number;
  normal: number;
  pure: number;
}

// The extraction survey behind the budgets, kept so it can be reopened.
export interface ExtractionRecord {
  mark: 1 | 2 | 3;
  // Miner clock, 0.01–2.5.
  clock: number;
  nodes: Record<string, NodeCounts>;
  wells: Record<string, NodeCounts>;
  // Extraction already committed elsewhere, per minute.
  used: ItemRates;
}

// A survey while it is edited (the wizard, preferences.ts): looser than ExtractionRecord. The
// mark is whatever the form holds until the planner checks it, and the maps are created as
// counts are entered.
export interface Survey {
  mark: number;
  clock: number;
  nodes?: Record<string, NodeCounts>;
  wells?: Record<string, NodeCounts>;
  used?: ItemRates;
}

// Normalised settings, as settings() in planner.ts returns them. Units: GW for power,
// % for utilityPercent, per minute for rates and limits, hours per phase.
export interface CurrentSettings {
  utilityPercent: number;
  droneFuel: DroneFuel;
  droneFuelRate: number;
  droneBridgeRate: number;
  // '' or a number as text.
  worldSeed: string;
  mainPower: MainPower;
  collectables: boolean;
  // The phase the profile starts in; post-game is not a start phase.
  phase: StageKey;
  purity: Purity;
  distribution: Distribution;
  multiplier: number;
  powerFactor: number;
  availablePowerGW: number;
  recipes: 'standard' | 'all' | 'custom';
  pureIngots: boolean;
  sam: 'avoid' | 'needed' | 'allow';
  nuclear: 'none' | 'sink' | 'recycle';
  uraniumReactors: number;
  storage: StorageChoice;
  storageRate: number;
  buildRate: number;
  storageOverrides: ItemRates;
  existingSupply: ItemRates;
  // Vehicle fuel for the factory-group links per phase (#206): { phase: { fuel: rate/min } }.
  transportFuel: Partial<Record<StageKey, ItemRates>>;
  // The items factory groups make on site (#875): absent unless a recalculation the user started
  // planned per-group lines.
  onSite?: OnSiteSettings;
  extraction: ExtractionRecord | null;
  cellsPerMinute: number;
  installedPowerGW: number;
  somersloops: number;
  augmenters: number;
  fueledAugmenters: number;
  sloopReserved: SloopUse[];
  amplifySloops: number;
  goal: Goal;
  phaseTime: 'every' | 'final';
  hours: number;
  roundRates: boolean;
  wholeMachines: boolean;
  limitsConfirmed: boolean;
  modNotes: string;
  // Resource budgets per minute, one for every raw resource.
  limits: ItemRates;
  alternateRecipes: string[];
  preferredRecipes: string[];
}

// One factory group's part of settings.onSite (#875), keyed by group id: the items it makes on
// site, its name when the plan was calculated (for the warnings), and per phase the share of each
// plan row (by row id) its consumers take, worked out from its memberships when the user starts a
// recalculation (onSiteSettings in public/app/on-site.ts).
export interface OnSiteGroup {
  name?: string;
  items: string[];
  shares: Partial<Record<StageKey, Record<string, number>>>;
  // Per phase, the group's part of each row with a fixed-rate membership as it follows that
  // row's total in the plan the recalculation produces (#984), beside its share there. Absent
  // in plans made before #984 and for rows without a fixed rate, which the share sizes.
  rates?: Partial<Record<StageKey, Record<string, OnSiteRate>>>;
  // Per phase, the group's part of each row with a fixed-rate membership that the plan being
  // recalculated lacks in that phase (#1038), as `rates` gives it for a row that plan has. It
  // counts only where the plan the recalculation produces builds the row (withinRates in
  // planner/on-site.ts); until then the row's share sizes the line, as before #1038. Absent in
  // plans made before #1038, whose planner never read it.
  ifBuilt?: Partial<Record<StageKey, Record<string, OnSiteRate>>>;
  // Only inside the planner, never stored (settings() leaves it out): the items whose excess the
  // group's own lines may send to the central balance (withOverflow in planner/on-site.ts, #1063).
  overflow?: string[];
}
// A group's part of a row of total T (its primary output per minute, MW for a generator), as
// rowShares gives it while the row makes at least what its fixed rates take: `rate` per minute
// for a fixed-rate membership, which `after` per minute of earlier fixed rates come before, or
// for a membership without a rate `open` (1 / the number of such memberships) of T - `after`,
// what all the fixed rates leave. One of `rate` and `open` is 0.
export interface OnSiteRate {
  rate: number;
  open: number;
  after: number;
  // Only inside the planner, never stored (settings() leaves it out): plan the row to make at
  // least `after` + `rate` (withinRates in planner/on-site.ts).
  floor?: true;
}
export type OnSiteSettings = Record<string, OnSiteGroup>;
// A per-group line's group and the recipe it is a copy of (#875).
export interface OnSiteLine {
  group: string;
  recipe: string;
}

// The settings fields a plan frozen by the first release (2026-09-12) already had.
export type FirstReleaseSettings =
  | 'phase'
  | 'purity'
  | 'distribution'
  | 'multiplier'
  | 'powerFactor'
  | 'availablePowerGW'
  | 'recipes'
  | 'pureIngots'
  | 'sam'
  | 'nuclear'
  | 'uraniumReactors'
  | 'storage'
  | 'storageRate'
  | 'cellsPerMinute'
  | 'goal'
  | 'hours'
  | 'roundRates'
  | 'limitsConfirmed'
  | 'modNotes'
  | 'limits';
export type StoredSettings = Pick<CurrentSettings, FirstReleaseSettings> &
  Partial<Omit<CurrentSettings, FirstReleaseSettings>>;

// One production line of a stage: a recipe from recipes.json (or a generator, 'power-…', or an
// amplified twin, 'amp:…') scaled to the line. Its id is part of the saved check key
// 'calc-<stage>-<id>'.
export interface CalcRow {
  id: string;
  name: string;
  alternate?: boolean;
  // The phase the recipe unlocks in.
  phase: number;
  machine: string;
  // MW per machine at 100%; negative for a generator. A variable-power machine's peak, and its
  // `minPower` (#1064; absent from plans made before it).
  power: number;
  minPower?: number;
  // The line's totals per minute.
  inputs: ItemRates;
  outputs: ItemRates;
  // Machine-equivalents at 100%, whole buildings, and the last one's clock in %.
  equivalent: number;
  machines: number;
  lastClock: number;
  // Whole machines at full power, before the utility allowance; a generator's output.
  peakMW: number;
  generationMW: number;
  // Amplified twins only: somersloop slots per machine, and somersloops used by the line.
  slots?: number;
  amplified?: boolean;
  sloops?: number;
  // A factory group's own line for an item it makes on site (#875; id '<recipe>:<group>').
  onSite?: OnSiteLine;
}

// A delivery the stage must hand in, and the rate it is made at.
export interface StageDelivery {
  target: number;
  rate: number;
}

// Compares a Phase 5 plan with fueled augmenters against one without.
export interface FuelVerdict {
  unfueledFeasible: boolean;
  buildings: number;
  buildingsUnfueled: number | null;
  requiredMW: number;
  requiredMWUnfueled: number | null;
  availableMW: number;
  availableMWUnfueled: number | null;
  hours: number;
  hoursUnfueled: number | null;
  matrixRate: number;
  worthIt: boolean;
}

// A stage's power as the plan sizes it (#1064, stageGrid in public/power.ts): what the phase
// needs, and the whole generators, augmenters and spare power that give it. Every page reads it
// through powerView. Plans made before #1064 have none and keep their own figures (requiredMW,
// availableMW, additionalHeadroomMW), which powerView reads instead.
export interface GridGenerator {
  // The building (Coal Generator, Fuel Generator, Nuclear Power Plant).
  machine: string;
  // Whole generators of it the phase runs, all at 100%: they burn fuel only for the power drawn.
  machines: number;
  // What the phase's own generator lines need of them (their machines, summed).
  own: number;
  // Of `machines`, the ones the phase before already built and the phase keeps (0 for none).
  kept: number;
  // One generator's capacity in MW, before the augmenter boost.
  unitMW: number;
}
export interface StageGrid {
  // The production lines at their clocked power (the clock power exponent) x the consumption
  // multiplier, variable-power machines at their peak.
  loadMW: number;
  // The variable-power machines' part of loadMW at their peak, and the same at their average.
  variablePeakMW: number;
  variableAverageMW: number;
  // Miners and extractors: MW per raw resource, and the equipment assumed.
  extraction: ItemRates;
  extractionMW: number;
  extractionAt: { mark: number; clock: number };
  // The utility allowance on loadMW, and loadMW + allowanceMW + extractionMW.
  allowanceMW: number;
  needMW: number;
  generators: GridGenerator[];
  // The whole generators' capacity with the augmenter boost, what Phase 5's augmenters add (their
  // 500 MW each and their boost on installed generation), the entered spare power, and the sum.
  generationMW: number;
  augmenterMW: number;
  spareMW: number;
  availableMW: number;
}

// A resource a failed phase needs more of.
export interface Shortfall {
  name: string;
  needed: number;
  budget: number;
}

// A stage as calculate() returns it today: a plan, or for a phase that does not fit, a draft
// of the closest plan with feasible false and the reason (see CurrentStage).
// How a phase whose search stopped was planned when no rounded whole-machine plan fit (#694).
export interface FractionalAfterStop {
  target: number;
  clocks: 'easy' | 'rate' | 'precise';
}
export interface StageResult {
  feasible: boolean;
  // In build order, suppliers before consumers.
  rows: CalcRow[];
  // Per-minute draw on each raw resource, and existing production credited.
  raw: ItemRates;
  supplied: ItemRates;
  // Protected storage rate per storable item.
  storage: ItemRates;
  // Dedicated drone fuel per minute.
  drone: ItemRates;
  // Fuel for the vehicles on factory-group links per minute (#206); absent from older plans.
  transport: ItemRates;
  delivery: Record<string, StageDelivery>;
  // Sinkable output beyond every demand, per minute.
  surplus: ItemRates;
  plutoniumSink: number;
  peakMW: number;
  generationMW: number;
  sloopsUsed: number;
  augmenters: number;
  fueledAugmenters: number;
  boost: number;
  augmenterMW: number;
  matrixRate: number;
  availableMW: number;
  requiredMW: number;
  additionalHeadroomMW: number;
  // The phase's power as the plan sizes it (#1064); see StageGrid. The three figures above keep
  // their earlier meaning for releases before it.
  grid: StageGrid;
  // Time to finish the phase's deliveries; Infinity when a rate is 0.
  hours: number;
  // Names of the resource converter rows.
  conversions: string[];
  // Added by calculate(): the hours of the plan this one replaced when it was pulled ahead,
  // Phase 5's fuel comparison, and whether supply or amplification had to be dropped.
  aheadOf?: number;
  fuelVerdict?: FuelVerdict;
  supplyDropped?: boolean;
  amplificationDropped?: boolean;
  // Whole machines (#370): the recycle chain's period when the uranium plants came in multiples
  // of it, and whether whole nuclear plants did not fit and the phase kept them fractional.
  nuclearPeriod?: number;
  nuclearFractional?: boolean;
  // The whole-machine search stopped before it could prove the best plan, so the exact plan was
  // rounded to whole machines instead (#593): the hours the exact plan takes (#708; plans from
  // before that recorded the hours the phase was asked to finish in, the goal's). The stage's own
  // `hours` can be longer. Absent from older plans and from a search that finished.
  roundedAfterStop?: number;
  // The search stopped and no rounded whole-machine plan fit either, so the phase is its exact
  // plan with easy clocks (#694): the hours the exact plan takes (as `roundedAfterStop`, #708),
  // and the clocks its last machines take ('easy' 25%, 50% or 75%; 'rate' also a whole number of
  // items per minute; 'precise' the exact plan's own clocks). Absent from older plans and from a
  // search that finished.
  fractionalAfterStop?: FractionalAfterStop;
  // The factory groups' own whole-machine lines (#875) did not fit this phase's budgets, so it
  // makes those items centrally: { group id: items }. Absent otherwise and from older plans.
  onSiteDropped?: Record<string, string[]>;
  // A failed phase is a draft: why, what is short, the hours it would fit in, and whether
  // only whole machines break it.
  reason?: string;
  shortfalls?: Shortfall[];
  minHours?: number;
  wholeMachinesOnly?: boolean;
  solverStatus?: string;
}

// A phase whose draft could not be solved either is only { feasible: false, reason }.
export type CurrentStage = StageResult | (Partial<StageResult> & { feasible: false });

// A stage as a saved plan may hold it. Everything but `feasible` is optional: a bare draft
// has no rows, and plans frozen before 2026-09-23/24 lack supplied, drone (before 09-13),
// sloopsUsed and the augmenter fields.
// JSON has no Infinity, so a saved plan holds null for a phase that never finishes.
export type StoredStage = Partial<Omit<StageResult, 'feasible' | 'hours'>> & {
  feasible: boolean;
  hours?: number | null;
};

export interface CurrentCalculatedPlan {
  // The planner's engine version ('2.0.0').
  engine: string;
  settings: CurrentSettings;
  // One stage for each of Phases 1–5, whatever the start phase.
  stages: Record<StageKey, CurrentStage>;
  // Assumptions and notices shown with the plan.
  warnings: string[];
  // ISO time of the calculation.
  createdAt: string;
}

// An end-game production line built once everything else is done.
export interface CompletionLine {
  id: string;
  name: string;
  recipe: string;
  output: number;
  machines: number;
  machine: string;
  lastClock: number;
  inputs: ItemRates;
  byproducts: ItemRates;
}

// A step of a plan guide: a narrative phase step or a storage task. The id is its saved check key.
export interface GuideStep {
  id: string;
  title: string;
  body: string;
}
// The narrative a plan can carry beyond what the planner calculates (#393): a migrated handbook
// profile keeps its phase steps, storage tasks, completion modules, power commissioning and
// factory notes this way, with every check id as the handbook had it. Nothing writes it yet
// (#395); pages without one draw exactly as before. Each part is optional.
export interface PlanGuide {
  // Narrative steps per phase ('1'–'5', 'post'); a phase without an entry has none.
  phases: Partial<Record<string, GuideStep[]>>;
  storageTasks?: GuideStep[];
  completion?: CompletionLine[];
  // The commissioning checklist (power-… ids) and blocks of copy such as the rocket-fuel block.
  power?: { checks: { id: string; label: string }[]; blocks: { title: string; body: string }[] };
  // Per calculated row id: its note, printed page, and where it is built.
  factories?: Record<
    string,
    { note?: string; page?: number; local?: boolean; nuclear?: boolean; site?: 'oil' | 'nuclear' }
  >;
  // Source links, https only.
  sources?: { title: string; url: string }[];
}

export interface StoredCalculatedPlan {
  engine: string;
  settings: StoredSettings;
  stages: Record<StageKey, StoredStage>;
  warnings: string[];
  createdAt: string;
  guide?: PlanGuide;
}

// Hard-drive payoff (#67): what allowing one more alternate recipe does to one phase of a
// profile's plan, from rankAlternates in planner.ts. Deltas are candidate minus the profile's
// own plan: fewer buildings or less raw is negative.
export interface PhaseFigures {
  buildings: number;
  // Per-minute raw draw, summed over every resource.
  rawTotal: number;
  requiredMW: number;
  // Delivery hours; null when the phase never finishes (a rate of 0).
  hours: number | null;
}
export interface AlternatePayoff {
  id: string;
  name: string;
  machine: string;
  // The phase the recipe unlocks in.
  phase: number;
  // 'same': the plan does not pick it up. 'infeasible': with it the phase does not fit (possible
  // under whole machines). 'error': the calculation failed; `error` says why.
  status: 'better' | 'worse' | 'mixed' | 'same' | 'infeasible' | 'error';
  buildings: number;
  raw: ItemRates;
  rawTotal: number;
  powerMW: number;
  // null when either plan never finishes the phase.
  hours: number | null;
  error?: string;
}
export interface AlternateRanking {
  phase: StageKey;
  base: PhaseFigures;
  candidates: AlternatePayoff[];
  // How many candidates there were in all; fewer are listed when `stopped` (budget reached).
  total: number;
  stopped: boolean;
  elapsedMs: number;
}
