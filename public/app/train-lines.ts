// Train lines (#1284, slices 2 and 3): what each wagon of a line's train carries, and the checks
// of a line and of a mining outpost. Pure functions of the saved lines and stations (state
// version 30, `trainLines`, validateTrainLines in state/trains.ts), so the Logistics page, the line
// editor (ui/detail/LineDialog.vue), the network diagram and the tests read the same answers.
//
// Cargo per wagon: the front locomotive stands at the station building and each car behind it at
// the platform in the same position (car 2 at platform 1, and so on), so at every stop the
// platform a wagon stands at decides what it does there: a loading platform puts its cargo in, an
// unloading one takes it out, and an empty platform (for a locomotive or spacing) does nothing.
// The checks are advice, shown and never blocking.
import { localeNumber, listNames } from '../wording.ts';
import { BELT_MARKS, PIPE_MARKS, nodeYield, wellYield } from '../preferences.ts';
import type {
  NodePurityCounts,
  TrainCar,
  TrainLine,
  TrainPlatform,
  TrainStation,
} from '../types/index.ts';

// What a Freight Car holds: 32 inventory slots, each a stack of one item; what a Fluid Freight Car
// holds, in m³ (the SatisfactoryTools figures logistics.ts uses too).
export const WAGON_SLOTS = 32;
export const FLUID_WAGON_M3 = 1600;
// A line's colour in the diagram and on the map: one of these, by the line's place in the list.
export const LINE_COLORS = 6;

// What the checks need to know about an item: how many fit in one slot, and whether it is a fluid
// (the catalog's stacks and flow.ts's FLUIDS on the page, plain tables in the tests).
export interface ItemFacts {
  stack(item: string): number;
  fluid(item: string): boolean;
}
const trainFigure = (value: number) => localeNumber(value, 1);

// A wagon of a line's train: its number among the wagons (1 is the front one), its place in the
// train (car 1 is the front locomotive), and what it does at each stop.
export interface WagonStop {
  station: TrainStation;
  platform: TrainPlatform;
  // The platform's number at that station (1 beside the building).
  at: number;
}
export interface Wagon {
  number: number;
  car: number;
  loads: WagonStop[];
  unloads: WagonStop[];
}
// The station of each stop that exists, in stop order (a stop repeats when the line calls twice).
const stopStations = (line: TrainLine, stations: readonly TrainStation[]): TrainStation[] =>
  line.stops.flatMap(id => stations.find(station => station.id === id) ?? []);
// The distinct stations a line calls at, in the order it first calls.
const calledStations = (line: TrainLine, stations: readonly TrainStation[]) => [
  ...new Set(stopStations(line, stations)),
];

// Each wagon of `line` with the platforms it loads and unloads at; empty platforms are skipped.
export function wagonPlan(line: TrainLine, stations: readonly TrainStation[]): Wagon[] {
  const wagons: Wagon[] = [];
  line.cars.forEach((car, i) => {
    if (car === 'wagon')
      wagons.push({ number: wagons.length + 1, car: i + 1, loads: [], unloads: [] });
  });
  for (const station of calledStations(line, stations))
    for (const wagon of wagons) {
      const platform = station.platforms[wagon.car - 2];
      if (!platform || platform.kind === 'empty') continue;
      const stop = { station, platform, at: wagon.car - 1 };
      (platform.kind === 'load' ? wagon.loads : wagon.unloads).push(stop);
    }
  return wagons;
}
// What a wagon carries: the cargo of every platform that loads it, each item once.
export const wagonCargo = (wagon: Wagon): string[] => [
  ...new Set(
    wagon.loads.flatMap(stop => (stop.platform.kind === 'load' ? stop.platform.cargo : [])),
  ),
];
// Every item a line's wagons carry, for its label in the diagram.
export const lineCargo = (line: TrainLine, stations: readonly TrainStation[]): string[] => [
  ...new Set(wagonPlan(line, stations).flatMap(wagonCargo)),
];

