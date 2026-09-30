// What the save list and GET /api/context show of a profile: its progress per phase and its
// current hard-drive payoff ranking. Re-exported by ../state.ts.
import type {
  PhaseProgress,
  StageKey,
  StoredCalculatedPlan,
  StoredPayoff,
  StoredProfile,
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
    .filter(([ph]) => Number(ph) >= from)
    .map(([ph, x]) => {
      const rows = x?.rows || [];
      return {
        phase: ph,
        done: rows.filter(r => checks['calc-' + ph + '-' + r.id]).length,
        total: rows.length,
      };
    });
}
// A profile's stored hard-drive payoff ranking (#203) while it was ranked against the plan the
// profile has now, otherwise null. GET /api/context sends this in both editions.
export const currentPayoff = (p: Pick<StoredProfile, 'plan' | 'payoff'>): StoredPayoff | null =>
  p.plan && p.payoff?.planCreatedAt === p.plan.createdAt ? p.payoff : null;
