// The flow of one factory group (#883, #893): the data behind the group's flow page (#894),
// which draws each line as a card in the build plan's order, its inputs and outputs as rows, and
// the links between the group's own lines as item lanes in a gutter to the left of the cards.
//
// It is counted from the same books as the Logistics page (itemBooks and groupLinks in
// group-links.ts), so it agrees with "Between groups":
// - a split row counts only the group's share of it (rowPlaces in group-order.ts);
// - what comes in from outside the group and what leaves it are groupLinks' own links, each
//   shared among the group's lines that use (or make) the item in proportion to their parts;
// - inside the group, an item moves from each line making it to each line using it by the rule
//   groupLinks shares an item between places by (sharedRate), with the lines as the places.
// A line whose recipe both uses and makes an item (Distilled Silica's water, #898) feeds its own
// share of it back into itself: a self link, from and to the same line, marked `self`. With it,
// the links into an input row add up to its rate, and the links out of an output row to its
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
  placeTotal,
  sharedRate,
  sourceItem,
  UNGROUPED,
} from './group-links.ts';
import type { ItemBooks } from './group-links.ts';
import type { CalcRow, FactoryGroups, StoredStage } from '../types/index.ts';

// The belts or pipes that carry `rate` of `item`, in the factory dialog's words: the page
// passes itemBelts (flow.ts) at the phase it shows, "2 × Mk.3 belts".
export type BeltsFor = (item: string, rate: number) => string;

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

// The rows with a share in the group, in the build plan's order (groupedRows, #869).
const groupParts = (stage: StoredStage, groups: FactoryGroups, groupId: string): GroupPart[] =>
  groupedRows(stage.rows || [], groups)
    .map(row => ({ row, share: rowPlaces(row, groups).get(groupId) || 0 }))
    .filter(part => part.share > LINK_DUST);

const lineEnd = (part: GroupPart): FlowEnd => ({ kind: 'line', id: part.row.id });
const madeBy = (part: GroupPart, item: string) => (part.row.outputs?.[item] || 0) * part.share;
const usedBy = (part: GroupPart, item: string) => (part.row.inputs?.[item] || 0) * part.share;

