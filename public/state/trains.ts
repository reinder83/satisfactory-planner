// Train logistics in the saved progress (#1284): the train stations and their platforms (slice 1,
// state version 29), the train lines with their trains, the network diagram's layout, stations on
// the world map, pipes on platforms and outposts on oil and resource wells (slices 2 to 4, state
// version 30). Each field is read leniently: a station, line or part of one that cannot be kept is
// left out and the rest stays, so one bad entry never costs the others. An update (mutate.ts) reads
// the entry it writes strictly, refusing any malformed part. Re-exported by ../state.ts; called by
// validateState in validate.ts, which also marks the version.
import { minedResources, wellResources } from '../preferences.ts';
import { ITEM_NAMES } from './items.ts';
import {
  cleanFactoryPlace,
  fail,
  groupId,
  label,
  LAYOUT_LIMITS,
  plain,
  type Raw,
} from './validate.ts';
import type {
  BeltMark,
  FactoryGroup,
  NodePurityCounts,
  PipeMark,
  StationOwner,
  TrainCar,
  TrainDirection,
  TrainLayout,
  TrainLine,
  TrainPlatform,
  TrainPlatformKind,
  TrainStation,
} from '../types/index.ts';

// The limits of a profile's train stations. At most 200 stations, a name of 1 to 60 characters
// once trimmed, at most 40 platforms a station (a long train has fewer cars), at most 8 items of
// mixed cargo on one loading platform, and at most 99 nodes of each purity on a mining outpost. A
// belt is a conveyor belt mark, 1 to 6; a pipe (version 30) a pipeline mark, 1 or 2.
export const TRAIN_STATION_MAX = 200;
export const TRAIN_STATION_NAME_MAX = 60;
export const TRAIN_PLATFORM_MAX = 40;
export const TRAIN_CARGO_MAX = 8;
export const OUTPOST_NODE_MAX = 99;
export const TRAIN_PLATFORM_KINDS: readonly TrainPlatformKind[] = ['load', 'unload', 'empty'];
// The resources an outpost may mine (version 30 adds oil and the resource wells): the ordinary
// nodes', Crude Oil on oil nodes or wells, and Nitrogen Gas and Water, which come from wells only.
export const outpostResourceList = (): string[] => [
  ...minedResources,
  ...wellResources.filter(resource => !minedResources.includes(resource)),
];
// Whether `resource` comes from resource wells only (Nitrogen Gas, Water), or may (Crude Oil).
export const wellsOnly = (resource: string): boolean =>
  wellResources.includes(resource) && resource !== 'Crude Oil';
const NODE_PURITIES = ['pure', 'normal', 'impure'] as const;
export const trainStationId = (value: unknown): value is string =>
  typeof value === 'string' && /^ts-[a-z0-9]{4,32}$/.test(value);
const beltMark = (value: unknown): value is BeltMark =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 6;
const pipeMark = (value: unknown): value is PipeMark => value === 1 || value === 2;
const knownItems = new Set<unknown>(ITEM_NAMES);

