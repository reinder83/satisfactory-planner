// Which phase a profile opens on (#570), in both editions: loadContext() in session.ts works it
// out for every profile it opens, a new one (the wizard's Create profile, Round up production,
// Recalculate with transport fuel) and an existing one (boot, Open profile). The profile opens on
// the phase the user said they are in, its saved working phase, unless an earlier phase it plans
// still has an open check: then it opens on the first such phase, so the build plan starts at work
// that is not done yet. Only the view changes: the saved phase stays what the user picked, and the
// phase picker saves a new one as before. Nothing here writes progress.
import { progression } from '../progression.ts';
import { calculated, plan, progressionData, startPhase, state } from './session.ts';
import { taskEditsState } from './tasks.ts';
import type { Phase, StageKey } from '../types/index.ts';

// The phases with a checklist of their own, in order; post-game comes after Phase 5 and has none
// that an earlier phase could hold open.
const PLANNED_PHASES: StageKey[] = ['1', '2', '3', '4', '5'];

// The phase to open on: the first phase from `start` (the profile's first phase) up to, not
// including, `chosen` (the saved working phase) with a step id `checks` does not tick, else
// `chosen`. `stepIds` gives a phase's checklist as the build plan shows it; it is only asked for
// the phases before `chosen`, and no further than the first open one. A `chosen` phase before
// `start` is returned as it is (phase() raises it to the start phase).
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

// The check ids of a phase's build-plan steps as the open profile shows them (planTasks() in
// tasks.ts for that phase): its generated steps and personal tasks, less the removed ones. A
// milestone counts in each phase whose list shows it, so it holds open the first of them.
export function phaseStepIds(phase: StageKey): string[] {
  const removed = new Set(taskEditsState().removed);
  const personal = state.customTasks.filter(task => task.phase === phase).map(task => task.id);
  return [...generatedStepIds(phase), ...personal].filter(id => !removed.has(id));
}

// The ids calcTasks() in views/calculated.ts (a calculated profile, or its guide) or the handbook
// gives the phase, in no particular order. Post-game plans Phase 5's stage, so its production
// steps have Phase 5's ids, as calcTasks() gives them (shared-steps.ts asks for every phase).
export function generatedStepIds(phase: Phase): string[] {
  if (!calculated) return (plan.phases[phase] ?? []).map(task => task.id);
  if (calculated.guide) return (calculated.guide.phases[phase] ?? []).map(task => task.id);
  const steps = progression(calculated, state, progressionData, phase),
    stage: StageKey = phase === 'post' ? '5' : phase;
  return [
    ...[
      ...steps.baseTasks,
      ...steps.powerTasks,
      ...steps.milestoneTasks,
      ...steps.hardDrives,
      ...steps.retire,
    ].map(task => task.id),
    ...(calculated.stages[stage]?.rows || []).map(row => 'calc-' + stage + '-' + row.id),
    'calc-' + stage + '-storage',
  ];
}

// The phase the open profile opens on (openingPhase for its saved phase, start phase and checks).
export const phaseToOpen = (): Phase =>
  openingPhase(state.settings.phase, startPhase(), phaseStepIds, state.checks);
