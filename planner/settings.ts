// Validation of a profile's settings: settings() and the checks of each field. A rejected
// setting throws with status 400 (fail).
// Re-exported by ../planner.ts.
import {
  droneFuels,
  vehicleFuels,
  storageOptions,
  beltCapMark,
  DRIVE_CAP_MAX,
  driveCapOf,
  distributions,
  purities,
  ownedGeneratorCounts,
  OBJECTIVE_WEIGHT_MAX,
  OBJECTIVE_WEIGHTS,
  PHASE_CAP_KEYS,
  PHASE_CAP_LIMITS,
  powerOptions,
  RECIPE_COSTS,
  resourceDefaults,
  turbofuelRecipes,
} from '../public/preferences.ts';
import type {
  CurrentSettings,
  Distribution,
  DroneFuel,
  BuiltLines,
  ExactClocks,
  ExtractionRecord,
  ItemRates,
  LineClocks,
  MainPower,
  NodeCounts,
  Purity,
  SloopPins,
  SloopUse,
  OnSiteGroup,
  OnSiteRate,
  OnSiteSettings,
  StageKey,
  StorageChoice,
} from '../public/types/index.ts';
import { DATA, powerNeedsTurbofuel, ALT_IDS, RAW } from './data.ts';
import {
  amplifySlots,
  SLOOP_PIN_MAX,
  sloopCommitment,
  sloopRefusal,
} from '../public/somersloops.ts';

// An untrusted object: a record whose fields are not checked yet.
type Raw = Record<string, unknown>;
const isRecord = (value: unknown): value is Raw =>
  !!value && typeof value === 'object' && !Array.isArray(value);
// Settings validation helpers. A rejected setting throws with status 400; server.ts sends a
// thrown error that carries a status back with its message, so the user sees this text.
// A function declaration, so TypeScript knows the code after a failed check is unreachable.
export function fail(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}
// An absent value takes the fallback; a present but invalid one is rejected, never corrected.
const choice = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  value === undefined
    ? fallback
    : allowed.includes(value as T)
      ? (value as T)
      : fail('Invalid profile option.');
const number = (value: unknown, min: number, max: number, fallback: number): number =>
  value === undefined
    ? fallback
    : Number.isFinite(value) && (value as number) >= min && (value as number) <= max
      ? (value as number)
      : fail(`Enter a number from ${min} to ${max}.`);
// Per-item storage rates. Only storable item names are accepted so a stale or
// mistyped entry cannot silently reserve production for nothing.
export const storable = (name: string) =>
  !RAW.includes(name) &&
  !DATA.items[name]?.fluid &&
  !DATA.items[name]?.radioactive &&
  (DATA.items[name]?.sink || 0) > 0;
