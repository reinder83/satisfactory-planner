// Train stations and lines from the factory links (#1301): the Logistics page's Trains tab offers
// "Create stations from train links", which proposes, for each link between places that is set
// to go by train (factoryGroups.links, mode 'train'), a pick-up station at the supplying factory
// (a mining outpost for a `supply/<resource>` link), a drop-off station at the receiving factory,
// their platforms with the cargo filled in, and a line between them with the freight wagons (or
// fluid freight wagons) the link's rate and round trip need. Pure functions of the links, the
// profile's stations and lines and the phase's best belt and pipe, so the preview
// (ui/detail/TrainProposalDialog.vue) and the tests read the same answers; nothing here saves.
//
// Matching, so that a second run only adds what is missing and never duplicates or changes what
// the player made or edited:
// - An end's owner is the station owner #1284 defined: a factory for a factory group, a mining
//   outpost on the resource for a `supply/<resource>` source, storage for protected storage. Two
//   owners match when they are the same factory, outposts on the same resource (whatever their
//   nodes) or both storage. A link from or to anything else (Ungrouped, existing supply that is no
//   minable resource, the sink, the Space Elevator, fuel) gets no proposal, and says why.
// - An item of a link is served when an existing line has a wagon that loads it at a station of
//   the supplier's owner and unloads at a station of the receiver's owner (wagonPlan: the platform
//   in the wagon's place at each stop). A link whose items are all served is listed as served by
//   those lines and proposes nothing; otherwise the items not served are proposed.
// - A station is reused instead of adding one only when it is a stop of no line, has the end's
//   owner and, at the pick-up, loads exactly the items proposed (its loading platforms together);
//   at the drop-off it has an unloading platform and no loading one. A reused station is never
//   changed: the line calls at it as it is, and the line's checks say what it lacks. Each station
//   is reused by one link at most, the links ticked first.
// - Nothing else is ever touched: Create only adds stations and lines under new ids (the
//   trainAdd update refuses an id that exists).
import { BELT_MARKS, PIPE_MARKS } from '../preferences.ts';
import {
  outpostResourceList,
  ROUND_TRIP_MAX,
  roundTripOf,
  TRAIN_CAR_MAX,
  TRAIN_LINE_NAME_MAX,
  TRAIN_STATION_NAME_MAX,
  wellsOnly,
} from '../state.ts';
import { listNames, localeNumber } from '../wording.ts';
import { isSource, OUTSIDE, sourceItem, UNGROUPED } from './group-links.ts';
import { CARS_PER_LOCOMOTIVE, DEFAULT_TRIP_MIN } from './logistics.ts';
import { FLUID_WAGON_M3, WAGON_SLOTS, wagonPlan, type ItemFacts } from './train-lines.ts';
import type {
  FactoryGroup,
  FactoryPlace,
  FactoryPlaces,
  StationOwner,
  TrainCar,
  TrainLine,
  TrainPlatform,
  TrainStation,
} from '../types/index.ts';

// One link that goes by train, as the Logistics page has it: its ends (a factory group id, a
// `supply/<item>` source or one of the other places), its items per minute (m³ for a fluid) and
// the round trip saved on the link.
export interface TrainLinkInput {
  from: string;
  to: string;
  items: { item: string; rate: number }[];
  roundTripMin: number;
}
// What the proposal reads of the open profile and phase.
export interface ProposalWorld {
  groups: readonly Pick<FactoryGroup, 'id' | 'name'>[];
  places?: FactoryPlaces;
  stations: readonly TrainStation[];
  lines: readonly TrainLine[];
  facts: ItemFacts;
  // The best belt and pipe marks the phase has, as mark numbers (Mk.4 belts: 4).
  belt: number;
  pipe: number;
  // A place's name as the Logistics page shows it, for the ends that get no station.
  name?: (place: string) => string;
}

// One end of a link: the station owner it gets and the name its station is named after, or why it
// gets none.
export type LinkEnd =
  { owner: StationOwner; name: string; place?: FactoryPlace } | { skip: string; name: string };
