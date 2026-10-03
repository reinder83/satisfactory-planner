// Saved progress: the blank state and validateState, the single gate every load, import,
// update and new profile passes through, with the record rules (keys, labels, storage
// addresses, factory group links) the other state modules share. Re-exported by ../state.ts.
//
// Types: ProgressState is what validateState returns, SavedState anything it accepts
// (public/types/state.ts). Input arrives as unknown and is narrowed by the checks below
// (plain, safeKey, label, ...), which are type guards; nothing is trusted before them.
import { vehicleFuels } from '../preferences.ts';
import { ITEM_NAMES } from './items.ts';
import type {
  CustomTask,
  FactoryGroups,
  GroupAssignment,
  HandbookMapping,
  HandbookOrigin,
  LinkMode,
  OnSiteReview,
  LinkTransport,
  Phase,
  ProgressState,
  StorageEdits,
  StoredCalculatedPlan,
  TaskEdits,
} from '../types/index.ts';

// A plan whose rows a state is built for: a fresh calculation or a stored one.
export type RowsPlan = Pick<StoredCalculatedPlan, 'settings' | 'stages'>;
// An untrusted object: a record that passed plain() but whose fields are not checked yet.
export type Raw = Record<string, unknown>;

export const initialState = (): ProgressState => ({
  version: 1,
  revision: 0,
  checks: {},
  notes: {},
  deliveries: {},
  settings: { phase: '1' },
  customTasks: [],
  storageEdits: blankEdits(),
  taskEdits: blankTaskEdits(),
  factoryGroups: blankGroups(),
});
// Storage layout edits on top of the handbook's storage room. floors/bays are added ones
// ({ id: 'cf-…', label } and { id: 'A'–'ZZ', name, floor }); floorNames/bayNames rename
// built-in or added ones; slots maps a container address ('A01') to the item it holds;
// clearedSlots lists handbook addresses the user emptied.
const blankEdits = (): StorageEdits => ({
  floors: [],
  floorNames: {},
  bays: [],
  bayNames: {},
  slots: {},
  clearedSlots: [],
  hiddenBays: [],
  hiddenFloors: [],
});
// Build-plan edits, keyed by step id: order is { phase: [stepId…] }, removed lists hidden
// steps, titles/bodies replace step text and links point a step at a factory or row id.
const blankTaskEdits = (): TaskEdits => ({
  order: {},
  removed: [],
  titles: {},
  bodies: {},
  links: {},
});
// Factory groups: groups is [{ id: 'fg-…', name }]; assignments maps a plan row id (not a
// 'calc-' key) to [{ group, rate }], where rate null means the whole row.
const blankGroups = (): FactoryGroups => ({ groups: [], assignments: {} });
// Only literal objects count as records, so arrays, class instances and null are rejected.
export const plain = (value: unknown): value is Raw =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
// Every record address (check, note, delivery, step or row id) must pass this, a plan guide's
// step ids too (transfer.ts). The
// prototype names are refused so a saved key can never reach an object's prototype.
export const safeKey = (key: unknown): key is string =>
  typeof key === 'string' &&
  /^[a-zA-Z0-9:_-]{1,160}$/.test(key) &&
  !['__proto__', 'constructor', 'prototype'].includes(key);
// Throws an error carrying the HTTP status server.ts replies with; its message is the
// text the user sees.
// A function declaration, so TypeScript knows the code after a failed check is unreachable.
export function fail(message: string, status = 400): never {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  throw error;
}
export const builtinFloors: [id: string, label: string][] = [
  ['ground', 'Ground floor'],
  ['upper', 'Upper floor'],
  ['workshop', 'Workshop'],
];
// A floor is a built-in one or an added 'cf-…' one; a bay is one or two capital letters.
export const floorId = (value: unknown): value is string =>
  typeof value === 'string' &&
  (builtinFloors.some(([id]) => id === value) || /^cf-[a-z0-9]{4,32}$/.test(value));
