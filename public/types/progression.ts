// public/progression.json: the game's milestones and MAM research, generated from the game
// data. public/progression.ts turns it into the unlock steps of a calculated plan. Two corrections
// to the data, each tested: Compacted Coal's alternates require its MAM research (#828), and
// Control System Development (Schematic_7-5_C) also unlocks Distilled Silica, as the wiki gives it
// and the data leaves out (#1044, MILESTONE_RECIPES in planner/data.ts).
import type { ItemRates } from './common.ts';

// A milestone, MAM research node or hard-drive alternate.
export interface ProgressionEntry {
  // The game's schematic id ('Schematic_2-5_C'), part of the saved 'unlock-<id>' check key.
  id: string;
  name: string;
  tier: number;
  mam: boolean;
  alternate: boolean;
  // Parts handed in to unlock it.
  cost: ItemRates;
  // Recipe ids it unlocks, and the schematic ids it needs first.
  recipes: string[];
  requires: string[];
}

export interface Progression {
  entries: ProgressionEntry[];
  // Building name to the recipe id that unlocks it.
  buildings: Record<string, string>;
  // The first phase in which each item can be made.
  availability: ItemRates;
}