// Production you already run, entered as a rate. Matching an existing factory
// against the plan's own rows does not work: your Modular Frame line is whatever
// recipe and machine count you happened to build, not the one this solve picks.
// A rate is the thing you can actually read off your own factory.
//
// Its ore and its power are already spent in your world, so — exactly as for
// spare existing power — the resource budgets and the spare-power figure are
// entered net of it. Zero is dropped so an untouched profile stays untouched.
// Fuel for the vehicles on factory-group links (#206), per phase: { phase: { fuel: rate/min } },
// worked out by the Factories page from the links' vehicles (#205) and frozen with a new profile
// revision. Only vehicle fuels (preferences.ts) count; zero rates and empty phases are dropped.
const transportFuelRates = (raw: unknown): Partial<Record<StageKey, ItemRates>> => {
  if (raw === undefined) return {};
  if (!isRecord(raw)) fail('Invalid transport fuel.');
  const out: Partial<Record<StageKey, ItemRates>> = {};
  for (const [phase, rates] of Object.entries(raw)) {
    if (!['1', '2', '3', '4', '5'].includes(phase) || !isRecord(rates))
      fail('Invalid transport fuel.');
    const clean: ItemRates = {};
    for (const [name, rate] of Object.entries(rates)) {
      if (!vehicleFuels.includes(name)) fail(`${name} is not a vehicle fuel.`);
      const perMinute = number(rate, 0, 100000, 0);
      if (perMinute > 0) clean[name] = perMinute;
    }
    if (Object.keys(clean).length) out[phase as StageKey] = clean;
  }
  return out;
};
// The items factory groups make on site (#875): { groupId: { name?, items, shares: { phase:
// { rowId: share } }, rates?, ifBuilt? } }, worked out from factoryGroups.local and the
// memberships when the user starts a recalculation (onSiteSettings in public/app/on-site.ts) and
// frozen with the plan.
// Group ids are factory-group ids, items known items that are not raw resources, row ids check
// key parts and shares fractions of a row from 0 to 1; rates (#984) and ifBuilt (#1038) are
// checked by onSiteRates.
// Zero shares, phases without a share and groups without an item, or without both a share and an
// ifBuilt part, are dropped, and undefined is returned when nothing is left, so settings without it
// stay as they were. A group with ifBuilt alone holds a consumer the plan being recalculated
// lacked only at a fixed rate (#1013, onSiteWanted): it has no share, and the planner sizes its
// line by the part only where its solve builds that row (withinRates in planner/on-site.ts).
const GROUP_ID = /^fg-[a-z0-9]{4,32}$/;
const ROW_ID = /^[a-zA-Z0-9:_-]{1,160}$/;
const onSiteGroups = (raw: unknown): OnSiteSettings | undefined => {
  if (raw === undefined) return undefined;
  if (!isRecord(raw) || Object.keys(raw).length > 60) fail('Invalid items made on site.');
  const out: OnSiteSettings = {};
  for (const [group, entry] of Object.entries(raw)) {
    if (!GROUP_ID.test(group) || !isRecord(entry) || !Array.isArray(entry.items))
      fail('Invalid items made on site.');
    if (entry.name !== undefined && (typeof entry.name !== 'string' || entry.name.length > 80))
      fail('Invalid items made on site.');
    const items = [...new Set(entry.items as unknown[])];
    if (items.length > 200 || items.some(item => typeof item !== 'string' || !suppliable(item)))
      fail('Invalid items made on site.');
    const shares = onSiteShares(entry.shares);
    const rates = onSiteRates(entry.rates);
    const ifBuilt = withoutRates(onSiteRates(entry.ifBuilt), rates);
    if (!items.length || !(Object.keys(shares).length || Object.keys(ifBuilt).length)) continue;
    out[group] = {
      ...(typeof entry.name === 'string' && entry.name.trim() ? { name: entry.name.trim() } : {}),
      items: (items as string[]).sort(),
      shares,
      ...(Object.keys(rates).length ? { rates } : {}),
      ...(Object.keys(ifBuilt).length ? { ifBuilt } : {}),
    };
  }
  return Object.keys(out).length ? out : undefined;
};
// { onSite } when there is any, else nothing, so the field is absent from settings without it.
const onSiteSetting = (raw: unknown): { onSite?: OnSiteSettings } => {
  const onSite = onSiteGroups(raw);
  return onSite ? { onSite } : {};
};
const onSiteShares = (raw: unknown): OnSiteGroup['shares'] => {
  if (raw === undefined) return {};
  if (!isRecord(raw)) fail('Invalid items made on site.');
  const out: OnSiteGroup['shares'] = {};
  for (const [phase, rows] of Object.entries(raw)) {
    if (!['1', '2', '3', '4', '5'].includes(phase) || !isRecord(rows))
      fail('Invalid items made on site.');
    if (Object.keys(rows).length > 1000) fail('Invalid items made on site.');
    const clean: Record<string, number> = {};
    for (const [rowId, share] of Object.entries(rows)) {
      if (!ROW_ID.test(rowId)) fail('Invalid items made on site.');
      const part = number(share, 0, 1, 0);
      if (part > 0) clean[rowId] = part;
    }
    if (Object.keys(clean).length) out[phase as StageKey] = clean;
  }
  return out;
};
// A group's parts of the rows with a fixed-rate membership (#984), beside its shares: { phase:
// { rowId: { rate, open, after } } } (OnSiteRate). `rate` is per minute up to a membership's
// largest rate, `after` per minute up to twelve of them (the most memberships a row has), and
// `open` a fraction from 0 to 1; an absent number is 0, and a part may not have both a `rate` and
// an `open` above 0; a part with neither is dropped. A row may have a part without a share: its
// fixed rates took all of its total in the plan being recalculated. Absent in plans made before
// #984, which keep sizing every line by its shares.
const onSiteRates = (raw: unknown): OnSiteRates => {
  if (raw === undefined) return {};
  if (!isRecord(raw)) fail('Invalid items made on site.');
  const out: OnSiteRates = {};
  for (const [phase, rows] of Object.entries(raw)) {
    if (!['1', '2', '3', '4', '5'].includes(phase) || !isRecord(rows))
      fail('Invalid items made on site.');
    if (Object.keys(rows).length > 1000) fail('Invalid items made on site.');
    const kept: [string, OnSiteRate][] = [];
    for (const [rowId, part] of Object.entries(rows)) {
      if (!ROW_ID.test(rowId) || !isRecord(part)) fail('Invalid items made on site.');
      const rate = sitePart(part.rate, 10000000),
        open = sitePart(part.open, 1),
        after = sitePart(part.after, 120000000);
      if (rate > 0 && open > 0) fail('Invalid items made on site.');
      if (rate > 0 || open > 0) kept.push([rowId, { rate, open, after }]);
    }
    if (kept.length) out[phase as StageKey] = Object.fromEntries(kept);
  }
  return out;
};
type OnSiteRates = NonNullable<OnSiteGroup['rates']>;
// A group's parts of the rows the plan being recalculated lacked in a phase (ifBuilt, #1038),
// checked as onSiteRates checks `rates`, less any row that also has a part in `rates` in that
// phase (the plan had the row there, so that part is the one that counts). Absent in plans made
// before #1038, which keep planning exactly as before.
const withoutRates = (ifBuilt: OnSiteRates, rates: OnSiteRates): OnSiteRates => {
  const out: OnSiteRates = {};
  for (const [phase, rows] of Object.entries(ifBuilt) as [StageKey, Record<string, OnSiteRate>][]) {
    const kept = Object.entries(rows).filter(
      ([rowId]) => !Object.hasOwn(rates[phase] || {}, rowId),
    );
    if (kept.length) out[phase] = Object.fromEntries(kept);
  }
  return out;
};
// A number of an OnSiteRate: absent is 0, anything but a number from 0 to `max` is refused.
const sitePart = (value: unknown, max: number): number =>
  value === undefined
    ? 0
    : typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max
      ? value
      : fail('Invalid items made on site.');
