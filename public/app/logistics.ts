// Vehicle transport on a link between factory groups (#205, part 2 of #68): the user picks the
// vehicle and says how long one round trip takes, since the planner knows no distances; this
// works out how many vehicles carry the link's items and what they burn. The choice is saved
// per link in factoryGroups.links (state.ts); the flows come from group-links.ts.
import type { Catalog, LinkMode, LinkTransport } from '../types/index.ts';

// Vehicle figures from the SatisfactoryTools dataset at the revision recorded in recipes.json:
// inventory slots from each vehicle's description (the Freight Car's 32 slots or 1,600 m³), and
// burnMW from its metadata powerConsumption, the fuel energy it uses while driving. A train is
// electric (the Electric Locomotive draws 25-110 MW from the grid while moving) and a drone's
// fuel depends on the distance flown, so neither has a burn figure here.
export const VEHICLES: Record<LinkMode, { name: string; slots: number; burnMW: number }> = {
  truck: { name: 'Truck', slots: 48, burnMW: 75 },
  tractor: { name: 'Tractor', slots: 25, burnMW: 55 },
  explorer: { name: 'Explorer', slots: 12, burnMW: 90 },
  train: { name: 'Freight train', slots: 32, burnMW: 0 },
  drone: { name: 'Drone', slots: 9, burnMW: 0 },
};
// What one Fluid Freight Car holds, in m³.
export const FLUID_CAR_M3 = 1600;
// The choices a link offers, in menu order; 'belt' is the default belt or pipe.
export const LINK_MODES: ['belt' | LinkMode, string][] = [
  ['belt', 'Belt or pipe'],
  ['truck', 'Truck'],
  ['tractor', 'Tractor'],
  ['explorer', 'Explorer'],
  ['train', 'Train'],
  ['drone', 'Drone'],
];

export interface LinkLoad {
  // Vehicles on the link (trucks, tractors, explorers or drones), or 1 train.
  vehicles: number;
  // Inventory slots one vehicle fills per trip, of `slots`. For a train: freight cars.
  slotsUsed: number;
  slots: number;
  // A train's cars: for solid items (32 slots each) and one per fluid per 1,600 m³.
  freightCars: number;
  fluidCars: number;
  // Fuel items burned per minute by all the link's vehicles if they drive all the time (an
  // upper bound: a vehicle waiting at a station burns nothing). 0 when nothing burns.
  fuelPerMin: number;
  // Fluids a truck, tractor, explorer or drone cannot carry: no packaged form.
  unpackable: string[];
}

// The load for items [{ item, rate }] (items/min, or m³/min for a fluid) on transport `t`.
// Road vehicles and drones carry fluids packaged (catalog.packaged: the item and the m³ one
// holds); a slot holds one item type, so every item takes whole slots, and the vehicle count is
// the smallest that fits each vehicle's share of a round trip's load into its slots.
export function linkLoad(
  items: { item: string; rate: number }[],
  t: LinkTransport,
  catalog: Pick<Catalog, 'stacks' | 'packaged' | 'vehicleFuels'>,
  fluids: Set<string>,
): LinkLoad {
  const v = VEHICLES[t.mode],
    trip = t.roundTripMin;
  const load: LinkLoad = {
    vehicles: 0,
    slotsUsed: 0,
    slots: v.slots,
    freightCars: 0,
    fluidCars: 0,
    fuelPerMin: 0,
    unpackable: [],
  };
  // [amount per round trip, amount per slot] for each item a slot can hold.
  const perTrip: [number, number][] = [];
  for (const { item, rate } of items) {
    if (rate <= 0) continue;
    const fluid = fluids.has(item);
    if (t.mode === 'train' && fluid) {
      load.fluidCars += Math.ceil((rate * trip) / FLUID_CAR_M3);
      continue;
    }
    const pack = fluid ? catalog.packaged?.[item] : undefined;
    if (fluid && !pack) {
      load.unpackable.push(item);
      continue;
    }
    // A packaged fluid fills a slot with its package's stack of m³.
    const perSlot = pack
      ? (catalog.stacks?.[pack.item] || 100) * pack.m3
      : catalog.stacks?.[item] || 100;
    perTrip.push([rate * trip, perSlot]);
  }
  const slotsFor = (n: number) => perTrip.reduce((t, [q, s]) => t + Math.ceil(q / n / s), 0);
  if (t.mode === 'train') {
    const slots = slotsFor(1);
    load.freightCars = Math.ceil(slots / v.slots);
    load.vehicles = load.freightCars + load.fluidCars ? 1 : 0;
    load.slotsUsed = slots;
    load.slots = load.freightCars * v.slots;
    return load;
  }
  if (!perTrip.length) return load;
  if (perTrip.length <= v.slots) {
    // Mixed loads: every vehicle carries its share of each item. The slots a vehicle needs
    // only fall as vehicles are added, so counting up from the bound without whole slots
    // finds the fewest that fit.
    let n = Math.max(1, Math.ceil(perTrip.reduce((t, [q, s]) => t + q / s, 0) / v.slots));
    while (slotsFor(n) > v.slots) n++;
    load.vehicles = n;
    load.slotsUsed = slotsFor(n);
  } else {
    // More item types than slots: each item gets vehicles of its own.
    load.vehicles = perTrip.reduce((t, [q, s]) => t + Math.ceil(q / s / v.slots), 0);
    load.slotsUsed = v.slots;
  }
  const n = load.vehicles;
  const mj = catalog.vehicleFuels?.find(f => f.name === t.fuel)?.mj || 0;
  if (v.burnMW && mj) load.fuelPerMin = (n * v.burnMW * 60) / mj;
  return load;
}
