// Overclocked production lines (#1239, slice 1 of 2): settings.lineClocks runs every machine of a
// line at a clock above 100%, `{ phase: { recipe: clock in % } }`, with Power Shards, so the line
// needs fewer machines. A clocked line is planned as its recipe at that clock (lineClock): its
// rates times the clock and its power times the clock to the power exponent every building shares
// (CLOCK_EXPONENT, 1.321929), so the solve's machine count is machines at that clock, whole ones
// under whole machines, and each line's cost, power and caps follow from it as at 100%. Its row
// says its `clock` and the Power Shards it holds (`shards`, one per 50% started above 100%, on
// every machine of the line, the last one's too). A phase keeps a clock, or plans without it and
// records why in `lineClocksDropped`, never changing it silently:
//   research     overclocking needs the MAM's Power Shards research, which Phase 1 cannot do
//                unless the player can overclock (settings.overclock, as the miners' clock)
//   unavailable  the recipe is not in the phase's recipe pool
//   budget       the plan at those clocks takes more Power Shards than settings.lineShardBudget
//   fit          no plan of the phase fits with them (fitClocks)
// The budget counts only the production lines' shards; the miners' and extractors' clocks and
// shard advice stay as they are (#1137, #1169). Without lineClocks nothing here runs, so such a
// plan calculates exactly as before. Only an explicit solver input so far: the interface and the
// progress state never set it (the per-line pin is slice 2).
import type {
  CurrentSettings,
  CurrentStage,
  LineClockDrop,
  LineClockReason,
  StageKey,
} from '../public/types/index.ts';
import type { PoolRecipe, RunResult } from './types.ts';
import { CLOCK_EXPONENT } from '../public/power.ts';
import { extractorShards, phaseClock } from '../public/preferences.ts';
import { recipePool } from './recipes.ts';
import { stoppedSearch } from './rounding.ts';

// A phase's line clocks, { recipe: clock in % }; empty without any.
export const phaseClocks = (
  config: Pick<CurrentSettings, 'lineClocks'>,
  phase: number,
): Record<string, number> => config.lineClocks?.[String(phase) as StageKey] ?? {};

// `recipe` at `clock` percent: its rates times the clock, its power (and a variable-power
// machine's minPower) times the clock to the power exponent, and the clock on it, so one unit of
// its solve variable is one machine at that clock.
export function lineClock(recipe: PoolRecipe, clock: number): PoolRecipe {
  const factor = clock / 100,
    power = factor ** CLOCK_EXPONENT;
  const scaled = (rates: Record<string, number>) =>
    Object.fromEntries(Object.entries(rates).map(([item, rate]) => [item, rate * factor]));
  return {
    ...recipe,
    clock,
    power: recipe.power * power,
    ...(recipe.minPower !== undefined ? { minPower: recipe.minPower * power } : {}),
    inputs: scaled(recipe.inputs),
    outputs: scaled(recipe.outputs),
  };
}
// The Power Shards a line of `machines` at `clock` percent holds: each machine the shards its clock
// needs (1 up to 150%, 2 up to 200%, 3 up to 250%), the last one's too, so it can run at the clock.
export const lineShards = (clock: number, machines: number): number =>
  machines * extractorShards(clock);

