// One phase's linear program: run(), its context, the recipe pool and demands, the model's
// constraints and variables, the solve and the check of its result.
// Re-exported by ../planner.ts.
import { droneSupply, wantsStorage, storageRateFor } from '../public/preferences.ts';
import { solve, type LpModel } from '../optimizer.ts';
import type { CurrentSettings, ItemRates, StageDelivery, StageKey } from '../public/types/index.ts';
import type { PoolRecipe, RunResult, RunOptions } from './types.ts';
import { DATA, RAW, DELIVERIES } from './data.ts';
import { recipePool, amplifiable, amplified, nuclearPeriod, generators } from './recipes.ts';
import { twoStepFit } from './fit.ts';
import { readStage } from './stage.ts';
import { siteCopies, siteRoutes, type Routes } from './on-site.ts';

// Plans one phase: builds the phase's LP (or MIP), solves it and turns the solution into a stage.
// Each phase is a self-contained steady state; nothing is carried over from an earlier phase's
// solution (only calculate()'s phaseTime 'final' pass passes `caps` from later phases).
//
// Inputs: `config` normalised settings, `phase` a number 1 to 5, and options:
//   maximum       maximise simultaneous elevator delivery instead of meeting fixed delivery rates
//   conversion    allow the Converter recipes that make raw resources (Phase 5 SAM conversion)
//   ignoreLimits  lift every resource budget to 1e7/min (diagnostics: what would this need?)
//   recipeIds     restrict the pool to these recipe ids (the network an exact solve chose); set,
//                 it also marks the inner solve of the two-step fit (fit.ts)
//   caps          { recipeId: max machine-equivalents }; a recipe missing from it is capped at 0
//   baseline      { recipeId: equivalent } from the exact solve: which lines get amplified twins
//   fractionalNuclear  leave the uranium plants fractional in a whole-machine fit (the fallback
//                 when whole nuclear plants do not fit, #370)
//   roundStopped  when the whole-machine search stops at its limit, round the exact plan to
//                 whole machines instead (roundedFallback, #593); only solvePhase sets it
//
// Returns { feasible: false, solverStatus? } or a stage:
//   rows        one per recipe in use, in build order (suppliers before consumers): the recipe
//               plus `equivalent` (machine-equivalents at 100%), `machines` (whole buildings),
//               `lastClock` (% clock of the last machine), inputs/outputs scaled to the line's
//               per-minute totals, `peakMW` (whole machines at full power, before the utility
//               allowance), `generationMW` for generators, and `amplified`/`sloops` for 'amp:' rows
//   raw         per-minute draw on each raw resource; `supplied` credited existing production
//   storage     protected storage rate per storable item (0 keeps the container, reserves nothing)
//   drone       dedicated drone fuel per minute; `delivery` { item: { target, rate } }
//   surplus     solid, sinkable output per minute beyond every demand (overflow for the sink)
//   power       peakMW, generationMW, requiredMW (peak with utility allowance), availableMW (new
//               generation with augmenter boost plus spare), additionalHeadroomMW (shortfall)
//   hours       time to finish the phase's deliveries at these rates
//   plus plutoniumSink, sloopsUsed, augmenter fields, matrixRate and `conversions` (row names),
//   and `nuclearPeriod` when the uranium plants came in multiples of the recycle chain's period
// The two-step fit may add nuclearFractional, supplyDropped, amplificationDropped,
// roundedAfterStop or fractionalAfterStop, and solvePhase in calculate.ts onSiteDropped (#875).
// A factory group's own line for an item it makes on site (settings.onSite) is a row like any
// other, with the id '<recipe>:<group>' and `onSite` (see planner/on-site.ts).
// calculate() may add aheadOf (pullFinalPhaseForward), fuelVerdict (judgeAugmenterFuel), or turn
// a failed phase into a draft with reason/shortfalls/minHours (draftStage). The interface reads
// these fields through calcStage() in public/app/session.ts: mainly
// public/app/views/calculated.ts, public/app/flow.ts and the components in public/app/ui/plan/
// and public/app/ui/wizard/. Only calculate() calls run, through its phase helpers (solvePhase,
// draftStage, resolveEarlierPhases, solveUnfueled) and the two-step fit (fit.ts).
export function run(config: CurrentSettings, phase: number, options: RunOptions = {}): RunResult {
  const context = phaseContext(config, phase, options);
  // The inner calls of the two-step fit pass `recipeIds`, so they skip it and plan the phase.
  if ((config.wholeMachines || config.amplifySloops > 0) && !context.recipeIds)
    return twoStepFit(context);
  const pool = phasePool(context);
  const demands = phaseDemands(context, reachableItems(context, pool));
  const { model, period } = buildModel(context, pool, demands);
  const solved = solveModel(model, context.maximum);
  // solverStatus lets calculate() tell a search stopped at its limit ('Unknown' at the node limit,
  // 'Time limit reached' at the clock's backstop) from a real shortage.
  if (!solved.feasible || !solved.bounded)
    return { feasible: false, solverStatus: solved.solverStatus };
  if (!satisfiesModel(model, solved)) return { feasible: false };
  return readStage(context, pool, demands, solved, period);
}
// What every step of one phase's solve shares: the normalised settings, the phase (1 to 5),
// run()'s options with their defaults filled in, and the phase's power figures.
export interface PhaseContext extends Required<RunOptions> {
  config: CurrentSettings;
  phase: number;
  power: PhasePower;
}
// run()'s options with their defaults filled in, and the phase's power figures.
export const phaseContext = (
  config: CurrentSettings,
  phase: number,
  {
    maximum = false,
    conversion = false,
    ignoreLimits = false,
    recipeIds = null,
    caps = null,
    baseline = null,
    fractionalNuclear = false,
    roundStopped = false,
  }: RunOptions,
): PhaseContext => ({
  config,
  phase,
  maximum,
  conversion,
  ignoreLimits,
  recipeIds,
  caps,
  baseline,
  fractionalNuclear,
  roundStopped,
  power: phasePower(config, phase),
});
// The phase's power figures (see phasePower).
interface PhasePower {
  utilityFactor: number;
  augmenters: number;
  fueled: number;
  boost: number;
  spareMW: number;
}
// The per-minute amounts that must leave the phase's network (see phaseDemands): `demand` in
// total per item, and the parts it is made of that the stage reports.
export interface PhaseDemands {
  demand: ItemRates;
  storage: ItemRates;
  delivery: Record<string, StageDelivery>;
  drone: ItemRates;
  transport: ItemRates;
  matrix: number;
}
export type Solution = ReturnType<typeof solve>;
// Recipe pool. With `recipeIds` (the inner integer fit) only the chosen network, plus the
// conversion recipes when those are allowed. Amplified twins are added only in that inner fit,
// and only for the baseline's candidate lines.
export function phasePool({
  config,
  phase,
  conversion,
  recipeIds,
  baseline,
}: PhaseContext): PoolRecipe[] {
  const whole: PoolRecipe[] = [
    ...recipePool(config, phase, conversion),
    ...generators(config, phase),
  ];
  // The groups' own lines (#875) are copies of whole-pool recipes, so every solve of the phase,
  // narrowed or not, offers the same ones.
  const selected = [...whole, ...siteCopies(config, phase, whole)].filter(
    recipe =>
      !recipeIds ||
      recipeIds.has(recipe.id) ||
      (conversion &&
        !recipe.onSite &&
        Object.keys(recipe.outputs).some(item => RAW.includes(item) && item !== 'Water')),
  );
  return [
    ...selected,
    ...(config.amplifySloops > 0 && recipeIds
      ? selected
          .filter(
            recipe => amplifiable(recipe) && !recipe.onSite && baseline?.[recipe.id] !== undefined,
          )
          .map(amplified)
      : []),
  ];
}
// Items the pool can actually make from raw resources (and from nuclear waste, which the
// plants themselves produce), found by repeated passes. Only reachable items are given a
// protected storage demand, so storage never asks for something this phase cannot make.
export function reachableItems({ config, phase }: PhaseContext, pool: PoolRecipe[]): Set<string> {
  const reachable = new Set(RAW);
  if (config.nuclear !== 'none' && phase >= 4) reachable.add('Uranium Waste');
  if (config.nuclear === 'recycle' && phase === 5) reachable.add('Plutonium Waste');
  for (let i = 0; i < 20; i++)
    for (const recipe of pool)
      if (Object.keys(recipe.inputs).every(item => reachable.has(item)))
        Object.keys(recipe.outputs).forEach(item => reachable.add(item));
  return reachable;
}
// Demands: per-minute amounts that must leave the network rather than feed another recipe.
// They become the right-hand sides of the item balance constraints (addBalances). Four kinds:
// protected storage, elevator deliveries, drone and vehicle fuel, and Phase 5 Singularity Cells
// and augmenter fuel.
export function phaseDemands(context: PhaseContext, reachable: Set<string>): PhaseDemands {
  const { config, phase, maximum } = context;
  const demand: ItemRates = {};
  const add = (item: string, rate: number) => (demand[item] = (demand[item] || 0) + rate);
  const storage = storageDemand(config, reachable);
  for (const [item, rate] of Object.entries(storage)) if (rate > 0) demand[item] = rate;
  // Under `maximum` deliveries are not a fixed demand; the goal variable (addSources) draws them.
  const delivery = deliveryDemand(context);
  if (!maximum) for (const [item, part] of Object.entries(delivery)) add(item, part.rate);
  const drone = droneSupply(config, phase);
  for (const [item, rate] of Object.entries(drone)) add(item, rate);
  // Vehicle fuel for the factory-group links (#206), where this phase can make it.
  const transport: ItemRates = {};
  for (const [item, rate] of Object.entries(
    config.transportFuel?.[String(phase) as StageKey] || {},
  ))
    if (reachable.has(item)) {
      transport[item] = rate;
      add(item, rate);
    }
  if (phase === 5 && config.cellsPerMinute) add('Singularity Cell', config.cellsPerMinute);
  // Each fueled augmenter needs 5 Alien Power Matrix/min. The rate is derived from the augmenter
  // count rather than entered, so the fuel line can never disagree with the augmenters it feeds.
  const matrix = phase === 5 ? 5 * config.fueledAugmenters : 0;
  if (matrix) add('Alien Power Matrix', matrix);
  return { demand, storage, delivery, drone, transport, matrix };
}
// Protected storage: solid, sinkable, non-radioactive reachable items the storage mode covers,
// each at its rate from storageRateFor (per-item override, elevator parts 0, build rate, general
// rate). A rate of 0 keeps the item's container but reserves nothing.
function storageDemand(config: CurrentSettings, reachable: Set<string>): ItemRates {
  const storage: ItemRates = {};
  for (const item of reachable)
    if (
      !RAW.includes(item) &&
      !DATA.items[item]?.fluid &&
      !DATA.items[item]?.radioactive &&
      (DATA.items[item]?.sink || 0) > 0 &&
      wantsStorage(item, config.storage)
    )
      storage[item] = storageRateFor(config, item);
  return storage;
}
// The hours a goal spreads the phase's deliveries over (deliveryDemand).
export const goalHours = (config: CurrentSettings) =>
  config.goal === 'minimal' ? 24 : config.goal === 'balanced' ? 8 : config.hours;