// What one loading stop puts in a wagon during a round trip, and what the wagon holds: the belt
// (or, for a fluid, the pipe) that feeds the platform, times the round trip, against 32 stacks of
// the cargo's smallest stack, or 1,600 m³. Null while the round trip, the belt or the cargo is
// missing, so there is nothing to compare.
export interface WagonFill {
  wagon: number;
  station: string;
  fluid: boolean;
  lane: string;
  rate: number;
  perTrip: number;
  holds: number;
  stack: number;
  fits: boolean;
  // What the wagon moves per minute: its belt's rate, or what it holds per round trip when the
  // belt brings more (the belt then backs up).
  carries: number;
}
export function wagonFill(
  wagon: Wagon,
  stop: WagonStop,
  roundTrip: number | undefined,
  facts: ItemFacts,
): WagonFill | null {
  if (!roundTrip || stop.platform.kind !== 'load' || !stop.platform.cargo.length) return null;
  const cargo = stop.platform.cargo;
  const fluid = cargo.every(item => facts.fluid(item));
  const lane = fluid
    ? PIPE_MARKS[(stop.platform.pipe ?? 0) - 1]
    : BELT_MARKS[(stop.platform.belt ?? 0) - 1];
  if (!lane || (!fluid && cargo.some(item => facts.fluid(item)))) return null;
  const stack = fluid ? 0 : Math.min(...cargo.map(item => facts.stack(item) || 100));
  const holds = fluid ? FLUID_WAGON_M3 : WAGON_SLOTS * stack;
  const perTrip = lane.cap * roundTrip;
  return {
    wagon: wagon.number,
    station: stop.station.name,
    fluid,
    lane: `${lane.mark} ${fluid ? 'pipe' : 'belt'}`,
    rate: lane.cap,
    perTrip,
    holds,
    stack,
    fits: perTrip <= holds + 1e-9,
    carries: Math.min(lane.cap, holds / roundTrip),
  };
}
// A fill in words, for the wagon table: "2,160 of 3,200 per trip", "3,510 per trip, more than the
// 3,200 it holds".
export function fillText(fill: WagonFill): string {
  const unit = fill.fluid ? ' m³' : '';
  return fill.fits
    ? `${trainFigure(fill.perTrip)}${unit} of ${trainFigure(fill.holds)}${unit} per trip`
    : `${trainFigure(fill.perTrip)}${unit} per trip, more than the ${trainFigure(fill.holds)}${unit} it holds`;
}

// One check of a line or an outpost: a stable key, the words, and what it offers: "Add rear
// locomotive" (`fix`) or the station to open (`station`, its id).
export interface TrainCheck {
  key: string;
  text: string;
  fix?: 'rearLoco';
  station?: string;
}
const countOf = (count: number, one: string, many = one + 's') =>
  `${trainFigure(count)} ${count === 1 ? one : many}`;

