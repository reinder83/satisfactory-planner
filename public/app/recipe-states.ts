// The three states of a hard-drive alternate (#1075): owned, hunting or not allowed. They are a
// view of the settings every plan already has, so nothing new is stored and every plan, those
// stored before #1075 included, keeps its recipe pool and calculates exactly as before:
// - owned: in `ownedAlternates` (#1068). The plan uses it freely from the phase it becomes
//   available in, whatever Recipe access says, and its unlock step starts ticked.
// - hunting: allowed by Recipe access but not owned: a 'custom' pick (`alternateRecipes`, Planner's
//   choice's `plannerPicks` among them) or, under 'all', every alternate. The plan counts on it,
//   and its hard-drive step stays on the build plan's hunt until it is ticked.
// - off ("not allowed"): neither. The plan never uses it.
// The picker (ui/wizard/AltPicker.vue) edits these through `RecipeSets` and writes them back as
// the same fields; the hard-drive ranking's "Add as hunting" (ui/plan/PayoffPanel.vue) through
// `huntingSettings`. No session imports: tests read this module directly.
import type { CatalogRecipe } from '../types/index.ts';

export type RecipeState = 'owned' | 'hunting' | 'off';

// The settings fields the states are read from and written to.
export interface RecipeFields {
  recipes?: 'standard' | 'all' | 'custom';
  alternateRecipes?: string[];
  preferredRecipes?: string[];
  plannerPicks?: string[];
  ownedAlternates?: string[];
  mamRecipes?: boolean;
}

export function recipeState(settings: RecipeFields, id: string): RecipeState {
  if ((settings.ownedAlternates || []).includes(id)) return 'owned';
  if (settings.recipes === 'all') return 'hunting';
  if (settings.recipes === 'custom' && (settings.alternateRecipes || []).includes(id))
    return 'hunting';
  return 'off';
}

// The picker's working copy of a 'custom' draft: `picked` is alternateRecipes, `owned`
// ownedAlternates, `planner` plannerPicks and `starred` preferredRecipes. A row's state is read
// from them as recipeState reads the settings.
export interface RecipeSets {
  picked: Set<string>;
  owned: Set<string>;
  planner: Set<string>;
  starred: Set<string>;
}

export const recipeSets = (settings: RecipeFields): RecipeSets => ({
  picked: new Set(settings.alternateRecipes || []),
  owned: new Set(settings.ownedAlternates || []),
  planner: new Set(settings.plannerPicks || []),
  starred: new Set(settings.preferredRecipes || []),
});

export const stateIn = (sets: RecipeSets, id: string): RecipeState =>
  sets.owned.has(id) ? 'owned' : sets.picked.has(id) ? 'hunting' : 'off';

// Sets one recipe's state, returning new sets (the old ones are left as they were):
// - owned: added to ownedAlternates. A pick stays a pick (and keeps its star): the pool is the
//   same either way, and the settings keep the fields they had.
// - hunting: picked and no longer owned. One the user marks is a recipe to hunt (plannerPicks),
//   so a new profile's "Treat this plan's alternate recipes as unlocked" keeps its hard-drive
//   step open, as for Planner's choice (#1058).
// - off: neither picked, owned, hunted nor starred.
// A row already in the state is left exactly as it is, so a legacy pick keeps its fields.
export function withState(sets: RecipeSets, id: string, state: RecipeState): RecipeSets {
  if (stateIn(sets, id) === state) return sets;
  const next: RecipeSets = {
    picked: new Set(sets.picked),
    owned: new Set(sets.owned),
    planner: new Set(sets.planner),
    starred: new Set(sets.starred),
  };
  if (state === 'owned') {
    next.owned.add(id);
    next.planner.delete(id);
  } else if (state === 'hunting') {
    next.owned.delete(id);
    next.picked.add(id);
    next.planner.add(id);
  } else {
    next.owned.delete(id);
    next.picked.delete(id);
    next.planner.delete(id);
    next.starred.delete(id);
  }
  return next;
}

// The settings fields of `sets`, as settings() keeps them: sorted lists, preferredRecipes and
// plannerPicks within the picks, ownedAlternates and plannerPicks absent when empty.
export function fieldsOf(sets: RecipeSets): {
  alternateRecipes: string[];
  preferredRecipes: string[];
  plannerPicks?: string[];
  ownedAlternates?: string[];
} {
  const picked = [...sets.picked].sort();
  const planner = [...sets.planner].filter(id => sets.picked.has(id)).sort();
  const owned = [...sets.owned].sort();
  return {
    alternateRecipes: picked,
    preferredRecipes: [...sets.starred].filter(id => sets.picked.has(id)).sort(),
    ...(planner.length ? { plannerPicks: planner } : {}),
    ...(owned.length ? { ownedAlternates: owned } : {}),
  };
}

// "Add as hunting" on the hard-drive ranking (#1075): the plan's settings with `id` allowed as a
// recipe to hunt, exactly as the ranking tried it (rankAlternates' trial: the plan's own pool
// plus the recipe), or null when Recipe access allows it already ('all') or it is owned.
// - 'custom': the pick is added, and to plannerPicks.
// - 'standard': becomes 'custom' with just that pick. A standard plan can still carry picks and
//   stars from when it was custom (#185), which it ignored: they are dropped, not brought back.
//   The MAM recipes box keeps what the standard plan had (on for a plan stored without the box,
//   mamRecipesOn in planner/recipes.ts), so Distilled Silica and the MAM recipes stay as they were.
export function huntingSettings<T extends RecipeFields>(
  settings: T,
  id: string,
): (T & RecipeFields) | null {
  const state = recipeState(settings, id);
  if (state !== 'off') return null;
  if (settings.recipes === 'custom')
    return {
      ...settings,
      alternateRecipes: [...new Set([...(settings.alternateRecipes || []), id])].sort(),
      plannerPicks: [...new Set([...(settings.plannerPicks || []), id])].sort(),
    };
  return {
    ...settings,
    recipes: 'custom',
    alternateRecipes: [id],
    preferredRecipes: [],
    plannerPicks: [id],
    mamRecipes: settings.mamRecipes ?? true,
  };
}

// The product an alternate is grouped under: its first output, as the planner's primaryOutput.
export const productOf = (recipe: Pick<CatalogRecipe, 'outputs'>): string =>
  Object.keys(recipe.outputs)[0] || '';

// The standard recipes making the alternate's product: what the plan builds until it is found.
export const fallbacksOf = (alternate: CatalogRecipe, standard: CatalogRecipe[]): CatalogRecipe[] =>
  standard.filter(recipe => productOf(recipe) === productOf(alternate));

// The inputs of the product's first standard recipe that the alternate does without, and the ones
// it needs that recipe does not: "Cast Screws skips Iron Rod".
export function compared(
  alternate: CatalogRecipe,
  standard: CatalogRecipe[],
): { skips: string[]; adds: string[] } {
  const fallback = fallbacksOf(alternate, standard)[0];
  if (!fallback) return { skips: [], adds: [] };
  const own = Object.keys(alternate.inputs),
    theirs = Object.keys(fallback.inputs);
  return {
    skips: theirs.filter(item => !own.includes(item)),
    adds: own.filter(item => !theirs.includes(item)),
  };
}