// The production lines a whole-machine plan runs at exact clocks (#1066): { phase: [row id] }, from
// the progress state's exactClocks when the user starts a recalculation (exactClocksSettings in
// public/app/exact-clocks.ts) and frozen with the plan. Row ids are check key parts; an amplified
// twin ('amp:') is always whole machines and is refused. Duplicates go, ids are sorted, and empty
// phases are dropped; with nothing left the field is absent, so settings without it stay as they
// were. An id the phase does not plan is kept and changes nothing.
const exactClockLines = (raw: unknown): { exactClocks?: ExactClocks } => {
  if (raw === undefined) return {};
  if (!isRecord(raw)) fail('Invalid exact clocks.');
  const out: ExactClocks = {};
  for (const [phase, ids] of Object.entries(raw)) {
    if (!['1', '2', '3', '4', '5'].includes(phase) || !Array.isArray(ids) || ids.length > 1000)
      fail('Invalid exact clocks.');
    if (ids.some(id => typeof id !== 'string' || !ROW_ID.test(id) || id.startsWith('amp:')))
      fail('Invalid exact clocks.');
    const clean = [...new Set(ids as string[])].sort();
    if (clean.length) out[phase as StageKey] = clean;
  }
  return Object.keys(out).length ? { exactClocks: out } : {};
};
// The somersloops pinned on production lines (#1235): `{ sloopPins: { phase: { recipe: sloops } } }`
// from the progress state's sloopPins when the user starts a recalculation (sloopPinsSettings in
// public/app/sloop-pins.ts) and frozen with the plan. A recipe is one the game data has whose
// machine production amplification can amplify (amplifySlots), and a count a whole number from 0
// to 106 that fills whole machines (a multiple of the machine's slots); anything else is refused,
// never corrected. Whether a phase can keep a pin is the solve's question (checkPins in
// planner/pins.ts), never a refusal here. Keys are sorted, empty phases dropped, and with nothing
// left the field is absent, so settings without it stay as they were.
const PIN_REFUSAL = 'Invalid somersloop pins.';
const sloopPinsSetting = (raw: unknown): { sloopPins?: SloopPins } => {
  if (raw === undefined) return {};
  if (!isRecord(raw)) fail(PIN_REFUSAL);
  const out: SloopPins = {};
  for (const phase of Object.keys(raw).sort()) {
    const lines = raw[phase];
    if (!['1', '2', '3', '4', '5'].includes(phase) || !isRecord(lines)) fail(PIN_REFUSAL);
    const ids = Object.keys(lines).sort();
    if (ids.length > 1000) fail(PIN_REFUSAL);
    const clean: Record<string, number> = {};
    for (const id of ids) {
      const recipe = DATA.recipes.find(entry => entry.id === id);
      const sloops = lines[id];
      if (!recipe || !amplifySlots(recipe) || !Number.isInteger(sloops)) fail(PIN_REFUSAL);
      const slots = amplifySlots(recipe),
        count = sloops as number;
      if (count < 0 || count > SLOOP_PIN_MAX) fail(PIN_REFUSAL);
      if (count % slots)
        fail(
          `A somersloop pin fills whole machines: ${recipe.name} takes ${slots} per ${recipe.machine}, so pin a multiple of ${slots}.`,
        );
      clean[id] = count;
    }
    if (ids.length) out[phase as StageKey] = clean;
  }
  return Object.keys(out).length ? { sloopPins: out } : {};
};
// Overclocked production lines (#1239, slice 1 of 2): `{ lineClocks: { phase: { recipe: clock } } }`,
// an explicit solver input (nothing in the interface sets it yet) frozen with the plan. A recipe is
// one the game data has, and a clock a number in % above 100 and at most 250 (three Power Shards),
// to four decimals as the game takes it; anything else is refused, never corrected. Whether a
// phase can keep a clock is the solve's question (checkClocks in planner/clocks.ts). Keys are
// sorted, empty phases dropped, and with nothing left the field is absent, so settings without it
// stay as they were. `lineShardBudget`, the Power Shards each phase's clocked lines may hold, is a
// whole number from 0 to LINE_SHARD_MAX, absent unless given.
const CLOCK_REFUSAL = 'Invalid line clocks.';
const LINE_CLOCK_MAX = 250;
const LINE_SHARD_MAX = 100000;
const lineClocksSetting = (raw: unknown): { lineClocks?: LineClocks } => {
  if (raw === undefined) return {};
  if (!isRecord(raw)) fail(CLOCK_REFUSAL);
  const out: LineClocks = {};
  for (const phase of Object.keys(raw).sort()) {
    const lines = raw[phase];
    if (!['1', '2', '3', '4', '5'].includes(phase) || !isRecord(lines)) fail(CLOCK_REFUSAL);
    const ids = Object.keys(lines).sort();
    if (ids.length > 1000) fail(CLOCK_REFUSAL);
    const clean: Record<string, number> = {};
    for (const id of ids) {
      const clock = lines[id];
      if (
        !DATA.recipes.some(recipe => recipe.id === id) ||
        typeof clock !== 'number' ||
        !Number.isFinite(clock) ||
        clock <= 100 ||
        clock > LINE_CLOCK_MAX ||
        Math.abs(clock * 1e4 - Math.round(clock * 1e4)) > 1e-6
      )
        fail(CLOCK_REFUSAL);
      clean[id] = clock;
    }
    if (ids.length) out[phase as StageKey] = clean;
  }
  return Object.keys(out).length ? { lineClocks: out } : {};
};
const lineShardBudgetSetting = (raw: unknown): { lineShardBudget?: number } => {
  if (raw === undefined) return {};
  if (!Number.isInteger(raw) || (raw as number) < 0 || (raw as number) > LINE_SHARD_MAX)
    fail('Invalid Power Shard budget.');
  return { lineShardBudget: raw as number };
};
// The production lines that already stand (#1176): `{ builtLines: { phase: { rowId: machines } } }`
// with row ids as a plan names them and whole counts from 1 to 100,000 (the limits of the
// progress state's `builtMachines`), at most 1000 per phase; nothing when none stand, so settings
// without them, and every plan stored before them, calculate exactly as before. Anything else is
// refused, never corrected. Keys are sorted, so equal lines always give equal settings.
const BUILT_REFUSAL = 'Invalid built production lines.';
const builtLinesSetting = (raw: unknown): { builtLines?: BuiltLines } => {
  if (raw === undefined) return {};
  if (!isRecord(raw)) fail(BUILT_REFUSAL);
  const out: BuiltLines = {};
  for (const phase of Object.keys(raw).sort()) {
    const lines = raw[phase];
    if (!['1', '2', '3', '4', '5'].includes(phase) || !isRecord(lines)) fail(BUILT_REFUSAL);
    const ids = Object.keys(lines).sort();
    if (ids.length > 1000) fail(BUILT_REFUSAL);
    const clean: Record<string, number> = {};
    for (const id of ids) {
      const count = lines[id];
      if (
        !ROW_ID.test(id) ||
        !Number.isInteger(count) ||
        (count as number) < 1 ||
        (count as number) > 100000
      )
        fail(BUILT_REFUSAL);
      clean[id] = count as number;
    }
    if (ids.length) out[phase as StageKey] = clean;
  }
  return Object.keys(out).length ? { builtLines: out } : {};
};
// A known item that is not a raw resource: what existing supply and settings.onSite may name. The
// interface applies the same rule to the marks it sends (onSitePlannable in
// public/app/on-site.ts, #921); a test checks the two agree.
const suppliable = (name: string) => !RAW.includes(name) && !!DATA.items[name];
const supplyRates = (raw: unknown): ItemRates => {
  if (raw === undefined) return {};
  if (!isRecord(raw)) fail('Invalid existing production rates.');
  const entries = Object.entries(raw);
  if (entries.length > 200) fail('Too many existing production rates.');
  const out: ItemRates = {};
  for (const [name, rate] of entries) {
    if (!suppliable(name)) fail(`${name} cannot be entered as existing production.`);
    const perMinute = number(rate, 0, 1000000, 0);
    if (perMinute > 0) out[name] = perMinute;
  }
  return out;
};
// { resource: { impure, normal, pure } } node or well-satellite counts from the extraction survey.
const countsByResource = (raw: unknown): Record<string, NodeCounts> => {
  const out: Record<string, NodeCounts> = {};
  if (raw === undefined) return out;
  if (!isRecord(raw)) fail('Invalid node counts.');
  if (Object.keys(raw).length > 40) fail('Invalid node counts.');
  for (const [name, counts] of Object.entries(raw)) {
    if (!RAW.includes(name)) fail(`${name} is not a raw resource.`);
    if (!isRecord(counts)) fail('Invalid node counts.');
    const row: NodeCounts = {
      impure: number(counts.impure, 0, 10000, 0),
      normal: number(counts.normal, 0, 10000, 0),
      pure: number(counts.pure, 0, 10000, 0),
    };
    if (row.impure || row.normal || row.pure) out[name] = row;
  }
  return out;
};
// The nodes or well satellites a survey leaves out of the plan (#1183): per resource, whole counts
// from 0 up to the survey's own count of that resource and purity (`counted`), rows of none
// dropped. Anything else is refused, never corrected: a count it does not hold, a part of a node,
// more than the survey counts.
const LEFT_OUT_REFUSAL =
  'Leave out whole numbers of nodes, from 0 up to the ones your survey counts.';
