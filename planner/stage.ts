// A solved phase's model read back into a stage: its rows, surplus and build order.
import type { CurrentSettings, CalcRow, ItemRates, StageDelivery } from '../public/types/index.ts';
import type { LpModel } from '../optimizer.ts';
import type { PoolRecipe, Solved } from './types.ts';
import { DATA, RAW } from './data.ts';
import { extractionEquipment, stageGrid } from '../public/power.ts';
import { miningMW } from '../public/preferences.ts';
import type { PhaseContext, PhaseDemands, Solution } from './model.ts';

// Reads the solution back into a stage (see run for its fields). `model` is the model `solved`
// solves; deliverAll reads the Space Elevator parts' balances from it.
export function readStage(
  context: PhaseContext,
  pool: PoolRecipe[],
  demands: PhaseDemands,
  solved: Solution,
  period: number,
  model: LpModel,
): Solved {
  const { config, maximum, power, mining } = context;
  const { storage, delivery, drone, transport, matrix } = demands;
  const { utilityFactor, augmenters, fueled, boost, spareMW } = power;
  // Under `maximum` the delivery rates are whatever the goal achieved.
  if (maximum)
    for (const part of Object.values(delivery))
      part.rate = ((solved.values.goal || 0) * part.target) / 1000;
  deliverAll(model, solved, delivery);
  const rows = stageRows(config, pool, solved);
  const supplied = Object.fromEntries(
    Object.entries(config.existingSupply)
      .map(([item]): [string, number] => [item, solved.values['supply:' + item] || 0])
      .filter(([, rate]) => rate > 0.002),
  );
  const raw = Object.fromEntries(RAW.map(item => [item, rawDraw(solved, item)]));
  // Power totals as releases before #1064 read them: whole machines at full power against the
  // generators' fractional output, with the shortfall as additionalHeadroomMW below. The pages
  // read `grid` instead (stageGrid in public/power.ts).
  const peakMW = rows.reduce((total, row) => total + row.peakMW, 0),
    generationMW = rows.reduce((total, row) => total + row.generationMW, 0);
  const grid = stageGrid({
    rows,
    raw,
    powerFactor: config.powerFactor,
    utilityPercent: config.utilityPercent,
    // With mining per phase (#1065), the phase's miner and clock, and each resource's MW at the
    // nodes its draw taps; otherwise the survey's miner and clock on normal nodes.
    extractionAt: mining ? { ...mining.miner } : extractionEquipment(config),
    ...(mining ? { extractionMW: miningMW(raw, mining) } : {}),
    boost,
    spareMW: config.availablePowerGW * 1000,
    augmenterMW: spareMW - config.availablePowerGW * 1000,
  });
  return {
    feasible: true,
    rows: buildOrder(rows),
    raw,
    supplied,
    storage,
    drone,
    transport,
    delivery,
    surplus: stageSurplus(context, rows, demands),
    plutoniumSink: solved.values['sink-plutonium'] || 0,
    ...(period > 1 ? { nuclearPeriod: period } : {}),
    peakMW,
    generationMW,
    sloopsUsed: rows.reduce((total, row) => total + (row.sloops || 0), 0),
    augmenters,
    fueledAugmenters: fueled,
    boost,
    augmenterMW: 500 * augmenters,
    matrixRate: matrix,
    // New generation with the augmenter boost, plus the spare figure (which already includes the
    // augmenters' 500 MW each and their boost on installed capacity).
    availableMW: generationMW * (1 + boost) + spareMW,
    requiredMW: peakMW * utilityFactor,
    additionalHeadroomMW: Math.max(
      0,
      peakMW * utilityFactor - generationMW * (1 + boost) - spareMW,
    ),
    grid,
    // The phase takes as long as its slowest delivery (Infinity if a rate is 0).
    hours: Math.max(
      ...Object.values(delivery).map(part => (part.rate ? part.target / part.rate / 60 : Infinity)),
    ),
    // Names of the raw-resource conversion rows (Converter recipes), listed on the Resources page.
    conversions: rows
      .filter(row => Object.keys(row.outputs).some(item => RAW.includes(item) && item !== 'Water'))
      .map(row => row.name),
    // The phase's miner, belts, pipes, budgets and nodes (#1065); absent without mining per phase.
    ...(mining ? { mining } : {}),
  };
}
// What the phase draws of a raw resource: its one source, or with mining per phase (#1065) its
// node kinds' sources ('raw:<item>@<kind>', addNodeKinds in model.ts) together.
function rawDraw(solved: Solution, item: string): number {
  let total = 0;
  for (const [name, value] of Object.entries(solved.values))
    if (name === 'raw:' + item || name.startsWith('raw:' + item + '@')) total += value || 0;
  return total;
}
// Every Space Elevator part the lines make beyond their other uses goes to the elevator (#1062):
// a part's delivery rate is all its central balance has left once the lines, protected storage,
// fuel and the other demands have taken theirs, so the phase's time follows what the lines really
// make. Whole machines round a part's line up past the rate the goal asks for (Phase 3 asks 5.3
// Versatile Framework/min and builds two Assemblers, which make 10/min); that excess used to go
// to the sink while the delivery time was worked out from the smaller rate. The model still plans
// for the goal's rate (the balance's lower bound); only the reading changes. An excess no larger
// than the surplus leaves out (0.002/min) is solver noise and changes nothing, so a plan without
// whole machines, which makes exactly the goal's rate, reads as it did before.
function deliverAll(model: LpModel, solved: Solution, delivery: Record<string, StageDelivery>) {
  for (const [item, part] of Object.entries(delivery)) {
    const balance = 'item:' + item,
      bound = model.constraints[balance];
    if (bound?.min === undefined) continue;
    let total = 0;
    for (const [variable, coefficients] of Object.entries(model.variables))
      total += (solved.values[variable] || 0) * (coefficients[balance] || 0);
    const over = total - bound.min;
    if (over > 0.002) part.rate += over;
  }
}
// Rows: every recipe in use. `machines` rounds the equivalent up to buildings, and the last
// one runs underclocked at `lastClock` % (100 for a whole-machine row). A generator line is
// whole generators at 100% (#1064): generators burn fuel only for the power drawn, so its last
// one is never underclocked, and its `equivalent` is the fuel it burns. Row inputs and outputs
// are the line's totals per minute. peakMW counts whole machines at full power without the
// utility allowance; generationMW is a generator's output at its fractional level.
function stageRows(config: CurrentSettings, pool: PoolRecipe[], solved: Solution): CalcRow[] {
  return pool
    .filter(recipe => (solved.values[recipe.id] || 0) > 1e-6)
    .map((recipe): CalcRow => {
      const equivalent = solved.values[recipe.id]!;
      const machines = Math.ceil(equivalent - 1e-6);
      return {
        ...recipe,
        equivalent,
        machines,
        ...(recipe.slots ? { amplified: true, sloops: recipe.slots * machines } : {}),
        lastClock: recipe.power < 0 ? 100 : Math.max(0, (equivalent - machines + 1) * 100),
        inputs: Object.fromEntries(
          Object.entries(recipe.inputs).map(([item, rate]) => [item, rate * equivalent]),
        ),
        outputs: Object.fromEntries(
          Object.entries(recipe.outputs).map(([item, rate]) => [item, rate * equivalent]),
        ),
        peakMW: recipe.power < 0 ? 0 : machines * recipe.power * config.powerFactor,
        generationMW: recipe.power < 0 ? -recipe.power * equivalent : 0,
      };
    });
}
// Surplus: what the rows make beyond what the rows consume and every demand takes. Only solid,
// sinkable items are listed; fluids, waste and unsinkable items are balanced exactly. `made`
// counts rows only, so an item also drawn from existing supply or a raw budget shows the rows'
// excess over total use, clamped at 0.
function stageSurplus(
  { config, phase }: PhaseContext,
  rows: CalcRow[],
  { storage, delivery, drone, matrix }: PhaseDemands,
): ItemRates {
  const used: ItemRates = {},
    made: ItemRates = {};
  for (const row of rows) {
    for (const [item, rate] of Object.entries(row.inputs)) used[item] = (used[item] || 0) + rate;
    for (const [item, rate] of Object.entries(row.outputs)) made[item] = (made[item] || 0) + rate;
  }
  return Object.fromEntries(
    Object.keys(made)
      .map((item): [string, number] => [
        item,
        Math.max(
          0,
          made[item]! -
            (used[item] || 0) -
            (storage[item] || 0) -
            (delivery[item]?.rate || 0) -
            (drone[item] || 0) -
            (item === 'Singularity Cell' && phase === 5 ? config.cellsPerMinute : 0) -
            (item === 'Alien Power Matrix' ? matrix : 0),
        ),
      ])
      .filter(
        ([item, rate]) =>
          rate > 0.002 &&
          !DATA.items[item]?.radioactive &&
          !DATA.items[item]?.fluid &&
          (DATA.items[item]?.sink ?? 0) > 0,
      ),
  );
}
// Build order: by dependency depth, suppliers before consumers; recycling loops are
// commissioned as a connected group.
function buildOrder(rows: CalcRow[]): CalcRow[] {
  const producers: Record<string, CalcRow[]> = {};
  for (const row of rows)
    for (const item of Object.keys(row.outputs)) (producers[item] ??= []).push(row);
  const seen = new Set<string>(),
    visiting = new Set<string>(),
    ordered: CalcRow[] = [];
  function visit(row: CalcRow) {
    if (seen.has(row.id) || visiting.has(row.id)) return;
    visiting.add(row.id);
    for (const item of Object.keys(row.inputs))
      for (const producer of producers[item] || []) visit(producer);
    visiting.delete(row.id);
    seen.add(row.id);
    ordered.push(row);
  }
  rows.forEach(visit);
  return ordered;
}