export function linkEnd(id: string, world: ProposalWorld): LinkEnd {
  const group = world.groups.find(entry => entry.id === id);
  if (group)
    return {
      owner: { kind: 'factory', id: group.id },
      name: group.name,
      ...(world.places?.[group.id] ? { place: world.places[group.id] } : {}),
    };
  const name = world.name?.(id) ?? id;
  if (isSource(id)) {
    const resource = sourceItem(id);
    if (!outpostResourceList().includes(resource))
      return { skip: `${resource} is existing supply, which has no place for a station.`, name };
    return {
      owner: {
        kind: 'outpost',
        resource,
        nodes: {},
        ...(wellsOnly(resource) ? { wells: true as const } : {}),
      },
      name: `${resource} outpost`,
    };
  }
  if (id === OUTSIDE.storage) return { owner: { kind: 'storage' }, name };
  if (id === UNGROUPED)
    return {
      skip: 'Ungrouped production lines are in no factory, so there is no factory to put a station at.',
      name,
    };
  return { skip: `${name} is no place for a train station.`, name };
}

// Whether a station's owner is the owner an end asks for (see the matching rules at the top).
export function ownerMatches(owner: StationOwner | undefined, wanted: StationOwner): boolean {
  if (!owner || owner.kind !== wanted.kind) return false;
  if (owner.kind === 'factory') return wanted.kind === 'factory' && owner.id === wanted.id;
  if (owner.kind === 'outpost')
    return wanted.kind === 'outpost' && owner.resource === wanted.resource;
  return true;
}

// The lines that already carry `item` from a station of `from` to a station of `to`: a wagon of
// theirs loads it at the one and unloads at the other.
export function servingLines(
  item: string,
  from: StationOwner,
  to: StationOwner,
  lines: readonly TrainLine[],
  stations: readonly TrainStation[],
): TrainLine[] {
  return lines.filter(line =>
    wagonPlan(line, stations).some(
      wagon =>
        wagon.loads.some(
          stop =>
            stop.platform.kind === 'load' &&
            stop.platform.cargo.includes(item) &&
            ownerMatches(stop.station.owner, from),
        ) && wagon.unloads.some(stop => ownerMatches(stop.station.owner, to)),
    ),
  );
}

// The wagons one item of a link needs, and the belt (or pipe) of each wagon's platform. The line
// checks (wagonFill in train-lines.ts) compare what a platform's belt brings in one round trip
// with what a wagon holds (32 stacks of the item, or 1,600 m³), so the suggestion is the fewest
// wagons for which each wagon's share of the rate fits on a belt the phase has and that belt's
// full rate over the round trip fits in the wagon: then the created line passes its own checks.
// When no belt is slow enough for that (a round trip so long that even a Mk.1 belt overfills a
// wagon), the wagons the rate needs are kept with the slowest belt that carries a wagon's share,
// and the line's checks say how far the belt backs up.
export interface WagonSuggestion {
  item: string;
  rate: number;
  fluid: boolean;
  wagons: number;
  // The belt or pipe mark of each wagon's platform, 1-based.
  mark: number;
  lane: string;
}
export function suggestWagons(
  item: string,
  rate: number,
  roundTrip: number,
  facts: ItemFacts,
  best: { belt: number; pipe: number },
): WagonSuggestion {
  const fluid = facts.fluid(item);
  const marks = (fluid ? PIPE_MARKS : BELT_MARKS).slice(
    0,
    Math.max(1, fluid ? best.pipe : best.belt),
  );
  const holds = fluid ? FLUID_WAGON_M3 : WAGON_SLOTS * (facts.stack(item) || 100);
  const lane = (at: number) => `${marks[at]!.mark} ${fluid ? 'pipe' : 'belt'}`;
  const fewest = Math.max(1, Math.ceil((rate * roundTrip) / holds - 1e-9));
  const carrying = (wagons: number) => marks.findIndex(mark => mark.cap + 1e-9 >= rate / wagons);
  for (let wagons = fewest; wagons <= TRAIN_CAR_MAX; wagons++) {
    const at = carrying(wagons);
    if (at >= 0 && marks[at]!.cap * roundTrip <= holds + 1e-9)
      return { item, rate, fluid, wagons, mark: at + 1, lane: lane(at) };
  }
  // No belt fits: as many wagons as the rate needs, each on the slowest belt that carries its share.
  let wagons = fewest;
  while (carrying(wagons) < 0 && wagons < TRAIN_CAR_MAX) wagons++;
  const at = Math.max(0, carrying(wagons));
  return { item, rate, fluid, wagons, mark: at + 1, lane: lane(at) };
}