export const bayId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Z]{1,2}$/.test(value);
// The printed room's own bays, A–R in storage-room.ts (a test keeps the two in step). An added bay may take
// one of these letters only while that handbook bay is hidden (#167), and only after the hidden
// bay's kept records are cleared, so two bays never share addresses or progress.
export const handbookBay = (letter: string) => /^[A-R]$/.test(letter);
// A printed bay's own floor in storage-room.ts: A–H on the ground floor, I–R upstairs (a test keeps
// this in step too). Moving a bay back there forgets its entry in bayFloors (#190).
export const handbookFloor = (letter: string) => (letter <= 'H' ? 'ground' : 'upper');
// An added floor's id as validateEdits has always checked it: the pattern test alone, which
// stringifies what it is given. Kept exactly, so no stored layout that passed before fails now.
export const addedFloorId = (value: unknown) => /^cf-[a-z0-9]{4,32}$/.test(value as string);
// A bay prints eight positions, 01-08. Needing more containers than that
// extends the bay with addresses 09 upwards, up to bayCapacity. Printed
// addresses never move, so saved progress stays with its container.
export const bayCapacity = 99;
export const bayOfSlot = (address: string) => address.slice(0, -2);
export const slotPosition = (address: string) => Number(address.slice(-2));
export const slotAddr = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[A-Z]{1,2}[0-9]{2}$/.test(value) &&
  slotPosition(value) >= 1 &&
  slotPosition(value) <= bayCapacity;
export const addedSlot = (address: string) => slotPosition(address) > 8;
// Whether a layout needs version 4: only a named container at 09 or above does.
const hasAddedSlots = (edits: StorageEdits) => Object.keys(edits.slots).some(addedSlot);
// A user-entered name: non-blank and at most max characters once trimmed.
export const label = (value: unknown, max = 80): value is string =>
  typeof value === 'string' && !!value.trim() && value.trim().length <= max;
// hasEdits, hasTaskEdits and hasGroups decide the content version in validateState.
const hasEdits = (edits: StorageEdits) =>
  edits.floors.length ||
  edits.bays.length ||
  edits.clearedSlots.length ||
  Object.keys(edits.floorNames).length +
    Object.keys(edits.bayNames).length +
    Object.keys(edits.slots).length >
    0;
const phases: string[] = ['1', '2', '3', '4', '5', 'post'];
export const isPhase = (value: unknown): value is Phase => phases.includes(value as string);
export const groupId = (value: unknown): value is string =>
  typeof value === 'string' && /^fg-[a-z0-9]{4,32}$/.test(value);
const hasTaskEdits = (edits: TaskEdits) =>
  edits.removed.length ||
  Object.keys(edits.order).length +
    Object.keys(edits.titles).length +
    Object.keys(edits.bodies).length +
    Object.keys(edits.links).length >
    0;
const hasGroups = (factoryGroups: FactoryGroups) =>
  factoryGroups.groups.length || Object.keys(factoryGroups.assignments).length > 0;
