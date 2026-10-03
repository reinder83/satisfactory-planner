// A profile's saved progress (public/state.ts). Two shapes:
//   SavedState     what may arrive: a stored profile, a backup or an import, of any released
//                  version (1–15). Later versions only add optional sections, so an older
//                  state simply lacks them.
//   ProgressState  what validateState returns and every other module works with: every
//                  section present and normalised.
// Keys and value limits are enforced by validateState at run time; these types only
// describe the shape. Checklist and note keys must never be renamed (see state.ts).
import type { Phase } from './common.ts';

// validateState marks the content version from what the state uses: 2 storage layout
// edits, 3 build-plan edits or factory groups, 4 a container position past 08, 5 a hidden
// handbook bay, 6 a hidden built-in floor, 7 a vehicle picked for a factory-group link, 8 a
// handbook bay moved to another floor, 9 a factory-group link to the vehicle fuel, 10 bays put in
// their own order on a floor, 11 a link from one raw resource or existing-supply item, 12 a
// profile migrated from the handbook (handbookOrigin), 13 one that also records what its
// migration mapped (handbookOrigin.mapping), 14 a group that makes items on site
// (factoryGroups.local), 15 ticks a recalculation kept for review because of lines made on site
// (onSiteReview).
export type StateVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

// Ticks a recalculation into a new profile could not carry onto one line of the new plan, because
// of factory groups' own lines made on site (#876, newProfileState in state/carry.ts): a tick on a
// central line that the new plan splits into group lines, and a tick on a group's own line that
// the new plan no longer has. Keyed by their check key ('calc-<phase>-<rowId>'), kept exactly, for
// review, and listed on the Notes page; never deleted, and no update op edits it. Version 15.
export interface OnSiteReview {
  checks: Record<string, boolean>;
}

// Where a profile migrated from the original handbook came from (#387, #485), and whatever the
// migration could not place on the calculated plan: ticks, notes and group assignments kept
// exactly, for review, and never deleted. No update op edits it. Version 12.
export interface HandbookOrigin {
  // The handbook's own version (its `version`, e.g. '2026-09-13').
  version: string;
  unmapped: {
    checks: Record<string, boolean>;
    notes: Record<string, string>;
    assignments: Record<string, GroupAssignment[]>;
  };
  // What the migration mapped (#606), so a progress backup made before the migration can be
  // re-keyed onto the profile later without the handbook. Version 13; a profile migrated before
  // it existed has none.
  mapping?: HandbookMapping;
}

// What a handbook migration needs of the handbook to re-key progress (migrateHandbookState):
// per stage, each handbook factory id's row id; the handbook's factory ids; its knownChecks; and
// its deliveries' starting counts above 0, by delivery id.
export interface HandbookMapping {
  rows: Partial<Record<'3' | '4' | '5', Record<string, string>>>;
  factories: string[];
  knownChecks: Record<string, boolean>;
  deliveries: Record<string, number>;
}

// A step the user added to the build plan. The id starts with 'custom-'.
export interface CustomTask {
  id: string;
  title: string;
  phase: Phase;
}

// Storage room layout edits on top of the handbook's room (version 2+; 4 for positions 09+;
// 5 for hidden handbook bays; 6 for hidden built-in floors).
export interface StorageEdits {
  // Added floors: { id: 'cf-…', label }.
  floors: { id: string; label: string }[];
  // New names for built-in ('ground', 'upper', 'workshop') or added floors, by floor id.
  floorNames: Record<string, string>;
  // Added bays: { id: 'A'–'ZZ', name, floor }.
  bays: { id: string; name: string; floor: string }[];
  // New names for handbook or added bays, by bay id.
  bayNames: Record<string, string>;
  // The item each container address ('A01') holds.
  slots: Record<string, string>;
  // Handbook container addresses the user emptied.
  clearedSlots: string[];
  // Handbook bays (A–R) the user took out of the room (#166). Only hidden: the bay's checks,
  // notes, names and containers are all kept, and restoring it brings them back.
  hiddenBays: string[];
  // Built-in floors ('ground', 'upper', 'workshop') the user took out of the tabs (#168), once
  // no bay on them was showing. Restoring one brings its tab back.
  hiddenFloors: string[];
  // Handbook bays (A–R) moved to another floor (#190): letter → floor id, a built-in or added
  // floor. Absent or missing a letter: the handbook's floor. Added bays keep their own `floor`.
  // The letter, and so every address, check and note of the bay, stays the same (version 8).
  bayFloors?: Record<string, string>;
  // The order of the bays on a floor (#191): floor id → bay letters, set by Move left / Move right
  // in layout edit mode. A bay missing from its floor's list keeps its default place; letters no
  // longer on the floor are skipped. Only kept for a floor with an order (version 9).
  bayOrder?: Record<string, string[]>;
}

// Build-plan step edits, keyed by step id (version 3).
export interface TaskEdits {
  // Step order per phase: { '3': [stepId, …] }.
  order: Partial<Record<Phase, string[]>>;
  // Hidden steps; their ticks are kept.
  removed: string[];
  titles: Record<string, string>;
  bodies: Record<string, string>;
  // The factory or calculated row a step links to.
  links: Record<string, string>;
}

// One row's share of a factory group; rate null means the whole row.
export interface GroupAssignment {
  group: string;
  rate: number | null;
}

