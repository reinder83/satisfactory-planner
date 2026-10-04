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
//                  links, the vehicle picked per group link, version 7
//   handbookOrigin where a migrated handbook profile came from and what the migration could
//                  not place (validateOrigin), version 12; with what the migration mapped
//                  (mapping, #606), version 13; no update op edits it
//   onSiteReview   ticks a recalculation kept for review because of lines made on site
//                  (validateOnSiteReview, #876), version 15; no update op edits it
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
//   state/carry.ts           newProfileState (with siteTicksForReview), carry options,
//                            carryGuide, shareState and the
//                            profiles /api/profiles and /api/round-up add (calculatedProfile,
//                            roundUpState, wholeMachineProfile) and their refusals
//                            (checkNewProfileKind, checkRoundUp)
//   state/summary.ts         phaseProgress, planStepIds, profilePhases, profilePhasesCache and
//                            currentPayoff
//   state/factory-groups.ts  defaultFactoryGroups and its seed data
//   state/items.ts           ITEM_NAMES, every item name the game data has held
export {
  bayCapacity,
  bayOfSlot,
  builtinFloors,
  fuelledModes,
  handbookBay,
  handbookFloor,
  initialState,
  linkPlaces,
  mappingFits,
  mergeAmplifiedUnlocks,
  safeKey,
  slotPosition,
  validateState,
} from './state/validate.ts';
export { checkBase, mutate, staleWrite } from './state/mutate.ts';
export {
  alreadyWholeMachines,
  calculatedProfile,
  carryGuide,
  carryOptions,
  carryPicks,
  checkNewProfileKind,
  checkRoundUp,
  newProfileState,
  pickedRecipeUnlocks,
  retiredProfileType,
  roundUpNeedsCalculated,
  roundUpState,
  shareState,
  siteTicksForReview,
  wholeMachineProfile,
} from './state/carry.ts';
export {
  currentPayoff,
  phaseProgress,
  planStepIds,
  profilePhases,
  profilePhasesCache,
} from './state/summary.ts';
export { defaultFactoryGroups } from './state/factory-groups.ts';
export { ITEM_NAMES } from './state/items.ts';