// Which of a phase's clocks it can keep before anything is solved, and why it cannot keep the
// others ('research', 'unavailable'; see the header).
export function checkClocks(
  config: CurrentSettings,
  phase: number,
  conversion: boolean,
): { kept: Record<string, number>; dropped: LineClockDrop[] } {
  const clocks = Object.entries(phaseClocks(config, phase));
  const kept: Record<string, number> = {},
    dropped: LineClockDrop[] = [];
  if (!clocks.length) return { kept, dropped };
  const research = phaseClock(phase, config.overclock) > 1;
  const pool = new Set(recipePool(config, phase, conversion).map(recipe => recipe.id));
  for (const [recipe, clock] of clocks) {
    const reason: LineClockReason | null = !research
      ? 'research'
      : !pool.has(recipe)
        ? 'unavailable'
        : null;
    if (reason) dropped.push({ recipe, clock, reason });
    else kept[recipe] = clock;
  }
  return { kept, dropped };
}
// `config` with phase `phase`'s clocks replaced by `clocks`: the phase's entry left out when
// `clocks` is empty, and the field left out when no phase has any.
export function withPhaseClocks(
  config: CurrentSettings,
  phase: number,
  clocks: Record<string, number>,
): CurrentSettings {
  const { lineClocks, ...others } = config;
  const rest = Object.fromEntries(
    Object.entries(lineClocks ?? {}).filter(([key]) => key !== String(phase)),
  );
  if (Object.keys(clocks).length) rest[String(phase)] = clocks;
  return Object.keys(rest).length ? { ...others, lineClocks: rest } : others;
}
// The settings a phase is solved with: only the clocks it can keep (checkClocks). The settings
// themselves when the phase has no clocks.
export function keptClocks(config: CurrentSettings, phase: number, conversion: boolean) {
  if (!config.lineClocks?.[String(phase) as StageKey]) return config;
  return withPhaseClocks(config, phase, checkClocks(config, phase, conversion).kept);
}
// A phase's result with the clocks checkClocks gives up before solving. The result as it is
// without clocks, or when it kept them all.
export function withClockDrops(
  result: RunResult,
  config: CurrentSettings,
  phase: number,
  conversion: boolean,
): RunResult {
  if (!result.feasible || !config.lineClocks?.[String(phase) as StageKey]) return result;
  const { dropped } = checkClocks(config, phase, conversion);
  return dropped.length ? { ...result, lineClocksDropped: dropped } : result;
}
// The Power Shards a result's clocked lines hold together.
const shardsOf = (result: RunResult): number =>
  result.feasible ? result.rows.reduce((total, row) => total + (row.shards ?? 0), 0) : 0;
// `result`, or no plan when its clocked lines hold more Power Shards than settings.lineShardBudget.
// Checked on every solve, the inner ones of the two-step fit and the capped re-solves too, so no
// plan the planner keeps is over it. The model does not steer by it: which line to give up is the
// user's call, so a phase over it is planned without its clocks ('budget', fitClocks).
export function withinShardBudget(config: CurrentSettings, result: RunResult): RunResult {
  if (config.lineShardBudget === undefined || !result.feasible) return result;
  return shardsOf(result) > config.lineShardBudget ? { feasible: false } : result;
}
// One phase's solve (`solve`, solvePhase's in calculate.ts) with its line clocks, or without them
// when no plan fits with them: the result then records every clock the phase kept as dropped,
// 'budget' when it fits with them without the shard budget, else 'fit', after those checkClocks
// gave up. A search that only stopped at a limit proves nothing, so it keeps the clocks, and so
// does a phase that fits without them neither (its draft explains the plan with them).
export function fitClocks(
  config: CurrentSettings,
  phase: number,
  solve: (settings: CurrentSettings) => RunResult,
): RunResult {
  const result = solve(config);
  if (result.feasible || stoppedSearch(result)) return result;
  const { kept, dropped } = checkClocks(config, phase, phase === 5 && config.sam !== 'avoid');
  if (!Object.keys(kept).length) return result;
  const without = solve(withPhaseClocks(config, phase, {}));
  if (!without.feasible) return result;
  const { lineShardBudget, ...unbudgeted } = config;
  const reason: LineClockReason =
    lineShardBudget !== undefined && solve(unbudgeted).feasible ? 'budget' : 'fit';
  return {
    ...without,
    lineClocksDropped: [
      ...dropped,
      ...Object.entries(kept).map(([recipe, clock]) => ({ recipe, clock, reason })),
    ],
  };
}
// The settings a re-solve of a finished stage uses (fullSpeed, phaseTime 'final', the augmenter
// fuel verdict, the exact plan): without the clocks the stage could not keep, as it was planned.
export function stageClocks(
  config: CurrentSettings,
  phase: number,
  stage: Pick<CurrentStage, 'lineClocksDropped'> | undefined,
): CurrentSettings {
  const dropped = stage?.lineClocksDropped;
  if (!dropped?.length) return config;
  const clocks = { ...phaseClocks(config, phase) };
  for (const { recipe } of dropped) delete clocks[recipe];
  return withPhaseClocks(config, phase, clocks);
}
// What a re-solve of `stage` keeps saying about its clocks: those it could not keep.
export const clockMarks = (stage: Pick<CurrentStage, 'lineClocksDropped'>) =>
  stage.lineClocksDropped ? { lineClocksDropped: stage.lineClocksDropped } : {};
