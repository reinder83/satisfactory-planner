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
  // MW per machine at 100%; negative for a generator.
  power: number;
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

// A resource a failed phase needs more of.
export interface Shortfall {
  name: string;
  needed: number;
  budget: number;
}

// A stage as calculate() returns it today: a plan, or for a phase that does not fit, a draft
// of the closest plan with feasible false and the reason (see CurrentStage).
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

export interface StoredCalculatedPlan {
  engine: string;
  settings: StoredSettings;
  stages: Record<StageKey, StoredStage>;
  warnings: string[];
  createdAt: string;
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
