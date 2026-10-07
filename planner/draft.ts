// The draft of a phase that does not fit, and the reason it gives.
import { listNames } from '../public/wording.ts';
import { phaseMining } from '../public/preferences.ts';
import type { CurrentSettings, CurrentStage, ItemRates, Shortfall } from '../public/types/index.ts';
import type { Solved, RunResult } from './types.ts';
import { RAW } from './data.ts';
import { run, goalHours } from './model.ts';
import type { Unsolved } from './calculate.ts';
import { warningDuration } from './warnings.ts';
import { stoppedSearch } from './rounding.ts';

// What the draft of a phase that does not fit is diagnosed with: the settings without production
// amplification (`plain`), the phase's SAM conversion and its budgets: the settings', or with
// mining per phase the phase's own (#1065). `replan` plans the phase as calculate() does, which
// checks the budgets a whole-machine draft names (#1091).
interface DraftContext {
  config: CurrentSettings;
  phase: number;
  plain: CurrentSettings;
  conversion: boolean;
  budgets: ItemRates;
  replan?: Replan;
}
// Plans the draft's phase with `settings` as calculate() does: the real whole-machine fit.
export type Replan = (settings: CurrentSettings) => RunResult;
// Infeasible phase: build a draft that explains why. The diagnostic is the exact LP with every
// budget lifted, so its `raw` shows what the goal would need. Three outcomes, in order: the
// search stopped (no shortage proven); the recipes and power options cannot make it at all; or
// it is a budget problem, split into "only whole machines break it" and a real shortfall.
// The draft only explains what exceeds the budgets: the exact LP is fast and avoids another integer search.
// The diagnostics solve without production amplification (the owner's choice in #64): the
// exact LP stays fast and runs no integer search, so unlike the amplified integer fit it cannot
// stop at the node limit or the phase's deadline before proving the best plan. The reason says
// the amounts are before amplification when somersloops are budgeted for it.
export function draftStage(
  config: CurrentSettings,
  phase: number,
  result: Unsolved,
  replan?: Replan,
): CurrentStage {
  const conversion = phase === 5 && config.sam !== 'avoid';
  const plain: CurrentSettings = { ...config, amplifySloops: 0 };
  const diagnostic = run({ ...plain, wholeMachines: false }, phase, {
    conversion,
    ignoreLimits: true,
  });
  const stage: CurrentStage = { ...diagnostic, feasible: false };
  if (result.solverStatus && !/infeasible/i.test(result.solverStatus))
    stage.reason =
      'The whole-machine search stopped before it could prove the best plan for this combination. Try fewer alternates or precise balancing; no resource shortage has been established.';
  else if (!diagnostic.feasible)
    stage.reason =
      'The selected recipe/power options cannot support this combination. Allow alternates or change the goals.';
  else {
    const budgets = phaseBudgets(config, phase);
    const draft: DraftContext = { config, phase, plain, conversion, budgets, replan };
    const currentHours = goalHours(config);
    stage.reason =
      config.goal !== 'maximum' && fitsInHours(draft, currentHours)
        ? wholeMachinesReason(stage, draft)
        : shortfallReason(stage, draft, diagnostic, currentHours);
    if (config.amplifySloops > 0 && stage.shortfalls?.length)
      stage.reason +=
        ' These amounts are before production amplification; amplified machines may need somewhat less.';
  }
  return stage;
}
// The budgets a phase is planned with: the settings', or with mining per phase its own (#1065).
const phaseBudgets = (config: CurrentSettings, phase: number): ItemRates =>
  config.phaseMining ? phaseMining(config, phase).budgets : config.limits;
// Does the exact LP fit the real budgets at `hours` hours for this phase?
const fitsInHours = ({ plain, phase, conversion }: DraftContext, hours: number) =>
  run({ ...plain, wholeMachines: false, goal: 'timed', hours }, phase, { conversion }).feasible;
