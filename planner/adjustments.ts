// The adjustments calculate() makes to the finished stages: the target time on the final phase
// (phaseTime 'final') and the verdict on fueling the augmenters.
import { listNames } from '../public/wording.ts';
import type { CurrentSettings, StageResult } from '../public/types/index.ts';
import type { Solved, RunResult } from './types.ts';
import { run } from './model.ts';
import { stageSettings, withinRates } from './on-site.ts';
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
    // A phase that makes its on-site items centrally (#875) is re-solved that way too, and a row
    // that makes less than its fixed rates as solvePhase plans it (#984).
    const ahead = withinRates(stageSettings(config, stages[phase]), phase, settings =>
      run(settings, phase, { maximum: true, caps }),
    );
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
  const unfueled = solveUnfueled(stageSettings(config, stages[5]));
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
    // The power each plan needs and has, as its grid sizes them (#1064).
    requiredMW: fueled.grid.needMW,
    requiredMWUnfueled: unfueled.feasible ? unfueled.grid.needMW : null,
    availableMW: fueled.grid.availableMW,
    availableMWUnfueled: unfueled.feasible ? unfueled.grid.availableMW : null,
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
// Minimal construction (#1066): the fewest buildings for the goal's 24-hour deliveries, run as
// fast as those buildings allow, rather than every line clocked down to stretch the phase to the
// 24 hours. The phase is solved again for maximum output with each line, generators included,
// capped at the machines the 24-hour plan builds (`caps`, as the target time on the final phase
// caps an earlier phase), so not one building is added; the pace rises until a line runs out of
// machines. The faster plan is kept only when it finishes strictly sooner, recording the hours it
// replaces as `aheadOf`, as resolveEarlierPhases does. A re-solve that does not fit or stopped at
// a limit keeps the 24-hour plan, and so does Phase 1, whose hand-fed biomass the planner cannot
// run harder (a maximising solve of Phase 1 has only the entered spare power, see addPower).
// A phase that makes its on-site items centrally (#875) is re-solved that way too, and keeps
// saying so; a row that makes less than its fixed rates is planned as solvePhase plans it (#984).
export function fullSpeed(config: CurrentSettings, phase: number, stage: Solved): Solved {
  const caps = Object.fromEntries(stage.rows.map(row => [row.id, row.machines]));
  const fast = withinRates(stageSettings(config, stage), phase, settings =>
    run(settings, phase, {
      maximum: true,
      caps,
      conversion: phase === 5 && config.sam !== 'avoid',
    }),
  );
  if (!fast.feasible || !(fast.hours < stage.hours - 1e-6)) return stage;
  return {
    ...fast,
    aheadOf: stage.hours,
    ...(stage.onSiteDropped ? { onSiteDropped: stage.onSiteDropped } : {}),
  };
}
// Minimal construction's warning (#1066): what the goal plans, and which phases finish before the
// 24 hours because their buildings run as fast as they allow. `sooner` lists those phases.
export function fullSpeedWarning(config: CurrentSettings, sooner: number[]): string[] {
  if (config.goal !== 'minimal') return [];
  const phases = sooner.length
    ? ` ${sooner.length > 1 ? 'Phases' : 'Phase'} ${listNames(sooner.map(String))} ${sooner.length > 1 ? 'finish' : 'finishes'} sooner that way; ${sooner.length > 1 ? 'their' : 'its'} delivery rates are not rounded.`
    : ' No phase could finish sooner with those buildings.';
  return [
    `Minimal construction builds the fewest machines that deliver each phase within 24 hours, then runs them as fast as those buildings allow, without adding one.${phases}`,
  ];
}
