// Build-plan steps one id shares between phases (#744). Post-game plans Phase 5's stage, so it
// lists Phase 5's steps (a milestone is listed in one phase only, its own, since #758, an
// alternate recipe's unlock in the first phase that uses it, since #870, and the biomass start-up
// in the start phase, since #872): one checkmark, one edited title and one removal
// (taskEdits.removed holds step ids, not phases). Removing or restoring such a step therefore changes every phase that lists
// it, and the build plan says so where it happens: in the toast after Remove (PlanStep.vue)
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

// The toast after Remove on a step (#1334): what went, with its Undo; for one other phases list too,
// it says it went from them too. Its checkmark is kept either way.
export function removedStepNews(id: string, title: string): string {
  const phases = sharedStepPhases([id]).get(id);
  const also = phases
    ? ` ${andList(phases)} ${phases.length > 1 ? 'list' : 'lists'} the same step, so it is removed there too.`
    : '';
  return `Removed “${title}” from your build plan.${also} Its checkmark is kept.`;
}
export const restoredStepNews = (title: string) => `“${title}” is back in your build plan.`;
