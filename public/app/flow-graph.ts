// The flow graph of one factory group (#1192, part of #1079): its production lines as boxes in
// layers from left to right, what comes in from other places on the left, what leaves on the
// right, and one edge per item moving between them with its rate per minute. Read-only: it is
// drawn from the group's flow (groupFlow in group-flow.ts), the same figures as the group's flow
// page, its line dialogs and the Logistics page's books, and every edge is one of the flow page's
// connections (flowConnections), so the graph and "The diagram as a table" never disagree.
//
// The layout is a plain layered one: places that send something in sit in layer 0, each line one
// layer right of the furthest line feeding it (a link back to a line built earlier, a recycling
// loop, does not count), and places that receive something one layer right of the last line. An
// edge that skips layers passes through a gap reserved for it in each layer between (`waypoint`),
// so it never runs behind a box; a few sweeps order each layer by where its neighbours sit, which
// keeps crossings down. A link from a line back into itself (#898) is no edge on the drawing: the
// box says it under its machines. Deterministic: it reads only its arguments.
//
// Storage and the sink (#1231): an edge into Protected storage or the AWESOME Sink is `quiet`,
// which the dialog draws thin, grey and behind the others, without a label until it is lit. With
// `tags` (the factory's "Show storage and sink as tags") those edges are drawn as a tag per
// destination on their line's right edge instead ("▣ 2/min", "♻ 4.3/min"), and the two places'
// boxes are left out; the edges stay in `edges` for the table. Every label sits at the middle of
// its curve, slid along it where it would cover something (spreadLabels in graph-labels.ts).
import type { FlowLine, FlowLink, GroupFlow, PortKind } from './group-flow.ts';
import { OUTSIDE } from './group-links.ts';
import {
  spreadLabels,
  straightCurve,
  type GraphBox,
  type GraphCurve,
  type LabelToPlace,
  type PlacedLabel,
} from './graph-labels.ts';
import { flowConnections, flowNames, isSelfLink, lineNumber } from './views/group-flow-page.ts';

// Sizes in px. Monospaced type keeps text widths predictable: GRAPH_CHAR is a character's width
// at the edge labels' size, which the label boxes are measured with.
export const GRAPH = {
  pad: 16,
  nodeWidth: 216,
  nodeHeight: 48,
  // A text line under a box's caption (the rates, #1308, and a line's own-output note): each adds
  // this much to the box. The lines are cut to `captionChars`, a rate never.
  textLine: 16,
  // The rates a box shows: at most this many, and "+N more" for the rest.
  rateLines: 2,
  gap: 196,
  rowGap: 24,
  waypoint: 8,
  port: 14,
  backLane: 14,
  labelHeight: 30,
  char: 6.6,
  nameChars: 26,
  captionChars: 30,
  // A storage or sink tag (#1231): its height, the room between two tags of a line, how far right
  // of the line's box and down from its top they start, and the room around a tag's text.
  tagHeight: 17,
  tagGap: 3,
  tagInset: 4,
  tagTop: 4,
  tagPad: 12,
} as const;

// Which side of the group a box stands for: a place that sends something in, a line of the group,
// or a place that receives something.
export type GraphNodeKind = 'in' | 'line' | 'out';

