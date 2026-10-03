// The adjustments calculate() makes to the finished stages: the target time on the final phase
// (phaseTime 'final') and the verdict on fueling the augmenters.
import { listNames } from '../public/wording.ts';
import type { CurrentSettings, StageResult } from '../public/types/index.ts';
import type { Solved, RunResult } from './types.ts';
import { run } from './model.ts';
import type { PhaseStages } from './calculate.ts';

// With the target time on the final phase, an earlier phase may run its lines as
// hard as the machines a later phase already builds allow, so it finishes sooner
// without adding a building the plan later drops. A phase is never made slower,
// and nothing is pulled forward past what its own phase can unlock and power.
// Returns the warning that says what happened, or none when this does not apply.
export function pullFinalPhaseForward(config: CurrentSettings, stages: PhaseStages): string[] {
  if (
    config.phaseTime !== 'final' ||
    config.goal === 'maximum' ||
    !Object.values(stages).every(stage => stage.feasible)
  )
    return [];
  const stopped = resolveEarlierPhases(config, stages);
  return [finalPhaseWarning(stages, stopped)];
}
// built[phase] = { recipeId: whole machines } as each phase's plan builds it. Phase n's caps
// are the most machines any phase from n to 5 builds, so running a line harder than its own
// plan asks never needs a building that is not built anyway. The re-solve maximises output
// under those caps, and is kept only when it finishes strictly sooner, recording the time it
// replaces as `aheadOf` (shown by public/app/ui/wizard/ReviewStep.vue). A re-solve that
// stopped at its limit ('Unknown' at the node limit, 'Time limit reached' at the backstop or
// Phase 5's deadline) proves nothing either way: that phase keeps its own plan, and the warning
// says the search stopped instead of claiming it could not finish sooner (#650). Returns those
// phases.
function resolveEarlierPhases(config: CurrentSettings, stages: PhaseStages): number[] {
  const built: Record<number, Record<string, number>> = {};
  const stopped: number[] = [];
  for (let phase = 1; phase <= 5; phase++)
    for (const row of stages[phase]!.rows || [])
      built[phase] = { ...built[phase], [row.id]: row.machines };
  for (let phase = 1; phase <= 4; phase++) {
    const caps: Record<string, number> = {};
    for (let later = phase; later <= 5; later++)
      for (const [id, machines] of Object.entries(built[later] || {}))
        caps[id] = Math.max(caps[id] || 0, machines);
    const ahead = run(config, phase, { maximum: true, caps });
    if (ahead.feasible && ahead.hours < stages[phase]!.hours! - 1e-6)
      stages[phase] = { ...ahead, aheadOf: stages[phase]!.hours! };
    else if (!ahead.feasible && ahead.solverStatus && !/infeasible/i.test(ahead.solverStatus))
      stopped.push(phase);
  }
  return stopped;
}
// The phaseTime 'final' warning: how many phases finish sooner, and which searches stopped.
function finalPhaseWarning(stages: PhaseStages, stopped: number[]): string {
  const pulled = Object.values(stages).filter(stage => stage.aheadOf !== undefined).length;
  const sentences = ['Your target time applies to Phase 5.'];
  if (pulled)
    sentences.push(
      `Earlier phases run their lines as hard as the machines a later phase already builds allow, so ${pulled === 1 ? 'one phase finishes' : pulled + ' phases finish'} sooner; no building is added that a later phase does not keep. Delivery rates for those phases are not rounded.`,
    );
  else if (stopped.length < 4)
    sentences.push(
      `No ${stopped.length ? 'other ' : ''}earlier phase could finish sooner within the machines its later phases already build.`,
    );
  if (stopped.length) {
    const many = stopped.length > 1;
    const names = listNames(stopped.map(String));
    sentences.push(
      `For ${many ? 'Phases' : 'Phase'} ${names}, the search stopped before it could prove the best plan, so ${many ? 'those phases keep their' : 'that phase keeps its'} own target time; whether ${many ? 'they' : 'it'} could finish sooner has not been checked.`,
    );
  }
  return sentences.join(' ');
}
// Fueling an augmenter buys 20% more grid power in exchange for an Alien Power Matrix line.
// Whether that pays depends on the plan's own scale, so solve Phase 5 again without the fuel
// and compare like for like: same goal, same budgets, same recipes. Records the answer as Phase
// 5's `fuelVerdict`, or returns the warning that no answer was proven.
export function judgeAugmenterFuel(config: CurrentSettings, stages: PhaseStages): string[] {
  if (!config.fueledAugmenters || !stages[5]?.feasible) return [];
  const unfueled = solveUnfueled(config);
  // A search stopped at its limit ('Unknown' at the node limit, 'Time limit reached' at the
  // backstop or Phase 5's deadline) proves no shortage, so it must not read as "does not fit".
  // Only the attempt whose result is used counts: the retry with conversion allows every recipe
  // the first attempt could use, so the retry proving the plan does not fit is the answer even
  // when the first attempt stopped (#665), as solvePhase reads the Phase 5 solve itself.
  const stopped =
    !unfueled.feasible && !!unfueled.solverStatus && !/infeasible/i.test(unfueled.solverStatus);
  // Without a proven unfueled answer there is nothing to compare (#634): no verdict, and the
  // plan's assumptions say why, as the other stopped searches do.
  if (!unfueled.feasible && stopped)
    return [
      'Fueling the augmenters could not be compared with an unfueled Phase 5: the search stopped before it could prove the best plan without the fuel, so no verdict is given on whether fueling pays off. No resource shortage has been established for the unfueled plan.',
    ];
  const fueled = stages[5] as Solved;
  stages[5] = { ...fueled, fuelVerdict: fuelVerdict(config, fueled, unfueled) };
  return [];
}
// Phase 5 without the augmenters' fuel: first with SAM conversion only under 'allow', then,
// if that does not fit, with it unless the profile avoids it.
function solveUnfueled(config: CurrentSettings): RunResult {
  const options = { maximum: config.goal === 'maximum' };
  const attempt = (conversion: boolean) =>
    run({ ...config, fueledAugmenters: 0 }, 5, { ...options, conversion });
  const result = attempt(config.sam === 'allow');
  return !result.feasible && config.sam !== 'avoid' ? attempt(true) : result;
}
// `fuelVerdict` (rendered by public/app/ui/wizard/FuelVerdict.vue) compares the
// fueled plan with the unfueled one: fewer buildings wins, or fewer hours under maximum.
function fuelVerdict(config: CurrentSettings, fueled: Solved, unfueled: RunResult) {
  const count = (stage: Partial<StageResult>) =>
    (stage.rows || []).reduce((total, row) => total + row.machines, 0);
  return {
    unfueledFeasible: !!unfueled.feasible,
    buildings: count(fueled),
    buildingsUnfueled: unfueled.feasible ? count(unfueled) : null,
    requiredMW: fueled.requiredMW,
    requiredMWUnfueled: unfueled.feasible ? unfueled.requiredMW : null,
    availableMW: fueled.availableMW,
    availableMWUnfueled: unfueled.feasible ? unfueled.availableMW : null,
    hours: fueled.hours,
    hoursUnfueled: unfueled.feasible ? unfueled.hours : null,
    matrixRate: fueled.matrixRate,
    worthIt:
      !unfueled.feasible ||
      (config.goal === 'maximum'
        ? fueled.hours < unfueled.hours - 1e-6
        : count(fueled) < count(unfueled)),
  };
}
