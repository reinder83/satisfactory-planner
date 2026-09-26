// recipes.json: the game's recipes and items (from SatisfactoryTools), which planner.ts plans
// with.
import type { ItemRates } from './common.ts';

// A recipe at 100% clock: per-minute inputs and outputs of one machine.
export interface Recipe {
  // The game's recipe id ('Recipe_IronPlate_C'), part of a calculated row's saved check key.
  id: string;
  name: string;
  alternate: boolean;
  // The phase in which it can first be unlocked.
  phase: number;
  machine: string;
  inputs: ItemRates;
  outputs: ItemRates;
  // MW per machine; negative for a generator.
  power: number;
}

export interface ItemInfo {
  fluid: boolean;
  // MJ per item for fuels, and AWESOME Sink points (0 for unsinkable items).
  energy: number;
  sink: number;
  radioactive: boolean;
}

export interface RecipeData {
  // Where the data comes from, and its revision there.
  source: string;
  revision: string;
  recipes: Recipe[];
  items: Record<string, ItemInfo>;
  // The first phase in which each item can be made.
  availability: ItemRates;
}
