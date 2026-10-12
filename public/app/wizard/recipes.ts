// Alternate recipes for wizard step 2 when Recipe access is "Pick specific alternate
// recipes": the picker is ui/wizard/AltPicker.vue and its "recipe ↗" dialog
// ui/detail/AltRecipeDialog.vue. This module keeps what they share with the rest of the
// app.
import { recipeIdOf } from '../../progression.ts';
import { workspace } from '../session.ts';
import { showDetail } from '../ui/detail.ts';
import type { StoredCalculatedPlan, StoredSettings } from '../../types/index.ts';

// The hard-drive alternate ids a calculated plan actually uses, sorted: the ones the picker lists.
// "Planner's choice" (AltPicker.vue) calculates with every alternate allowed and ticks these.
// Only the phases the plan builds count, its start phase on (#1058): the phases before it are
// milestone-only, so a recipe only they use would be a pick the plan never uses. The alternates
// the game unlocks without a hard drive (the MAM recipes Turbofuel, Compacted Coal and Polyester
// Fabric, and Distilled Silica's milestone, #1044) are not picks: the MAM recipes have their own
// box and Distilled Silica comes with its milestone (#1058).
// Each row counts as its recipe (recipeIdOf): an amplified twin ('amp:<recipe>') or a group's own
// line ('<recipe>:<group>') picks the recipe, never its row id, which the planner would drop (#901).
export const alternatesUsed = (plan: StoredCalculatedPlan | null | undefined): string[] => {
  const catalog = workspace?.catalog?.alternates || [];
  const picks = new Set(catalog.filter(a => !a.mam && !a.milestone).map(a => a.id)),
    noPicks = new Set(catalog.filter(a => a.mam || a.milestone).map(a => a.id));
  const start = Number(plan?.settings?.phase || 1);
  return [
    ...new Set(
      Object.entries(plan?.stages || {})
        .filter(([phase]) => !(Number(phase) < start))
        .flatMap(([, snapshot]) =>
          (snapshot.rows || [])
            .filter(r => r.alternate || picks.has(recipeIdOf(r)))
            .map(r => recipeIdOf(r)),
        )
        .filter(id => !noPicks.has(id)),
    ),
  ].sort();
};

// Whether the MAM recipes box (#1058, ui/wizard/MamRecipes.vue) starts ticked for `settings`:
// their own field, else what a plan made before the box did, on for Standard and All, and for a
// custom plan when it picked one of them (mamRecipesOn in planner/recipes.ts keeps such a plan's
// recipe pool until it is recalculated).
export const mamRecipesShown = (
  settings: Pick<StoredSettings, 'mamRecipes' | 'recipes' | 'alternateRecipes'>,
): boolean => {
  if (typeof settings.mamRecipes === 'boolean') return settings.mamRecipes;
  if (settings.recipes !== 'custom') return true;
  const mam = new Set((workspace?.catalog?.alternates || []).filter(a => a.mam).map(a => a.id));
  return (settings.alternateRecipes || []).some(id => mam.has(id));
};

// "recipe ↗": a dialog with the alternate beside the standard recipe(s) for its first
// output, so the two can be compared. Nothing for an unknown id.
export function openAltRecipe(id: string) {
  if (!(workspace.catalog.alternates || []).some(x => x.id === id)) return;
  showDetail({ kind: 'alt', id });
}
