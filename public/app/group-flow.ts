// The flow of one factory group (#883, #893): the data behind the group's flow page (#894),
// which draws each line as a card in the build plan's order, its inputs and outputs as rows, and
// the links between the group's own lines as item lanes in a gutter to the left of the cards.
//
// It is counted from the same books as the Logistics page (itemBooks and groupLinks in
// group-links.ts), so it agrees with "Between groups":
// - a split row counts only the group's share of it (rowPlaces in group-order.ts);
// - inside the group, an item moves by the rule groupLinks shares an item between places by
//   (shareOut, #1022), with the lines as the places: a line whose recipe both uses and makes an
//   item (Distilled Silica's water, #898) takes its own back first, a self link from and to the
//   same line, marked `self`; then each line making the item gives each line using it its part
//   of what is left, in proportion to what each makes and still uses (sharedRate);
// - what comes in from outside the group and what leaves it are groupLinks' own links, each
//   shared among the group's lines in proportion to what each still uses, or has left, after the
//   links inside the group.
// So the links into an input row add up to its rate, and the links out of an output row to its
// rate, whenever the plan makes what it asks for.
//
// Lines are keyed by their plan row's id and placed by rowPlaces alone, so a per-group line
// (#868, #896: a row that belongs wholly to one group) is a line of its own in that group with
// no change here; for an item its group makes on site, it feeds that group's own lines first
// (#876, insideLinks). The caller names each line (LineName), so the page names a group's own
// line as its build-plan step does, "Wire for Alpha" (#896). Everything in the model is data:
// the page measures and draws it.
import { groupedRows, LINK_DUST, rowPlaces } from './group-order.ts';
import {
  groupLinks,
  isSource,
  itemBooks,
  OUTSIDE,
  placeName,
  sharedRate,
  sourceItem,
  UNGROUPED,
} from './group-links.ts';
import type { GroupLink, ItemBooks } from './group-links.ts';
import type { CalcRow, FactoryGroups, OnSiteSettings, StoredStage } from '../types/index.ts';

// The belts or pipes that carry `rate` of `item`, in the factory dialog's words: the page
// passes itemBelts (flow.ts) at the phase it shows, "2 × Mk.3 belts".
export type BeltsFor = (item: string, rate: number) => string;

// How the items of one link into or out of the group travel (#1067), as the Logistics page has
// that link: the page passes linkItemWords (logistics.ts), so a link by train there says "by
// freight train" here, extracted Water "Water Extractors here", and a trickle item its mixed belt.
// It gives the words for the link's items (BeltsFor), for the port and for each line's part of
// it. Without one, every port takes the group's belts (`belts`).
export type LinkWords = (link: GroupLink) => BeltsFor;

// A line's name. The page passes buildRowName (views/calculated.ts), the build plan's step title
// (rowStepTitle), so a group's own line made on site is "Wire for Alpha" there as here (#896).
// Without one a line is named after its row: the recipe's name.
export type LineName = (row: CalcRow) => string;
const rowName: LineName = row => row.name;

// One end of a link: a line of the group, by its row id, or a place outside the group (another
// group, Ungrouped, a raw resource or existing-supply source, or a destination from
// group-links.ts).
export type FlowEnd = { kind: 'line'; id: string } | { kind: 'place'; id: string };

// Something that moves per minute from one end to the other.
export interface FlowLink {
  item: string;
  rate: number;
  belts: string;
  from: FlowEnd;
  to: FlowEnd;
  // A link inside the group to a line built before the one making it (a recycling loop): the
  // later line needs a starter batch.
  loop: boolean;
  // A line's own output going back into itself (#898): `from` and `to` are the same line. It
  // rides no lane (assignLanes), so the page shows it as "from itself"; it is never a loop.
  self: boolean;
}

// An input or output row of a line: one item at the group's share of the row's rate.
export interface FlowRow {
  // 'in|<row id>|<item>' or 'out|<row id>|<item>', unique in the flow.
  id: string;
  item: string;
  rate: number;
  belts: string;
  // An input row's sources, an output row's destinations: the group's lines by number, then
  // the places outside it in the order of `ins` or `outs`.
  links: FlowLink[];
}

