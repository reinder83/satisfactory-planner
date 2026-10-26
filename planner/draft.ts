// The draft of a phase that does not fit, and the reason it gives.
import { listNames } from '../public/wording.ts';
import {
  budgetLimits,
  leftOutCap,
  PHASE_CAP_KEYS,
  phaseCapAmount,
  phaseMining,
  phaseShare,
} from '../public/preferences.ts';
import { amplifiesIn } from '../public/somersloops.ts';
import type {
  CapShortfall,
  CurrentSettings,
  CurrentStage,
  ItemRates,
  PhaseCapKey,
  PhaseCaps,
  Shortfall,
} from '../public/types/index.ts';
import type { Solved, RunResult, RunOptions } from './types.ts';
import { RAW } from './data.ts';
import {
  run,
  capExcess,
  capFigures,
  goalHours,
  leastCapNeed,
  stockedFromSurplus,
  withoutCaps,
} from './model.ts';
import type { Unsolved } from './calculate.ts';
import { warningDuration } from './warnings.ts';
import { stoppedSearch } from './rounding.ts';

// What the draft of a phase that does not fit is diagnosed with: the settings without production
// amplification (`plain`), the phase's SAM conversion and its budgets: the settings', or with
// mining per phase the phase's own (#1065). `replan` plans the phase as calculate() does, which
// checks the budgets a whole-machine draft names (#1091). `buildCost` counts what the phase's
// buildings cost to build in every exact LP the draft solves (#1229, build-cost-draft.ts).
export interface DraftContext {
  config: CurrentSettings;
  phase: number;
  plain: CurrentSettings;
  conversion: boolean;
  budgets: ItemRates;
  replan?: Replan;
  buildCost?: boolean;
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
// A phase whose plan without the caps per phase (`free`, #1221) fits but is over a cap, and
// planned within the caps does not fit, gives the caps' reason instead (capReason).
export function draftStage(
  config: CurrentSettings,
  phase: number,
  result: Unsolved,
  replan?: Replan,
  free?: Solved,
): CurrentStage {
  const conversion = phase === 5 && config.sam !== 'avoid';
  const plain: CurrentSettings = { ...config, amplifySloops: 0 };
  // Without the caps per phase (#1221), so the draft shows what the goal needs.
  const diagnostic = exactRun(withoutCaps(plain), phase, { conversion, ignoreLimits: true });
  const stage: CurrentStage = { ...diagnostic, feasible: false };
  if (free && config.phaseCaps && diagnostic.feasible) {
    const budgets = phaseBudgets(config, phase);
    const draft: DraftContext = { config, phase, plain, conversion, budgets, replan };
    stage.reason = capReason(stage, draft, config.phaseCaps, result, free);
  } else if (result.solverStatus && !/infeasible/i.test(result.solverStatus))
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
    if (amplifiesIn(config, phase) && stage.shortfalls?.length)
      stage.reason +=
        ' These amounts are before production amplification; amplified machines may need somewhat less.';
  }
  return stage;
}
// The budgets a phase is planned with: the settings', or with mining per phase its own (#1065),
// each held to the nodes the node survey does not leave out (budgetLimits, #1183).
export const phaseBudgets = (config: CurrentSettings, phase: number): ItemRates =>
  config.phaseMining ? phaseMining(config, phase).budgets : budgetLimits(config);
// The draft's exact LP: `plain` without whole machines. Protected storage is left out of it where
// the whole-machine solve leaves it out (#1100), so the draft explains the phase that was solved.
export const exactRun = (plain: CurrentSettings, phase: number, options: RunOptions) =>
  run({ ...plain, wholeMachines: false }, phase, {
    ...options,
    storageLeftOut: stockedFromSurplus(plain),
    // A cap on buildings per phase (#1221) counted linearly, as the draft measures everything.
    relaxCaps: true,
  });
