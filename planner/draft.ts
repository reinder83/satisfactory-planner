// The draft of a phase that does not fit, and the reason it gives.
import { listNames } from '../public/wording.ts';
import type { CurrentSettings, CurrentStage } from '../public/types/index.ts';
import type { Solved, RunResult } from './types.ts';
import { RAW } from './data.ts';
import { run, goalHours } from './model.ts';
import type { Unsolved } from './calculate.ts';
import { warningDuration } from './warnings.ts';

// What the draft of a phase that does not fit is diagnosed with: the settings without production
// amplification (`plain`) and the phase's SAM conversion.
interface DraftContext {
  config: CurrentSettings;
  phase: number;
  plain: CurrentSettings;
  conversion: boolean;
}
// Infeasible phase: build a draft that explains why. The diagnostic is the exact LP with every
// budget lifted, so its `raw` shows what the goal would need. Three outcomes, in order: the
// search stopped (no shortage proven); the recipes and power options cannot make it at all; or
// it is a budget problem, split into "only whole machines break it" and a real shortfall.
// The draft only explains what exceeds the budgets: the exact LP is fast and avoids another integer search.
// The diagnostics solve without production amplification (the owner's choice in #64): the
// exact LP stays fast and cannot time out on the amplified integer fit, and the reason says
// the amounts are before amplification when somersloops are budgeted for it.
export function draftStage(config: CurrentSettings, phase: number, result: Unsolved): CurrentStage {
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
    const draft: DraftContext = { config, phase, plain, conversion };
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
// Does the exact LP fit the real budgets at `hours` hours for this phase?
const fitsInHours = ({ plain, phase, conversion }: DraftContext, hours: number) =>
  run({ ...plain, wholeMachines: false, goal: 'timed', hours }, phase, { conversion }).feasible;
// Only rounding up to whole machines breaks a budget here. Re-fit the same recipe network with
// doubled budgets to measure which resources need headroom and how much; keep bounds modest for
// MIP stability. Sets `wholeMachinesOnly` and the `shortfalls` it measured on the draft.
function wholeMachinesReason(
  stage: CurrentStage,
  { config, phase, plain, conversion }: DraftContext,
) {
  stage.wholeMachinesOnly = true;
  const network = run({ ...plain, wholeMachines: false }, phase, { conversion });
  const rounded: RunResult = network.feasible
    ? run(
        {
          ...plain,
          limits: Object.fromEntries(
            RAW.map(resource => [resource, config.limits[resource]! * 2 + 600]),
          ),
        },
        phase,
        // Fractional nuclear plants, as the plan itself falls back to: the shortfall
        // is about the solid-part lines.
        {
          conversion,
          recipeIds: new Set(network.rows.map(row => row.id)),
          fractionalNuclear: true,
        },
      )
    : { feasible: false };
  if (rounded.feasible)
    stage.shortfalls = RAW.filter(
      resource => (rounded.raw[resource] || 0) > config.limits[resource]! + 0.001,
    ).map(resource => ({
      name: resource,
      needed: Math.ceil(rounded.raw[resource]!),
      budget: config.limits[resource]!,
    }));
  const names = (stage.shortfalls || []).map(shortfall => shortfall.name);
  return names.length
    ? `Precise balancing fits these budgets, but whole solid-part machines at 100% need more ${listNames(names)}. Raise ${names.length > 1 ? 'those budgets' : 'that budget'} a little, or turn off whole-machine production for this profile.`
    : 'Mixed-recipe balancing fits these budgets, but running solid-part machines whole at 100% does not. Add some budget headroom or turn off whole-machine production for this profile.';
}
// A real budget shortfall: what the diagnostic draws beyond the budgets, and the time at which
// the phase would fit them. Sets `shortfalls` and `minHours` on the draft.
function shortfallReason(
  stage: CurrentStage,
  draft: DraftContext,
  diagnostic: Solved,
  currentHours: number,
) {
  const { config } = draft;
  const shortfalls = RAW.filter(
    resource => (diagnostic.raw[resource] || 0) > config.limits[resource]! + 0.05,
  ).map(resource => ({
    name: resource,
    needed: Math.ceil(diagnostic.raw[resource]!),
    budget: config.limits[resource]!,
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
