// Vehicle transport on a link between factory groups (#205, part 2 of #68): the user picks the
// vehicle and says how long one round trip takes, since the planner knows no distances; this
// works out how many vehicles carry the link's items and what they burn. The choice is saved
// per link in factoryGroups.links (state.ts); the flows come from group-links.ts.
import { fuelledModes } from '../state.ts';
import { num, plural } from './format.ts';
import { groupLinks, isSource, linkTransportFor, MINES } from './group-links.ts';
import type {
  Catalog,
  FactoryGroups,
  ItemRates,
  LinkMode,
  LinkTransport,
  OnSiteSettings,
  StageKey,
  StoredCalculatedPlan,
  UpdateOp,
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

// The load for items [{ item, rate }] (items/min, or m³/min for a fluid) on `transport`.
// Road vehicles and drones carry fluids packaged (catalog.packaged: the item and the m³ one
// holds); a slot holds one item type, so every item takes whole slots, and the vehicle count is
// the smallest that fits each vehicle's share of a round trip's load into its slots. `lanes` is
// the best belt (items/min) and pipe (m³/min) unlocked, which cap what one freight car moves.
export function linkLoad(
  items: { item: string; rate: number }[],
  transport: LinkTransport,
  catalog: Pick<Catalog, 'stacks' | 'packaged' | 'vehicleFuels'>,
  fluids: Set<string>,
  lanes?: { belt: number; pipe: number },
): LinkLoad {
  const vehicle = VEHICLES[transport.mode],
    trip = transport.roundTripMin;
  const load: LinkLoad = {
    vehicles: 0,
    slotsUsed: 0,
    slots: vehicle.slots,
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
    if (transport.mode === 'train' && fluid) {
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
  const slotsFor = (vehicleCount: number) =>
    perTrip.reduce((sum, [amount, perSlot]) => sum + Math.ceil(amount / vehicleCount / perSlot), 0);
  if (transport.mode === 'train') {
    const slots = slotsFor(1),
      held = Math.ceil(slots / vehicle.slots),
      belted = lanes && perTrip.length ? Math.ceil(solidRate / lanes.belt - 1e-9) : 0;
    load.freightCars = Math.max(held, belted);
    if (belted > held) load.beltLimited = true;
    const cars = load.freightCars + load.fluidCars;
    load.vehicles = cars ? 1 : 0;
    load.locomotives = cars ? Math.ceil(cars / CARS_PER_LOCOMOTIVE) : 0;
    load.slotsUsed = slots;
    load.slots = load.freightCars * vehicle.slots;
    return load;
  }
  if (!perTrip.length) return load;
  if (perTrip.length <= vehicle.slots) {
    // Mixed loads: every vehicle carries its share of each item. The slots a vehicle needs
    // only fall as vehicles are added, so counting up from the bound without whole slots
    // finds the fewest that fit.
    let vehicleCount = Math.max(
      1,
      Math.ceil(
        perTrip.reduce((sum, [amount, perSlot]) => sum + amount / perSlot, 0) / vehicle.slots,
      ),
    );
    while (slotsFor(vehicleCount) > vehicle.slots) vehicleCount++;
    load.vehicles = vehicleCount;
    load.slotsUsed = slotsFor(vehicleCount);
  } else {
    // More item types than slots: each item gets vehicles of its own.
    load.vehicles = perTrip.reduce(
      (sum, [amount, perSlot]) => sum + Math.ceil(amount / perSlot / vehicle.slots),
      0,
    );
    load.slotsUsed = vehicle.slots;
  }
  const vehicles = load.vehicles;
  const energyMJ = catalog.vehicleFuels?.find(f => f.name === transport.fuel)?.mj || 0;
  if (vehicle.burnMW && energyMJ) load.fuelPerMin = (vehicles * vehicle.burnMW * 60) / energyMJ;
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
    for (const link of groupLinks(stage, groups, plan.settings.onSite)) {
      const transport = linkTransportFor(groups.links, link.from, link.to);
      if (!transport?.fuel) continue;
      const burn = linkLoad(link.items, transport, catalog, fluids).fuelPerMin;
      if (burn > 0) fuels[transport.fuel] = (fuels[transport.fuel] || 0) + burn;
    }
    for (const fuel of Object.keys(fuels)) fuels[fuel] = Math.ceil(fuels[fuel]! * 100 - 1e-9) / 100;
    if (Object.keys(fuels).length) out[phase] = fuels;
  }
  return out;
}

// The texts and updates of the links on the Logistics page (ui/factories/GroupLinks.vue).

// What a newly picked vehicle starts with until the user says otherwise.
export const DEFAULT_TRIP_MIN = 5;
export const DEFAULT_FUEL = 'Packaged Fuel';

// For a link that goes by vehicle: the lines under its Out row, and the short badge on its In
// row. `belt` and `pipe` are the best belt and pipe unlocked (flow.ts bestLane): a freight car
// loads at no more than one of each (#232).
export function linkVehicleText(
  items: { item: string; rate: number }[],
  transport: LinkTransport,
  catalog: Pick<Catalog, 'stacks' | 'packaged' | 'vehicleFuels'>,
  fluids: Set<string>,
  belt: { mark: string; cap: number },
  pipe: { mark: string; cap: number },
): { lines: string[]; badge: string } {
  const load = linkLoad(items, transport, catalog, fluids, { belt: belt.cap, pipe: pipe.cap }),
    vehicle = VEHICLES[transport.mode],
    lines: string[] = [];
  let badge = load.vehicles
    ? plural(load.vehicles, vehicle.name.toLowerCase())
    : `By ${vehicle.name.toLowerCase()}`;
  if (transport.mode === 'train') {
    const cars = [
      load.freightCars ? plural(load.freightCars, 'freight car') : '',
      load.fluidCars ? `${plural(load.fluidCars, 'fluid car')} (${num(FLUID_CAR_M3)} m³ each)` : '',
    ].filter(Boolean);
    if (load.vehicles) {
      const locos = plural(load.locomotives, 'locomotive');
      lines.push(
        `1 train: ${locos}, ${cars.join(' and ')}. Electric: each locomotive draws 25–110 MW from the grid while moving.`,
      );
      const limits = [
        load.beltLimited ? `one ${belt.mark} belt (${num(belt.cap)}/min)` : '',
        load.pipeLimited ? `one ${pipe.mark} pipe (${num(pipe.cap)} m³/min)` : '',
      ].filter(Boolean);
      if (limits.length)
        lines.push(
          `A car loads and unloads at no more than ${limits.join(' or ')}, so this flow needs that many cars.`,
        );
      badge = `1 train: ${locos}, ${cars.join(' and ')}`;
    }
  } else if (load.vehicles) {
    const fuel =
      transport.mode === 'drone'
        ? ' Drone fuel depends on the distance flown; see the profile’s drone-fuel supply.'
        : load.fuelPerMin
          ? ` Up to ${num(load.fuelPerMin)} ${transport.fuel}/min if they never stop.`
          : '';
    lines.push(
      `${plural(load.vehicles, vehicle.name.toLowerCase())}, ${load.slotsUsed} of ${vehicle.slots} slots each trip.${fuel}`,
    );
  }
  for (const item of load.unpackable)
    lines.push(`${item} cannot be packaged: keep it on a pipe, or send it by train.`);
  return { lines, badge };
}

// "3 × Mk.4 belts · 1 × Mk.2 pipe": the belts and pipes a link needs, totalled per mark.
// `lanes` plans one item's belts or pipes (flow.ts lanePlan).
export function linkBeltBadge(
  items: { item: string; rate: number }[],
  fluids: Set<string>,
  lanes: (
    rate: number,
    fluid: boolean,
  ) => { lane: { mark: string }; count: number; word: 'belt' | 'pipe' },
): string {
  const marks = new Map<string, { count: number; mark: string; word: string }>();
  for (const { item, rate } of items) {
    const plan = lanes(rate, fluids.has(item)),
      key = plan.lane.mark + plan.word,
      entry = marks.get(key) ?? { count: 0, mark: plan.lane.mark, word: plan.word };
    entry.count += plan.count;
    marks.set(key, entry);
  }
  return [...marks.values()]
    .map(m => `${m.count} × ${m.mark} ${m.word}${m.count > 1 ? 's' : ''}`)
    .join(' · ');
}

// "215/min · 96 m³/min": items and fluids add up separately.
export function linkTotal(items: { rate: number; fluid: boolean }[]): string {
  let solid = 0,
    fluid = 0;
  for (const item of items) item.fluid ? (fluid += item.rate) : (solid += item.rate);
  return [solid ? `${num(solid)}/min` : '', fluid ? `${num(fluid)} m³/min` : '']
    .filter(Boolean)
    .join(' · ');
}

// A mines link with a choice saved before #231 splits on the first change to one of its items:
// the other sources going the same way keep that choice (state.ts factoryLinkTransport). The
// old entry applied in every phase, so its siblings are the sources going there in any phase of
// the plan, not only the one on screen (#235). Undefined when the link has no such old entry.
// `planned` is the plan's settings.onSite (itemBooks).
export function linkSiblings(
  stages: StoredCalculatedPlan['stages'] | undefined,
  groups: FactoryGroups,
  link: { from: string; to: string },
  planned?: OnSiteSettings,
): string[] | undefined {
  return isSource(link.from) && groups.links?.[MINES + ':' + link.to]
    ? [
        ...new Set(
          Object.values(stages ?? {})
            .filter(stage => stage.rows?.length)
            .flatMap(stage => groupLinks(stage, groups, planned))
            .filter(other => isSource(other.from) && other.to === link.to)
            .map(other => other.from),
        ),
      ]
    : undefined;
}

// The factoryLinkTransport update that saves `link`'s transport with `change` applied: a new
// vehicle starts with DEFAULT_TRIP_MIN and, when it burns fuel, DEFAULT_FUEL, unless the link
// already had them.
export function linkTransportUpdate(
  link: { from: string; to: string; mode: 'belt' | LinkMode; transport: LinkTransport | undefined },
  change: { mode?: 'belt' | LinkMode; roundTripMin?: number; fuel?: string },
  siblings: string[] | undefined,
): UpdateOp {
  const mode = change.mode ?? link.mode;
  return mode === 'belt'
    ? {
        type: 'factoryLinkTransport',
        from: link.from,
        to: link.to,
        mode,
        ...(siblings ? { siblings } : {}),
      }
    : {
        type: 'factoryLinkTransport',
        from: link.from,
        to: link.to,
        mode,
        roundTripMin: change.roundTripMin ?? link.transport?.roundTripMin ?? DEFAULT_TRIP_MIN,
        ...(fuelledModes.includes(mode)
          ? { fuel: change.fuel ?? link.transport?.fuel ?? DEFAULT_FUEL }
          : {}),
        ...(siblings ? { siblings } : {}),
      };
}
