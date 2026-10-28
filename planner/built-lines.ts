// The production lines that already stand (#1176, settings.builtLines) in one phase's linear
// program: their variables and credits (addBuiltLines), and the follow-up solves that keep them
// (capBuiltRaw, keepBuilt), which buildModel and solveModel in model.ts call. model.ts
// re-exports KEEP_SHARE.
import { solve, type LpModel } from '../optimizer.ts';
import { objectiveWeights } from '../public/preferences.ts';
import type { CurrentSettings, StageKey } from '../public/types/index.ts';
import type { PoolRecipe } from './types.ts';
import { RAW } from './data.ts';
import { primaryOutput } from './recipes.ts';
import { BUILT } from './stage.ts';
import { satisfiesModel, setObjective, sourceCost } from './model.ts';
import type { PhaseContext, Solution } from './model.ts';
// Production lines that already stand (#1176, settings.builtLines): each pool recipe with machines
// built on its line in this phase gets a second variable, 'built:<recipe id>', with every
// coefficient of the recipe's own (its items, power, somersloops, caps, floors, whole machines)
// but held to at most the machines that stand (the 'built:<recipe id>' constraint) and costing
// KEEP_SHARE of what the recipe's own variable costs. So what they make is credited, the ore and
// power they draw still count against the budgets (they are already spent there), and the solve
// adds machines to a built line, or switches it, only where that pays. readStage folds the two
// variables into one row (foldBuilt in stage.ts). In a solve without a built amplified line's
// twin (the exact step of the two-step fit, or a fit without amplification), that line counts as
// twice its machines of the recipe, since one amplified machine makes what two do; the fit then
// offers the twin (phasePool), so the somersloops stay on the line they are in.
//
// KEEP_SHARE is the threshold of "keep the built recipe if switching saves little" (#1175): at a
// tenth of a new machine, switching a built line to another recipe (or moving its somersloops)
// must save more new machines elsewhere than the switch builds, less a tenth of those standing;
// machines that stand elsewhere count a tenth too, so a built chain is never redesigned to save
// a few buildings. It stays above 0, so a built machine the new plan has no use for is not run
// for nothing: the line shrinks, and its step says which machines are spare. Only the share of
// the built lines the plan uses costs KEEP_SHARE, under every objective (creditSpentShare,
// creditUsedShare), so a spare built machine is not run for its byproducts either.
export const KEEP_SHARE = 0.1;
export function addBuiltLines(model: LpModel, { config, phase }: PhaseContext, pool: PoolRecipe[]) {
  const lines = config.builtLines?.[String(phase) as StageKey];
  if (!lines) return;
  const ids = new Set(pool.map(recipe => recipe.id));
  const built: PoolRecipe[] = [];
  for (const recipe of pool) {
    const twin = 'amp:' + recipe.id;
    const count =
      (lines[recipe.id] ?? 0) + (recipe.slots || ids.has(twin) ? 0 : 2 * (lines[twin] ?? 0));
    const own = model.variables[recipe.id];
    if (!own || !(count >= 1)) continue;
    const name = BUILT + recipe.id;
    model.variables[name] = { ...own, cost: (own.cost ?? 0) * KEEP_SHARE, [name]: 1 };
    model.constraints[name] = { max: count };
    if (model.ints?.[recipe.id]) model.ints[name] = 1;
    built.push(recipe);
  }
  if (buildingsWeigh(config)) creditUsedShare(model, config, built);
  else creditSpentShare(model, config, built);
}
// Whether buildings carry weight in the plan's objective: the fewest buildings, or a weighted mix
// whose buildings weight is above 0. There KEEP_SHARE's discount on a built machine could buy the
// plan what no new machine would be built for (creditUsedShare, and the raw rule in capBuiltRaw).
export const buildingsWeigh = (config: CurrentSettings) => {
  const weights = objectiveWeights(config.objective);
  return !weights || weights.buildings > 0;
};
// What a built line draws outside its own variable (#1188). Under a chosen objective (#1180) a
// line's own variable holds only part of what it costs: its buildings and its own power, which
// KEEP_SHARE discounts. The rest is priced elsewhere: the raw resources it draws on the raw
// sources (their raw weight and their extraction power), and the power it draws on the
// generators and the fuel lines behind them (the fuel's raw resources under a raw weight, the
// fuel lines' own power under a power weight). #1172 says the ore and power of built lines are
// already spent, so that share counts at KEEP_SHARE too: each built machine is credited
// (1 - KEEP_SHARE) of it, its direct raw inputs at their sources' cost (sourceCost without its
// tiny base, plus their extraction power) and its power at what one more MW costs this phase, the
// power row's shadow price in a linear solve of the model as it stands. Without it, under the raw
// objective a switch to a line that draws a little less power (a few machines fewer, burning a
// little less Crude Oil) outweighed keeping a built line, since a machine there costs only
// TIE_BUILDING. A switch still wins where it saves more than it builds and a tenth of the built
// line's share, as under the fewest buildings. The fewest-buildings objective (no field) gets no
// such credit: there the outside share is the generators' and fuel lines' buildings, a few
// hundredths of a machine per built machine. It caps its share as creditUsedShare says, and so
// does a weighted mix whose buildings weigh (#1198), with this outside credit added; this function
// prices the objectives whose buildings weigh nothing (least power, least raw resources).
//
// The credit goes only to the share of the built lines the plan uses (#1190's review). Credited
// on every machine that stands, a built machine the plan does not need could pay for itself by
// its byproducts: with 9 Plastic Refineries built where 3 are needed and nine tenths of their
// Crude Oil credited, the Heavy Oil Residue of all 9 became fuel and the Plastic of 6 was sunk.
// So the credit is its own variable per built line, 'spent:<recipe id>', at most the line's
// running machines (its 'spent:<recipe id>' row), and the built lines that make an item as their
// main product (primaryOutput) are credited together for no more of it than that same linear
// solve uses ('spentUse:<item>'): what its lines and the goal consume and the phase's demand,
// not what overflows to the sink. Beyond that a built machine costs what it did before #1188,
// KEEP_SHARE of a new one with its ore and power in full, so the plan still has no reason to
// run it. A line whose product the kept lines need more of (Iron Rods for kept Screws) is
// credited only for what the solve without the credit used; the rest of it still counts as a
// built machine at KEEP_SHARE, and the issue's Screws and Iron Rods stay under every objective.
const SPENT = 'spent:';
const SPENT_USE = 'spentUse:';
function creditSpentShare(model: LpModel, config: CurrentSettings, built: PoolRecipe[]) {
  if (!built.length) return;
  const linear = relaxed(model);
  const priced = solve(linear, { duals: true });
  const outside = outsideCost(model, config, priced);
  for (const recipe of built) {
    const name = BUILT + recipe.id;
    const variable = model.variables[name]!;
    const credit = (1 - KEEP_SHARE) * outside(recipe);
    if (!(credit > 0)) continue;
    const main = primaryOutput(recipe);
    const made = main === undefined ? 0 : itemTotal(variable, main);
    // A generator makes no item: its fuel is all it draws, so its credit is less than what
    // running it costs and it never pays for itself.
    if (!(made > 0)) {
      variable.cost = (variable.cost ?? 0) - credit;
      continue;
    }
    addCredit(model, recipe, credit, made, () => itemUse(linear, priced.values, main!));
  }
}
// What one machine of a built line draws outside its own variable under a chosen objective
// (creditSpentShare, and creditUsedShare under a weighted mix): its direct raw inputs at their sources' cost (sourceCost without its tiny
// base, plus their extraction power) and its power at what one more MW costs this phase, minus the
// power row's shadow price in `priced`, a linear solve of the phase model.
function outsideCost(model: LpModel, config: CurrentSettings, priced: Solution) {
  // Drawing a MW lowers what the power row may still take, so it costs minus its shadow price.
  const perMW = Math.max(0, -(priced.duals?.power ?? 0));
  const rawPrice = (item: string) => {
    const mw = Math.max(0, model.variables['raw:' + item]?.power ?? 0);
    return sourceCost(config, item, mw, 0) + mw * perMW;
  };
  return (recipe: PoolRecipe) =>
    Object.entries(recipe.inputs)
      .filter(([item]) => RAW.includes(item))
      .reduce((sum, [item, rate]) => sum + rate * rawPrice(item), 0) +
    Math.max(0, model.variables[BUILT + recipe.id]!.power ?? 0) * perMW;
}
// The model relaxed, and always for cost: under `maximum` it may still be set to maximise its gain.
const relaxed = (model: LpModel): LpModel => ({
  ...model,
  optimize: 'cost',
  opType: 'min',
  ints: {},
});
// A built line's credit (#1190): its own variable 'spent:<recipe id>', worth `credit` a machine, at
// most the line's running machines and, with the other built lines of its main product, at most
// `use()` of it ('spentUse:<item>', the first such line sets it). `made` is what one machine makes.
function addCredit(
  model: LpModel,
  recipe: PoolRecipe,
  credit: number,
  made: number,
  use: () => number,
) {
  const name = SPENT + recipe.id,
    row = SPENT_USE + primaryOutput(recipe);
  model.constraints[row] ??= { max: use() };
  model.constraints[name] = { max: 0 };
  model.variables[BUILT + recipe.id]![name] = -1;
  model.variables[name] = { cost: -credit, [name]: 1, [row]: made };
}
// The same share under the fewest buildings (#1193). There a built machine costs KEEP_SHARE of a
// new one and its ore almost nothing, so one the plan does not need could pay for itself by its
// byproducts: with 6 Alumina Solution Refineries built where 2 are needed, the Silica of 2 more
// saved Silica Constructors, their Alumina Solution went to a new Aluminum Scrap Refinery and
// 465.6 Aluminum Scrap/min to the sink. So, as under every other objective, only the share of the
// built lines the plan uses is kept at KEEP_SHARE: each built variable costs what a new machine
// does, and its 'spent:' credit gives back (1 - KEEP_SHARE) of that for no more of its main
// product than the plan uses. What it uses is read from a linear solve in which the built lines
// cost KEEP_SHARE but make only their main product, so their byproducts cannot buy them a use:
// the built Screws are kept there (they cost a tenth of the Cast Screws), and so are the Iron Rods
// they take, so the issue's Screws and Iron Rods stay (#1187) and a clearly better switch, such as
// Steel Screws, still wins. A built machine beyond that share costs what a new one does, so the
// plan runs it only where a new machine would run too. A built generator (no main product) keeps
// KEEP_SHARE: its fuel is all it draws. Under maximum output that linear solve leaves the goal at
// nothing, so it credits little more than the phase's fixed demand, as creditSpentShare does
// there: keepBuilt keeps the built lines that plan can use (#1189), and 48 Alumina Solution
// Refineries built where 16 are needed no longer sink 5,706.8 Aluminum Scrap/min.
//
// The same holds under a weighted mix whose buildings weigh (#1198): there the line's own variable
// held its buildings at KEEP_SHARE with no cap, and only its outside share was capped
// (creditSpentShare), so with the buildings weighted 1 and power and raw 0, 6 Alumina Solution
// Refineries built where 2 are needed ran 4 and sank 465.6 Aluminum Scrap/min. There a built
// variable costs what a new machine does too, and its 'spent:' credit gives back (1 - KEEP_SHARE)
// of that and of its outside share (outsideCost, priced by this same linear solve) for the same
// used share. A built generator gets its outside credit as under creditSpentShare.
function creditUsedShare(model: LpModel, config: CurrentSettings, built: PoolRecipe[]) {
  const weighted = !!objectiveWeights(config.objective);
  const credited = built.filter(recipe => primaryOutput(recipe) !== undefined);
  if (!(weighted ? built : credited).length) return;
  const linear = relaxed(model);
  linear.variables = { ...model.variables };
  for (const recipe of credited) {
    const main = primaryOutput(recipe)!;
    const name = BUILT + recipe.id;
    linear.variables[name] = Object.fromEntries(
      Object.entries(model.variables[name]!).filter(
        ([row, coefficient]) =>
          !(coefficient > 0 && row.startsWith('item:') && !isItemRow(row, main)),
      ),
    );
  }
  const used = solve(linear, weighted ? { duals: true } : {});
  const outside = weighted ? outsideCost(model, config, used) : () => 0;
  for (const recipe of weighted ? built : credited) {
    const name = BUILT + recipe.id;
    const variable = model.variables[name]!;
    const main = primaryOutput(recipe);
    const made = main === undefined ? 0 : itemTotal(variable, main);
    if (!(made > 0)) {
      const credit = (1 - KEEP_SHARE) * outside(recipe);
      if (credit > 0) variable.cost = (variable.cost ?? 0) - credit;
      continue;
    }
    // The full cost of a new machine, KEEP_SHARE of it once credited.
    const full = model.variables[recipe.id]!.cost ?? 0;
    variable.cost = full;
    addCredit(model, recipe, (1 - KEEP_SHARE) * (full + outside(recipe)), made, () =>
      itemUse(linear, used.values, main!),
    );
  }
}
// Whether a balance row is an item's: its central one or a group's own (siteBalance in on-site.ts).
const isItemRow = (row: string, item: string) =>
  row === 'item:' + item || row.startsWith('item:' + item + '@');
