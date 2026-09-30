// The production calculator. `calculate(settings)` validates a profile's settings and solves one
// linear program per phase (1 to 5) with HiGHS (optimizer.ts). The result is the plan a
// calculated profile stores as a frozen snapshot (`profile.plan`); profiles are never silently
// recalculated. Post Phase 5 has no stage of its own: the interface shows Phase 5's stage for it
// (`stage()` in public/app/session.ts).
//
// Callers: workspace.ts (`/api/preview`, `/api/profiles`, `/api/round-up`, and `catalog()` in
// the session summary) for the Docker edition. The Pages edition runs a copy that build.ts adapts
// for the browser, inside calculator-worker.js, which public/browser-api.ts drives; `catalog()` is
// written to catalog.json at build time. tests/*.test.ts import this module directly.
//
// Units: items per minute (m³ per minute for fluids) and MW. Recipe rates in recipes.json are for
// one machine at 100% clock, so a recipe's LP variable counts machine-equivalents.
//
// build.ts finds the node:fs import, the preferences.ts path and the recipes.json read below by
// exact string match and replaces them for the browser; keep those three snippets unchanged.
import {
  droneFuels,
  vehicleFuels,
  droneSupply,
  wantsStorage,
  storageRateFor,
  constructionItems,
  elevatorParts,
  storageOptions,
  distributions,
  purities,
  powerOptions,
  resourceDefaults,
} from './public/preferences.ts';
import fs from 'node:fs';
import { solve, type LpModel } from './optimizer.ts';
import type {
  AlternatePayoff,
  AlternateRanking,
  Catalog,
  CurrentCalculatedPlan,
  CurrentSettings,
  CalcRow,
  CurrentStage,
  Distribution,
  DroneFuel,
  ExtractionRecord,
  ItemRates,
  MainPower,
  NodeCounts,
  PhaseFigures,
  Purity,
  Recipe,
  RecipeData,
  SloopUse,
  StageDelivery,
  StageKey,
  StageResult,
  StorageChoice,
} from './public/types/index.ts';

// An untrusted object: a record whose fields are not checked yet.
type Raw = Record<string, unknown>;
// A recipe as run() plans with it: from recipes.json, a generator, or an amplified twin, which
// carries its somersloop `slots` per machine. Generators have no `alternate` flag.
type PoolRecipe = Omit<Recipe, 'alternate'> & { alternate?: boolean; slots?: number };
// run()'s result: a solved stage, or a failure with the solver's status when it has one.
type Solved = StageResult & { feasible: true };
type RunResult = Solved | { feasible: false; solverStatus?: string };
interface RunOptions {
  maximum?: boolean;
  conversion?: boolean;
  ignoreLimits?: boolean;
  recipeIds?: Set<string> | null;
  caps?: Record<string, number> | null;
  baseline?: Record<string, number> | null;
  fractionalNuclear?: boolean;
}
const isRecord = (value: unknown): value is Raw =>
  !!value && typeof value === 'object' && !Array.isArray(value);
// Game data. `recipes`: id, name, alternate, the elevator `phase` from which it is available,
// machine, per-minute `inputs`/`outputs` for one machine at 100%, and `power` in MW per machine.
// `items`: fluid, radioactive, `energy` (MJ per item or m³, used for fuel generators) and `sink`
// (AWESOME Sink points; 0 means the sink refuses it). Recipe ids become row ids and progress keys.
export const DATA: RecipeData = JSON.parse(
  fs.readFileSync(new URL('./recipes.json', import.meta.url), 'utf8'),
);
// Recorded as `plan.engine` in every calculated plan, so a stored snapshot says which engine
// produced it. Nothing in the app reads it back at the moment.
export const ENGINE = '2.0.0';
// Turbofuel and Enriched Coal come from MAM research, not hard drives, so recipePool treats them
// as standard recipes. Under 'custom' recipes they are opt-in like any alternate, and settings()
// adds them itself when the power preference needs turbofuel.
const MAM_RECIPES = ['Recipe_Alternate_Turbofuel_C', 'Recipe_Alternate_EnrichedCoal_C'];
// Power preferences other than auto/coal/fuel run turbofuel generators (directly or as the Phase 3 bridge).
export const powerNeedsTurbofuel = (mainPower: string | undefined) =>
  !['auto', 'coal', 'fuel'].includes(mainPower || 'auto');
