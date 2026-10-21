// Power and fuel choices: the preferred main power, the generators a player may already have,
// what a vehicle on a factory-group link burns, and the drone fuel supply.
import type {
  Choice,
  CurrentSettings,
  ItemRates,
  OwnedGeneratorMachine,
  OwnedGenerators,
} from '../types/index.ts';

// The settings droneSupply reads: normalised (planner.ts) or a draft.
type DroneSettings = Pick<
  Partial<CurrentSettings>,
  'droneFuel' | 'droneFuelRate' | 'droneBridgeRate'
>;
// [value, label] pairs for the preferred main power (`settings.mainPower`); progression.ts turns
// the choice into a "power before the next production block" step.
export const powerOptions: Choice[] = [
  ['auto', 'Let the planner choose'],
  ['coal', 'Coal'],
  ['nuclear', 'Nuclear (turbofuel bridge)'],
  ['fuel', 'Fuel'],
  ['turbofuel', 'Turbofuel'],
  ['rocket', 'Rocket fuel'],
  ['turbofuel-nuclear', 'Turbofuel + nuclear'],
  ['rocket-nuclear', 'Rocket fuel + nuclear'],
];
// The two MAM recipes a turbofuel power route needs, Turbofuel and Compacted Coal: a main power
// other than auto, coal and fuel burns turbofuel (powerNeedsTurbofuel in planner/data.ts), so
// settings() adds them to a custom pick list and the alternate picker shows them locked on. The
// other MAM recipes (MAM_RECIPES there: Polyester Fabric, #1044) stay ordinary picks.
export const turbofuelRecipes: readonly string[] = [
  'Recipe_Alternate_Turbofuel_C',
  'Recipe_Alternate_EnrichedCoal_C',
];

// The generators a player may already have (#1068, settings.ownedGenerators, "Generators you
// already have" on All settings step 4 and the guided start): the building, which is its key in
// the setting and its `machine` in the plan's rows and grid; the phase whose milestones unlock it,
// by the mapping the milestones use (Biomass Burner with HUB Upgrade 6, Coal Power in Tier 3,
// Petroleum Power in Tier 5, Nuclear Power in Tier 8); and one's output in MW at 100%. The plan
// counts them as generators of its own generator lines in that building (carryGenerators in
// public/power.ts), whose fuel stays in the budgets. Biomass Burners are hand-fed and outside the
// model, so they only change the build plan's burner bank. Geothermal Generators burn nothing and
// are left out: what they give is spare power. The names are saved data: add, but do not rename.
export const OWNED_GENERATORS: readonly {
  machine: OwnedGeneratorMachine;
  phase: number;
  mw: number;
}[] = [
  { machine: 'Biomass Burner', phase: 1, mw: 30 },
  { machine: 'Coal Generator', phase: 2, mw: 75 },
  { machine: 'Fuel Generator', phase: 3, mw: 250 },
  { machine: 'Nuclear Power Plant', phase: 4, mw: 2500 },
];
// The most of one kind the setting keeps.
export const OWNED_GENERATORS_MAX = 10000;

// What a Biomass Burner burns by hand (#1204, the burner bank's fuel totals in the build plan): the
// fuels the bank can run on, each with its energy in MJ and its stack size, as recipes.json
// `items` has them (a test keeps them equal). A burner draws BURNER_MW at full load, the 30 MW
// OWNED_GENERATORS has for it.
export const BURNER_MW = 30;
export const BURNER_FUELS: readonly { name: string; mj: number; stack: number }[] = [
  { name: 'Leaves', mj: 15, stack: 500 },
  { name: 'Wood', mj: 100, stack: 200 },
  { name: 'Mycelia', mj: 20, stack: 200 },
  { name: 'Biomass', mj: 180, stack: 200 },
  { name: 'Solid Biofuel', mj: 450, stack: 200 },
];

// The generators a player already has, normalised (#1068): only the known kinds, each a whole
// count from 1 to OWNED_GENERATORS_MAX, in OWNED_GENERATORS' order, so equal choices give equal
// settings. Anything else is dropped; null for none. settings() in planner/settings.ts stores it
// and the wizard reads its fields through it.
export function ownedGeneratorCounts(value: unknown): OwnedGenerators | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const counts: OwnedGenerators = {};
  for (const { machine } of OWNED_GENERATORS) {
    const count = (value as Record<string, unknown>)[machine];
    if (
      typeof count === 'number' &&
      Number.isInteger(count) &&
      count > 0 &&
      count <= OWNED_GENERATORS_MAX
    )
      counts[machine] = count;
  }
  return Object.keys(counts).length ? counts : null;
}

// The vehicle fuels added after the first ones (#1165): Packaged Oil, Packaged Heavy Oil Residue,
// Battery and Petroleum Coke. A link burning one is state version 17, since a release before them
// refuses the fuel as malformed (validateState in state/validate.ts).
export const laterVehicleFuels: readonly string[] = [
  'Packaged Oil',
  'Packaged Heavy Oil Residue',
  'Battery',
  'Petroleum Coke',
];
// What a truck, tractor or explorer on a factory-group link can burn (#205, #1165): the solid and
// packaged fuels a vehicle's fuel slot takes, in menu order; their energy is the game data's
// (catalog().vehicleFuels). Stored per link in factoryGroups.links, so the names are saved data:
// add, but do not rename, and give an added fuel a state version, as laterVehicleFuels has.
export const vehicleFuels: string[] = [
  'Packaged Fuel',
  'Packaged Turbofuel',
  'Packaged Rocket Fuel',
  'Packaged Ionized Fuel',
  'Packaged Liquid Biofuel',
  'Packaged Oil',
  'Packaged Heavy Oil Residue',
  'Battery',
  'Coal',
  'Compacted Coal',
  'Petroleum Coke',
  'Solid Biofuel',
];

// Drone fuel choices (`settings.droneFuel`); 'none' plans no dedicated drone fuel supply.
export const droneFuels: string[] = [
  'none',
  'Battery',
  'Packaged Fuel',
  'Packaged Turbofuel',
  'Packaged Rocket Fuel',
  'Packaged Ionized Fuel',
  'Uranium Fuel Rod',
  'Plutonium Fuel Rod',
];
// The protected drone fuel line planner.ts adds to a phase, as { item: items/min }. None
// before Phase 4. With ionized fuel chosen, Phase 4 supplies batteries instead (the bridge).
export function droneSupply(settings: DroneSettings, phase: number): ItemRates {
  if (phase < 4 || !settings.droneFuel || settings.droneFuel === 'none') return {};
  const bridge = phase === 4 && settings.droneFuel === 'Packaged Ionized Fuel';
  return {
    [bridge ? 'Battery' : settings.droneFuel]: bridge
      ? (settings.droneBridgeRate ?? 10)
      : (settings.droneFuelRate ?? 10),
  };
}
