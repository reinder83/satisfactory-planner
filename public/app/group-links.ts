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
// input and output of the row is split by the same shares. An item's supply is then shared out
// by one rule (shareOut, #1022, #1028): each place uses what its own lines make first; a place's
// leftover goes to the group short of the most, then the next; what is still left goes to
// protected storage, fuel, the Space Elevator and last the sink; and the raw resources and
// existing supply cover what is still missing. So a balanced plan's flows add up to its rows
// exactly, and no item goes both ways between two places. Flows inside one place are left out:
// they are that group's own belts.
//
// A factory group's own line made on site (#875, #876: `onSite`) sits wholly in its group. For
// the items the plan was calculated to make on site for that group (siteItems) it supplies only
// the group's own demand, its share of each consumer, which is what the planner sized it to; what
// it makes beyond that goes to the sink rather than to other groups (onSiteBooks). So two groups
// that both make Wire on site have no Wire link between them, and a central Wire line serves the
// remaining consumers. Should a group edit after the recalculation leave the group asking for less
// than that (#918), the sink still takes only the plan's surplus, and the rest is offered to the
// other places as ordinary supply, so the books keep balancing without a recalculation. A plan
// whose central line of the item would have sunk almost all it made routes the group's excess to
// the central demand instead (#1063, withOverflow in planner/on-site.ts): its surplus leaves that
// part out, so the books offer it the same way.
import { LINK_DUST, rowPlaces, rowShares, UNGROUPED } from './group-order.ts';
import type {
  FactoryGroups,
  ItemRates,
  LinkTransport,
  OnSiteSettings,
  StoredStage,
} from '../types/index.ts';

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

// The items a group's own lines made on site keep inside the group (#1003): those the plan was
// calculated to make on site for it (`planned`, the plan's settings.onSite), as the planner routes
// them (siteRoutes in planner/on-site.ts). Any other output of such a line is ordinary supply, as
// from a central line of its recipe: Water from its Aluminum Scrap line though the group marks
// Water (a raw resource, never made on site), or an item the group marked after the
// recalculation. Without the setting (a plan stored without it has no such lines) the group's
// marks (factoryGroups.local) stand in, as before.
export const siteItems = (
  groups: FactoryGroups,
  group: string,
  planned: OnSiteSettings | undefined,
): readonly string[] => (planned ? planned[group]?.items : groups.local?.[group]) || [];

// Per item, what each place makes (`supply`) and what each place asks for (`demand`), per minute.
// `sunk`: per item, what a group's own lines made on site make beyond the group's own demand,
// which goes straight to the sink (#876), up to the plan's surplus for the item. A group's own
// lines' supply of an item made on site for the group (siteItems), and the demand it meets, are
// left out of `supply` and `demand`: they stay inside the group.
// `offered`: per item, the part of a group's own lines' excess the sink has no room for (#918:
// the group asks for less since a group edit; #1063: the plan routed it to the central demand).
// It is in `supply` too, at the group, as ordinary supply the other places share; empty while the
// groups are as the plan was calculated for, unless the plan routed some.
// `local`: per item and group, what that group's own lines make of an item made on site for it
// (`made`) and what the group asked for it before they met it (`asked`), so a group's flow
// (group-flow.ts) and the factory dialog (flow.ts) share those lines out by the same rule.
export interface ItemBooks {
  supply: Record<string, Map<string, number>>;
  demand: Record<string, Map<string, number>>;
  sunk: Record<string, Map<string, number>>;
  offered: Record<string, Map<string, number>>;
  local: Record<string, Map<string, { made: number; asked: number }>>;
}

