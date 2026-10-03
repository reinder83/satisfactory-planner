// Validation of a profile's settings: settings() and the checks of each field. A rejected
// setting throws with status 400 (fail).
// Re-exported by ../planner.ts.
import {
  droneFuels,
  vehicleFuels,
  storageOptions,
  distributions,
  purities,
  powerOptions,
  resourceDefaults,
} from '../public/preferences.ts';
import type {
  CurrentSettings,
  Distribution,
  DroneFuel,
  ExtractionRecord,
  ItemRates,
  MainPower,
  NodeCounts,
  Purity,
  SloopUse,
  StageKey,
  StorageChoice,
} from '../public/types/index.ts';
import { DATA, MAM_RECIPES, powerNeedsTurbofuel, ALT_IDS, RAW } from './data.ts';

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
// How the resource budgets were arrived at: the nodes the world holds, the
// miner they will be worked with, and whatever is already spoken for. Recorded
// so the survey can be reopened; the plan itself still runs on `limits`.
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
  return {
    mark:
      raw.mark === undefined
        ? 3
        : [1, 2, 3].includes(raw.mark as number)
          ? (raw.mark as 1 | 2 | 3)
          : fail('Invalid miner mark.'),
    clock: number(raw.clock, 0.01, 2.5, 2.5),
    nodes: countsByResource(raw.nodes),
    wells: countsByResource(raw.wells),
    used,
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
    phaseTime: choice(input.phaseTime, ['every', 'final'], 'every'),
    hours: number(input.hours, 0.25, 2000, 8),
    roundRates: input.roundRates !== false,
    wholeMachines: input.wholeMachines === true,
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
    config.alternateRecipes = [...new Set([...config.alternateRecipes, ...MAM_RECIPES])].sort();
  config.preferredRecipes = Array.isArray(input.preferredRecipes)
    ? [
        ...new Set(
          input.preferredRecipes.filter((id): id is string => config.alternateRecipes.includes(id)),
        ),
      ].sort()
    : [];
  return config;
}
