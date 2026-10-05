// The fallbacks after a whole-machine search stopped at its limit (#593, #694): the exact plan
// rounded to whole machines, or planned with easy clocks, with linear solves only.
import { solve, type LpModel } from '../optimizer.ts';
import type { CurrentSettings, StageDelivery } from '../public/types/index.ts';
import type { PoolRecipe, Solved, RunResult, RunOptions } from './types.ts';
import { DATA, RAW } from './data.ts';
import {
  type PhaseContext,
  phaseContext,
  type Solution,
  phasePool,
  reachableItems,
  phaseDemands,
  goalHours,
  buildModel,
  satisfiesModel,
} from './model.ts';
import { readStage } from './stage.ts';

// What the fallbacks after a stopped search (roundedFallback, easyClockFallback) share: the exact
// plan's network and amplification candidates, the variants to try in order, `marked`, which
// flags a result of the unamplified variant, and the time (Date.now) they must stop trying by.
interface StoppedFallback {
  ids: Set<string>;
  baseline: Record<string, number>;
  variants: CurrentSettings[];
  marked: (variant: CurrentSettings, result: Solved) => Solved;
  until: number;
}
// A failure that is a search stopped at its limit ('Unknown' at the node limit, 'Time limit
// reached' at the backstop or the phase's deadline), not a proven shortage.
export const stoppedSearch = (result: RunResult) =>
  !result.feasible && !!result.solverStatus && !/infeasible/i.test(result.solverStatus);
// How much longer than its target a phase rounded after a stopped search may be planned for
// (#593): the target itself first, then 5%, 10%, 25% and 50% longer. Lower delivery rates mean
// smaller lines, so a rounded plan that is over a budget at the target can fit at a longer time.
// At each step, lines rounded down may slow the phase to the next step's time; at the last, not
// at all, so a rounded phase never takes more than 50% longer than its target.
const ROUNDED_STRETCH = [1, 1.05, 1.1, 1.25, 1.5];
// How long roundedFallback and easyClockFallback may try together, in milliseconds. They run
// after the phase's searches, which on a slow device end at the phase's deadline
// (PHASE_SEARCH_MS, 120 s), so this keeps the phase well inside the browser worker's 180 s. An
// ordinary machine needs a few seconds at most, so the result does not depend on the machine
// there.
export const ROUNDING_MS = 20000;
// The whole-machine search of this phase stopped before it could prove the best plan, but the
// exact plan (`base`) fits. The owner's decision in #593: build whole machines from that plan
// anyway, each line at the nearest whole count the material balance allows, and let the phase
// take slightly longer where it must. At each time of ROUNDED_STRETCH, shortest first, try the
// amplified variant, then the unamplified one (so amplification on never plans worse than off),
// over the exact plan's network. Each try is linear solves only (roundedFit), so it cannot stop at
// a search limit and gives the same plan on every run. The first try that fits the budgets is
// used, and the stage records the exact plan's time as `roundedAfterStop`, so the warning says
// "instead of" only when the rounding slowed the phase: under the balanced goal the rounded rates
// make the exact plan itself take 8.33 hours (#708). Returns null when none does;
// easyClockFallback then plans the phase.
export function roundedFallback(
  context: PhaseContext,
  base: Solved,
  fallback: StoppedFallback,
): Solved | null {
  const target = stoppedTarget(context, base);
  for (const [step, stretch] of ROUNDED_STRETCH.entries())
    for (const variant of fallback.variants) {
      const next = ROUNDED_STRETCH[step + 1] ?? stretch;
      const rounded = roundedTry(context, variant, { target, stretch, next }, 'whole', fallback);
      if (!rounded) return null;
      if (rounded.feasible)
        return fallback.marked(variant, { ...rounded, roundedAfterStop: base.hours });
      // Lines that take turns being rounded up do so at any time, so stop there.
      if (rounded.solverStatus === UNSETTLED) return null;
    }
  return null;
}
// The time a phase whose search stopped was asked to finish in: the goal's, or under maximum
// output the exact plan's best time.
const stoppedTarget = ({ config, maximum }: PhaseContext, base: Solved) =>
  maximum ? base.hours : goalHours(config);
