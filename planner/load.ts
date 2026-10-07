// Generation bounded by the phase's load (#1086). Generators burn fuel only for the power drawn,
// so fuel a phase makes beyond its load backs up its chain in the game: the fuel lines stop, and
// the stop reaches the lines whose byproduct feeds them (Heavy Oil Residue from Plastic and
// Rubber). The power constraint (addPower in model.ts) only keeps generation from falling short,
// and charges every line at its full linear power, while the phase draws each line at its clocked
// power (the last machine at clock^1.321929, lineLoad in public/power.ts). Two things therefore
// set the fuel above the load: exactly balanced fluid byproducts of whole lines, which must end
// as fuel, and the underclocked machines, which draw less than the fuel planned for them.
//
// Bounding generation by the load inside the model would let a solve raise its own load instead
// (mining ore for the sink costs almost nothing), and the clocked power is not linear. So a solve
// whose fuel gives more than one generator beyond the phase's need (its grid's needMW, less the
// spare power) is solved again with two fixed figures from it (`loadBound`): its generation capped
// at that need plus one generator, and the power constraint credited with what its underclocked
// machines draw less than their linear power, less half a generator, so the fuel follows the
// clocked load. The capped solve may widen an integer fit's network with the phase's fluid lines,
// which run at exact clocks: it can only make less fuel, with a whole line less, a disposal route
// such as Petroleum Coke for the sink, or a fluid line topping the fuel up exactly. A capped plan
// counts only while its fuel still covers its own need, so the phase never runs short (#1064's
// rule that a plan that fits has the power it needs). The nearest such plan stands; a capped solve
// that fails, or finishes a maximum-output phase later, leaves the plan as it was. Phases with
// nuclear plants are left alone: their whole plants and the waste chain's period set their
// generation by the owner's rules (#370).
import { extractionMWPerUnit, miningLinearMW } from '../public/preferences.ts';
import { extractionEquipment } from '../public/power.ts';
import type { LoadBound, RunResult, Solved } from './types.ts';
import { DATA } from './data.ts';
import { primaryOutput } from './recipes.ts';
import { phasePool, run, type PhaseContext } from './model.ts';

// How many capped solves one solve may take: each is bounded by the plan before it, whose load can
// drop when the capped plan builds fewer fuel lines.
const LOAD_ROUNDS = 3;
// Below this, in MW, generation beyond the need or short of it is solver noise.
const LOAD_DUST = 0.01;

// A solved stage's generation against its load, in MW: `linearMW` its lines at full linear power
// with the allowance and the extraction, as the power constraint counts them; `needMW` the same at
// their clocked power, as the pages show it (the stage's grid); `drawMW` what the phase draws from
// its new generators, the need less the spare power (with what the augmenters add); `generationMW`
// the non-nuclear generators' output with Phase 5's boost, which is the fuel they are planned to
// burn; `unitMW` one of the plan's largest generators, which whole generators round up by anyway.
export interface LoadBalance {
  linearMW: number;
  needMW: number;
  drawMW: number;
  generationMW: number;
  unitMW: number;
}
export function loadBalance(
  { config, power, mining }: PhaseContext,
  stage: Pick<Solved, 'rows' | 'raw' | 'grid'>,
): LoadBalance | null {
  const generators = stage.rows.filter(row => row.power < 0);
  if (!generators.length || generators.some(row => row.machine === 'Nuclear Power Plant'))
    return null;
  const equipment = extractionEquipment(config);
  const linesMW = stage.rows
    .filter(row => row.power > 0)
    .reduce((total, row) => total + row.power * row.equivalent, 0);
  // With mining per phase (#1065), each node kind's draw at its own power, as addNodeKinds in
  // model.ts charges it.
  const extractionMW = mining
    ? miningLinearMW(stage.raw, mining)
    : Object.entries(stage.raw).reduce(
        (total, [item, rate]) => total + rate * extractionMWPerUnit(item, equipment),
        0,
      );
  const needMW = stage.grid.needMW;
  return {
    linearMW: (linesMW * power.utilityFactor + extractionMW) * config.powerFactor,
    needMW,
    drawMW: Math.max(0, needMW - power.spareMW),
    generationMW:
      generators.reduce((total, row) => total - row.power * row.equivalent, 0) * (1 + power.boost),
    unitMW: Math.max(...generators.map(row => -row.power)) * (1 + power.boost),
  };
}
// The fuel a stage burns beyond what the phase draws, in MW: 0 for a stage loadBalance leaves alone.
const excessOf = (balance: LoadBalance | null) =>
  balance ? balance.generationMW - balance.drawMW : 0;

