// Alternate recipes for wizard step 2 when Recipe access is "Pick specific alternate
// recipes": the picker is ui/wizard/AltPicker.vue and its "recipe ↗" dialog
// ui/detail/AltRecipeDialog.vue. This module keeps what they share with the rest of the
// app.
import { recipeIdOf } from '../../progression.ts';
import { workspace } from '../session.ts';
import { showDetail } from '../ui/detail.ts';
import type { StoredCalculatedPlan } from '../../types/index.ts';

// The alternate ids a calculated plan actually uses, sorted. "Planner's choice"
// (AltPicker.vue) calculates with every alternate allowed and ticks these.
// The alternates the game unlocks without a hard drive (the MAM recipes Turbofuel, Compacted Coal
// and Polyester Fabric, and Distilled Silica's milestone, #1044) appear in plans with
// alternate:false, so match catalog ids too.
// Each row counts as its recipe (recipeIdOf): an amplified twin ('amp:<recipe>') or a group's own
// line ('<recipe>:<group>') picks the recipe, never its row id, which the planner would drop (#901).
export const alternatesUsed = (plan: StoredCalculatedPlan | null | undefined): string[] => {
  const altIds = new Set((workspace?.catalog?.alternates || []).map(a => a.id));
  return [
    ...new Set(
      Object.values(plan?.stages || {}).flatMap(snapshot =>
        (snapshot.rows || [])
          .filter(r => r.alternate || altIds.has(recipeIdOf(r)))
          .map(r => recipeIdOf(r)),
      ),
    ),
  ].sort();
};

// "recipe ↗": a dialog with the alternate beside the standard recipe(s) for its first
// output, so the two can be compared. Nothing for an unknown id.
export function openAltRecipe(id: string) {
  if (!(workspace.catalog.alternates || []).some(x => x.id === id)) return;
  showDetail({ kind: 'alt', id });
}