// No rounded whole-machine plan fits, even 50% longer (#694, the owner's decision in #593:
// "easy to set" fractions). Plan the exact plan's network with each solid-part line on whole
// machines at 100% but the last, which runs at 25%, 50%, 75% or 100% ('easy'). Where that does
// not fit, the last machine may also run at any clock that makes a whole number of the line's
// product per minute ('rate'), a figure the game's clock panel takes as well. Each is rounded as
// roundedFallback rounds, at each time of ROUNDED_STRETCH, shortest first: under maximum output the
// quarter grid can fit only from 10% longer, and the owner chose easy clocks at a longer time
// over precise ones at the target (#701). At each time: easy clocks, then rate clocks, each
// amplified before unamplified, nearest then all up. When none fits, or time runs out, the phase
// is the exact plan itself ('precise'), which fits by definition, so a stopped search never costs
// the phase. The stage records the exact plan's time (as roundedFallback does, #708) and the clocks
// as `fractionalAfterStop`.
export function easyClockFallback(
  context: PhaseContext,
  base: Solved,
  fallback: StoppedFallback,
): Solved {
  const target = stoppedTarget(context, base);
  // Lines that take turns being rounded up do so at any time, so a grid and variant that did not
  // settle are not tried longer.
  const unsettled = new Set<string>();
  for (const [step, stretch] of ROUNDED_STRETCH.entries()) {
    const time = { target, stretch, next: ROUNDED_STRETCH[step + 1] ?? stretch };
    for (const clocks of ['easy', 'rate'] as const)
      for (const [index, variant] of fallback.variants.entries()) {
        const key = `${clocks}:${index}`;
        if (unsettled.has(key)) continue;
        const fitted = roundedTry(context, variant, time, clocks, fallback);
        if (!fitted) return exactFallback(fallback, base);
        if (fitted.feasible)
          return fallback.marked(variant, {
            ...fitted,
            fractionalAfterStop: { target: base.hours, clocks },
          });
        if (fitted.solverStatus === UNSETTLED) unsettled.add(key);
      }
  }
  return exactFallback(fallback, base);
}
// easyClockFallback's last resort: the exact plan itself, with its precise clocks. It is
// unamplified (exactFit), so it is marked as the last variant.
const exactFallback = (fallback: StoppedFallback, base: Solved): Solved =>
  fallback.marked(fallback.variants.at(-1)!, {
    ...base,
    fractionalAfterStop: { target: base.hours, clocks: 'precise' },
  });
