// The top bar's phase track (SP-44, #279, ui/Shell.vue): one segment per phase the phase picker
// offers (phaseOptions()), each with how far its checklist has come. A calculated profile counts
// its build-plan steps ticked, at most 99% while one is open (#770), as the profile card does
// (profilePhases in state/summary.ts, #746). Post-game has no checklist of its own, and nothing
// has one while no profile is open, so their segments show no progress. Only saved checks are
// read.
import { phaseStepIds } from '../opening-phase.ts';
import {
  calculated,
  checked,
  phaseLabel,
  phaseOptions,
  progressionData,
  state,
} from '../session.ts';
import type { Phase, StageKey } from '../../types/index.ts';

export interface PhaseSegment {
  phase: Phase;
  label: string;
  // Whole percent of the phase's checklist done, null where the phase has none to count.
  pct: number | null;
}

// A calculated profile's segment counts the phase's build-plan steps (phaseStepIds, #770): the
// steps its build plan lists and its progress bar counts (ui/plan/PlanProgress.vue), base tasks,
// power, milestones, hard drives, production lines, storage and personal tasks, with its edits
// applied. A milestone-only phase before the start phase (#759) counts its milestones, which are
// its steps. So the track agrees with the build plan and with the phase the profile opens on
// (phaseToOpen, #570), which looks at the same steps, and with the profile card, whose summary
// counts the same steps without the session (planStepIds in state/summary.ts, #746).
//
// Working out a phase's step ids no longer writes any step text (planTaskIds, #768), but it still
// runs the phase's progression (phaseSteps in progression.ts) and applies its edits: about 2.7 ms
// for the five phases of the default calculated plan, against about 0.01 ms with the ids kept
// (#794). The frame draws the track again on every redraw (a save indicator, a tick), so each
// phase's step ids are kept while the open plan, progress state and progression data are the
// same objects: session.ts replaces the state on every saved change (setState) rather than
// editing it, and opening another profile replaces all three. The ticks are counted afresh every
// time.
let cachedFor: readonly unknown[] = [];
let cachedIds = new Map<StageKey, string[]>();
function stepIdsOf(phase: StageKey): string[] {
  const key = [calculated, state, progressionData];
  if (key.some((part, i) => part !== cachedFor[i])) {
    cachedFor = key;
    cachedIds = new Map();
  }
  let ids = cachedIds.get(phase);
  if (!ids) cachedIds.set(phase, (ids = phaseStepIds(phase)));
  return ids;
}

// A phase's ticked share as a whole percent: a phase with an open step reads at most 99%, so it
// never says "100% done" while the build plan still lists work (as the profile card, #746).
const share = (done: number, total: number): number | null =>
  !total ? null : done >= total ? 100 : Math.min(99, Math.round((done / total) * 100));

export function phaseTrack(): PhaseSegment[] {
  return phaseOptions().map(phase => {
    let done = 0,
      total = 0;
    if (phase !== 'post' && calculated) {
      const ids = stepIdsOf(phase);
      done = ids.filter(checked).length;
      total = ids.length;
    }
    return { phase, label: phaseLabel(phase), pct: share(done, total) };
  });
}
