// The words and the lane drawing of a factory group's flow page (#894,
// ui/pages/GroupFlowPage.vue), from the group's flow (groupFlow in group-flow.ts, #893). The
// model says what moves where and which lane each output row's links ride; this module says how
// the page names a link's ends, which colour and dash each item's lanes take, and, once the page
// has measured where its rows sit, the paths it draws.
import { laneOffset, rowSlots } from '../group-flow.ts';
import type {
  FlowLane,
  FlowLine,
  FlowLink,
  FlowPort,
  GroupFlow,
  LaneMetrics,
} from '../group-flow.ts';

// A line's number as the cards show it: "01".
export const lineNumber = (no: number) => String(no).padStart(2, '0');

// A link from a line back into itself (#898): a recipe that uses what it makes. Newer models
// mark it `self`; it is also the only link whose two ends are the same line. It rides no lane.
export const isSelfLink = (link: FlowLink): boolean =>
  ('self' in link && link.self === true) ||
  (link.from.kind === 'line' && link.to.kind === 'line' && link.from.id === link.to.id);

// A link between two different lines of the group, drawn as a lane.
export const isLaneLink = (link: FlowLink) =>
  link.from.kind === 'line' && link.to.kind === 'line' && !isSelfLink(link);

// The lane colours and dashes, from the :root tokens: one style per item carried inside the
// group, listed in the key in the order its lane first appears. Lanes must not differ by colour
// alone (#909, WCAG 1.4.1), and red-green colour blindness turns --accent, --red, --gold and
// --green into one run of yellows and olives (#920; Chrome's protanopia emulation makes --green
// and --gold nearly one colour in the dark theme): those four are one hue family, told apart
// only by the dash. --blue and --ink are a family each.
const LANE_COLOURS = ['--accent', '--blue', '--red', '--green', '--gold', '--ink'] as const;
type LaneColour = (typeof LANE_COLOURS)[number];
const RED_GREEN = new Set<LaneColour>(['--accent', '--red', '--green', '--gold']);
const familyOf = (colour: LaneColour): string => (RED_GREEN.has(colour) ? 'red-green' : colour);
const LANE_DASHES = ['', '7 4', '2 3'];
export interface LaneStyle {
  color: string;
  dash: string;
}

// The n-th item's preferred colour and dash, from 0 (#909): the colours in turn, and a dash that
// moves on one place per item and, after each round of the colours, one place further, so that
// in this order neighbouring items differ in dash and the first 18 never share both.
const preferredColour = (n: number) => n % LANE_COLOURS.length;
const preferredDash = (n: number) => (n + Math.floor(n / LANE_COLOURS.length)) % LANE_DASHES.length;
// The modulos keep both indexes inside their lists.
const styleOf = (colour: number, dash: number): LaneStyle => ({
  color: `var(${LANE_COLOURS[colour]!})`,
  dash: LANE_DASHES[dash]!,
});
export const laneStyleAt = (n: number): LaneStyle => styleOf(preferredColour(n), preferredDash(n));

// Which items' lanes run alongside which on the page. `beside`: a lane in the next gutter column
// whose rows overlap; `overlapping`: a lane whose rows overlap, in any column. An item is never
// its own neighbour. A lane whose rows are not in the flow's lines has no neighbours.
export interface LaneNeighbours {
  beside: Map<string, Set<string>>;
  overlapping: Map<string, Set<string>>;
}
export type LaneFlow = Pick<GroupFlow, 'lines' | 'lanes'>;
export function laneNeighbours(flow: LaneFlow): LaneNeighbours {
  const slot = rowSlots(flow.lines);
  const spans = flow.lanes.flatMap(lane => {
    const ends = [lane.from, ...lane.to].flatMap(id => slot.get(id) ?? []);
    return ends.length ? [{ ...lane, lo: Math.min(...ends), hi: Math.max(...ends) }] : [];
  });
  const neighbours: LaneNeighbours = { beside: new Map(), overlapping: new Map() };
  const link = (kind: Map<string, Set<string>>, a: string, b: string) => {
    kind.set(a, (kind.get(a) ?? new Set()).add(b));
    kind.set(b, (kind.get(b) ?? new Set()).add(a));
  };
  for (const [i, a] of spans.entries())
    for (const b of spans.slice(i + 1)) {
      if (a.item === b.item || a.hi < b.lo || b.hi < a.lo) continue;
      link(neighbours.overlapping, a.item, b.item);
      if (Math.abs(a.lane - b.lane) === 1) link(neighbours.beside, a.item, b.item);
    }
  return neighbours;
}