export interface GraphNode {
  // 'in:<place>', 'line:<row id>' or 'out:<place>': a place that both sends and receives has a box
  // on each side.
  id: string;
  kind: GraphNodeKind;
  // The full name and the line under it, each also as the box has room for it (cut with "…").
  label: string;
  shortLabel: string;
  caption: string;
  shortCaption: string;
  // A line's own output going back into itself (#898): "↻ 30 m³/min Water back in", else ''.
  selfNote: string;
  // What the box makes (a production line: its outputs, main product first), draws (an input: what
  // leaves it for the factory) or receives (an output): one entry per item, summed over the box's
  // edges (#1308); `rateLines` is what the box says of them under its caption, and `rateTitle`
  // all of them for the hover title and screen readers ('' without any).
  rates: NodeRate[];
  rateLines: string[];
  rateTitle: string;
  // The height the box had before it showed its rates (#1308), which a layout saved then was
  // spaced for.
  baseHeight: number;
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

// One item a box makes, draws or receives: `rate` is the sum of the rates of its edges for the
// item, as they are (one rounding, `text`, at display).
export interface NodeRate {
  item: string;
  rate: number;
  text: string;
}

export interface GraphEdge {
  // Unique in the graph, in the order of the flow page's connections.
  id: string;
  from: string;
  to: string;
  item: string;
  rate: number;
  // The rate as the pages write it (`rateText`), and how the flow page's table names the two ends.
  rateText: string;
  fromText: string;
  toText: string;
  // 'loop' for a link to a line built earlier (a recycling loop needs a starter batch), 'self' for
  // a line's own output going back into it, else ''.
  note: '' | 'loop' | 'self';
  // Into Protected storage or the AWESOME Sink (#1231): drawn quietly, or as a tag (`asTag`, with
  // the graph's `tags` option, and then not drawn as an arrow).
  quiet: boolean;
  asTag: boolean;
  // The drawn path, where its label sits (its middle) and the curve of the path it sits on, which
  // the label slides along when lit labels are spread; null for an edge that is not drawn (a self
  // link, a tag). A label with no free spot at rest is `crowded` (#1019): the dialog leaves it
  // out until its arrow is pointed at or its box lit.
  path: string | null;
  label: { x: number; y: number; width: number; crowded?: true } | null;
  curve: GraphCurve | null;
}

// A line's storage or sink flows as one tag on its box's right edge (#1231): "▣ 2/min" for
// Protected storage, "♻ 4.3/min" for the AWESOME Sink, summed; `name` lists the items, for the
// hover title and screen readers. `index` stacks a line's tags from the top of its box.
export interface GraphTag {
  id: string;
  node: string;
  place: 'storage' | 'sink';
  text: string;
  name: string;
  edges: string[];
  index: number;
  width: number;
}

export interface FlowGraph {
  group: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  tags: GraphTag[];
  layers: number;
  // Crossings of the automatic layout's arrows (the forward ones, as laid out): every pair, and the
  // pairs of arrows that are not quiet (storage and sink arrows are thin and grey, FG-1).
  crossings: { all: number; loud: number };
  width: number;
  height: number;
  // Boxes drawn below where they were stored because they grew to show their rates (placedGraph's
  // `settle`, #1308), by node id at the spot they are drawn; absent when none was moved.
  nudged?: Record<string, [number, number]>;
}

// What a graph is drawn with: `tags` draws the storage and sink flows as tags on their lines.
export interface GraphOptions {
  tags?: boolean;
  // How hard the order of the boxes in each column is worked at (FG-1, #1343): see Ordering.
  // Default ORDERING; a test passes PREVIOUS_ORDERING to count the crossings the layout had before.
  ordering?: Ordering;
}

// The places whose edges are quiet: Protected storage and the AWESOME Sink, the right-hand boxes
// almost every line sends a little to.
const QUIET_PLACES: ReadonlySet<string> = new Set([
  'out:' + OUTSIDE.storage,
  'out:' + OUTSIDE.surplus,
]);
export const isQuietPlace = (nodeId: string): boolean => QUIET_PLACES.has(nodeId);

// The words under a place's name, by kind, as the flow page's port boxes say them.
const PLACE_CAPTIONS: Record<PortKind, string> = {
  raw: 'Raw resource',
  supply: 'Existing supply',
  group: 'Factory',
  ungrouped: 'Ungrouped lines',
  outside: 'Destination',
};

// A name cut to `chars` characters with "…" when longer.
export const shortText = (text: string, chars: number): string => {
  const letters = [...text];
  return letters.length > chars ? letters.slice(0, chars - 1).join('') + '…' : text;
};

// How the graph words a rate: the page passes itemRate (flow.ts), "60/min" or "30 m³/min".
export type GraphRate = (item: string, rate: number) => string;
// What a line box says under its name: the page passes the machines as the flow page's table
// writes them ("2 × Constructor").
export type GraphCaption = (line: FlowLine) => string;

const endId = (end: FlowLink['from'], side: 'in' | 'out'): string =>
  end.kind === 'line' ? 'line:' + end.id : side + ':' + end.id;

// The graph of `flow`. `rateText` words a rate, `caption` a line's machines; `options.tags` draws
// the storage and sink flows as tags on their lines instead of arrows to two boxes.
export function flowGraph(
  flow: GroupFlow,
  rateText: GraphRate,
  caption: GraphCaption,
  options: GraphOptions = {},
): FlowGraph {
  const names = flowNames(flow);
  const edges: GraphEdge[] = flowConnections(flow, names).map((connection, i) => {
    const link = connection.link;
    const self = isSelfLink(link);
    const from = endId(link.from, 'in'),
      to = endId(link.to, 'out');
    const quiet = QUIET_PLACES.has(to);
    return {
      id: 'e' + i,
      from,
      to,
      item: link.item,
      rate: link.rate,
      rateText: rateText(link.item, link.rate),
      fromText: connection.from,
      toText: connection.to,
      note: self ? 'self' : link.loop ? 'loop' : '',
      quiet,
      asTag: quiet && !!options.tags && from.startsWith('line:'),
      path: null,
      label: null,
      curve: null,
    };
  });
  // A place every edge into which is a tag has no box.
  const tagOnly = new Set(
    [...QUIET_PLACES].filter(
      place =>
        edges.some(edge => edge.to === place) &&
        edges.every(edge => edge.to !== place || edge.asTag),
    ),
  );
  const nodes = graphNodes(flow, rateText, caption).filter(node => !tagOnly.has(node.id));
  addRates(nodes, edges, flow, rateText);
  const tags = graphTags(edges, rateText);
  const { bottom, crossings } = layOut(
    nodes,
    edges.filter(edge => !edge.asTag),
    tags,
    options.ordering ?? ORDERING,
  );
  const byId = new Map(nodes.map(node => [node.id, node]));
  const width =
    Math.max(0, tagsRight(tags, byId), ...nodes.map(node => node.x + node.width)) + GRAPH.pad;
  return {
    group: flow.group,
    nodes,
    edges,
    tags,
    layers: Math.max(0, ...nodes.map(node => node.layer + 1)),
    crossings,
    width,
    height: graphHeight(bottom, edges),
  };
}

// What a tag says for its destination, and the start of its name (#1231).
const TAG_PLACES = [
  { place: 'storage', id: 'out:' + OUTSIDE.storage, mark: '▣', to: 'To protected storage' },
  { place: 'sink', id: 'out:' + OUTSIDE.surplus, mark: '♻', to: 'To the AWESOME Sink' },
] as const;

// The tags of the edges drawn as tags: per line (in the order of their edges), one for storage
// and one for the sink, each with its edges' rates summed ("♻ 4.3/min"; solids and fluids each
// summed on their own, "+" between) and its items listed in its name.
function graphTags(edges: readonly GraphEdge[], rateText: GraphRate): GraphTag[] {
  const tags: GraphTag[] = [];
  const lines = [...new Set(edges.filter(edge => edge.asTag).map(edge => edge.from))];
  for (const line of lines) {
    let index = 0;
    for (const place of TAG_PLACES) {
      const own = edges.filter(edge => edge.asTag && edge.from === line && edge.to === place.id);
      if (!own.length) continue;
      const text = `${place.mark} ${summedRate(own, rateText)}`;
      tags.push({
        id: `tag:${line}:${place.place}`,
        node: line,
        place: place.place,
        text,
        name: `${place.to}: ${own.map(edge => `${edge.item} ${edge.rateText}`).join(', ')}`,
        edges: own.map(edge => edge.id),
        index: index++,
        width: Math.ceil([...text].length * GRAPH.char) + GRAPH.tagPad,
      });
    }
  }
  return tags;
}

// The rates of `edges` added up, worded by `rateText`: the edges in one unit (the words a rate of
// 0 gets, "0/min" or "0 m³/min") summed together.
function summedRate(edges: readonly GraphEdge[], rateText: GraphRate): string {
  const sums = new Map<string, { item: string; rate: number }>();
  for (const edge of edges) {
    const unit = rateText(edge.item, 0);
    const sum = sums.get(unit);
    if (sum) sum.rate += edge.rate;
    else sums.set(unit, { item: edge.item, rate: edge.rate });
  }
  return [...sums.values()].map(sum => rateText(sum.item, sum.rate)).join(' + ');
}

// Where tag `tag` sits on its line's box `node`: by its middle, as the labels' boxes are.
export const tagBox = (tag: GraphTag, node: GraphNode): GraphBox => ({
  x: node.x + node.width + GRAPH.tagInset + tag.width / 2,
  y: node.y + GRAPH.tagTop + tag.index * (GRAPH.tagHeight + GRAPH.tagGap) + GRAPH.tagHeight / 2,
  width: tag.width,
  height: GRAPH.tagHeight,
});
// The boxes and tags of a graph as obstacles for its labels, by their middles.
export function labelObstacles(nodes: readonly GraphNode[], tags: readonly GraphTag[]): GraphBox[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  return [
    ...nodes.map(node => ({
      x: node.x + node.width / 2,
      y: node.y + node.height / 2,
      width: node.width,
      height: node.height,
    })),
    ...tags.flatMap(tag => {
      const node = byId.get(tag.node);
      return node ? [tagBox(tag, node)] : [];
    }),
  ];
}
// The right edge of the rightmost tag, or 0.
export function tagsRight(tags: readonly GraphTag[], byId: ReadonlyMap<string, GraphNode>): number {
  let right = 0;
  for (const tag of tags) {
    const node = byId.get(tag.node);
    if (node) right = Math.max(right, node.x + node.width + GRAPH.tagInset + tag.width);
  }
  return right;
}

// The boxes: the places that send something in (in the order the flow page lists them), the
// lines in build order, and the places that receive something.
function graphNodes(flow: GroupFlow, rateText: GraphRate, caption: GraphCaption): GraphNode[] {
  const node = (id: string, kind: GraphNodeKind, label: string, under: string, self = '') => ({
    id,
    kind,
    label,
    shortLabel: shortText(label, GRAPH.nameChars),
    caption: under,
    shortCaption: shortText(under, GRAPH.captionChars),
    selfNote: self,
    rates: [] as NodeRate[],
    rateLines: [] as string[],
    rateTitle: '',
    baseHeight: self ? GRAPH.nodeHeight + GRAPH.textLine : GRAPH.nodeHeight,
    layer: 0,
    x: 0,
    y: 0,
    width: GRAPH.nodeWidth,
    height: self ? GRAPH.nodeHeight + GRAPH.textLine : GRAPH.nodeHeight,
  });
  const places = (ports: GroupFlow['ins'], side: 'in' | 'out') => {
    const seen = new Map<string, GraphNode>();
    for (const port of ports)
      if (!seen.has(port.place))
        seen.set(
          port.place,
          node(side + ':' + port.place, side, port.label, PLACE_CAPTIONS[port.kind]),
        );
    return [...seen.values()];
  };
  const selfNote = (line: FlowLine) =>
    line.outputs
      .flatMap(row => row.links.filter(isSelfLink))
      .map(link => `↻ ${rateText(link.item, link.rate)} ${link.item} back in`)
      .join(', ');
  return [
    ...places(flow.ins, 'in'),
    ...flow.lines.map(line =>
      node(
        'line:' + line.id,
        'line',
        `${lineNumber(line.no)} ${line.name}`,
        caption(line),
        selfNote(line),
      ),
    ),
    ...places([...flow.outs, ...flow.fold.ports], 'out'),
  ];
}

// What each box makes, draws or receives (#1308), from the graph's edges themselves: a line the
// items its edges leave it with (its own output going back into it too), an input what its edges
// bring in, an output what its edges take; an item's rates added in the edges' order and worded
// once, by `rateText`, so a box's figure is the sum of its arrows' (a tag's or quiet arrow's
// too). A line's items come in the order of its outputs, so its main product is first; an input's
// or an output's by rate, the largest first, ties in the edges' order. Sets each box's rates, the
// lines it draws (a line at most GRAPH.rateLines of them, an input or an output that many, then
// "+N more") and its height, a text line (GRAPH.textLine) taller for each.
function addRates(
  nodes: GraphNode[],
  edges: readonly GraphEdge[],
  flow: GroupFlow,
  rateText: GraphRate,
) {
  const order = new Map(
    flow.lines.map(line => ['line:' + line.id, line.outputs.map(row => row.item)] as const),
  );
  for (const node of nodes) {
    const own = edges.filter(edge => (node.kind === 'out' ? edge.to : edge.from) === node.id);
    const sums = new Map<string, number>();
    for (const edge of own) sums.set(edge.item, (sums.get(edge.item) ?? 0) + edge.rate);
    const items = [...sums.keys()];
    const first = order.get(node.id) ?? [];
    if (node.kind === 'line') items.sort((a, b) => rankOf(first, a) - rankOf(first, b));
    else items.sort((a, b) => sums.get(b)! - sums.get(a)!);
    node.rates = items.map(item => ({
      item,
      rate: sums.get(item)!,
      text: rateText(item, sums.get(item)!),
    }));
    // A line with more outputs than fit shows its main product and "+ N more".
    const shown =
      node.kind === 'line' && node.rates.length > GRAPH.rateLines
        ? node.rates.slice(0, 1)
        : node.rates.slice(0, GRAPH.rateLines);
    const rest = node.rates.length - shown.length;
    node.rateLines = [
      ...shown.map(rate => rateLine(node.kind, rate)),
      ...(rest > 0 ? [`${node.kind === 'line' ? '+ ' : '+'}${rest} more`] : []),
    ];
    node.rateTitle = node.rates.map(rate => `${rate.item} ${rate.text}`).join(', ');
    node.height = node.baseHeight + node.rateLines.length * GRAPH.textLine;
  }
}
// Where `item` stands in a line's outputs; one it does not list (none) goes last.
const rankOf = (order: readonly string[], item: string): number => {
  const at = order.indexOf(item);
  return at < 0 ? order.length : at;
};

// One rate as a box says it: "→ Concrete 2,395.25/min" for what a line makes, "Limestone ·
// 3,810.38/min" for what an input draws, "Concrete 2,380.13/min" for what an output receives. Too
// long for the box, the item's name is cut, never the rate.
function rateLine(kind: GraphNodeKind, rate: NodeRate): string {
  const [head, glue] = kind === 'line' ? ['→ ', ' '] : kind === 'in' ? ['', ' · '] : ['', ' '];
  const room = GRAPH.captionChars - [...(head + glue + rate.text)].length;
  return head + shortText(rate.item, Math.max(4, room)) + glue + rate.text;
}

// One place in a layer: a box, or the gap an edge passes through on its way past the layer.
interface Slot {
  key: string;
  layer: number;
  height: number;
  node?: GraphNode;
  y: number;
}

// Gives each node its layer and place, and each drawn edge (all of `edges` but self links) its
// path and label. Returns the bottom of the lowest box or waypoint.
function layOut(
  nodes: GraphNode[],
  edges: GraphEdge[],
  tags: readonly GraphTag[],
  ordering: Ordering,
): { bottom: number; crossings: { all: number; loud: number } } {
  const byId = new Map(nodes.map(node => [node.id, node]));
  assignLayers(nodes, edges, byId);
  const forward = edges.filter(edge => edge.note !== 'self' && isForward(edge, byId));
  fitPorts(nodes, forward);
  const { layers, chains } = slotLayers(nodes, forward, byId);
  const crossings = orderLayers(layers, chains, ordering);
  placeSlots(layers, chains);
  const bottom = Math.max(0, ...layers.flat().map(slot => slot.y + slot.height));
  const back = edges.filter(edge => edge.note !== 'self' && !isForward(edge, byId));
  const curves = routeForward(forward, chains, byId);
  for (const [edge, lane] of routeBack(back, bottom, byId)) curves.set(edge, [lane]);
  placeEdgeLabels(edges, curves, labelObstacles(nodes, tags));
  return { bottom, crossings };
}

// A box with many edges on one side grows to give each its own port, GRAPH.port apart.
function fitPorts(nodes: GraphNode[], forward: GraphEdge[]) {
  for (const node of nodes) {
    const ins = forward.filter(edge => edge.to === node.id).length,
      outs = forward.filter(edge => edge.from === node.id).length;
    const ports = (Math.max(ins, outs) + 1) * GRAPH.port;
    node.height = Math.max(node.height, ports);
    node.baseHeight = Math.max(node.baseHeight, ports);
  }
}

const nodeOf = (byId: ReadonlyMap<string, GraphNode>, id: string): GraphNode => {
  const node = byId.get(id);
  if (!node) throw new Error('No graph node ' + id);
  return node;
};
const isForward = (edge: GraphEdge, byId: ReadonlyMap<string, GraphNode>) =>
  nodeOf(byId, edge.to).layer > nodeOf(byId, edge.from).layer;

// Layer 0 for the places sending in (none: the lines start at 0), each line one past the furthest
// line feeding it that is built before it, and the places receiving one past the last line.
function assignLayers(
  nodes: GraphNode[],
  edges: GraphEdge[],
  byId: ReadonlyMap<string, GraphNode>,
) {
  const first = nodes.some(node => node.kind === 'in') ? 1 : 0;
  let last = first;
  for (const node of nodes) {
    if (node.kind !== 'line') continue;
    let layer = first;
    for (const edge of edges)
      if (edge.to === node.id && edge.note === '' && edge.from.startsWith('line:'))
        layer = Math.max(layer, nodeOf(byId, edge.from).layer + 1);
    node.layer = layer;
    last = Math.max(last, layer);
  }
  const out = nodes.some(node => node.kind === 'line') ? last + 1 : first;
  for (const node of nodes) if (node.kind === 'out') node.layer = out;
}

// The slots of each layer, the boxes in the nodes' order, and for each forward edge the chain of
// slots it passes: its source's box, a waypoint in each layer between, its target's box.
function slotLayers(
  nodes: GraphNode[],
  forward: GraphEdge[],
  byId: ReadonlyMap<string, GraphNode>,
): { layers: Slot[][]; chains: Map<GraphEdge, Slot[]> } {
  const layers: Slot[][] = [];
  const add = (slot: Slot) => {
    while (layers.length <= slot.layer) layers.push([]);
    // The loop above makes the layer.
    layers[slot.layer]!.push(slot);
    return slot;
  };
  const boxes = new Map(
    nodes.map(node => [
      node.id,
      add({ key: node.id, layer: node.layer, height: node.height, node, y: 0 }),
    ]),
  );
  const chains = new Map<GraphEdge, Slot[]>();
  for (const edge of forward) {
    const from = nodeOf(byId, edge.from),
      to = nodeOf(byId, edge.to);
    const chain = [boxes.get(from.id)!];
    for (let layer = from.layer + 1; layer < to.layer; layer++)
      chain.push(add({ key: edge.id + '@' + layer, layer, height: GRAPH.waypoint, y: 0 }));
    chain.push(boxes.get(to.id)!);
    chains.set(edge, chain);
  }
  return { layers, chains };
}

// How the boxes of each column are put in order (FG-1, #1343): `passes` of barycenter sweeps (each
// down the columns, then back up), from `restarts` starts (the first is the order the boxes come
// in, the others shuffled with a seeded generator, so the layout is the same every time), each
// then improved by swapping neighbours while that removes a crossing (`transpose`); the order with
// the fewest crossings is kept, the earliest of equals.
export interface Ordering {
  passes: number;
  restarts: number;
  transpose: boolean;
}
export const ORDERING: Ordering = { passes: 10, restarts: 8, transpose: true };
// The layout before #1343: four sweeps from the one start. The tests count its crossings to show
// what the new one saves.
export const PREVIOUS_ORDERING: Ordering = { passes: 4, restarts: 1, transpose: false };

// A hop of an arrow from one slot to the one in the next column.
interface Hop {
  from: Slot;
  to: Slot;
  quiet: boolean;
}

// Two hops between the same two columns cross when their ends are in opposite orders.
function crossingsBetween(hops: readonly Hop[], place: ReadonlyMap<Slot, number>) {
  let all = 0,
    loud = 0;
  for (let i = 0; i < hops.length; i++)
    for (let j = i + 1; j < hops.length; j++) {
      const one = hops[i]!,
        other = hops[j]!;
      const across =
        (place.get(one.from)! - place.get(other.from)!) *
        (place.get(one.to)! - place.get(other.to)!);
      if (across >= 0) continue;
      all++;
      if (!one.quiet && !other.quiet) loud++;
    }
  return { all, loud };
}
// What an order costs: every crossing, the ones between arrows that are not quiet counting four.
const cost = (found: { all: number; loud: number }) => found.all + 3 * found.loud;

// A small seeded generator (mulberry32), so the restarts shuffle the same way every time.
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Puts every column in the order with the fewest crossings (see Ordering); returns its crossings.
function orderLayers(
  layers: Slot[][],
  chains: ReadonlyMap<GraphEdge, Slot[]>,
  ordering: Ordering,
): { all: number; loud: number } {
  const hops: Hop[] = [];
  const before = new Map<Slot, Slot[]>(),
    after = new Map<Slot, Slot[]>();
  for (const [edge, chain] of chains)
    for (let i = 1; i < chain.length; i++) {
      // i and i - 1 are inside the chain.
      const left = chain[i - 1]!,
        right = chain[i]!;
      hops.push({ from: left, to: right, quiet: edge.quiet });
      before.set(right, [...(before.get(right) ?? []), left]);
      after.set(left, [...(after.get(left) ?? []), right]);
    }
  // The hops from column n to the one after it.
  const hopsFrom = layers.map((_, n) => hops.filter(hop => hop.from.layer === n));
  const placesOf = (order: Slot[][]) => {
    const place = new Map<Slot, number>();
    for (const layer of order) layer.forEach((slot, i) => place.set(slot, i));
    return place;
  };
  const total = (order: Slot[][]) => {
    const place = placesOf(order);
    const sum = { all: 0, loud: 0 };
    for (const list of hopsFrom) {
      const found = crossingsBetween(list, place);
      sum.all += found.all;
      sum.loud += found.loud;
    }
    return sum;
  };
  const sortBy = (layer: Slot[], neighbours: Map<Slot, Slot[]>, side: Slot[]) => {
    const place = new Map(side.map((slot, i) => [slot, i]));
    const key = new Map(
      layer.map((slot, i) => {
        const near = (neighbours.get(slot) ?? []).filter(other => place.has(other));
        return [
          slot,
          near.length ? near.reduce((sum, other) => sum + place.get(other)!, 0) / near.length : i,
        ] as const;
      }),
    );
    layer.sort((a, b) => key.get(a)! - key.get(b)!);
  };
  // Swaps neighbours in a column while a swap lowers the cost of the hops on both its sides.
  const transpose = (order: Slot[][]) => {
    const place = placesOf(order);
    const local = (n: number) =>
      cost(crossingsBetween(hopsFrom[n] ?? [], place)) +
      cost(crossingsBetween(n > 0 ? hopsFrom[n - 1]! : [], place));
    for (let round = 0, changed = true; changed && round < 20; round++) {
      changed = false;
      order.forEach((layer, n) => {
        for (let i = 0; i + 1 < layer.length; i++) {
          const one = layer[i]!,
            other = layer[i + 1]!;
          const was = local(n);
          place.set(one, i + 1);
          place.set(other, i);
          if (local(n) < was) {
            layer[i] = other;
            layer[i + 1] = one;
            changed = true;
          } else {
            place.set(one, i);
            place.set(other, i + 1);
          }
        }
      });
    }
  };
  const random = seeded(1343);
  const shuffled = <T>(list: readonly T[]): T[] => {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  };
  let best = layers.map(layer => [...layer]);
  let bestFound = { all: Infinity, loud: Infinity };
  for (let start = 0; start < Math.max(1, ordering.restarts); start++) {
    const order = layers.map(layer => (start === 0 ? [...layer] : shuffled(layer)));
    for (let pass = 0; pass < ordering.passes; pass++) {
      for (let i = 1; i < order.length; i++) sortBy(order[i]!, before, order[i - 1]!);
      for (let i = order.length - 2; i >= 0; i--) sortBy(order[i]!, after, order[i + 1]!);
    }
    if (ordering.transpose) transpose(order);
    const found = total(order);
    if (cost(found) < cost(bestFound)) {
      best = order;
      bestFound = found;
    }
  }
  layers.forEach((layer, n) => layer.splice(0, layer.length, ...best[n]!));
  return bestFound.all === Infinity ? { all: 0, loud: 0 } : bestFound;
}

// How many passes of averaging the boxes' heights get (placeSlots).
const PLACE_PASSES = 8;

// The slots of one column at the heights nearest `wanted` (a top per slot) that keep their order
// with GRAPH.rowGap between them: the least squared move, found by pooling neighbours that would
// otherwise overlap (isotonic regression on the tops less the room above each).
function nearestTops(layer: readonly Slot[], wanted: readonly number[]): number[] {
  const room: number[] = [];
  let above = 0;
  for (const slot of layer) {
    room.push(above);
    above += slot.height + GRAPH.rowGap;
  }
  const blocks: { sum: number; count: number }[] = [];
  wanted.forEach((top, i) => {
    blocks.push({ sum: top - room[i]!, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1]!,
        prev = blocks[blocks.length - 2]!;
      if (prev.sum / prev.count <= last.sum / last.count) break;
      blocks.splice(blocks.length - 2, 2, {
        sum: prev.sum + last.sum,
        count: prev.count + last.count,
      });
    }
  });
  const tops: number[] = [];
  for (const block of blocks)
    for (let k = 0; k < block.count; k++) tops.push(block.sum / block.count + room[tops.length]!);
  return tops;
}

// The columns' boxes and waypoints placed (FG-1, #1343): stacked from the top and centred on the
// tallest column to start with, then PLACE_PASSES times a sweep to the right (each slot moves
// toward the middle of the slots feeding it) and one back to the left (toward the ones it
// feeds), never closer than GRAPH.rowGap, so a line with one neighbour stands level with it and
// a waypoint runs straight. Everything then moves up so the top slot has its padding, on whole units.
function placeSlots(layers: Slot[][], chains: ReadonlyMap<GraphEdge, Slot[]>) {
  const heightOf = (layer: Slot[]) =>
    layer.reduce((sum, slot) => sum + slot.height, 0) +
    Math.max(0, layer.length - 1) * GRAPH.rowGap;
  const tallest = Math.max(0, ...layers.map(heightOf));
  for (const layer of layers) {
    let y = (tallest - heightOf(layer)) / 2;
    for (const slot of layer) {
      slot.y = y;
      y += slot.height + GRAPH.rowGap;
    }
  }
  const before = new Map<Slot, Slot[]>(),
    after = new Map<Slot, Slot[]>();
  for (const chain of chains.values())
    for (let i = 1; i < chain.length; i++) {
      const left = chain[i - 1]!,
        right = chain[i]!;
      before.set(right, [...(before.get(right) ?? []), left]);
      after.set(left, [...(after.get(left) ?? []), right]);
    }
  const middle = (slot: Slot) => slot.y + slot.height / 2;
  const settle = (layer: Slot[], sides: readonly Map<Slot, Slot[]>[]) => {
    const wanted = layer.map(slot => {
      const near = sides.flatMap(side => side.get(slot) ?? []);
      return near.length
        ? near.reduce((sum, other) => sum + middle(other), 0) / near.length - slot.height / 2
        : slot.y;
    });
    nearestTops(layer, wanted).forEach((top, i) => (layer[i]!.y = top));
  };
  for (let pass = 0; pass < PLACE_PASSES; pass++) {
    for (let i = 1; i < layers.length; i++) settle(layers[i]!, [before]);
    for (let i = layers.length - 2; i >= 0; i--) settle(layers[i]!, [after]);
  }
  for (const layer of layers) settle(layer, [before, after]);
  const top = Math.min(...layers.flat().map(slot => slot.y));
  const start = GRAPH.pad + GRAPH.labelHeight / 2;
  layers.forEach((layer, n) => {
    for (const slot of layer) {
      slot.y = Math.round(slot.y + start - top);
      if (slot.node) {
        slot.node.x = columnX(n);
        slot.node.y = slot.y;
      }
    }
  });
}
const columnX = (layer: number) => GRAPH.pad + layer * (GRAPH.nodeWidth + GRAPH.gap);

interface Point {
  x: number;
  y: number;
}

// The S-curve between two layers from `from` to `to`, leaving and entering level (forwardPath's).
const sCurve = (from: Point, to: Point): GraphCurve => {
  const bend = (to.x - from.x) / 2;
  return { from, c1: { x: from.x + bend, y: from.y }, c2: { x: to.x - bend, y: to.y }, to };
};

// Each forward edge's path through its chain of slots, and the curves its label may sit on. Where
// an edge leaves its source and enters its target: the edges on one side of a box spread evenly
// down that side, in the order of where their other ends are (the next slot along the edge: its
// target's box, or the gap it passes the next layer in), so they do not cross there.
function routeForward(
  forward: GraphEdge[],
  chains: ReadonlyMap<GraphEdge, Slot[]>,
  byId: ReadonlyMap<string, GraphNode>,
): Map<GraphEdge, GraphCurve[]> {
  const middle = (slot: Slot) => slot.y + slot.height / 2;
  const ports = (side: 'out' | 'in') => {
    const at = new Map<GraphEdge, number>();
    const groups = new Map<string, GraphEdge[]>();
    for (const edge of forward) {
      const key = side === 'out' ? edge.from : edge.to;
      groups.set(key, [...(groups.get(key) ?? []), edge]);
    }
    for (const [id, list] of groups) {
      const node = nodeOf(byId, id);
      // The neighbouring slot along the chain: the next one leaving, the one before entering.
      const other = (edge: GraphEdge) => {
        const chain = chains.get(edge)!;
        return middle(side === 'out' ? chain[1]! : chain[chain.length - 2]!);
      };
      const sorted = [...list].sort((a, b) => other(a) - other(b));
      const top = node.y + 10,
        span = Math.max(GRAPH.nodeHeight, node.height) - 20;
      sorted.forEach((edge, i) => at.set(edge, top + (span * (i + 1)) / (sorted.length + 1)));
    }
    return at;
  };
  const outs = ports('out'),
    ins = ports('in');
  const gaps = new Map<GraphEdge, GraphCurve[]>();
  for (const edge of forward) {
    const chain = chains.get(edge)!;
    const points: Point[] = [];
    chain.forEach((slot, i) => {
      const x = columnX(slot.layer);
      if (i === 0) points.push({ x: x + GRAPH.nodeWidth, y: outs.get(edge)! });
      else if (i === chain.length - 1) points.push({ x, y: ins.get(edge)! });
      else points.push({ x, y: middle(slot) }, { x: x + GRAPH.nodeWidth, y: middle(slot) });
    });
    edge.path = forwardPath(points);
    // Its label may sit on any of its curves between two layers: the first, after its source,
    // then the last, before its target, then those between. A quiet edge's sits on the first, by
    // the line it comes from.
    const curves: GraphCurve[] = [];
    for (let i = 0; i + 1 < points.length; i += 2) curves.push(sCurve(points[i]!, points[i + 1]!));
    gaps.set(edge, edge.quiet ? [curves[0]!] : [curves[0]!, ...curves.slice(1).reverse()]);
  }
  return gaps;
}

// Between two layers a path is an S-curve leaving and entering level; through a waypoint it runs
// straight across the layer.
function forwardPath(points: Point[]): string {
  // A forward chain has at least its two ends.
  let path = `M${round(points[0]!.x)},${round(points[0]!.y)}`;
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]!,
      to = points[i]!;
    if (i % 2 === 1) {
      const bend = (to.x - from.x) / 2;
      path += ` C${round(from.x + bend)},${round(from.y)} ${round(to.x - bend)},${round(to.y)} ${round(to.x)},${round(to.y)}`;
    } else path += ` H${round(to.x)}`;
  }
  return path;
}
const round = (value: number) => Math.round(value * 10) / 10;