// A line of the group: the part of a plan row that sits in it.
export interface FlowLine {
  // The plan row's id.
  id: string;
  // Its place in the group's build order, from 1.
  no: number;
  // The recipe's name, and the line's name as the page shows it (LineName).
  recipe: string;
  name: string;
  machine: string;
  // The row's whole machines with the last one's clock in %, the group's share of the row
  // (1 unless the row is split between places) and the machines that share comes to.
  machines: number;
  lastClock: number;
  share: number;
  machinesHere: number;
  // A generator's MW here; 0 for any other line.
  mw: number;
  inputs: FlowRow[];
  outputs: FlowRow[];
}

// What a place outside the group is: a mined raw resource, existing supply, another group,
// rows in no group, or a destination (storage, fuel, the Space Elevator, the sink).
export type PortKind = 'raw' | 'supply' | 'group' | 'ungrouped' | 'outside';
const PORT_ORDER: PortKind[] = ['raw', 'supply', 'group', 'ungrouped', 'outside'];

// One item that comes in from a place outside the group, or leaves the group for one.
export interface FlowPort {
  place: string;
  label: string;
  kind: PortKind;
  item: string;
  rate: number;
  belts: string;
}

// The AWESOME Sink and protected storage, folded into one "Sink & storage" summary: how many
// items and how much per minute in all, with the ports themselves as its details.
export interface FlowFold {
  items: number;
  rate: number;
  ports: FlowPort[];
}
const FOLDED = new Set<string>([OUTSIDE.surplus, OUTSIDE.storage]);

// The lane of one output row: every link from that row to the group's own lines runs on it.
// Lane 0 is the one nearest the cards.
export interface FlowLane {
  lane: number;
  line: string;
  item: string;
  // The output row's id and the input rows it feeds, in the cards' order.
  from: string;
  to: string[];
  links: FlowLink[];
}

export interface GroupFlow {
  group: string;
  lines: FlowLine[];
  // What comes in, and what leaves for anywhere but the sink and storage; by kind, then the
  // largest rate first.
  ins: FlowPort[];
  outs: FlowPort[];
  fold: FlowFold;
  lanes: FlowLane[];
  laneCount: number;
  // Whether any line is only partly in the group.
  split: boolean;
}

interface GroupPart {
  row: CalcRow;
  share: number;
}

// The rows with a share in the group, in the build plan's order (groupedRows, #869). rowPlaces
// gives no place a share too small to count (LINK_DUST, #906), so the books (itemBooks) count
// exactly these lines' shares.
const groupParts = (stage: StoredStage, groups: FactoryGroups, groupId: string): GroupPart[] =>
  groupedRows(stage.rows || [], groups)
    .map(row => ({ row, share: rowPlaces(row, groups).get(groupId) || 0 }))
    .filter(part => part.share > LINK_DUST);

const lineEnd = (part: GroupPart): FlowEnd => ({ kind: 'line', id: part.row.id });
const madeBy = (part: GroupPart, item: string) => (part.row.outputs?.[item] || 0) * part.share;
const usedBy = (part: GroupPart, item: string) => (part.row.inputs?.[item] || 0) * part.share;

// The links between the group's own lines, by maker, its outputs in order, then user, by the
// rule groupLinks shares an item between places by (shareOut, #1022): a line that uses what it
// makes takes it back first, as a self link to itself (#898), and the group's lines then share
// what their makers have left in proportion to what each makes and still uses (sharedRate).
// For an item the group makes on site (#876, ItemBooks.local) its own lines meet its own demand
// first, by sharedRate among themselves; the other lines making it share out only the part of
// each user's demand they leave, by the same rule.
function insideLinks(
  parts: GroupPart[],
  books: ItemBooks,
  belts: BeltsFor,
  groupId: string,
): FlowLink[] {
  const links: FlowLink[] = [];
  const shares = new Map<string, InsideShares>();
  parts.forEach((maker, makerIndex) => {
    for (const item of Object.keys(maker.row.outputs || {})) {
      const supplied = madeBy(maker, item);
      if (supplied <= LINK_DUST) continue;
      const own = books.local[item]?.get(groupId);
      const onSite = !!own && maker.row.onSite?.group === groupId;
      const share = onSite
        ? undefined
        : (shares.get(item) ?? itemShares(parts, item, own, groupId));
      if (share) shares.set(item, share);
      parts.forEach((user, userIndex) => {
        const rate = share
          ? insideRate(share, maker, user)
          : // The own lines among themselves: sharedRate of what they make and the group asks.
            sharedRate(own!.made, own!.asked, supplied, usedBy(user, item));
        if (rate > LINK_DUST)
          links.push({
            item,
            rate,
            belts: belts(item, rate),
            from: lineEnd(maker),
            to: lineEnd(user),
            loop: userIndex < makerIndex,
            self: user === maker,
          });
      });
    }
  });
  return links;
}