// Each item's style (#920), the same for the same lanes. First a dash per item such that items
// whose lanes run beside each other never share one, whenever some choice of dashes allows that:
// always when every item rides one lane, as lanes beside each other then lie in an even and an
// odd column. Then a colour per item, in the key's order: a red-green colour only where no
// overlapping lane of that family has the item's dash; a family no lane beside it with the same
// dash has (only where the dashes could not differ); else the style fewest items have, starting
// from the preferred colour.
export function laneStyles(flow: LaneFlow): Map<string, LaneStyle> {
  const items = [...new Set(flow.lanes.map(lane => lane.item))];
  const neighbours = laneNeighbours(flow);
  const dashes = laneDashes(items, neighbours.beside);
  const chosen = new Map<string, { colour: number; dash: number }>();
  for (const [n, item] of items.entries()) {
    // laneDashes gives every item a dash.
    const dash = dashes.get(item)!;
    chosen.set(item, { colour: laneColour(n, item, dash, chosen, neighbours), dash });
  }
  return new Map(
    [...chosen].map(([item, choice]) => [item, styleOf(choice.colour, choice.dash)] as const),
  );
}

// How many dashes the search below may try before it settles for the fewest shared dashes: far
// more than any group needs, and a bound on the work for a group it cannot separate.
const SEARCH_STEPS = 20000;
// The dashes, per group of items connected by lanes beside each other.
function laneDashes(
  items: readonly string[],
  beside: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, number> {
  const order = new Map(items.map((item, n) => [item, n]));
  const dashes = new Map<string, number>();
  for (const part of besideParts(items, beside, order))
    if (!differentDashes(part, beside, order, dashes)) fewestShared(part, beside, order, dashes);
  return dashes;
}
const dashesFrom = (n: number) =>
  LANE_DASHES.map((_, k) => (preferredDash(n) + k) % LANE_DASHES.length);

// The items connected by lanes beside each other, each part in the order a walk from its first
// item reaches them, so every item but the first meets a neighbour that already has a dash.
function besideParts(
  items: readonly string[],
  beside: ReadonlyMap<string, ReadonlySet<string>>,
  order: ReadonlyMap<string, number>,
): string[][] {
  const seen = new Set<string>();
  const parts: string[][] = [];
  for (const first of items) {
    if (seen.has(first)) continue;
    const part = [first];
    seen.add(first);
    for (let i = 0; i < part.length; i++) {
      // part[i] exists: i < part.length.
      const next = [...(beside.get(part[i]!) ?? [])].filter(item => !seen.has(item));
      next.sort((a, b) => order.get(a)! - order.get(b)!);
      for (const item of next) {
        seen.add(item);
        part.push(item);
      }
    }
    parts.push(part);
  }
  return parts;
}

// Gives the part's items dashes no item beside them shares, trying each item's preferred dash
// first; false, with none given, when there are none or the search runs out of steps.
function differentDashes(
  part: readonly string[],
  beside: ReadonlyMap<string, ReadonlySet<string>>,
  order: ReadonlyMap<string, number>,
  dashes: Map<string, number>,
): boolean {
  let steps = SEARCH_STEPS;
  const place = (i: number): boolean => {
    const item = part[i];
    if (item === undefined) return true;
    for (const dash of dashesFrom(order.get(item)!)) {
      if (--steps < 0) return false;
      if ([...(beside.get(item) ?? [])].some(other => dashes.get(other) === dash)) continue;
      dashes.set(item, dash);
      if (place(i + 1)) return true;
      dashes.delete(item);
    }
    return false;
  };
  return place(0);
}

// The fallback: each item in turn takes the dash the fewest items beside it have.
function fewestShared(
  part: readonly string[],
  beside: ReadonlyMap<string, ReadonlySet<string>>,
  order: ReadonlyMap<string, number>,
  dashes: Map<string, number>,
) {
  for (const item of part) {
    const shared = (dash: number) =>
      [...(beside.get(item) ?? [])].filter(other => dashes.get(other) === dash).length;
    const [best] = dashesFrom(order.get(item)!).sort((a, b) => shared(a) - shared(b));
    // dashesFrom lists every dash; the sort is stable, so ties keep the preferred one.
    dashes.set(item, best!);
  }
}

// The n-th item's colour, given its dash and the items styled before it: lowest of, in turn,
// the overlapping lanes of the red-green family on the same dash (if the colour is of it), the
// lanes beside it of the same family on the same dash, and the items with the same style; ties
// go to the colour nearest after the preferred one.
function laneColour(
  n: number,
  item: string,
  dash: number,
  chosen: ReadonlyMap<string, { colour: number; dash: number }>,
  neighbours: LaneNeighbours,
): number {
  const count = (others: Iterable<string>, test: (colour: number) => boolean) =>
    [...others].filter(other => {
      const style = chosen.get(other);
      return style !== undefined && style.dash === dash && test(style.colour);
    }).length;
  const costs = (colour: number) => {
    const family = familyOf(LANE_COLOURS[colour]!);
    const sameFamily = (other: number) => familyOf(LANE_COLOURS[other]!) === family;
    return [
      family === 'red-green' ? count(neighbours.overlapping.get(item) ?? [], sameFamily) : 0,
      count(neighbours.beside.get(item) ?? [], sameFamily),
      count(chosen.keys(), other => other === colour),
    ];
  };
  let best = preferredColour(n),
    bestCosts = costs(best);
  for (let k = 1; k < LANE_COLOURS.length; k++) {
    const colour = (preferredColour(n) + k) % LANE_COLOURS.length,
      next = costs(colour);
    const at = next.findIndex((cost, i) => cost !== bestCosts[i]);
    if (at >= 0 && next[at]! < bestCosts[at]!) {
      best = colour;
      bestCosts = next;
    }
  }
  return best;
}

// How the page names the far end of a link: a line by its number (with its name where there
// is room), a place outside the group by its label, and a self link as "itself".
export interface FlowNames {
  lines: Map<string, FlowLine>;
  places: Map<string, string>;
}
// A raw resource's or an existing supply's place is named after its item, which the row already
// says: the row names the kind of source instead.
const PORT_WORDS: Partial<Record<FlowPort['kind'], string>> = {
  raw: 'Raw resource',
  supply: 'Existing supply',
};
export function flowNames(flow: GroupFlow): FlowNames {
  const places = new Map<string, string>();
  for (const port of [...flow.ins, ...flow.outs, ...flow.fold.ports])
    places.set(port.place, PORT_WORDS[port.kind] ?? port.label);
  return { lines: new Map(flow.lines.map(line => [line.id, line])), places };
}
const endName = (names: FlowNames, end: FlowLink['from'], withRecipe: boolean) => {
  if (end.kind === 'place') return names.places.get(end.id) ?? end.id;
  const line = names.lines.get(end.id);
  if (!line) return end.id;
  return withRecipe ? `${lineNumber(line.no)} ${line.name}` : lineNumber(line.no);
};

// Where an input row's item comes from: "from 01 Iron Ingot", "from itself", or a place outside
// the group such as "Raw resource", joined by commas.
export const sourcesText = (links: readonly FlowLink[], names: FlowNames): string =>
  links
    .map(link =>
      isSelfLink(link)
        ? 'from itself'
        : link.from.kind === 'line'
          ? 'from ' + endName(names, link.from, true)
          : endName(names, link.from, true),
    )
    .join(', ');

// Where an output row's item goes: "to 02, 03, AWESOME Sink", or "to itself" for a self link.
export const destinationsText = (links: readonly FlowLink[], names: FlowNames): string =>
  links.length
    ? 'to ' +
      links.map(link => (isSelfLink(link) ? 'itself' : endName(names, link.to, false))).join(', ')
    : '';

// Every link of the flow once, for the table: each input row's links (from inside the group,
// from outside it and from itself), then each output row's links to places outside the group.
export interface FlowConnection {
  from: string;
  to: string;
  link: FlowLink;
}
export function flowConnections(flow: GroupFlow, names: FlowNames): FlowConnection[] {
  const connection = (link: FlowLink): FlowConnection => ({
    from: endName(names, link.from, true),
    to: isSelfLink(link) ? 'itself' : endName(names, link.to, true),
    link,
  });
  return [
    ...flow.lines.flatMap(line => line.inputs.flatMap(row => row.links.map(connection))),
    ...flow.lines.flatMap(line =>
      line.outputs.flatMap(row =>
        row.links.filter(link => link.to.kind === 'place').map(connection),
      ),
    ),
  ];
}

// Where a row sits once laid out, in px from the top left of the lanes' drawing: `y` is the
// middle of the row's first line, the item's name, so a row that wraps onto two lines is
// pointed at by its name (#894); `x` is its card's left border.
export interface RowAnchor {
  x: number;
  y: number;
}

// The arrowhead: `long` px from its base to its tip, `half` px from its middle to each corner.
const ARROW = { long: 7, half: 4 };

// One link drawn on its lane: from a dot on the source card's border, level with its output row,
// out to the lane, along it, and back in to an arrowhead whose tip touches the target card's
// border, level with the input row. `lines` are the two lines it joins, which light it up.
export interface LaneWire {
  key: string;
  lines: [string, string];
  item: string;
  path: string;
  dot: { x: number; y: number };
  arrow: string;
  tip: { x: number; y: number };
  fromRow: string;
  toRow: string;
}

// The wires of every lane, from the rows' measured anchors. A link whose rows are not drawn (or
// not measured yet) is left out.
export function laneWires(
  lanes: readonly FlowLane[],
  anchors: ReadonlyMap<string, RowAnchor>,
  metrics: LaneMetrics,
): LaneWire[] {
  return lanes.flatMap(lane => {
    const start = anchors.get(lane.from);
    if (!start) return [];
    return lane.links.flatMap((link, i) => {
      // lane.to holds one input row per link, in the links' order.
      const toRow = lane.to[i]!;
      const end = anchors.get(toRow);
      if (!end || link.to.kind !== 'line') return [];
      const x = end.x - laneOffset(lane.lane, metrics),
        back = end.x - ARROW.long;
      return [
        {
          key: `${lane.from}>${toRow}`,
          lines: [lane.line, link.to.id],
          item: lane.item,
          path: `M${start.x},${start.y} H${x} V${end.y} H${back}`,
          dot: { x: start.x, y: start.y },
          arrow: `M${back},${end.y - ARROW.half} L${end.x},${end.y} L${back},${end.y + ARROW.half} Z`,
          tip: { x: end.x, y: end.y },
          fromRow: lane.from,
          toRow,
        },
      ];
    });
  });
}
