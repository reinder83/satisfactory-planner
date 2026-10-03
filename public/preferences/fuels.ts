// Power and fuel choices: the preferred main power, what a vehicle on a factory-group link
// burns, and the drone fuel supply.
import type { Choice, CurrentSettings, ItemRates } from '../types/index.ts';

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

// What a truck, tractor or explorer on a factory-group link can burn (#205): the solid and
// packaged fuels a vehicle's fuel slot takes. Stored per link in factoryGroups.links, so the
// names are saved data: add, but do not rename.
export const vehicleFuels: string[] = [
  'Packaged Fuel',
  'Packaged Turbofuel',
  'Packaged Rocket Fuel',
  'Packaged Ionized Fuel',
  'Packaged Liquid Biofuel',
  'Coal',
  'Compacted Coal',
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