// Does the exact LP fit the real budgets at `hours` hours for this phase?
export const fitsInHours = ({ plain, phase, conversion, buildCost }: DraftContext, hours: number) =>
  exactRun({ ...plain, goal: 'timed', hours }, phase, { conversion, buildCost }).feasible;
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
  const network = exactRun(plain, phase, { conversion });
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
    const settings = raisedSettings(draft.config, draft.phase, current);
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
// `config` with each short budget raised as the draft's fix words it (draftShortfallWords in
// public/app/draft-advice.ts): to the amount needed, or with mining per phase, where the phase
// gets a share of the entered budget, to the entered budget that share needs; for an entered
// budget of none (#1185), the share the phase's equipment gives any budget (phaseShare).
function raisedSettings(
  config: CurrentSettings,
  phase: number,
  shortfalls: Shortfall[],
): CurrentSettings {
  const limits = { ...config.limits };
  for (const { name, needed, budget } of shortfalls) {
    const entered = config.limits[name];
    let share = 0;
    if (config.phaseMining && entered !== undefined)
      share = budget > 0 ? budget / entered : entered === 0 ? phaseShare(config, phase, name) : 0;
    limits[name] = share > 0 ? Math.ceil(needed / share) : needed;
  }
  return { ...config, limits };
}
// What the node survey leaves out of the plan of the short resources (#1183), a sentence each,
// so a resource whose nodes are all left out says why its budget is none: " Your node survey
// leaves every Iron Ore node out of this plan, so it has none to mine." or " Your node survey
// leaves 3 of the 40 Iron Ore nodes out of this plan." '' for resources it leaves none out of.
function leftOutWords(config: CurrentSettings, names: string[]): string {
  const survey = config.extraction;
  if (!survey) return '';
  return names
    .filter(name => leftOutCap(config, name) !== null)
    .map(name => {
      const sum = (map?: Record<string, { impure: number; normal: number; pure: number }>) =>
        (map?.[name]?.impure ?? 0) + (map?.[name]?.normal ?? 0) + (map?.[name]?.pure ?? 0);
      const left = sum(survey.excludedNodes) + sum(survey.excludedWells),
        all = sum(survey.nodes) + sum(survey.wells);
      const nodes = sum(survey.nodes) > 0,
        wells = sum(survey.wells) > 0;
      const one = nodes && wells ? 'node and well satellite' : wells ? 'well satellite' : 'node',
        many = nodes && wells ? 'nodes and well satellites' : wells ? 'well satellites' : 'nodes';
      return left >= all
        ? ` Your node survey leaves every ${name} ${one} out of this plan, so it has none to mine.`
        : ` Your node survey leaves ${left} of the ${all} ${name} ${many} out of this plan.`;
    })
    .join('');
}
// A real budget shortfall: what the diagnostic draws beyond the budgets, and the time at which
// the phase would fit them. Sets `shortfalls` and `minHours` on the draft.
export function shortfallReason(
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
  if (config.goal !== 'maximum' && fitsInHours(draft, 2000))
    stage.minHours = leastHours(draft, currentHours);
  const names = shortfalls.map(shortfall => shortfall.name);
  // Storage fed from surplus is not a demand of the solve (#1100), so the reason does not name it.
  const storage = stockedFromSurplus(config) ? '' : 'protected storage, ';
  return (
    (names.length
      ? `This phase needs more ${listNames(names)} than the entered budgets provide.` +
        leftOutWords(config, names)
      : 'The goal exceeds the available resource or power budgets.') +
    (stage.minHours
      ? ` It fits the current budgets at ${warningDuration(stage.minHours)} for this phase.`
      : config.goal === 'maximum'
        ? ` Raise those budgets, or reduce the ${storage}drone-fuel and Singularity Cell demands.`
        : ` More time alone will not fit: continuous demands (${storage}drone fuel, cells and minimum rounded delivery rates) already exceed the budgets.`)
  );
}
// The least hours per phase at which the exact LP fits the real budgets (and the caps per phase,
// or what its buildings cost to build, as `draft` counts them), found by bisection between the
// current hours and the 2,000-hour maximum, to a quarter hour. The caller has checked that it fits
// at 2,000 hours; whole machines may need slightly more. Shared with build-cost-draft.ts.
export function leastHours(draft: DraftContext, currentHours: number): number {
  let low = currentHours,
    high = 2000;
  for (let i = 0; i < 12 && high - low > 0.25; i++) {
    const mid = (low + high) / 2;
    if (fitsInHours(draft, mid)) high = mid;
    else low = mid;
  }
  return Math.ceil(high * 4) / 4;
}
// Why a phase does not fit its caps per phase (#1221, settings.phaseCaps): its plan without the
// caps (`free`) fits but is over a cap, and planned again within them (holdToCaps in
// calculate.ts) it is still over, or not found (`result`). For each cap `free` is over,
// `capShortfalls` [{ name, needed, cap }] records what the phase needs, never more than `free`
// itself needs, counted as the plan counts (capFigures):
//   proven, for a cap on buildings without production amplification in the phase: the exact LP
//     with the fewest machine-equivalents (leastCapNeed) is a lower bound on any plan's count,
//     and it is over the cap: "This phase needs at least 102 buildings; the cap is 50 buildings."
//   otherwise what `free` needs: "Without the cap, this phase's plan needs 920.5 MW; the cap is
//     700 MW." The model counts power in each line's linear share, more than an underclocked
//     machine draws, so its least power is no bound, nor is a count before amplification.
// Then why no plan within them was given: the search stopped at its limit, or none was found.
// Whole machines: when the phase's exact-clock plan (`exactPlan`, withExactPlan in calculate.ts)
// keeps within the caps, `wholeMachinesOnly`, with that plan's figures. Otherwise more time, where
// the exact LP fits the caps by the 2,000-hour maximum (`minHours`, measured in the model's terms,
// so "may"). Under maximum output a phase fits its caps by running slower, so only its continuous
// demands can break one: its least buildings are measured at the 2,000-hour maximum instead.
function capReason(
  stage: CurrentStage,
  draft: DraftContext,
  caps: PhaseCaps,
  result: Unsolved,
  free: Solved,
): string {
  const { config, phase, plain, conversion } = draft;
  const maximum = config.goal === 'maximum';
  const measured: CurrentSettings = maximum ? { ...plain, goal: 'timed', hours: 2000 } : plain;
  const figures = capFigures(free),
    over = capExcess(caps, free) ?? {};
  const proven: PhaseCapKey[] = [];
  const shortfalls = PHASE_CAP_KEYS.flatMap((name): CapShortfall[] => {
    const cap = caps[name];
    if (cap === undefined || over[name] === undefined) return [];
    const planned = plannedFigure(figures[name], cap);
    const least =
      name === 'buildings' && !amplifiesIn(config, phase)
        ? leastCapNeed(measured, phase, name, {
            conversion,
            storageLeftOut: stockedFromSurplus(plain),
          })
        : null;
    const bound = least === null ? null : Math.ceil(least - 1e-6);
    if (bound !== null && bound > cap && bound <= planned) {
      proven.push(name);
      return [{ name, needed: bound, cap }];
    }
    return [{ name, needed: planned, cap }];
  });
  stage.capShortfalls = shortfalls;
  const set = PHASE_CAP_KEYS.filter(name => caps[name] !== undefined).length;
  const within = set > 1 ? 'caps' : 'cap',
    raise = shortfalls.length > 1 ? 'caps' : 'cap';
  const needs = shortfalls
    .map(({ name, needed, cap }) =>
      proven.includes(name)
        ? `This phase needs at least ${phaseCapAmount(name, needed)}; the cap is ${phaseCapAmount(name, cap)}.`
        : `Without the ${within}, this phase's plan needs ${phaseCapAmount(name, needed)}; the cap is ${phaseCapAmount(name, cap)}.`,
    )
    .join(' ');
  const why = stoppedSearch(result)
    ? ` The search for a plan within the ${within} stopped at its limit before it found one, so whether one exists has not been checked.`
    : proven.length === shortfalls.length
      ? ''
      : ` The planner found no plan within the ${within}.`;
  const exact = free.exactPlan;
  if (
    config.wholeMachines &&
    exact &&
    PHASE_CAP_KEYS.every(name => {
      const cap = caps[name];
      return cap === undefined || (name === 'mw' ? exact.needMW : exact.buildings) <= cap + 1e-6;
    })
  ) {
    stage.wholeMachinesOnly = true;
    return `${needs}${why} At exact clocks this phase's plan keeps within the ${within}, with ${phaseCapAmount('buildings', exact.buildings)} and ${phaseCapAmount('mw', Math.floor(exact.needMW * 10) / 10)}: turn off whole-machine production for this profile, or raise the ${raise} (Goals).`;
  }
  const storage = stockedFromSurplus(config) ? '' : 'protected storage, ';
  let time = '.';
  if (maximum) time = `, or reduce the ${storage}drone-fuel and Singularity Cell demands.`;
  else if (!fitsInHours(draft, goalHours(config)) && fitsInHours(draft, 2000)) {
    stage.minHours = leastHours(draft, goalHours(config));
    time = `, or give the phase more time: it may fit within the ${within} from ${warningDuration(stage.minHours)} for this phase.`;
  }
  return `${needs}${why} Raise the ${raise} (Goals)${time}`;
}
// A cap's figure of a plan as a draft gives it, never more than the plan's own: whole buildings,
// and MW rounded down to a tenth, or to a thousandth when a tenth would not show it over the cap.
function plannedFigure(figure: number, cap: number): number {
  const tenth = Math.floor(figure * 10) / 10;
  return tenth > cap ? tenth : Math.floor(figure * 1000) / 1000;
}