// Returns a clean copy of taskEdits, or a blank one when absent (states before version 3).
// Throws on anything malformed. Step ids are not checked against a plan, so edits to a
// step the current plan no longer shows are kept rather than dropped.
export function validateTaskEdits(raw: unknown): TaskEdits {
  if (raw === undefined) return blankTaskEdits();
  if (!plain(raw)) fail('Invalid build plan edits in backup.');
  const clean = blankTaskEdits();
  if (raw.order !== undefined) {
    if (!plain(raw.order)) fail('Invalid step order.');
    for (const [phase, ids] of Object.entries(raw.order)) {
      if (
        !isPhase(phase) ||
        !Array.isArray(ids) ||
        ids.length > 600 ||
        ids.some(id => !safeKey(id)) ||
        new Set(ids).size !== ids.length
      )
        fail('Invalid step order.');
      if (ids.length) clean.order[phase] = [...ids];
    }
  }
  if (raw.removed !== undefined) {
    if (
      !Array.isArray(raw.removed) ||
      raw.removed.length > 2000 ||
      raw.removed.some(id => !safeKey(id))
    )
      fail('Invalid removed steps.');
    clean.removed = [...new Set(raw.removed)];
  }
  const texts: ['titles' | 'bodies' | 'links', number][] = [
    ['titles', 240],
    ['bodies', 6000],
    ['links', 160],
  ];
  for (const [kind, max] of texts) {
    const map = raw[kind];
    if (map === undefined) continue;
    if (!plain(map) || Object.keys(map).length > 2000) fail('Invalid step edits.');
    for (const [stepId, value] of Object.entries(map)) {
      if (!safeKey(stepId) || (kind === 'links' ? !safeKey(value) : !label(value, max)))
        fail('Invalid step edit.');
      // Both checks above leave value a string.
      clean[kind][stepId] = kind === 'links' ? (value as string) : (value as string).trim();
    }
  }
  return clean;
}
// Returns a clean copy of factoryGroups, or a blank one when absent. Every assignment must
// name a group from the same list, each group at most once per row. The items a group makes on
// site (local, #874) must each be a known item (items.ts), at most once per group, and the group
// must exist. Anything else throws, like the rest of the groups.
export function validateGroups(raw: unknown): FactoryGroups {
  if (raw === undefined) return blankGroups();
  if (!plain(raw)) fail('Invalid factory groups in backup.');
  const clean = blankGroups();
  if (raw.groups !== undefined) {
    if (!Array.isArray(raw.groups) || raw.groups.length > 60) fail('Invalid factory groups.');
    const seen = new Set<string>();
    clean.groups = raw.groups.map((group: unknown) => {
      if (!plain(group) || !groupId(group.id) || seen.has(group.id) || !label(group.name))
        fail('Invalid factory group.');
      seen.add(group.id);
      return { id: group.id, name: group.name.trim() };
    });
  }
  if (raw.assignments !== undefined) {
    if (!plain(raw.assignments) || Object.keys(raw.assignments).length > 1000)
      fail('Invalid factory group assignments.');
    const known = new Set(clean.groups.map(group => group.id));
    for (const [rowKey, list] of Object.entries(raw.assignments)) {
      if (!safeKey(rowKey) || !Array.isArray(list) || !list.length || list.length > 12)
        fail('Invalid factory group assignment.');
      const used = new Set<string>();
      clean.assignments[rowKey] = list.map((member: unknown): GroupAssignment => {
        if (
          !plain(member) ||
          !known.has(member.group as string) ||
          used.has(member.group as string)
        )
          fail('Invalid factory group assignment.');
        // known holds only group ids, so the check above leaves a string.
        const group = member.group as string;
        used.add(group);
        const rate = member.rate ?? null;
        if (
          rate !== null &&
          (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || rate > 10000000)
        )
          fail('Invalid group production split.');
        return { group, rate };
      });
    }
  }
  if (raw.links !== undefined) {
    if (!plain(raw.links) || Object.keys(raw.links).length > 500)
      fail('Invalid factory group links.');
    const known = new Set(clean.groups.map(group => group.id));
    const links: Record<string, LinkTransport> = {};
    for (const [key, transport] of Object.entries(raw.links)) {
      const [from, to, extra] = key.split(':');
      if (extra !== undefined || !linkKey(from, to, known)) fail('Invalid group link.');
      links[key] = linkTransport(transport);
    }
    // Only kept when there is one, so a state without vehicle links keeps its old shape.
    if (Object.keys(links).length) clean.links = links;
  }
  if (raw.local !== undefined) {
    if (!plain(raw.local)) fail('Invalid items made on site.');
    const known = new Set(clean.groups.map(group => group.id));
    const local: Record<string, string[]> = {};
    for (const [group, items] of Object.entries(raw.local)) {
      if (
        !known.has(group) ||
        !Array.isArray(items) ||
        !items.length ||
        items.length > ITEM_NAMES.length ||
        items.some(item => !knownItems.has(item)) ||
        new Set(items).size !== items.length
      )
        fail('Invalid items made on site.');
      local[group] = [...(items as string[])];
    }
    // Only kept when a group has one, so a state without them keeps its old shape and version.
    if (Object.keys(local).length) clean.local = local;
  }
  return clean;
}
const knownItems = new Set<unknown>(ITEM_NAMES);
// The places a link can join besides factory groups: group-links.ts's UNGROUPED, MINES and
// OUTSIDE ids (a test keeps the two lists in step).
export const linkPlaces = [
  'ungrouped',
  'mines',
  'storage',
  'drone',
  'vehicles',
  'elevator',
  'sink',
];
// The mines and existing supply as one place (group-links.ts MINES), as links were keyed before #231.
export const MINES_PLACE = 'mines';
const linkModes: LinkMode[] = ['truck', 'tractor', 'explorer', 'train', 'drone'];
// The vehicles that burn fuel from their own slot; a train is electric and a drone's fuel
// depends on the flight distance, which the planner does not know.
export const fuelledModes: LinkMode[] = ['truck', 'tractor', 'explorer'];
// Link places added after version 7 introduced links, with the version that knows them: a new
// place is new content an older release cannot read (#220).
const laterPlaces = ['vehicles'];
const linksNeedV9 = (factoryGroups: FactoryGroups) =>
  Object.keys(factoryGroups.links || {}).some(key =>
    key.split(':').some(place => laterPlaces.includes(place)),
  );