// The books groupLinks shares out: every row's inputs and outputs split by its places
// (rowPlaces), the raw resources and existing supply as sources, and protected storage, drone
// fuel, vehicle fuel, the Space Elevator and the sink as destinations. `planned` is the plan's
// settings.onSite (siteItems).
export function itemBooks(
  stage: StoredStage,
  groups: FactoryGroups,
  planned?: OnSiteSettings,
): ItemBooks {
  const supply: Record<string, Map<string, number>> = {};
  const demand: Record<string, Map<string, number>> = {};
  // What groups' own lines make of the items made on site for those groups, per item and group.
  const onSite: Record<string, Map<string, number>> = {};
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
    // A membership in a group that no longer exists counts as ungrouped.
    for (const [place, share] of rowPlaces(row, groups)) {
      const own = row.onSite?.group === place ? siteItems(groups, place, planned) : [];
      for (const [item, rate] of Object.entries(row.outputs || {}))
        put(own.includes(item) ? onSite : supply, item, place, rate * share);
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
  const local: ItemBooks['local'] = {};
  for (const [item, groupsMaking] of Object.entries(onSite))
    for (const [group, made] of groupsMaking)
      (local[item] ??= new Map()).set(group, { made, asked: demand[item]?.get(group) || 0 });
  return { supply, demand, ...onSiteBooks(onSite, supply, demand), local };
}

// Each group's own lines made on site meet that group's own demand for the item first (#876):
// that part leaves `demand`, and what the lines make beyond it is returned as going to the sink
// (`sunk`), taken off the sink's demand. Should the group ask for more than its lines make
// (memberships changed since the plan was calculated), the rest of its demand stays in
// `demand`, for the other supply of the item. Should the groups' excess be more than the sink's
// demand (#918: a group asks for less since a group edit), the sink takes only its demand, from
// each group in proportion to its excess, and the rest is `offered`: added to `supply` at the
// group, so the places that now ask for it more get it.
function onSiteBooks(
  onSite: Record<string, Map<string, number>>,
  supply: Record<string, Map<string, number>>,
  demand: Record<string, Map<string, number>>,
): Pick<ItemBooks, 'sunk' | 'offered'> {
  const sunk: ItemBooks['sunk'] = {};
  const offered: ItemBooks['offered'] = {};
  for (const [item, groupsMaking] of Object.entries(onSite)) {
    const asks = demand[item] ?? new Map<string, number>();
    const excess = new Map<string, number>();
    for (const [group, made] of groupsMaking) {
      const met = Math.min(made, asks.get(group) || 0);
      lowerDemand(asks, group, met);
      if (made - met > LINK_DUST) excess.set(group, made - met);
    }
    const room = asks.get(OUTSIDE.surplus) || 0,
      over = placeTotal(excess);
    for (const [group, rate] of excess) {
      // The sink's room is all of the excess, unless the groups changed since the plan.
      const sinks = over - room > LINK_DUST ? (rate * room) / over : rate;
      if (sinks > LINK_DUST) (sunk[item] ??= new Map()).set(group, sinks);
      lowerDemand(asks, OUTSIDE.surplus, sinks);
      if (rate - sinks > LINK_DUST) {
        (offered[item] ??= new Map()).set(group, rate - sinks);
        const places = (supply[item] ??= new Map());
        places.set(group, (places.get(group) || 0) + rate - sinks);
      }
    }
    if (asks.size) demand[item] = asks;
    else delete demand[item];
  }
  return { sunk, offered };
}

// Takes `rate` off what `place` asks for, dropping the place once nothing is left (never below 0).
function lowerDemand(places: Map<string, number>, place: string, rate: number) {
  const left = (places.get(place) || 0) - rate;
  if (left > LINK_DUST) places.set(place, left);
  else places.delete(place);
}

// What moves between two places of an item whose places make `made` and ask `asked` in all:
// the smaller of the two, split both ways by share. `supplied` and `wanted` are the two places'
// parts. group-flow.ts shares a group's lines out among themselves by it, after each line's own
// use, and flow.ts the leftover of groups' own lines made on site (#918).
export const sharedRate = (made: number, asked: number, supplied: number, wanted: number): number =>
  (Math.min(made, asked) * supplied * wanted) / (made * asked);

// The sum of a place map's rates.
export const placeTotal = (places: Map<string, number> | undefined): number =>
  [...(places?.values() || [])].reduce((sum, rate) => sum + rate, 0);

// One part of an item's supply going from one place to another (shareOut); `from` and `to` are
// the same place for what a place uses of its own.
export interface PlaceTransfer {
  from: string;
  to: string;
  rate: number;
}

// The destinations that are not factory groups, in the order a leftover reaches them: protected
// storage first and the sink last, which takes only what nothing else asks for.
const OUTSIDE_ORDER: string[] = [
  OUTSIDE.storage,
  OUTSIDE.drone,
  OUTSIDE.transport,
  OUTSIDE.delivery,
  OUTSIDE.surplus,
];
const isOutside = (place: string) => OUTSIDE_ORDER.includes(place);
const isMaker = (place: string) => !isSource(place);

// How one item's supply (`sources`, per place) meets what places ask for (`sinks`), by the rule
// the Logistics page, a group's flow and the factory dialog share (#1022, #1028):
// 1. each place uses what its own lines make, up to what it asks for;
// 2. a group's (or Ungrouped's) leftover goes to the group short of the most, then the next, the
//    largest leftover first, so each leftover takes as few links as it can;
// 3. what is still left goes to the destinations in OUTSIDE_ORDER (storage first, the sink last);
// 4. the raw resources and existing supply (sources, #231) cover what is still missing, the
//    groups' shortfalls first, then the destinations.
// So no item goes both ways between two places: a place with a leftover asks for nothing more.
// Ties go by the maps' order. Each transfer is above LINK_DUST.
export function shareOut(
  sources: ReadonlyMap<string, number>,
  sinks: ReadonlyMap<string, number>,
): PlaceTransfer[] {
  const left = new Map(sources),
    short = new Map(sinks);
  const transfers: PlaceTransfer[] = [];
  const move = (from: string, to: string, rate: number) => {
    if (rate > LINK_DUST) transfers.push({ from, to, rate });
    lowerDemand(left, from, rate);
    lowerDemand(short, to, rate);
  };
  for (const [place, made] of sources) {
    const own = Math.min(made, short.get(place) || 0);
    if (own > 0) move(place, place, own);
  }
  for (const giver of [isMaker, isSource]) {
    pourLargest(left, short, giver, place => !isOutside(place), move);
    for (const place of OUTSIDE_ORDER) pourLargest(left, short, giver, to => to === place, move);
  }
  return transfers;
}

// Moves the largest leftover among the places `from` accepts to the largest shortfall among those
// `to` accepts, again and again until one side has none left (shareOut).
function pourLargest(
  left: Map<string, number>,
  short: Map<string, number>,
  from: (place: string) => boolean,
  to: (place: string) => boolean,
  move: (from: string, to: string, rate: number) => void,
) {
  for (;;) {
    const giver = largestOf(left, from),
      taker = largestOf(short, to);
    if (!giver || !taker) return;
    move(giver[0], taker[0], Math.min(giver[1], taker[1]));
  }
}

// The place with the largest rate above LINK_DUST among those `accept` takes; the first on a tie.
function largestOf(
  places: Map<string, number>,
  accept: (place: string) => boolean,
): [string, number] | undefined {
  let best: [string, number] | undefined;
  for (const entry of places)
    if (accept(entry[0]) && entry[1] > LINK_DUST && (!best || entry[1] > best[1])) best = entry;
  return best;
}

// What moves between the places of a phase, from its books (itemBooks; `planned` is the plan's
// settings.onSite).
export function groupLinks(
  stage: StoredStage,
  groups: FactoryGroups,
  planned?: OnSiteSettings,
): GroupLink[] {
  const { supply, demand, sunk } = itemBooks(stage, groups, planned);
  const links = new Map<string, GroupLink>();
  const add = (from: string, to: string, item: string, rate: number) => {
    const key = from + '\u0000' + to;
    const link = links.get(key) ?? { from, to, items: [] };
    link.items.push({ item, rate });
    links.set(key, link);
  };
  // Share each item's supply out by the rule (shareOut); what a place uses of its own stays inside.
  for (const [item, sources] of Object.entries(supply)) {
    const sinks = demand[item];
    if (!sinks) continue;
    for (const { from, to, rate } of shareOut(sources, sinks))
      if (from !== to) add(from, to, item, rate);
  }
  // What a group's own lines made on site make beyond the group's demand goes to the sink.
  for (const [item, groupsSinking] of Object.entries(sunk))
    for (const [group, rate] of groupsSinking) add(group, OUTSIDE.surplus, item, rate);
  const total = (link: GroupLink) => link.items.reduce((sum, entry) => sum + entry.rate, 0);
  for (const link of links.values()) link.items.sort((a, b) => b.rate - a.rate);
  return [...links.values()].sort((a, b) => total(b) - total(a));
}