const leftOutCounts = (
  raw: unknown,
  counted: Record<string, NodeCounts>,
  what: string,
): Record<string, NodeCounts> => {
  const out: Record<string, NodeCounts> = {};
  if (raw === undefined) return out;
  if (!isRecord(raw) || Object.keys(raw).length > 40) fail(LEFT_OUT_REFUSAL);
  for (const [name, counts] of Object.entries(raw)) {
    if (!RAW.includes(name)) fail(`${name} is not a raw resource.`);
    if (!isRecord(counts)) fail(LEFT_OUT_REFUSAL);
    const row = blankNodeCounts();
    for (const purity of ['impure', 'normal', 'pure'] as const) {
      const count = counts[purity] === undefined ? 0 : counts[purity];
      if (!Number.isInteger(count) || (count as number) < 0) fail(LEFT_OUT_REFUSAL);
      const most = counted[name]?.[purity] ?? 0;
      if ((count as number) > most)
        fail(
          `Your survey counts ${most} ${purity} ${name} ${what}, so it cannot leave out ${count as number}.`,
        );
      row[purity] = count as number;
    }
    if (row.impure || row.normal || row.pure) out[name] = row;
  }
  return out;
};
const blankNodeCounts = (): NodeCounts => ({ impure: 0, normal: 0, pure: 0 });
// How the resource budgets were arrived at: the nodes the world holds, the
// miner they will be worked with, and whatever is already spoken for. Recorded
// so the survey can be reopened; the plan itself still runs on `limits`, held to the nodes it
// does not leave out of the plan (#1183, budgetLimit in public/preferences/mining.ts), which are
// kept only when it leaves some out, so a survey without them is the record it always was.
const extractionRecord = (raw: unknown): ExtractionRecord | null => {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) fail('Invalid extraction survey.');
  const used: ItemRates = {};
  if (raw.used !== undefined) {
    if (!isRecord(raw.used)) fail('Invalid committed extraction.');
    for (const [name, rate] of Object.entries(raw.used)) {
      if (!RAW.includes(name)) fail(`${name} is not a raw resource.`);
      const perMinute = number(rate, 0, 10000000, 0);
      if (perMinute > 0) used[name] = perMinute;
    }
  }
  const nodes = countsByResource(raw.nodes),
    wells = countsByResource(raw.wells);
  const excludedNodes = leftOutCounts(raw.excludedNodes, nodes, 'nodes'),
    excludedWells = leftOutCounts(raw.excludedWells, wells, 'well satellites');
  return {
    mark:
      raw.mark === undefined
        ? 3
        : [1, 2, 3].includes(raw.mark as number)
          ? (raw.mark as 1 | 2 | 3)
          : fail('Invalid miner mark.'),
    clock: number(raw.clock, 0.01, 2.5, 2.5),
    nodes,
    wells,
    used,
    ...(Object.keys(excludedNodes).length ? { excludedNodes } : {}),
    ...(Object.keys(excludedWells).length ? { excludedWells } : {}),
  };
};
// Per-item protected storage rates, items/min, 0 to 300. Resolved by storageRateFor.
const rateOverrides = (raw: unknown): ItemRates => {
  if (raw === undefined) return {};
  if (!isRecord(raw)) fail('Invalid per-item storage rates.');
  const entries = Object.entries(raw);
  if (entries.length > 200) fail('Too many per-item storage rates.');
  const out: ItemRates = {};
  for (const [name, rate] of entries) {
    if (!storable(name)) fail(`${name} cannot be given a storage rate.`);
    out[name] = number(rate, 0, 300, 0);
  }
  return out;
};
// Somersloops parked in hand-fed constructors: slugs to shards, remains to protein and DNA,
// biomass to solid biofuel. Their inputs are gathered, never belted, so these reserve a
// somersloop and add checklist steps without entering the continuous production balance.
// [id, label] pairs; the ids are what profiles store in `settings.sloopReserved`, so keep them.
// Shipped as `catalog().sloopUses`. calculate() counts one somersloop per reserved use.
export const SLOOP_USES: [id: SloopUse, label: string][] = [
  ['shards', 'Power Shards from power slugs'],
  ['dna', 'Alien Protein and DNA Capsules from remains'],
  ['biofuel', 'Solid Biofuel from biomass'],
];
const reservedUses = (raw: unknown): SloopUse[] => {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) fail('Invalid somersloop reservations.');
  return [
    ...new Set(raw.filter((use): use is SloopUse => SLOOP_USES.some(([id]) => id === use))),
  ].sort();
};
// The best miner the player already has (#1068): `{ ownedMiner: 2 | 3 }`, or nothing for any other
// value, so the field is absent unless chosen.
const ownedMinerSetting = (value: unknown): { ownedMiner?: 2 | 3 } =>
  value === 2 || value === 3 ? { ownedMiner: value } : {};