// What one station's parts may be. `strict` is for an update (mutate.ts), which is refused when
// any part is malformed. Without it, as validateState reads a stored station, a malformed part is
// left out and the rest is kept: an unknown or repeated cargo item, a belt or pipe that is no
// mark, a node count that is no whole number from 0 to 99, a platform past the 40th or of no known
// kind, a map place out of range, and an owner that is no factory of the profile (removing a
// factory leaves its stations without an owner, never deletes them).
interface StationRules {
  factories: ReadonlySet<string>;
  strict: boolean;
}
// The node counts of an outpost as kept, or null when one is malformed under `strict`.
function cleanNodeCounts(raw: unknown, strict: boolean): NodePurityCounts | null {
  const counts = raw === undefined ? {} : raw;
  if (!plain(counts)) return strict ? null : {};
  const nodes: NodePurityCounts = {};
  for (const purity of NODE_PURITIES) {
    const count = counts[purity];
    if (count === undefined || count === 0) continue;
    if (!Number.isInteger(count) || (count as number) < 0 || (count as number) > OUTPOST_NODE_MAX) {
      if (strict) return null;
      continue;
    }
    nodes[purity] = count as number;
  }
  return nodes;
}
// An outpost owner as kept, or null when it is malformed. Its resource is one of
// outpostResourceList; `wells: true` (version 30) says the counts are a resource well's satellite
// nodes, which Nitrogen Gas and Water always are and an ordinary node's resource never is (under
// `strict` a wrong flag refuses it; otherwise the flag follows the resource).
function cleanOutpost(raw: Raw, strict: boolean): StationOwner | null {
  const resource = raw.resource;
  if (typeof resource !== 'string' || !outpostResourceList().includes(resource)) return null;
  const nodes = cleanNodeCounts(raw.nodes, strict);
  if (!nodes) return null;
  if (raw.wells !== undefined && raw.wells !== true && strict) return null;
  const canWells = wellResources.includes(resource);
  if (raw.wells === true && !canWells && strict) return null;
  const wells = wellsOnly(resource) || (raw.wells === true && canWells);
  return { kind: 'outpost', resource, nodes, ...(wells ? { wells: true as const } : {}) };
}
// A station's owner as kept, undefined for none, or null when it is malformed.
function cleanStationOwner(raw: unknown, rules: StationRules): StationOwner | undefined | null {
  if (raw === undefined) return undefined;
  if (!plain(raw)) return null;
  if (raw.kind === 'factory')
    return groupId(raw.id) && rules.factories.has(raw.id) ? { kind: 'factory', id: raw.id } : null;
  if (raw.kind === 'storage') return { kind: 'storage' };
  if (raw.kind !== 'outpost') return null;
  return cleanOutpost(raw, rules.strict);
}
// One platform as kept, or null when it is malformed (no known kind; under `strict` any part).
function cleanPlatform(raw: unknown, rules: StationRules): TrainPlatform | null {
  if (!plain(raw) || !TRAIN_PLATFORM_KINDS.includes(raw.kind as TrainPlatformKind)) return null;
  if (raw.kind === 'empty') return { kind: 'empty' };
  if (raw.belt !== undefined && !beltMark(raw.belt) && rules.strict) return null;
  if (raw.pipe !== undefined && !pipeMark(raw.pipe) && rules.strict) return null;
  const connections = {
    ...(beltMark(raw.belt) ? { belt: raw.belt } : {}),
    ...(pipeMark(raw.pipe) ? { pipe: raw.pipe } : {}),
  };
  if (raw.kind === 'unload') return { kind: 'unload', ...connections };
  const listed = raw.cargo === undefined ? [] : raw.cargo;
  if (!Array.isArray(listed))
    return rules.strict ? null : { kind: 'load', cargo: [], ...connections };
  const cargo: string[] = [];
  for (const item of listed) {
    if (knownItems.has(item) && !cargo.includes(item as string) && cargo.length < TRAIN_CARGO_MAX)
      cargo.push(item as string);
    else if (rules.strict) return null;
  }
  return { kind: 'load', cargo, ...connections };
}
// One station as kept, or null when it cannot be kept: no plain object, no station id or no
// name (and, under `strict`, any malformed part). Fields it does not know are left out.
export function cleanTrainStation(raw: unknown, rules: StationRules): TrainStation | null {
  if (!plain(raw) || !trainStationId(raw.id) || !label(raw.name, TRAIN_STATION_NAME_MAX))
    return null;
  const owner = cleanStationOwner(raw.owner, rules);
  if (owner === null && rules.strict) return null;
  const listed = raw.platforms === undefined ? [] : raw.platforms;
  if (!Array.isArray(listed) && rules.strict) return null;
  const platforms: TrainPlatform[] = [];
  for (const entry of Array.isArray(listed) ? listed : []) {
    const platform = cleanPlatform(entry, rules);
    if ((!platform || platforms.length >= TRAIN_PLATFORM_MAX) && rules.strict) return null;
    if (platform && platforms.length < TRAIN_PLATFORM_MAX) platforms.push(platform);
  }
  // Where it stands on the world map (version 30), in game units as a factory's place.
  const place = raw.place === undefined ? undefined : cleanFactoryPlace(raw.place);
  if (raw.place !== undefined && !place && rules.strict) return null;
  return {
    id: raw.id,
    name: raw.name.trim(),
    ...(owner ? { owner } : {}),
    platforms,
    ...(place ? { place } : {}),
  };
}
// Returns a clean copy of trainStations (#1284), or undefined when absent, empty or no list: the
// stations in the order added, each id once (a repeated id keeps the first), at most
// TRAIN_STATION_MAX. A station that cannot be kept is left out and the others stay, as do the
// good parts of a station with a malformed one (cleanTrainStation); `groups` are the profile's
// factories, which a station's factory owner must name.
export function validateTrainStations(
  raw: unknown,
  groups: readonly Pick<FactoryGroup, 'id'>[],
): TrainStation[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rules: StationRules = { factories: new Set(groups.map(group => group.id)), strict: false };
  const seen = new Set<string>();
  const out: TrainStation[] = [];
  for (const entry of raw) {
    const station = cleanTrainStation(entry, rules);
    if (!station || seen.has(station.id) || out.length >= TRAIN_STATION_MAX) continue;
    seen.add(station.id);
    out.push(station);
  }
  return out.length ? out : undefined;
}
// The parts of a station only version 30 knows: a map place, a pipe on a platform, and an outpost
// on oil or resource wells. A release of version 29 would drop them (its validation keeps only
// what it knows), so a state with one of them is version 30 and that release refuses it instead.
export const stationNeedsV30 = (station: TrainStation): boolean =>
  !!station.place ||
  station.platforms.some(platform => platform.kind !== 'empty' && platform.pipe !== undefined) ||
  (station.owner?.kind === 'outpost' &&
    (!minedResources.includes(station.owner.resource) || !!station.owner.wells));

