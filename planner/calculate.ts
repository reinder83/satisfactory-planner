// calculate(): every phase of a profile, solved one by one, then adjusted and warned about.
// Re-exported by ../planner.ts.
import { setSearchDeadline } from '../optimizer.ts';
import type {
  CurrentCalculatedPlan,
  CurrentSettings,
  CurrentStage,
  StageKey,
} from '../public/types/index.ts';
import type { Solved, RunResult } from './types.ts';
import { ENGINE } from './data.ts';
import { fail, settings } from './settings.ts';
import { run } from './model.ts';
import { draftStage } from './draft.ts';
import {
  pullFinalPhaseForward,
  judgeAugmenterFuel,
  fullSpeed,
  fullSpeedWarning,
} from './adjustments.ts';
import { planWarnings } from './warnings.ts';
import { stoppedSearch } from './rounding.ts';
import { plannedSites, centralSettings, withinRates, withOverflow } from './on-site.ts';
import { carryGenerators } from '../public/power.ts';
import { withStock } from './stock.ts';

// Calculates a whole profile: every phase 1 to 5, whatever phase the profile starts in (the
// interface hides earlier phases; post-game reuses Phase 5). `input` is raw settings, validated by
// settings(); `onPhase(phase)` is called before each phase is solved, which the browser worker
// forwards as progress so its timeout restarts.
//
// Returns { engine, settings, stages: { 1..5: stage }, warnings: [string], createdAt }. A stage is
// run()'s result, or for a phase that does not fit a draft with `feasible: false`, the diagnostic
// solve's rows and a `reason`, plus `shortfalls` [{ name, needed, budget }], `minHours` and
// `wholeMachinesOnly` where they apply (see draftFixes in public/app/views/calculated.ts).
// Stored as `profile.plan` and never recalculated behind the user's back, so a field added here
// must be optional for plans saved by older engines.
//
// Callers: server/save-routes.ts (/api/preview, /api/profiles) and server/profile-routes.ts
// (/api/round-up), calculator-worker.js in the Pages edition (via public/browser-api.ts), and
// the tests.
export function calculate(
  input: unknown,
  onPhase?: (phase: number) => void,
): CurrentCalculatedPlan {
  try {
    return calculatePlan(input, onPhase);
  } finally {
    setSearchDeadline(Infinity);
  }
}
// How long the integer searches of one phase may take together, in milliseconds (#592): well
// inside the browser worker's limit of 180 seconds per phase (workerJobs in public/browser-api.ts).
// Its timer restarts only when a phase starts, so what runs after the Phase 5 solve (phaseTime
// 'final', fueled augmenters) shares Phase 5's deadline. The rest of the worker's limit is left
// for the linear solves and the other work of a slower device. On an ordinary machine the heaviest
// phases of the test set search for about 20 seconds, so this changes no plan there.
const PHASE_SEARCH_MS = 120000;
// The stages while calculate() works on them, keyed by phase number; the plan's JSON keys are
// the StageKey strings.
export type PhaseStages = Record<number, CurrentStage>;
// run()'s result for a phase that did not fit.
export type Unsolved = Exclude<RunResult, Solved>;
// calculate()'s steps: the settings, the stages, the adjustments to the finished stages, the
// warnings, the plan.
function calculatePlan(input: unknown, onPhase?: (phase: number) => void): CurrentCalculatedPlan {
  const config = settings(input);
  if (config.goal === 'maximum' && !config.limitsConfirmed)
    fail('Confirm your available resource budgets before maximizing output.');
  // The first plan of each phase whose routed plan stands (withOverflow), for phaseTime 'final'.
  const unrouted: Record<number, Solved> = {};
  const stages = solvePhases(config, unrouted, onPhase);
  // Minimal construction's phases that run their buildings faster than the 24 hours (fullSpeed),
  // read before the target time on the final phase may pull an earlier phase ahead too.
  const sooner = Object.entries(stages)
    .filter(([, stage]) => stage.aheadOf !== undefined)
    .map(([phase]) => Number(phase));
  // Everything below adjusts the finished stages or adds warnings. Warnings are plain sentences,
  // shown in this order as the profile's assumptions (plan page, Backup page, wizard review).
  // The adjustments run in this order, after Phase 5 and on its search deadline, and each returns
  // the warnings it adds; planWarnings reads the stages as they left them.
  const warnings = [
    ...fullSpeedWarning(config, sooner),
    ...pullFinalPhaseForward(config, stages, unrouted),
    ...judgeAugmenterFuel(config, stages),
  ];
  // Under whole machines, protected storage takes each phase's surplus first, and only an item
  // with no surplus gets storage-only lines at exact clocks, built last (#1061, withStock).
  for (const [phase, stage] of Object.entries(stages))
    if (stage.feasible) stages[Number(phase)] = withStock(config, Number(phase), stage as Solved);
  // Each phase keeps the generators the phase before built, where it still fuels them (#1064).
  carryGenerators(stages, Number(config.phase));
  warnings.push(...planWarnings(config, stages));
  return {
    engine: ENGINE,
    settings: config,
    stages: stages as Record<StageKey, CurrentStage>,
    warnings,
    createdAt: new Date().toISOString(),
    // Fluid lines keep exact clocks even with a solid byproduct (#1086, roundsToWholeMachines).
    exactFluidLines: true,
  };
}
// Solves each phase on its own, 1 to 5, each with a fresh search deadline. A phase that does not
// fit becomes a draft that explains why (draftStage). A phase planned with the groups' excess
// routed to the central demand records its first plan in `unrouted` (withOverflow).
function solvePhases(
  config: CurrentSettings,
  unrouted: Record<number, Solved>,
  onPhase?: (phase: number) => void,
): PhaseStages {
  const stages: PhaseStages = {};
  for (let phase = 1; phase <= 5; phase++) {
    onPhase?.(phase);
    setSearchDeadline(Date.now() + PHASE_SEARCH_MS);
    const result = planPhase(config, phase, first => (unrouted[phase] = first));
    stages[phase] = result.feasible
      ? withExactPlan(config, phase, result)
      : draftStage(config, phase, result);
  }
  return stages;
}
// One phase as the profile's goal plans it: solvePhase, and under minimal construction the same
// buildings run as fast as they allow (fullSpeed, #1066). A phase that sinks almost all a central
// line of an item made on site makes is planned again with the groups' excess of it feeding the
// central demand, as withOverflow says (#1063). It compares the two plans after fullSpeed, so
// under minimal construction the routed plan stands only when it finishes no later at full speed.
// `unrouted` is given the first plan when the routed one stands.
function planPhase(
  config: CurrentSettings,
  phase: number,
  unrouted?: (first: Solved) => void,
): RunResult {
  return withOverflow(
    config,
    phase,
    settings => solvePhase(settings, phase),
    (settings, plan) => (config.goal === 'minimal' ? fullSpeed(settings, phase, plan) : plan),
    unrouted,
  );
}
// What rounding to whole machines costs (#1066): a whole-machine phase records the same phase
// planned with exact clocks (planPhase without wholeMachines, so without the lines set to exact
// clocks either) as `exactPlan`: its buildings, power, raw resources, overflow and hours, which
// the plan's pages set beside the whole-machine figures. Only where both fit: a phase whose exact
// plan does not fit records nothing, and neither does a plan without whole machines. It shares
// the phase's search deadline; the exact plan is a linear solve unless production amplification
// asks for an integer search, and one that stops records nothing either.
function withExactPlan(config: CurrentSettings, phase: number, stage: Solved): Solved {
  if (!config.wholeMachines) return stage;
  const exact = planPhase({ ...config, wholeMachines: false }, phase);
  if (!exact.feasible) return stage;
  return {
    ...stage,
    exactPlan: {
      buildings: exact.rows.reduce((total, row) => total + row.machines, 0),
      needMW: exact.grid?.needMW ?? exact.requiredMW,
      raw: Object.fromEntries(Object.entries(exact.raw).filter(([, rate]) => rate > 0.001)),
      surplus: Object.values(exact.surplus).reduce((total, rate) => total + rate, 0),
      hours: exact.hours,
    },
  };
}
// One phase's solve under the profile's goal and SAM conversion. SAM conversion: 'allow' offers it
// to the Phase 5 solve from the start, 'needed' only when Phase 5 does not fit without it, 'avoid'
// never. Maximum output starts from Phase 2. Phase 1 has no generators and runs on hand-fed
// biomass: maximising it finds no plan on the default 0 GW of spare power, and without that limit
// it scales to whatever the raw budgets allow at any power. Phase 1 gets the balanced plan instead.
// A whole-machine search that stops at its limit is rounded from the exact plan instead
// (`roundStopped`, #593) in every attempt whose failure the draft would explain: under 'needed'
// the attempt without conversion is followed by one with it, so only that one rounds.
// When the factory groups' own whole-machine lines (#875) make the phase proven infeasible while
// it fits with those items made centrally, it is planned that way instead (the owner's decision
// on #875), last and for the whole phase, and the stage records `onSiteDropped`: as with
// amplification and existing supply, an optional input never costs a plan that fits. A search
// that only stopped at a limit keeps the lines, through the fallbacks of the two-step fit.
// A group's part of a row with a fixed-rate membership follows the row's total (#984), which
// holds while the row makes at least its fixed rates: when a row makes less, the phase is
// planned again as withinRates says.
function solvePhase(config: CurrentSettings, phase: number): RunResult {
  return withinRates(config, phase, settings => solveSites(settings, phase));
}
// solvePhase's solve with the groups' own lines, or with every item made centrally.
function solveSites(config: CurrentSettings, phase: number): RunResult {
  const result = solveGoal(config, phase);
  if (result.feasible || stoppedSearch(result) || !config.wholeMachines) return result;
  const sites = plannedSites(config, phase);
  if (!Object.keys(sites).length) return result;
  const central = solveGoal(centralSettings(config), phase);
  return central.feasible ? { ...central, onSiteDropped: sites } : result;
}
// solvePhase's solve under the profile's goal and SAM conversion.
function solveGoal(config: CurrentSettings, phase: number): RunResult {
  const maximised = config.goal === 'maximum' && phase >= 2;
  const retried = phase === 5 && config.sam === 'needed';
  let result = run(
    config.goal === 'maximum' && !maximised ? { ...config, goal: 'balanced' } : config,
    phase,
    {
      maximum: maximised,
      conversion: phase === 5 && config.sam === 'allow',
      roundStopped: !retried,
    },
  );
  if (!result.feasible && retried)
    result = run(config, phase, {
      maximum: config.goal === 'maximum',
      conversion: true,
      roundStopped: true,
    });
  // For maximum output, compare conversion when allowed only at a binding resource limit.
  if (config.goal === 'maximum' && retried) {
    const converted = run(config, phase, { maximum: true, conversion: true, roundStopped: true });
    if (converted.feasible && (!result.feasible || converted.hours < result.hours - 1e-6))
      result = converted;
  }
  return result;
}