// One try of the fallbacks after a stopped search: `variant` at `stretch` times the `target`,
// its lines rounded to the `clocks` grid (roundedFit). Returns null when the time is up.
function roundedTry(
  { phase, maximum, conversion, ignoreLimits }: PhaseContext,
  variant: CurrentSettings,
  { target, stretch, next }: { target: number; stretch: number; next: number },
  clocks: Clocks,
  { ids, baseline, until }: StoppedFallback,
): RunResult | null {
  // At the target itself the goal is unchanged. Longer, the deliveries are spread over the
  // longer time, as a timed goal spreads them; maximum output keeps its rates unrounded.
  const timed: CurrentSettings =
    stretch === 1 && !maximum
      ? variant
      : {
          ...variant,
          goal: 'timed',
          hours: target * stretch,
          ...(maximum ? { roundRates: false } : {}),
        };
  // Lines rounded to their nearest count, where those rounded down may slow the phase to the
  // `next` time, and every line rounded up (null), which needs more resources but no more time.
  // The nearest rounding is used unless it does not fit or the rounded-up plan is as lean:
  // honouring a line rounded down can shift work to other lines, and then it only slows the phase.
  const fit = (slowest: number | null) =>
    roundedFit(
      timed,
      phase,
      slowest,
      { conversion, ignoreLimits, recipeIds: ids, baseline },
      clocks,
    );
  if (Date.now() > until) return null;
  const nearest = fit(stretch / next);
  const up = Date.now() > until ? null : fit(null);
  return nearest.feasible && !(up?.feasible && machineCount(up) <= machineCount(nearest))
    ? nearest
    : up;
}
// The buildings of a stage's lines.
const machineCount = (stage: Solved) => stage.rows.reduce((total, row) => total + row.machines, 0);
// A whole-machine plan rounded from the exact one, without an integer search (#593). As
// integerFit does, whole nuclear plants that do not fit fall back to fractional ones
// (`nuclearFractional`).
function roundedFit(
  variant: CurrentSettings,
  phase: number,
  slowest: number | null,
  options: RunOptions,
  clocks: Clocks,
): RunResult {
  const result = roundedRun(phaseContext(variant, phase, options), slowest, clocks);
  if (
    result.feasible ||
    result.solverStatus === UNSETTLED ||
    !variant.wholeMachines ||
    !options.recipeIds?.has('power-uranium')
  )
    return result;
  const fractional = roundedRun(
    phaseContext(variant, phase, { ...options, fractionalNuclear: true }),
    slowest,
    clocks,
  );
  return fractional.feasible ? { ...fractional, nuclearFractional: true } : result;
}
// Rounding passes before roundedRun gives up. Each pass settles at least one more level of the
// supply chain; the settings tried in #593 needed at most 16, and a line left fractional after
// ROUNDING_RAISES about as many again.
const ROUNDING_PASSES = 30;
const UNSETTLED = 'Rounding did not settle';
// How often one line may be rounded up again before roundedRun leaves it fractional. Two whole
// lines tied by a fluid that must balance exactly (Rubber and Petroleum Coke by Heavy Oil
// Residue, Alumina Solution and Aluminum Scrap) take turns being rounded up without end; a
// whole-machine search can find counts that fit both, rounding cannot. The line that keeps
// coming back keeps its fractional clock, as fluid lines do, and the rest of the plan is whole.
// A line at the top of a long chain can reach the limit too, sharing no fluid; the warning words
// the two apart (raisedLines, #714).
const ROUNDING_RAISES = 6;
// The same two limits for the finer grids of easyClockFallback (#694). Each raise there leaves a
// quarter of a machine or less to spare rather than up to a whole one, so a line at the top of a
// long chain (Copper Ingot under Wire, Cable and Copper Sheet) is raised more often before the
// chain settles; the extra passes leave room for the lines that take turns.
const EASY_RAISES = 12;
const EASY_PASSES = ROUNDING_PASSES + 2 * (EASY_RAISES - ROUNDING_RAISES);
// Solve the fit's model with its integers relaxed and the deliveries drawn at one `pace` (see
// addPace), then round every whole-machine line (and the uranium plants, see roundNuclear) that
// comes out fractional to its nearest whole count (at least one machine), and solve again:
// rounding a line changes what the lines that feed it must make, so this repeats until every such
// line is whole. A line nearest a higher count gets that count as a minimum, and its suppliers
// follow. A line nearest a lower count gets it as a cap: it delivers less, the pace drops and the
// phase takes longer, down to `slowest`. A cap may be exceeded (`over:`), but each solve first
// exceeds the caps as little as it can (solveRounded), so a cap holds unless the lines it feeds
// need more than it allows, or the phase would end slower than `slowest`; a line over its cap is
// rounded up from then on instead. An amplified twin is fixed at its rounded-down count on the
// first pass, so the somersloop budget still holds; its unamplified line makes up the rest. A line
// rounded up more than ROUNDING_RAISES times is left fractional from then on (keeping its
// minimum). Minimums only grow and caps only fall or go, so it ends whole, over a budget, or at
// ROUNDING_PASSES. `clocks` is the grid the lines are rounded to (lineGrid): whole machines for
// roundedFallback, easy clocks on the last machine for easyClockFallback (whose grids count
// EASY_RAISES and EASY_PASSES instead).
function roundedRun(context: PhaseContext, slowest: number | null, clocks: Clocks): RunResult {
  const pool = phasePool(context);
  const demands = phaseDemands(context, reachableItems(context, pool));
  const { model, period } = buildModel(context, pool, demands);
  const whole = Object.keys(model.ints ?? {});
  const amplified = whole.filter(id => id.startsWith('amp:'));
  const grid = lineGrid(clocks, pool);
  const raised: Record<string, number> = {};
  const roundUp = new Set<string>(slowest === null ? whole : []);
  delete model.ints;
  addPace(model, demands.delivery, slowest ?? 1);
  const [passes, raises] =
    clocks === 'whole' ? [ROUNDING_PASSES, ROUNDING_RAISES] : [EASY_PASSES, EASY_RAISES];
  for (let pass = 0; pass < passes; pass++) {
    const solved = solveRounded(model);
    if (!solved.feasible || !solved.bounded)
      return { feasible: false, solverStatus: solved.solverStatus };
    // Caps the lines they limit could not keep: round those lines up instead.
    const overCap = whole.filter(id => (solved.values['over:' + id] || 0) > 1e-6);
    for (const id of overCap) {
      dropCap(model, id);
      roundUp.add(id);
    }
    const rounding = whole.filter(id => (raised[id] || 0) <= raises);
    const fractional = rounding.filter(
      id => overCap.includes(id) || !onGrid(grid(id), solved.values[id]!),
    );
    if (!fractional.length) {
      for (const id of rounding) solved.values[id] = gridPoints(grid(id), solved.values[id]!).near;
      if (!satisfiesModel(model, solved)) return { feasible: false };
      for (const part of Object.values(demands.delivery)) part.rate *= solved.values.pace!;
      return readStage(context, pool, demands, solved, period, model);
    }
    // The amplified twins are fixed once, on the first pass; left free, each pass would trade
    // more of them for the unamplified lines already rounded up.
    const fixing = pass ? fractional : [...new Set([...fractional, ...amplified])];
    for (const id of fixing) roundLine(model, id, solved.values[id]!, grid(id), roundUp, raised);
  }
  return { feasible: false, solverStatus: UNSETTLED };
}
// The grids the fallbacks after a stopped search round a line to: 'whole' machines
// (roundedFallback), or whole machines at 100% with the last at an 'easy' clock (25%, 50% or
// 75%), or at that or a clock where it makes a whole number of the line's product per minute
// ('rate'; easyClockFallback, #694).
type Clocks = 'whole' | 'easy' | 'rate';
// A line's grid: the machine-equivalents its last machine may add, from 0 to 1, in order.
const WHOLE_GRID = [0, 1];
const EASY_GRID = [0, 0.25, 0.5, 0.75, 1];
// The grid of each line of `pool` under `clocks`. Amplified twins and the uranium plants (or
// their recycle blocks, see roundNuclear) are always whole machines.
function lineGrid(clocks: Clocks, pool: PoolRecipe[]): (id: string) => number[] {
  const rates = new Map(pool.map(recipe => [recipe.id, productRate(recipe)]));
  return id => {
    if (clocks === 'whole' || id.startsWith('amp:') || id === 'power-uranium' || !rates.has(id))
      return WHOLE_GRID;
    if (clocks === 'easy') return EASY_GRID;
    // A whole number of items per minute from the last machine: k / rate of a machine.
    const rate = rates.get(id)!;
    const counts = Array.from({ length: Math.floor(rate + 1e-9) }, (_, k) => (k + 1) / rate);
    return [...new Set([...EASY_GRID, ...counts])].sort((a, b) => a - b);
  };
}
// Per minute of one machine at 100%, the product a whole-machine line is rounded for: its first
// solid, sinkable, non-raw output (roundsToWholeMachines).
export const productRate = (recipe: PoolRecipe) =>
  Object.entries(recipe.outputs).find(
    ([item]) =>
      !DATA.items[item]?.fluid && !RAW.includes(item) && (DATA.items[item]?.sink ?? 0) > 0,
  )?.[1] ?? 1;