// Every alternate recipe id: the whitelist for a profile's `alternateRecipes`.
const ALT_IDS = new Set(DATA.recipes.filter(r => r.alternate).map(r => r.id));
// Extracted resources. Each is supplied by a `raw:` LP variable capped by the profile's budget in
// `settings.limits` (per minute); nothing crafts them except the Phase 5 Converter recipes, which
// are only in the pool when `conversion` is on. The order is the Resources table's row order
// (`catalog().raw`).
export const RAW: string[] = [
  'Iron Ore',
  'Copper Ore',
  'Limestone',
  'Coal',
  'Caterium Ore',
  'Raw Quartz',
  'Sulfur',
  'Bauxite',
  'Uranium',
  'SAM',
  'Crude Oil',
  'Nitrogen Gas',
  'Water',
];
// Resource budgets per minute for the default map at its own purities, every node worked at 250%
// clock: Miner Mk.3 300/600/1200 on impure/normal/pure, Oil Extractor 150/300/600 (resource wells
// excluded), Resource Well Extractor 75/150/300 per nitrogen satellite. These are `nodeCounts`
// in public/preferences.ts through that extraction table, and a test (guided.test.ts) rebuilds
// both tables from it. Water is a planning allowance, not a map total. Shipped to the interface
// as `catalog().limits`; a profile's own budgets live in `settings.limits`.
export const DEFAULT_LIMITS: ItemRates = {
  'Iron Ore': 92100,
  'Copper Ore': 36900,
  Limestone: 69300,
  Coal: 42300,
  'Caterium Ore': 15000,
  'Raw Quartz': 13500,
  Sulfur: 10800,
  Bauxite: 12300,
  Uranium: 2100,
  SAM: 10200,
  'Crude Oil': 9900,
  'Nitrogen Gas': 12000,
  Water: 1000000,
};
// The same nodes and extraction rates with every node pure (the "All Pure" purity setting).
// Shipped as `catalog().pureLimits`.
export const PURE_LIMITS: ItemRates = {
  'Iron Ore': 152400,
  'Copper Ore': 66000,
  Limestone: 112800,
  Coal: 74400,
  'Caterium Ore': 20400,
  'Raw Quartz': 20400,
  Sulfur: 19200,
  Bauxite: 20400,
  Uranium: 6000,
  SAM: 22800,
  'Crude Oil': 18000,
  'Nitrogen Gas': 13500,
  Water: 1000000,
};
// Space Elevator project parts per phase, as the game asks for them at a 1x cost multiplier.
// `run` scales them by `settings.multiplier` and turns them into delivery rates over the phase's
// hours. `elevatorParts` in public/preferences.ts is kept in step with this by a test. Item names
// here are part of saved progress: delivery counts are stored under '<phase>-<slugged name>'.
export const DELIVERIES: Record<number, ItemRates> = {
  1: { 'Smart Plating': 50 },
  2: { 'Smart Plating': 1000, 'Versatile Framework': 1000, 'Automated Wiring': 100 },
  3: { 'Versatile Framework': 2500, 'Modular Engine': 500, 'Adaptive Control Unit': 100 },
  4: {
    'Assembly Director System': 500,
    'Magnetic Field Generator': 500,
    'Thermal Propulsion Rocket': 250,
    'Nuclear Pasta': 100,
  },
  5: {
    'Nuclear Pasta': 1000,
    'Biochemical Sculptor': 1000,
    'AI Expansion Server': 256,
    'Ballistic Warp Drive': 200,
  },
};
// Settings validation helpers. A rejected setting throws with status 400; server.ts sends a
// thrown error that carries a status back with its message, so the user sees this text.
// A function declaration, so TypeScript knows the code after a failed check is unreachable.
function fail(message: string): never {
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
const storable = (name: string) =>
  !RAW.includes(name) &&
  !DATA.items[name]?.fluid &&
  !DATA.items[name]?.radioactive &&
  (DATA.items[name]?.sink || 0) > 0;
// What a storage container can be named after when one is added (#295): every item the game
// has that is not a fluid, since a fluid does not go in a container, and not the two entries
// of the recipe data that are not items at all. The Hard Drive is in no recipe, so the data
// does not list it, but it is an item a container can hold.
const CONTAINER_ITEMS = [
  ...new Set([
    ...Object.keys(DATA.items).filter(
      name => !DATA.items[name]?.fluid && name !== 'Sink point' && name !== 'Power',
    ),
    'Hard Drive',
  ]),
].sort((a, b) => a.localeCompare(b));
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
const pureNames = [
  'Alternate: Pure Iron Ingot',
  'Alternate: Pure Copper Ingot',
  'Alternate: Pure Caterium Ingot',
  'Alternate: Pure Aluminum Ingot',
];
const metals = ['Iron Ingot', 'Copper Ingot', 'Caterium Ingot', 'Aluminum Ingot'];
// Slug for generated row ids ('power-rocket-fuel'). Row ids are progress keys, so keep it stable.
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
// The recipes a phase may choose from, before power generators are added (generators() below).
// `config` is normalised settings, `phase` a number 1 to 5, and `conversion` whether the Phase 5
// Converter recipes that make raw resources (SAM-based ore conversion) are allowed. Returns
// recipe objects from recipes.json, MAM recipes relabelled as standard. Used only by `run`.
// The filters, in order:
// 1. MAM recipes are always in, except under 'custom' where they must be selected; the map
//    then relabels them as standard recipes.
// 2. Available by this phase, and standard, or allowed by the recipe setting, or one of the
//    pure ingot alternates when `pureIngots` is on.
// 3. With `pureIngots`, from Phase 3 the pure alternates replace every other recipe for the four
//    metal ingots (the owner's handbook runs pure ingot recipes from Phase 3).
// 4. Recipes that make a raw resource (the Converter's ore conversions) only with `conversion`.
//    Water is exempt: aluminum scrap, batteries and several blender recipes return water.
// 5. Nuclear fuel and waste-processing recipes only with a nuclear strategy, except that from
//    Phase 4 uranium drone fuel admits the Uranium Fuel Rod and Encased Uranium Cell recipes.
// 6. Preferred recipes (custom only) push out the competitors for their primary product.
export function recipePool(config: CurrentSettings, phase: number, conversion: boolean): Recipe[] {
  return DATA.recipes
    .filter(
      recipe =>
        !MAM_RECIPES.includes(recipe.id) ||
        config.recipes !== 'custom' ||
        config.alternateRecipes.includes(recipe.id),
    )
    .map(recipe =>
      MAM_RECIPES.includes(recipe.id)
        ? { ...recipe, alternate: false, name: recipe.name.replace('Alternate: ', '') }
        : recipe,
    )
    .filter(
      recipe =>
        recipe.phase <= phase &&
        (config.recipes === 'all' ||
          !recipe.alternate ||
          (config.recipes === 'custom' && config.alternateRecipes.includes(recipe.id)) ||
          (config.pureIngots && pureNames.includes(recipe.name))),
    )
    .filter(
      recipe =>
        !(
          config.pureIngots &&
          phase >= 3 &&
          metals.some(metal => recipe.outputs[metal]) &&
          !pureNames.includes(recipe.name)
        ),
    )
    .filter(
      recipe =>
        !Object.keys(recipe.outputs).some(item => RAW.includes(item) && item !== 'Water') ||
        conversion,
    )
    .filter(
      recipe =>
        ![
          'Uranium Fuel Rod',
          'Plutonium Fuel Rod',
          'Ficsonium',
          'Ficsonium Fuel Rod',
          'Encased Uranium Cell',
          'Non-Fissile Uranium',
          'Plutonium Pellet',
          'Encased Plutonium Cell',
        ].some(item => recipe.outputs[item]) ||
        config.nuclear !== 'none' ||
        (phase >= 4 &&
          config.droneFuel === 'Uranium Fuel Rod' &&
          ['Uranium Fuel Rod', 'Encased Uranium Cell'].some(item => recipe.outputs[item])),
    )
    .filter(recipe => {
      // a preferred recipe replaces competing recipes for its primary product at phases where it is available
      const preferred = config.recipes === 'custom' ? config.preferredRecipes || [] : [];
      if (!preferred.length || preferred.includes(recipe.id)) return true;
      return !preferred.some(id => {
        const other = DATA.recipes.find(r => r.id === id);
        return (
          other &&
          other.phase <= phase &&
          Object.keys(other.outputs)[0] === Object.keys(recipe.outputs)[0]
        );
      });
    });
}
// Production amplification. A somersloop machine is a whole machine: the same inputs, double the
// output and four times the power, per (1 + filled/total)^2 with every slot filled. Miners,
// extractors, packagers and generators have no slots. Opt-in: with no budget nothing is offered,
// so a plan that does not want to go slug hunting is calculated exactly as before.
// How many of the largest lines are offered an amplified twin. Every twin is another integer
// variable, and the fit has to finish inside the solver's time limit: whole-machine plans already
// carry integer machine counts, so they can afford fewer twins than precisely balanced ones.
// Measured against the heaviest plans in the test set; raising these starts losing whole phases.
export const AMPLIFY_CANDIDATES = { whole: 22, precise: 26 };
// Somersloop slots per production machine, as in the game. Amplifying a machine fills all its
// slots, so this is also the somersloop cost of one amplified machine.
export const AMPLIFY_SLOTS: Record<string, number> = {
  Smelter: 1,
  Constructor: 1,
  Assembler: 2,
  Foundry: 2,
  Refinery: 2,
  Converter: 2,
  Manufacturer: 4,
  Blender: 4,
  'Particle Accelerator': 4,
  'Quantum Encoder': 4,
};
const amplifiable = (recipe: PoolRecipe) =>
  recipe.power > 0 && (AMPLIFY_SLOTS[recipe.machine] ?? 0) > 0;
// The amplified twin of a recipe: a separate row with an 'amp:' id (its own progress key), which
// `run` makes an integer variable. `slots` marks it as amplified there.
const amplified = (recipe: PoolRecipe): PoolRecipe => ({
  ...recipe,
  id: 'amp:' + recipe.id,
  name: recipe.name + ' (somersloop amplified)',
  power: recipe.power * 4,
  slots: AMPLIFY_SLOTS[recipe.machine],
  outputs: Object.fromEntries(
    Object.entries(recipe.outputs).map(([item, rate]) => [item, rate * 2]),
  ),
});
// The largest period nuclearPeriod accepts. A longer one would force a plan to many more uranium
// plants than it needs, so such a chain gets whole uranium plants only (#370).
const NUCLEAR_PERIOD_MAX = 100;
// The recycle chain's period (#370): the smallest number of uranium plants for which every line
// downstream of their waste, up to the plutonium and ficsonium plants, runs whole machines at
// 100%. Radioactive items balance exactly, so with one recipe per chain item the chain is linear
// in the uranium plant count. Solve it for one uranium plant, write each line's machines as a
// fraction and take the least common multiple of the denominators: 20 with the default recipes
// (Ficsonium is 0.05 machines per plant).
//
// `pool` is the recipe network being fitted, `demand` its per-minute demands. Returns 1 when
// there is no such period: no uranium plant, a chain item some demand also draws (plutonium drone
// fuel, which makes the chain affine rather than linear), two recipes competing for one chain
// item (mixed alternates or an amplified twin), or a period above NUCLEAR_PERIOD_MAX.
type ChainRecipe = Pick<PoolRecipe, 'id' | 'inputs' | 'outputs'>;
export function nuclearPeriod(pool: ChainRecipe[], demand: ItemRates = {}): number {
  const uranium = pool.find(recipe => recipe.id === 'power-uranium');
  if (!uranium) return 1;
  // The chain: every recipe that makes or uses a radioactive item the chain carries, starting
  // from the uranium plants' waste. The fuel feed (cells and rods) is upstream, so it stays out.
  const radioactive = (item: string) => !!DATA.items[item]?.radioactive;
  const items = new Set(Object.keys(uranium.outputs).filter(radioactive));
  const chain: ChainRecipe[] = [];
  for (let grew = true; grew; ) {
    grew = false;
    for (const recipe of pool)
      if (
        recipe !== uranium &&
        !chain.includes(recipe) &&
        [...Object.keys(recipe.inputs), ...Object.keys(recipe.outputs)].some(item =>
          items.has(item),
        )
      ) {
        chain.push(recipe);
        Object.keys(recipe.outputs)
          .filter(radioactive)
          .forEach(item => items.add(item));
        grew = true;
      }
  }
  const names = [...items];
  if (!chain.length || names.length !== chain.length || names.some(item => (demand[item] || 0) > 0))
    return 1;
  // One balance per chain item: the chain's net output plus the uranium plant's is zero.
  const net = (recipe: ChainRecipe, item: string) =>
    (recipe.outputs[item] || 0) - (recipe.inputs[item] || 0);
  // Each row is one item: its net output per machine of each chain line, then the uranium plant's
  // waste on the right-hand side.
  const matrix = names.map(item => [
    ...chain.map(recipe => net(recipe, item)),
    -net(uranium, item),
  ]);
  // Gauss-Jordan elimination with partial pivoting. A singular system has no unique chain.
  const size = chain.length;
  for (let col = 0; col < size; col++) {
    let best = col;
    for (let row = col + 1; row < size; row++)
      if (Math.abs(matrix[row]![col]!) > Math.abs(matrix[best]![col]!)) best = row;
    if (Math.abs(matrix[best]![col]!) < 1e-9) return 1;
    [matrix[col], matrix[best]] = [matrix[best]!, matrix[col]!];
    const pivot = matrix[col]!;
    for (let row = 0; row < size; row++) {
      const line = matrix[row]!;
      if (row === col || line[col] === 0) continue;
      const factor = line[col]! / pivot[col]!;
      for (let k = col; k <= size; k++) line[k]! -= factor * pivot[k]!;
    }
  }
  // Machines of each chain line per uranium plant.
  const perPlant = matrix.map((line, col) => line[size]! / line[col]!);
  // The smallest denominator that makes each line's machines per plant whole.
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  let period = 1;
  for (const machines of perPlant) {
    if (machines < -1e-9) return 1;
    let denominator = 1;
    const scaled = () => machines * denominator;
    while (
      denominator <= NUCLEAR_PERIOD_MAX &&
      Math.abs(scaled() - Math.round(scaled())) > 1e-7 * Math.max(1, scaled())
    )
      denominator++;
    period = (period * denominator) / gcd(period, denominator);
    if (period > NUCLEAR_PERIOD_MAX) return 1;
  }
  return period;
}
// Power plants modelled as recipes, so the LP sizes generation and fuel chains with everything
// else. `power` is negative (MW generated per plant at 100%); inputs are fuel and water per
// minute. Coal from Phase 2, fuel generators from Phase 3 (rocket fuel from 4), nuclear from 4
// with a waste strategy, plutonium and ficsonium plants in Phase 5 when recycling. Phase 1 has no
// generators: biomass burners are hand-fed and stay out of the model. Then `mainPower` narrows
// the list from Phase 3 on; 'auto' leaves the choice to the solver.
function generators(config: CurrentSettings, phase: number): PoolRecipe[] {
  const result: PoolRecipe[] = [];
  if (phase >= 2)
    result.push({
      id: 'power-coal',
      name: 'Coal power',
      machine: 'Coal Generator',
      phase: 2,
      power: -75,
      inputs: { Coal: 15, Water: 45 },
      outputs: {},
    });
  if (phase >= 3)
    for (const name of ['Fuel', 'Turbofuel', ...(phase >= 4 ? ['Rocket Fuel'] : [])])
      result.push({
        id: 'power-' + slug(name),
        name: name + ' power',
        machine: 'Fuel Generator',
        phase: 3,
        power: -250,
        // 250 MW is 15,000 MJ per minute, divided by the fuel's energy per m³.
        inputs: { [name]: 15000 / DATA.items[name]!.energy },
        outputs: {},
      });
  if (phase >= 4 && config.nuclear !== 'none') {
    result.push({
      id: 'power-uranium',
      name: 'Uranium power',
      machine: 'Nuclear Power Plant',
      phase: 4,
      power: -2500,
      inputs: { 'Uranium Fuel Rod': 0.2, Water: 240 },
      outputs: { 'Uranium Waste': 10 },
    });
    if (phase === 5 && config.nuclear === 'recycle')
      result.push(
        {
          id: 'power-plutonium',
          name: 'Plutonium power',
          machine: 'Nuclear Power Plant',
          phase: 5,
          power: -2500,
          inputs: { 'Plutonium Fuel Rod': 0.1, Water: 240 },
          outputs: { 'Plutonium Waste': 1 },
        },
        {
          id: 'power-ficsonium',
          name: 'Ficsonium power',
          machine: 'Nuclear Power Plant',
          phase: 5,
          power: -2500,
          inputs: { 'Ficsonium Fuel Rod': 1, Water: 240 },
          outputs: {},
        },
      );
  }
  // Nuclear plants (present only with a waste strategy) are kept under every preference. The
  // others keep one fuel: coal, 'fuel', rocket fuel from Phase 4 for the rocket options, and
  // turbofuel otherwise, which is also the Phase 3 bridge for 'nuclear' before plants unlock.
  const preferred = config.mainPower || 'auto';
  if (preferred === 'auto' || phase < 3) return result;
  if (preferred === 'coal')
    return result.filter(r => r.id === 'power-coal' || r.machine === 'Nuclear Power Plant');
  if (preferred === 'nuclear' && phase >= 4)
    return result.filter(r => r.machine === 'Nuclear Power Plant');
  const fuel =
    preferred === 'fuel'
      ? 'Fuel'
      : preferred.startsWith('rocket') && phase >= 4
        ? 'Rocket Fuel'
        : 'Turbofuel';
  return result.filter(r => r.machine === 'Nuclear Power Plant' || r.inputs[fuel]);
}
// Plans one phase: builds the phase's LP (or MIP), solves it and turns the solution into a stage.
// Each phase is a self-contained steady state; nothing is carried over from an earlier phase's
// solution (only calculate()'s phaseTime 'final' pass passes `caps` from later phases).
//
// Inputs: `config` normalised settings, `phase` a number 1 to 5, and options:
//   maximum       maximise simultaneous elevator delivery instead of meeting fixed delivery rates
//   conversion    allow the Converter recipes that make raw resources (Phase 5 SAM conversion)
//   ignoreLimits  lift every resource budget to 1e7/min (diagnostics: what would this need?)
//   recipeIds     restrict the pool to these recipe ids (the network an exact solve chose); set,
//                 it also marks the inner solve of the two-step fit below
//   caps          { recipeId: max machine-equivalents }; a recipe missing from it is capped at 0
//   baseline      { recipeId: equivalent } from the exact solve: which lines get amplified twins
//   fractionalNuclear  leave the uranium plants fractional in a whole-machine fit (the fallback
//                 when whole nuclear plants do not fit, #370)
//
// Returns { feasible: false, solverStatus? } or a stage:
//   rows        one per recipe in use, in build order (suppliers before consumers): the recipe
//               plus `equivalent` (machine-equivalents at 100%), `machines` (whole buildings),
//               `lastClock` (% clock of the last machine), inputs/outputs scaled to the line's
//               per-minute totals, `peakMW` (whole machines at full power, before the utility
//               allowance), `generationMW` for generators, and `amplified`/`sloops` for 'amp:' rows
//   raw         per-minute draw on each raw resource; `supplied` credited existing production
//   storage     protected storage rate per storable item (0 keeps the container, reserves nothing)
//   drone       dedicated drone fuel per minute; `delivery` { item: { target, rate } }
//   surplus     solid, sinkable output per minute beyond every demand (overflow for the sink)
//   power       peakMW, generationMW, requiredMW (peak with utility allowance), availableMW (new
//               generation with augmenter boost plus spare), additionalHeadroomMW (shortfall)
//   hours       time to finish the phase's deliveries at these rates
//   plus plutoniumSink, sloopsUsed, augmenter fields, matrixRate and `conversions` (row names),
//   and `nuclearPeriod` when the uranium plants came in multiples of the recycle chain's period
// The two-step fit may add nuclearFractional, supplyDropped or amplificationDropped.
// calculate() may add aheadOf, fuelVerdict, or turn a failed
// phase into a draft with reason/shortfalls/minHours. The interface reads these fields in
// public/app/views/calculated.ts, public/app/flow.ts and public/app/wizard/. Only calculate()
// calls run, directly and through the two-step fit below.
export function run(
  config: CurrentSettings,
  phase: number,
  {
    maximum = false,
    conversion = false,
    ignoreLimits = false,
    recipeIds = null,
    caps = null,
    baseline = null,
    fractionalNuclear = false,
  }: RunOptions = {},
): RunResult {
  const context: PhaseContext = {
    config,
    phase,
    maximum,
    conversion,
    ignoreLimits,
    recipeIds,
    caps,
    baseline,
    fractionalNuclear,
    power: phasePower(config, phase),
  };
  // The inner calls of the two-step fit pass `recipeIds`, so they skip it and plan the phase.
  if ((config.wholeMachines || config.amplifySloops > 0) && !recipeIds) return twoStepFit(context);
  const pool = phasePool(context);
  const demands = phaseDemands(context, reachableItems(context, pool));
  const { model, period } = buildModel(context, pool, demands);
  const solved = solveModel(model, maximum);
  // solverStatus lets calculate() tell a time-out ('Time limit reached') from a real shortage.
  if (!solved.feasible || !solved.bounded)
    return { feasible: false, solverStatus: solved.solverStatus };
  if (!satisfiesModel(model, solved)) return { feasible: false };
  return readStage(context, pool, demands, solved, period);
}
// What every step of one phase's solve shares: the normalised settings, the phase (1 to 5),
// run()'s options with their defaults filled in, and the phase's power figures.
interface PhaseContext extends Required<RunOptions> {
  config: CurrentSettings;
  phase: number;
  power: PhasePower;
}
// The phase's power figures (see phasePower).
interface PhasePower {
  utilityFactor: number;
  augmenters: number;
  fueled: number;
  boost: number;
  spareMW: number;
}
// The per-minute amounts that must leave the phase's network (see phaseDemands): `demand` in
// total per item, and the parts it is made of that the stage reports.
interface PhaseDemands {
  demand: ItemRates;
  storage: ItemRates;
  delivery: Record<string, StageDelivery>;
  drone: ItemRates;
  transport: ItemRates;
  matrix: number;
}
type Solution = ReturnType<typeof solve>;
// The options the two-step fit passes on to each of its solves unchanged.
type FitOptions = Pick<RunOptions, 'maximum' | 'conversion' | 'ignoreLimits' | 'caps'>;
// Two-step fit for whole machines and amplification. First the exact LP (fractional machines,
// no amplification) chooses the recipe network; then the integer fit re-solves over only that
// network (`recipeIds`), which keeps the integer search small enough for the solver's 3-second
// limit. Hence the warning that the result is not a global mixed-recipe integer optimum.
function twoStepFit(context: PhaseContext): RunResult {
  const { config, phase, maximum, conversion, ignoreLimits, caps } = context;
  const sharedOptions: FitOptions = { maximum, conversion, ignoreLimits, caps };
  // If even the exact LP fails, rounding cannot help; calculate() explains the failure.
  const base = exactFit(config, phase, sharedOptions);
  if (!base.feasible) return base;
  const ids = new Set(base.rows.map(row => row.id));
  const baseline = amplifyCandidates(config, base);
  const fit = integerFit(config, phase, { ...sharedOptions, recipeIds: ids, baseline });
  if (!fit.feasible && Object.keys(config.existingSupply).length) {
    const retried = supplyFallback(context, sharedOptions, ids, baseline);
    if (retried) return retried;
  }
  // Amplification is optional by definition: the solver may always place no somersloops at all.
  // So a failure here is the integer search running out of time, never a real shortage — never let
  // it cost the user a plan that fits. Fall back to the unamplified fit and say so.
  if (!fit.feasible && config.amplifySloops > 0) {
    const plain = integerFit({ ...config, amplifySloops: 0 }, phase, {
      ...sharedOptions,
      recipeIds: ids,
    });
    if (plain.feasible) return { ...plain, amplificationDropped: true };
  }
  return fit;
}
// The two-step fit's first step: the exact LP, with fractional machines and no amplification.
const exactFit = (variant: CurrentSettings, phase: number, options: FitOptions) =>
  run({ ...variant, wholeMachines: false, amplifySloops: 0 }, phase, options);
// The amplification candidates: the largest lines (at least one machine-equivalent) of an
// exact solve, as { recipeId: equivalent }.
const amplifyCandidates = (config: CurrentSettings, exactStage: Solved): Record<string, number> =>
  Object.fromEntries(
    [...exactStage.rows]
      .filter(row => row.equivalent >= 1)
      .sort((a, b) => b.equivalent - a.equivalent)
      .slice(0, AMPLIFY_CANDIDATES[config.wholeMachines ? 'whole' : 'precise'])
      .map(row => [row.id, row.equivalent]),
  );
// An integer fit. Whole nuclear plants (see roundNuclear) can need more uranium, water or
// waste-chain inputs than the budgets allow; then fall back to fractional uranium plants,
// exactly the fit earlier releases made, and mark the stage `nuclearFractional` (#370).
function integerFit(variant: CurrentSettings, phase: number, options: RunOptions): RunResult {
  const result = run(variant, phase, options);
  if (result.feasible || !variant.wholeMachines || !options.recipeIds?.has('power-uranium'))
    return result;
  const fractional = run(variant, phase, { ...options, fractionalNuclear: true });
  return fractional.feasible ? { ...fractional, nuclearFractional: true } : result;
}
// Crediting production you already run narrows the recipe network the exact solve picks, and a
// narrower network has less room to round up to whole machines. Widen it with the recipes this
// phase would have used without the credit before concluding anything — the supplied plan is
// still the smaller one, it just needs the slack. If even that will not round, drop the credit:
// telling the planner what you already built must never cost you a plan, the same rule
// amplification follows in twoStepFit. Returns null when neither fits.
function supplyFallback(
  context: PhaseContext,
  sharedOptions: FitOptions,
  ids: Set<string>,
  baseline: Record<string, number>,
): RunResult | null {
  const { config, phase } = context;
  const plainBase = exactFit({ ...config, existingSupply: {} }, phase, sharedOptions);
  if (!plainBase.feasible) return null;
  const plainIds = new Set(plainBase.rows.map(row => row.id));
  const widened = integerFit(config, phase, {
    ...sharedOptions,
    recipeIds: new Set([...ids, ...plainIds]),
    baseline,
  });
  if (widened.feasible) return widened;
  const without = integerFit({ ...config, existingSupply: {} }, phase, {
    ...sharedOptions,
    recipeIds: plainIds,
    baseline: amplifyCandidates(config, plainBase),
  });
  return without.feasible ? { ...without, supplyDropped: true } : null;
}
// Recipe pool. With `recipeIds` (the inner integer fit) only the chosen network, plus the
// conversion recipes when those are allowed. Amplified twins are added only in that inner fit,
// and only for the baseline's candidate lines.
function phasePool({ config, phase, conversion, recipeIds, baseline }: PhaseContext): PoolRecipe[] {
  const selected: PoolRecipe[] = [
    ...recipePool(config, phase, conversion),
    ...generators(config, phase),
  ].filter(
    recipe =>
      !recipeIds ||
      recipeIds.has(recipe.id) ||
      (conversion &&
        Object.keys(recipe.outputs).some(item => RAW.includes(item) && item !== 'Water')),
  );
  return [
    ...selected,
    ...(config.amplifySloops > 0 && recipeIds
      ? selected
          .filter(recipe => amplifiable(recipe) && baseline?.[recipe.id] !== undefined)
          .map(amplified)
      : []),
  ];
}
// Items the pool can actually make from raw resources (and from nuclear waste, which the
// plants themselves produce), found by repeated passes. Only reachable items are given a
// protected storage demand, so storage never asks for something this phase cannot make.
function reachableItems({ config, phase }: PhaseContext, pool: PoolRecipe[]): Set<string> {
  const reachable = new Set(RAW);
  if (config.nuclear !== 'none' && phase >= 4) reachable.add('Uranium Waste');
  if (config.nuclear === 'recycle' && phase === 5) reachable.add('Plutonium Waste');
  for (let i = 0; i < 20; i++)
    for (const recipe of pool)
      if (Object.keys(recipe.inputs).every(item => reachable.has(item)))
        Object.keys(recipe.outputs).forEach(item => reachable.add(item));
  return reachable;
}
// Demands: per-minute amounts that must leave the network rather than feed another recipe.
// They become the right-hand sides of the item balance constraints (addBalances). Four kinds:
// protected storage, elevator deliveries, drone and vehicle fuel, and Phase 5 Singularity Cells
// and augmenter fuel.
function phaseDemands(context: PhaseContext, reachable: Set<string>): PhaseDemands {
  const { config, phase, maximum } = context;
  const demand: ItemRates = {};
  const add = (item: string, rate: number) => (demand[item] = (demand[item] || 0) + rate);
  const storage = storageDemand(config, reachable);
  for (const [item, rate] of Object.entries(storage)) if (rate > 0) demand[item] = rate;
  // Under `maximum` deliveries are not a fixed demand; the goal variable (addSources) draws them.
  const delivery = deliveryDemand(context);
  if (!maximum) for (const [item, part] of Object.entries(delivery)) add(item, part.rate);
  const drone = droneSupply(config, phase);
  for (const [item, rate] of Object.entries(drone)) add(item, rate);
  // Vehicle fuel for the factory-group links (#206), where this phase can make it.
  const transport: ItemRates = {};
  for (const [item, rate] of Object.entries(
    config.transportFuel?.[String(phase) as StageKey] || {},
  ))
    if (reachable.has(item)) {
      transport[item] = rate;
      add(item, rate);
    }
  if (phase === 5 && config.cellsPerMinute) add('Singularity Cell', config.cellsPerMinute);
  // Each fueled augmenter needs 5 Alien Power Matrix/min. The rate is derived from the augmenter
  // count rather than entered, so the fuel line can never disagree with the augmenters it feeds.
  const matrix = phase === 5 ? 5 * config.fueledAugmenters : 0;
  if (matrix) add('Alien Power Matrix', matrix);
  return { demand, storage, delivery, drone, transport, matrix };
}
// Protected storage: solid, sinkable, non-radioactive reachable items the storage mode covers,
// each at its rate from storageRateFor (per-item override, elevator parts 0, build rate, general
// rate). A rate of 0 keeps the item's container but reserves nothing.
function storageDemand(config: CurrentSettings, reachable: Set<string>): ItemRates {
  const storage: ItemRates = {};
  for (const item of reachable)
    if (
      !RAW.includes(item) &&
      !DATA.items[item]?.fluid &&
      !DATA.items[item]?.radioactive &&
      (DATA.items[item]?.sink || 0) > 0 &&
      wantsStorage(item, config.storage)
    )
      storage[item] = storageRateFor(config, item);
  return storage;
}
// Elevator deliveries: the phase's parts spread over its hours (24 for 'minimal', 8 for
// 'balanced', the profile's own for 'timed'). `roundRates` rounds to readable belt rates: to
// tens from 100/min, whole numbers from 10/min, and up to a tenth below that. Rounding to the
// nearest can round a rate down, so `hours` is recomputed from the rates in readStage.
function deliveryDemand({ config, phase }: PhaseContext): Record<string, StageDelivery> {
  const delivery: Record<string, StageDelivery> = {};
  const hours = config.goal === 'minimal' ? 24 : config.goal === 'balanced' ? 8 : config.hours;
  for (const [item, amount] of Object.entries(DELIVERIES[phase]!)) {
    let rate = (amount * config.multiplier) / (hours * 60);
    if (config.roundRates)
      rate =
        rate >= 100
          ? Math.round(rate / 10) * 10
          : rate >= 10
            ? Math.round(rate)
            : Math.ceil(rate * 10) / 10;
    delivery[item] = { target: Math.ceil(amount * config.multiplier), rate };
  }
  return delivery;
}
// A 20% planning allowance covers unmodelled mining, pumps and logistics; existing power is spare capacity.
// Alien Power Augmenters generate 500 MW each and multiply the grid's base production:
// (generators + 500 x augmenters) x (1 + 0.1 x unfueled + 0.3 x fueled). The multiplier applies to
// installed capacity, of which the entered spare power is only a part, so both are needed here.
function phasePower(config: CurrentSettings, phase: number): PhasePower {
  const utilityFactor = 1 + (config.utilityPercent ?? 20) / 100;
  const augmenters = phase === 5 ? config.augmenters : 0,
    fueled = phase === 5 ? config.fueledAugmenters : 0;
  const boost = 0.1 * (augmenters - fueled) + 0.3 * fueled,
    installedMW = config.installedPowerGW * 1000;
  const spareMW =
    config.availablePowerGW * 1000 + (installedMW + 500 * augmenters) * (1 + boost) - installedMW;
  return { utilityFactor, augmenters, fueled, boost, spareMW };
}
// The phase's LP (or MIP), in the order its constraints and variables are added: item balances,
// power, recipe variables with the somersloop budget and caps, raw resources, existing supply,
// the plutonium sink, the goal, then whole nuclear plants. The solver's result can depend on
// that order, so keep it. `period` is the nuclear rounding (see roundNuclear).
function buildModel(
  context: PhaseContext,
  pool: PoolRecipe[],
  demands: PhaseDemands,
): { model: LpModel; period: number } {
  const allItems = new Set(
    pool.flatMap(recipe => [...Object.keys(recipe.inputs), ...Object.keys(recipe.outputs)]),
  );
  Object.keys(demands.demand).forEach(item => allItems.add(item));
  // The objective. Normally minimise `cost`: one per machine-equivalent, plus a tiny power term
  // that breaks ties towards lower consumption. Under `maximum`, maximise `gain`, the goal
  // variable's level, then re-solve for cost (see solveModel).
  const model: LpModel = {
    optimize: context.maximum ? 'gain' : 'cost',
    opType: context.maximum ? 'max' : 'min',
    constraints: {},
    variables: {},
  };
  addBalances(model, allItems, demands.demand);
  addPower(model, context);
  addRecipes(model, context, pool);
  addSources(model, context, allItems, demands.delivery);
  const period = roundNuclear(model, context, pool, demands.demand);
  return { model, period };
}
// One balance constraint per item, 'item:<name>': production minus consumption (including the
// raw, supply and goal variables) must be at least the item's demand. Solids may overshoot;
// the excess is surplus bound for the sink, which is what lets whole machines round up.
// An item the AWESOME Sink cannot accept has nowhere to overflow: Power Shards would back a
// Synthetic Power Shard line up and stall it. Balance those exactly, as fluids and waste are.
function addBalances(model: LpModel, allItems: Set<string>, demand: ItemRates) {
  for (const item of allItems) {
    const equality =
      DATA.items[item]?.fluid ||
      DATA.items[item]?.radioactive ||
      item.endsWith('Waste') ||
      !((DATA.items[item]?.sink ?? 0) > 0);
    model.constraints['item:' + item] = equality
      ? { equal: demand[item] || 0 }
      : { min: demand[item] || 0 };
  }
}
// The power constraint, in MW: consumption (x powerFactor x utility allowance) minus new
// generation (x augmenter boost) may not exceed the spare figure. Phase 1 normally has no power
// constraint (its power is hand-fed biomass). A maximising solve of Phase 1 has it too: there are
// no generators, so only the entered spare power can run that phase harder. calculate() never
// maximises Phase 1 for maximum output; only the `phaseTime: 'final'` re-solve does.
function addPower(model: LpModel, { phase, maximum, power }: PhaseContext) {
  if (phase >= 2 || maximum) model.constraints.power = { max: power.spareMW };
}
// One variable per recipe: its level is machine-equivalents at 100% clock (see
// recipeCoefficients). Then the somersloop budget and, for phaseTime 'final', the caps.
function addRecipes(model: LpModel, context: PhaseContext, pool: PoolRecipe[]) {
  const { config, caps, baseline } = context;
  for (const recipe of pool) {
    const coefficients = recipeCoefficients(recipe, context);
    // At least the requested number of uranium plants (settings.uraniumReactors) when nuclear
    // power is in the pool. Whole machines round them in roundNuclear.
    if (recipe.id === 'power-uranium') {
      coefficients.nuclear = 1;
      model.constraints.nuclear = { min: config.uraniumReactors };
    }
    model.variables[recipe.id] = coefficients;
    // Amplified twins: integer machine counts, each using `slots` somersloops of the budget.
    if (recipe.slots) {
      (model.ints ??= {})[recipe.id] = 1;
      coefficients.sloops = recipe.slots;
      // One amplified machine does the work of two, so a line never wants more than half its
      // unamplified count, and the whole budget cannot buy more than it can pay slots for.
      const need = baseline?.[recipe.id.slice(4)];
      (model.bounds ??= {})[recipe.id] = Math.max(
        1,
        Math.min(
          Math.floor(config.amplifySloops / recipe.slots),
          need === undefined ? 1e9 : Math.ceil(need / 2) + 1,
        ),
      );
    }
    if (config.wholeMachines && roundsToWholeMachines(recipe)) (model.ints ??= {})[recipe.id] = 1;
  }
  // The somersloop budget: amplified machines may together fill no more slots than
  // `amplifySloops`, per phase.
  if (config.amplifySloops > 0) model.constraints.sloops = { max: config.amplifySloops };
  // Caps, for phaseTime 'final': an earlier phase may run no more of a recipe than a later phase
  // already builds, so nothing is added that the plan later drops. Each recipe's equivalent is at
  // most the whole machines built for it in this or a later phase. Every pool recipe gets a cap,
  // so a recipe no such phase uses is capped at 0 — including generators.
  if (caps)
    for (const recipe of pool) {
      const cap = caps[recipe.id] ?? 0;
      model.constraints['cap:' + recipe.id] = { max: cap };
      model.variables[recipe.id]!['cap:' + recipe.id] = 1;
    }
}
// A recipe variable's coefficients: its cost, its power, and its per-machine outputs (+) and
// inputs (-) in each item balance.
function recipeCoefficients(recipe: PoolRecipe, { config, power }: PhaseContext) {
  const coefficients: Record<string, number> = {
    cost: 1 + (recipe.power > 0 ? recipe.power / 100000 : 0),
    power:
      recipe.power < 0
        ? recipe.power * (1 + power.boost)
        : recipe.power * config.powerFactor * power.utilityFactor,
  };
  for (const [item, rate] of Object.entries(recipe.outputs))
    coefficients['item:' + item] = (coefficients['item:' + item] || 0) + rate;
  for (const [item, rate] of Object.entries(recipe.inputs))
    coefficients['item:' + item] = (coefficients['item:' + item] || 0) - rate;
  return coefficients;
}
// Whole-machine rounding: with `wholeMachines`, a recipe is an integer variable when it makes
// a solid, sinkable, non-raw item, so its overshoot can go to the sink. Fluid-only recipes,
// generators and anything nuclear keep fractional clocks, because their balances are exact.
// (Generators have no outputs, and power-uranium outputs waste.) The uranium plants are
// rounded separately, in roundNuclear.
const roundsToWholeMachines = (recipe: PoolRecipe) =>
  Object.keys(recipe.outputs).some(
    item => !DATA.items[item]?.fluid && !RAW.includes(item) && (DATA.items[item]?.sink ?? 0) > 0,
  ) &&
  !/uranium|plutonium|ficsonium|waste|non-fissile/i.test(
    [recipe.name, ...Object.keys(recipe.inputs), ...Object.keys(recipe.outputs)].join(' '),
  );
// The sources that feed the item balances besides the recipes, and the goal that draws on them.
function addSources(
  model: LpModel,
  { config, phase, maximum, ignoreLimits }: PhaseContext,
  allItems: Set<string>,
  delivery: Record<string, StageDelivery>,
) {
  // Raw resources: a 'raw:' source variable per extracted item the pool uses, capped by its
  // budget ('limit:') and almost free, so extraction is spent only where it saves machines.
  // Diagnostics use the highest budget the settings accept; larger bounds destabilize the WASM MIP solver.
  for (const item of RAW) {
    if (!allItems.has(item)) continue;
    model.constraints['limit:' + item] = { max: ignoreLimits ? 1e7 : config.limits[item] };
    model.variables['raw:' + item] = { cost: 0.0001, ['item:' + item]: 1, ['limit:' + item]: 1 };
  }
  // A line you already run is a capped, almost-free source of its product, so the
  // plan builds only the remainder and drops the whole chain behind what you
  // already make. Almost free rather than free: the solver still prefers not to
  // draw supply it has no use for. An item this phase neither makes nor consumes
  // is skipped, because crediting it would mean nothing.
  for (const [item, rate] of Object.entries(config.existingSupply)) {
    if (!allItems.has(item)) continue;
    model.constraints['supply:' + item] = { max: rate };
    model.variables['supply:' + item] = {
      cost: 0.0001,
      ['item:' + item]: 1,
      ['supply:' + item]: 1,
    };
  }
  // Uranium waste must balance exactly, and the 'sink' strategy (and Phase 4 under 'recycle',
  // before plutonium plants exist) ends the waste chain at Plutonium Fuel Rods: this variable
  // disposes of them in the AWESOME Sink. Reported as `plutoniumSink` (rods per minute).
  if (config.nuclear !== 'none' && phase >= 4 && (config.nuclear === 'sink' || phase === 4))
    model.variables['sink-plutonium'] = { cost: 0.0001, 'item:Plutonium Fuel Rod': -1 };
  // Maximum output: the goal variable consumes every delivery part in proportion to its target,
  // at target/1000 per minute per unit of goal, so maximising it maximises the rate at which the
  // whole phase completes together (hours = 1000 / (60 x goal)).
  if (maximum) {
    const goal: Record<string, number> = { gain: 1 };
    for (const [item, part] of Object.entries(delivery)) goal['item:' + item] = -part.target / 1000;
    model.variables.goal = goal;
  }
}
// Whole nuclear plants (#370). Every line downstream of the uranium plants is linear in their
// count, so rounding that count is enough. In Phase 5 under 'recycle' the count is a whole
// multiple of the chain's period (nuclearPeriod), which makes the whole waste chain, plutonium
// and ficsonium plants included, whole machines at 100%: 'nuclear-block' is the number of
// periods. Elsewhere ('sink', and Phase 4 under 'recycle', whose chain ends in the sink) the
// uranium plants are simply whole. Extra plants only add generation, which the power constraint
// allows. The fuel feed stays fractional: its items are radioactive and balance exactly.
// `fractionalNuclear` is the two-step fit's fallback when this does not fit the budgets.
// Returns the period: 0 when the plants stay fractional (or are not in the pool), 1 when they
// are simply whole.
function roundNuclear(
  model: LpModel,
  { config, phase, fractionalNuclear }: PhaseContext,
  pool: PoolRecipe[],
  demand: ItemRates,
): number {
  const uraniumPlants = model.variables['power-uranium'];
  const period =
    config.wholeMachines && !fractionalNuclear && uraniumPlants
      ? config.nuclear === 'recycle' && phase === 5
        ? nuclearPeriod(pool, demand)
        : 1
      : 0;
  if (period > 1 && uraniumPlants) {
    uraniumPlants.nuclearBlock = 1;
    model.variables['nuclear-block'] = { nuclearBlock: -period };
    model.constraints.nuclearBlock = { equal: 0 };
    (model.ints ??= {})['nuclear-block'] = 1;
  } else if (period === 1) (model.ints ??= {})['power-uranium'] = 1;
  return period;
}
// Solve. Under `maximum`, a second solve fixes the goal at its optimum (less a hair for
// numerical slack) and minimises machines, so the fastest plan is also the leanest one.
function solveModel(model: LpModel, maximum: boolean): Solution {
  const solved = solve(model);
  if (!maximum || !solved.feasible) return solved;
  model.constraints.keepGoal = { min: solved.values.goal! * (1 - 1e-8) };
  model.variables.goal!.keepGoal = 1;
  model.optimize = 'cost';
  model.opType = 'min';
  const economical = solve(model);
  return economical.feasible ? economical : solved;
}
// Independently verify material, power and mining constraints before trusting a result.
function satisfiesModel(model: LpModel, solved: Solution): boolean {
  for (const [constraint, bound] of Object.entries(model.constraints)) {
    let total = 0;
    for (const [variable, coefficients] of Object.entries(model.variables))
      total += (solved.values[variable] || 0) * (coefficients[constraint] || 0);
    const tolerance = 0.002 + Math.abs(total) * 1e-6;
    if (
      (bound.min !== undefined && total < bound.min - tolerance) ||
      (bound.max !== undefined && total > bound.max + tolerance) ||
      (bound.equal !== undefined && Math.abs(total - bound.equal) > tolerance)
    )
      return false;
  }
  return true;
}
// Reads the solution back into a stage (see run for its fields).
function readStage(
  context: PhaseContext,
  pool: PoolRecipe[],
  demands: PhaseDemands,
  solved: Solution,
  period: number,
): Solved {
  const { config, maximum, power } = context;
  const { storage, delivery, drone, transport, matrix } = demands;
  const { utilityFactor, augmenters, fueled, boost, spareMW } = power;
  // Under `maximum` the delivery rates are whatever the goal achieved.
  if (maximum)
    for (const part of Object.values(delivery))
      part.rate = ((solved.values.goal || 0) * part.target) / 1000;
  const rows = stageRows(config, pool, solved);
  const supplied = Object.fromEntries(
    Object.entries(config.existingSupply)
      .map(([item]): [string, number] => [item, solved.values['supply:' + item] || 0])
      .filter(([, rate]) => rate > 0.002),
  );
  const raw = Object.fromEntries(RAW.map(item => [item, solved.values['raw:' + item] || 0]));
  // Power totals. The LP balanced power at fractional machine counts; building whole machines at
  // full power can need more, and the difference is reported as additionalHeadroomMW below.
  const peakMW = rows.reduce((total, row) => total + row.peakMW, 0),
    generationMW = rows.reduce((total, row) => total + row.generationMW, 0);
  return {
    feasible: true,
    rows: buildOrder(rows),
    raw,
    supplied,
    storage,
    drone,
    transport,
    delivery,
    surplus: stageSurplus(context, rows, demands),
    plutoniumSink: solved.values['sink-plutonium'] || 0,
    ...(period > 1 ? { nuclearPeriod: period } : {}),
    peakMW,
    generationMW,
    sloopsUsed: rows.reduce((total, row) => total + (row.sloops || 0), 0),
    augmenters,
    fueledAugmenters: fueled,
    boost,
    augmenterMW: 500 * augmenters,
    matrixRate: matrix,
    // New generation with the augmenter boost, plus the spare figure (which already includes the
    // augmenters' 500 MW each and their boost on installed capacity).
    availableMW: generationMW * (1 + boost) + spareMW,
    requiredMW: peakMW * utilityFactor,
    additionalHeadroomMW: Math.max(
      0,
      peakMW * utilityFactor - generationMW * (1 + boost) - spareMW,
    ),
    // The phase takes as long as its slowest delivery (Infinity if a rate is 0).
    hours: Math.max(
      ...Object.values(delivery).map(part => (part.rate ? part.target / part.rate / 60 : Infinity)),
    ),
    // Names of the raw-resource conversion rows (Converter recipes), listed on the Resources page.
    conversions: rows
      .filter(row => Object.keys(row.outputs).some(item => RAW.includes(item) && item !== 'Water'))
      .map(row => row.name),
  };
}
// Rows: every recipe in use. `machines` rounds the equivalent up to buildings, and the last
// one runs underclocked at `lastClock` % (100 for a whole-machine row). Row inputs and outputs
// are the line's totals per minute. peakMW counts whole machines at full power without the
// utility allowance; generationMW is a generator's output at its fractional level.
function stageRows(config: CurrentSettings, pool: PoolRecipe[], solved: Solution): CalcRow[] {
  return pool
    .filter(recipe => (solved.values[recipe.id] || 0) > 1e-6)
    .map((recipe): CalcRow => {
      const equivalent = solved.values[recipe.id]!;
      const machines = Math.ceil(equivalent - 1e-6);
      return {
        ...recipe,
        equivalent,
        machines,
        ...(recipe.slots ? { amplified: true, sloops: recipe.slots * machines } : {}),
        lastClock: Math.max(0, (equivalent - machines + 1) * 100),
        inputs: Object.fromEntries(
          Object.entries(recipe.inputs).map(([item, rate]) => [item, rate * equivalent]),
        ),
        outputs: Object.fromEntries(
          Object.entries(recipe.outputs).map(([item, rate]) => [item, rate * equivalent]),
        ),
        peakMW: recipe.power < 0 ? 0 : machines * recipe.power * config.powerFactor,
        generationMW: recipe.power < 0 ? -recipe.power * equivalent : 0,
      };
    });
}
// Surplus: what the rows make beyond what the rows consume and every demand takes. Only solid,
// sinkable items are listed; fluids, waste and unsinkable items are balanced exactly. `made`
// counts rows only, so an item also drawn from existing supply or a raw budget shows the rows'
// excess over total use, clamped at 0.
function stageSurplus(
  { config, phase }: PhaseContext,
  rows: CalcRow[],
  { storage, delivery, drone, matrix }: PhaseDemands,
): ItemRates {
  const used: ItemRates = {},
    made: ItemRates = {};
  for (const row of rows) {
    for (const [item, rate] of Object.entries(row.inputs)) used[item] = (used[item] || 0) + rate;
    for (const [item, rate] of Object.entries(row.outputs)) made[item] = (made[item] || 0) + rate;
  }
  return Object.fromEntries(
    Object.keys(made)
      .map((item): [string, number] => [
        item,
        Math.max(
          0,
          made[item]! -
            (used[item] || 0) -
            (storage[item] || 0) -
            (delivery[item]?.rate || 0) -
            (drone[item] || 0) -
            (item === 'Singularity Cell' && phase === 5 ? config.cellsPerMinute : 0) -
            (item === 'Alien Power Matrix' ? matrix : 0),
        ),
      ])
      .filter(
        ([item, rate]) =>
          rate > 0.002 &&
          !DATA.items[item]?.radioactive &&
          !DATA.items[item]?.fluid &&
          (DATA.items[item]?.sink ?? 0) > 0,
      ),
  );
}
// Build order: by dependency depth, suppliers before consumers; recycling loops are
// commissioned as a connected group.
function buildOrder(rows: CalcRow[]): CalcRow[] {
  const producers: Record<string, CalcRow[]> = {};
  for (const row of rows)
    for (const item of Object.keys(row.outputs)) (producers[item] ??= []).push(row);
  const seen = new Set<string>(),
    visiting = new Set<string>(),
    ordered: CalcRow[] = [];
  function visit(row: CalcRow) {
    if (seen.has(row.id) || visiting.has(row.id)) return;
    visiting.add(row.id);
    for (const item of Object.keys(row.inputs))
      for (const producer of producers[item] || []) visit(producer);
    visiting.delete(row.id);
    seen.add(row.id);
    ordered.push(row);
  }
  rows.forEach(visit);
  return ordered;
}
// Calculates a whole profile: every phase 1 to 5, whatever phase the profile starts in (the
// interface hides earlier phases; post-game reuses Phase 5). `input` is raw settings, validated by
// settings(); `onPhase(phase)` is called before each phase is solved, which the browser worker
// forwards as progress so its timeout restarts.
//
// Returns { engine, settings, stages: { 1..5: stage }, warnings: [string], createdAt }. A stage is
// run()'s result, or for a phase that does not fit a draft with `feasible: false`, the diagnostic
// solve's rows and a `reason`, plus `shortfalls` [{ name, needed, budget }], `minHours` and
// `wholeMachinesOnly` where they apply (see draftOptions in public/app/views/calculated.ts).
// Stored as `profile.plan` and never recalculated behind the user's back, so a field added here
// must be optional for plans saved by older engines.
//
// Callers: workspace.ts (/api/preview, /api/profiles, /api/round-up), calculator-worker.js in
// the Pages edition (via public/browser-api.ts), and the tests.
export function calculate(
  input: unknown,
  onPhase?: (phase: number) => void,
): CurrentCalculatedPlan {
  const config = settings(input);
  if (config.goal === 'maximum' && !config.limitsConfirmed)
    fail('Confirm your available resource budgets before maximizing output.');
  // Keyed by phase number here; the plan's JSON keys are the StageKey strings.
  const stages: Record<number, CurrentStage> = {};
  const warnings: string[] = [];
  // Solve each phase on its own. SAM conversion: 'allow' offers it to the Phase 5 solve from the
  // start, 'needed' only when Phase 5 does not fit without it, 'avoid' never.
  // Maximum output starts from Phase 2. Phase 1 has no generators and runs on hand-fed biomass:
  // maximising it finds no plan on the default 0 GW of spare power, and without that limit it
  // scales to whatever the raw budgets allow at any power. Phase 1 gets the balanced plan instead.
  for (let phase = 1; phase <= 5; phase++) {
    onPhase?.(phase);
    const maximised = config.goal === 'maximum' && phase >= 2;
    let result = run(
      config.goal === 'maximum' && !maximised ? { ...config, goal: 'balanced' } : config,
      phase,
      {
        maximum: maximised,
        conversion: phase === 5 && config.sam === 'allow',
      },
    );
    if (!result.feasible && phase === 5 && config.sam === 'needed')
      result = run(config, phase, { maximum: config.goal === 'maximum', conversion: true });
    // For maximum output, compare conversion when allowed only at a binding resource limit.
    if (config.goal === 'maximum' && phase === 5 && config.sam === 'needed') {
      const converted = run(config, phase, { maximum: true, conversion: true });
      if (converted.feasible && (!result.feasible || converted.hours < result.hours - 1e-6))
        result = converted;
    }
    // Infeasible phase: build a draft that explains why. The diagnostic is the exact LP with every
    // budget lifted, so its `raw` shows what the goal would need. Three outcomes, in order: the
    // solver timed out (no shortage proven); the recipes and power options cannot make it at all;
    // or it is a budget problem, split into "only whole machines break it" and a real shortfall.
    // The draft only explains what exceeds the budgets: the exact LP is fast and avoids another integer search.
    // The diagnostics solve without production amplification (the owner's choice in #64): the
    // exact LP stays fast and cannot time out on the amplified integer fit, and the reason says
    // the amounts are before amplification when somersloops are budgeted for it.
    if (!result.feasible) {
      const conversion = phase === 5 && config.sam !== 'avoid';
      const plain: CurrentSettings = { ...config, amplifySloops: 0 };
      const diagnostic = run({ ...plain, wholeMachines: false }, phase, {
        conversion,
        ignoreLimits: true,
      });
      const stage: CurrentStage = { ...diagnostic, feasible: false };
      if (result.solverStatus && !/infeasible/i.test(result.solverStatus))
        stage.reason =
          'The whole-machine solver could not finish this combination within its time limit. Try fewer alternates or precise balancing; no resource shortage has been established.';
      else if (!diagnostic.feasible)
        stage.reason =
          'The selected recipe/power options cannot support this combination. Allow alternates or change the goals.';
      else {
        // Does the exact LP fit the real budgets at `hours` hours for this phase?
        const fits = (hours: number) =>
          run({ ...plain, wholeMachines: false, goal: 'timed', hours }, phase, { conversion })
            .feasible;
        const currentHours =
          config.goal === 'minimal' ? 24 : config.goal === 'balanced' ? 8 : config.hours;
        const listNames = (list: string[]) =>
          list.length > 1
            ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1]
            : list[0];
        if (config.goal !== 'maximum' && fits(currentHours)) {
          // Only rounding up to whole machines breaks a budget here. Re-fit the same recipe network with
          // doubled budgets to measure which resources need headroom and how much; keep bounds modest for MIP stability.
          stage.wholeMachinesOnly = true;
          const network = run({ ...plain, wholeMachines: false }, phase, { conversion });
          const rounded: RunResult = network.feasible
            ? run(
                {
                  ...plain,
                  limits: Object.fromEntries(
                    RAW.map(resource => [resource, config.limits[resource]! * 2 + 600]),
                  ),
                },
                phase,
                // Fractional nuclear plants, as the plan itself falls back to: the shortfall
                // is about the solid-part lines.
                {
                  conversion,
                  recipeIds: new Set(network.rows.map(row => row.id)),
                  fractionalNuclear: true,
                },
              )
            : { feasible: false };
          if (rounded.feasible)
            stage.shortfalls = RAW.filter(
              resource => (rounded.raw[resource] || 0) > config.limits[resource]! + 0.001,
            ).map(resource => ({
              name: resource,
              needed: Math.ceil(rounded.raw[resource]!),
              budget: config.limits[resource]!,
            }));
          const names = (stage.shortfalls || []).map(shortfall => shortfall.name);
          stage.reason = names.length
            ? `Precise balancing fits these budgets, but whole solid-part machines at 100% need more ${listNames(names)}. Raise ${names.length > 1 ? 'those budgets' : 'that budget'} a little, or turn off whole-machine production for this profile.`
            : 'Mixed-recipe balancing fits these budgets, but running solid-part machines whole at 100% does not. Add some budget headroom or turn off whole-machine production for this profile.';
        } else {
          stage.shortfalls = RAW.filter(
            resource => (diagnostic.raw[resource] || 0) > config.limits[resource]! + 0.05,
          ).map(resource => ({
            name: resource,
            needed: Math.ceil(diagnostic.raw[resource]!),
            budget: config.limits[resource]!,
          }));
          // The minimal per-phase time is found on the exact LP; whole machines may need slightly more.
          // Bisection between the current hours and the 2,000-hour maximum, to a quarter hour.
          if (config.goal !== 'maximum' && fits(2000)) {
            let low = currentHours,
              high = 2000;
            for (let i = 0; i < 12 && high - low > 0.25; i++) {
              const mid = (low + high) / 2;
              if (fits(mid)) high = mid;
              else low = mid;
            }
            stage.minHours = Math.ceil(high * 4) / 4;
          }
          const names = stage.shortfalls.map(shortfall => shortfall.name);
          stage.reason =
            (names.length
              ? `This phase needs more ${listNames(names)} than the entered budgets provide.`
              : 'The goal exceeds the available resource or power budgets.') +
            (stage.minHours
              ? ` It fits the current budgets at about ${stage.minHours} hours for this phase.`
              : config.goal === 'maximum'
                ? ' Raise those budgets, or reduce the protected storage, drone-fuel and Singularity Cell demands.'
                : ' More time alone will not fit: continuous demands (protected storage, drone fuel, cells and minimum rounded delivery rates) already exceed the budgets.');
        }
        if (config.amplifySloops > 0 && stage.shortfalls?.length)
          stage.reason +=
            ' These amounts are before production amplification; amplified machines may need somewhat less.';
      }
      stages[phase] = stage;
    } else stages[phase] = result;
  }
  // Everything below adjusts the finished stages or adds warnings. Warnings are plain sentences,
  // shown in this order as the profile's assumptions (plan page, Backup page, wizard review).
  // With the target time on the final phase, an earlier phase may run its lines as
  // hard as the machines a later phase already builds allow, so it finishes sooner
  // without adding a building the plan later drops. A phase is never made slower,
  // and nothing is pulled forward past what its own phase can unlock and power.
  if (
    config.phaseTime === 'final' &&
    config.goal !== 'maximum' &&
    Object.values(stages).every(stage => stage.feasible)
  ) {
    // built[phase] = { recipeId: whole machines } as each phase's plan builds it. Phase n's caps
    // are the most machines any phase from n to 5 builds, so running a line harder than its own
    // plan asks never needs a building that is not built anyway. The re-solve maximises output
    // under those caps, and is kept only when it finishes strictly sooner, recording the time it
    // replaces as `aheadOf` (shown by public/app/wizard/wizard.ts).
    const built: Record<number, Record<string, number>> = {};
    for (let phase = 1; phase <= 5; phase++)
      for (const row of stages[phase]!.rows || [])
        built[phase] = { ...built[phase], [row.id]: row.machines };
    for (let phase = 1; phase <= 4; phase++) {
      const caps: Record<string, number> = {};
      for (let later = phase; later <= 5; later++)
        for (const [id, machines] of Object.entries(built[later] || {}))
          caps[id] = Math.max(caps[id] || 0, machines);
      const ahead = run(config, phase, { maximum: true, caps });
      if (ahead.feasible && ahead.hours < stages[phase]!.hours! - 1e-6)
        stages[phase] = { ...ahead, aheadOf: stages[phase]!.hours! };
    }
    const pulled = Object.values(stages).filter(stage => stage.aheadOf !== undefined).length;
    warnings.push(
      pulled
        ? `Your target time applies to Phase 5. Earlier phases run their lines as hard as the machines a later phase already builds allow, so ${pulled === 1 ? 'one phase finishes' : pulled + ' phases finish'} sooner; no building is added that a later phase does not keep. Delivery rates for those phases are not rounded.`
        : 'Your target time applies to Phase 5. No earlier phase could finish sooner within the machines its later phases already build.',
    );
  }
  // Fueling an augmenter buys 20% more grid power in exchange for an Alien Power Matrix line.
  // Whether that pays depends on the plan's own scale, so solve Phase 5 again without the fuel
  // and compare like for like: same goal, same budgets, same recipes.
  if (config.fueledAugmenters && stages[5]?.feasible) {
    const unfueled = (() => {
      const options = { maximum: config.goal === 'maximum' };
      let result = run({ ...config, fueledAugmenters: 0 }, 5, {
        ...options,
        conversion: config.sam === 'allow',
      });
      if (!result.feasible && config.sam !== 'avoid')
        result = run({ ...config, fueledAugmenters: 0 }, 5, { ...options, conversion: true });
      return result;
    })();
    // `fuelVerdict` (rendered by fuelVerdictHtml in public/app/wizard/review.js) compares the
    // fueled plan with the unfueled one: fewer buildings wins, or fewer hours under maximum.
    const count = (stage: Partial<StageResult>) =>
        (stage.rows || []).reduce((total, row) => total + row.machines, 0),
      fueled = stages[5] as Solved;
    stages[5] = {
      ...fueled,
      fuelVerdict: {
        unfueledFeasible: !!unfueled.feasible,
        buildings: count(fueled),
        buildingsUnfueled: unfueled.feasible ? count(unfueled) : null,
        requiredMW: fueled.requiredMW,
        requiredMWUnfueled: unfueled.feasible ? unfueled.requiredMW : null,
        availableMW: fueled.availableMW,
        availableMWUnfueled: unfueled.feasible ? unfueled.availableMW : null,
        hours: fueled.hours,
        hoursUnfueled: unfueled.feasible ? unfueled.hours : null,
        matrixRate: fueled.matrixRate,
        worthIt:
          !unfueled.feasible ||
          (config.goal === 'maximum'
            ? fueled.hours < unfueled.hours - 1e-6
            : count(fueled) < count(unfueled)),
      },
    };
  }
  // Somersloop accounting: each augmenter costs 10, each reserved hand-fed use 1, plus the
  // amplification budget. Warned about, never enforced: the plan is still calculated.
  if (config.augmenters || config.amplifySloops) {
    const committed = 10 * config.augmenters + config.sloopReserved.length + config.amplifySloops;
    if (config.augmenters)
      warnings.push(
        `${config.augmenters} Alien Power Augmenter${config.augmenters > 1 ? 's' : ''}: ${500 * config.augmenters} MW of generation, plus a ${Math.round((0.1 * (config.augmenters - config.fueledAugmenters) + 0.3 * config.fueledAugmenters) * 100)}% multiplier on the Phase 5 grid's base production. That multiplier applies to installed capacity, so it is calculated from the total installed generation in your settings, not from the spare part of it. Augmenters are Phase 5 buildings; earlier phases are planned without them.`,
      );
    if (config.somersloops && committed > config.somersloops)
      warnings.push(
        `This plan commits ${committed} somersloops — 10 per augmenter${config.sloopReserved.length ? `, ${config.sloopReserved.length} reserved for hand-fed lines` : ''}${config.amplifySloops ? `, ${config.amplifySloops} for production amplification` : ''} — but ${config.somersloops} are recorded as available. Collect more, or build fewer augmenters.`,
      );
  }
  // Amplification: the busiest phase's somersloop use, and phases whose fit fell back.
  {
    const used = Math.max(0, ...Object.values(stages).map(stage => stage.sloopsUsed || 0));
    const dropped = Object.entries(stages)
      .filter(([, stage]) => stage.amplificationDropped)
      .map(([phase]) => phase);
    if (config.amplifySloops > 0)
      warnings.push(
        `Production amplification may place up to ${config.amplifySloops} somersloops in each phase's plan, and this plan uses ${used}. Each phase is a self-contained steady state, so that budget is per phase rather than a running total: the somersloops move as you rebuild. Amplified machines are whole machines at 100% — same inputs, double output, four times the power — and the recipe network is chosen before amplification is fitted to it, so the result is not a global optimum over amplified and unamplified recipes together.`,
      );
    if (dropped.length)
      warnings.push(
        `${dropped.length > 1 ? 'Phases' : 'Phase'} ${dropped.join(' and ')} could not fit production amplification within the solver's time limit, so ${dropped.length > 1 ? 'those phases are' : 'that phase is'} planned without it and no somersloops are placed there. A smaller amplification budget usually fits.`,
      );
  }
  // Existing production: which credits some phase drew on, and phases that had to drop them.
  {
    const supplied = [
      ...new Set(Object.values(stages).flatMap(stage => Object.keys(stage.supplied || {}))),
    ].sort();
    const lost = Object.entries(stages)
      .filter(([, stage]) => stage.supplyDropped)
      .map(([phase]) => phase);
    if (supplied.length)
      warnings.push(
        `This plan draws on production you already run: ${supplied.join(', ')}. Those lines are not planned or built again, and the chain behind them is not planned either. Their ore and their power are already spent in your world, so the resource budgets and the spare-power figure must be entered net of them, exactly as for any other existing factory.`,
      );
    if (lost.length)
      warnings.push(
        `${lost.length > 1 ? 'Phases' : 'Phase'} ${lost.join(' and ')} could not be fitted to whole machines while crediting the production you already run, so ${lost.length > 1 ? 'those phases are' : 'that phase is'} planned as if you built all of it yourself. Nothing is lost: the plan is simply the larger one. Precise balancing instead of whole machines usually keeps the credit.`,
      );
  }
  // Vehicle fuel for the factory-group links (#206): what each phase plans for, and fuel a phase
  // cannot make yet, which is left out there.
  {
    const rate = (perMinute: number) => Math.round(perMinute * 100) / 100;
    const planned = Object.entries(config.transportFuel) as [StageKey, ItemRates][];
    if (planned.length)
      warnings.push(
        `Fuel for the vehicles on your factory-group links is planned as extra demand: ${planned
          .map(
            ([phase, fuels]) =>
              `Phase ${phase} ${Object.entries(fuels)
                .map(([fuel, perMinute]) => `${rate(perMinute)} ${fuel}/min`)
                .join(', ')}`,
          )
          .join(
            '; ',
          )}. It comes from the previous revision's links, as if the vehicles never stop; the fuel chain adds a little traffic of its own, so recalculating again can raise it slightly.`,
      );
    const missing = planned.flatMap(([phase, fuels]) =>
      Object.keys(fuels)
        .filter(fuel => stages[phase]?.feasible && !stages[phase]?.transport?.[fuel])
        .map(fuel => `${fuel} in Phase ${phase}`),
    );
    if (missing.length)
      warnings.push(
        `This plan cannot make ${missing.join(', ')} yet, so that vehicle fuel is left out there. Pick a fuel the phase can make, or plan the vehicles for a later phase.`,
      );
  }
  if (config.fueledAugmenters)
    warnings.push(
      `Fuel for ${config.fueledAugmenters} augmenter${config.fueledAugmenters > 1 ? 's' : ''} adds ${5 * config.fueledAugmenters} Alien Power Matrix/min to Phase 5, with the Quantum Encoder chain behind it. That rate is derived from the augmenter count, never entered separately.`,
    );
  // Unsinkable solid outputs (Power Shards today), which are balanced exactly, not rounded.
  {
    const stuck = [
      ...new Set(
        Object.values(stages)
          .flatMap(stage => (stage.rows || []).flatMap(row => Object.keys(row.outputs)))
          .filter(
            item =>
              !DATA.items[item]?.fluid &&
              !DATA.items[item]?.radioactive &&
              !item.endsWith('Waste') &&
              !RAW.includes(item) &&
              !((DATA.items[item]?.sink ?? 0) > 0),
          ),
      ),
    ];
    if (stuck.length)
      warnings.push(
        `${stuck.join(' and ')} cannot be sent to the AWESOME Sink, so ${stuck.length > 1 ? 'those lines are' : 'that line is'} balanced exactly instead of run whole at 100%: the last machine is underclocked and nothing is left over to back the line up.`,
      );
  }
  if (config.distribution !== 'original' || config.purity === 'custom')
    warnings.push(
      'Seed-dependent distribution: confirm resource-rich node counts, mixed purity and well totals against your save. Zero budgets mean unallocated resources.',
    );
  if (!config.limitsConfirmed)
    warnings.push(
      'Resource budgets are provisional. Confirm available extraction after reserving resources for existing factories.',
    );
  warnings.push(
    'Phase targets assume that phase’s milestones and required MAM research are unlocked. Gathered items, buildings and equipment are not continuously automated.',
  );
  warnings.push(
    `Power includes new generators and their fuel chains, with a ${config.utilityPercent}% allowance for trains, drone ports, mining and pumps. Existing plants are represented only by spare capacity; subtract their fuel from available resources. Drone fuel is a separate protected supply contract, not a route-consumption estimate.`,
  );
  // Whole machines, and how the nuclear plants were rounded (#370).
  if (config.wholeMachines) {
    const period = stages[5]?.nuclearPeriod;
    warnings.push(
      'Solid-part production uses whole machines at 100%. Surplus goes to storage then the sink. Recipe choices are selected first; the result is not a global mixed-recipe integer optimum. Fluid and power balancing can retain fractional clocks.',
    );
    if (config.nuclear !== 'none')
      warnings.push(
        'Uranium-fuelled Nuclear Power Plants are whole buildings wherever the budgets allow' +
          (period
            ? `. In Phase 5, which recycles the waste, they come in multiples of ${period}, so every line of the waste chain there, the plutonium and ficsonium plants included, also runs whole at 100%; the extra plants only add generation. Other nuclear fuel and waste lines balance exactly and can retain fractional clocks.`
            : '. Their fuel and waste lines balance exactly and can retain fractional clocks.'),
      );
    const fractional = Object.entries(stages)
      .filter(([, stage]) => stage.nuclearFractional)
      .map(([phase]) => phase);
    if (fractional.length)
      warnings.push(
        `${fractional.length > 1 ? 'Phases' : 'Phase'} ${fractional.join(' and ')} could not fit whole Nuclear Power Plants within the resource budgets, so ${fractional.length > 1 ? 'those phases keep' : 'that phase keeps'} a fractional uranium plant count, and ${fractional.length > 1 ? 'their' : 'its'} waste chain fractional clocks, as precise balancing would. A little more uranium or water budget usually lets it round.`,
      );
  }
  warnings.push(
    'Maximum output optimizes elevator completion within the entered budgets and allowed recipes; it is not an unrestricted global game optimum.',
  );
  if (config.modNotes)
    warnings.push(
      'Mod notes are recorded only. Changed recipes, output boosts and modded items are not simulated.',
    );
  return {
    engine: ENGINE,
    settings: config,
    stages: stages as Record<StageKey, CurrentStage>,
    warnings,
    createdAt: new Date().toISOString(),
  };
}
// Static data the interface needs before any calculation: recipe lists for the wizard's
// alternate picker, storage, supply and raw-resource options, default budgets and goal labels.
// The Docker edition sends it with the session summary (workspace.ts); build.ts writes it to
// catalog.json for the Pages edition, which public/browser-api.ts loads. The UI reads it as
// `workspace.catalog`.
export const catalog = (): Catalog => ({
  engine: ENGINE,
  alternates: DATA.recipes
    .filter(r => r.alternate && r.phase <= 5)
    .map(recipe => ({
      id: recipe.id,
      name: recipe.name.replace('Alternate: ', ''),
      phase: recipe.phase,
      machine: recipe.machine,
      inputs: recipe.inputs,
      outputs: recipe.outputs,
      ...(MAM_RECIPES.includes(recipe.id) ? { mam: true } : {}),
      ...(pureNames.includes(recipe.name) ? { pure: true } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name)),
  standardRecipes: DATA.recipes
    .filter(r => !r.alternate)
    .map(recipe => ({
      id: recipe.id,
      name: recipe.name,
      phase: recipe.phase,
      machine: recipe.machine,
      inputs: recipe.inputs,
      outputs: recipe.outputs,
    })),
  storageOptions,
  supplyItems: [
    ...new Set(DATA.recipes.filter(r => r.phase <= 5).flatMap(r => Object.keys(r.outputs))),
  ]
    .filter(item => !RAW.includes(item) && !!DATA.items[item])
    .sort((a, b) => a.localeCompare(b)),
  containerItems: CONTAINER_ITEMS,
  storageItems: Object.keys(DATA.items)
    .filter(storable)
    .map(name => ({
      name,
      build: constructionItems.includes(name),
      delivered: elevatorParts.includes(name),
    }))
    .sort((a, b) => Number(b.build) - Number(a.build) || a.name.localeCompare(b.name)),
  distributions,
  purities,
  powerOptions,
  sloopUses: SLOOP_USES,
  raw: RAW,
  limits: DEFAULT_LIMITS,
  pureLimits: PURE_LIMITS,
  stacks: Object.fromEntries(
    Object.entries(DATA.items)
      .filter(([, item]) => !item.fluid)
      .map(([name, item]) => [name, item.stack]),
  ),
  // A fluid's packaged form, from the standard Packager recipe that takes it in: the item and
  // the m³ of fluid one item holds (4 for nitrogen gas, 1 for the others).
  packaged: Object.fromEntries(
    DATA.recipes
      .filter(r => r.machine === 'Packager' && !r.alternate)
      .flatMap(recipe => {
        const fluid = Object.keys(recipe.inputs).find(name => DATA.items[name]?.fluid);
        const item = Object.keys(recipe.outputs).find(name => !DATA.items[name]?.fluid);
        return fluid && item && Object.keys(recipe.outputs).length === 1
          ? [[fluid, { item, m3: recipe.inputs[fluid]! / recipe.outputs[item]! }]]
          : [];
      }),
  ),
  vehicleFuels: vehicleFuels.map(name => ({ name, mj: DATA.items[name]?.energy || 0 })),
  goals: [
    {
      id: 'minimal',
      name: 'Minimal construction',
      description: '24-hour deliveries; minimize production-building equivalents.',
    },
    {
      id: 'balanced',
      name: 'Balanced progression',
      description: '8-hour deliveries with the selected storage and recipe preferences.',
    },
    {
      id: 'timed',
      name: 'Target completion time',
      description: 'Calculate rates from your chosen hours per phase.',
    },
    {
      id: 'maximum',
      name: 'Maximum elevator output',
      description: 'Fastest simultaneous delivery within confirmed resource budgets.',
    },
  ],
});

// Hard-drive payoff (#67): for each alternate recipe the profile does not allow yet, calculate
// the plan again with it allowed and compare one phase with the profile's own plan. `input` is
// the profile's settings (normalised by settings() like calculate's). Candidates are the
// alternates available by `phase` that the recipe setting leaves out: every one for 'standard'
// (the two MAM recipes it already has aside), the unticked ones for 'custom', none for 'all';
// the pure ingot alternates are skipped while `pureIngots` brings them in anyway. Each trial runs
// under recipes: 'custom' with the owned list plus the candidate, so nothing else changes.
// A trial that throws or does not fit is reported, not thrown. `onProgress(done, total)` runs
// after each trial; past `budgetMs` the rest are skipped and `stopped` is set.
export function rankAlternates(
  input: unknown,
  {
    phase,
    onProgress,
    budgetMs = Infinity,
  }: { phase: StageKey; onProgress?: (done: number, total: number) => void; budgetMs?: number },
): AlternateRanking {
  const started = Date.now();
  const config = settings(input);
  const owned =
    config.recipes === 'custom'
      ? config.alternateRecipes
      : config.recipes === 'standard'
        ? MAM_RECIPES
        : null;
  const phaseNumber = Number(phase);
  const candidates = owned
    ? DATA.recipes.filter(
        recipe =>
          recipe.alternate &&
          recipe.phase <= phaseNumber &&
          !owned.includes(recipe.id) &&
          !(config.pureIngots && pureNames.includes(recipe.name)),
      )
    : [];
  const figures = (stage: CurrentStage | undefined): PhaseFigures | null =>
    stage?.feasible && stage.rows
      ? {
          buildings: stage.rows.reduce((total, row) => total + row.machines, 0),
          rawTotal: Object.values(stage.raw || {}).reduce((total, rate) => total + rate, 0),
          requiredMW: stage.requiredMW || 0,
          hours: Number.isFinite(stage.hours) ? stage.hours! : null,
        }
      : null;
  const baseStage = calculate(config).stages[phase];
  const base = figures(baseStage);
  if (!base) fail('This phase has no plan to compare alternates against.');
  const list: AlternatePayoff[] = [];
  let stopped = false;
  for (const candidate of candidates) {
    if (Date.now() - started > budgetMs) {
      stopped = true;
      break;
    }
    const entry: AlternatePayoff = {
      id: candidate.id,
      name: candidate.name.replace('Alternate: ', ''),
      machine: candidate.machine,
      phase: candidate.phase,
      status: 'same',
      buildings: 0,
      raw: {},
      rawTotal: 0,
      powerMW: 0,
      hours: 0,
    };
    try {
      const trial = calculate({
        ...config,
        recipes: 'custom',
        alternateRecipes: [...owned!, candidate.id],
        // A preferred list only counts under 'custom'. A standard profile can still carry one
        // from when it was custom; the trial would force it where the base plan ignores it (#185).
        preferredRecipes: config.recipes === 'custom' ? config.preferredRecipes : [],
      }).stages[phase];
      const trialFigures = figures(trial);
      if (!trialFigures) {
        entry.status = 'infeasible';
        entry.error = trial?.reason;
      } else {
        entry.buildings = trialFigures.buildings - base.buildings;
        entry.rawTotal = trialFigures.rawTotal - base.rawTotal;
        entry.powerMW = trialFigures.requiredMW - base.requiredMW;
        entry.hours =
          trialFigures.hours === null || base.hours === null
            ? null
            : trialFigures.hours - base.hours;
        for (const resource of new Set([
          ...Object.keys(trial!.raw || {}),
          ...Object.keys(baseStage!.raw || {}),
        ])) {
          const difference = (trial!.raw?.[resource] || 0) - (baseStage!.raw?.[resource] || 0);
          if (Math.abs(difference) > 1e-6) entry.raw[resource] = difference;
        }
        // Better or worse on buildings, raw and hours together; 'mixed' when they disagree.
        const signs = [entry.buildings, entry.rawTotal, entry.hours ?? 0].map(difference =>
          Math.abs(difference) < 1e-6 ? 0 : Math.sign(difference),
        );
        entry.status = signs.every(sign => sign === 0)
          ? 'same'
          : signs.every(sign => sign <= 0)
            ? 'better'
            : signs.every(sign => sign >= 0)
              ? 'worse'
              : 'mixed';
      }
    } catch (error) {
      entry.status = 'error';
      entry.error = (error as Error).message;
    }
    list.push(entry);
    onProgress?.(list.length, candidates.length);
  }
  return {
    phase,
    base,
    candidates: list,
    total: candidates.length,
    stopped,
    elapsedMs: Date.now() - started,
  };
}