// What one unit of a variable puts into an item's balances, the central one and the groups' own
// (siteBalance in on-site.ts); a route between them puts in nothing.
function itemTotal(coefficients: Record<string, number>, item: string): number {
  let total = 0;
  for (const [row, coefficient] of Object.entries(coefficients))
    if (isItemRow(row, item)) total += coefficient;
  return total;
}
// How much of an item a solution of the model uses: what its variables take from the item's
// balances (lines, generators, the goal) plus the balances' own demand, so not what overflows.
function itemUse(model: LpModel, values: Record<string, number>, item: string): number {
  let use = 0;
  for (const [name, coefficients] of Object.entries(model.variables))
    use += Math.max(0, -itemTotal(coefficients, item)) * (values[name] || 0);
  for (const [row, bound] of Object.entries(model.constraints))
    if (isItemRow(row, item)) use += bound.equal ?? bound.min ?? 0;
  return Math.max(0, use);
}
// Built lines and raw resources where buildings weigh (#1202, the owner's option C on #1172). A
// built machine counts KEEP_SHARE of a new one for the share of its main product the plan uses
// (creditUsedShare), and that share is read from a solve in which the built lines are that cheap.
// So a cheap built line can grow its own use: 9 Fuel Refineries built in Phase 5, where the plan
// with nothing built runs 3, all ran, and 13 Fuel Generators replaced 12 Rocket Fuel ones, saving
// 4 new machines for 29.6% more Crude Oil (912 to 1,183/min). The owner keeps and extends built
// factories, but watches ore closely. So a built line may run beyond the share it has in the
// plan with nothing built only while no raw resource rises more than BUILT_RAW_SHARE (5%) over
// that plan; otherwise the extra built machines stay spare. Like keepBuilt's BUILT_SPEED_SHARE, a
// cap on a follow-up solve rather than all or nothing, so one costly line does not undo the rest:
//   share  the model with every built line priced as a new machine and no credit ('spent:'), the
//          plan with nothing built. A built line kept at its share of that plan changes nothing
//          in it, so this is also the plan that keeps the built lines at that share. A built
//          amplified twin keeps its price and credit there: its somersloops stay where they are
//          (#1176), so the rule weighs the lines around them, not where the somersloops sit;
//   capped when `solved` draws more than (1 + BUILT_RAW_SHARE) times that plan of any raw
//          resource, or overflows more of an item to the sink (shareBounds), the same model again
//          held to those bounds. The share plan keeps them, so it always has a solution.
// Per raw resource rather than in total, as the owner reads it: Phase 5's Crude Oil rose 29.6%
// while its total raw rose 2.9%, behind its iron and copper. Water counts too: the share plan's
// use of it is the bound, as of any other. The rule holds wherever buildings weigh: under the
// fewest buildings, and under a weighted mix with a buildings weight, since there a built line's
// raw inputs are 90% credited as well (outsideCost), so its raw weight alone does not stop it
// (#1198: with buildings 10, power 1 and raw 1, 9 Plastic Refineries built where 2 are needed ran
// 3, and the Polymer Resin of the Fuel line that fed Residual Plastic went to the sink). The least
// power and the least raw resources leave buildings at TIE_BUILDING, so the discount buys nothing
// there; under maximum output keepBuilt's speed rule decides (#1189). A plan with nothing built,
// or whose plan keeps within the bounds, is the plan it was; should the share plan not solve, the
// phase keeps `solved`, and should the capped one not, the share plan.
const BUILT_RAW_SHARE = 0.05;
export function capBuiltRaw(model: LpModel, solved: Solution): Solution {
  if (!Object.keys(model.variables).some(name => name.startsWith(BUILT))) return solved;
  const share: LpModel = { ...model, variables: {} };
  for (const [name, coefficients] of Object.entries(model.variables))
    if (name.startsWith(BUILT + 'amp:') || name.startsWith(SPENT + 'amp:'))
      share.variables[name] = coefficients;
    else if (name.startsWith(BUILT))
      share.variables[name] = {
        ...coefficients,
        cost: model.variables[name.slice(BUILT.length)]!.cost ?? 0,
      };
    else if (!name.startsWith(SPENT)) share.variables[name] = coefficients;
  const reference = solve(share);
  if (!reference.feasible || !reference.bounded) return solved;
  const bounds = shareBounds(model, reference.values);
  const totals = boundedTotals(model, solved.values, bounds);
  if (Object.entries(bounds).every(([row, max]) => totals[row]! <= max + 1e-6)) return solved;
  const capped: LpModel = { ...model, constraints: { ...model.constraints }, variables: {} };
  for (const [row, max] of Object.entries(bounds)) capped.constraints[row] = { max };
  for (const [name, coefficients] of Object.entries(model.variables))
    capped.variables[name] = { ...coefficients, ...boundedCoefficients(name, coefficients) };
  const kept = solve(capped);
  return kept.feasible && kept.bounded && satisfiesModel(capped, kept) ? kept : reference;
}
// The bounds a built line's run beyond its share must keep (capBuiltRaw), from the share plan's
// `values`: 'builtRaw:<item>', what it mines of each raw resource, at most BUILT_RAW_SHARE more;
// and 'builtSink:<item>', each item balance that may overflow to the sink, at most what that plan
// overflows, as #1190 and #1193 hold a spare built machine to: it is never run so that something
// is sunk, its own byproducts or those of a line it leaves without a consumer. The bounds give no
// slack, since a capped solve takes all it is given; `solved` keeps within them up to the solver's
// noise (1e-6).
const BUILT_RAW = 'builtRaw:',
  BUILT_SINK = 'builtSink:';
