// Which phase a profile opens on (#570), in both editions: loadContext() in session.ts works it
// out for every profile it opens, a new one (the wizard's Create profile, Round up production,
// Recalculate with transport fuel) and an existing one (boot, Open profile). The profile opens on
// the phase the user said they are in, its saved working phase, unless an earlier phase it plans
// still has an open check: then it opens on the first such phase, so the build plan starts at work
// that is not done yet. Only the view changes: the saved phase stays what the user picked, and the
// phase picker saves a new one as before. Nothing here writes progress.
import { firstPhase, state } from './session.ts';
import { generatedTaskIds, planTaskIds, satisfiedStepIds } from './tasks.ts';
import type { Phase, StageKey } from '../types/index.ts';

// The phases with a checklist of their own, in order; post-game comes after Phase 5 and has none
// that an earlier phase could hold open.
const PLANNED_PHASES: StageKey[] = ['1', '2', '3', '4', '5'];

// The phase to open on: the first phase from `start` (the profile's first phase, firstPhase() in
// session.ts, which may be a milestone-only one, #759) up to, not including, `chosen` (the saved
// working phase) with a step id `checks` does not tick, else `chosen`. `stepIds` gives a phase's
// checklist as the build plan shows it; it is only asked for the phases before `chosen`, and no
// further than the first open one. A `chosen` phase before `start` is returned as it is (phase()
// raises it to the first phase).
export function openingPhase(
  chosen: Phase,
  start: StageKey,
  stepIds: (phase: StageKey) => string[],
  checks: Record<string, boolean>,
): Phase {
  for (const phase of PLANNED_PHASES) {
    if (phase === chosen) break;
    if (Number(phase) < Number(start)) continue;
    if (stepIds(phase).some(id => !checks[id])) return phase;
  }
  return chosen;
}

// The check ids of a phase's build-plan steps as the open profile shows them, in their order:
// the ids of planTasks() in tasks.ts for that phase, worked out without the step text
// (planTaskIds, #768). Its generated steps and personal tasks, less the removed ones. A
// milestone is listed once, under its own phase (milestonesListedIn in progression.ts, #758), so
// it holds that phase open.
export const phaseStepIds = (phase: StageKey): string[] => planTaskIds(phase);

// The ids of the phase's generated steps, before edits: the ids of generatedTasks() in tasks.ts
// without the step text (generatedTaskIds: orderedPhaseSteps in views/calculated.ts, phaseSteps
// in progression.ts with the production steps in factory-group order, for a calculated profile
// or its guide, else none). Post-game plans Phase 5's stage, so its production steps
// have Phase 5's ids (shared-steps.ts asks for every phase).
export const generatedStepIds = (phase: Phase): string[] => generatedTaskIds(phase);

// The phase the open profile opens on (openingPhase for its saved phase, first phase and checks).
// A calculated profile's first phase is Phase 1, so open milestones of a milestone-only phase
// before its start phase hold that phase open like any earlier phase (#759).
// A step done by its own condition (satisfiedStepIds in tasks.ts, #1070) holds no phase open.
export const phaseToOpen = (): Phase =>
  openingPhase(state.settings.phase, firstPhase(), openStepIds, state.checks);

// A phase's step ids (phaseStepIds) less those done by their own condition.
function openStepIds(phase: StageKey): string[] {
  const satisfied = satisfiedStepIds(phase);
  return phaseStepIds(phase).filter(id => !satisfied.has(id));
}