// The links between the group's own lines, by maker, its outputs in order, then user. A line
// that uses what it makes gets a self link to itself, so its rows still add up (#898).
// For an item the group makes on site (#876, ItemBooks.local) its own lines meet its own demand
// first, by the same rule among themselves; any other line making it shares out only the part of
// each user's demand they leave.
function insideLinks(
  parts: GroupPart[],
  books: ItemBooks,
  belts: BeltsFor,
  groupId: string,
): FlowLink[] {
  const links: FlowLink[] = [];
  parts.forEach((maker, makerIndex) => {
    for (const item of Object.keys(maker.row.outputs || {})) {
      const supplied = madeBy(maker, item);
      if (supplied <= LINK_DUST) continue;
      const own = books.local[item]?.get(groupId);
      const onSite = !!own && maker.row.onSite?.group === groupId;
      const made = onSite ? own.made : placeTotal(books.supply[item]),
        asked = onSite ? own.asked : placeTotal(books.demand[item]);
      // The part of each user's demand left after the group's own lines (all of it without them).
      const left =
        own && !onSite && own.asked > 0 ? 1 - Math.min(own.made, own.asked) / own.asked : 1;
      parts.forEach((user, userIndex) => {
        const wanted = usedBy(user, item) * left;
        if (wanted <= LINK_DUST) return;
        const rate = sharedRate(made, asked, supplied, wanted);
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

// What crosses the group's edge: groupLinks' links into and out of it, one port per item.
function crossingPorts(
  stage: StoredStage,
  groups: FactoryGroups,
  groupId: string,
  belts: BeltsFor,
): { ins: FlowPort[]; outs: FlowPort[] } {
  const ins: FlowPort[] = [],
    outs: FlowPort[] = [];
  const port = (place: string, item: string, rate: number): FlowPort => ({
    place,
    label: placeName(place, groups.groups, stage.raw),
    kind: portKind(place, stage, groups),
    item,
    rate,
    belts: belts(item, rate),
  });
  for (const link of groupLinks(stage, groups)) {
    if (link.to === groupId)
      for (const entry of link.items) ins.push(port(link.from, entry.item, entry.rate));
    if (link.from === groupId)
      for (const entry of link.items) outs.push(port(link.to, entry.item, entry.rate));
  }
  return { ins: ins.sort(byKindThenRate), outs: outs.sort(byKindThenRate) };
}

// Each port's rate shared among the group's lines that use its item (`ins`) or make it
// (`outs`), in proportion to their parts. For an item the group makes on site (#876,
// ItemBooks.local) an outgoing port is shared by what each line making it has left after the
// links inside the group, as groupLinks counts it: the group's own lines' excess goes to the
// sink (its `sunk`), and the other lines making the item share the rest, so every output row
// still adds up (#912).
function portLinks(
  parts: GroupPart[],
  ports: { ins: FlowPort[]; outs: FlowPort[] },
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
          belts: belts(port.item, rate),
          from: inward ? place : lineEnd(line),
          to: inward ? lineEnd(line) : place,
          loop: false,
          self: false,
        },
      ];
    });
  };
  // What a line has left of `item` after its links inside the group.
  const leftOf = (line: GroupPart, item: string) =>
    Math.max(
      0,
      inside
        .filter(link => link.item === item && isLine(link.from, line.row.id))
        .reduce((left, link) => left - link.rate, madeBy(line, item)),
    );
  const outLinks = (item: string): FlowLink[] => {
    const itemPorts = ports.outs.filter(port => port.item === item);
    const madeHere = (line: GroupPart) => madeBy(line, item);
    if (!local[item]?.has(groupId))
      return itemPorts.flatMap(port => share(port, parts, madeHere, false));
    const makers = parts.filter(line => madeHere(line) > LINK_DUST);
    const own = makers.filter(line => line.row.onSite?.group === groupId);
    const others = makers.filter(line => line.row.onSite?.group !== groupId);
    const left = new Map(makers.map(line => [line, leftOf(line, item)]));
    const leftHere = (line: GroupPart) => left.get(line) || 0;
    const othersLeft = others.reduce((sum, line) => sum + leftHere(line), 0);
    // The own lines' excess goes to the sink port(s), up to what they have left.
    let ownLeft = own.reduce((sum, line) => sum + leftHere(line), 0);
    const fromOwn = itemPorts.map(port => {
      const rate = port.place === OUTSIDE.surplus ? Math.min(port.rate, ownLeft) : 0;
      ownLeft -= rate;
      return rate;
    });
    return itemPorts.flatMap((port, i) => {
      const rest = port.rate - fromOwn[i]!;
      // Should the other lines have nothing left (memberships changed since the plan was
      // calculated), the rest is shared over every line making the item, as without the mark.
      const restLinks =
        rest <= LINK_DUST
          ? []
          : othersLeft > LINK_DUST
            ? share(port, others, leftHere, false, rest)
            : share(port, makers, madeHere, false, rest);
      return [...share(port, own, leftHere, false, fromOwn[i]), ...restLinks];
    });
  };
  return [
    ...ports.ins.flatMap(port => share(port, parts, line => usedBy(line, port.item), true)),
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

// The flow of group `groupId` in a calculated phase, null for a group the profile does not have.
// `belts` words the belts or pipes of a rate (BeltsFor) and `name` names a line (LineName).
// Deterministic: it reads only its arguments.
export function groupFlow(
  stage: StoredStage,
  groups: FactoryGroups,
  groupId: string,
  belts: BeltsFor,
  name: LineName = rowName,
): GroupFlow | null {
  if (!groups.groups.some(group => group.id === groupId)) return null;
  const parts = groupParts(stage, groups, groupId);
  const books = itemBooks(stage, groups);
  const inside = insideLinks(parts, books, belts, groupId);
  const ports = crossingPorts(stage, groups, groupId, belts);
  const links = [...inside, ...portLinks(parts, ports, belts, inside, books.local, groupId)];
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

// The lanes of a group's links (#883 round 3). Every output row with a link to another line of
// the group gets one lane (a line's self link, #898, rides none), a trunk spanning from that row to the furthest input row it feeds,
// counted in rows down the one-column cards (each card's input rows, then its output rows).
// The shortest trunks sit nearest the cards, and a lane is reused once no trunk on it overlaps,
// so a group needs as few lanes as its overlapping trunks. Deterministic: ties go by span, then
// the higher trunk, then the earlier output row. Lanes are returned in the output rows' order.
export function assignLanes(lines: readonly FlowLine[]): FlowLane[] {
  const slot = new Map<string, number>();
  for (const line of lines)
    for (const row of [...line.inputs, ...line.outputs]) slot.set(row.id, slot.size);
  const trunks = lines.flatMap(line =>
    line.outputs.flatMap(row => {
      const links = row.links.filter(link => link.to.kind === 'line' && !link.self);
      if (!links.length) return [];
      const to = links.map(link => `in|${link.to.id}|${link.item}`);
      const ends = [row.id, ...to].map(id => slot.get(id) ?? 0);
      return [{ line: line.id, row, to, links, lo: Math.min(...ends), hi: Math.max(...ends) }];
    }),
  );
  const taken: { lo: number; hi: number }[][] = [];
  const laneOf = new Map<string, number>();
  const bySpan = [...trunks].sort(
    (a, b) =>
      a.hi - a.lo - (b.hi - b.lo) || a.lo - b.lo || slot.get(a.row.id)! - slot.get(b.row.id)!,
  );
  for (const trunk of bySpan) {
    let lane = taken.findIndex(spans =>
      spans.every(span => trunk.hi < span.lo || trunk.lo > span.hi),
    );
    if (lane < 0) lane = taken.push([]) - 1;
    // findIndex or push gave an index of `taken`.
    taken[lane]!.push(trunk);
    laneOf.set(trunk.row.id, lane);
  }
  return trunks.map(trunk => ({
    // Every trunk was placed in the loop above.
    lane: laneOf.get(trunk.row.id)!,
    line: trunk.line,
    item: trunk.row.item,
    from: trunk.row.id,
    to: trunk.to,
    links: trunk.links,
  }));
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