// Elevator deliveries: the phase's parts spread over its hours (24 for 'minimal', 8 for
// 'balanced', the profile's own for 'timed'). `roundRates` rounds to readable belt rates: to
// tens from 100/min, whole numbers from 10/min, and up to a tenth below that. Rounding to the
// nearest can round a rate down, so `hours` is recomputed from the rates in readStage.
function deliveryDemand({ config, phase }: PhaseContext): Record<string, StageDelivery> {
  const delivery: Record<string, StageDelivery> = {};
  const hours = goalHours(config);
  for (const [item, amount] of Object.entries(DELIVERIES[phase]!)) {
    let rate = (amount * config.multiplier) / (hours * 60);
    if (config.roundRates)
      rate =
        rate >= 100
          ? Math.round(rate / 10) * 10
          : rate >= 10
            ? Math.round(rate)
            : Math.ceil(rate * 10) / 10;
    delivery[item] = { target: Math.ceil(amount * config.multiplier), rate };
  }
  return delivery;
}
// A 20% planning allowance covers unmodelled mining, pumps and logistics; existing power is spare capacity.
// Alien Power Augmenters generate 500 MW each and multiply the grid's base production:
// (generators + 500 x augmenters) x (1 + 0.1 x unfueled + 0.3 x fueled). The multiplier applies to
// installed capacity, of which the entered spare power is only a part, so both are needed here.
function phasePower(config: CurrentSettings, phase: number): PhasePower {
  const utilityFactor = 1 + (config.utilityPercent ?? 20) / 100;
  const augmenters = phase === 5 ? config.augmenters : 0,
    fueled = phase === 5 ? config.fueledAugmenters : 0;
  const boost = 0.1 * (augmenters - fueled) + 0.3 * fueled,
    installedMW = config.installedPowerGW * 1000;
  const spareMW =
    config.availablePowerGW * 1000 + (installedMW + 500 * augmenters) * (1 + boost) - installedMW;
  return { utilityFactor, augmenters, fueled, boost, spareMW };
}
// The phase's LP (or MIP), in the order its constraints and variables are added: item balances,
// power, recipe variables with the somersloop budget and caps, raw resources, existing supply,
// the plutonium sink, the goal, then whole nuclear plants. The solver's result can depend on
// that order, so keep it. `period` is the nuclear rounding (see roundNuclear).
export function buildModel(
  context: PhaseContext,
  pool: PoolRecipe[],
  demands: PhaseDemands,
): { model: LpModel; period: number } {
  const allItems = new Set(
    pool.flatMap(recipe => [...Object.keys(recipe.inputs), ...Object.keys(recipe.outputs)]),
  );
  Object.keys(demands.demand).forEach(item => allItems.add(item));
  // The objective. Normally minimise `cost`: one per machine-equivalent, plus a tiny power term
  // that breaks ties towards lower consumption. Under `maximum`, maximise `gain`, the goal
  // variable's level, then re-solve for cost (see solveModel).
  const model: LpModel = {
    optimize: context.maximum ? 'gain' : 'cost',
    opType: context.maximum ? 'max' : 'min',
    constraints: {},
    variables: {},
  };
  addBalances(model, allItems, demands.demand);
  // The groups' own balances of the items they make on site (#875), after the central ones.
  const sites = siteRoutes(context.config, context.phase, pool);
  for (const balance of sites.balances)
    model.constraints[balance.name] = exactBalance(balance.item) ? { equal: 0 } : { min: 0 };
  addPower(model, context);
  addRecipes(model, context, pool, sites.routes);
  addSources(model, context, allItems, demands.delivery);
  const period = roundNuclear(model, context, pool, demands.demand);
  return { model, period };
}
// One balance constraint per item, 'item:<name>': production minus consumption (including the
// raw, supply and goal variables) must be at least the item's demand. Solids may overshoot;
// the excess is surplus bound for the sink, which is what lets whole machines round up.
// An item the AWESOME Sink cannot accept has nowhere to overflow: Power Shards would back a
// Synthetic Power Shard line up and stall it. Balance those exactly, as fluids and waste are.
function addBalances(model: LpModel, allItems: Set<string>, demand: ItemRates) {
  for (const item of allItems)
    model.constraints['item:' + item] = exactBalance(item)
      ? { equal: demand[item] || 0 }
      : { min: demand[item] || 0 };
}
// Whether an item balances exactly rather than overflowing to the sink (addBalances).
const exactBalance = (item: string) =>
  !!DATA.items[item]?.fluid ||
  !!DATA.items[item]?.radioactive ||
  item.endsWith('Waste') ||
  !((DATA.items[item]?.sink ?? 0) > 0);
