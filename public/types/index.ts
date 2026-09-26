// The planner's data shapes, for TypeScript code and JSDoc `import('…')` types. Types only:
// this folder has no run-time code, and build.ts leaves it out of both editions.
//   state.ts       a profile's saved progress, and the /api/update operations
//   handbook.ts    the owner's handbook (plan.json)
//   calculated.ts  a calculated profile's frozen plan and its settings
//   workspace.ts   workspace.json, the /api/ replies, the catalog and the export formats
//   progression.ts the game's milestones and research (progression.json)
//   guided.ts      the guided start's questions (preferences.ts)
//   recipes.ts     the game's recipes and items (recipes.json)
// tests/types/ checks these against the real data and code (npm run typecheck).
export type * from './common.ts';
export type * from './state.ts';
export type * from './handbook.ts';
export type * from './calculated.ts';
export type * from './workspace.ts';
export type * from './progression.ts';
export type * from './guided.ts';
export type * from './recipes.ts';