// The fixed figures a capped solve is bounded by, from the plan before it (see the header).
const boundFrom = (balance: LoadBalance): LoadBound => ({
  creditMW: Math.max(0, balance.linearMW - balance.needMW - balance.unitMW / 2),
  capMW: balance.drawMW + balance.unitMW,
});

// The plan of one solve with its generation bounded by its load: `first` itself when its fuel is
// within one generator of what the phase draws, else the capped solve that comes nearest (see the
// header). Only the solves that plan (run without a bound); the diagnostics that lift or price the
// budgets (ignoreLimits, overBudget) measure what a phase needs and are left as they are.
export function withinLoad(context: PhaseContext, first: RunResult): RunResult {
  if (!first.feasible || context.loadBound !== null) return first;
  if (context.ignoreLimits || context.overBudget || (context.phase < 2 && !context.maximum))
    return first;
  let balance = loadBalance(context, first);
  if (!balance || excessOf(balance) <= balance.unitMW + LOAD_DUST) return first;
  let best: Solved = first,
    bestExcess = excessOf(balance);
  for (let round = 0; round < LOAD_ROUNDS && balance; round++) {
    const next = run(context.config, context.phase, {
      ...runOptions(context),
      recipeIds: withFluidLines(context),
      loadBound: boundFrom(balance),
    });
    if (!next.feasible) break;
    // A maximum-output phase keeps its time: a bound that slows it is not worth it.
    if (context.maximum && next.hours > first.hours * (1 + 1e-9)) break;
    const measured = loadBalance(context, next);
    // A capped plan with nuclear plants or no generators has nothing left to bound, and one whose
    // fuel falls short of its need would leave the phase short of power.
    if (!measured || measured.generationMW < measured.drawMW - LOAD_DUST) break;
    const excess = excessOf(measured);
    if (excess < bestExcess) [best, bestExcess] = [next, excess];
    if (excess <= measured.unitMW + LOAD_DUST) break;
    balance = measured;
  }
  return best;
}
// The network a capped solve chooses from: an integer fit's network (`recipeIds`, the exact
// solve's choice) widened with every fluid line of the phase's pool, which run at exact clocks
// and so can top a fuel up exactly when a whole disposal line takes more of a byproduct than the
// fuel can spare. Without `recipeIds` the solve already has the whole pool.
function withFluidLines(context: PhaseContext): Set<string> | null {
  if (!context.recipeIds) return null;
  const fluid = phasePool({ ...context, recipeIds: null })
    .filter(recipe => DATA.items[primaryOutput(recipe) ?? '']?.fluid)
    .map(recipe => recipe.id);
  return new Set([...context.recipeIds, ...fluid]);
}
// run()'s options as a phase context holds them.
const runOptions = ({
  maximum,
  conversion,
  ignoreLimits,
  recipeIds,
  caps,
  baseline,
  fractionalNuclear,
  roundStopped,
  overBudget,
  loadBound,
  storageLeftOut,
}: PhaseContext) => ({
  maximum,
  conversion,
  ignoreLimits,
  recipeIds,
  caps,
  baseline,
  fractionalNuclear,
  roundStopped,
  overBudget,
  loadBound,
  storageLeftOut,
});