// The most wagons one train takes: the front locomotives (one per CARS_PER_LOCOMOTIVE wagons,
// logistics.ts's rule of thumb) and the wagons within TRAIN_CAR_MAX cars (32 wagons, 8
// locomotives).
// A function, worked out when asked: the VM interface tests (tests/helpers/app-source.ts) run the
// app without the shared modules' exports unless a test supplies them.
export function maxWagons(): number {
  let wagons = TRAIN_CAR_MAX;
  while (wagons + Math.ceil(wagons / CARS_PER_LOCOMOTIVE) > TRAIN_CAR_MAX) wagons--;
  return wagons;
}
export const locomotivesFor = (wagons: number): number =>
  Math.max(1, Math.ceil(wagons / CARS_PER_LOCOMOTIVE));

// A round trip estimated from the map (#1301). The assumptions, also listed under "To confirm"
// in the pull request: the track runs TRACK_FACTOR times the straight distance between the two
// stations (curves and terrain), the train averages TRAIN_SPEED m/s (90 km/h; the Electric
// Locomotive's top speed is 120 km/h, and it brakes and accelerates at each end), and each of the
// two stops takes STOP_DWELL minutes (docking, loading or unloading, pulling out). Game units are
// centimetres. Rounded up to a tenth of a minute, within the line's limits. Only an estimate: the
// preview says so, and the player edits it.
export const TRACK_FACTOR = 1.3;
export const TRAIN_SPEED = 25;
export const STOP_DWELL = 0.5;
export function roundTripEstimate(
  a: FactoryPlace,
  b: FactoryPlace,
): { minutes: number; km: number } {
  const metres = Math.hypot(a.x - b.x, a.y - b.y) / 100;
  const minutes = (2 * metres * TRACK_FACTOR) / TRAIN_SPEED / 60 + 2 * STOP_DWELL;
  return {
    minutes: Math.min(ROUND_TRIP_MAX, Math.max(0.1, Math.ceil(minutes * 10 - 1e-9) / 10)),
    km: metres / 1000,
  };
}

// A name of at most `max` characters: cut with an ellipsis when longer, and numbered (" 2", " 3")
// when `taken` has it.
export function freshName(base: string, taken: Set<string>, max: number): string {
  const cut = (text: string, room: number) =>
    text.length <= room ? text : text.slice(0, room - 1).trimEnd() + '…';
  let name = cut(base, max);
  for (let n = 2; taken.has(name); n++) name = cut(base, max - ` ${n}`.length) + ` ${n}`;
  taken.add(name);
  return name;
}

// One link's proposal.
export interface StationPick {
  station: TrainStation;
  // An existing station the line calls at as it is (see the matching rules at the top).
  reused: boolean;
}
export type TripSource = 'edited' | 'link' | 'map';
export interface LinkProposal {
  key: string;
  from: string;
  to: string;
  fromName: string;
  toName: string;
  items: { item: string; rate: number }[];
  // 'propose': stations and a line to create; 'served': every item already has a line;
  // 'skipped': an end has no owner (`reason` says why).
  status: 'propose' | 'served' | 'skipped';
  reason: string;
  // The lines that already carry some of its items, by name.
  servedBy: string[];
  // The items proposed: those no line carries yet.
  missing: { item: string; rate: number }[];
  // The round trip the line gets, where it comes from, and the map's estimate when both ends have
  // a place.
  roundTrip: number;
  tripSource: TripSource;
  estimate?: { minutes: number; km: number };
  wagons: WagonSuggestion[];
  // The wagons the rate needs, when more than one train takes (maxWagons()); the line has
  // maxWagons() then.
  wanted?: number;
  locomotives: number;
  pickup?: StationPick;
  dropoff?: StationPick;
  line?: TrainLine;
}

// New ids, which the caller makes (random in the page, fixed in the tests): `kind` is 'ts' for a
// station and 'tl' for a line, `key` the link's and `role` 'pickup', 'dropoff' or 'line'.
export type ProposalIds = (
  kind: 'ts' | 'tl',
  key: string,
  role: 'pickup' | 'dropoff' | 'line',
) => string;
export interface ProposalOptions {
  ids: ProposalIds;
  // Round trips the player typed in the preview, by link key.
  trips?: Readonly<Record<string, number>>;
  // The links the player unticked: they come after the ticked ones in claiming stations and names.
  unticked?: ReadonlySet<string>;
}

export const linkKeyOf = (link: Pick<TrainLinkInput, 'from' | 'to'>) => link.from + ':' + link.to;