// A raw resource or existing-supply item as a source of its own (#231): 'supply/<item name>',
// group-links.ts's sourceOf. Only ever the start of a link.
export const sourcePlace = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^supply\/[^:\s][^:]{0,79}$/.test(value) &&
  value === value.trimEnd();
// Whether from and to name two different places: a known group or one of linkPlaces, or a source
// as the start.
export const linkKey = (from: unknown, to: unknown, known: Set<string>) =>
  (sourcePlace(from) ||
    (typeof from === 'string' && (known.has(from) || linkPlaces.includes(from)))) &&
  typeof to === 'string' &&
  (known.has(to) || linkPlaces.includes(to)) &&
  from !== to;
// A link from a source of its own (#231) is 11: releases before it know only 'mines'.
const linksNeedV11 = (factoryGroups: FactoryGroups) =>
  Object.keys(factoryGroups.links || {}).some(key => sourcePlace(key.split(':')[0]));
// A link's transport as saved: a vehicle mode, a round trip of up to a day in minutes, and a
// fuel for the vehicles that burn one.
export function linkTransport(value: unknown): LinkTransport {
  if (
    !plain(value) ||
    !linkModes.includes(value.mode as LinkMode) ||
    typeof value.roundTripMin !== 'number' ||
    !Number.isFinite(value.roundTripMin) ||
    value.roundTripMin < 0.1 ||
    value.roundTripMin > 1440
  )
    fail('Invalid transport for a group link.');
  const mode = value.mode as LinkMode;
  if (fuelledModes.includes(mode) !== vehicleFuels.includes(value.fuel as string))
    fail('Invalid vehicle fuel for a group link.');
  return {
    mode,
    roundTripMin: value.roundTripMin,
    ...(fuelledModes.includes(mode) ? { fuel: value.fuel as string } : {}),
  };
}
// Returns a clean copy of onSiteReview (#876), or undefined when absent or empty: the ticks a
// recalculation kept for review because of lines made on site, by check key, as checks are kept.
export function validateOnSiteReview(raw: unknown): OnSiteReview | undefined {
  if (raw === undefined) return undefined;
  const bad = () => fail('Invalid ticks kept for review.');
  if (!plain(raw) || !plain(raw.checks) || Object.keys(raw.checks).length > 20000) bad();
  const checks: Record<string, boolean> = {};
  for (const [key, value] of Object.entries((raw as Raw).checks as Raw)) {
    if (!safeKey(key) || typeof value !== 'boolean') bad();
    checks[key] = value as boolean;
  }
  // Only kept with an entry, so a state without one keeps its old shape and version.
  return Object.keys(checks).length ? { checks } : undefined;
}
// Returns a clean copy of handbookOrigin (#485), or undefined when absent. Its unmapped records
// follow the same rules as the state's own checks, notes and group assignments; the groups an
// unmapped assignment names need not exist any more.
export function validateOrigin(raw: unknown): HandbookOrigin | undefined {
  if (raw === undefined) return undefined;
  const bad = () => fail('Invalid record of an earlier profile conversion.');
  if (!plain(raw) || typeof raw.version !== 'string' || !/^[\w.:-]{1,40}$/.test(raw.version)) bad();
  const unmapped = (raw as Raw).unmapped;
  if (!plain(unmapped)) bad();
  const out: HandbookOrigin = {
    version: (raw as Raw).version as string,
    unmapped: { checks: {}, notes: {}, assignments: {} },
  };
  const { checks, notes, assignments } = unmapped as Raw;
  if (!plain(checks) || Object.keys(checks).length > 20000) bad();
  for (const [key, value] of Object.entries(checks as Raw)) {
    if (!safeKey(key) || typeof value !== 'boolean') bad();
    out.unmapped.checks[key] = value as boolean;
  }
  if (!plain(notes) || Object.keys(notes).length > 20000) bad();
  for (const [key, value] of Object.entries(notes as Raw)) {
    if (!safeKey(key) || typeof value !== 'string' || value.length > 6000) bad();
    out.unmapped.notes[key] = value as string;
  }
  if (!plain(assignments) || Object.keys(assignments).length > 1000) bad();
  for (const [rowKey, list] of Object.entries(assignments as Raw)) {
    if (!safeKey(rowKey) || !Array.isArray(list) || !list.length || list.length > 12) bad();
    out.unmapped.assignments[rowKey] = (list as unknown[]).map(member => {
      const rate = plain(member) ? (member.rate ?? null) : undefined;
      if (
        !plain(member) ||
        !groupId(member.group) ||
        (rate !== null &&
          (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || rate > 10000000))
      )
        bad();
      return { group: (member as Raw).group as string, rate: rate as number | null };
    });
  }
  const mapping = validateMapping((raw as Raw).mapping, bad);
  if (mapping) out.mapping = mapping;
  return out;
}
// The most handbookOrigin.mapping may hold (#606): row ids per stage, factory ids, knownChecks and
// deliveries. A stored handbook has no such limits, so the migration records a mapping only when
// it fits them (mappingFits); a profile whose handbook is larger migrates without one.
export const mappingLimits = { rows: 1000, factories: 1000, knownChecks: 20000, deliveries: 1000 };
// Whether a mapping is within mappingLimits, so validateState accepts it.
export const mappingFits = ({ rows, factories, knownChecks, deliveries }: HandbookMapping) =>
  Object.values(rows).every(ids => Object.keys(ids).length <= mappingLimits.rows) &&
  factories.length <= mappingLimits.factories &&
  Object.keys(knownChecks).length <= mappingLimits.knownChecks &&
  Object.keys(deliveries).length <= mappingLimits.deliveries;
