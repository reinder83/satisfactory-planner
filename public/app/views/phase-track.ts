// The top bar's phase track (SP-44, #279, ui/Shell.vue): one segment per phase the phase picker
// offers (phaseOptions()), each with how far its checklist has come. A calculated profile counts
// its production lines ticked Running, as the profile card's bar does (phaseProgress in state.ts,
// SP-32); the handbook counts its phase steps. Post-game has no checklist of its own, so its
// segment shows no progress. Only saved checks are read.
import { phaseProgress } from '../../state.ts';
import { calculated, checked, phaseLabel, phaseOptions, plan, state } from '../session.ts';
import type { Phase } from '../../types/index.ts';

export interface PhaseSegment {
  phase: Phase;
  label: string;
  // Whole percent of the phase's checklist done, null where the phase has none to count.
  pct: number | null;
}

// A milestone-only phase before a calculated profile's start phase (#759) has no production lines
// to count, so its segment counts its build-plan steps, which are its milestones (phaseStepIds,
// as the build plan's progress bar counts them). Imported here, apart from the imports above,
// which another change edits.
import { phaseStepIds } from '../opening-phase.ts';
import { milestoneOnly } from '../session.ts';

export function phaseTrack(): PhaseSegment[] {
  const counted = calculated ? phaseProgress(calculated, state?.checks ?? {}) : undefined;
  return phaseOptions().map(phase => {
    let done = 0,
      total = 0;
    if (phase !== 'post' && milestoneOnly(phase)) {
      const ids = phaseStepIds(phase);
      done = ids.filter(checked).length;
      total = ids.length;
    } else if (phase !== 'post' && calculated) {
      const progress = counted?.find(c => c.phase === phase);
      done = progress?.done ?? 0;
      total = progress?.total ?? 0;
    } else if (phase !== 'post') {
      const steps = plan?.phases?.[phase] ?? [];
      done = steps.filter(t => checked(t.id)).length;
      total = steps.length;
    }
    return {
      phase,
      label: phaseLabel(phase),
      pct: total ? Math.round((done / total) * 100) : null,
    };
  });
}
