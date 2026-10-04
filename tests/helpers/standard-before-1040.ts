// The recipes a 'standard' profile planned with before #1040 and before #1044, for the tests whose
// cases were built or recorded on them. Until #1040 recipes.json had "Alternate: Pure Aluminum
// Ingot" as a standard recipe, so the standard pool held it; it is a hard-drive alternate, which
// 'standard' leaves out now. Until #1044 Polyester Fabric and Distilled Silica were hard-drive
// alternates, which 'standard' left out; it has them now (MAM research and a Tier 7 milestone).
// 'custom' with the two MAM recipes of those days ticked plans with the same pool as 'standard'
// did then, and with Pure Aluminum Ingot as well, as before #1040 (tests/recipe-alternates.test.ts
// checks both), so these cases keep their plans, numbers and random draws exactly. Plain data, no
// planner import, so the component tests (tests/ui/, which calculate in a child process) can use
// it too.
export const PURE_ALUMINUM = 'Recipe_PureAluminumIngot_C';
// Turbofuel and Compacted Coal, the MAM recipes 'standard' always allowed before #1044, which
// added Polyester Fabric (MAM_RECIPES in planner/data.ts).
export const MAM_IDS = ['Recipe_Alternate_EnrichedCoal_C', 'Recipe_Alternate_Turbofuel_C'];
// The standard pool between #1040 and #1044.
export const STANDARD_BEFORE_1044 = {
  recipes: 'custom' as const,
  alternateRecipes: [...MAM_IDS],
};
// The standard pool before #1040 (and #1044).
export const STANDARD_BEFORE_1040 = {
  recipes: 'custom' as const,
  alternateRecipes: [...MAM_IDS, PURE_ALUMINUM],
};