// Returns a clean copy of handbookOrigin.mapping (#606), or undefined when absent: what the
// migration mapped, which re-keys a progress backup made before it (restoreProgress in
// handbook-migration.ts). Every id passes safeKey, as the records it re-keys do.
function validateMapping(raw: unknown, bad: () => never): HandbookMapping | undefined {
  if (raw === undefined) return undefined;
  if (!plain(raw)) bad();
  const { rows, factories, knownChecks, deliveries } = raw as Raw;
  const out: HandbookMapping = { rows: {}, factories: [], knownChecks: {}, deliveries: {} };
  if (!plain(rows)) bad();
  for (const [stage, ids] of Object.entries(rows as Raw)) {
    if (!['3', '4', '5'].includes(stage) || !plain(ids)) bad();
    if (Object.keys(ids).length > mappingLimits.rows) bad();
    const stageRows: Record<string, string> = {};
    for (const [factoryId, rowId] of Object.entries(ids as Raw)) {
      if (!safeKey(factoryId) || !safeKey(rowId)) bad();
      stageRows[factoryId] = rowId as string;
    }
    out.rows[stage as '3' | '4' | '5'] = stageRows;
  }
  if (!Array.isArray(factories) || factories.length > mappingLimits.factories) bad();
  for (const factoryId of factories as unknown[]) {
    if (!safeKey(factoryId) || out.factories.includes(factoryId)) bad();
    out.factories.push(factoryId as string);
  }
  if (!plain(knownChecks) || Object.keys(knownChecks).length > mappingLimits.knownChecks) bad();
  for (const [key, value] of Object.entries(knownChecks as Raw)) {
    if (!safeKey(key) || typeof value !== 'boolean') bad();
    out.knownChecks[key] = value as boolean;
  }
  if (!plain(deliveries) || Object.keys(deliveries).length > mappingLimits.deliveries) bad();
  for (const [key, value] of Object.entries(deliveries as Raw)) {
    if (!safeKey(key) || !Number.isSafeInteger(value) || (value as number) < 0) bad();
    if ((value as number) > 1000000000) bad();
    out.deliveries[key] = value as number;
  }
  return out;
}
// Returns a clean copy of storageEdits, or a blank one when absent (version 1 states).
// Throws on anything malformed; only clearedSlots is quietly narrowed, see below.
export function validateEdits(raw: unknown): StorageEdits {
  if (raw === undefined) return blankEdits();
  if (!plain(raw)) fail('Invalid storage layout in backup.');
  const clean = blankEdits();
  if (raw.floors !== undefined) {
    if (!Array.isArray(raw.floors) || raw.floors.length > 12) fail('Invalid storage floors.');
    const seen = new Set<string>();
    clean.floors = raw.floors.map((floor: unknown) => {
      // The id is kept as it passed addedFloorId, which only a string can in practice.
      const id = plain(floor) ? (floor.id as string) : '';
      if (!plain(floor) || !addedFloorId(id) || seen.has(id) || !label(floor.label))
        fail('Invalid storage floor.');
      seen.add(id);
      return { id, label: floor.label.trim() };
    });
  }
  if (raw.bays !== undefined) {
    if (!Array.isArray(raw.bays) || raw.bays.length > 40) fail('Invalid storage bays.');
    const seen = new Set<string>();
    // A bay under a handbook letter is still accepted (see handbookBay), so a state that holds
    // one keeps loading rather than failing.
    clean.bays = raw.bays.map((bay: unknown) => {
      if (
        !plain(bay) ||
        !bayId(bay.id) ||
        seen.has(bay.id) ||
        !label(bay.name) ||
        !floorId(bay.floor)
      )
        fail('Invalid storage bay.');
      seen.add(bay.id);
      return { id: bay.id, name: bay.name.trim(), floor: bay.floor };
    });
  }
  // Every address a layout can reach: 18 handbook bays plus 40 added ones, each
  // holding up to bayCapacity containers.
  const names: ['floorNames' | 'bayNames' | 'slots', (key: unknown) => key is string, number][] = [
    ['floorNames', floorId, 15],
    ['bayNames', bayId, 60],
    ['slots', slotAddr, 58 * bayCapacity],
  ];
  for (const [kind, check, max] of names) {
    const map = raw[kind];
    if (map === undefined) continue;
    if (!plain(map) || Object.keys(map).length > max) fail('Invalid storage names.');
    for (const [key, name] of Object.entries(map)) {
      if (!check(key) || !label(name, kind === 'slots' ? 120 : 80)) fail('Invalid storage name.');
      clean[kind][key] = name.trim();
    }
  }
  if (raw.clearedSlots !== undefined) {
    if (
      !Array.isArray(raw.clearedSlots) ||
      raw.clearedSlots.length > 600 ||
      raw.clearedSlots.some((address: unknown) => !slotAddr(address))
    )
      fail('Invalid storage positions.');
    // A cleared position hides a handbook container. An added position has no
    // handbook container behind it, so clearing one removes the address itself.
    clean.clearedSlots = [...new Set<string>(raw.clearedSlots)].filter(
      address => !addedSlot(address),
    );
  }
  if (raw.hiddenBays !== undefined) {
    if (
      !Array.isArray(raw.hiddenBays) ||
      raw.hiddenBays.length > 18 ||
      raw.hiddenBays.some((letter: unknown) => typeof letter !== 'string' || !handbookBay(letter))
    )
      fail('Invalid hidden storage bays.');
    clean.hiddenBays = [...new Set<string>(raw.hiddenBays)].sort();
  }
  if (raw.hiddenFloors !== undefined) {
    const list = raw.hiddenFloors;
    if (
      !Array.isArray(list) ||
      list.some((floor: unknown) => !builtinFloors.some(([id]) => id === floor))
    )
      fail('Invalid hidden storage floors.');
    clean.hiddenFloors = builtinFloors.map(([id]) => id).filter(id => list.includes(id));
    if (clean.hiddenFloors.length === builtinFloors.length && !clean.floors.length)
      fail('Invalid hidden storage floors.');
  }
  if (raw.bayFloors !== undefined) {
    if (!plain(raw.bayFloors)) fail('Invalid storage bay floors.');
    const moved: Record<string, string> = {};
    for (const [letter, floor] of Object.entries(raw.bayFloors)) {
      if (!handbookBay(letter) || !knownFloor(clean, floor)) fail('Invalid storage bay floors.');
      // A bay recorded on its own floor has not moved.
      if (floor !== handbookFloor(letter)) moved[letter] = floor;
    }
    // Only kept when a bay moved, so a layout without moves keeps its old shape.
    if (Object.keys(moved).length) clean.bayFloors = moved;
  }
  if (raw.bayOrder !== undefined) {
    if (!plain(raw.bayOrder) || Object.keys(raw.bayOrder).length > 15)
      fail('Invalid storage bay order.');
    const order: Record<string, string[]> = {};
    for (const [floor, letters] of Object.entries(raw.bayOrder)) {
      if (
        !knownFloor(clean, floor) ||
        !Array.isArray(letters) ||
        letters.length > 60 ||
        letters.some((id: unknown) => !bayId(id)) ||
        new Set(letters).size !== letters.length
      )
        fail('Invalid storage bay order.');
      // Letters no longer on the floor stay listed and are skipped where the order is read
      // (views/storage.ts), so nothing here depends on which bays a profile shows.
      if (letters.length) order[floor] = [...letters];
    }
    // Only kept when a floor has an order, so a layout without one keeps its old shape.
    if (Object.keys(order).length) clean.bayOrder = order;
  }
  return clean;
}
// A floor that exists in this layout: a built-in one, hidden or not, or an added one.
export const knownFloor = (edits: StorageEdits, id: unknown): id is string =>
  builtinFloors.some(([builtinId]) => builtinId === id) ||
  edits.floors.some(floor => floor.id === id);