// The best conveyor belt the player already has (#1068): `{ ownedBelt: 3 | 4 | 5 | 6 }` for Mk.3 to
// Mk.6, or nothing for any other value (Phase 1 already has Mk.2 belts), so the field is absent
// unless chosen.
const ownedBeltSetting = (value: unknown): { ownedBelt?: 3 | 4 | 5 | 6 } =>
  value === 3 || value === 4 || value === 5 || value === 6 ? { ownedBelt: value } : {};
// The best belt the plan may assume (#1232): `{ beltCap: 2 | 3 | 4 | 5 }` for Mk.2 to Mk.5,
// nothing when absent or null, so a plan without a cap, and every plan stored before it, has no
// field and calculates exactly as before. Any other value is refused, never corrected, as the
// caps per phase are (Mk.6 is the best belt: a cap there would cap nothing).
const BELT_CAP_REFUSAL = 'Choose the best belt the plan may use: Mk.2 to Mk.5, or no cap.';
const beltCapSetting = (value: unknown): Pick<CurrentSettings, 'beltCap'> => {
  if (value === undefined || value === null) return {};
  if (!beltCapMark(value)) fail(BELT_CAP_REFUSAL);
  return { beltCap: value as 2 | 3 | 4 | 5 };
};
// The cap on hard drives (#1233): `{ driveCap }`, a whole number from 0 to DRIVE_CAP_MAX, nothing
// when absent or null, so a plan without a cap, and every plan stored before it, has no field and
// calculates exactly as before. Any other value is refused, never corrected, as the other caps are.
// A top-level setting like beltCap, not part of phaseCaps, which a release with #1221 refuses
// unknown keys in: an older release drops it and plans without the cap.
const DRIVE_CAP_REFUSAL = `Give the cap on hard drives as a whole number from 0 to ${DRIVE_CAP_MAX}, or leave it blank for no cap.`;
const driveCapSetting = (value: unknown): Pick<CurrentSettings, 'driveCap'> => {
  if (value === undefined || value === null) return {};
  const cap = driveCapOf(value);
  return cap === undefined ? fail(DRIVE_CAP_REFUSAL) : { driveCap: cap };
};
// The alternate recipes the player already owns (#1068): known alternate ids, deduplicated and
// sorted, so equal choices give equal settings; the field is absent unless one is left.
const ownedAlternatesSetting = (value: unknown): { ownedAlternates?: string[] } => {
  if (!Array.isArray(value)) return {};
  const ids = [...new Set(value.filter((id): id is string => ALT_IDS.has(id)))].sort();
  return ids.length ? { ownedAlternates: ids } : {};
};
// The game mode's recipe part cost multiplier (#1161): `{ recipeCost }` for one of the game's steps
// (RECIPE_COSTS) other than 1, nothing for 1 or absent, so a 1× plan, and every plan stored before
// it, has no field and calculates exactly as before; any other value is refused, never corrected.
const recipeCostSetting = (value: unknown): { recipeCost?: number } => {
  if (value === undefined || value === 1) return {};
  if (typeof value !== 'number' || !RECIPE_COSTS.includes(value))
    fail('Choose a recipe part cost from 0.25× to 2×.');
  return { recipeCost: value };
};
// What the plan keeps lowest (#1180): `{ objective }` for 'power', 'raw' or a weighted mix of
// whole weights from 0 to OBJECTIVE_WEIGHT_MAX for buildings, power and raw resources, at least one
// above 0 (a new object with just those three, in that order); nothing for 'buildings' or absent,
// so a plan for the fewest buildings, and every plan stored before it, has no field and
// calculates exactly as before. Any other value is refused, never corrected.
const OBJECTIVE_REFUSAL = `Choose what the plan keeps lowest: buildings, power, raw resources, or a weighted mix with whole weights from 0 to ${OBJECTIVE_WEIGHT_MAX}, at least one above 0.`;
const objectiveSetting = (value: unknown): Pick<CurrentSettings, 'objective'> => {
  if (value === undefined || value === 'buildings') return {};
  if (value === 'power' || value === 'raw') return { objective: value };
  if (!isRecord(value) || Object.keys(value).length !== OBJECTIVE_WEIGHTS.length)
    fail(OBJECTIVE_REFUSAL);
  const weight = (name: (typeof OBJECTIVE_WEIGHTS)[number]): number => {
    const given = value[name];
    return Number.isInteger(given) &&
      (given as number) >= 0 &&
      (given as number) <= OBJECTIVE_WEIGHT_MAX
      ? (given as number)
      : fail(OBJECTIVE_REFUSAL);
  };
  const weights = { buildings: weight('buildings'), power: weight('power'), raw: weight('raw') };
  if (!OBJECTIVE_WEIGHTS.some(name => weights[name] > 0)) fail(OBJECTIVE_REFUSAL);
  return { objective: weights };
};
// The caps per phase (#1221): `{ phaseCaps }` with `buildings` and `mw`, each a whole number from
// 1 to its PHASE_CAP_LIMITS, either one absent (a new object with just those, in that order);
// nothing when neither is set, so a plan without caps, and every plan stored before them, has no
// field and calculates exactly as before. Any other value is refused, never corrected.
const PHASE_CAP_REFUSAL = `Give the caps per phase as whole numbers: buildings from 1 to ${PHASE_CAP_LIMITS.buildings.toLocaleString('en-US')}, MW from 1 to ${PHASE_CAP_LIMITS.mw.toLocaleString('en-US')}.`;
const phaseCapsSetting = (value: unknown): Pick<CurrentSettings, 'phaseCaps'> => {
  if (value === undefined) return {};
  if (
    !isRecord(value) ||
    Object.keys(value).some(key => !PHASE_CAP_KEYS.some(name => name === key))
  )
    fail(PHASE_CAP_REFUSAL);
  const caps: NonNullable<CurrentSettings['phaseCaps']> = {};
  for (const name of PHASE_CAP_KEYS) {
    const given = value[name];
    if (given === undefined) continue;
    if (
      !Number.isInteger(given) ||
      (given as number) < 1 ||
      (given as number) > PHASE_CAP_LIMITS[name]
    )
      fail(PHASE_CAP_REFUSAL);
    caps[name] = given as number;
  }
  return Object.keys(caps).length ? { phaseCaps: caps } : {};
};
// The generators the player already has (#1068): `{ ownedGenerators: { building: count } }` with
// only the known kinds (OWNED_GENERATORS in public/preferences/fuels.ts) and whole counts from 1,
// or nothing, so the field is absent unless one is entered.
const ownedGeneratorsSetting = (value: unknown): Pick<CurrentSettings, 'ownedGenerators'> => {
  const counts = ownedGeneratorCounts(value);
  return counts ? { ownedGenerators: counts } : {};
};

