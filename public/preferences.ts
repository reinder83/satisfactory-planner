// Shared by the planner and wizard. Unknown seed totals must never masquerade as verified budgets.
//
// The code lives in preferences/, one concern per module (#777); this file only re-exports the
// names the planner, the wizard, the pages and the tests use, so none of them names a file
// under preferences/:
//   storage.ts     the storage setting: covered items, construction materials, refill rates
//   world.ts       World Randomization choices, the raw resources, the original map's node counts,
//                  default budgets
//   fuels.ts       main power, vehicle and drone fuel choices, the drone fuel supply
//   help.ts        the wizard's and the guided start's help text
//   guided.ts      the guided start's questions
//   extraction.ts  the node survey: extraction rates, yields and the budgets they give, and
//                  the Water Extractors a line's Water needs, and the power extraction draws
//   presets.ts     node counts prefilled from the world settings
//   mining.ts      mining and belts per phase (#1065): each phase's miner, clock, belts and
//                  pipes, the budgets they give and the nodes a phase's draw taps
// build.ts ships each module to both editions as preferences/<name>.js; the Dockerfile copies
// their sources for the server, which reaches this file through the planner.
export {
  constructionItems,
  elevatorParts,
  storageOptions,
  storageRateFor,
  wantsStorage,
} from './preferences/storage.ts';
export {
  distributions,
  nodeCounts,
  purities,
  rawResources,
  resourceDefaults,
} from './preferences/world.ts';
export {
  droneFuels,
  droneSupply,
  powerOptions,
  turbofuelRecipes,
  vehicleFuels,
} from './preferences/fuels.ts';
export { helpText } from './preferences/help.ts';
export {
  GUIDED_TOPUP_RATE,
  guidedQuestions,
  guidedStandingQuestion,
  guidedTopupFrom,
  guidedTopupItems,
  phaseParts,
  tutorialKeys,
} from './preferences/guided.ts';
export {
  DEFAULT_EXTRACTION,
  EXTRACTOR_CLOCK_DECIMALS,
  EXTRACTOR_MIN_RATE,
  EXTRACTOR_RATE_STEP,
  MINER_BASE,
  MINER_MW,
  OIL_BASE,
  OIL_EXTRACTOR_MW,
  PRESSURIZER_MW,
  WATER_EXTRACTOR,
  WELL_BASE,
  WELL_SATELLITES,
  blankCounts,
  blankExtraction,
  clockChoices,
  extractionLimits,
  extractionMWPerUnit,
  extractorClocks,
  extractorMW,
  extractorOption,
  extractorShards,
  minedResources,
  minerMarks,
  nodeYield,
  oilNodeResources,
  purities3,
  purityFactor,
  resourceAvailable,
  resourcePool,
  settableRate,
  uncountedResources,
  waterExtractors,
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
export {
  BELT_MARKS,
  EXTRACTOR_OPTIONS,
  EXTRACTOR_TIERS,
  MINER_MARKS,
  PHASE_CLOCK,
  PIPE_MARKS,
  bestMark,
  extractorBuilt,
  isWellKind,
  miningAdvice,
  miningLinearMW,
  miningMW,
  phaseBelt,
  phaseForTier,
  phaseMiner,
  phaseMining,
  sourceClock,
  sourceMWPerUnit,
  sourceYield,
  waterMWPerUnit,
} from './preferences/mining.ts';
