// Flows between a calculated profile's factory groups (#184, part 1 of #68): for each pair of
// places, what moves from one to the other per minute. A place is a factory group, "Ungrouped"
// for rows (or shares of rows) in no group, each raw resource or existing-supply item as a source
// of its own (#231), and protected storage, drone fuel, vehicle fuel, the Space Elevator and the
// sink as destinations.
//
// A row's group shares come from its memberships (views/factories.ts): a fixed rate is that
// much of the row's primary output (MW for a generator), null-rate memberships split evenly
// whatever the fixed ones leave, and a row in no group, or the part no membership takes, is
// Ungrouped. Every
// input and output of the row is split by the same shares. An item's supply is then shared
// among everything that asks for it in proportion to what each asks, as elsewhere in the
// planner, so a balanced plan's flows add up to its rows exactly. Flows inside one place are
// left out: they are that group's own belts.
import { LINK_DUST, rowShares, rowTotal, UNGROUPED } from './group-order.ts';
import type { FactoryGroups, ItemRates, LinkTransport, StoredStage } from '../types/index.ts';

// Place ids that are not factory groups. UNGROUPED and rowShares live in group-order.ts, which
// the build plan's order shares (#869); they are exported here too for the pages that use them.
export { UNGROUPED, rowShares };
// The mines and existing supply as one place: how links from them were keyed before #231, and
// the id of the page's card for them. A vehicle saved on such a link applies to every item it
// carries (linkTransportFor below).
export const MINES = 'mines';
// Each raw resource and existing-supply item is a source of its own (#231): 'supply/Iron Ore'.
export const SOURCE = 'supply/';
export const sourceOf = (item: string) => SOURCE + item;
export const isSource = (place: string) => place.startsWith(SOURCE);
export const sourceItem = (place: string) => place.slice(SOURCE.length);
// The transport saved for the link from -> to: its own entry, or for a source, the entry the
// whole mines link had before #231 ('mines:<to>'), until one of its items gets a choice.
export function linkTransportFor(
  links: FactoryGroups['links'],
  from: string,
  to: string,
): LinkTransport | undefined {
  return links?.[from + ':' + to] ?? (isSource(from) ? links?.[MINES + ':' + to] : undefined);
}
export const OUTSIDE = {
  storage: 'storage',
  drone: 'drone',
  // Fuel for the vehicles on the links themselves (#206).
  transport: 'vehicles',
  delivery: 'elevator',
  surplus: 'sink',
} as const;

// Names for the places that are not factory groups, as the Logistics page shows them.
export const PLACE_NAMES: Record<string, string> = {
  [UNGROUPED]: 'Ungrouped',
  [OUTSIDE.storage]: 'Protected storage',
  [OUTSIDE.drone]: 'Drone fuel',
  [OUTSIDE.transport]: 'Vehicle fuel',
  [OUTSIDE.delivery]: 'Space Elevator',
  [OUTSIDE.surplus]: 'AWESOME Sink',
};
// The name of place `id` in a phase that mines `raw`: a group's own name, a source (#231) named
// by its item (one the phase does not mine is existing supply), or one of PLACE_NAMES.
export function placeName(
  id: string,
  groups: FactoryGroups['groups'],
  raw: ItemRates | undefined,
): string {
  return isSource(id)
    ? sourceItem(id) + (raw?.[sourceItem(id)] ? '' : ' (existing supply)')
    : (groups.find(group => group.id === id)?.name ?? PLACE_NAMES[id] ?? id);
}

export interface GroupLink {
  from: string;
  to: string;
  // Per minute, largest first.
  items: { item: string; rate: number }[];
}

export function groupLinks(stage: StoredStage, groups: FactoryGroups): GroupLink[] {
  const known = new Set(groups.groups.map(g => g.id));
  // Per item: what each place makes and what each place asks for.
  const supply: Record<string, Map<string, number>> = {};
  const demand: Record<string, Map<string, number>> = {};
  const put = (
    books: Record<string, Map<string, number>>,
    item: string,
    place: string,
    rate: number,
  ) => {
    if (rate <= LINK_DUST) return;
    const placeRates = (books[item] ??= new Map());
    placeRates.set(place, (placeRates.get(place) || 0) + rate);
  };
  for (const row of stage.rows || []) {
    const total = rowTotal(row);
    // A membership in a group that no longer exists counts as ungrouped.
    const memberships = (groups.assignments[row.id] || []).map(membership =>
      known.has(membership.group) ? membership : { ...membership, group: UNGROUPED },
    );
    for (const [place, share] of rowShares(total, memberships)) {
      for (const [item, rate] of Object.entries(row.outputs || {}))
        put(supply, item, place, rate * share);
      for (const [item, rate] of Object.entries(row.inputs || {}))
        put(demand, item, place, rate * share);
    }
  }
  for (const books of [stage.raw, stage.supplied] as (ItemRates | undefined)[])
    for (const [item, rate] of Object.entries(books || {})) put(supply, item, sourceOf(item), rate);
  for (const [item, rate] of Object.entries(stage.storage || {}))
    put(demand, item, OUTSIDE.storage, rate);
  for (const [item, rate] of Object.entries(stage.drone || {}))
    put(demand, item, OUTSIDE.drone, rate);
  for (const [item, rate] of Object.entries(stage.transport || {}))
    put(demand, item, OUTSIDE.transport, rate);
  for (const [item, delivery] of Object.entries(stage.delivery || {}))
    put(demand, item, OUTSIDE.delivery, delivery.rate || 0);
  for (const [item, rate] of Object.entries(stage.surplus || {}))
    put(demand, item, OUTSIDE.surplus, rate);
  // Share each item's supply out in proportion to demand.
  const links = new Map<string, GroupLink>();
  for (const [item, sources] of Object.entries(supply)) {
    const sinks = demand[item];
    if (!sinks) continue;
    const made = [...sources.values()].reduce((sum, rate) => sum + rate, 0);
    const asked = [...sinks.values()].reduce((sum, rate) => sum + rate, 0);
    // What actually moves: the smaller of the two, split both ways by share.
    const moved = Math.min(made, asked);
    for (const [from, supplied] of sources)
      for (const [to, wanted] of sinks) {
        if (from === to) continue;
        const rate = (moved * supplied * wanted) / (made * asked);
        if (rate <= LINK_DUST) continue;
        const key = from + '\u0000' + to;
        const link = links.get(key) ?? { from, to, items: [] };
        link.items.push({ item, rate });
        links.set(key, link);
      }
  }
  const total = (link: GroupLink) => link.items.reduce((sum, entry) => sum + entry.rate, 0);
  for (const link of links.values()) link.items.sort((a, b) => b.rate - a.rate);
  return [...links.values()].sort((a, b) => total(b) - total(a));
}
