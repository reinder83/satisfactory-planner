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
// Checklist keys link progress to content and must never be renamed, because saved states
// only hold the key: 'calc-<phase>-<rowId>' (calculated rows), 'factory-<phase>-<factoryId>'
// (handbook factories), 'slot-<address>-<built|labelled|connected|verified>' (containers),
// 'unlock-<schematic>', 'recipe-unlock-<recipe>', 'early-base-…', 'startup-…', 'custom-…'.
// Notes use 'factory-<id>' and 'slot-<address>' without a phase or step.
//
import { vehicleFuels } from './preferences.ts';
// Types: ProgressState is what validateState returns, SavedState anything it accepts
// (public/types/state.ts). Input arrives as unknown and is narrowed by the checks below
// (plain, safeKey, label, ...), which are type guards; nothing is trusted before them.
import type {
  CalcRow,
  CustomTask,
  FactoryGroups,
  GroupAssignment,
  LinkMode,
  LinkTransport,
  Phase,
  ProgressState,
  SavedState,
  StorageEdits,
  StoredCalculatedPlan,
  StoredPayoff,
  StoredProfile,
  TaskEdits,
  UpdateOp,
} from './types/index.ts';

// A plan whose rows a state is built for: a fresh calculation or a stored one.
type RowsPlan = Pick<StoredCalculatedPlan, 'settings' | 'stages'>;
// An untrusted object: a record that passed plain() but whose fields are not checked yet.
type Raw = Record<string, unknown>;

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
const plain = (x: unknown): x is Raw =>
  x !== null &&
  typeof x === 'object' &&
  !Array.isArray(x) &&
  Object.getPrototypeOf(x) === Object.prototype;
// Every record address (check, note, delivery, step or row id) must pass this. The
// prototype names are refused so a saved key can never reach an object's prototype.
const safeKey = (k: unknown): k is string =>
  typeof k === 'string' &&
  /^[a-zA-Z0-9:_-]{1,160}$/.test(k) &&
  !['__proto__', 'constructor', 'prototype'].includes(k);