// Whether any bay the layout places itself sits on a floor: an added bay, or a handbook bay
// moved there. Printed bays on their own floor are the page's to count (storage-room.ts).
export const baysOn = (edits: StorageEdits, id: string) =>
  edits.bays.some(bay => bay.floor === id) || Object.values(edits.bayFloors || {}).includes(id);
// The single gate for progress: every load, import, update and new profile passes through
// it, on the server (workspace.ts), in the browser (browser-api.ts) and inside full-save
// imports (transfer.ts). Returns a fresh, normalised copy and never changes its input.
// Versions 1–15 are accepted as they are; there is no field-by-field upgrade, because each
// version only adds optional sections that default to blank. A higher version is refused
// with an update message, so a newer save is never downgraded or stripped. Anything
// malformed throws with status 400 instead of being dropped, so a bad import cannot
// replace good progress. Unknown top-level fields and settings other than phase are not
// kept.
export function validateState(state: unknown): ProgressState {
  if (
    !plain(state) ||
    ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].includes(state.version as number)
  )
    fail(
      // Compared as the old code did, so a version given as "16" also gets the update message.
      ((state as Raw | null | undefined)?.version as number) > 15
        ? 'This backup was made by a newer planner version. Update the app to import it.'
        : 'Choose a valid version 1 planner backup.',
    );
  const clean = initialState();
  for (const kind of ['checks', 'notes', 'deliveries'] as const) {
    const records = state[kind];
    if (!plain(records) || Object.keys(records).length > 20000)
      fail('Invalid ' + kind + ' in backup.');
    // Filled with values checked one by one below.
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(records)) {
      if (!safeKey(key)) fail('Invalid record address.');
      if (
        (kind === 'checks' && typeof value !== 'boolean') ||
        (kind === 'notes' && (typeof value !== 'string' || value.length > 6000)) ||
        (kind === 'deliveries' &&
          (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1000000000))
      )
        fail('Invalid ' + kind + ' value.');
      out[key] = value;
    }
    // Every value was checked above against its kind's type.
    Object.assign(clean, { [kind]: out });
  }
  if (!plain(state.settings) || !isPhase(state.settings.phase)) fail('Invalid selected phase.');
  clean.settings = { phase: state.settings.phase };
  if (!Array.isArray(state.customTasks) || state.customTasks.length > 500)
    fail('Invalid personal tasks.');
  const seen = new Set<string>();
  clean.customTasks = state.customTasks.map((task: unknown): CustomTask => {
    if (
      !plain(task) ||
      !safeKey(task.id) ||
      !task.id.startsWith('custom-') ||
      seen.has(task.id) ||
      typeof task.title !== 'string' ||
      !task.title.trim() ||
      task.title.length > 240 ||
      !isPhase(task.phase)
    )
      fail('Invalid personal task.');
    seen.add(task.id);
    return { id: task.id, title: task.title.trim(), phase: task.phase };
  });
  clean.storageEdits = validateEdits(state.storageEdits);
  clean.taskEdits = validateTaskEdits(state.taskEdits);
  clean.factoryGroups = validateGroups(state.factoryGroups);
  const origin = validateOrigin(state.handbookOrigin);
  if (origin) clean.handbookOrigin = origin;
  const review = validateOnSiteReview(state.onSiteReview);
  if (review) clean.onSiteReview = review;
  // Version 1 states never carry layout edits, so older planners keep importing
  // untouched saves; a state with layout edits is marked 2, one with build plan
  // edits or factory groups 3, and one using a container position past 08 is
  // marked 4, and one with a hidden handbook bay 5, so old versions refuse it instead of
  // silently dropping those edits (and showing the bay again as if nothing happened).
  // A hidden built-in floor is 6: a version-5 release would drop the list it does not know
  // and show the floor again. A vehicle picked for a group link is 7 (#205): an older
  // validateGroups keeps only groups and assignments and would drop the choice. A handbook
  // bay moved to another floor is 8 (#190): an older release would drop bayFloors and put the
  // bay back. A link to or from the vehicles' own fuel (#206) is 9 (#220): a place releases
  // before #218 do not know, so they would refuse the state as malformed instead of asking for
  // an update. Bays put in their own order on a floor are 10 (#191): an older release would
  // drop bayOrder and put them back in letter order. A link from one raw resource or
  // existing-supply item as a source of its own (#231) is 11: an older release knows only the
  // one 'mines' place and would refuse the state as malformed. A profile migrated from the
  // handbook (#387) is 12: it carries handbookOrigin, and an older release would open it as an
  // ordinary profile and drop what the migration kept for review. One that also records what its
  // migration mapped (#606) is 13: a version-12 release would drop the mapping, and a backup
  // restored onto the profile later could then no longer be re-keyed. A group that makes items on
  // site (factoryGroups.local, #874) is 14: an older release's validateGroups would drop the choice.
  // Ticks a recalculation kept for review because of lines made on site (onSiteReview, #876) are
  // 15: an older release would drop them, and they are progress.
  clean.version = clean.onSiteReview
    ? 15
    : clean.factoryGroups.local
      ? 14
      : clean.handbookOrigin?.mapping
        ? 13
        : clean.handbookOrigin
          ? 12
          : linksNeedV11(clean.factoryGroups)
            ? 11
            : clean.storageEdits.bayOrder
              ? 10
              : linksNeedV9(clean.factoryGroups)
                ? 9
                : clean.storageEdits.bayFloors
                  ? 8
                  : clean.factoryGroups.links
                    ? 7
                    : clean.storageEdits.hiddenFloors.length
                      ? 6
                      : clean.storageEdits.hiddenBays.length
                        ? 5
                        : hasAddedSlots(clean.storageEdits)
                          ? 4
                          : hasTaskEdits(clean.taskEdits) || hasGroups(clean.factoryGroups)
                            ? 3
                            : hasEdits(clean.storageEdits)
                              ? 2
                              : 1;
  const revision = state.revision as number;
  clean.revision = Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
  return clean;
}