// An edge to a box in the same layer or one to its left (a recycling loop): out of the source's
// right side, down below every box, back left and up into the target's left side, each on a lane
// of its own under the boxes. Returns each one's lane, which its label slides along.
function routeBack(
  back: GraphEdge[],
  bottom: number,
  byId: ReadonlyMap<string, GraphNode>,
): Map<GraphEdge, GraphCurve> {
  const lanes = new Map<GraphEdge, GraphCurve>();
  back.forEach((edge, i) => {
    const from = nodeOf(byId, edge.from),
      to = nodeOf(byId, edge.to);
    const lane = bottom + GRAPH.labelHeight + (i + 1) * GRAPH.backLane;
    const sx = from.x + from.width,
      sy = from.y + from.height / 2,
      tx = to.x,
      ty = to.y + to.height / 2;
    const reach = GRAPH.gap / 4;
    edge.path =
      `M${round(sx)},${round(sy)} C${round(sx + reach)},${round(sy)} ${round(sx + reach)},${round(lane)} ${round(sx)},${round(lane)}` +
      ` H${round(tx)} C${round(tx - reach)},${round(lane)} ${round(tx - reach)},${round(ty)} ${round(tx)},${round(ty)}`;
    lanes.set(edge, straightCurve({ x: sx, y: lane }, { x: tx, y: lane }));
  });
  return lanes;
}