// The train itself: a locomotive in front and, back and forth, one at the rear too.
function consistChecks(line: TrainLine): TrainCheck[] {
  if (!line.cars.length) return [{ key: 'no-cars', text: 'The train has no cars yet.' }];
  const out: TrainCheck[] = [];
  if (line.cars[0] !== 'loco')
    out.push({
      key: 'first-loco',
      text: 'The first car must be a locomotive: it stands at the station building.',
    });
  if (line.direction === 'backAndForth' && (line.cars.length < 2 || line.cars.at(-1) !== 'loco'))
    out.push({
      key: 'rear-loco',
      text: 'Back and forth needs a locomotive at the rear too, facing the other way, to drive the train back.',
      fix: 'rearLoco',
    });
  if (!line.cars.includes('wagon'))
    out.push({ key: 'no-wagons', text: 'The train has no freight wagons, so it carries nothing.' });
  return out;
}
// Each station the line calls at against the train: enough platforms for the cars behind the
// locomotive, a locomotive at an empty platform and a wagon at a freight platform.
function stationChecks(line: TrainLine, station: TrainStation): TrainCheck[] {
  const out: TrainCheck[] = [];
  const behind = line.cars.length - 1;
  const have = station.platforms.length;
  if (have < behind)
    out.push({
      key: `platforms:${station.id}`,
      text: `${station.name} has ${countOf(have, 'platform')} for the ${countOf(behind, 'car')} behind the locomotive: add ${trainFigure(behind - have)} (an empty platform for a locomotive).`,
      station: station.id,
    });
  let wagon = 0;
  line.cars.forEach((car: TrainCar, i) => {
    if (car === 'wagon') wagon++;
    const platform = i > 0 ? station.platforms[i - 1] : undefined;
    if (!platform) return;
    if (car === 'loco' && platform.kind !== 'empty')
      out.push({
        key: `loco-at:${station.id}:${i}`,
        text: `At ${station.name} the locomotive in car ${i + 1} stands at platform ${i}, a freight platform: make that an empty platform.`,
        station: station.id,
      });
    if (car === 'wagon' && platform.kind === 'empty')
      out.push({
        key: `wagon-at:${station.id}:${i}`,
        text: `At ${station.name} wagon ${wagon} stands at platform ${i}, an empty platform, so nothing loads or unloads it there.`,
        station: station.id,
      });
  });
  return out;
}
// Each wagon: loaded somewhere, unloaded somewhere, one kind of wagon, and room for what its belt
// brings in one round trip.
function wagonChecks(line: TrainLine, wagons: Wagon[], facts: ItemFacts): TrainCheck[] {
  const out: TrainCheck[] = [];
  for (const wagon of wagons) {
    const cargo = wagonCargo(wagon);
    if (!wagon.loads.length) {
      out.push({
        key: `wagon-nothing:${wagon.number}`,
        text: `Wagon ${wagon.number} loads nothing at any stop.`,
      });
      continue;
    }
    if (!wagon.unloads.length)
      out.push({
        key: `wagon-kept:${wagon.number}`,
        text: `Wagon ${wagon.number} is loaded at ${listNames([...new Set(wagon.loads.map(stop => stop.station.name))])} but never unloaded.`,
      });
    if (cargo.some(item => facts.fluid(item)) && cargo.some(item => !facts.fluid(item)))
      out.push({
        key: `wagon-mixed:${wagon.number}`,
        text: `Wagon ${wagon.number} is loaded with fluids and solid items: a wagon is either a freight wagon or a fluid freight wagon.`,
      });
    for (const stop of wagon.loads) {
      const fill = wagonFill(wagon, stop, line.roundTrip, facts);
      if (!fill || fill.fits) continue;
      const unit = fill.fluid ? ' m³' : '';
      const holds = fill.fluid
        ? `${trainFigure(fill.holds)} m³ a fluid freight wagon holds`
        : `${trainFigure(fill.holds)} the wagon holds (${WAGON_SLOTS} stacks of ${trainFigure(fill.stack)})`;
      out.push({
        key: `wagon-full:${wagon.number}:${stop.station.id}`,
        text: `Wagon ${wagon.number} at ${stop.station.name}: its ${fill.lane} brings ${trainFigure(fill.perTrip)}${unit} in a ${trainFigure(line.roundTrip ?? 0)}-minute round trip, more than the ${holds}. The ${fill.fluid ? 'pipe' : 'belt'} backs up to ${trainFigure(fill.carries)}${unit}/min: add a wagon or shorten the round trip.`,
        station: stop.station.id,
      });
    }
  }
  return out;
}
// Every check of `line`, in the order the editor lists them.
export function lineChecks(
  line: TrainLine,
  stations: readonly TrainStation[],
  facts: ItemFacts,
): TrainCheck[] {
  const out = consistChecks(line);
  if (line.stops.length < 2) out.push({ key: 'stops', text: 'A line needs at least two stops.' });
  for (const station of calledStations(line, stations)) out.push(...stationChecks(line, station));
  const wagons = wagonPlan(line, stations);
  out.push(...wagonChecks(line, wagons, facts));
  if (!line.roundTrip && wagons.some(wagon => wagon.loads.length))
    out.push({
      key: 'round-trip',
      text: 'Enter the round trip to check that each wagon holds what its belt brings in one trip.',
    });
  return out;
}
// The train with a locomotive added at the rear, for "Add rear locomotive".
export const withRearLoco = (cars: readonly TrainCar[]): TrainCar[] => [...cars, 'loco'];
// "+ Wagon": a wagon at the end, or in front of the rear locomotive of a train that has one.
export function withWagon(
  cars: readonly TrainCar[],
  direction: TrainLine['direction'],
): TrainCar[] {
  const rear = direction === 'backAndForth' && cars.length > 1 && cars.at(-1) === 'loco';
  return rear ? [...cars.slice(0, -1), 'wagon', 'loco'] : [...cars, 'wagon'];
}

