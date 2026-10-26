// What the tests of the cap on hard drives (#1233) read of a plan.
import type {
  CurrentCalculatedPlan,
  StageKey,
  StoredCalculatedPlan,
} from '../../public/types/index.ts';

const PHASES: StageKey[] = ['1', '2', '3', '4', '5'];
type Plan = CurrentCalculatedPlan | StoredCalculatedPlan;

// A plan without the time it was made and its cap on hard drives, which is all a cap that changes
// nothing may differ in.
export const driveless = (plan: Plan): string => {
  const { driveCap: _cap, ...rest } = plan.settings;
  return JSON.stringify({ ...plan, settings: rest, createdAt: '' });
};

// The hard-drive alternates a plan counts on, as its hard-drive steps list them: the recipes of the
// rows marked `alternate` from the start phase on, without the owned ones.
export function huntedAlternates(plan: Plan): Set<string> {
  const owned = new Set(plan.settings.ownedAlternates || []),
    hunted = new Set<string>();
  for (const phase of PHASES.filter(phase => Number(phase) >= Number(plan.settings.phase || 1)))
    for (const row of plan.stages[phase]?.rows || []) {
      const id =
        row.onSite?.recipe ??
        row.stock?.recipe ??
        (row.id.startsWith('amp:') ? row.id.slice(4) : row.id);
      if (row.alternate && !owned.has(id)) hunted.add(id);
    }
  return hunted;
}