// The grid points around `value`: the nearest at or below it, at or above it, and the nearer of
// those two (the higher on a tie, as Math.round).
function gridPoints(grid: number[], value: number) {
  const machines = Math.floor(value + 1e-6),
    part = value - machines;
  const below = machines + Math.max(...grid.filter(step => step <= part + 1e-6));
  const above = machines + Math.min(...grid.filter(step => step >= part - 1e-6));
  return { below, above, near: value - below < above - value ? below : above };
}
const onGrid = (grid: number[], value: number) =>
  Math.abs(value - gridPoints(grid, value).near) <= 1e-6;
// One line's rounding for the next pass of roundedRun: an amplified twin fixed at its rounded-down
// count, a cap at the nearest grid point when that is lower, else the grid point above as a
// minimum. A line in use keeps at least the grid's first step (one machine for whole machines).
function roundLine(
  model: LpModel,
  id: string,
  value: number,
  grid: number[],
  roundUp: Set<string>,
  raised: Record<string, number>,
) {
  const key = 'whole:' + id;
  model.variables[id]![key] = 1;
  const points = gridPoints(grid, value);
  if (id.startsWith('amp:')) {
    model.constraints[key] = { equal: points.below };
    return;
  }
  const nearest = Math.max(grid[1]!, points.near);
  if (nearest < value && !roundUp.has(id)) {
    model.constraints[key] = { ...model.constraints[key], max: nearest };
    model.variables['over:' + id] ??= { [key]: -1, overCap: 1, keepOver: 1 };
    return;
  }
  model.constraints[key] = { ...model.constraints[key], min: points.above };
  // The uranium plants have their own fallback to fractional plants (roundedFit).
  if (id !== 'power-uranium' && id !== 'nuclear-block') raised[id] = (raised[id] || 0) + 1;
}
// Lifts a line's cap (roundLine), keeping its minimum.
function dropCap(model: LpModel, id: string) {
  delete model.variables['over:' + id];
  const bound = model.constraints['whole:' + id];
  if (bound) delete bound.max;
}
// The deliveries as a share of their rates: `pace` (at most 1, at least `slowest`) draws every
// delivered part at pace x its rate, in place of the fixed demand, as the goal variable does under
// maximum output.
function addPace(model: LpModel, delivery: Record<string, StageDelivery>, slowest: number) {
  const pace: Record<string, number> = { gain: 1, paceCap: 1, keepPace: 1 };
  for (const [item, part] of Object.entries(delivery)) {
    const balance = model.constraints['item:' + item]!;
    if (balance.equal !== undefined) balance.equal -= part.rate;
    else balance.min = (balance.min || 0) - part.rate;
    pace['item:' + item] = -part.rate;
  }
  model.variables.pace = pace;
  model.constraints.paceCap = { min: slowest, max: 1 };
}
// Three solves, each keeping the best of the one before: exceed the caps of roundLine as little as
// possible, then deliver as fast as that allows, then with as few machines as that pace allows (as
// solveModel does under maximum output).
function solveRounded(model: LpModel): Solution {
  delete model.constraints.keepOver;
  delete model.constraints.keepPace;
  const stage = (optimize: string, opType: 'max' | 'min') => {
    model.optimize = optimize;
    model.opType = opType;
    return solve(model);
  };
  const caps = Object.keys(model.variables).filter(id => id.startsWith('over:'));
  if (caps.length) {
    const leastOver = stage('overCap', 'min');
    if (!leastOver.feasible || !leastOver.bounded) return leastOver;
    const over = caps.reduce((total, id) => total + leastOver.values[id]!, 0);
    model.constraints.keepOver = { max: over + 1e-7 };
  }
  const fastest = stage('gain', 'max');
  if (!fastest.feasible || !fastest.bounded) return fastest;
  model.constraints.keepPace = { min: fastest.values.pace! * (1 - 1e-8) };
  const economical = stage('cost', 'min');
  return economical.feasible ? economical : fastest;
}
