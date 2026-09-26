// Vehicle transport on a link between factory groups (#205, part 2 of #68): the user picks the
// vehicle and says how long one round trip takes, since the planner knows no distances; this
// works out how many vehicles carry the link's items and what they burn. The choice is saved
// per link in factoryGroups.links (state.ts); the flows come from group-links.ts.
import { groupLinks } from './group-links.ts';
import type {
  Catalog,
  FactoryGroups,
  ItemRates,
  LinkMode,
  LinkTransport,
  StageKey,
  StoredCalculatedPlan,
} from '../types/index.ts';

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
// Freight cars per Electric Locomotive (#232): the owner's rule of thumb of one locomotive per
// four cars. The wiki's Freight Car weight table has one locomotive pulling 5 fully loaded cars
// up the steepest buildable incline (2 m ramps) and 13 up 1 m ramps, so four leaves a margin.
export const CARS_PER_LOCOMOTIVE = 4;
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
  // A train's cars: for solid items (32 slots each) and one per fluid per 1,600 m³, or more when
  // the flow needs them (#232): a car is loaded and unloaded at no more than one belt (or pipe)
  // of the best mark unlocked, so a flow of several belts needs a car per belt.
  freightCars: number;
  fluidCars: number;
  // Whether the belt limit set the freight cars, or the pipe limit a fluid's cars, rather than
  // their capacity.
  beltLimited: boolean;
  pipeLimited: boolean;
  // A train's locomotives: one per CARS_PER_LOCOMOTIVE cars.
  locomotives: number;
  // Fuel items burned per minute by all the link's vehicles if they drive all the time (an
  // upper bound: a vehicle waiting at a station burns nothing). 0 when nothing burns.
  fuelPerMin: number;
  // Fluids a truck, tractor, explorer or drone cannot carry: no packaged form.
  unpackable: string[];
}

// The load for items [{ item, rate }] (items/min, or m³/min for a fluid) on transport `t`.
// Road vehicles and drones carry fluids packaged (catalog.packaged: the item and the m³ one
// holds); a slot holds one item type, so every item takes whole slots, and the vehicle count is
// the smallest that fits each vehicle's share of a round trip's load into its slots. `lanes` is
// the best belt (items/min) and pipe (m³/min) unlocked, which cap what one freight car moves.
export function linkLoad(
  items: { item: string; rate: number }[],
  t: LinkTransport,
  catalog: Pick<Catalog, 'stacks' | 'packaged' | 'vehicleFuels'>,
  fluids: Set<string>,
  lanes?: { belt: number; pipe: number },
): LinkLoad {
  const v = VEHICLES[t.mode],
    trip = t.roundTripMin;
  const load: LinkLoad = {
    vehicles: 0,
    slotsUsed: 0,
    slots: v.slots,
    freightCars: 0,
    fluidCars: 0,
    beltLimited: false,
    pipeLimited: false,
    locomotives: 0,
    fuelPerMin: 0,
    unpackable: [],
  };
  // [amount per round trip, amount per slot] for each item a slot can hold.
  const perTrip: [number, number][] = [];
  let solidRate = 0;
  for (const { item, rate } of items) {
    if (rate <= 0) continue;
    const fluid = fluids.has(item);
    if (t.mode === 'train' && fluid) {
      const held = Math.ceil((rate * trip) / FLUID_CAR_M3),
        piped = lanes ? Math.ceil(rate / lanes.pipe - 1e-9) : 0;
      load.fluidCars += Math.max(held, piped);
      if (piped > held) load.pipeLimited = true;
      continue;
    }
    if (!fluid) solidRate += rate;
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
    const slots = slotsFor(1),
      held = Math.ceil(slots / v.slots),
      belted = lanes && perTrip.length ? Math.ceil(solidRate / lanes.belt - 1e-9) : 0;
    load.freightCars = Math.max(held, belted);
    if (belted > held) load.beltLimited = true;
    const cars = load.freightCars + load.fluidCars;
    load.vehicles = cars ? 1 : 0;
    load.locomotives = cars ? Math.ceil(cars / CARS_PER_LOCOMOTIVE) : 0;
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

// The fuel the links' vehicles burn in each phase of a plan, from the profile's start phase on
// (#206): { phase: { fuel: rate/min } }, rounded up to hundredths. "Recalculate with transport
// fuel" hands this to the planner as settings.transportFuel. Phases without fuel are left out.
export function transportFuel(
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages'>,
  groups: FactoryGroups,
  catalog: Pick<Catalog, 'stacks' | 'packaged' | 'vehicleFuels'>,
  fluids: Set<string>,
): Partial<Record<StageKey, ItemRates>> {
  const out: Partial<Record<StageKey, ItemRates>> = {};
  if (!groups.links) return out;
  for (const [phase, stage] of Object.entries(plan.stages) as [
    StageKey,
    (typeof plan.stages)[StageKey],
  ][]) {
    if (Number(phase) < Number(plan.settings.phase || 1) || !stage.rows?.length) continue;
    const fuels: ItemRates = {};
    for (const l of groupLinks(stage, groups)) {
      const t = groups.links[l.from + ':' + l.to];
      if (!t?.fuel) continue;
      const burn = linkLoad(l.items, t, catalog, fluids).fuelPerMin;
      if (burn > 0) fuels[t.fuel] = (fuels[t.fuel] || 0) + burn;
    }
    for (const n of Object.keys(fuels)) fuels[n] = Math.ceil(fuels[n]! * 100 - 1e-9) / 100;
    if (Object.keys(fuels).length) out[phase] = fuels;
  }
  return out;
}
