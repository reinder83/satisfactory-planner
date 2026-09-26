// The owner's handbook (public/plan.json), which the original profile reads. An imported or
// copied original profile may carry its own copy (`handbook` on the profile). The Pages
// edition ships an empty template of the same shape (buildPages in build.ts).
//
// Phases, stages and ids arrive from JSON as plain strings, so these fields are `string`
// rather than Phase: tests/types/data.types.ts checks plan.json against this type.
import type { ItemRates } from './common.ts';

// A build-plan step: phase steps and storage tasks.
export interface HandbookTask {
  id: string;
  title: string;
  body: string;
}

// A handbook factory at one stage (Phase 3, 4 or 5): per-minute rates of its product.
export interface HandbookFactoryStage {
  // Made per minute, and how much of that other factories use, storage keeps and the
  // Space Elevator takes.
  output: number;
  demand?: number;
  storage: number;
  delivery?: number;
  recipe: string;
  // Per-minute inputs of the whole line.
  inputs: ItemRates;
  machines: number;
  machine: string;
  // Machine-equivalents at 100%, the last machine's clock (%) and the rate per machine.
  equivalent?: number;
  lastClock?: number;
  rate?: number;
  avgMW: number;
  peakMW: number;
}

export interface HandbookFactory {
  id: string;
  name: string;
  // The handbook page it is printed on.
  page: number;
  // Built at the site that uses it rather than shipped.
  local?: boolean;
  nuclear?: boolean;
  // A Phase 5 resource converter row.
  conversion?: boolean;
  note: string;
  stages: Partial<Record<string, HandbookFactoryStage>>;
}

// A storage bay of the printed room; items are its containers ('A01'…), name null when empty.
export interface HandbookBay {
  id: string;
  name: string;
  floor: string;
  items: { id: string; name: string | null }[];
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

export interface HandbookDelivery {
  // '<phase>-<item slug>', the key of the saved delivery count.
  id: string;
  phase: string;
  name: string;
  target: number;
  // Parts per minute, and how many were already handed in when the handbook was written.
  rate: number;
  initial: number;
}

// One oil-campus line of a stage plan.
export interface OilLine {
  recipe: string;
  machines: number;
  equivalent: number;
  machine: string;
  avgMW: number;
  peakMW: number;
}

// A stage's oil campus and manufacturing power.
export interface StagePlan {
  oil: OilLine[];
  oilTotals: {
    crude: number;
    water: number;
    fuel: number;
    generators: number;
    grossGW: number;
    resin: number;
    recyclePlasticGross?: number;
    recycleRubberGross?: number;
  };
  manufacturingAvgGW: number;
  manufacturingPeakGW: number;
}

export interface Handbook {
  // The handbook's date ('2026-09-13'), or 'public-template-v1' for the Pages template.
  version: string;
  // Build-plan steps per phase ('3', '4', '5', 'post').
  phases: Record<string, HandbookTask[]>;
  factories: HandbookFactory[];
  storage: HandbookBay[];
  storageTasks: HandbookTask[];
  completion: CompletionLine[];
  deliveries: HandbookDelivery[];
  // Raw resource use per stage, and the capacity of each resource.
  resources: Record<string, ItemRates>;
  capacities: ItemRates;
  plans: Record<string, StagePlan>;
  // New generation per stage, in GW.
  power: Record<string, number>;
  // Checks the handbook counts as done from the start ('storage-ground-shell').
  knownChecks: Record<string, boolean>;
  sources?: { title: string; url: string }[];
}