// Named production areas and the plan rows assigned to them (version 3).
export interface FactoryGroups {
  // { id: 'fg-…', name }
  groups: { id: string; name: string }[];
  // Plan row id (not a 'calc-' key) to its group shares.
  assignments: Record<string, GroupAssignment[]>;
  // The transport picked for a link between two places (#205), keyed '<from>:<to>' with a
  // group id or a place from group-links.ts. Absent or missing a key: belt or pipe (version 8).
  links?: Record<string, LinkTransport>;
  // The items a group makes on site (#868, #874), by group id: item names from the game data
  // (state/items.ts), each at most once. Absent, or missing a group: none (version 14).
  local?: Record<string, string[]>;
}

export type LinkMode = 'truck' | 'tractor' | 'explorer' | 'train' | 'drone';
export interface LinkTransport {
  mode: LinkMode;
  // Minutes for one vehicle there and back, loading included.
  roundTripMin: number;
  // What a truck, tractor or explorer burns (preferences.ts vehicleFuels); absent for a train
  // (electric) and a drone.
  fuel?: string;
}

// Normalised progress, as validateState returns it.
export interface ProgressState {
  version: StateVersion;
  // Bumped by the store on every accepted write.
  revision: number;
  // Ticked checklist items: 'calc-<phase>-<rowId>', 'factory-<phase>-<id>', 'slot-…', ….
  checks: Record<string, boolean>;
  // 'global', 'phase-<phase>', 'factory-<id>' and 'slot-<address>' notes.
  notes: Record<string, string>;
  // Space Elevator parts handed in, by delivery id ('3-versatile-framework').
  deliveries: Record<string, number>;
  // Only the selected phase is kept.
  settings: { phase: Phase };
  customTasks: CustomTask[];
  storageEdits: StorageEdits;
  taskEdits: TaskEdits;
  factoryGroups: FactoryGroups;
  // Only on a profile migrated from the handbook (version 12).
  handbookOrigin?: HandbookOrigin;
  // Only on a profile recalculated with lines made on site that kept ticks for review (version 15).
  onSiteReview?: OnSiteReview;
}

// Progress of any released version, as stored or imported. Version 1 states have no
// storageEdits, taskEdits or factoryGroups; states before the revision counter have none.
// Unknown extra fields are allowed on input and dropped by validateState.
export interface SavedState {
  version: StateVersion;
  revision?: number;
  checks: Record<string, boolean>;
  notes: Record<string, string>;
  deliveries: Record<string, number>;
  settings: { phase: Phase; [older: string]: unknown };
  customTasks: CustomTask[];
  storageEdits?: Partial<StorageEdits>;
  taskEdits?: Partial<TaskEdits>;
  factoryGroups?: Partial<FactoryGroups>;
  handbookOrigin?: HandbookOrigin;
  onSiteReview?: OnSiteReview;
}

// The operations /api/update accepts (mutate in state.ts). Each is validated there.
export type UpdateOp =
  | { type: 'check'; key: string; value: boolean }
  | { type: 'checks'; keys: string[]; value: boolean }
  // An empty or blank value deletes the note.
  | { type: 'note'; key: string; value: string }
  | { type: 'delivery'; key: string; value: number }
  | { type: 'phase'; value: Phase }
  | { type: 'addTask'; id: string; title: string; phase: Phase }
  | { type: 'removeTask'; id: string }
  // An empty title or body restores the original text; an empty or null link removes it.
  | { type: 'taskEdit'; id: string; title?: string; body?: string; link?: string | null }
  | { type: 'taskRemove'; id: string }
  | { type: 'taskRestore'; id: string }
  | { type: 'taskOrder'; phase: Phase; ids: string[] }
  | { type: 'factoryGroupAdd'; id: string; name: string }
  | { type: 'factoryGroupRename'; id: string; name: string }
  | { type: 'factoryGroupRemove'; id: string }
  | { type: 'factoryAssign'; key: string; groups: { group: string; rate?: number | null }[] }
  // The whole list of items group `id` makes on site (#877); an empty list drops its entry.
  | { type: 'factoryLocal'; id: string; items: string[] }
  // mode 'belt' goes back to belt or pipe and forgets the link's entry.
  | {
      type: 'factoryLinkTransport';
      from: string;
      to: string;
      mode: LinkMode | 'belt';
      roundTripMin?: number;
      fuel?: string;
      // For a link from a source (#231) while its mines link still has a choice saved before
      // #231: the other sources going the same way, which keep that choice as their own.
      siblings?: string[];
    }
  | { type: 'storageFloorAdd'; id: string; label: string }
  // A blank label restores the built-in name.
  | { type: 'storageFloorRename'; id: string; label: string }
  | { type: 'storageFloorRemove'; id: string }
  // replace: take a hidden handbook bay's letter, clearing its kept records (#167).
  | { type: 'storageBayAdd'; id: string; name: string; floor: string; replace?: boolean }
  | { type: 'storageBayRename'; id: string; name: string }
  // Any bay to another floor, keeping its letter and records (#190).
  | { type: 'storageBayMove'; id: string; floor: string }
  | { type: 'storageBayOrder'; floor: string; order: string[] }
  | { type: 'storageBayRemove'; id: string }
  // Hide or bring back a handbook bay; its records are kept either way.
  | { type: 'storageBayHide'; id: string }
  // Hide or bring back a built-in floor.
  | { type: 'storageFloorHide'; id: string }
  | { type: 'storageFloorRestore'; id: string }
  | { type: 'storageBayRestore'; id: string }
  | { type: 'storageSlotAssign'; key: string; name: string }
  | { type: 'storageSlotClear'; key: string }
  | { type: 'storageSlotMove'; from: string; to: string; fromName: string; toName: string | null };
