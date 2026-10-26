// Shared by the planner and wizard. Unknown seed totals must never masquerade as verified budgets.
//
// The code lives in preferences/, one concern per module (#777); this file only re-exports the
// names the planner, the wizard, the pages and the tests use, so none of them names a file
// under preferences/:
//   storage.ts     the storage setting: covered items, construction materials, refill rates
//   world.ts       World Randomization choices, the recipe part cost steps (#1161), the raw
//                  resources, the original map's node counts, default budgets
//   fuels.ts       main power, the generators a player may already have, vehicle and drone
//                  fuel choices, the drone fuel supply
//   help.ts        the wizard's and the guided start's help text
//   glossary.ts    the game terms the pages explain on hover, focus and tap (#1076)
//   guided.ts      the guided start's questions
//   extraction.ts  the node survey: extraction rates, yields and the budgets they give, and
//                  the Water Extractors a line's Water needs, and the power extraction draws
//   presets.ts     node counts prefilled from the world settings
//   mining.ts      mining and belts per phase (#1065): each phase's miner, clock, belts and
//                  pipes, the budgets they give and the nodes a phase's draw taps
//   objective.ts   what a plan keeps lowest (#1180): buildings, power, raw resources or a mix,
//                  the caps per phase (#1221) and the cap on hard drives (#1233)
//   build-costs.ts what each building costs to build (#1073), which the planner counts (#1229)
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
  RECIPE_COSTS,
  recipeCostChoices,
  recipeCostOf,
  resourceDefaults,
} from './preferences/world.ts';
export {
  BURNER_FUELS,
  BURNER_MW,
  droneFuels,
  droneSupply,
  laterVehicleFuels,
  OWNED_GENERATORS,
  OWNED_GENERATORS_MAX,
  ownedGeneratorCounts,
  powerOptions,
  turbofuelRecipes,
  vehicleFuels,
} from './preferences/fuels.ts';
export { helpText } from './preferences/help.ts';
export {
  DRIVE_CAP_MAX,
  OBJECTIVE_EXCHANGE,
  OBJECTIVE_WEIGHT_MAX,
  OBJECTIVE_WEIGHTS,
  OBJECTIVES,
  PHASE_CAP_KEYS,
  PHASE_CAP_LIMITS,
  driveCapOf,
  driveCapWords,
  objectiveKind,
  objectiveWeights,
  objectiveWords,
  phaseCapAmount,
  phaseCapWords,
} from './preferences/objective.ts';
export { firstTerms, glossary, termParts } from './preferences/glossary.ts';
export {
  GUIDED_TOPUP_RATE,
  guidedBudgetsQuestion,
  guidedHaveQuestion,
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
  leavesNodesOut,
  leftOutCounts,
  leftOutPool,
  minedResources,
  minerMarks,
  nodeYield,
  oilNodeResources,
  purities3,
  purityFactor,
  remainingSurvey,
  resourceAvailable,
  resourcePool,
  settableRate,
  uncountedResources,
  waterExtractors,
  wellResources,
  wellYield,
  withinCounts,
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
  BELT_CAP_MARKS,
  BELT_MARKS,
  EXTRACTOR_OPTIONS,
  EXTRACTOR_TIERS,
  MINER_MARKS,
  OVERCLOCK,
  OVERCLOCK_RESEARCH,
  PHASE_CLOCK,
  phaseClock,
  PIPE_MARKS,
  SHARD_RECIPE_RESEARCH,
  beltCapMark,
  beltCapWords,
  bestMark,
  budgetLimit,
  budgetLimits,
  extractorBuilt,
  isWellKind,
  leftOutCap,
  mapSupply,
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
  waterClock,
  waterMWPerUnit,
} from './preferences/mining.ts';
export { BUILD_COSTS } from './preferences/build-costs.ts';