// How a group's lines other than its own lines made on site share one item (insideLinks): what
// each line takes back of its own (`self`), what each maker has left after that (`made`) and what
// each user still wants (`wanted`), with their totals.
interface InsideShares {
  self: Map<GroupPart, number>;
  made: Map<GroupPart, number>;
  wanted: Map<GroupPart, number>;
  madeTotal: number;
  wantedTotal: number;
}

// The InsideShares of `item` in the group. `own` is the group's own lines made on site for it
// (ItemBooks.local), whose part of each user's demand is left out.
function itemShares(
  parts: GroupPart[],
  item: string,
  own: { made: number; asked: number } | undefined,
  groupId: string,
): InsideShares {
  // The part of each user's demand left after the group's own lines (all of it without them).
  const left = own && own.asked > 0 ? 1 - Math.min(own.made, own.asked) / own.asked : 1;
  const share: InsideShares = {
    self: new Map(),
    made: new Map(),
    wanted: new Map(),
    madeTotal: 0,
    wantedTotal: 0,
  };
  for (const part of parts) {
    const made = own && part.row.onSite?.group === groupId ? 0 : madeBy(part, item),
      wanted = usedBy(part, item) * left,
      self = Math.min(made, wanted);
    share.self.set(part, self);
    share.made.set(part, made - self);
    share.wanted.set(part, wanted - self);
    share.madeTotal += made - self;
    share.wantedTotal += wanted - self;
  }
  return share;
}

// What `maker` gives `user` of the item (InsideShares): its own use when it is the user, plus its
// part of what the group's makers have left, shared by sharedRate.
function insideRate(share: InsideShares, maker: GroupPart, user: GroupPart): number {
  const made = share.made.get(maker) || 0,
    wanted = share.wanted.get(user) || 0;
  const shared =
    made > LINK_DUST && wanted > LINK_DUST
      ? sharedRate(share.madeTotal, share.wantedTotal, made, wanted)
      : 0;
  return shared + (maker === user ? share.self.get(maker) || 0 : 0);
}

function portKind(place: string, stage: StoredStage, groups: FactoryGroups): PortKind {
  if (isSource(place)) return stage.raw?.[sourceItem(place)] ? 'raw' : 'supply';
  if (place === UNGROUPED) return 'ungrouped';
  return groups.groups.some(group => group.id === place) ? 'group' : 'outside';
}

const byKindThenRate = (a: FlowPort, b: FlowPort) =>
  PORT_ORDER.indexOf(a.kind) - PORT_ORDER.indexOf(b.kind) ||
  b.rate - a.rate ||
  a.item.localeCompare(b.item) ||
  a.place.localeCompare(b.place);

// What crosses the group's edge: groupLinks' links (`links`) into and out of it, one port per item.
function crossingPorts(
  stage: StoredStage,
  groups: FactoryGroups,
  groupId: string,
  carry: LinkWords,
  links: GroupLink[],
): CrossingPorts {
  const ins: FlowPort[] = [],
    outs: FlowPort[] = [];
  const words = new Map<FlowPort, BeltsFor>();
  const port = (place: string, item: string, rate: number, belts: BeltsFor): FlowPort => {
    const made: FlowPort = {
      place,
      label: placeName(place, groups.groups, stage.raw),
      kind: portKind(place, stage, groups),
      item,
      rate,
      belts: belts(item, rate),
    };
    words.set(made, belts);
    return made;
  };
  for (const link of links) {
    if (link.to !== groupId && link.from !== groupId) continue;
    const belts = carry(link);
    if (link.to === groupId)
      for (const entry of link.items) ins.push(port(link.from, entry.item, entry.rate, belts));
    if (link.from === groupId)
      for (const entry of link.items) outs.push(port(link.to, entry.item, entry.rate, belts));
  }
  return { ins: ins.sort(byKindThenRate), outs: outs.sort(byKindThenRate), words };
}

// What crosses a group's edge (crossingPorts): the ports in and out, and each port's link words
// (LinkWords), which the lines' parts of it take too (portLinks).
interface CrossingPorts {
  ins: FlowPort[];
  outs: FlowPort[];
  words: Map<FlowPort, BeltsFor>;
}