// Throws an error carrying the HTTP status server.ts replies with; its message is the
// text the user sees.
// A function declaration, so TypeScript knows the code after a failed check is unreachable.
function fail(message: string, status = 400): never {
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
const floorId = (k: unknown): k is string =>
  typeof k === 'string' &&
  (builtinFloors.some(([id]) => id === k) || /^cf-[a-z0-9]{4,32}$/.test(k));
const bayId = (k: unknown): k is string => typeof k === 'string' && /^[A-Z]{1,2}$/.test(k);
// The handbook's own bays, A–R in plan.json (a test keeps the two in step). An added bay may take
// one of these letters only while that handbook bay is hidden (#167), and only after the hidden
// bay's kept records are cleared, so two bays never share addresses or progress.
export const handbookBay = (k: string) => /^[A-R]$/.test(k);
// A handbook bay's own floor in plan.json: A–H on the ground floor, I–R upstairs (a test keeps
// this in step too). Moving a bay back there forgets its entry in bayFloors (#190).
export const handbookFloor = (k: string) => (k <= 'H' ? 'ground' : 'upper');
// An added floor's id as validateEdits has always checked it: the pattern test alone, which
// stringifies what it is given. Kept exactly, so no stored layout that passed before fails now.
const addedFloorId = (k: unknown) => /^cf-[a-z0-9]{4,32}$/.test(k as string);
// A bay prints eight positions, 01-08. Needing more containers than that
// extends the bay with addresses 09 upwards, up to bayCapacity. Printed
// addresses never move, so saved progress stays with its container.
export const bayCapacity = 99;
export const bayOfSlot = (k: string) => k.slice(0, -2);
export const slotPosition = (k: string) => Number(k.slice(-2));
const slotAddr = (k: unknown): k is string =>
  typeof k === 'string' &&
  /^[A-Z]{1,2}[0-9]{2}$/.test(k) &&
  slotPosition(k) >= 1 &&
  slotPosition(k) <= bayCapacity;
const addedSlot = (k: string) => slotPosition(k) > 8;
// Whether a layout needs version 4: only a named container at 09 or above does.
const hasAddedSlots = (e: StorageEdits) => Object.keys(e.slots).some(addedSlot);
// A user-entered name: non-blank and at most max characters once trimmed.
const label = (v: unknown, max = 80): v is string =>
  typeof v === 'string' && !!v.trim() && v.trim().length <= max;
// hasEdits, hasTaskEdits and hasGroups decide the content version in validateState.
const hasEdits = (e: StorageEdits) =>
  e.floors.length ||
  e.bays.length ||
  e.clearedSlots.length ||
  Object.keys(e.floorNames).length + Object.keys(e.bayNames).length + Object.keys(e.slots).length >
    0;
const phases: string[] = ['1', '2', '3', '4', '5', 'post'];
const isPhase = (p: unknown): p is Phase => phases.includes(p as string);
const groupId = (k: unknown): k is string => typeof k === 'string' && /^fg-[a-z0-9]{4,32}$/.test(k);
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
function validateTaskEdits(raw: unknown): TaskEdits {
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
function validateGroups(raw: unknown): FactoryGroups {
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
export const linkPlaces = ['ungrouped', 'mines', 'storage', 'drone', 'elevator', 'sink'];
const linkModes: LinkMode[] = ['truck', 'tractor', 'explorer', 'train', 'drone'];
// The vehicles that burn fuel from their own slot; a train is electric and a drone's fuel
// depends on the flight distance, which the planner does not know.
export const fuelledModes: LinkMode[] = ['truck', 'tractor', 'explorer'];
// Whether from and to name two different places: a known group or one of linkPlaces.
const linkKey = (from: unknown, to: unknown, known: Set<string>) =>
  [from, to].every(p => typeof p === 'string' && (known.has(p) || linkPlaces.includes(p))) &&
  from !== to;
// A link's transport as saved: a vehicle mode, a round trip of up to a day in minutes, and a
// fuel for the vehicles that burn one.
function linkTransport(v: unknown): LinkTransport {
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
// A new profile for a save you are already playing describes the same world.
// These groups say which of the previous profile's records are facts about that
// world (unlocks, the built storage room, deliveries handed in) rather than
// facts about its plan, so a new profile can start from them instead of an
// empty checklist. Plan-shaped records are carried only where the new plan
// still asks for the same or less work.
export const carryOptions: [key: string, label: string, description: string][] = [
  [
    'unlocks',
    'Milestone, MAM and hard-drive unlocks',
    'Tier milestones, MAM research and the alternate recipes you confirmed in game.',
  ],
  [
    'storage',
    'Storage room layout and containers',
    'Floors, bays, container names and every built, labelled, connected and verified position.',
  ],
  [
    'commissioning',
    'Power and start-up steps',
    'Biomass, coal, fuel, nuclear, drone-fuel and portal commissioning you already finished.',
  ],
  [
    'deliveries',
    'Elevator deliveries handed in',
    'The part counts you already delivered to the Space Elevator.',
  ],
  [
    'notes',
    'Notes and personal tasks',
    'Save-wide notes, step notes and the tasks you added yourself.',
  ],
  [
    'planEdits',
    'Build-plan edits and factory groups',
    'Renamed, reordered and removed steps, plus your factory group names.',
  ],
  [
    'factories',
    'Factory progress for unchanged lines',
    'Production lines stay ticked where the new plan needs no more machines and no more input.',
  ],
  [
    'picked',
    'Treat this plan’s alternate recipes as unlocked',
    'Ticks the unlock step for every alternate recipe you picked, including the ones your ingot and power preferences require.',
  ],
];
// The checklist key prefixes each world-shaped carry option copies as they are. The other
// options (deliveries, notes, planEdits, factories, picked) are handled in newProfileState.
const carryPrefixes: Record<string, string[]> = {
  unlocks: ['unlock-', 'recipe-unlock-', 'hard-drives-'],
  storage: ['slot-', 'storage-'],
  commissioning: [
    'startup-',
    'preferred-power-',
    'drone-fuel-',
    'early-base-',
    'portal-supply',
    'power-retained',
  ],
};
// Turns the client's carry choices into { option: boolean }. An absent choice carries
// everything; anything else that is not an object carries nothing.
export const carryPicks = (raw: unknown): Record<string, boolean> =>
  Object.fromEntries(
    carryOptions.map(([key]) => [key, raw === undefined ? true : !!(plain(raw) && raw[key])]),
  );
// Rows of a plan keyed by the checklist address their step uses.
const planRows = (plan: RowsPlan | null | undefined): Map<string, CalcRow> => {
  const rows = new Map<string, CalcRow>();
  for (const [ph, stage] of Object.entries(plan?.stages || {}))
    for (const r of stage.rows || []) rows.set('calc-' + ph + '-' + r.id, r);
  return rows;
};
// Hand-picking alternates states which recipes you own: the recipes ticked in
// the picker plus the ones a pure-ingot or power preference locks in for you,
// which reach the plan as alternate rows rather than as picks.
export function pickedRecipeUnlocks(plan: RowsPlan | null | undefined): string[] {
  if (plan?.settings?.recipes !== 'custom') return [];
  const ids = new Set(plan.settings.alternateRecipes || []);
  for (const row of planRows(plan).values()) if (row.alternate) ids.add(row.id);
  return [...ids].filter(id => safeKey('recipe-unlock-' + id));
}
// What a new profile may be told is already standing in the world. The guided
// start asks this for a save you are not beginning from scratch: a production
// line you already built, the HUB tutorial you already finished. These are the
// checklist keys those records already use, so nothing new is stored and the
// answer is as reversible as any other tick.
//
// Only three families are accepted, all of them facts about the world rather
// than about this plan: a production row this very plan builds, an early-base
// step, and an unlock. Anything else is dropped rather than rejected, so an
// older or newer client cannot fail a profile it is otherwise allowed to make.
const builtKeys = (raw: unknown, plan: RowsPlan | null): string[] => {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 2000) fail('Invalid list of finished work.');
  const rows = planRows(plan);
  return [...new Set<unknown>(raw)].filter(
    (k): k is string =>
      safeKey(k) && (rows.has(k) || k.startsWith('early-base-') || k.startsWith('unlock-')),
  );
};
// Build the starting progress for a newly created profile. Without a source
// profile and without a list of finished work this is the blank state every
// earlier release produced.
//
// plan is the new profile's calculation (null for an original-handbook profile), source and
// sourcePlan the sibling profile's state and plan to carry from, raw the carry choices and
// built the guided start's finished-work keys. Returns { state, reviewCount, carried }: the
// validated state, how many carried 'calc-' ticks were unticked for review, and how many
// checks start ticked. The source is only read. Called by /api/profiles in workspace.ts and
// by the matching route in browser-api.ts.
export function newProfileState(
  plan: RowsPlan | null,
  source: SavedState | null | undefined,
  sourcePlan: RowsPlan | null | undefined,
  raw: unknown,
  built: unknown,
): { state: ProgressState; reviewCount: number; carried: number } {
  const state = initialState();
  state.settings.phase = plan?.settings?.phase || '3';
  if (plan) state.factoryGroups = defaultFactoryGroups(plan);
  // Recorded before any carried records, so a source profile that deliberately
  // left one of these unticked still wins below.
  const standing = builtKeys(built, plan);
  for (const key of standing) state.checks[key] = true;
  if (!source) {
    const clean = validateState(state);
    return {
      state: clean,
      reviewCount: 0,
      carried: Object.values(clean.checks).filter(Boolean).length,
    };
  }
  const picks = carryPicks(raw);
  if (picks.factories)
    for (const key of standing) if (source.checks?.[key] === false) delete state.checks[key];
  // For a save you already play those picks are in-game unlocks, so their
  // confirmation steps start ticked. Records copied below still win, including a
  // step the previous profile left deliberately unticked.
  if (picks.picked)
    for (const id of pickedRecipeUnlocks(plan)) state.checks['recipe-unlock-' + id] = true;
  const prefixes = Object.entries(carryPrefixes)
    .filter(([key]) => picks[key])
    .flatMap(([, list]) => list);
  for (const [key, value] of Object.entries(source.checks || {}))
    if (prefixes.some(p => key.startsWith(p))) state.checks[key] = value;
  if (picks.deliveries) state.deliveries = { ...source.deliveries };
  if (picks.storage)
    for (const [key, value] of Object.entries(source.notes || {}))
      if (key.startsWith('slot-')) state.notes[key] = value;
  if (picks.storage) state.storageEdits = validateEdits(source.storageEdits);
  if (picks.notes) {
    state.notes = { ...state.notes, ...source.notes };
    state.customTasks = structuredClone(source.customTasks || []);
    for (const task of state.customTasks) {
      const done = source.checks?.[task.id];
      if (done !== undefined) state.checks[task.id] = done;
    }
  }
  if (picks.planEdits) {
    state.taskEdits = validateTaskEdits(source.taskEdits);
    state.factoryGroups = mergeGroups(state.factoryGroups, source.factoryGroups, plan);
  }
  // A row ticked in the source stays ticked only if the old plan had the same row with at
  // least as many machines and inputs. Otherwise it is stored as false, the same review
  // rule /api/round-up applies. Rows the source never ticked are left alone.
  let reviewCount = 0;
  if (picks.factories && plan) {
    const previous = planRows(sourcePlan);
    for (const [key, row] of planRows(plan)) {
      if (!source.checks?.[key] || !safeKey(key)) continue;
      const old = previous.get(key);
      const grown =
        !old ||
        row.machines > old.machines ||
        Object.entries(row.inputs || {}).some(([n, q]) => q > (old.inputs?.[n] || 0) + 0.001);
      state.checks[key] = !grown;
      if (grown) reviewCount++;
    }
  }
  const clean = validateState(state);
  return { state: clean, reviewCount, carried: Object.values(clean.checks).filter(Boolean).length };
}
// Keep the previous profile's group names and its assignments for rows the new
// plan still builds, then place the plan's remaining rows with the defaults.
function mergeGroups(defaults: FactoryGroups, raw: unknown, plan: RowsPlan | null): FactoryGroups {
  const carried = validateGroups(raw);
  if (!carried.groups.length) return defaults;
  const rows = new Set([...planRows(plan).values()].map(r => r.id));
  const groups = [...carried.groups];
  const known = new Set(groups.map(g => g.id));
  const assignments: Record<string, GroupAssignment[]> = {};
  for (const [key, list] of Object.entries(carried.assignments))
    if (rows.has(key)) assignments[key] = list;
  for (const [key, list] of Object.entries(defaults.assignments)) {
    if (assignments[key]) continue;
    for (const m of list)
      if (!known.has(m.group)) {
        const g = defaults.groups.find(x => x.id === m.group);
        if (g && groups.length < 60) {
          groups.push(g);
          known.add(g.id);
        }
      }
    if (list.every(m => known.has(m.group))) assignments[key] = list;
  }
  // Vehicle links (#205) join carried groups or fixed places, all still known here.
  return validateGroups({
    groups,
    assignments,
    ...(carried.links ? { links: carried.links } : {}),
  });
}
// A profile's stored hard-drive payoff ranking (#203) while it was ranked against the plan the
// profile has now, otherwise null. GET /api/context sends this in both editions.
export const currentPayoff = (p: Pick<StoredProfile, 'plan' | 'payoff'>): StoredPayoff | null =>
  p.plan && p.payoff?.planCreatedAt === p.plan.createdAt ? p.payoff : null;
// Sharing a profile hands over the plan-shaped content (layout, groups, step
// edits, personal tasks) while the recipient starts with fresh progress.
// Used by /api/export-saves?share=1 in workspace.ts and browser-api.ts; the input is cloned.
export function shareState(s: SavedState): ProgressState {
  const clean = validateState(structuredClone(s));
  clean.checks = {};
  clean.notes = {};
  clean.deliveries = {};
  clean.revision = 0;
  return validateState(clean);
}
// Returns a clean copy of storageEdits, or a blank one when absent (version 1 states).
// Throws on anything malformed; only clearedSlots is quietly narrowed, see below.
function validateEdits(raw: unknown): StorageEdits {
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
const knownFloor = (e: StorageEdits, id: unknown): id is string =>
  builtinFloors.some(([f]) => f === id) || e.floors.some(f => f.id === id);
// Whether any bay the layout places itself sits on a floor: an added bay, or a handbook bay
// moved there. Handbook bays on their own floor are the page's to count (plan.json).
const baysOn = (e: StorageEdits, id: string) =>
  e.bays.some(b => b.floor === id) || Object.values(e.bayFloors || {}).includes(id);
// The single gate for progress: every load, import, update and new profile passes through
// it, on the server (workspace.ts), in the browser (browser-api.ts) and inside full-save
// imports (transfer.ts). Returns a fresh, normalised copy and never changes its input.
// Versions 1–9 are accepted as they are; there is no field-by-field upgrade, because each
// version only adds optional sections that default to blank. A higher version is refused
// with an update message, so a newer save is never downgraded or stripped. Anything
// malformed throws with status 400 instead of being dropped, so a bad import cannot
// replace good progress. Unknown top-level fields and settings other than phase are not
// kept.
export function validateState(s: unknown): ProgressState {
  if (!plain(s) || ![1, 2, 3, 4, 5, 6, 7, 8, 9].includes(s.version as number))
    fail(
      // Compared as the old code did, so a version given as "10" also gets the update message.
      ((s as Raw | null | undefined)?.version as number) > 9
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
  // Version 1 states never carry layout edits, so older planners keep importing
  // untouched saves; a state with layout edits is marked 2, one with build plan
  // edits or factory groups 3, and one using a container position past 08 is
  // marked 4, and one with a hidden handbook bay 5, so old versions refuse it instead of
  // silently dropping those edits (and showing the bay again as if nothing happened).
  // A hidden built-in floor is 6: a version-5 release would drop the list it does not know
  // and show the floor again. A vehicle picked for a group link is 7 (#205): an older
  // validateGroups keeps only groups and assignments and would drop the choice. A handbook
  // bay moved to another floor is 8 (#190): an older release would drop bayFloors and put the
  // bay back. Bays put in their own order on a floor are 9 (#191): an older release would drop
  // bayOrder and put them back in letter order.
  clean.version = clean.storageEdits.bayOrder
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
// Operations that send a whole value the tab worked out from the state it last showed: a
// phase's full step order, a floor's bay order (#191), a note's whole text, a step's title/body/link. Applied on top of
// a newer state (another tab or device wrote in between), they would silently undo that
// write, so both editions refuse them unless the tab saw the current revision (#165).
// Small operations (a tick, a count, one assignment) merge safely and are never refused.
const baseSensitive = ['taskOrder', 'note', 'taskEdit', 'storageBayOrder'];
export const staleWrite =
  'This profile was changed in another tab or on another device, so your last change was not ' +
  'saved. The page now shows the latest version; text you typed is kept, and saving it again ' +
  'replaces the other version.';
// `base` is the X-Planner-Revision header: the revision the tab's state had when it sent
// the write. Without the header (an older page, a script) nothing is compared.
export function checkBase(current: SavedState, update: unknown, base: string | null | undefined) {
  if (base === null || base === undefined || base === '') return;
  const type = (update as { type?: unknown } | null)?.type;
  if (typeof type !== 'string' || !baseSensitive.includes(type)) return;
  const seen = Number(base);
  if (!Number.isSafeInteger(seen)) return;
  if (seen !== (current.revision ?? 0)) throw Object.assign(Error(staleWrite), { status: 409 });
}

// Applies one /api/update operation (op.type below) to a state and returns the validated
// result. It changes s in place first: the server passes the profile inside its draft copy
// of the workspace and browser-api.ts passes a structuredClone, so a throw from the final
// validateState discards the change. Values such as a check's boolean or a delivery count
// are only type-checked there, not here.
//
// The operation arrives as the request body, so it is checked as unknown data here, whatever
// its declared type (UpdateOp, for callers). Values only validateState checks are written as
// they came (the casts below), and a malformed one fails there. s may be a stored state of
// any version: each section is normalised before it is edited.
export function mutate(s: SavedState, update: UpdateOp): ProgressState {
  const op: unknown = update;
  if (!plain(op)) fail('Invalid update.');
  if (typeof op.type !== 'string') fail('Unknown update.');
  if (op.type === 'check' || op.type === 'note' || op.type === 'delivery') {
    if (!safeKey(op.key)) fail('Invalid record address.');
    const kind = ({ check: 'checks', note: 'notes', delivery: 'deliveries' } as const)[op.type];
    if (op.type === 'note' && typeof op.value === 'string' && !op.value.trim())
      delete s.notes[op.key];
    else (s[kind] as Raw)[op.key] = op.value;
  } else if (op.type === 'checks') {
    if (
      !Array.isArray(op.keys) ||
      !op.keys.length ||
      op.keys.length > 1000 ||
      op.keys.some((k: unknown) => !safeKey(k)) ||
      typeof op.value !== 'boolean'
    )
      fail('Invalid checklist update.');
    for (const key of op.keys as string[]) s.checks[key] = op.value;
  } else if (op.type === 'phase') {
    s.settings.phase = op.value as Phase;
  } else if (op.type === 'addTask') {
    s.customTasks.push({ id: op.id, title: op.title, phase: op.phase } as CustomTask);
  } else if (op.type === 'removeTask') {
    // Deleting a personal task also removes its tick and any step edits naming it. The id is
    // not checked: an unknown one matches nothing.
    const id = op.id as string;
    s.customTasks = s.customTasks.filter(t => t.id !== id);
    delete s.checks[id];
    const e = (s.taskEdits = validateTaskEdits(s.taskEdits));
    delete e.titles[id];
    delete e.bodies[id];
    delete e.links[id];
    e.removed = e.removed.filter(k => k !== id);
    for (const ph of Object.keys(e.order) as Phase[])
      e.order[ph] = e.order[ph]!.filter(k => k !== id);
    // A type that is not a string throws here, as it always has (see the bug backlog).
  } else if ((op.type as string).startsWith('task')) {
    mutateTasks(s, op);
  } else if ((op.type as string).startsWith('factory')) {
    mutateGroups(s, op);
  } else if ((op.type as string).startsWith('storage')) {
    mutateLayout(s, op);
  } else fail('Unknown update.');
  return validateState(s);
}
// Build-plan step edits: taskEdit (title, body, link; an empty value restores the
// original), taskRemove / taskRestore (hide or show a step, its tick is kept) and taskOrder.
function mutateTasks(s: SavedState, op: Raw) {
  const e = (s.taskEdits = validateTaskEdits(s.taskEdits));
  if (op.type === 'taskEdit') {
    if (!safeKey(op.id)) fail('Invalid step.');
    const id = op.id;
    const texts: ['titles' | 'bodies', unknown, number][] = [
      ['titles', op.title, 240],
      ['bodies', op.body, 6000],
    ];
    for (const [kind, value, max] of texts) {
      if (value === undefined) continue;
      if (typeof value !== 'string' || value.length > max) fail('Invalid step text.');
      if (value.trim()) e[kind][id] = value.trim();
      else delete e[kind][id];
    }
    if (op.link !== undefined) {
      if (op.link === '' || op.link === null) delete e.links[id];
      else {
        if (!safeKey(op.link)) fail('Invalid linked factory.');
        e.links[id] = op.link;
      }
    }
  } else if (op.type === 'taskRemove') {
    if (!safeKey(op.id)) fail('Invalid step.');
    const id = op.id;
    if (!e.removed.includes(id)) e.removed.push(id);
  } else if (op.type === 'taskRestore') {
    if (!safeKey(op.id)) fail('Invalid step.');
    e.removed = e.removed.filter(k => k !== op.id);
  } else if (op.type === 'taskOrder') {
    if (
      !isPhase(op.phase) ||
      !Array.isArray(op.ids) ||
      op.ids.length > 600 ||
      op.ids.some((k: unknown) => !safeKey(k)) ||
      new Set(op.ids).size !== op.ids.length
    )
      fail('Invalid step order.');
    if (op.ids.length) e.order[op.phase] = [...op.ids];
    else delete e.order[op.phase];
  } else fail('Unknown update.');
}
// Factory group edits. Removing a group also drops it from every row's assignment list.
function mutateGroups(s: SavedState, op: Raw) {
  const g = (s.factoryGroups = validateGroups(s.factoryGroups));
  if (op.type === 'factoryGroupAdd') {
    if (!groupId(op.id) || g.groups.some(x => x.id === op.id) || !label(op.name))
      fail('Invalid factory group.');
    if (g.groups.length >= 60) fail('You can keep up to 60 factory groups.');
    g.groups.push({ id: op.id, name: op.name.trim() });
  } else if (op.type === 'factoryGroupRename') {
    if (!g.groups.some(x => x.id === op.id)) fail('Unknown factory group.');
    if (!label(op.name)) fail('Invalid group name.');
    // The check above found it.
    g.groups.find(x => x.id === op.id)!.name = op.name.trim();
  } else if (op.type === 'factoryGroupRemove') {
    if (!g.groups.some(x => x.id === op.id)) fail('Unknown factory group.');
    g.groups = g.groups.filter(x => x.id !== op.id);
    for (const [k, list] of Object.entries(g.assignments)) {
      const kept = list.filter(m => m.group !== op.id);
      if (kept.length) g.assignments[k] = kept;
      else delete g.assignments[k];
    }
    // Its links go too; they joined a place that no longer exists.
    for (const k of Object.keys(g.links || {}))
      if (k.split(':').includes(op.id as string)) delete g.links![k];
    if (g.links && !Object.keys(g.links).length) delete g.links;
  } else if (op.type === 'factoryLinkTransport') {
    if (!linkKey(op.from, op.to, new Set(g.groups.map(x => x.id))))
      fail('Unknown factory group link.');
    const key = op.from + ':' + op.to;
    const links = { ...g.links };
    if (op.mode === 'belt') delete links[key];
    else
      links[key] = linkTransport({
        mode: op.mode,
        roundTripMin: op.roundTripMin,
        ...(op.fuel === undefined ? {} : { fuel: op.fuel }),
      });
    if (Object.keys(links).length > 500) fail('You can set up to 500 group links.');
    if (Object.keys(links).length) g.links = links;
    else delete g.links;
  } else if (op.type === 'factoryAssign') {
    if (!safeKey(op.key) || !Array.isArray(op.groups) || op.groups.length > 12)
      fail('Invalid factory group assignment.');
    const known = new Set(g.groups.map(x => x.id)),
      used = new Set<string>();
    const list = op.groups.map((m: unknown): GroupAssignment => {
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
        fail('Enter a production rate above 0.');
      return { group, rate };
    });
    if (list.length) g.assignments[op.key] = list;
    else delete g.assignments[op.key];
  } else fail('Unknown update.');
}
// Deletes everything recorded for bay `id`'s addresses: its name, container names and cleared
// positions, and its 'slot-<address>' notes and 'slot-<address>-<step>' checks.
function clearBayRecords(s: SavedState, e: StorageEdits, id: string) {
  delete e.bayNames[id];
  // A handbook bay's move goes too, so a bay taking its letter starts on its own floor.
  if (e.bayFloors?.[id]) {
    const { [id]: _gone, ...rest } = e.bayFloors;
    if (Object.keys(rest).length) e.bayFloors = rest;
    else delete e.bayFloors;
  }
  // And its place in a floor's order (#191).
  dropFromOrder(e, id);
  for (const k of Object.keys(e.slots)) if (slotAddr(k) && bayOfSlot(k) === id) delete e.slots[k];
  e.clearedSlots = e.clearedSlots.filter(k => bayOfSlot(k) !== id);
  for (const records of [s.checks, s.notes] as Record<string, unknown>[])
    for (const k of Object.keys(records || {})) {
      const address = /^slot-([A-Z]{1,2}[0-9]{2})(?:-|$)/.exec(k)?.[1];
      if (address && bayOfSlot(address) === id) delete records[k];
    }
}
// The floor bay `id` stands on: an added bay's own (also under a hidden handbook letter, #167),
// else a handbook bay's move (#190) or its handbook floor. null for a letter that is neither.
function bayFloor(e: StorageEdits, id: string): string | null {
  const added = e.bays.find(b => b.id === id);
  if (added) return added.floor;
  return handbookBay(id) ? (e.bayFloors?.[id] ?? handbookFloor(id)) : null;
}
// Takes bay `id` out of every floor's order (#191): it moved or went, so a letter reused later
// starts at its default place.
function dropFromOrder(e: StorageEdits, id: string) {
  if (!e.bayOrder) return;
  const order: Record<string, string[]> = {};
  for (const [f, list] of Object.entries(e.bayOrder)) {
    const kept = list.filter(x => x !== id);
    if (kept.length) order[f] = kept;
  }
  if (Object.keys(order).length) e.bayOrder = order;
  else delete e.bayOrder;
}
// Storage layout edits. Only added floors and bays can be removed; built-in floors can only be
// renamed, and handbook bays hidden and restored (storageBayHide/Restore, #166), which keeps
// every record of theirs. These edits change names and addresses only, with one exception: removing an added
// bay also deletes the 'slot-' checks and notes of its addresses (the owner's decision in #51),
// so a bay that later reuses the letter starts clean. A removed floor has no records of its own.
function mutateLayout(s: SavedState, op: Raw) {
  const e = (s.storageEdits = validateEdits(
    s.storageEdits === undefined ? undefined : s.storageEdits,
  ));
  if (op.type === 'storageFloorAdd') {
    if (!addedFloorId(op.id) || e.floors.some(f => f.id === op.id) || !label(op.label))
      fail('Invalid floor.');
    e.floors.push({ id: op.id as string, label: op.label.trim() });
  } else if (op.type === 'storageFloorRename') {
    if (
      !floorId(op.id) ||
      !(builtinFloors.some(([id]) => id === op.id) || e.floors.some(f => f.id === op.id))
    )
      fail('Unknown floor.');
    if (typeof op.label === 'string' && !op.label.trim()) delete e.floorNames[op.id];
    else {
      if (!label(op.label)) fail('Invalid floor name.');
      e.floorNames[op.id] = op.label.trim();
    }
  } else if (op.type === 'storageFloorHide' || op.type === 'storageFloorRestore') {
    // Built-in floors are hidden, never removed (#168); an added floor is removed instead.
    if (!builtinFloors.some(([id]) => id === op.id))
      fail('Only built-in floors can be hidden. Remove an added floor instead.');
    const id = op.id as string;
    if (op.type === 'storageFloorRestore') e.hiddenFloors = e.hiddenFloors.filter(f => f !== id);
    else {
      if (baysOn(e, id)) fail('Remove or move the bays on this floor first.');
      const hidden = new Set([...e.hiddenFloors, id]);
      if (hidden.size === builtinFloors.length && !e.floors.length)
        fail('Keep at least one floor in the storage room.');
      e.hiddenFloors = builtinFloors.map(([f]) => f).filter(f => hidden.has(f));
    }
  } else if (op.type === 'storageFloorRemove') {
    if (!e.floors.some(f => f.id === op.id)) fail('Only added floors can be removed.');
    if (baysOn(e, op.id as string)) fail('Remove or move the bays on this floor first.');
    if (e.hiddenFloors.length === builtinFloors.length && e.floors.length === 1)
      fail('Keep at least one floor in the storage room.');
    e.floors = e.floors.filter(f => f.id !== op.id);
    // The first check above matched an added floor, so the id is a string.
    delete e.floorNames[op.id as string];
    if (e.bayOrder?.[op.id as string]) {
      const { [op.id as string]: _gone, ...rest } = e.bayOrder;
      if (Object.keys(rest).length) e.bayOrder = rest;
      else delete e.bayOrder;
    }
  } else if (op.type === 'storageBayAdd') {
    if (!bayId(op.id) || !label(op.name) || !floorId(op.floor)) fail('Invalid bay.');
    if (e.bays.some(b => b.id === op.id))
      fail(`Bay ${op.id} already exists. Choose another letter.`);
    // Any free letter, the owner's choice on #167. A handbook letter is free only while that
    // bay is hidden, and taking it needs `replace`: the hidden bay's kept records are cleared
    // first (as removing an added bay does, #51), so the new bay starts clean.
    if (handbookBay(op.id)) {
      if (!e.hiddenBays.includes(op.id))
        fail(
          `Bay ${op.id} is in the room. Hide that handbook bay first, or choose another letter.`,
        );
      if (op.replace !== true)
        fail(`Bay ${op.id} still has saved progress from the handbook bay. Confirm to replace it.`);
    }
    if (!(builtinFloors.some(([id]) => id === op.floor) || e.floors.some(f => f.id === op.floor)))
      fail('Unknown floor.');
    if (handbookBay(op.id)) clearBayRecords(s, e, op.id);
    e.bays.push({ id: op.id, name: op.name.trim(), floor: op.floor });
  } else if (op.type === 'storageBayRename') {
    if (!bayId(op.id)) fail('Invalid bay.');
    if (typeof op.name === 'string' && !op.name.trim()) delete e.bayNames[op.id];
    else {
      if (!label(op.name)) fail('Invalid bay name.');
      e.bayNames[op.id] = op.name.trim();
    }
  } else if (op.type === 'storageBayMove') {
    // Any bay can move to another floor (#190), keeping its letter and so every address,
    // check, note and name. An added bay (also one holding a hidden handbook letter, #167)
    // changes its own floor; a handbook bay is recorded in bayFloors. Only to a floor in the
    // tabs: a hidden built-in floor is restored first.
    if (!bayId(op.id)) fail('Invalid bay.');
    if (!knownFloor(e, op.floor)) fail('Unknown floor.');
    if (e.hiddenFloors.includes(op.floor)) fail('Restore that floor before moving a bay onto it.');
    const added = e.bays.find(b => b.id === op.id);
    if (added) added.floor = op.floor;
    else if (handbookBay(op.id)) {
      const { [op.id]: _old, ...moved } = e.bayFloors || {};
      if (op.floor !== handbookFloor(op.id)) moved[op.id] = op.floor;
      if (Object.keys(moved).length) e.bayFloors = moved;
      else delete e.bayFloors;
    } else fail('Unknown bay.');
    // It joins the new floor at its default place and leaves the old floor's order.
    dropFromOrder(e, op.id);
  } else if (op.type === 'storageBayOrder') {
    // The order of the bays on one floor (#191), sent whole by Move left / Move right. Only bays
    // on that floor; one left out keeps its default place (views/storage.ts orderBays).
    if (!knownFloor(e, op.floor)) fail('Unknown floor.');
    const list = op.order;
    if (
      !Array.isArray(list) ||
      list.length > 60 ||
      list.some((id: unknown) => !bayId(id)) ||
      new Set(list).size !== list.length
    )
      fail('Invalid bay order.');
    if (list.some((id: string) => bayFloor(e, id) !== op.floor))
      fail('Only bays on this floor can be put in order.');
    const { [op.floor]: _old, ...rest } = e.bayOrder || {};
    if (list.length) rest[op.floor] = [...list];
    if (Object.keys(rest).length) e.bayOrder = rest;
    else delete e.bayOrder;
  } else if (op.type === 'storageBayHide' || op.type === 'storageBayRestore') {
    if (typeof op.id !== 'string' || !handbookBay(op.id))
      fail('Only handbook bays can be hidden. Remove an added bay instead.');
    const hidden = new Set(e.hiddenBays);
    // An added bay under a handbook letter still in the room predates #91 and shares that bay's
    // addresses and records. Hiding the handbook bay would make removing the added one clear
    // them (storageBayRemove treats a hidden letter's records as the added bay's own), so the
    // added bay has to go first. A letter an added bay took with `replace` is already hidden.
    if (op.type === 'storageBayHide' && !hidden.has(op.id) && e.bays.some(b => b.id === op.id))
      fail(`An added bay uses the letter ${op.id}. Remove it before hiding the handbook bay.`);
    if (op.type === 'storageBayHide') hidden.add(op.id);
    else if (e.bays.some(b => b.id === op.id))
      fail(`An added bay uses the letter ${op.id}. Remove it before restoring the handbook bay.`);
    else hidden.delete(op.id);
    e.hiddenBays = [...hidden].sort();
  } else if (op.type === 'storageBayRemove') {
    if (!e.bays.some(b => b.id === op.id))
      fail('Only added bays can be removed. Hide a handbook bay instead; its progress is kept.');
    e.bays = e.bays.filter(b => b.id !== op.id);
    // The check above matched an added bay, so the id is a string.
    const id = op.id as string;
    // An added bay under the letter of a handbook bay that is still in the room predates
    // storageBayAdd refusing one (only a direct request or an edited import could make it). Its
    // addresses, name, checks and notes are the handbook bay's too, so removing it removes the
    // entry and nothing else. Under a hidden handbook letter (#167) the records are its own.
    if (handbookBay(id) && !e.hiddenBays.includes(id)) return;
    clearBayRecords(s, e, id);
  } else if (op.type === 'storageSlotAssign') {
    if (!slotAddr(op.key) || !label(op.name, 120)) fail('Invalid container.');
    e.slots[op.key] = op.name.trim();
    e.clearedSlots = e.clearedSlots.filter(k => k !== op.key);
  } else if (op.type === 'storageSlotClear') {
    if (!slotAddr(op.key)) fail('Invalid container address.');
    delete e.slots[op.key];
    // An added position disappears with its container; a handbook one stays as a
    // reserved address so its printed label keeps meaning something.
    if (!addedSlot(op.key) && !e.clearedSlots.includes(op.key)) e.clearedSlots.push(op.key);
  } else fail('Unknown update.');
}

// Default factory groups for newly calculated profiles: production areas keyed by each row's primary output.
const GROUP_NAMES: [id: string, name: string][] = [
  ['fg-iron01', 'Iron & steel works'],
  ['fg-coppr1', 'Copper & caterium'],
  ['fg-stone1', 'Concrete & quartz'],
  ['fg-oilcp1', 'Oil & fuel campus'],
  ['fg-alumn1', 'Aluminum campus'],
  ['fg-elect1', 'Electronics'],
  ['fg-parts1', 'Industrial parts'],
  ['fg-projct', 'Project assembly'],
  ['fg-nuclr1', 'Nuclear site'],
  ['fg-quant1', 'Quantum & SAM'],
  ['fg-convr1', 'Resource conversion'],
  ['fg-power1', 'Power generation'],
  ['fg-pack01', 'Packaging'],
  ['fg-ammo01', 'Ammunition & equipment'],
  ['fg-other1', 'Everything else'],
];
const GROUP_BY_ITEM: Record<string, string> = {
  'Iron Ingot': 'fg-iron01',
  'Iron Plate': 'fg-iron01',
  'Iron Rod': 'fg-iron01',
  Screws: 'fg-iron01',
  'Reinforced Iron Plate': 'fg-iron01',
  'Modular Frame': 'fg-iron01',
  'Steel Ingot': 'fg-iron01',
  'Steel Beam': 'fg-iron01',
  'Steel Pipe': 'fg-iron01',
  'Encased Industrial Beam': 'fg-iron01',
  'Heavy Modular Frame': 'fg-iron01',
  'Copper Ingot': 'fg-coppr1',
  'Copper Sheet': 'fg-coppr1',
  Wire: 'fg-coppr1',
  Cable: 'fg-coppr1',
  Quickwire: 'fg-coppr1',
  'Caterium Ingot': 'fg-coppr1',
  'Copper Powder': 'fg-coppr1',
  Concrete: 'fg-stone1',
  Silica: 'fg-stone1',
  'Quartz Crystal': 'fg-stone1',
  'Dissolved Silica': 'fg-stone1',
  Plastic: 'fg-oilcp1',
  Rubber: 'fg-oilcp1',
  'Heavy Oil Residue': 'fg-oilcp1',
  'Polymer Resin': 'fg-oilcp1',
  Fuel: 'fg-oilcp1',
  Turbofuel: 'fg-oilcp1',
  'Petroleum Coke': 'fg-oilcp1',
  'Rocket Fuel': 'fg-oilcp1',
  'Ionized Fuel': 'fg-oilcp1',
  'Compacted Coal': 'fg-oilcp1',
  'Liquid Biofuel': 'fg-oilcp1',
  'Alumina Solution': 'fg-alumn1',
  'Aluminum Scrap': 'fg-alumn1',
  'Aluminum Ingot': 'fg-alumn1',
  'Aluminum Casing': 'fg-alumn1',
  'Alclad Aluminum Sheet': 'fg-alumn1',
  'Circuit Board': 'fg-elect1',
  Computer: 'fg-elect1',
  Supercomputer: 'fg-elect1',
  'High-Speed Connector': 'fg-elect1',
  'Crystal Oscillator': 'fg-elect1',
  'AI Limiter': 'fg-elect1',
  'Radio Control Unit': 'fg-elect1',
  Rotor: 'fg-parts1',
  Stator: 'fg-parts1',
  Motor: 'fg-parts1',
  'Heat Sink': 'fg-parts1',
  'Cooling System': 'fg-parts1',
  Battery: 'fg-parts1',
  'Electromagnetic Control Rod': 'fg-parts1',
  'Fused Modular Frame': 'fg-parts1',
  'Pressure Conversion Cube': 'fg-parts1',
  'Turbo Motor': 'fg-parts1',
  'Smart Plating': 'fg-projct',
  'Versatile Framework': 'fg-projct',
  'Automated Wiring': 'fg-projct',
  'Modular Engine': 'fg-projct',
  'Adaptive Control Unit': 'fg-projct',
  'Assembly Director System': 'fg-projct',
  'Magnetic Field Generator': 'fg-projct',
  'Thermal Propulsion Rocket': 'fg-projct',
  'Nuclear Pasta': 'fg-projct',
  'Biochemical Sculptor': 'fg-projct',
  'AI Expansion Server': 'fg-projct',
  'Ballistic Warp Drive': 'fg-projct',
  'Sulfuric Acid': 'fg-nuclr1',
  'Nitric Acid': 'fg-nuclr1',
  'Encased Uranium Cell': 'fg-nuclr1',
  'Uranium Fuel Rod': 'fg-nuclr1',
  'Non-Fissile Uranium': 'fg-nuclr1',
  'Plutonium Pellet': 'fg-nuclr1',
  'Encased Plutonium Cell': 'fg-nuclr1',
  'Plutonium Fuel Rod': 'fg-nuclr1',
  Ficsonium: 'fg-nuclr1',
  'Ficsonium Fuel Rod': 'fg-nuclr1',
  'Uranium Waste': 'fg-nuclr1',
  'Plutonium Waste': 'fg-nuclr1',
  'Reanimated SAM': 'fg-quant1',
  'SAM Fluctuator': 'fg-quant1',
  'Dark Matter Residue': 'fg-quant1',
  'Excited Photonic Matter': 'fg-quant1',
  'Time Crystal': 'fg-quant1',
  'Dark Matter Crystal': 'fg-quant1',
  Diamonds: 'fg-quant1',
  'Ficsite Ingot': 'fg-quant1',
  'Ficsite Trigon': 'fg-quant1',
  'Singularity Cell': 'fg-quant1',
  'Superposition Oscillator': 'fg-quant1',
  'Neural-Quantum Processor': 'fg-quant1',
  'Power Shard': 'fg-quant1',
  'Alien Power Matrix': 'fg-quant1',
  'Caterium Ore': 'fg-convr1',
  Bauxite: 'fg-convr1',
  Coal: 'fg-convr1',
  'Copper Ore': 'fg-convr1',
  'Nitrogen Gas': 'fg-convr1',
  'Iron Ore': 'fg-convr1',
  'Raw Quartz': 'fg-convr1',
  Sulfur: 'fg-convr1',
  Limestone: 'fg-convr1',
  Uranium: 'fg-convr1',
  'Crude Oil': 'fg-convr1',
  Biomass: 'fg-power1',
  'Solid Biofuel': 'fg-power1',
  'Empty Canister': 'fg-pack01',
  'Empty Fluid Tank': 'fg-pack01',
  'Packaged Fuel': 'fg-pack01',
  'Black Powder': 'fg-ammo01',
  'Smokeless Powder': 'fg-ammo01',
  'Iron Rebar': 'fg-ammo01',
  'Stun Rebar': 'fg-ammo01',
  'Shatter Rebar': 'fg-ammo01',
  'Explosive Rebar': 'fg-ammo01',
  Nobelisk: 'fg-ammo01',
  'Pulse Nobelisk': 'fg-ammo01',
  'Cluster Nobelisk': 'fg-ammo01',
  'Nuke Nobelisk': 'fg-ammo01',
  'Rifle Ammo': 'fg-ammo01',
  'Homing Rifle Ammo': 'fg-ammo01',
  'Turbo Rifle Ammo': 'fg-ammo01',
  'Gas Filter': 'fg-ammo01',
  'Iodine-Infused Filter': 'fg-ammo01',
  Fabric: 'fg-ammo01',
  'Portable Miner': 'fg-ammo01',
};
// Assigns every row of every phase to a default group by its first output ('power-' rows
// to nuclear or power generation by their id), and lists only the groups actually used.
// Called by newProfileState for calculated profiles. Group ids are stored in saves, so the
// fg-… ids above must stay stable even if their names change.
export function defaultFactoryGroups(plan: RowsPlan | null | undefined): FactoryGroups {
  const assignments: Record<string, GroupAssignment[]> = {};
  for (const stage of Object.values(plan?.stages || {}))
    for (const r of stage.rows || []) {
      if (assignments[r.id]) continue;
      let group;
      if (String(r.id).startsWith('power-'))
        group = /uranium|plutonium|ficsonium/.test(r.id) ? 'fg-nuclr1' : 'fg-power1';
      else {
        const out = Object.keys(r.outputs || {})[0];
        group = out
          ? out.startsWith('Packaged')
            ? 'fg-pack01'
            : GROUP_BY_ITEM[out] || 'fg-other1'
          : 'fg-power1';
      }
      assignments[r.id] = [{ group, rate: null }];
    }
  // Every list above has exactly one entry.
  const used = new Set(Object.values(assignments).map(a => a[0]!.group));
  return {
    groups: GROUP_NAMES.filter(([gid]) => used.has(gid)).map(([gid, label]) => ({
      id: gid,
      name: label,
    })),
    assignments,
  };
}
