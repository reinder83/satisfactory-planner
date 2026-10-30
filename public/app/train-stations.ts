// Train stations (#1284, slice 1 of 4): the words for a station's owner and platforms, a new
// station's id and name, the cargo a loading platform may pick, and the editor's platform list
// operations (add, change kind, move, remove), which never change the platforms they are given.
// The saved shape and its limits are in state/validate.ts (validateTrainStations:
// `trainStations`, state version 29); the page is ui/logistics/TrainStations.vue and the editor
// ui/detail/StationDialog.vue.
import { BELT_MARKS, minedResources } from '../preferences.ts';
import { ITEM_NAMES } from '../state.ts';
import type {
  BeltMark,
  FactoryGroup,
  NodePurityCounts,
  StationOwner,
  TrainPlatform,
  TrainPlatformKind,
  TrainStation,
} from '../types/index.ts';
import { listNames } from '../wording.ts';

// What a platform does, as the editor's select and the station's list name it.
export const PLATFORM_KINDS: Record<TrainPlatformKind, string> = {
  load: 'Load',
  unload: 'Unload',
  empty: 'Empty platform',
};
// The belt marks a platform can pick: 1 to 6, with each belt's rate. A function, as is
// outpostResources below: the VM interface tests (tests/helpers/app-source.ts) run this module
// without the shared modules' exports unless a test supplies them.
export const beltChoices = (): { mark: BeltMark; label: string }[] =>
  BELT_MARKS.map((belt, i) => ({
    mark: (i + 1) as BeltMark,
    label: `${belt.mark} (${belt.cap.toLocaleString('en-US')}/min)`,
  }));
export const beltLabel = (mark: BeltMark | undefined): string =>
  mark ? (beltChoices()[mark - 1]?.label ?? '') : '';
// What a loading platform's cargo can be: the solid items, which go by belt into a freight wagon
// (`fluids` is flow.ts's FLUIDS, passed in because flow.ts brings the page's modules along).
export const cargoItems = (fluids: ReadonlySet<string>): string[] =>
  ITEM_NAMES.filter(item => !fluids.has(item));
// What a mining outpost can mine: the ordinary nodes' resources.
export const outpostResources = (): readonly string[] => minedResources;
export const PURITIES: [purity: keyof NodePurityCounts, label: string][] = [
  ['pure', 'Pure'],
  ['normal', 'Normal'],
  ['impure', 'Impure'],
];

// A new station's id: 'ts-' and ten random characters.
export function newStationId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return 'ts-' + [...bytes].map(byte => (byte % 36).toString(36)).join('');
}
// The name a new station starts with, "Station 4", one no station has yet.
export function newStationName(stations: Pick<TrainStation, 'name'>[]): string {
  const taken = new Set(stations.map(station => station.name));
  let number = stations.length + 1;
  while (taken.has(`Station ${number}`)) number++;
  return `Station ${number}`;
}

// The nodes of a mining outpost in words: "3 pure and 1 normal nodes", "1 pure node", or '' for
// none entered.
export function nodesText(nodes: NodePurityCounts): string {
  const parts = PURITIES.filter(([purity]) => nodes[purity]).map(
    ([purity]) => `${nodes[purity]} ${purity}`,
  );
  if (!parts.length) return '';
  const total = PURITIES.reduce((sum, [purity]) => sum + (nodes[purity] ?? 0), 0);
  return `${listNames(parts)} ${total === 1 ? 'node' : 'nodes'}`;
}
// Who a station belongs to, in words: "Factory: Plates", "Mining outpost: Iron Ore on 3 pure
// nodes", "Storage", or "No owner set". A factory not among `groups` reads as no owner (validation
// drops such an owner, so this only covers a page drawn before it).
export function ownerText(
  owner: StationOwner | undefined,
  groups: readonly Pick<FactoryGroup, 'id' | 'name'>[],
): string {
  if (owner?.kind === 'storage') return 'Storage';
  if (owner?.kind === 'outpost') {
    const nodes = nodesText(owner.nodes);
    return `Mining outpost: ${owner.resource}${nodes ? ` on ${nodes}` : ''}`;
  }
  const group = owner && groups.find(entry => entry.id === owner.id);
  return group ? `Factory: ${group.name}` : 'No owner set';
}
// One platform in words, for the station's list: "Load Iron Ore · Mk.4 (480/min)", "Load
// (no cargo picked)", "Unload · Mk.3 (270/min)", "Empty platform".
export function platformText(platform: TrainPlatform): string {
  if (platform.kind === 'empty') return PLATFORM_KINDS.empty;
  const belt = beltLabel(platform.belt);
  const what =
    platform.kind === 'load'
      ? `Load ${platform.cargo.length ? listNames(platform.cargo) : '(no cargo picked)'}`
      : 'Unload';
  return belt ? `${what} · ${belt} belt` : what;
}
// How many platforms of each kind, for a station's summary: "3 platforms: 2 load, 1 empty".
export function platformCounts(platforms: readonly TrainPlatform[]): string {
  if (!platforms.length) return 'No platforms yet';
  const counts = (Object.keys(PLATFORM_KINDS) as TrainPlatformKind[])
    .map(kind => [kind, platforms.filter(platform => platform.kind === kind).length] as const)
    .filter(([, count]) => count)
    .map(([kind, count]) => `${count} ${kind === 'empty' ? 'empty' : kind}`);
  return `${platforms.length} ${platforms.length === 1 ? 'platform' : 'platforms'}: ${counts.join(', ')}`;
}

// The editor's operations on a station's platforms, each returning a new list.
// Platform `from` turned into a platform of `kind`, keeping what it can: the belt between load and
// unload, the cargo while it stays a load platform. A new load platform has no cargo yet.
export function platformOfKind(kind: TrainPlatformKind, from?: TrainPlatform): TrainPlatform {
  const belt = from && from.kind !== 'empty' ? from.belt : undefined;
  const withBelt = belt ? { belt } : {};
  if (kind === 'empty') return { kind: 'empty' };
  if (kind === 'unload') return { kind: 'unload', ...withBelt };
  return { kind: 'load', cargo: from?.kind === 'load' ? [...from.cargo] : [], ...withBelt };
}
// `list` (the editor's platforms) with entry `at` moved `by` places (-1 up, +1 down), or as it was
// when that would leave the list.
export function moveAt<T>(list: readonly T[], at: number, by: -1 | 1): T[] {
  const to = at + by;
  if (at < 0 || at >= list.length || to < 0 || to >= list.length) return [...list];
  const out = [...list];
  [out[at], out[to]] = [out[to]!, out[at]!];
  return out;
}
export const removeAt = <T>(list: readonly T[], at: number): T[] => list.filter((_, i) => i !== at);

// The toasts of a deleted station and of its Undo.
export const stationDeletedNews = (name: string) => `Deleted train station “${name}”.`;
export const stationRestoredNews = (name: string) => `Train station “${name}” is back.`;