// Train lines (#1284, slice 2, version 30): at most 100 lines, a name of 1 to 60 characters once
// trimmed, at most 41 cars (the front locomotive at the station building and a car at each of up
// to 40 platforms), at most 40 stops, and a round trip of more than 0 and at most 600 minutes,
// kept to a tenth of a minute.
export const TRAIN_LINE_MAX = 100;
export const TRAIN_LINE_NAME_MAX = 60;
export const TRAIN_CAR_MAX = 41;
export const TRAIN_STOP_MAX = 40;
export const ROUND_TRIP_MAX = 600;
export const TRAIN_CARS: readonly TrainCar[] = ['loco', 'wagon'];
export const TRAIN_DIRECTIONS: readonly TrainDirection[] = ['oneWay', 'backAndForth'];
export const trainLineId = (value: unknown): value is string =>
  typeof value === 'string' && /^tl-[a-z0-9]{4,32}$/.test(value);
// A round trip in minutes as kept (a tenth of a minute), or null when it is none.
export function roundTripOf(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const minutes = Math.round(value * 10) / 10;
  return minutes > 0 && minutes <= ROUND_TRIP_MAX ? minutes : null;
}
// What a line's parts may be: its stops are stations of the profile. As for a station, `strict`
// refuses any malformed part, and otherwise that part is left out: a car of no known kind, a stop
// that is no station of the profile (deleting a station takes it off every line), anything past
// the limits, a round trip that is none, and a direction that is none (one-way then).
interface LineRules {
  stations: ReadonlySet<string>;
  strict: boolean;
}
// The entries of list `raw` that `keep` accepts, at most `max`; null under `strict` when one is
// refused or there are too many, or when `raw` is no list.
function cleanList<T>(
  raw: unknown,
  max: number,
  strict: boolean,
  keep: (entry: unknown) => entry is T,
): T[] | null {
  const listed = raw === undefined ? [] : raw;
  if (!Array.isArray(listed)) return strict ? null : [];
  const out: T[] = [];
  for (const entry of listed) {
    const fits = keep(entry) && out.length < max;
    if (!fits && strict) return null;
    if (fits) out.push(entry);
  }
  return out;
}
// One line as kept, or null when it cannot be kept: no plain object, no line id or no name (and,
// under `strict`, any malformed part). Fields it does not know are left out.
export function cleanTrainLine(raw: unknown, rules: LineRules): TrainLine | null {
  if (!plain(raw) || !trainLineId(raw.id) || !label(raw.name, TRAIN_LINE_NAME_MAX)) return null;
  const cars = cleanList(raw.cars, TRAIN_CAR_MAX, rules.strict, (car): car is TrainCar =>
    TRAIN_CARS.includes(car as TrainCar),
  );
  const stops = cleanList(
    raw.stops,
    TRAIN_STOP_MAX,
    rules.strict,
    (stop): stop is string => trainStationId(stop) && rules.stations.has(stop),
  );
  const direction = TRAIN_DIRECTIONS.includes(raw.direction as TrainDirection)
    ? (raw.direction as TrainDirection)
    : null;
  const roundTrip = raw.roundTrip === undefined ? undefined : roundTripOf(raw.roundTrip);
  if (rules.strict && (!cars || !stops || !direction || roundTrip === null)) return null;
  return {
    id: raw.id,
    name: raw.name.trim(),
    cars: cars ?? [],
    stops: stops ?? [],
    direction: direction ?? 'oneWay',
    ...(typeof roundTrip === 'number' ? { roundTrip } : {}),
  };
}
// Returns a clean copy of trainLines (#1284), or undefined when absent, empty or no list: the
// lines in the order added, each id once, at most TRAIN_LINE_MAX, read against `stations` (the
// profile's train stations as kept), which a stop must name.
export function validateTrainLines(
  raw: unknown,
  stations: readonly Pick<TrainStation, 'id'>[],
): TrainLine[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rules: LineRules = {
    stations: new Set(stations.map(station => station.id)),
    strict: false,
  };
  const seen = new Set<string>();
  const out: TrainLine[] = [];
  for (const entry of raw) {
    const line = cleanTrainLine(entry, rules);
    if (!line || seen.has(line.id) || out.length >= TRAIN_LINE_MAX) continue;
    seen.add(line.id);
    out.push(line);
  }
  return out.length ? out : undefined;
}

