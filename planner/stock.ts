// Protected storage fed from surplus first (#1061, the owner's rule there). Under whole machines a
// storage demand used to be part of the phase's solve, so every stored item no other line made got
// a whole machine at 100% for 1/min of storage, and sank the rest (Concrete 15/min for 1/min, a
// Packager filling 40 Fuel/min into canisters for 1/min, its chain behind it at full speed too).
// Now the phase is planned without storage (phaseDemands in model.ts), and withStock adds it after:
//   1. an item the plan already makes more of than it uses takes its rate from that surplus, with
//      no extra machine (at most the rate; the rest still goes to the AWESOME Sink, which in game
//      is a Priority Merger or an overflow splitter after the container);
//   2. only an item with no surplus at all gets storage-only lines (and an item with a rate of its
//      own, storageOverrides, what its surplus leaves of that rate), `<recipe>:stock` rows with
//      `stock`, solved as a small linear program at exact clocks (one underclocked machine for a
//      trickle), fed by the plan's remaining surplus, the raw budgets it leaves and its spare power.
// Those lines are optional and come last in the build order: nothing else in the plan uses them.
// What storage receives is the stage's `storage` (so the Logistics books balance), and what the
// settings ask is `storageAsked`. A plan without whole machines, or without `storageFromSurplus`
// (every plan stored before #1061, and a calculation that does not ask for it), plans storage as a
// demand of the solve, exactly as before.
import { extractionMWPerUnit } from '../public/preferences.ts';
import { extractionEquipment, lineLoad } from '../public/power.ts';
import type { CalcRow, CurrentSettings, ItemRates } from '../public/types/index.ts';
import { solve, type LpModel, type LpSolution } from '../optimizer.ts';
import type { PoolRecipe, Solved } from './types.ts';
import { RAW, exactBalance } from './data.ts';
import { generators, recipePool } from './recipes.ts';
import {
  phaseBudget,
  phaseContext,
  reachableItems,
  satisfiesModel,
  stockedFromSurplus,
  storageDemand,
  type PhaseContext,
} from './model.ts';
import { buildOrder, stagePower, stageRows, stageSurplus } from './stage.ts';

// The id suffix of a storage-only line: '<recipe>:stock' (safeKey allows ':', as for a group's
// own line, '<recipe>:<group>'; group ids start with 'fg-', so they cannot clash).
export const STOCK_SUFFIX = ':stock';
// What filling a container completely is worth against the machines its lines cost: far more, so
// storage is filled whenever the budgets and the spare power allow.
const FILL_WORTH = 1000;
// Below this, per minute, an item has no surplus (the surplus leaves out less, stageSurplus).
const STOCK_DUST = 0.002;
// The prefix of the variable that burns more fuel in one of the plan's generator lines.
const MORE = 'more:';

// The stage with protected storage fed from its surplus first, and storage-only lines for what no
// surplus covers (see the header). Only a whole-machine plan's feasible stage changes.
export function withStock(config: CurrentSettings, phase: number, stage: Solved): Solved {
  if (!stockedFromSurplus(config)) return stage;
  const context = phaseContext(config, phase, {});
  const pool = recipePool(config, phase, false);
  const asked = storageDemand(config, reachableItems(context, pool));
  // Generators too, so lines the spare power cannot run get their own (never a nuclear plant).
  const powered = [
    ...pool,
    ...generators(config, phase).filter(recipe => recipe.machine !== 'Nuclear Power Plant'),
  ];
  if (!Object.keys(asked).length) return stage;
  const fromSurplus: ItemRates = {},
    missing: ItemRates = {};
  for (const [item, rate] of Object.entries(asked)) {
    if (!(rate > 0)) continue;
    const spare = stage.surplus[item] || 0;
    if (spare > STOCK_DUST) fromSurplus[item] = Math.min(rate, spare);
    // A rate set for the item itself (storageOverrides, such as the guided start's 20 Concrete/min)
    // is a guarantee: what the surplus leaves of it is topped up by storage-only lines.
    const topUp = config.storageOverrides?.[item] !== undefined;
    if (spare <= STOCK_DUST) missing[item] = rate;
    else if (topUp && rate - spare > STOCK_DUST) missing[item] = rate - spare;
  }
  const lines = stockLines(config, phase, stage, powered, fromSurplus, missing);
  const storage: ItemRates = Object.fromEntries(
    Object.keys(asked).map(item => [item, (fromSurplus[item] ?? 0) + (lines.stored[item] ?? 0)]),
  );
  const rows = [
    ...stage.rows.map(row => lines.generators[row.id] ?? row),
    ...buildOrder(lines.rows),
  ];
  const raw = { ...stage.raw };
  for (const [item, rate] of Object.entries(lines.raw)) raw[item] = (raw[item] || 0) + rate;
  const supplied = { ...stage.supplied };
  for (const [item, rate] of Object.entries(lines.supplied))
    supplied[item] = (supplied[item] || 0) + rate;
  const surplus = stageSurplus(context, rows, {
    storage,
    delivery: stage.delivery,
    drone: stage.drone,
    matrix: stage.matrixRate,
  });
  return {
    ...stage,
    rows,
    raw,
    supplied,
    storage,
    storageAsked: asked,
    surplus,
    ...stagePower(context, rows, raw),
  };
}

