// The planner's own types that several of its modules share: a recipe as run() plans with it,
// run()'s result and its options.
import type { OnSiteLine, Recipe, StageResult, StockLine } from '../public/types/index.ts';

// A recipe as run() plans with it: from recipes.json, a generator, or an amplified twin, which
// carries its somersloop `slots` per machine. Generators have no `alternate` flag.
// A per-group line made on site (#875) also carries `onSite`, its group and the recipe it copies.
export type PoolRecipe = Omit<Recipe, 'alternate'> & {
  alternate?: boolean;
  slots?: number;
  onSite?: OnSiteLine;
  stock?: StockLine;
};
// run()'s result: a solved stage, or a failure with the solver's status when it has one.
export type Solved = StageResult & { feasible: true };
export type RunResult = Solved | { feasible: false; solverStatus?: string };
export interface RunOptions {
  maximum?: boolean;
  conversion?: boolean;
  ignoreLimits?: boolean;
  recipeIds?: Set<string> | null;
  caps?: Record<string, number> | null;
  baseline?: Record<string, number> | null;
  fractionalNuclear?: boolean;
  roundStopped?: boolean;
  overBudget?: boolean;
  loadBound?: LoadBound | null;
}
// The fixed figures a solve bounded by its load is planned with (#1086, planner/load.ts), in MW:
// what the power constraint is credited with, and the most the non-nuclear generators may give.
export interface LoadBound {
  creditMW: number;
  capMW: number;
}
