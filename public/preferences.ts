// Shared by the planner and wizard. Unknown seed totals must never masquerade as verified budgets.
//
// The code lives in preferences/, one concern per module (#777); this file only re-exports the
// names the planner, the wizard, the pages and the tests use, so none of them names a file
// under preferences/:
//   storage.ts     the storage setting: covered items, construction materials, refill rates
//   world.ts       World Randomization choices, the original map's node counts, default budgets
//   fuels.ts       main power, vehicle and drone fuel choices, the drone fuel supply
//   help.ts        the wizard's and the guided start's help text
//   guided.ts      the guided start's questions
//   extraction.ts  the node survey: extraction rates, yields and the budgets they give
//   presets.ts     node counts prefilled from the world settings
// build.ts ships each module to both editions as preferences/<name>.js; the Dockerfile copies
// their sources for the server, which reaches this file through the planner.
export {
  constructionItems,
  elevatorParts,
  storageOptions,
  storageRateFor,
  wantsStorage,
} from './preferences/storage.ts';
export { distributions, nodeCounts, purities, resourceDefaults } from './preferences/world.ts';
export { droneFuels, droneSupply, powerOptions, vehicleFuels } from './preferences/fuels.ts';
export { helpText } from './preferences/help.ts';
export {
  GUIDED_TOPUP_RATE,
  guidedQuestions,
  guidedStandingQuestion,
  guidedTopupItems,
  phaseParts,
  tutorialKeys,
} from './preferences/guided.ts';
export {
  MINER_BASE,
  OIL_BASE,
  WELL_BASE,
  blankCounts,
  blankExtraction,
  clockChoices,
  extractionLimits,
  minedResources,
  minerMarks,
  nodeYield,
  oilNodeResources,
  purities3,
  purityFactor,
  resourceAvailable,
  resourcePool,
  uncountedResources,
  wellResources,
  wellYield,
} from './preferences/extraction.ts';
export {
  knownWorld,
  matchingPreset,
  nodePresets,
  presetCounts,
  presetPurities,
  presetSurvey,
  richShape,
  startingSurvey,
  uniformPurities,
} from './preferences/presets.ts';