// The power constraint, in MW: consumption (x powerFactor x utility allowance) minus new
// generation (x augmenter boost) may not exceed the spare figure. Phase 1 normally has no power
// constraint (its power is hand-fed biomass). A maximising solve of Phase 1 has it too: there are
// no generators, so only the entered spare power can run that phase harder. calculate() never
// maximises Phase 1 for maximum output; only the `phaseTime: 'final'` re-solve does.
function addPower(model: LpModel, { phase, maximum, power }: PhaseContext) {
  if (phase >= 2 || maximum) model.constraints.power = { max: power.spareMW };
}
// One variable per recipe: its level is machine-equivalents at 100% clock (see
// recipeCoefficients). Then the somersloop budget and, for phaseTime 'final', the caps.
function addRecipes(model: LpModel, context: PhaseContext, pool: PoolRecipe[], routes: Routes) {
  const { config, caps, baseline } = context;
  for (const recipe of pool) {
    const coefficients = recipeCoefficients(recipe, context, routes);
    // At least the requested number of uranium plants (settings.uraniumReactors) when nuclear
    // power is in the pool. Whole machines round them in roundNuclear.
    if (recipe.id === 'power-uranium') {
      coefficients.nuclear = 1;
      model.constraints.nuclear = { min: config.uraniumReactors };
    }
    model.variables[recipe.id] = coefficients;
    // Amplified twins: integer machine counts, each using `slots` somersloops of the budget.
    if (recipe.slots) {
      (model.ints ??= {})[recipe.id] = 1;
      coefficients.sloops = recipe.slots;
      // One amplified machine does the work of two, so a line never wants more than half its
      // unamplified count, and the whole budget cannot buy more than it can pay slots for.
      const need = baseline?.[recipe.id.slice(4)];
      (model.bounds ??= {})[recipe.id] = Math.max(
        1,
        Math.min(
          Math.floor(config.amplifySloops / recipe.slots),
          need === undefined ? 1e9 : Math.ceil(need / 2) + 1,
        ),
      );
    }
    if (config.wholeMachines && roundsToWholeMachines(recipe)) (model.ints ??= {})[recipe.id] = 1;
  }
  // The somersloop budget: amplified machines may together fill no more slots than
  // `amplifySloops`, per phase.
  if (config.amplifySloops > 0) model.constraints.sloops = { max: config.amplifySloops };
  // Caps, for phaseTime 'final': an earlier phase may run no more of a recipe than a later phase
  // already builds, so nothing is added that the plan later drops. Each recipe's equivalent is at
  // most the whole machines built for it in this or a later phase. Every pool recipe gets a cap,
  // so a recipe no such phase uses is capped at 0 — including generators.
  if (caps)
    for (const recipe of pool) {
      const cap = caps[recipe.id] ?? 0;
      model.constraints['cap:' + recipe.id] = { max: cap };
      model.variables[recipe.id]!['cap:' + recipe.id] = 1;
    }
}
// A recipe variable's coefficients: its cost, its power, and its per-machine outputs (+) and
// inputs (-) in each item balance: the central one, or split with the groups' own balances of the
// items they make on site (`routes`, siteRoutes in on-site.ts).
function recipeCoefficients(recipe: PoolRecipe, { config, power }: PhaseContext, routes: Routes) {
  const coefficients: Record<string, number> = {
    cost: 1 + (recipe.power > 0 ? recipe.power / 100000 : 0),
    power:
      recipe.power < 0
        ? recipe.power * (1 + power.boost)
        : recipe.power * config.powerFactor * power.utilityFactor,
  };
  for (const [item, rate] of Object.entries(recipe.outputs))
    for (const [balance, part] of routes(recipe, item, 'out'))
      coefficients[balance] = (coefficients[balance] || 0) + rate * part;
  for (const [item, rate] of Object.entries(recipe.inputs))
    for (const [balance, part] of routes(recipe, item, 'in'))
      coefficients[balance] = (coefficients[balance] || 0) - rate * part;
  return coefficients;
}
// Whole-machine rounding: with `wholeMachines`, a recipe is an integer variable when it makes
// a solid, sinkable, non-raw item, so its overshoot can go to the sink. Fluid-only recipes,
// generators and anything nuclear keep fractional clocks, because their balances are exact.
// (Generators have no outputs, and power-uranium outputs waste.) The uranium plants are
// rounded separately, in roundNuclear.
export const roundsToWholeMachines = (recipe: PoolRecipe) =>
  Object.keys(recipe.outputs).some(
    item => !DATA.items[item]?.fluid && !RAW.includes(item) && (DATA.items[item]?.sink ?? 0) > 0,
  ) &&
  !/uranium|plutonium|ficsonium|waste|non-fissile/i.test(
    [recipe.name, ...Object.keys(recipe.inputs), ...Object.keys(recipe.outputs)].join(' '),
  );
