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
import type { FactoryGroups, ItemRates, LinkTransport, StoredStage } from '../types/index.ts';

// Place ids that are not factory groups.
export const UNGROUPED = 'ungrouped';
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

export interface GroupLink {
  from: string;
  to: string;
  // Per minute, largest first.
  items: { item: string; rate: number }[];
}

// Rates this small are rounding dust.
const LINK_DUST = 1e-6;

// The share of a row that sits in each place (group id or UNGROUPED), adding up to 1.
export function rowShares(
  total: number,
  memberships: { group: string; rate: number | null }[] | undefined,
): Map<string, number> {
  const shares = new Map<string, number>();
  const add = (place: string, x: number) => {
    if (x > LINK_DUST) shares.set(place, (shares.get(place) || 0) + x);
  };
  if (!memberships?.length || total <= LINK_DUST) {
    shares.set(UNGROUPED, 1);
    return shares;
  }
  const fixed = memberships.filter(m => m.rate != null);
  let taken = 0;
  for (const m of fixed) {
    // Fixed rates past the row's total are capped at what is left.
    const x = Math.min(m.rate! / total, 1 - taken);
    add(m.group, x);
    taken += Math.max(0, x);
  }
  // What the fixed rates leave is split evenly between the memberships without a rate (a row
  // just added to a second group has two), or is Ungrouped when every membership has a rate.
  // The factory cards (allocationText in views/factories.ts) use the same rule (#197).
  const rest = Math.max(0, 1 - taken);
  const open = memberships.filter(m => m.rate == null);
  if (open.length) for (const m of open) add(m.group, rest / open.length);
  else add(UNGROUPED, rest);
  return shares;
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
    const m = (books[item] ??= new Map());
    m.set(place, (m.get(place) || 0) + rate);
  };
  for (const r of stage.rows || []) {
    const total = Object.values(r.outputs || {})[0] || r.generationMW || 0;
    // A membership in a group that no longer exists counts as ungrouped.
    const memberships = (groups.assignments[r.id] || []).map(m =>
      known.has(m.group) ? m : { ...m, group: UNGROUPED },
    );
    for (const [place, share] of rowShares(total, memberships)) {
      for (const [n, q] of Object.entries(r.outputs || {})) put(supply, n, place, q * share);
      for (const [n, q] of Object.entries(r.inputs || {})) put(demand, n, place, q * share);
    }
  }
  for (const books of [stage.raw, stage.supplied] as (ItemRates | undefined)[])
    for (const [n, q] of Object.entries(books || {})) put(supply, n, sourceOf(n), q);
  for (const [n, q] of Object.entries(stage.storage || {})) put(demand, n, OUTSIDE.storage, q);
  for (const [n, q] of Object.entries(stage.drone || {})) put(demand, n, OUTSIDE.drone, q);
  for (const [n, q] of Object.entries(stage.transport || {})) put(demand, n, OUTSIDE.transport, q);
  for (const [n, d] of Object.entries(stage.delivery || {}))
    put(demand, n, OUTSIDE.delivery, d.rate || 0);
  for (const [n, q] of Object.entries(stage.surplus || {})) put(demand, n, OUTSIDE.surplus, q);
  // Share each item's supply out in proportion to demand.
  const links = new Map<string, GroupLink>();
  for (const [n, sources] of Object.entries(supply)) {
    const sinks = demand[n];
    if (!sinks) continue;
    const made = [...sources.values()].reduce((a, b) => a + b, 0);
    const asked = [...sinks.values()].reduce((a, b) => a + b, 0);
    // What actually moves: the smaller of the two, split both ways by share.
    const moved = Math.min(made, asked);
    for (const [from, s] of sources)
      for (const [to, d] of sinks) {
        if (from === to) continue;
        const rate = (moved * s * d) / (made * asked);
        if (rate <= LINK_DUST) continue;
        const key = from + '\u0000' + to;
        const link = links.get(key) ?? { from, to, items: [] };
        link.items.push({ item: n, rate });
        links.set(key, link);
      }
  }
  const total = (l: GroupLink) => l.items.reduce((a, x) => a + x.rate, 0);
  for (const l of links.values()) l.items.sort((a, b) => b.rate - a.rate);
  return [...links.values()].sort((a, b) => total(b) - total(a));
}