// Validates and normalises a profile's settings. Every field has a default, so `settings({})` is a
// complete profile, and a field older profiles never stored must default to the value that makes
// them calculate exactly as before (e.g. `buildRate` falls back to `storageRate`,
// `installedPowerGW` to `availablePowerGW`, `existingSupply` to {}, `phaseTime` to 'every').
// Unknown fields are dropped. The result is stored as `plan.settings` and the interface reads it
// back (limits, utilityPercent, availablePowerGW, recipes, sam, ...). Called by calculate() and
// directly by tests; throws a 400 error for invalid input.
//
// Units: availablePowerGW and installedPowerGW in GW (spare and total installed generation),
// utilityPercent in %, rates (droneFuelRate, storageRate, buildRate, cellsPerMinute) per minute,
// hours per phase, limits per minute, multiplier the elevator cost multiplier, powerFactor the
// power consumption multiplier.
export function settings(input: unknown = {}): CurrentSettings {
  if (!isRecord(input)) fail('Invalid settings.');
  const base = {
    utilityPercent: number(input.utilityPercent, 0, 200, 20),
    droneFuel: choice(input.droneFuel, droneFuels as DroneFuel[], 'none'),
    droneFuelRate: number(input.droneFuelRate, 0.01, 10000, 10),
    droneBridgeRate: number(input.droneBridgeRate, 0.01, 10000, 10),
    worldSeed:
      input.worldSeed === undefined || input.worldSeed === ''
        ? ''
        : String(number(Number(input.worldSeed), -2147483648, 2147483647, 1)),
    mainPower: choice(
      input.mainPower,
      powerOptions.map(option => option[0]) as MainPower[],
      'auto',
    ),
    collectables: input.collectables === true,
    phase: choice<StageKey>(String(input.phase || '3'), ['1', '2', '3', '4', '5'], '3'),
    purity: choice(input.purity, purities.map(option => option[0]) as Purity[], 'vanilla'),
    distribution: choice(
      input.distribution,
      distributions.map(option => option[0]) as Distribution[],
      'original',
    ),
    multiplier: number(input.multiplier, 0.1, 1000, 1),
    powerFactor: number(input.powerFactor, 0, 10, 1),
    // The recipe part cost multiplier (#1161): absent at 1×, so settings without it stay as they
    // were.
    ...recipeCostSetting(input.recipeCost),
    availablePowerGW: number(input.availablePowerGW, 0, 10000, 0),
    recipes: choice(input.recipes, ['standard', 'all', 'custom'], 'standard'),
    pureIngots: !!input.pureIngots,
    sam: choice(input.sam, ['avoid', 'needed', 'allow'], 'needed'),
    nuclear: choice(input.nuclear, ['none', 'sink', 'recycle'], 'none'),
    uraniumReactors: number(input.uraniumReactors, 1, 1000, 1),
    storage: choice(
      input.storage,
      storageOptions.map(option => option[0]) as StorageChoice[],
      'construction',
    ),
    storageRate: number(input.storageRate, 0.1, 300, 1),
    buildRate: number(input.buildRate, 0, 300, number(input.storageRate, 0.1, 300, 1)),
    storageOverrides: rateOverrides(input.storageOverrides),
    existingSupply: supplyRates(input.existingSupply),
    transportFuel: transportFuelRates(input.transportFuel),
    ...onSiteSetting(input.onSite),
    ...exactClockLines(input.exactClocks),
    // The somersloops pinned on production lines (#1235): absent unless a recalculation asks for
    // pins, so settings without them, and every plan stored before them, stay as they were.
    ...sloopPinsSetting(input.sloopPins),
    // Overclocked production lines and their Power Shard budget (#1239): absent unless asked for,
    // so settings without them, and every plan stored before them, stay as they were.
    ...lineClocksSetting(input.lineClocks),
    ...lineShardBudgetSetting(input.lineShardBudget),
    // The production lines that already stand (#1176): absent unless a recalculation carries
    // them, so settings without them, and every plan stored before them, stay as they were.
    ...builtLinesSetting(input.builtLines),
    // Mining and belts per phase (#1065): only `true` turns it on, and the field is absent
    // otherwise, so settings without it, and every plan stored before it, stay as they were.
    ...(input.phaseMining === true ? { phaseMining: true } : {}),
    // The best miner the player already has (#1068): only Mk.2 or Mk.3 is kept, so settings
    // without it, and every plan stored before it, plan each phase's miner as before.
    ...ownedMinerSetting(input.ownedMiner),
    // The best belt the player already has (#1068): only Mk.3 to Mk.6 is kept, so settings
    // without it, and every plan stored before it, plan each phase's belt as before.
    ...ownedBeltSetting(input.ownedBelt),
    // The player can overclock, and Water Extractors overclocked (#1137): only `true` is kept, so
    // settings without them, and every plan stored before them, plan each phase's clock as before.
    ...(input.overclock === true ? { overclock: true as const } : {}),
    ...(input.waterOverclock === true ? { waterOverclock: true as const } : {}),
    // The alternates the player already owns (#1068): only known alternate ids are kept, so
    // settings without them, and every plan stored before them, plan the same recipe pool.
    ...ownedAlternatesSetting(input.ownedAlternates),
    // The generators the player already has (#1068): only known kinds with whole counts are kept,
    // so settings without them, and every plan stored before them, size the same generators.
    ...ownedGeneratorsSetting(input.ownedGenerators),
    extraction: extractionRecord(input.extraction),
    cellsPerMinute: number(input.cellsPerMinute, 0, 1000, 0),
    installedPowerGW: number(
      input.installedPowerGW,
      0,
      10000,
      number(input.availablePowerGW, 0, 10000, 0),
    ),
    somersloops: number(input.somersloops, 0, 106, 0),
    augmenters: number(input.augmenters, 0, 10, 0),
    fueledAugmenters: number(input.fueledAugmenters, 0, 10, 0),
    sloopReserved: reservedUses(input.sloopReserved),
    amplifySloops: number(input.amplifySloops, 0, 106, 0),
    goal: choice(input.goal, ['minimal', 'balanced', 'timed', 'maximum'], 'balanced'),
    // What the plan keeps lowest (#1180): absent for the fewest buildings, so settings without
    // it, and every plan stored before it, stay as they were.
    ...objectiveSetting(input.objective),
    // The caps per phase (#1221): absent without one, so settings without them, and every plan
    // stored before them, stay as they were.
    ...phaseCapsSetting(input.phaseCaps),
    // The belt cap (#1232): absent without one, so settings without it, and every plan stored
    // before it, plan each phase's belt as before.
    ...beltCapSetting(input.beltCap),
    // The cap on hard drives (#1233): absent without one, so settings without it, and every plan
    // stored before it, plan the same recipe pool.
    ...driveCapSetting(input.driveCap),
    phaseTime: choice(input.phaseTime, ['every', 'final'], 'every'),
    hours: number(input.hours, 0.25, 2000, 8),
    roundRates: input.roundRates !== false,
    wholeMachines: input.wholeMachines === true,
    // Protected storage fed from surplus first (#1061): only `true` turns it on, and the field is
    // absent otherwise, so settings without it, and every plan stored before it, stay as they were.
    ...(input.storageFromSurplus === true ? { storageFromSurplus: true as const } : {}),
    limitsConfirmed: !!input.limitsConfirmed,
    modNotes: typeof input.modNotes === 'string' ? input.modNotes.slice(0, 500) : '',
  };
  const config: CurrentSettings = {
    ...base,
    limits: {},
    alternateRecipes: [],
    preferredRecipes: [],
  };
  if (config.droneFuel === 'Plutonium Fuel Rod' && config.nuclear === 'none')
    fail('Plutonium drone fuel requires a nuclear power and waste-processing strategy.');
  if (config.fueledAugmenters > config.augmenters)
    fail('More fueled Alien Power Augmenters than augmenters.');
  // The somersloop budget is a hard limit (#1059): a plan whose augmenters, hand-fed uses and
  // amplification budget need more somersloops than the save has would rest on buildings that
  // cannot be built, so it is refused rather than clamped, and the user chooses what to give up.
  // A stored plan is never checked again: it keeps its numbers, and its pages say what it commits.
  const sloops = sloopCommitment(config);
  if (sloops.over > 0) fail(sloopRefusal(sloops));
  if (config.installedPowerGW < config.availablePowerGW)
    fail('Total installed generation cannot be less than the spare part of it.');
  // Budgets the profile did not enter default to what its map preset gives (resourceDefaults in
  // public/preferences.ts): DEFAULT_LIMITS for the default map, zero for the resource-rich ones.
  const defaults = resourceDefaults(config.purity, config.distribution).limits;
  if (
    (config.mainPower === 'nuclear' || config.mainPower.endsWith('-nuclear')) &&
    config.nuclear === 'none'
  )
    fail('Choose a nuclear waste strategy for a nuclear power preference.');
  // Every raw resource has a preset default, so the fallback is always a number.
  const limits = input.limits as Raw | undefined;
  for (const resource of RAW)
    config.limits[resource] = number(limits?.[resource], 0, 10000000, defaults[resource] as number);
  // Alternates only matter under recipes: 'custom'. Unknown ids are dropped and the lists sorted,
  // so equal choices always produce equal settings. Preferred recipes must be selected alternates.
  config.alternateRecipes = Array.isArray(input.alternateRecipes)
    ? [...new Set(input.alternateRecipes.filter((id): id is string => ALT_IDS.has(id)))].sort()
    : [];
  if (config.recipes === 'custom' && powerNeedsTurbofuel(config.mainPower))
    config.alternateRecipes = [
      ...new Set([...config.alternateRecipes, ...turbofuelRecipes]),
    ].sort();
  config.preferredRecipes = Array.isArray(input.preferredRecipes)
    ? [
        ...new Set(
          input.preferredRecipes.filter((id): id is string => config.alternateRecipes.includes(id)),
        ),
      ].sort()
    : [];
  // The MAM recipes (#1058): kept only as a boolean, so settings without it, and every plan
  // stored before it, plan the recipe pool they always did (mamRecipesOn in recipes.ts).
  if (typeof input.mamRecipes === 'boolean') config.mamRecipes = input.mamRecipes;
  // Planner's choice's picks (#1058): only picks, sorted, and absent when none, so settings
  // without it count every pick as owned, as before. The planner does not read it.
  const plannerPicks = Array.isArray(input.plannerPicks)
    ? [
        ...new Set(
          input.plannerPicks.filter(
            (id): id is string => typeof id === 'string' && config.alternateRecipes.includes(id),
          ),
        ),
      ].sort()
    : [];
  if (plannerPicks.length) config.plannerPicks = plannerPicks;
  // Count what the buildings cost to build (#1229): only `true` is kept, and only with a time
  // target, which the parts are counted over. Maximum output has none, so it drops the field, as
  // does any other value, and settings without it, and every plan stored before it, stay as they
  // were.
  if (input.buildCost === true && config.goal !== 'maximum') config.buildCost = true;
  return config;
}