function shareBounds(model: LpModel, values: Record<string, number>): Record<string, number> {
  const bounds: Record<string, number> = {};
  for (const [row, total] of Object.entries(boundedTotals(model, values)))
    bounds[row] = row.startsWith(BUILT_RAW) ? total * (1 + BUILT_RAW_SHARE) : total;
  return bounds;
}
// What a variable puts into the rows capBuiltRaw bounds: a raw source ('raw:<item>', or with
// mining per phase a node kind's 'raw:<item>@<kind>', addNodeKinds) into its resource's, and
// every coefficient in an item balance that may overflow (a 'min' bound, not 'equal') into its
// 'builtSink:' twin.
function boundedCoefficients(name: string, coefficients: Record<string, number>) {
  const bounded: Record<string, number> = {};
  if (name.startsWith('raw:')) bounded[BUILT_RAW + name.slice(4).split('@')[0]] = 1;
  for (const [row, coefficient] of Object.entries(coefficients))
    if (row.startsWith('item:')) bounded[BUILT_SINK + row.slice(5)] = coefficient;
  return bounded;
}
// The totals of those rows in a solution of the model (all of them, or those of `only`), leaving
// out the balances that must balance exactly, which cannot overflow.
function boundedTotals(
  model: LpModel,
  values: Record<string, number>,
  only?: Record<string, number>,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const [name, coefficients] of Object.entries(model.variables))
    for (const [row, coefficient] of Object.entries(boundedCoefficients(name, coefficients))) {
      const balance = row.startsWith(BUILT_SINK)
        ? model.constraints['item:' + row.slice(BUILT_SINK.length)]
        : undefined;
      if ((only && !(row in only)) || balance?.equal !== undefined) continue;
      totals[row] = (totals[row] ?? 0) + coefficient * (values[name] || 0);
    }
  return totals;
}
// Built lines under maximum output (#1189). The leanest of the fastest plans weighs a built line
// in machines, as every other goal does (KEEP_SHARE), but at maximum output's scale the lines
// around it are rarely where they were: the built Iron Rods that fed the issue's built Screws go
// to the plan's other uses, so keeping the Screws needs new Iron Rods, and Cast Screws saved about
// one machine of a 5,000-machine plan while being no faster at all. Maximum output asks for speed,
// so there a built line gives way only to speed. When the leanest plan runs a built line below
// what it can usefully keep (usefulBuilt), the phase is solved three more times, each step as
// linear or integer as the model is:
//   keep  the most built machines, each line at most its useful count, at no more than
//         BUILT_SPEED_SHARE slower than the fastest plan;
//   fast  the fastest plan that runs at least those machines;
//   lean  the fewest machines (the objective's cost) at that speed, as before.
// So a switch wins only when keeping the built lines would make the phase more than
// BUILT_SPEED_SHARE (1%) slower, and then only for the machines that needs. A plan with nothing
// built, or whose leanest plan already keeps every built line, is the plan it was. Should a step
// not solve, the phase keeps that leanest plan, as before.
const BUILT_SPEED_SHARE = 0.01;
export function keepBuilt(
  model: LpModel,
  pool: PoolRecipe[],
  economical: Solution,
): Solution | null {
  const caps = usefulBuilt(model, pool, economical);
  if (![...caps].some(([name, cap]) => (economical.values[name] || 0) < cap - 1e-6)) return null;
  const goalBound = model.constraints.keepGoal!,
    fastest = goalBound.min!;
  const counts = new Map([...caps.keys()].map(name => [name, model.constraints[name]!.max!]));
  // Back to the leanest plan's model, for a step that does not solve.
  const restore = () => {
    goalBound.min = fastest;
    for (const [name, count] of counts) {
      delete model.variables[name]!.keep;
      model.constraints[name] = { max: count };
    }
    setObjective(model, 'cost', 'min');
    return null;
  };
  goalBound.min = fastest * (1 - BUILT_SPEED_SHARE);
  for (const [name, cap] of caps) {
    model.variables[name]!.keep = 1;
    model.constraints[name]!.max = cap;
  }
  setObjective(model, 'keep', 'max');
  const kept = solve(model);
  if (!kept.feasible) return restore();
  for (const [name, count] of counts) {
    delete model.variables[name]!.keep;
    const level = kept.values[name] || 0;
    // The kept level, at its useful count when it reached it, so a full line stays exactly full.
    const floor = level >= caps.get(name)! - 1e-6 ? caps.get(name)! : level;
    model.constraints[name] = floor > 1e-6 ? { min: floor, max: count } : { max: count };
  }
  setObjective(model, 'gain', 'max');
  const fast = solve(model);
  if (!fast.feasible) return restore();
  goalBound.min = fast.values.goal! * (1 - 1e-8);
  setObjective(model, 'cost', 'min');
  const lean = solve(model);
  return lean.feasible ? lean : restore();
}
// What each built line can usefully keep (keepBuilt): its built count, at most what the plan
// `solved` makes of the line's product in machines of the line's recipe (whole ones for a
// whole-machine line). The product is its recipe's first output, or a generator's power. So a
// built line the plan has no use for is still not run for nothing.
function usefulBuilt(model: LpModel, pool: PoolRecipe[], solved: Solution): Map<string, number> {
  const product = (recipe: PoolRecipe): [string, number] => {
    const item = primaryOutput(recipe);
    return item ? [item, recipe.outputs[item]!] : ['', -recipe.power];
  };
  const made = new Map<string, number>();
  for (const recipe of pool) {
    const [item, rate] = product(recipe);
    const level = (solved.values[recipe.id] || 0) + (solved.values[BUILT + recipe.id] || 0);
    if (rate > 0) made.set(item, (made.get(item) ?? 0) + level * rate);
  }
  const caps = new Map<string, number>();
  for (const recipe of pool) {
    const name = BUILT + recipe.id,
      count = model.constraints[name]?.max;
    const [item, rate] = product(recipe);
    if (count === undefined || !(rate > 0)) continue;
    const useful = Math.min(count, (made.get(item) ?? 0) / rate);
    caps.set(name, model.ints?.[name] ? Math.floor(useful + 1e-6) : useful);
  }
  return caps;
}