// What platforms of one kind the proposal builds for a train: an empty platform for each
// locomotive behind the front one, then one per wagon with its item and belt (or pipe).
function proposalPlatforms(
  kind: 'load' | 'unload',
  locomotives: number,
  wagons: readonly WagonSuggestion[],
): TrainPlatform[] {
  const out: TrainPlatform[] = Array.from({ length: locomotives - 1 }, () => ({ kind: 'empty' }));
  for (const wagon of wagons)
    for (let i = 0; i < wagon.wagons; i++) {
      const lane = wagon.fluid ? { pipe: wagon.mark as 1 | 2 } : { belt: wagon.mark as 1 };
      out.push(kind === 'load' ? { kind, cargo: [wagon.item], ...lane } : { kind, ...lane });
    }
  return out;
}
// The wagons kept within one train: each item's in order, until maxWagons().
function withinOneTrain(wagons: WagonSuggestion[]): WagonSuggestion[] {
  let room = maxWagons();
  return wagons.flatMap(wagon => {
    const kept = Math.min(wagon.wagons, room);
    room -= kept;
    return kept ? [{ ...wagon, wagons: kept }] : [];
  });
}

const proposalCargo = (station: TrainStation) =>
  new Set(station.platforms.flatMap(platform => (platform.kind === 'load' ? platform.cargo : [])));
const sameCargo = (a: Set<string>, b: readonly string[]) =>
  a.size === new Set(b).size && b.every(item => a.has(item));

// The proposal for every link, in the order given (see the matching rules at the top).
export function proposeTrains(
  links: readonly TrainLinkInput[],
  world: ProposalWorld,
  options: ProposalOptions,
): LinkProposal[] {
  const called = new Set(world.lines.flatMap(line => line.stops));
  const free = world.stations.filter(station => !called.has(station.id));
  const claimed = new Set<string>();
  const stationNames = new Set(world.stations.map(station => station.name));
  const lineNames = new Set(world.lines.map(line => line.name));
  const claim = (match: (station: TrainStation) => boolean): TrainStation | undefined => {
    const station = free.find(entry => !claimed.has(entry.id) && match(entry));
    if (station) claimed.add(station.id);
    return station;
  };
  const one = (link: TrainLinkInput): LinkProposal => {
    const key = linkKeyOf(link);
    const from = linkEnd(link.from, world),
      to = linkEnd(link.to, world);
    const base: LinkProposal = {
      key,
      from: link.from,
      to: link.to,
      fromName: from.name,
      toName: to.name,
      items: link.items,
      status: 'skipped',
      reason: '',
      servedBy: [],
      missing: [],
      roundTrip: link.roundTripMin,
      tripSource: 'link',
      wagons: [],
      locomotives: 0,
    };
    if ('skip' in from || 'skip' in to)
      return { ...base, reason: 'skip' in from ? from.skip : (to as { skip: string }).skip };
    const servedBy = new Set<string>();
    const missing = link.items.filter(({ item }) => {
      const serving = servingLines(item, from.owner, to.owner, world.lines, world.stations);
      for (const line of serving) servedBy.add(line.name);
      return !serving.length;
    });
    const served = { ...base, servedBy: [...servedBy], missing };
    if (!missing.length) return { ...served, status: 'served' };
    const items = missing.map(entry => entry.item);
    const pickupFound = claim(
      station =>
        ownerMatches(station.owner, from.owner) && sameCargo(proposalCargo(station), items),
    );
    const dropoffFound = claim(
      station =>
        ownerMatches(station.owner, to.owner) &&
        station.platforms.some(platform => platform.kind === 'unload') &&
        !station.platforms.some(platform => platform.kind === 'load'),
    );
    // Where each end stands: its station's place on the map, else its factory's.
    const spots = [pickupFound?.place ?? from.place, dropoffFound?.place ?? to.place];
    const estimate = spots[0] && spots[1] ? roundTripEstimate(spots[0], spots[1]) : undefined;
    const typed = roundTripOf(options.trips?.[key]);
    // The map's estimate replaces the default round trip; one the player saved on the link (any
    // other figure) or typed here wins.
    const [roundTrip, tripSource]: [number, TripSource] = typed
      ? [typed, 'edited']
      : estimate && link.roundTripMin === DEFAULT_TRIP_MIN
        ? [estimate.minutes, 'map']
        : [roundTripOf(link.roundTripMin) ?? DEFAULT_TRIP_MIN, 'link'];
    const needed = missing.map(({ item, rate }) =>
      suggestWagons(item, rate, roundTrip, world.facts, world),
    );
    const total = needed.reduce((sum, wagon) => sum + wagon.wagons, 0);
    const wagons = withinOneTrain(needed);
    const count = wagons.reduce((sum, wagon) => sum + wagon.wagons, 0);
    const locomotives = locomotivesFor(count);
    const pickup: StationPick = pickupFound
      ? { station: pickupFound, reused: true }
      : {
          station: {
            id: options.ids('ts', key, 'pickup'),
            name: freshName(
              `${from.name} pick-up for ${to.name}`,
              stationNames,
              TRAIN_STATION_NAME_MAX,
            ),
            owner: from.owner,
            platforms: proposalPlatforms('load', locomotives, wagons),
          },
          reused: false,
        };
    const dropoff: StationPick = dropoffFound
      ? { station: dropoffFound, reused: true }
      : {
          station: {
            id: options.ids('ts', key, 'dropoff'),
            name: freshName(
              `${to.name} drop-off from ${from.name}`,
              stationNames,
              TRAIN_STATION_NAME_MAX,
            ),
            owner: to.owner,
            platforms: proposalPlatforms('unload', locomotives, wagons),
          },
          reused: false,
        };
    const cars: TrainCar[] = [
      ...Array.from({ length: locomotives }, () => 'loco' as const),
      ...Array.from({ length: count }, () => 'wagon' as const),
    ];
    const line: TrainLine = {
      id: options.ids('tl', key, 'line'),
      name: freshName(`${from.name} to ${to.name}`, lineNames, TRAIN_LINE_NAME_MAX),
      cars,
      stops: [pickup.station.id, dropoff.station.id],
      direction: 'oneWay',
      roundTrip,
    };
    return {
      ...served,
      status: 'propose',
      roundTrip,
      tripSource,
      ...(estimate ? { estimate } : {}),
      wagons,
      ...(total > count ? { wanted: total } : {}),
      locomotives,
      pickup,
      dropoff,
      line,
    };
  };
  // The ticked links claim stations and names first, in order, then the unticked ones.
  const unticked = options.unticked ?? new Set<string>();
  const done = new Map<string, LinkProposal>();
  for (const pass of [false, true])
    for (const link of links)
      if (unticked.has(linkKeyOf(link)) === pass) done.set(linkKeyOf(link), one(link));
  return links.map(link => done.get(linkKeyOf(link))!);
}