// Only rounding up to whole machines breaks a budget here. Sets `wholeMachinesOnly` and the
// `shortfalls` measureWholeMachines finds, checked against the real fit (checkedShortfalls).
function wholeMachinesReason(stage: CurrentStage, draft: DraftContext) {
  stage.wholeMachinesOnly = true;
  const shortfalls = measureWholeMachines(draft);
  if (shortfalls) stage.shortfalls = checkedShortfalls(shortfalls, draft);
  const names = (stage.shortfalls || []).map(shortfall => shortfall.name);
  return names.length
    ? `Precise balancing fits these budgets, but whole solid-part machines at 100% need more ${listNames(names)}. Raise ${names.length > 1 ? 'those budgets' : 'that budget'}, or turn off whole-machine production for this profile.`
    : 'Mixed-recipe balancing fits these budgets, but running solid-part machines whole at 100% does not. Add some budget headroom or turn off whole-machine production for this profile.';
}
// The least extra budget whole machines need: re-fit the exact plan's recipe network with each
// budget allowed to run over at a high cost (`overBudget`), so the fit raises a budget only as far
// as whole machines need it, not what a fit with room to spare would draw. Measured with doubled
// budgets, as before #1066, raw resources were almost free, so the fit spent the extra budget on
// saving machines and overstated the need (+44% Crude Oil where whole machines need +32%).
// The budgets that fit runs over, or undefined when it finds no plan.
function measureWholeMachines({
  phase,
  plain,
  conversion,
  budgets,
}: DraftContext): Shortfall[] | undefined {
  const network = run({ ...plain, wholeMachines: false }, phase, { conversion });
  const rounded: RunResult = network.feasible
    ? run(
        plain,
        phase,
        // Fractional nuclear plants, as the plan itself falls back to: the shortfall
        // is about the solid-part lines.
        {
          conversion,
          recipeIds: new Set(network.rows.map(row => row.id)),
          fractionalNuclear: true,
          overBudget: true,
        },
      )
    : { feasible: false };
  if (!rounded.feasible) return undefined;
  return RAW.filter(resource => (rounded.raw[resource] || 0) > budgets[resource]! + 0.001).map(
    resource => ({
      name: resource,
      needed: Math.ceil(rounded.raw[resource]!),
      budget: budgets[resource]!,
    }),
  );
}
// How many times checkedShortfalls plans the phase with raised budgets.
const CHECK_ROUNDS = 3;
// The measurement fits the exact plan's network, while the plan calculated with the raised
// budgets picks its own network and runs the full whole-machine fit, which can need a little more
// (#1091: Crude Oil 7,928/min named, 8,081 needed). So plan the phase with the budgets raised as
// the draft's fix says (raisedSettings) and, while that is proven short, measure again from there
// and raise further, CHECK_ROUNDS plans at most. Amounts that still do not fit, or whose check
// stopped at a search limit, are marked `atLeast`. Only a whole-machine draft pays for these
// solves; a phase that fits never reaches them.
function checkedShortfalls(shortfalls: Shortfall[], draft: DraftContext): Shortfall[] {
  if (!shortfalls.length || !draft.replan) return shortfalls;
  let current = shortfalls;
  for (let round = 0; round < CHECK_ROUNDS; round++) {
    const settings = raisedSettings(draft.config, current);
    const plan = draft.replan(settings);
    if (plan.feasible) return current;
    if (stoppedSearch(plan)) break;
    const more = measureWholeMachines({
      ...draft,
      plain: { ...settings, amplifySloops: 0 },
      budgets: phaseBudgets(settings, draft.phase),
    });
    if (!more?.length) break;
    // Measured over the raised budgets: keep each resource's entered budget.
    const known = new Map(current.map(shortfall => [shortfall.name, shortfall]));
    for (const { name, needed, budget } of more)
      known.set(name, {
        name,
        needed: Math.max(needed, known.get(name)?.needed ?? 0),
        budget: known.get(name)?.budget ?? budget,
      });
    current = RAW.filter(resource => known.has(resource)).map(resource => known.get(resource)!);
  }
  return current.map(shortfall => ({ ...shortfall, atLeast: true }));
}
// `config` with each short budget raised as the draft's fix words it (shortfallWords in
// public/app/views/calculated.ts): to the amount needed, or with mining per phase, where the
// phase gets a share of the entered budget, to the entered budget that share needs.
function raisedSettings(config: CurrentSettings, shortfalls: Shortfall[]): CurrentSettings {
  const limits = { ...config.limits };
  for (const { name, needed, budget } of shortfalls) {
    const entered = config.limits[name];
    limits[name] =
      config.phaseMining && entered !== undefined && budget > 0
        ? Math.ceil(needed / (budget / entered))
        : needed;
  }
  return { ...config, limits };
}
// A real budget shortfall: what the diagnostic draws beyond the budgets, and the time at which
// the phase would fit them. Sets `shortfalls` and `minHours` on the draft.
function shortfallReason(
  stage: CurrentStage,
  draft: DraftContext,
  diagnostic: Solved,
  currentHours: number,
) {
  const { config, budgets } = draft;
  const shortfalls = RAW.filter(
    resource => (diagnostic.raw[resource] || 0) > budgets[resource]! + 0.05,
  ).map(resource => ({
    name: resource,
    needed: Math.ceil(diagnostic.raw[resource]!),
    budget: budgets[resource]!,
  }));
  stage.shortfalls = shortfalls;
  // The minimal per-phase time is found on the exact LP; whole machines may need slightly more.
  // Bisection between the current hours and the 2,000-hour maximum, to a quarter hour.
  if (config.goal !== 'maximum' && fitsInHours(draft, 2000)) {
    let low = currentHours,
      high = 2000;
    for (let i = 0; i < 12 && high - low > 0.25; i++) {
      const mid = (low + high) / 2;
      if (fitsInHours(draft, mid)) high = mid;
      else low = mid;
    }
    stage.minHours = Math.ceil(high * 4) / 4;
  }
  const names = shortfalls.map(shortfall => shortfall.name);
  return (
    (names.length
      ? `This phase needs more ${listNames(names)} than the entered budgets provide.`
      : 'The goal exceeds the available resource or power budgets.') +
    (stage.minHours
      ? ` It fits the current budgets at ${warningDuration(stage.minHours)} for this phase.`
      : config.goal === 'maximum'
        ? ' Raise those budgets, or reduce the protected storage, drone-fuel and Singularity Cell demands.'
        : ' More time alone will not fit: continuous demands (protected storage, drone fuel, cells and minimum rounded delivery rates) already exceed the budgets.')
  );
}