// Mining outposts (#1284, slice 3): what the outpost's extractors give, from its node counts and
// the plan's node survey (the miner mark and clock it plans with; Mk.3 at 250% when it has none),
// against what its loading platforms take on their belts or pipes and what the trains that load
// there carry away.
export interface Survey {
  mark?: number;
  clock?: number;
}
export function outpostYield(
  owner: { resource: string; nodes: NodePurityCounts; wells?: boolean },
  survey: Survey,
): number {
  let total = 0;
  for (const purity of ['impure', 'normal', 'pure'] as const) {
    const count = owner.nodes[purity] ?? 0;
    total +=
      count * (owner.wells ? wellYield(purity, survey) : nodeYield(owner.resource, purity, survey));
  }
  return total;
}
// The words for the extractors an outpost plans with: "Mk.3 miners at 250%".
function extractorText(owner: { resource: string; wells?: boolean }, survey: Survey): string {
  const clock = `${trainFigure((survey.clock ?? 2.5) * 100)}%`;
  if (owner.wells) return `a Resource Well Pressurizer at ${clock}`;
  if (owner.resource === 'Crude Oil') return `Oil Extractors at ${clock}`;
  return `Mk.${survey.mark ?? 3} miners at ${clock}`;
}
export function outpostChecks(
  station: TrainStation,
  lines: readonly TrainLine[],
  stations: readonly TrainStation[],
  survey: Survey,
  facts: ItemFacts,
): TrainCheck[] {
  const owner = station.owner;
  if (owner?.kind !== 'outpost') return [];
  const gives = outpostYield(owner, survey);
  if (gives <= 0) return [];
  const resource = owner.resource;
  const fluid = facts.fluid(resource);
  const unit = fluid ? ' m³/min' : '/min';
  const given = `${trainFigure(gives)} ${resource}${unit} (${extractorText(owner, survey)})`;
  const loading = station.platforms.filter(
    platform => platform.kind === 'load' && platform.cargo.includes(resource),
  );
  if (!loading.length)
    return [
      {
        key: `outpost-none:${station.id}`,
        text: `${station.name}: no loading platform takes the ${given} its extractors give.`,
        station: station.id,
      },
    ];
  const out: TrainCheck[] = [];
  const lanes = loading.map(platform => {
    if (platform.kind === 'empty') return undefined;
    return fluid ? PIPE_MARKS[(platform.pipe ?? 0) - 1] : BELT_MARKS[(platform.belt ?? 0) - 1];
  });
  if (lanes.every(Boolean)) {
    const take = lanes.reduce((sum, lane) => sum + (lane?.cap ?? 0), 0);
    if (take + 1e-9 < gives)
      out.push({
        key: `outpost-lanes:${station.id}`,
        text: `${station.name}: its extractors give ${given}, but its loading platforms' ${fluid ? 'pipes' : 'belts'} take ${trainFigure(take)}${unit}: add a platform or a faster ${fluid ? 'pipe' : 'belt'}.`,
        station: station.id,
      });
  }
  const carried = carriedAway(station, resource, lines, stations, facts);
  if (carried !== null && carried + 1e-9 < gives)
    out.push({
      key: `outpost-trains:${station.id}`,
      text: `${station.name}: the trains that load ${resource} here carry away ${trainFigure(carried)}${unit} of the ${trainFigure(gives)}${unit} its extractors give: add a wagon or a train, or shorten a round trip.`,
      station: station.id,
    });
  return out;
}
// What the trains loading `resource` at `station` carry away per minute, or null when a line
// loading it there has no round trip or belt to work it out from (nothing to compare then).
function carriedAway(
  station: TrainStation,
  resource: string,
  lines: readonly TrainLine[],
  stations: readonly TrainStation[],
  facts: ItemFacts,
): number | null {
  let total = 0;
  let any = false;
  for (const line of lines) {
    if (!line.stops.includes(station.id)) continue;
    for (const wagon of wagonPlan(line, stations))
      for (const stop of wagon.loads) {
        if (stop.station.id !== station.id || stop.platform.kind !== 'load') continue;
        if (!stop.platform.cargo.includes(resource)) continue;
        const fill = wagonFill(wagon, stop, line.roundTrip, facts);
        if (!fill) return null;
        any = true;
        total += fill.carries;
      }
  }
  return any ? total : null;
}

// A line in words, for its card and the diagram: "Back and forth ⇄", "One-way loop →".
export const DIRECTION_TEXT: Record<TrainLine['direction'], { label: string; mark: string }> = {
  oneWay: { label: 'One-way loop', mark: '→' },
  backAndForth: { label: 'Back and forth', mark: '⇄' },
};
// The train front to back in words: "Locomotive, 3 wagons, locomotive", "2 locomotives, 1 wagon".
export function consistText(cars: readonly TrainCar[]): string {
  if (!cars.length) return 'No cars yet';
  const runs: string[] = [];
  let i = 0;
  while (i < cars.length) {
    const car = cars[i];
    let count = 0;
    while (cars[i] === car) {
      count++;
      i++;
    }
    runs.push(
      car === 'wagon'
        ? countOf(count, 'wagon')
        : count === 1
          ? 'locomotive'
          : countOf(count, 'locomotive'),
    );
  }
  const text = runs.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
// A new line's id ('tl-' and ten random characters) and its name, "Line 3", one no line has yet.
export function newLineId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return 'tl-' + [...bytes].map(byte => (byte % 36).toString(36)).join('');
}
export function newLineName(lines: readonly Pick<TrainLine, 'name'>[]): string {
  const taken = new Set(lines.map(line => line.name));
  let number = lines.length + 1;
  while (taken.has(`Line ${number}`)) number++;
  return `Line ${number}`;
}
// The toasts of a deleted line and of its Undo.
export const lineDeletedNews = (name: string) => `Deleted train line “${name}”.`;
export const lineRestoredNews = (name: string) => `Train line “${name}” is back.`;
