// Saved progress: the blank state and validateState, the single gate every load, import,
// update and new profile passes through, with the record rules (keys, labels, storage
// addresses, factory group links) the other state modules share. Re-exported by ../state.ts.
//
// Types: ProgressState is what validateState returns, SavedState anything it accepts
// (public/types/state.ts). Input arrives as unknown and is narrowed by the checks below
// (plain, safeKey, label, ...), which are type guards; nothing is trusted before them.
import { vehicleFuels } from '../preferences.ts';
import type {
  CustomTask,
  FactoryGroups,
  GroupAssignment,
  HandbookOrigin,
  LinkMode,
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
export const plain = (x: unknown): x is Raw =>
  x !== null &&
  typeof x === 'object' &&
  !Array.isArray(x) &&
  Object.getPrototypeOf(x) === Object.prototype;
// Every record address (check, note, delivery, step or row id) must pass this, a plan guide's
// step ids too (transfer.ts). The
// prototype names are refused so a saved key can never reach an object's prototype.
export const safeKey = (k: unknown): k is string =>
  typeof k === 'string' &&
  /^[a-zA-Z0-9:_-]{1,160}$/.test(k) &&
  !['__proto__', 'constructor', 'prototype'].includes(k);
// Throws an error carrying the HTTP status server.ts replies with; its message is the
// text the user sees.
// A function declaration, so TypeScript knows the code after a failed check is unreachable.
export function fail(message: string, status = 400): never {
  const e = new Error(message) as Error & { status: number };
  e.status = status;
  throw e;
}
export const builtinFloors: [id: string, label: string][] = [
  ['ground', 'Ground floor'],
  ['upper', 'Upper floor'],
  ['workshop', 'Workshop'],
];
// A floor is a built-in one or an added 'cf-…' one; a bay is one or two capital letters.
export const floorId = (k: unknown): k is string =>
  typeof k === 'string' &&
  (builtinFloors.some(([id]) => id === k) || /^cf-[a-z0-9]{4,32}$/.test(k));
export const bayId = (k: unknown): k is string => typeof k === 'string' && /^[A-Z]{1,2}$/.test(k);
// The handbook's own bays, A–R in plan.json (a test keeps the two in step). An added bay may take
// one of these letters only while that handbook bay is hidden (#167), and only after the hidden
// bay's kept records are cleared, so two bays never share addresses or progress.
export const handbookBay = (k: string) => /^[A-R]$/.test(k);
// A handbook bay's own floor in plan.json: A–H on the ground floor, I–R upstairs (a test keeps
// this in step too). Moving a bay back there forgets its entry in bayFloors (#190).
export const handbookFloor = (k: string) => (k <= 'H' ? 'ground' : 'upper');
// An added floor's id as validateEdits has always checked it: the pattern test alone, which
// stringifies what it is given. Kept exactly, so no stored layout that passed before fails now.
export const addedFloorId = (k: unknown) => /^cf-[a-z0-9]{4,32}$/.test(k as string);
// A bay prints eight positions, 01-08. Needing more containers than that
// extends the bay with addresses 09 upwards, up to bayCapacity. Printed
// addresses never move, so saved progress stays with its container.
export const bayCapacity = 99;
export const bayOfSlot = (k: string) => k.slice(0, -2);
export const slotPosition = (k: string) => Number(k.slice(-2));
export const slotAddr = (k: unknown): k is string =>
  typeof k === 'string' &&
  /^[A-Z]{1,2}[0-9]{2}$/.test(k) &&
  slotPosition(k) >= 1 &&
  slotPosition(k) <= bayCapacity;
export const addedSlot = (k: string) => slotPosition(k) > 8;
// Whether a layout needs version 4: only a named container at 09 or above does.
const hasAddedSlots = (e: StorageEdits) => Object.keys(e.slots).some(addedSlot);
// A user-entered name: non-blank and at most max characters once trimmed.
export const label = (v: unknown, max = 80): v is string =>
  typeof v === 'string' && !!v.trim() && v.trim().length <= max;
// hasEdits, hasTaskEdits and hasGroups decide the content version in validateState.
const hasEdits = (e: StorageEdits) =>
  e.floors.length ||
  e.bays.length ||
  e.clearedSlots.length ||
  Object.keys(e.floorNames).length + Object.keys(e.bayNames).length + Object.keys(e.slots).length >
    0;
const phases: string[] = ['1', '2', '3', '4', '5', 'post'];
export const isPhase = (p: unknown): p is Phase => phases.includes(p as string);
export const groupId = (k: unknown): k is string =>
  typeof k === 'string' && /^fg-[a-z0-9]{4,32}$/.test(k);
const hasTaskEdits = (e: TaskEdits) =>
  e.removed.length ||
  Object.keys(e.order).length +
    Object.keys(e.titles).length +
    Object.keys(e.bodies).length +
    Object.keys(e.links).length >
    0;
const hasGroups = (g: FactoryGroups) => g.groups.length || Object.keys(g.assignments).length > 0;
// Returns a clean copy of taskEdits, or a blank one when absent (states before version 3).
// Throws on anything malformed. Step ids are not checked against a plan, so edits to a
// step the current plan no longer shows are kept rather than dropped.
export function validateTaskEdits(raw: unknown): TaskEdits {
  if (raw === undefined) return blankTaskEdits();
  if (!plain(raw)) fail('Invalid build plan edits in backup.');
  const e = blankTaskEdits();
  if (raw.order !== undefined) {
    if (!plain(raw.order)) fail('Invalid step order.');
    for (const [ph, ids] of Object.entries(raw.order)) {
      if (
        !isPhase(ph) ||
        !Array.isArray(ids) ||
        ids.length > 600 ||
        ids.some(k => !safeKey(k)) ||
        new Set(ids).size !== ids.length
      )
        fail('Invalid step order.');
      if (ids.length) e.order[ph] = [...ids];
    }
  }
  if (raw.removed !== undefined) {
    if (
      !Array.isArray(raw.removed) ||
      raw.removed.length > 2000 ||
      raw.removed.some(k => !safeKey(k))
    )
      fail('Invalid removed steps.');
    e.removed = [...new Set(raw.removed)];
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
    for (const [k, v] of Object.entries(map)) {
      if (!safeKey(k) || (kind === 'links' ? !safeKey(v) : !label(v, max)))
        fail('Invalid step edit.');
      // Both checks above leave v a string.
      e[kind][k] = kind === 'links' ? (v as string) : (v as string).trim();
    }
  }
  return e;
}
// Returns a clean copy of factoryGroups, or a blank one when absent. Every assignment must
// name a group from the same list, each group at most once per row.
export function validateGroups(raw: unknown): FactoryGroups {
  if (raw === undefined) return blankGroups();
  if (!plain(raw)) fail('Invalid factory groups in backup.');
  const g = blankGroups();
  if (raw.groups !== undefined) {
    if (!Array.isArray(raw.groups) || raw.groups.length > 60) fail('Invalid factory groups.');
    const seen = new Set<string>();
    g.groups = raw.groups.map((x: unknown) => {
      if (!plain(x) || !groupId(x.id) || seen.has(x.id) || !label(x.name))
        fail('Invalid factory group.');
      seen.add(x.id);
      return { id: x.id, name: x.name.trim() };
    });
  }
  if (raw.assignments !== undefined) {
    if (!plain(raw.assignments) || Object.keys(raw.assignments).length > 1000)
      fail('Invalid factory group assignments.');
    const known = new Set(g.groups.map(x => x.id));
    for (const [k, list] of Object.entries(raw.assignments)) {
      if (!safeKey(k) || !Array.isArray(list) || !list.length || list.length > 12)
        fail('Invalid factory group assignment.');
      const used = new Set<string>();
      g.assignments[k] = list.map((m: unknown): GroupAssignment => {
        if (!plain(m) || !known.has(m.group as string) || used.has(m.group as string))
          fail('Invalid factory group assignment.');
        // known holds only group ids, so the check above leaves a string.
        const group = m.group as string;
        used.add(group);
        const rate = m.rate ?? null;
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
    const known = new Set(g.groups.map(x => x.id));
    const links: Record<string, LinkTransport> = {};
    for (const [k, v] of Object.entries(raw.links)) {
      const [from, to, extra] = k.split(':');
      if (extra !== undefined || !linkKey(from, to, known)) fail('Invalid group link.');
      links[k] = linkTransport(v);
    }
    // Only kept when there is one, so a state without vehicle links keeps its old shape.
    if (Object.keys(links).length) g.links = links;
  }
  return g;
}
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
const linksNeedV9 = (g: FactoryGroups) =>
  Object.keys(g.links || {}).some(k => k.split(':').some(p => laterPlaces.includes(p)));
// A raw resource or existing-supply item as a source of its own (#231): 'supply/<item name>',
// group-links.ts's sourceOf. Only ever the start of a link.
export const sourcePlace = (p: unknown): p is string =>
  typeof p === 'string' && /^supply\/[^:\s][^:]{0,79}$/.test(p) && p === p.trimEnd();
// Whether from and to name two different places: a known group or one of linkPlaces, or a source
// as the start.
export const linkKey = (from: unknown, to: unknown, known: Set<string>) =>
  (sourcePlace(from) ||
    (typeof from === 'string' && (known.has(from) || linkPlaces.includes(from)))) &&
  typeof to === 'string' &&
  (known.has(to) || linkPlaces.includes(to)) &&
  from !== to;
// A link from a source of its own (#231) is 11: releases before it know only 'mines'.
const linksNeedV11 = (g: FactoryGroups) =>
  Object.keys(g.links || {}).some(k => sourcePlace(k.split(':')[0]));
// A link's transport as saved: a vehicle mode, a round trip of up to a day in minutes, and a
// fuel for the vehicles that burn one.
export function linkTransport(v: unknown): LinkTransport {
  if (
    !plain(v) ||
    !linkModes.includes(v.mode as LinkMode) ||
    typeof v.roundTripMin !== 'number' ||
    !Number.isFinite(v.roundTripMin) ||
    v.roundTripMin < 0.1 ||
    v.roundTripMin > 1440
  )
    fail('Invalid transport for a group link.');
  const mode = v.mode as LinkMode;
  if (fuelledModes.includes(mode) !== vehicleFuels.includes(v.fuel as string))
    fail('Invalid vehicle fuel for a group link.');
  return {
    mode,
    roundTripMin: v.roundTripMin,
    ...(fuelledModes.includes(mode) ? { fuel: v.fuel as string } : {}),
  };
}
// Returns a clean copy of handbookOrigin (#485), or undefined when absent. Its unmapped records
// follow the same rules as the state's own checks, notes and group assignments; the groups an
// unmapped assignment names need not exist any more.
export function validateOrigin(raw: unknown): HandbookOrigin | undefined {
  if (raw === undefined) return undefined;
  const bad = () => fail('Invalid handbook origin.');
  if (!plain(raw) || typeof raw.version !== 'string' || !/^[\w.:-]{1,40}$/.test(raw.version)) bad();
  const u = (raw as Raw).unmapped;
  if (!plain(u)) bad();
  const out: HandbookOrigin = {
    version: (raw as Raw).version as string,
    unmapped: { checks: {}, notes: {}, assignments: {} },
  };
  const { checks, notes, assignments } = u as Raw;
  if (!plain(checks) || Object.keys(checks).length > 20000) bad();
  for (const [k, v] of Object.entries(checks as Raw)) {
    if (!safeKey(k) || typeof v !== 'boolean') bad();
    out.unmapped.checks[k] = v as boolean;
  }
  if (!plain(notes) || Object.keys(notes).length > 20000) bad();
  for (const [k, v] of Object.entries(notes as Raw)) {
    if (!safeKey(k) || typeof v !== 'string' || v.length > 6000) bad();
    out.unmapped.notes[k] = v as string;
  }
  if (!plain(assignments) || Object.keys(assignments).length > 1000) bad();
  for (const [k, list] of Object.entries(assignments as Raw)) {
    if (!safeKey(k) || !Array.isArray(list) || !list.length || list.length > 12) bad();
    out.unmapped.assignments[k] = (list as unknown[]).map(m => {
      const rate = plain(m) ? (m.rate ?? null) : undefined;
      if (
        !plain(m) ||
        !groupId(m.group) ||
        (rate !== null &&
          (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || rate > 10000000))
      )
        bad();
      return { group: (m as Raw).group as string, rate: rate as number | null };
    });
  }
  return out;
}
// Returns a clean copy of storageEdits, or a blank one when absent (version 1 states).
// Throws on anything malformed; only clearedSlots is quietly narrowed, see below.
export function validateEdits(raw: unknown): StorageEdits {
  if (raw === undefined) return blankEdits();
  if (!plain(raw)) fail('Invalid storage layout in backup.');
  const e = blankEdits();
  if (raw.floors !== undefined) {
    if (!Array.isArray(raw.floors) || raw.floors.length > 12) fail('Invalid storage floors.');
    const seen = new Set<string>();
    e.floors = raw.floors.map((f: unknown) => {
      // The id is kept as it passed addedFloorId, which only a string can in practice.
      const id = plain(f) ? (f.id as string) : '';
      if (!plain(f) || !addedFloorId(id) || seen.has(id) || !label(f.label))
        fail('Invalid storage floor.');
      seen.add(id);
      return { id, label: f.label.trim() };
    });
  }
  if (raw.bays !== undefined) {
    if (!Array.isArray(raw.bays) || raw.bays.length > 40) fail('Invalid storage bays.');
    const seen = new Set<string>();
    // A bay under a handbook letter is still accepted (see handbookBay), so a state that holds
    // one keeps loading rather than failing.
    e.bays = raw.bays.map((b: unknown) => {
      if (!plain(b) || !bayId(b.id) || seen.has(b.id) || !label(b.name) || !floorId(b.floor))
        fail('Invalid storage bay.');
      seen.add(b.id);
      return { id: b.id, name: b.name.trim(), floor: b.floor };
    });
  }
  // Every address a layout can reach: 18 handbook bays plus 40 added ones, each
  // holding up to bayCapacity containers.
  const names: ['floorNames' | 'bayNames' | 'slots', (k: unknown) => k is string, number][] = [
    ['floorNames', floorId, 15],
    ['bayNames', bayId, 60],
    ['slots', slotAddr, 58 * bayCapacity],
  ];
  for (const [kind, check, max] of names) {
    const map = raw[kind];
    if (map === undefined) continue;
    if (!plain(map) || Object.keys(map).length > max) fail('Invalid storage names.');
    for (const [k, v] of Object.entries(map)) {
      if (!check(k) || !label(v, kind === 'slots' ? 120 : 80)) fail('Invalid storage name.');
      e[kind][k] = v.trim();
    }
  }
  if (raw.clearedSlots !== undefined) {
    if (
      !Array.isArray(raw.clearedSlots) ||
      raw.clearedSlots.length > 600 ||
      raw.clearedSlots.some((k: unknown) => !slotAddr(k))
    )
      fail('Invalid storage positions.');
    // A cleared position hides a handbook container. An added position has no
    // handbook container behind it, so clearing one removes the address itself.
    e.clearedSlots = [...new Set<string>(raw.clearedSlots)].filter(k => !addedSlot(k));
  }
  if (raw.hiddenBays !== undefined) {
    if (
      !Array.isArray(raw.hiddenBays) ||
      raw.hiddenBays.length > 18 ||
      raw.hiddenBays.some((k: unknown) => typeof k !== 'string' || !handbookBay(k))
    )
      fail('Invalid hidden storage bays.');
    e.hiddenBays = [...new Set<string>(raw.hiddenBays)].sort();
  }
  if (raw.hiddenFloors !== undefined) {
    const list = raw.hiddenFloors;
    if (!Array.isArray(list) || list.some((k: unknown) => !builtinFloors.some(([id]) => id === k)))
      fail('Invalid hidden storage floors.');
    e.hiddenFloors = builtinFloors.map(([id]) => id).filter(id => list.includes(id));
    if (e.hiddenFloors.length === builtinFloors.length && !e.floors.length)
      fail('Invalid hidden storage floors.');
  }
  if (raw.bayFloors !== undefined) {
    if (!plain(raw.bayFloors)) fail('Invalid storage bay floors.');
    const moved: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.bayFloors)) {
      if (!handbookBay(k) || !knownFloor(e, v)) fail('Invalid storage bay floors.');
      // A bay recorded on its own floor has not moved.
      if (v !== handbookFloor(k)) moved[k] = v;
    }
    // Only kept when a bay moved, so a layout without moves keeps its old shape.
    if (Object.keys(moved).length) e.bayFloors = moved;
  }
  if (raw.bayOrder !== undefined) {
    if (!plain(raw.bayOrder) || Object.keys(raw.bayOrder).length > 15)
      fail('Invalid storage bay order.');
    const order: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(raw.bayOrder)) {
      if (
        !knownFloor(e, k) ||
        !Array.isArray(v) ||
        v.length > 60 ||
        v.some((id: unknown) => !bayId(id)) ||
        new Set(v).size !== v.length
      )
        fail('Invalid storage bay order.');
      // Letters no longer on the floor stay listed and are skipped where the order is read
      // (views/storage.ts), so nothing here depends on which bays a profile shows.
      if (v.length) order[k] = [...v];
    }
    // Only kept when a floor has an order, so a layout without one keeps its old shape.
    if (Object.keys(order).length) e.bayOrder = order;
  }
  return e;
}
// A floor that exists in this layout: a built-in one, hidden or not, or an added one.
export const knownFloor = (e: StorageEdits, id: unknown): id is string =>
  builtinFloors.some(([f]) => f === id) || e.floors.some(f => f.id === id);
// Whether any bay the layout places itself sits on a floor: an added bay, or a handbook bay
// moved there. Handbook bays on their own floor are the page's to count (plan.json).
export const baysOn = (e: StorageEdits, id: string) =>
  e.bays.some(b => b.floor === id) || Object.values(e.bayFloors || {}).includes(id);
// The single gate for progress: every load, import, update and new profile passes through
// it, on the server (workspace.ts), in the browser (browser-api.ts) and inside full-save
// imports (transfer.ts). Returns a fresh, normalised copy and never changes its input.
// Versions 1–12 are accepted as they are; there is no field-by-field upgrade, because each
// version only adds optional sections that default to blank. A higher version is refused
// with an update message, so a newer save is never downgraded or stripped. Anything
// malformed throws with status 400 instead of being dropped, so a bad import cannot
// replace good progress. Unknown top-level fields and settings other than phase are not
// kept.
export function validateState(s: unknown): ProgressState {
  if (!plain(s) || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].includes(s.version as number))
    fail(
      // Compared as the old code did, so a version given as "13" also gets the update message.
      ((s as Raw | null | undefined)?.version as number) > 12
        ? 'This backup was made by a newer planner version. Update the app to import it.'
        : 'Choose a valid version 1 planner backup.',
    );
  const clean = initialState();
  for (const kind of ['checks', 'notes', 'deliveries'] as const) {
    const records = s[kind];
    if (!plain(records) || Object.keys(records).length > 20000)
      fail('Invalid ' + kind + ' in backup.');
    // Filled with values checked one by one below.
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(records)) {
      if (!safeKey(k)) fail('Invalid record address.');
      if (
        (kind === 'checks' && typeof v !== 'boolean') ||
        (kind === 'notes' && (typeof v !== 'string' || v.length > 6000)) ||
        (kind === 'deliveries' &&
          (!Number.isSafeInteger(v) || (v as number) < 0 || (v as number) > 1000000000))
      )
        fail('Invalid ' + kind + ' value.');
      out[k] = v;
    }
    // Every value was checked above against its kind's type.
    Object.assign(clean, { [kind]: out });
  }
  if (!plain(s.settings) || !isPhase(s.settings.phase)) fail('Invalid selected phase.');
  clean.settings = { phase: s.settings.phase };
  if (!Array.isArray(s.customTasks) || s.customTasks.length > 500) fail('Invalid personal tasks.');
  const seen = new Set<string>();
  clean.customTasks = s.customTasks.map((t: unknown): CustomTask => {
    if (
      !plain(t) ||
      !safeKey(t.id) ||
      !t.id.startsWith('custom-') ||
      seen.has(t.id) ||
      typeof t.title !== 'string' ||
      !t.title.trim() ||
      t.title.length > 240 ||
      !isPhase(t.phase)
    )
      fail('Invalid personal task.');
    seen.add(t.id);
    return { id: t.id, title: t.title.trim(), phase: t.phase };
  });
  clean.storageEdits = validateEdits(s.storageEdits);
  clean.taskEdits = validateTaskEdits(s.taskEdits);
  clean.factoryGroups = validateGroups(s.factoryGroups);
  const origin = validateOrigin(s.handbookOrigin);
  if (origin) clean.handbookOrigin = origin;
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
  // ordinary profile and drop what the migration kept for review.
  clean.version = clean.handbookOrigin
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
  const revision = s.revision as number;
  clean.revision = Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
  return clean;
}
