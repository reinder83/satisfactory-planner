// What the save list and GET /api/context show of a profile: its progress per phase and its
// current hard-drive payoff ranking. Re-exported by ../state.ts.
import { milestoneOnlyPhases, phaseSteps } from '../progression.ts';
import type {
  CustomTask,
  PhaseProgress,
  Progression,
  StageKey,
  StoredCalculatedPlan,
  StoredPayoff,
  StoredProfile,
  TaskEdits,
} from '../types/index.ts';

// A calculated profile's progress per phase it plans, for the save list (SP-32): the production
// lines ticked Running (`calc-<stage>-<row id>`) over the phase's lines, from the profile's start
// phase on. Both editions' workspace summaries send it; none without a calculated plan.
export function phaseProgress(
  plan: StoredCalculatedPlan | null | undefined,
  checks: Record<string, boolean>,
): PhaseProgress[] | undefined {
  if (!plan) return undefined;
  const from = Number(plan.settings.phase || 1);
  return (Object.entries(plan.stages) as [StageKey, StoredCalculatedPlan['stages'][StageKey]][])
    .filter(([phase]) => Number(phase) >= from)
    .map(([phase, stage]) => {
      const rows = stage?.rows || [];
      return {
        phase,
        done: rows.filter(row => checks['calc-' + phase + '-' + row.id]).length,
        total: rows.length,
      };
    });
}

// What planStepIds reads of a profile's progress: its ticks, personal tasks and removed steps.
interface StepsState {
  checks: Record<string, boolean>;
  customTasks?: CustomTask[];
  taskEdits?: Partial<Pick<TaskEdits, 'removed'>>;
}

// The check ids of a stored plan's build-plan steps for `phase`, as the build plan lists them
// once that phase is open (planTasks() in app/tasks.ts, which phaseStepIds in
// app/opening-phase.ts asks for): the generated steps (phaseSteps in progression.ts) and the
// personal tasks of that phase, less the removed steps. The saved step order is left out: it
// only moves steps, and nothing that counts them depends on their order. Reads only its
// arguments, so both editions' summaries can work it out for a profile that is not open (#746).
export function planStepIds(
  plan: StoredCalculatedPlan,
  state: StepsState,
  data: Progression,
  phase: StageKey,
): string[] {
  const removed = new Set(state.taskEdits?.removed || []);
  return [
    ...phaseSteps(plan, state, data, phase).map(step => step.id),
    ...(state.customTasks || []).filter(task => task.phase === phase).map(task => task.id),
  ].filter(id => !removed.has(id));
}

// The save list's per-phase progress of a profile (ProfileSummary.phases, SP-32): phaseProgress's
// production lines and `steps`: the phase's build-plan steps (planStepIds, `data` is
// progression.json) ticked, over all of them. The profile card fills each phase with those, so a
// phase reads as finished only when the profile would not open on it (openingPhase, #570, #746).
// The milestone-only phases before the start phase (#759, milestoneOnlyPhases in progression.ts)
// come first, with no production lines (0 of 0) and their milestones as steps, so the card covers
// the phases the phase picker offers and names a milestone-only phase the profile opens on (#783).
export function profilePhases(
  plan: StoredCalculatedPlan | null | undefined,
  state: StepsState,
  data: Progression,
): PhaseProgress[] | undefined {
  const phases = phaseProgress(plan, state.checks);
  if (!plan || !phases) return phases;
  const milestoneOnly = milestoneOnlyPhases(plan).map(phase => ({ phase, done: 0, total: 0 }));
  return [...milestoneOnly, ...phases].map(entry => {
    const ids = planStepIds(plan, state, data, entry.phase);
    return {
      ...entry,
      steps: { done: ids.filter(id => state.checks[id]).length, total: ids.length },
    };
  });
}
// A profile's stored hard-drive payoff ranking (#203) while it was ranked against the plan the
// profile has now, otherwise null. GET /api/context sends this in both editions.
export const currentPayoff = (
  profile: Pick<StoredProfile, 'plan' | 'payoff'>,
): StoredPayoff | null =>
  profile.plan && profile.payoff?.planCreatedAt === profile.plan.createdAt ? profile.payoff : null;
