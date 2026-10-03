// The words and the lane drawing of a factory group's flow page (#894,
// ui/pages/GroupFlowPage.vue), from the group's flow (groupFlow in group-flow.ts, #893). The
// model says what moves where and which lane each output row's links ride; this module says how
// the page names a link's ends, which colour and dash each item's lanes take, and, once the page
// has measured where its rows sit, the paths it draws.
import { laneOffset } from '../group-flow.ts';
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

// The lane colours and dashes, from the :root tokens: one per item carried inside the group, in
// the order its lane first appears. Lanes must not differ by colour alone (#909, WCAG 1.4.1), so
// the dash turns with the colour from the first item on: two items in a row never share a dash,
// and the first 18 items (6 colours × 3 dashes) never share both. The warm hues (--accent, --red,
// --gold) take every other place and three different dashes, so among the first six close hues
// are never neighbours and never share a pattern.
const LANE_COLOURS = ['--accent', '--blue', '--red', '--green', '--gold', '--ink'];
const LANE_DASHES = ['', '7 4', '2 3'];
export interface LaneStyle {
  color: string;
  dash: string;
}
// The n-th item's style, from 0. The dash moves on one place per item and, after each round of
// the colours, one place further, so the next round pairs every colour with another dash.
export function laneStyleAt(n: number): LaneStyle {
  const round = Math.floor(n / LANE_COLOURS.length);
  return {
    color: `var(${LANE_COLOURS[n % LANE_COLOURS.length]})`,
    // The modulo keeps the index inside the list.
    dash: LANE_DASHES[(n + round) % LANE_DASHES.length]!,
  };
}
export function laneStyles(lanes: readonly FlowLane[]): Map<string, LaneStyle> {
  const styles = new Map<string, LaneStyle>();
  for (const lane of lanes)
    if (!styles.has(lane.item)) styles.set(lane.item, laneStyleAt(styles.size));
  return styles;
}

// How the page names the far end of a link: a line by its number (with its recipe where there
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
  return withRecipe ? `${lineNumber(line.no)} ${line.recipe}` : lineNumber(line.no);
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
