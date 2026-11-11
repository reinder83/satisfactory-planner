// What the Undo of "Remove factory" puts back (#1334, X-4). Removing a factory (factoryGroupRemove)
// drops the factory with its share of every production line's assignment, its links, the items it
// made on site and its pin on the world map, and leaves the train stations it owned without an
// owner. The production lines and their progress stay. Undo sends one factoryGroupRestore update
// (state/mutate.ts) built from the state the tab showed before the removal, so the factory comes
// back in the same place in the list with all of that. Nothing here writes.
import type {
  FactoryGroups,
  FactoryPlace,
  LinkTransport,
  ProgressState,
  UpdateOp,
} from '../types/index.ts';

export type FactoryRestore = Extract<UpdateOp, { type: 'factoryGroupRestore' }>;

// The update that puts factory `id` back, from `state` as it is before the removal; null when the
// state has no such factory.
export function restoreUpdate(
  state: Pick<ProgressState, 'factoryGroups' | 'factoryPlaces' | 'trainStations'>,
  id: string,
): FactoryRestore | null {
  const factory: FactoryGroups | undefined = state.factoryGroups;
  const index = factory?.groups.findIndex(group => group.id === id) ?? -1;
  if (!factory || index < 0) return null;
  const links: Record<string, LinkTransport> = {};
  for (const [key, transport] of Object.entries(factory.links ?? {}))
    if (key.split(':').includes(id)) links[key] = { ...transport };
  const place: FactoryPlace | undefined = state.factoryPlaces?.[id];
  const stations = (state.trainStations ?? [])
    .filter(station => station.owner?.kind === 'factory' && station.owner.id === id)
    .map(station => station.id);
  return {
    type: 'factoryGroupRestore',
    group: structuredClone(factory.groups[index]!),
    index,
    assignments: Object.entries(factory.assignments).flatMap(([key, list]) => {
      const at = list.findIndex(member => member.group === id);
      return at < 0 ? [] : [{ key, index: at, rate: list[at]!.rate }];
    }),
    ...(Object.keys(links).length ? { links } : {}),
    ...(factory.local?.[id]?.length ? { local: [...factory.local[id]] } : {}),
    ...(place ? { place: { x: place.x, y: place.y } } : {}),
    ...(stations.length ? { stations } : {}),
  };
}

// The toasts.
export const factoryGoneNews = (name: string) =>
  `Removed “${name}”. Its production lines stay in the list with their progress.`;
export const factoryBackNews = (name: string) =>
  `“${name}” is back, with its production lines, links and place.`;
