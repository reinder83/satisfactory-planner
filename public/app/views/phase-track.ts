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

export function phaseTrack(): PhaseSegment[] {
  const counted = calculated ? phaseProgress(calculated, state?.checks ?? {}) : undefined;
  return phaseOptions().map(p => {
    let done = 0,
      total = 0;
    if (p !== 'post' && calculated) {
      const x = counted?.find(c => c.phase === p);
      done = x?.done ?? 0;
      total = x?.total ?? 0;
    } else if (p !== 'post') {
      const steps = plan?.phases?.[p] ?? [];
      done = steps.filter(t => checked(t.id)).length;
      total = steps.length;
    }
    return {
      phase: p,
      label: phaseLabel(p),
      pct: total ? Math.round((done / total) * 100) : null,
    };
  });
}
