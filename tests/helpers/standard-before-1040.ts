// The recipes a 'standard' profile planned with before #1040, for the tests whose cases were
// built or recorded on them. Until #1040 recipes.json had "Alternate: Pure Aluminum Ingot" as a
// standard recipe, so the standard pool held it; it is a hard-drive alternate, which 'standard'
// leaves out now. 'custom' with it and the two MAM recipes ticked plans with the same pool as
// 'standard' did then (tests/recipe-alternates.test.ts checks that), so these cases keep their
// plans, numbers and random draws exactly. Plain data, no planner import, so the component tests
// (tests/ui/, which calculate in a child process) can use it too.
export const PURE_ALUMINUM = 'Recipe_PureAluminumIngot_C';
// Turbofuel and Compacted Coal, which 'standard' always allows (MAM_RECIPES in planner/data.ts).
export const MAM_IDS = ['Recipe_Alternate_EnrichedCoal_C', 'Recipe_Alternate_Turbofuel_C'];
export const STANDARD_BEFORE_1040 = {
  recipes: 'custom' as const,
  alternateRecipes: [...MAM_IDS, PURE_ALUMINUM],
};