// Each port's rate shared among the group's lines that use its item (`ins`) or make it
// (`outs`), in proportion to what each still needs, or has left, after the links inside the
// group (#1022: so a line that takes its own byproduct back, or gets it from the group's own
// lines, draws only the rest from outside). For an item the group makes on site (#876,
// ItemBooks.local) an outgoing port is shared by what each line making it has left after the
// links inside the group, as groupLinks counts it: the group's own lines' excess goes to the
// sink (its `sunk`), and the other lines making the item share the rest, so every output row
// still adds up (#912). After a group edit the own lines may have more left than the sink takes
// (#918, its `offered`): that part leaves with the other lines' supply, for the other places.
function portLinks(
  parts: GroupPart[],
  ports: CrossingPorts,
  belts: BeltsFor,
  inside: FlowLink[],
  local: ItemBooks['local'],
  groupId: string,
): FlowLink[] {
  const share = (
    port: FlowPort,
    lines: GroupPart[],
    part: (line: GroupPart) => number,
    inward: boolean,
    portRate = port.rate,
  ) => {
    const total = lines.reduce((sum, line) => sum + part(line), 0);
    return lines.flatMap((line): FlowLink[] => {
      const rate = total > LINK_DUST ? (portRate * part(line)) / total : 0;
      if (rate <= LINK_DUST) return [];
      const place: FlowEnd = { kind: 'place', id: port.place };
      return [
        {
          item: port.item,
          rate,
          belts: (ports.words.get(port) ?? belts)(port.item, rate),
          from: inward ? place : lineEnd(line),
          to: inward ? lineEnd(line) : place,
          loop: false,
          self: false,
        },
      ];
    });
  };
  // What a line has left of `item` after its links inside the group, and what it still needs.
  const leftOf = (line: GroupPart, item: string) =>
    Math.max(
      0,
      inside
        .filter(link => link.item === item && isLine(link.from, line.row.id))
        .reduce((left, link) => left - link.rate, madeBy(line, item)),
    );
  const needOf = (line: GroupPart, item: string) =>
    Math.max(
      0,
      inside
        .filter(link => link.item === item && isLine(link.to, line.row.id))
        .reduce((need, link) => need - link.rate, usedBy(line, item)),
    );
  // `part`, or `whole` when no line has any of `part` left (rounding, or the memberships changed
  // since the plan was calculated), so the port still reaches the lines.
  const partOr = (
    lines: GroupPart[],
    part: (line: GroupPart) => number,
    whole: (line: GroupPart) => number,
  ) => (lines.reduce((sum, line) => sum + part(line), 0) > LINK_DUST ? part : whole);
  const outLinks = (item: string): FlowLink[] => {
    const itemPorts = ports.outs.filter(port => port.item === item);
    const madeHere = (line: GroupPart) => madeBy(line, item);
    if (!local[item]?.has(groupId)) {
      const left = partOr(parts, line => leftOf(line, item), madeHere);
      return itemPorts.flatMap(port => share(port, parts, left, false));
    }
    const makers = parts.filter(line => madeHere(line) > LINK_DUST);
    const own = makers.filter(line => line.row.onSite?.group === groupId);
    const others = makers.filter(line => line.row.onSite?.group !== groupId);
    const left = new Map(makers.map(line => [line, leftOf(line, item)]));
    const leftHere = (line: GroupPart) => left.get(line) || 0;
    const othersLeft = others.reduce((sum, line) => sum + leftHere(line), 0);
    // The own lines' excess goes to the sink port(s), up to what they have left.
    const ownExcess = own.reduce((sum, line) => sum + leftHere(line), 0);
    let ownLeft = ownExcess;
    const fromOwn = itemPorts.map(port => {
      const rate = port.place === OUTSIDE.surplus ? Math.min(port.rate, ownLeft) : 0;
      ownLeft -= rate;
      return rate;
    });
    // What the sink has no room for (#918, ItemBooks.offered: the group asks for less since a
    // group edit) leaves with the other lines' supply, shared in proportion to what each has left.
    const offered = (line: GroupPart) =>
      own.includes(line) ? (leftHere(line) * ownLeft) / ownExcess : leftHere(line);
    return itemPorts.flatMap((port, i) => {
      const rest = port.rate - fromOwn[i]!;
      // Should the other lines have nothing left (memberships changed since the plan was
      // calculated), the rest is shared over every line making the item, as without the mark.
      const restLinks =
        rest <= LINK_DUST
          ? []
          : ownLeft > LINK_DUST
            ? share(port, makers, offered, false, rest)
            : othersLeft > LINK_DUST
              ? share(port, others, leftHere, false, rest)
              : share(port, makers, madeHere, false, rest);
      return [...share(port, own, leftHere, false, fromOwn[i]), ...restLinks];
    });
  };
  return [
    ...ports.ins.flatMap(port => {
      const used = (line: GroupPart) => usedBy(line, port.item);
      return share(
        port,
        parts,
        partOr(parts, line => needOf(line, port.item), used),
        true,
      );
    }),
    ...[...new Set(ports.outs.map(port => port.item))].flatMap(outLinks),
  ];
}