// What Create adds for the ticked proposals: their new stations (a reused one is not sent) and
// their lines, in the order of the links.
export function createdEntries(
  proposals: readonly LinkProposal[],
  ticked: ReadonlySet<string>,
): { stations: TrainStation[]; lines: TrainLine[] } {
  const chosen = proposals.filter(
    proposal => proposal.status === 'propose' && ticked.has(proposal.key) && proposal.line,
  );
  return {
    stations: chosen.flatMap(proposal =>
      [proposal.pickup!, proposal.dropoff!].filter(pick => !pick.reused).map(pick => pick.station),
    ),
    lines: chosen.map(proposal => proposal.line!),
  };
}

// The words of the preview and the toasts.
const proposalFigure = (value: number) => localeNumber(value, 1);
const proposalCount = (count: number, one: string, many = one + 's') =>
  `${proposalFigure(count)} ${count === 1 ? one : many}`;
// "2 freight wagons on Mk.4 belts" / "1 fluid freight wagon on a Mk.1 pipe".
export function wagonText(wagon: WagonSuggestion): string {
  const kind = wagon.fluid ? 'fluid freight wagon' : 'freight wagon';
  const lane = wagon.wagons === 1 ? `a ${wagon.lane}` : `${wagon.lane}s`;
  return `${proposalCount(wagon.wagons, kind)} for ${wagon.item} on ${lane}`;
}
// "1 locomotive and 3 wagons".
export const trainText = (proposal: Pick<LinkProposal, 'locomotives' | 'wagons'>): string =>
  `${proposalCount(proposal.locomotives, 'locomotive')} and ${proposalCount(
    proposal.wagons.reduce((sum, wagon) => sum + wagon.wagons, 0),
    'wagon',
  )}`;
// "Iron Ore 480/min, Water 120 m³/min".
export const ratesText = (items: readonly { item: string; rate: number }[], facts: ItemFacts) =>
  listNames(
    items.map(
      ({ item, rate }) => `${item} ${proposalFigure(rate)}${facts.fluid(item) ? ' m³' : ''}/min`,
    ),
  );
export const createdNews = (stations: number, lines: number): string =>
  `Created ${proposalCount(stations, 'train station')} and ${proposalCount(lines, 'train line')}.`;
export const undoneNews = (stations: number, lines: number): string =>
  `Removed the ${proposalCount(stations, 'train station')} and ${proposalCount(lines, 'train line')} that Create added.`;