// A whole number from 0 to `max`, from any finite number in that range, or null.
const layoutUnit = (value: unknown, max: number): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max
    ? Math.round(value)
    : null;
const layoutPair = (value: unknown, max: number): [number, number] | null => {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [x, y] = [layoutUnit(value[0], max), layoutUnit(value[1], max)];
  return x === null || y === null ? null : [x, y];
};
// Reads a network diagram layout (#1284, slice 4) with the flow graph's limits (LAYOUT_LIMITS):
// `stations` by station id, each one of `stations`; under `strict` (the trainLayout update) any
// malformed part refuses it, and otherwise that part is left out. Returns undefined when nothing
// is left, or null under `strict` for a malformed one.
function cleanTrainLayout(
  raw: unknown,
  stations: ReadonlySet<string>,
  strict: boolean,
): TrainLayout | undefined | null {
  if (!plain(raw)) return strict ? null : undefined;
  const layout: TrainLayout = {};
  if (raw.stations !== undefined) {
    if (!plain(raw.stations) && strict) return null;
    const spots: Record<string, [number, number]> = {};
    for (const [id, corner] of Object.entries(plain(raw.stations) ? raw.stations : {})) {
      const spot = layoutPair(corner, LAYOUT_LIMITS.coordinate);
      if (!spot || !stations.has(id)) {
        if (strict) return null;
        continue;
      }
      spots[id] = spot;
    }
    if (Object.keys(spots).length) layout.stations = spots;
  }
  if (raw.zoom !== undefined) {
    const zoom = raw.zoom;
    const fits =
      typeof zoom === 'number' &&
      Number.isFinite(zoom) &&
      zoom >= LAYOUT_LIMITS.zoomMin &&
      zoom <= LAYOUT_LIMITS.zoomMax;
    if (!fits && strict) return null;
    const kept = fits ? Math.round(zoom * 100) / 100 : 1;
    if (kept !== 1) layout.zoom = kept;
  }
  if (raw.pan !== undefined) {
    const pan = layoutPair(raw.pan, LAYOUT_LIMITS.pan);
    if (!pan && strict) return null;
    if (pan && (pan[0] || pan[1])) layout.pan = pan;
  }
  return Object.keys(layout).length ? layout : undefined;
}
// Returns a clean copy of trainLayout (#1284), or undefined when absent or when it says nothing:
// a spot of a station the profile does not have (any more) and any malformed part are left out.
export const validateTrainLayout = (
  raw: unknown,
  stations: readonly Pick<TrainStation, 'id'>[],
): TrainLayout | undefined =>
  raw === undefined
    ? undefined
    : (cleanTrainLayout(raw, new Set(stations.map(station => station.id)), false) ?? undefined);

// The update operations (mutate.ts): each writes one entry, checked whole.
// One train line (#1284, slice 2): a line whose id no line has is added after the others, one that
// exists is replaced where it is by what is sent, and null removes it (a line already gone stays
// gone). Its stops must be stations of the profile ("Unknown train station."). One line per
// write, so two tabs editing different lines never undo each other.
export function setTrainLine(
  lines: TrainLine[],
  stations: readonly Pick<TrainStation, 'id'>[],
  update: Raw,
): TrainLine[] {
  if (!trainLineId(update.id) || (update.value !== null && !plain(update.value)))
    fail('Invalid train line.');
  const at = lines.findIndex(line => line.id === update.id);
  if (update.value === null) return lines.filter(line => line.id !== update.id);
  const known = new Set(stations.map(station => station.id));
  const stops = update.value.stops;
  if (Array.isArray(stops) && stops.some(stop => trainStationId(stop) && !known.has(stop)))
    fail('Unknown train station.');
  const line = cleanTrainLine(
    { ...update.value, id: update.id },
    { stations: known, strict: true },
  );
  if (!line) fail('Invalid train line.');
  if (at < 0 && lines.length >= TRAIN_LINE_MAX)
    fail(`A profile holds at most ${TRAIN_LINE_MAX} train lines. Delete one to add another.`);
  return at < 0 ? [...lines, line] : lines.map((entry, i) => (i === at ? line : entry));
}
// The whole network diagram layout (#1284, slice 4): null or one that says nothing drops it.
export function setTrainLayout(
  stations: readonly Pick<TrainStation, 'id'>[],
  update: Raw,
): TrainLayout | undefined {
  if (update.layout === null) return undefined;
  const layout = cleanTrainLayout(
    update.layout,
    new Set(stations.map(station => station.id)),
    true,
  );
  if (layout === null) fail('Invalid train network layout.');
  return layout;
}