const isLine = (end: FlowEnd, id: string) => end.kind === 'line' && end.id === id;

// A line with its rows, each row carrying the links into or out of it.
function flowLine(
  part: GroupPart,
  no: number,
  links: FlowLink[],
  belts: BeltsFor,
  name: LineName,
): FlowLine {
  const { row, share } = part;
  const flowRow = (dir: 'in' | 'out', item: string, rate: number): FlowRow => ({
    id: `${dir}|${row.id}|${item}`,
    item,
    rate,
    belts: belts(item, rate),
    links: links.filter(
      link =>
        link.item === item && (dir === 'in' ? isLine(link.to, row.id) : isLine(link.from, row.id)),
    ),
  });
  const rows = (dir: 'in' | 'out', rates: CalcRow['inputs'] | undefined) =>
    Object.entries(rates || {})
      .filter(([, rate]) => rate * share > LINK_DUST)
      .map(([item, rate]) => flowRow(dir, item, rate * share));
  return {
    id: row.id,
    no,
    recipe: row.name,
    name: name(row),
    machine: row.machine,
    machines: row.machines,
    lastClock: row.lastClock,
    share,
    machinesHere: row.machines * share,
    mw: (row.generationMW || 0) * share,
    inputs: rows('in', row.inputs),
    outputs: rows('out', row.outputs),
  };
}

// What a place's flow reads of the phase's books: itemBooks and groupLinks of them, worked out
// once for every place (recycle.ts reads each place's links).
export interface PhaseBooks {
  books: ItemBooks;
  links: GroupLink[];
}

// The lines of place `placeId` (a group, or UNGROUPED), what crosses its edge and every link into
// or out of its lines: those between its own lines (insideLinks), then those with the places
// outside it (portLinks).
function placeFlow(
  stage: StoredStage,
  groups: FactoryGroups,
  placeId: string,
  phase: PhaseBooks,
  belts: BeltsFor,
  carry: LinkWords = () => belts,
): { parts: GroupPart[]; ports: CrossingPorts; links: FlowLink[] } {
  const parts = groupParts(stage, groups, placeId);
  const inside = insideLinks(parts, phase.books, belts, placeId);
  const ports = crossingPorts(stage, groups, placeId, carry, phase.links);
  const links = [...inside, ...portLinks(parts, ports, belts, inside, phase.books.local, placeId)];
  return { parts, ports, links };
}

// Every link into or out of the lines of place `placeId` (a group, or UNGROUPED for the rows in
// no group), as its flow page shares them (placeFlow), without belts. recycle.ts follows each
// line's byproducts through them.
export const placeLinks = (
  stage: StoredStage,
  groups: FactoryGroups,
  placeId: string,
  phase: PhaseBooks,
): FlowLink[] => placeFlow(stage, groups, placeId, phase, () => '').links;

