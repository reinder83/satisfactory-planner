// What the save list and GET /api/context show of a profile: its progress per phase and its
// current hard-drive payoff ranking. Re-exported by ../state.ts.
import { milestoneOnlyPhases, phaseSteps, type StepsMemo } from '../progression.ts';
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

// What planStepIds reads of a profile's progress: its ticks, delivery counts, personal tasks and
// removed steps.
// profilePhases also reads the phase worked on (`settings.phase`), when there is one.
interface StepsState {
  checks: Record<string, boolean>;
  // The delivery counts, which the delivery step's own condition reads (#1070).
  deliveries?: Record<string, number>;
  customTasks?: CustomTask[];
  taskEdits?: Partial<Pick<TaskEdits, 'removed'>>;
  settings?: { phase?: string };
}

// The check ids of a stored plan's build-plan steps for `phase`, as the build plan lists them
// once that phase is open (planTasks() in app/tasks.ts, which phaseStepIds in
// app/opening-phase.ts asks for): the generated steps (phaseSteps in progression.ts) and the
// personal tasks of that phase, less the removed steps. The saved step order is left out: it
// only moves steps, and nothing that counts them depends on their order. Reads only its
// arguments, so both editions' summaries can work it out for a profile that is not open (#746).
// `memo` lets calls for several phases of the same plan and progress share work (phaseSteps).
export function planStepIds(
  plan: StoredCalculatedPlan,
  state: StepsState,
  data: Progression,
  phase: StageKey,
  memo: StepsMemo = {},
): string[] {
  return planSteps(plan, state, data, phase, memo).map(step => step.id);
}

// planStepIds' steps, each with whether it is done by its own condition (`satisfied`, #1070).
function planSteps(
  plan: StoredCalculatedPlan,
  state: StepsState,
  data: Progression,
  phase: StageKey,
  memo: StepsMemo,
): { id: string; satisfied?: string }[] {
  const removed = new Set(state.taskEdits?.removed || []);
  return [
    ...phaseSteps(plan, state, data, phase, memo),
    ...(state.customTasks || []).filter(task => task.phase === phase),
  ].filter(step => !removed.has(step.id));
}

// The save list's per-phase progress of a profile (ProfileSummary.phases, SP-32): phaseProgress's
// production lines and `steps`: the phase's build-plan steps (planStepIds, `data` is
// progression.json) ticked, over all of them. The profile card fills each phase with those, so a
// phase reads as finished only when the profile would not open on it (openingPhase, #570, #746).
// The milestone-only phases before the start phase (#759, milestoneOnlyPhases in progression.ts)
// come first, with no production lines (0 of 0) and their milestones as steps, so the card covers
// the phases the phase picker offers and names a milestone-only phase the profile opens on (#783).
// Only the phases up to the one worked on (`state.settings.phase`, Post Phase 5 as Phase 5) get
// `steps`: the card draws a later phase empty and never reads its counts, and working them out
// was most of the summary's time (#804). Without a phase worked on, every phase gets them.
export function profilePhases(
  plan: StoredCalculatedPlan | null | undefined,
  state: StepsState,
  data: Progression,
): PhaseProgress[] | undefined {
  const phases = phaseProgress(plan, state.checks);
  if (!plan || !phases) return phases;
  const milestoneOnly = milestoneOnlyPhases(plan).map(phase => ({ phase, done: 0, total: 0 }));
  const working = state.settings?.phase === 'post' ? 5 : Number(state.settings?.phase),
    memo: StepsMemo = {};
  return [...milestoneOnly, ...phases].map(entry => {
    if (Number(entry.phase) > working) return entry;
    const steps = planSteps(plan, state, data, entry.phase, memo);
    const done = steps.filter(step => state.checks[step.id] || step.satisfied).length;
    return { ...entry, steps: { done, total: steps.length } };
  });
}

// What profilePhases' result for a profile depends on, as one string: its plan (a profile's plan
// is never replaced or edited: a recalculation or round-up makes a new profile, so its creation
// time, start phase, guide and row counts tell plans apart), the phase worked on, its ticks, its
// personal tasks and its removed steps. Any tick, edit or phase change changes it.
const phasesKey = (plan: StoredCalculatedPlan | null | undefined, state: StepsState): string =>
  JSON.stringify([
    plan
      ? [
          plan.createdAt,
          plan.settings?.phase,
          !!plan.guide,
          Object.entries(plan.stages).map(([key, stage]) => [key, stage?.rows?.length]),
        ]
      : null,
    state.settings?.phase,
    state.checks,
    state.deliveries ?? {},
    state.customTasks ?? [],
    state.taskEdits?.removed ?? [],
  ]);

// profilePhases with each profile's result kept until its plan or progress changes (#804), for a
// workspace summary that lists every profile each time it is asked for (summary() in
// server/scope.ts, the browser edition's GET /api/workspace). Keyed by profile id, and checked
// against phasesKey and the progression data, so a stale count is never sent: a tick, an edit or
// another phase worked on works the counts out again. Keeps at most `limit` profiles, dropping
// the longest unused. Each call returns its own copy, so a caller may change it freely.
export function profilePhasesCache(limit = 1000) {
  const kept = new Map<
    string,
    { key: string; data: Progression; phases: PhaseProgress[] | undefined }
  >();
  return (
    profileId: string,
    plan: StoredCalculatedPlan | null | undefined,
    state: StepsState,
    data: Progression,
  ): PhaseProgress[] | undefined => {
    const key = phasesKey(plan, state);
    let entry = kept.get(profileId);
    kept.delete(profileId);
    if (!entry || entry.key !== key || entry.data !== data)
      entry = { key, data, phases: profilePhases(plan, state, data) };
    kept.set(profileId, entry);
    // Over the limit the map holds at least one profile, so it has a first key.
    if (kept.size > limit) kept.delete(kept.keys().next().value!);
    return entry.phases?.map(phase => ({
      ...phase,
      ...(phase.steps ? { steps: { ...phase.steps } } : {}),
    }));
  };
}
// A profile's stored hard-drive payoff ranking (#203) while it was ranked against the plan the
// profile has now, otherwise null. GET /api/context sends this in both editions.
export const currentPayoff = (
  profile: Pick<StoredProfile, 'plan' | 'payoff'>,
): StoredPayoff | null =>
  profile.plan && profile.payoff?.planCreatedAt === profile.plan.createdAt ? profile.payoff : null;