// The storage-only lines for the items with no surplus (`missing`): a linear program over the
// phase's recipes at exact clocks that fills each container as far as it can, then with the
// fewest machines. Its sources are the stage's surplus beyond what storage takes of it, the raw
// budgets and existing supply the stage leaves, and from Phase 2 the power its generators leave,
// with generator lines of their own where that is not enough (Phase 1 runs on hand-fed biomass,
// as in the solve). Returns the rows, the plan's generator lines that burn more fuel for them, what
// each container gets and what the lines draw.
function stockLines(
  config: CurrentSettings,
  phase: number,
  stage: Solved,
  pool: PoolRecipe[],
  fromSurplus: ItemRates,
  missing: ItemRates,
) {
  const none = {
    rows: [] as CalcRow[],
    generators: {} as Record<string, CalcRow>,
    stored: {} as ItemRates,
    raw: {} as ItemRates,
    supplied: {} as ItemRates,
  };
  if (!Object.keys(missing).length) return none;
  const recipes: PoolRecipe[] = pool.map(recipe => ({
    ...recipe,
    id: recipe.id + STOCK_SUFFIX,
    stock: { recipe: recipe.id },
  }));
  const solveWith = (creditMW: number) => {
    const model = stockModel(config, phase, stage, recipes, fromSurplus, missing, creditMW);
    const result = solve(model);
    return result.feasible && satisfiesModel(model, result) ? result : null;
  };
  const solved = creditedSolve(solveWith, {
    filled: result =>
      Object.keys(missing).reduce(
        (total, item) => total + (result.values['store:' + item] || 0),
        0,
      ),
    credit: result => underclockCredit(config, phase, stageRows(config, recipes, result)),
  });
  if (!solved) return none;
  const value = (name: string) => solved.values[name] || 0;
  const pick = (prefix: string, items: string[]) =>
    Object.fromEntries(
      items
        .map((item): [string, number] => [item, value(prefix + item)])
        .filter(([, rate]) => rate > 1e-6),
    );
  return {
    rows: stageRows(config, recipes, solved),
    // The plan's generator lines with the fuel they burn for the storage-only lines added.
    generators: Object.fromEntries(
      stage.rows
        .filter(row => value(MORE + row.id) > 1e-6)
        .map((row): [string, CalcRow] => [row.id, burning(row, value(MORE + row.id))]),
    ),
    stored: pick('store:', Object.keys(missing)),
    raw: pick('raw:', RAW),
    supplied: pick('supply:', Object.keys(config.existingSupply)),
  };
}

// The model charges each line its linear power, but an underclocked machine draws less, and
// generators burn fuel only for what is drawn: so the lines are solved again with the power
// constraint credited with that difference (`credit`), and the fuel follows the need (as
// withinLoad does, #1086). A credited plan stands when it fills the containers as far as the first
// (`filled`) and its own lines draw at least that much less, so its fuel covers its need; at most
// three rounds, as withinLoad. Returns the first plan otherwise, and null when that fails.
function creditedSolve(
  solveWith: (creditMW: number) => LpSolution | null,
  measure: { filled: (result: LpSolution) => number; credit: (result: LpSolution) => number },
): LpSolution | null {
  const first = solveWith(0);
  if (!first) return null;
  let credit = measure.credit(first);
  for (let round = 0; round < 3 && credit > 0.01; round++) {
    const next = solveWith(credit);
    if (!next || measure.filled(next) < measure.filled(first) - 1e-6) break;
    const own = measure.credit(next);
    if (own >= credit - 1e-6) return next;
    credit = own;
  }
  return first;
}

// What `rows` draw less than their linear power in the power constraint's terms, in MW: each
// line's last machine runs at its clock's power (lineLoad, CLOCK_EXPONENT), not in proportion.
function underclockCredit(config: CurrentSettings, phase: number, rows: CalcRow[]): number {
  const { power } = phaseContext(config, phase, {});
  return rows.reduce((total, row) => {
    if (!(row.power > 0)) return total;
    const linear = row.power * row.equivalent;
    return total + (linear - lineLoad(row).peak) * config.powerFactor * power.utilityFactor;
  }, 0);
}

// Generator line `row` burning `more` machine-equivalents more fuel, within its whole generators.
function burning(row: CalcRow, more: number): CalcRow {
  const equivalent = row.equivalent + more,
    scale = equivalent / row.equivalent;
  return {
    ...row,
    equivalent,
    inputs: Object.fromEntries(
      Object.entries(row.inputs).map(([item, rate]) => [item, rate * scale]),
    ),
    generationMW: -row.power * equivalent,
  };
}

