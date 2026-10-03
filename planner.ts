// The production calculator. `calculate(settings)` validates a profile's settings and solves one
// linear program per phase (1 to 5) with HiGHS (optimizer.ts). The result is the plan a
// calculated profile stores as a frozen snapshot (`profile.plan`); profiles are never silently
// recalculated. Post Phase 5 has no stage of its own: the interface shows Phase 5's stage for it
// (`stage()` in public/app/session.ts).
//
// Callers in the Docker edition: server/save-routes.ts (`/api/preview`, `/api/profiles`),
// server/profile-routes.ts (`/api/round-up`) and `catalog()` in the session summary
// (server/scope.ts). The Pages edition runs a copy that build.ts adapts
// for the browser, inside calculator-worker.js, which public/browser-api.ts drives; `catalog()` is
// written to catalog.json at build time. tests/*.test.ts import this module directly.
//
// Units: items per minute (m³ per minute for fluids) and MW. Recipe rates in recipes.json are for
// one machine at 100% clock, so a recipe's LP variable counts machine-equivalents.
//
// The code lives in planner/, one concern per module (#776); this file only re-exports the names
// every importer, test and the server use, so none of them names a file under planner/:
//   data.ts         recipes.json, the raw resources, default budgets and elevator deliveries
//   settings.ts     settings(): validation of a profile's settings
//   recipes.ts      the recipe pool, amplified twins, the nuclear period and the generators
//   model.ts        run(): one phase's linear program, its demands, solve and check
//   fit.ts          the two-step fit for whole machines and production amplification
//   rounding.ts     the fallbacks after a stopped whole-machine search (#593, #694)
//   on-site.ts      the factory groups' own lines for items they make on site (#875)
//   stage.ts        a solved model read back into a stage
//   calculate.ts    calculate(): every phase, then the adjustments and the warnings
//   draft.ts        the draft of a phase that does not fit
//   adjustments.ts  phaseTime 'final' and the augmenter fuel verdict
//   warnings.ts     the plan's warnings
//   catalog.ts      catalog(), the static data the interface needs
//   alternates.ts   rankAlternates(), the hard-drive payoff
//   types.ts        the types those modules share
// build.ts ships each module to the Pages edition as planner/<name>.mjs and adapts
// planner/data.ts for the browser (see there); the Dockerfile copies the folder.
export {
  DATA,
  DEFAULT_LIMITS,
  DELIVERIES,
  ENGINE,
  PURE_LIMITS,
  RAW,
  powerNeedsTurbofuel,
} from './planner/data.ts';
export { SLOOP_USES, settings } from './planner/settings.ts';
export { AMPLIFY_CANDIDATES, AMPLIFY_SLOTS, nuclearPeriod, recipePool } from './planner/recipes.ts';
export { run } from './planner/model.ts';
export { calculate } from './planner/calculate.ts';
export { warningDuration } from './planner/warnings.ts';
export { catalog } from './planner/catalog.ts';
export { rankAlternates } from './planner/alternates.ts';
// "A", "A and B", "A, B and C" (public/wording.ts), exported for tests/phase-list-wording.test.ts.
export { listNames } from './public/wording.ts';
