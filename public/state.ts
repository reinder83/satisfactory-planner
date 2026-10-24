// Progress state: everything one profile records, shared by both editions (server.ts via
// workspace.ts, the Pages edition via browser-api.ts) and by full-save exports.
//   version        content version, recomputed by validateState (see the end of it)
//   revision       bumped by the server/browser store on every accepted write
//   checks         { key: boolean } ticked checklist items
//   notes          { key: string } save-wide ('global'), factory and container notes
//   deliveries     { deliveryId: count } Space Elevator parts handed in,
//                  e.g. '3-versatile-framework'
//   settings       { phase } the selected phase; nothing else in settings is kept
//   customTasks    [{ id: 'custom-…', title, phase }] steps the user added
//   storageEdits   storage room layout edits (blankEdits), version 2+/4/5/6/8
//   taskEdits      build-plan step edits (blankTaskEdits), version 3
//   factoryGroups  named production areas and row assignments (blankGroups), version 3;
//                  links, the vehicle picked per group link, version 7; a link burning a
//                  fuel added in #1165 (laterVehicleFuels), version 17; a link on Fluid
//                  Trucks (mode 'fluidTruck', #1177), version 18; a group's owner (#1199,
//                  groups[].owner, the factoryGroupOwner update), version 20; a group's
//                  flow graph layout (#1224, groups[].layout, the factoryGroupLayout
//                  update), version 22; storage and the sink shown as tags in that
//                  graph (#1231, groups[].layout.tags), version 23; inputs and outputs
//                  moved in that graph (#1240, groups[].layout.places), version 25
//   handbookOrigin where a migrated handbook profile came from and what the migration could
//                  not place (validateOrigin), version 12; with what the migration mapped
//                  (mapping, #606), version 13; no update op edits it
//   onSiteReview   ticks a recalculation kept for review because of lines made on site
//                  (validateOnSiteReview, #876), version 15; no update op edits it
//   exactClocks    { phase: [rowId] } production lines asked to run at exact clocks
//                  (validateExactClocks, #1066), version 16; absent means the plan's own
//   builtMachines  { 'calc-<phase>-<rowId>': count } machines that stand on a production line a
//                  recalculation grew (validateBuiltMachines, #1174), version 19; or shrunk,
//                  or no longer has (#1175, state/built-match.ts); only a carry sets it
//                  (carryLines, carryFormerLines), no update op edits it
//   tickedBy       { key: { at, by? } } who ticked a step and when (validateTickedBy, #1206),
//                  version 21; kept by a tick of a step not ticked yet (the check and checks
//                  updates' ticked or tickedBy), only while its step is ticked
//   sloopPins      { phase: { recipe: sloops } } somersloops pinned on production lines
//                  (validateSloopPins, #1235), version 24; absent means the plan's
//                  own; the sloopPins update sends the whole map
// Checklist keys link progress to content and must never be renamed, because saved states
// only hold the key: 'calc-<phase>-<rowId>' (calculated rows), 'factory-<phase>-<factoryId>'
// (handbook factories), 'slot-<address>-<built|labelled|connected|verified>' (containers),
// 'unlock-<schematic>', 'recipe-unlock-<recipe>', 'early-base-…', 'startup-…', 'custom-…'.
// Notes use 'factory-<id>' and 'slot-<address>' without a phase or step.
//
// The code lives in public/state/, one concern per module; this file only re-exports the names
// every importer, test and the server use, so none of them names a file under public/state/.
//   state/validate.ts        blank state, validateState and the record rules
//   state/mutate.ts          mutate (the /api/update operations) and checkBase
//   state/carry.ts           newProfileState (with siteTicksForReview, UNLOCKED_WITH), carry options,
//                            carryGuide, shareState and the
//                            profiles /api/profiles and /api/round-up add (calculatedProfile,
//                            roundUpState, wholeMachineProfile) and their refusals
//                            (checkNewProfileKind, checkRoundUp), and Edit settings' recalculation
//                            in place (recalculatedProfile, checkRecalculate)
//   state/summary.ts         phaseProgress, planStepIds, profilePhases, profilePhasesCache and
//                            currentPayoff and rankScope
//   state/restore.ts         Restore this version (#1071): the kept-version link (restoreTarget),
//                            its refusals (checkRestore) and the swap (restoredVersions)
//   state/figures.ts         planFigures and cachedPlanFigures: what Saves & profiles compares of
//                            a profile's plan (#1074)
//   state/rename-offer.ts    the "Rename to …" offer's dismissal flag (renameOfferFields, #1071)
//   state/factory-groups.ts  defaultFactoryGroups and its seed data
//   state/alternates.ts      ALTERNATE_RECIPE_IDS, every alternate recipe id the game data has held
//   state/items.ts           ITEM_NAMES, every item name the game data has held
//   state/built-match.ts     built lines a plan changed (#1175): what a line was (lineFacts,
//                            recipeBook) and the line it switches to (successorOf)
export {
  bayCapacity,
  bayOfSlot,
  builtinFloors,
  fuelledModes,
  handbookBay,
  handbookFloor,
  holdsOldUnlockKeys,
  initialState,
  LAYOUT_LIMITS,
  linkPlaces,
  mappingFits,
  mergeAmplifiedUnlocks,
  mergeGroupLineUnlocks,
  mergeOldUnlockKeys,
  OWNER_MAX,
  safeKey,
  slotPosition,
  tickRecord,
  validateState,
  validateTickedBy,
} from './state/validate.ts';
export { checkBase, mutate, noteConflict, staleWrite } from './state/mutate.ts';
export {
  alreadyWholeMachines,
  calculatedProfile,
  carryGuide,
  carryOptions,
  carryPicks,
  checkNewProfileKind,
  checkPlan,
  planReplaced,
  checkRecalculate,
  checkRoundUp,
  newProfileState,
  noRoomForBackup,
  pickedRecipeUnlocks,
  recalculatedElsewhere,
  recalculatedProfile,
  builtLinesOf,
  standingLines,
  recalculateNeedsCalculated,
  retiredProfileType,
  roundUpNeedsCalculated,
  roundUpSettings,
  roundUpState,
  shareState,
  siteTicksForReview,
  UNLOCKED_WITH,
  wholeMachineProfile,
} from './state/carry.ts';
export {
  currentPayoff,
  phaseProgress,
  planStepIds,
  profilePhases,
  profilePhasesCache,
  rankScope,
} from './state/summary.ts';
export {
  checkRestore,
  notAKeptVersion,
  restoredVersions,
  restoreNeedsCalculated,
  restoreFields,
  restoreStale,
  restoreTarget,
  restoreTargetGone,
} from './state/restore.ts';
export { cachedPlanFigures, planFigures } from './state/figures.ts';
export { renameOfferFields } from './state/rename-offer.ts';
export { defaultFactoryGroups } from './state/factory-groups.ts';
export { ALTERNATE_RECIPE_IDS } from './state/alternates.ts';
export { ITEM_NAMES } from './state/items.ts';
export {
  calcKeyParts,
  lineFacts,
  builtLineName,
  recipeBook,
  sameProduct,
  stageRowsOf,
  successorOf,
  type LineFacts,
  type RecipeBook,
} from './state/built-match.ts';