// stockLines' model. Each item balance is 'item:<name>' as in the phase's model (exact for fluids
// and other items the sink cannot take, so no fluid is made beyond what the lines use).
function stockModel(
  config: CurrentSettings,
  phase: number,
  stage: Solved,
  recipes: PoolRecipe[],
  fromSurplus: ItemRates,
  missing: ItemRates,
  creditMW: number,
): LpModel {
  const model: LpModel = {
    optimize: 'cost',
    opType: 'min',
    constraints: {},
    variables: {},
    bounds: {},
  };
  const context = phaseContext(config, phase, {});
  const { boost, utilityFactor } = context.power;
  const balance = (item: string) =>
    (model.constraints['item:' + item] ??= exactBalance(item) ? { equal: 0 } : { min: 0 });
  if (phase >= 2) addStockPower(model, stage, boost, creditMW, balance);
  for (const recipe of recipes) {
    const coefficients: Record<string, number> = {
      cost: 1 + (recipe.power > 0 ? recipe.power / 100000 : 0),
      power:
        recipe.power < 0
          ? recipe.power * (1 + boost)
          : recipe.power * config.powerFactor * utilityFactor,
    };
    for (const [item, rate] of Object.entries(recipe.outputs)) {
      balance(item);
      coefficients['item:' + item] = (coefficients['item:' + item] || 0) + rate;
    }
    for (const [item, rate] of Object.entries(recipe.inputs)) {
      balance(item);
      coefficients['item:' + item] = (coefficients['item:' + item] || 0) - rate;
    }
    model.variables[recipe.id] = coefficients;
  }
  addStockSources(model, context, stage, fromSurplus);
  // Each container with no surplus: up to its rate, worth FILL_WORTH when full.
  for (const [item, rate] of Object.entries(missing)) {
    balance(item);
    model.variables['store:' + item] = { cost: -FILL_WORTH / rate, ['item:' + item]: -1 };
    model.bounds!['store:' + item] = rate;
  }
  return model;
}

// From Phase 2 every MW the storage-only lines draw needs fuel: the power the plan's burnt fuel,
// spare power and augmenters give beyond its need is free (plus `creditMW`, see stockLines); past
// that, the plan's generators burn more fuel up to their whole count ('more:<row id>'), then
// generator lines of their own (#1086: a plan's fuel covers its need). Phase 1 runs on hand-fed
// biomass, as in the solve, so stockModel adds no power constraint there.
function addStockPower(
  model: LpModel,
  stage: Solved,
  boost: number,
  creditMW: number,
  balance: (item: string) => unknown,
) {
  const burntMW = stage.rows.reduce((total, row) => total + row.generationMW, 0) * (1 + boost);
  const { spareMW, augmenterMW, needMW } = stage.grid;
  model.constraints.power = {
    max: Math.max(0, spareMW + augmenterMW + burntMW - needMW) + creditMW,
  };
  for (const row of stage.rows) {
    const room = row.machines - row.equivalent;
    if (!(row.power < 0) || row.machine === 'Nuclear Power Plant' || room <= 1e-6) continue;
    const coefficients: Record<string, number> = { cost: 0, power: row.power * (1 + boost) };
    for (const [item, rate] of Object.entries(row.inputs)) {
      balance(item);
      coefficients['item:' + item] = -rate / row.equivalent;
    }
    model.variables[MORE + row.id] = coefficients;
    model.bounds![MORE + row.id] = room;
  }
}

// What the storage-only lines may draw on, almost free, for the items their balances have: the
// plan's surplus beyond what storage takes of it, the raw budgets it leaves (with their extraction
// power) and the existing supply it leaves. With mining per phase (#1065), the budgets are the
// phase's and the extraction power its miner's.
function addStockSources(
  model: LpModel,
  context: Pick<PhaseContext, 'config' | 'mining'>,
  stage: Solved,
  fromSurplus: ItemRates,
) {
  const source = (name: string, item: string, left: number, extra: Record<string, number> = {}) => {
    if (left <= STOCK_DUST || !model.constraints['item:' + item]) return;
    model.variables[name] = { cost: 0.0001, ['item:' + item]: 1, ...extra };
    model.bounds![name] = left;
  };
  for (const [item, rate] of Object.entries(stage.surplus))
    source('spare:' + item, item, rate - (fromSurplus[item] || 0));
  const { config, mining } = context;
  const equipment = mining ? { ...mining.miner } : extractionEquipment(config);
  for (const item of RAW)
    source('raw:' + item, item, (phaseBudget(context, item) ?? 0) - (stage.raw[item] || 0), {
      power: extractionMWPerUnit(item, equipment) * config.powerFactor,
    });
  for (const [item, rate] of Object.entries(config.existingSupply))
    source('supply:' + item, item, rate - (stage.supplied[item] || 0));
}