// The flow of group `groupId` in a calculated phase, null for a group the profile does not have.
// `belts` words the belts or pipes of a rate (BeltsFor), `name` names a line (LineName),
// `planned` is the plan's settings.onSite, the items made on site for each group (itemBooks), and
// `carry` words how each link into or out of the group travels (LinkWords, #1067), on `belts`
// without one. Deterministic: it reads only its arguments.
export function groupFlow(
  stage: StoredStage,
  groups: FactoryGroups,
  groupId: string,
  belts: BeltsFor,
  name: LineName = rowName,
  planned?: OnSiteSettings,
  carry?: LinkWords,
): GroupFlow | null {
  if (!groups.groups.some(group => group.id === groupId)) return null;
  const books = itemBooks(stage, groups, planned);
  const { parts, ports, links } = placeFlow(
    stage,
    groups,
    groupId,
    { books, links: groupLinks(stage, groups, planned) },
    belts,
    carry,
  );
  const lines = parts.map((part, i) => flowLine(part, i + 1, links, belts, name));
  const folded = ports.outs.filter(port => FOLDED.has(port.place));
  const lanes = assignLanes(lines);
  return {
    group: groupId,
    lines,
    ins: ports.ins,
    outs: ports.outs.filter(port => !FOLDED.has(port.place)),
    fold: {
      items: new Set(folded.map(port => port.item)).size,
      rate: folded.reduce((sum, port) => sum + port.rate, 0),
      ports: folded,
    },
    lanes,
    laneCount: lanes.reduce((count, lane) => Math.max(count, lane.lane + 1), 0),
    split: parts.some(part => part.share < 1 - LINK_DUST),
  };
}

// Each row's place down the one-column cards, from 0: each card's input rows, then its output
// rows. A lane's trunk spans the places of its output row and of the input rows it feeds, so two
// lanes overlap on the page exactly where their spans of places do.
export function rowSlots(lines: readonly FlowLine[]): Map<string, number> {
  const slot = new Map<string, number>();
  for (const line of lines)
    for (const row of [...line.inputs, ...line.outputs]) slot.set(row.id, slot.size);
  return slot;
}

// One output row's trunk: the places of its output row (`at`) and of the input rows it feeds
// (`ends`, `at` first), and their span from `lo` to `hi`.
interface Trunk {
  line: string;
  row: FlowRow;
  to: string[];
  links: FlowLink[];
  at: number;
  ends: number[];
  lo: number;
  hi: number;
}
const spanOf = (trunk: Trunk) => trunk.hi - trunk.lo;
// Two trunks overlap when they share a row, an end included: two lanes ending on one input row
// meet there.
const overlaps = (a: Trunk, b: Trunk) => a.lo <= b.hi && b.lo <= a.hi;
const fits = (lane: readonly Trunk[], trunk: Trunk) => !lane.some(other => overlaps(trunk, other));
const longestOn = (lane: readonly Trunk[]) => Math.max(...lane.map(spanOf));

// The lanes of a group's links (#883 round 3). Every output row with a link to another line of
// the group gets one lane (a line's self link, #898, rides none), a trunk spanning from that row
// to the furthest input row it feeds, counted in rows down the one-column cards (each card's
// input rows, then its output rows). Trunks share a lane only where they do not overlap. The
// shortest trunks sit nearest the cards (`shortestFirst`); where that needs more lanes than the
// most trunks over one row, the group gets exactly that many (`byStart`, #899). Deterministic:
// the same rows give the same lanes. Lanes are returned in the output rows' order.
export function assignLanes(lines: readonly FlowLine[]): FlowLane[] {
  const trunks = laneTrunks(lines);
  let lanes = shortestFirst(trunks);
  if (lanes.length > mostOverlapping(trunks)) lanes = closestFirst(byStart(trunks));
  const laneOf = new Map(lanes.flatMap((onLane, lane) => onLane.map(trunk => [trunk, lane])));
  return trunks.map(trunk => ({
    // Every trunk is on one of the lanes.
    lane: laneOf.get(trunk)!,
    line: trunk.line,
    item: trunk.row.item,
    from: trunk.row.id,
    to: trunk.to,
    links: trunk.links,
  }));
}

// The trunk of each output row with a link to another line of the group, in the rows' order.
function laneTrunks(lines: readonly FlowLine[]): Trunk[] {
  const slot = rowSlots(lines);
  return lines.flatMap(line =>
    line.outputs.flatMap(row => {
      const links = row.links.filter(link => link.to.kind === 'line' && !link.self);
      if (!links.length) return [];
      const to = links.map(link => `in|${link.to.id}|${link.item}`);
      const ends = [row.id, ...to].map(id => slot.get(id) ?? 0);
      const at = ends[0] ?? 0;
      return [
        { line: line.id, row, to, links, at, ends, lo: Math.min(...ends), hi: Math.max(...ends) },
      ];
    }),
  );
}