// The sources that feed the item balances besides the recipes, and the goal that draws on them.
function addSources(
  model: LpModel,
  { config, phase, maximum, ignoreLimits }: PhaseContext,
  allItems: Set<string>,
  delivery: Record<string, StageDelivery>,
) {
  // Raw resources: a 'raw:' source variable per extracted item the pool uses, capped by its
  // budget ('limit:') and almost free, so extraction is spent only where it saves machines.
  // Diagnostics use the highest budget the settings accept; larger bounds destabilize the WASM MIP solver.
  for (const item of RAW) {
    if (!allItems.has(item)) continue;
    model.constraints['limit:' + item] = { max: ignoreLimits ? 1e7 : config.limits[item] };
    model.variables['raw:' + item] = { cost: 0.0001, ['item:' + item]: 1, ['limit:' + item]: 1 };
  }
  // A line you already run is a capped, almost-free source of its product, so the
  // plan builds only the remainder and drops the whole chain behind what you
  // already make. Almost free rather than free: the solver still prefers not to
  // draw supply it has no use for. An item this phase neither makes nor consumes
  // is skipped, because crediting it would mean nothing.
  for (const [item, rate] of Object.entries(config.existingSupply)) {
    if (!allItems.has(item)) continue;
    model.constraints['supply:' + item] = { max: rate };
    model.variables['supply:' + item] = {
      cost: 0.0001,
      ['item:' + item]: 1,
      ['supply:' + item]: 1,
    };
  }
  // Uranium waste must balance exactly, and the 'sink' strategy (and Phase 4 under 'recycle',
  // before plutonium plants exist) ends the waste chain at Plutonium Fuel Rods: this variable
  // disposes of them in the AWESOME Sink. Reported as `plutoniumSink` (rods per minute).
  if (config.nuclear !== 'none' && phase >= 4 && (config.nuclear === 'sink' || phase === 4))
    model.variables['sink-plutonium'] = { cost: 0.0001, 'item:Plutonium Fuel Rod': -1 };
  // Maximum output: the goal variable consumes every delivery part in proportion to its target,
  // at target/1000 per minute per unit of goal, so maximising it maximises the rate at which the
  // whole phase completes together (hours = 1000 / (60 x goal)).
  if (maximum) {
    const goal: Record<string, number> = { gain: 1 };
    for (const [item, part] of Object.entries(delivery)) goal['item:' + item] = -part.target / 1000;
    model.variables.goal = goal;
  }
}
// Whole nuclear plants (#370). Every line downstream of the uranium plants is linear in their
// count, so rounding that count is enough. In Phase 5 under 'recycle' the count is a whole
// multiple of the chain's period (nuclearPeriod), which makes the whole waste chain, plutonium
// and ficsonium plants included, whole machines at 100%: 'nuclear-block' is the number of
// periods. Elsewhere ('sink', and Phase 4 under 'recycle', whose chain ends in the sink) the
// uranium plants are simply whole. Extra plants only add generation, which the power constraint
// allows. The fuel feed stays fractional: its items are radioactive and balance exactly.
// `fractionalNuclear` is the two-step fit's fallback when this does not fit the budgets.
// Returns the period: 0 when the plants stay fractional (or are not in the pool), 1 when they
// are simply whole.
function roundNuclear(
  model: LpModel,
  { config, phase, fractionalNuclear }: PhaseContext,
  pool: PoolRecipe[],
  demand: ItemRates,
): number {
  const uraniumPlants = model.variables['power-uranium'];
  const period =
    config.wholeMachines && !fractionalNuclear && uraniumPlants
      ? config.nuclear === 'recycle' && phase === 5
        ? nuclearPeriod(pool, demand)
        : 1
      : 0;
  if (period > 1 && uraniumPlants) {
    uraniumPlants.nuclearBlock = 1;
    model.variables['nuclear-block'] = { nuclearBlock: -period };
    model.constraints.nuclearBlock = { equal: 0 };
    (model.ints ??= {})['nuclear-block'] = 1;
  } else if (period === 1) (model.ints ??= {})['power-uranium'] = 1;
  return period;
}
// Solve. Under `maximum`, a second solve fixes the goal at its optimum (less a hair for
// numerical slack) and minimises machines, so the fastest plan is also the leanest one.
function solveModel(model: LpModel, maximum: boolean): Solution {
  const solved = solve(model);
  if (!maximum || !solved.feasible) return solved;
  model.constraints.keepGoal = { min: solved.values.goal! * (1 - 1e-8) };
  model.variables.goal!.keepGoal = 1;
  model.optimize = 'cost';
  model.opType = 'min';
  const economical = solve(model);
  return economical.feasible ? economical : solved;
}
// Independently verify material, power and mining constraints before trusting a result.
export function satisfiesModel(model: LpModel, solved: Solution): boolean {
  for (const [constraint, bound] of Object.entries(model.constraints)) {
    let total = 0;
    for (const [variable, coefficients] of Object.entries(model.variables))
      total += (solved.values[variable] || 0) * (coefficients[constraint] || 0);
    const tolerance = 0.002 + Math.abs(total) * 1e-6;
    if (
      (bound.min !== undefined && total < bound.min - tolerance) ||
      (bound.max !== undefined && total > bound.max + tolerance) ||
      (bound.equal !== undefined && Math.abs(total - bound.equal) > tolerance)
    )
      return false;
  }
  return true;
}
