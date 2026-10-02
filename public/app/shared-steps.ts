// Build-plan steps one id shares between phases (#744). A milestone, an alternate recipe's
// unlock or the biomass start-up is one thing in the game, so every phase that lists it shows
// the same step: one checkmark, one edited title and one removal (taskEdits.removed holds step
// ids, not phases). Removing or restoring such a step therefore changes every phase that lists
// it, and the build plan says so where it happens: in the Remove confirmation (PlanStep.vue)
// and under the step in "Removed steps in this phase" (RemovedSteps.vue). Nothing here writes.
import { generatedStepIds } from './opening-phase.ts';
import { phase, phaseLabel, phaseOptions } from './session.ts';
import { andList } from './views/calculated.ts';

// For each of `ids`, the labels of the profile's other phases ("Phase 4", "Post Phase 5") whose
// build plan lists the same step; ids no other phase lists are left out.
export function sharedStepPhases(ids: readonly string[]): Map<string, string[]> {
  const current = phase(),
    shared = new Map<string, string[]>();
  if (!ids.length) return shared;
  for (const other of phaseOptions()) {
    if (other === current) continue;
    const listed = new Set(generatedStepIds(other));
    for (const id of ids)
      if (listed.has(id)) shared.set(id, [...(shared.get(id) || []), phaseLabel(other)]);
  }
  return shared;
}

// The line under a removed step that other phases list too.
export const sharedRemovedNote = (phases: readonly string[]) =>
  `Also in ${andList(phases)}: removed and restored there too.`;

// The Remove confirmation for a step: for one other phases list too, it says it goes there too.
export function removeStepBody(id: string): string {
  const phases = sharedStepPhases([id]).get(id);
  return phases
    ? `Remove this step from your build plan? ${andList(phases)} ${phases.length > 1 ? 'list' : 'lists'} the same step, so it is removed there too. Its checkmark is kept and you can restore the step while editing.`
    : 'Remove this step from your build plan? Its checkmark is kept and you can restore the step while editing.';
}