// The trunks shortest first, each in the first lane it fits, so the shortest sit nearest the
// cards. Ties go by the higher trunk, then the earlier output row. Placing intervals shortest
// first can take one lane more than needed (#899), which `assignLanes` checks.
function shortestFirst(trunks: readonly Trunk[]): Trunk[][] {
  const lanes: Trunk[][] = [];
  const order = [...trunks].sort((a, b) => spanOf(a) - spanOf(b) || a.lo - b.lo || a.at - b.at);
  for (const trunk of order) {
    const lane = lanes.find(onLane => fits(onLane, trunk));
    if (lane) lane.push(trunk);
    else lanes.push([trunk]);
  }
  return lanes;
}

// The most trunks over any one row, which no assignment can do with fewer lanes. The most
// intervals overlap at the top of one of them.
const mostOverlapping = (trunks: readonly Trunk[]): number =>
  Math.max(
    0,
    ...trunks.map(
      trunk => trunks.filter(other => other.lo <= trunk.lo && trunk.lo <= other.hi).length,
    ),
  );

// The fewest lanes (#899): the trunks by their top row, each in a lane it fits. A lane is added
// only when every lane has a trunk over the new trunk's top row, so the lanes never outnumber
// the trunks over one row. Of the lanes it fits, a trunk takes the one whose longest trunk is
// nearest its own length (the first on a tie), so short trunks share lanes with short ones.
// Ties go by the shorter trunk, then the earlier output row.
function byStart(trunks: readonly Trunk[]): Trunk[][] {
  const lanes: Trunk[][] = [];
  const order = [...trunks].sort((a, b) => a.lo - b.lo || a.hi - b.hi || a.at - b.at);
  for (const trunk of order) {
    const lane = nearestLength(
      lanes.filter(onLane => fits(onLane, trunk)),
      spanOf(trunk),
    );
    if (lane) lane.push(trunk);
    else lanes.push([trunk]);
  }
  return lanes;
}

// The lane whose longest trunk is nearest `length`, the first on a tie (none without lanes).
function nearestLength(lanes: Trunk[][], length: number): Trunk[] | undefined {
  const gap = (lane: readonly Trunk[]) => Math.abs(longestOn(lane) - length);
  let nearest: Trunk[] | undefined;
  for (const lane of lanes) if (!nearest || gap(lane) < gap(nearest)) nearest = lane;
  return nearest;
}

// How many branches of the trunks on lane `outer` cross a trunk on lane `inner`, nearer the
// cards: a branch runs from its lane to its row on the cards, past every inner trunk around it.
const crossings = (inner: readonly Trunk[], outer: readonly Trunk[]): number =>
  outer.reduce(
    (count, trunk) =>
      count +
      trunk.ends.filter(row => inner.some(other => other.lo < row && row < other.hi)).length,
    0,
  );

// `byStart`'s lanes in order from the cards: by their longest trunk, the shortest nearest, then
// two neighbouring lanes swapped wherever that crosses fewer wires. Each swap leaves fewer
// crossings in all, so the swapping ends.
function closestFirst(lanes: readonly Trunk[][]): Trunk[][] {
  const order = [...lanes].sort((a, b) => longestOn(a) - longestOn(b));
  for (let swapped = true; swapped; ) {
    swapped = false;
    for (let i = 0; i + 1 < order.length; i++) {
      // i + 1 is below the length.
      const inner = order[i]!,
        outer = order[i + 1]!;
      if (crossings(outer, inner) >= crossings(inner, outer)) continue;
      order[i] = outer;
      order[i + 1] = inner;
      swapped = true;
    }
  }
  return order;
}

// The lane geometry, in px: lanes `step` apart, the innermost `inner` from the cards and the
// outermost `outer` from the gutter's left edge. `narrow` is for a phone-width page.
export interface LaneMetrics {
  step: number;
  inner: number;
  outer: number;
}
export const LANE_METRICS: { wide: LaneMetrics; narrow: LaneMetrics } = {
  wide: { step: 10, inner: 18, outer: 4 },
  narrow: { step: 8, inner: 14, outer: 4 },
};

// The gutter's width for `count` lanes: none without lanes, else outer + (count − 1) × step +
// inner, so it is sized to the lanes the group needs.
export const laneGutter = (count: number, metrics: LaneMetrics): number =>
  count > 0 ? metrics.outer + (count - 1) * metrics.step + metrics.inner : 0;

// How far lane `lane` runs to the left of the cards' border.
export const laneOffset = (lane: number, metrics: LaneMetrics): number =>
  metrics.inner + lane * metrics.step;