// A label is the item over its rate, as wide as the longer of the two.
const labelWidth = (edge: GraphEdge) =>
  Math.ceil(Math.max([...edge.item].length, [...edge.rateText].length) * GRAPH.char) + 8;

// Each drawn edge's label at rest (#1231), on one of `curves` (by edge, in the order it tries
// them): at the middle of its curve, slid along it where it would cover one of `obstacles` (the
// boxes and tags) or a label placed before it, and at the middle of its first curve, `crowded`,
// where nothing is free (spreadLabels, top to bottom). The quiet edges' labels, hidden until lit,
// come after the others and make room for them, not for each other, nor for a crowded one. Sets
// each edge's `label` and `curve`.
export function placeEdgeLabels(
  edges: readonly GraphEdge[],
  curves: ReadonlyMap<GraphEdge, readonly GraphCurve[]>,
  obstacles: readonly GraphBox[],
) {
  const toPlace = (edge: GraphEdge): LabelToPlace => ({
    id: edge.id,
    width: labelWidth(edge),
    curves: curves.get(edge) ?? [],
  });
  const byId = new Map(edges.map(edge => [edge.id, edge]));
  const set = (spots: Map<string, PlacedLabel | null>) => {
    for (const [id, spot] of spots) {
      // spreadLabels answers for the edges it was given, and keepAll places each.
      const edge = byId.get(id)!;
      edge.label = {
        x: spot!.x,
        y: spot!.y,
        width: labelWidth(edge),
        ...(spot!.crowded ? { crowded: true as const } : {}),
      };
      edge.curve = spot!.curve;
    }
  };
  const loud = edges.filter(edge => curves.has(edge) && !edge.quiet).map(toPlace);
  const spots = spreadLabels(loud, GRAPH.labelHeight, obstacles, true);
  set(spots);
  const taken: GraphBox[] = [...obstacles];
  for (const edge of edges)
    if (spots.has(edge.id) && edge.label && !edge.label.crowded)
      taken.push({ ...edge.label, height: GRAPH.labelHeight });
  for (const edge of edges)
    if (curves.has(edge) && edge.quiet)
      set(spreadLabels([toPlace(edge)], GRAPH.labelHeight, taken, true));
}

// Down to the lowest box, waypoint, label or loop lane, and the padding under it. A tag sits on
// its line's box, never below it.
function graphHeight(bottom: number, edges: GraphEdge[]): number {
  const bottoms = [
    bottom,
    ...edges.flatMap(edge => (edge.label ? [edge.label.y + GRAPH.labelHeight / 2] : [])),
  ];
  return Math.ceil(Math.max(0, ...bottoms) + GRAPH.pad);
}
