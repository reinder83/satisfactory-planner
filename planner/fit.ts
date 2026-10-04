// The two-step fit for whole machines and production amplification: the exact LP chooses the
// recipe network, then the integer fit solves over it, with the fallbacks for amplification,
// existing supply and whole nuclear plants.
import type { CurrentSettings } from '../public/types/index.ts';
import type { Solved, RunResult, RunOptions } from './types.ts';
import { AMPLIFY_CANDIDATES } from './recipes.ts';
import { run, type PhaseContext } from './model.ts';
import { stoppedSearch, ROUNDING_MS, roundedFallback, easyClockFallback } from './rounding.ts';
import { sharedSettings } from './on-site.ts';

// The options the two-step fit passes on to each of its solves unchanged.
type FitOptions = Pick<RunOptions, 'maximum' | 'conversion' | 'ignoreLimits' | 'caps'>;
// Two-step fit for whole machines and amplification. First the exact LP (fractional machines,
// no amplification) chooses the recipe network; then the integer fit re-solves over only that
// network (`recipeIds`), which keeps the integer search small enough for the solver's search
// limit (SEARCH_LIMITS in optimizer.ts). Hence the warning that the result is not a global
// mixed-recipe integer optimum.
export function twoStepFit(context: PhaseContext): RunResult {
  const { config, phase, maximum, conversion, ignoreLimits, caps } = context;
  const sharedOptions: FitOptions = { maximum, conversion, ignoreLimits, caps };
  // If even the exact LP fails, rounding cannot help; calculate() explains the failure.
  const base = exactFit(config, phase, sharedOptions);
  if (!base.feasible) return base;
  const ids = new Set(base.rows.map(row => row.id));
  const baseline = amplifyCandidates(config, base);
  const supply = Object.keys(config.existingSupply).length
    ? supplyFallback(context, sharedOptions, ids, baseline)
    : null;
  // Amplification is optional by definition: the solver may always place no somersloops at all.
  // So a failure here is the integer search running out of time, never a real shortage — never let
  // it cost the user a plan that fits. Every step below is tried amplified first, then without
  // amplification (marked `amplificationDropped`), and the credit for existing production is kept
  // as long as either fits before it is dropped: the same steps in the same order as with
  // `amplifySloops` 0, so turning amplification on never gives a worse plan than turning it off
  // (#597).
  const variants = config.amplifySloops > 0 ? [config, { ...config, amplifySloops: 0 }] : [config];
  const marked = (variant: CurrentSettings, result: Solved): Solved =>
    variant === config ? result : { ...result, amplificationDropped: true };
  let fit: RunResult | null = null;
  for (const variant of variants) {
    const credited = integerFit(variant, phase, { ...sharedOptions, recipeIds: ids, baseline });
    if (credited.feasible) return marked(variant, credited);
    // The amplified fit's failure is the one calculate() explains when nothing fits.
    fit ??= credited;
    const widened = supply?.widened(variant);
    if (widened?.feasible) return marked(variant, widened);
  }
  if (supply)
    for (const variant of variants) {
      const without = supply.without(variant);
      if (without?.feasible) return marked(variant, { ...without, supplyDropped: true });
    }
  // A search that stopped at its limit proves no shortage while the exact plan fits: round that
  // plan to whole machines instead (#593), when the caller asks for it, and when no rounded plan
  // fits, plan the exact one with easy clocks (#694). Both share one time limit.
  if (context.roundStopped && config.wholeMachines && stoppedSearch(fit!)) {
    const fallback = { ids, baseline, variants, marked, until: Date.now() + ROUNDING_MS };
    return roundedFallback(context, base, fallback) ?? easyClockFallback(context, base, fallback);
  }
  return fit!;
}
// The two-step fit's first step: the exact LP, with fractional machines and no amplification, and
// the groups' lines made on site sized by their shares (sharedSettings, #984).
const exactFit = (variant: CurrentSettings, phase: number, options: FitOptions) =>
  run({ ...sharedSettings(variant), wholeMachines: false, amplifySloops: 0 }, phase, options);
// The amplification candidates: the largest lines (at least one machine-equivalent) of an
// exact solve, as { recipeId: equivalent }. A group's own line made on site (#875) is never
// amplified.
const amplifyCandidates = (config: CurrentSettings, exactStage: Solved): Record<string, number> =>
  Object.fromEntries(
    [...exactStage.rows]
      .filter(row => row.equivalent >= 1 && !row.onSite)
      .sort((a, b) => b.equivalent - a.equivalent)
      .slice(0, AMPLIFY_CANDIDATES[config.wholeMachines ? 'whole' : 'precise'])
      .map(row => [row.id, row.equivalent]),
  );
// An integer fit. Whole nuclear plants (see roundNuclear) can need more uranium, water or
// waste-chain inputs than the budgets allow; then fall back to fractional uranium plants,
// exactly the fit earlier releases made, and mark the stage `nuclearFractional` (#370).
function integerFit(variant: CurrentSettings, phase: number, options: RunOptions): RunResult {
  const result = run(variant, phase, options);
  if (result.feasible || !variant.wholeMachines || !options.recipeIds?.has('power-uranium'))
    return result;
  const fractional = run(variant, phase, { ...options, fractionalNuclear: true });
  return fractional.feasible ? { ...fractional, nuclearFractional: true } : result;
}
// Crediting production you already run narrows the recipe network the exact solve picks, and a
// narrower network has less room to round up to whole machines. Widen it with the recipes this
// phase would have used without the credit before concluding anything — the supplied plan is
// still the smaller one, it just needs the slack. If even that will not round, drop the credit:
// telling the planner what you already built must never cost you a plan, the same rule
// amplification follows in twoStepFit. twoStepFit calls both steps once per variant (amplified
// and not); the exact solve without the credit is the same for both, so it is solved once, and
// only when a fit has failed. Each step returns null when that exact solve fails too.
function supplyFallback(
  { config, phase }: PhaseContext,
  sharedOptions: FitOptions,
  ids: Set<string>,
  baseline: Record<string, number>,
) {
  let plainBase: RunResult | null = null;
  const plain = () => {
    plainBase ??= exactFit({ ...config, existingSupply: {} }, phase, sharedOptions);
    return plainBase.feasible ? plainBase : null;
  };
  return {
    // The credited fit over the network widened with the recipes of the plan without the credit.
    widened(variant: CurrentSettings): RunResult | null {
      const uncredited = plain();
      return uncredited
        ? integerFit(variant, phase, {
            ...sharedOptions,
            recipeIds: new Set([...ids, ...uncredited.rows.map(row => row.id)]),
            baseline,
          })
        : null;
    },
    // The fit without the credit, over the network of the exact plan without it.
    without(variant: CurrentSettings): RunResult | null {
      const uncredited = plain();
      return uncredited
        ? integerFit({ ...variant, existingSupply: {} }, phase, {
            ...sharedOptions,
            recipeIds: new Set(uncredited.rows.map(row => row.id)),
            baseline: amplifyCandidates(config, uncredited),
          })
        : null;
    },
  };
}
