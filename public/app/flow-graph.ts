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
} from './graph-labels.ts';
import { flowConnections, flowNames, isSelfLink, lineNumber } from './views/group-flow-page.ts';

// Sizes in px. Monospaced type keeps text widths predictable: GRAPH_CHAR is a character's width
// at the edge labels' size, which the label boxes are measured with.
export const GRAPH = {
  pad: 16,
  nodeWidth: 216,
  nodeHeight: 48,
  selfHeight: 64,
  gap: 196,
  rowGap: 20,
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
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
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
  // link, a tag).
  path: string | null;
  label: { x: number; y: number; width: number } | null;
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
  width: number;
  height: number;
}

// What a graph is drawn with: `tags` draws the storage and sink flows as tags on their lines.
export interface GraphOptions {
  tags?: boolean;
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
  const tags = graphTags(edges, rateText);
  const bottom = layOut(
    nodes,
    edges.filter(edge => !edge.asTag),
    tags,
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
    layer: 0,
    x: 0,
    y: 0,
    width: GRAPH.nodeWidth,
    height: self ? GRAPH.selfHeight : GRAPH.nodeHeight,
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
function layOut(nodes: GraphNode[], edges: GraphEdge[], tags: readonly GraphTag[]): number {
  const byId = new Map(nodes.map(node => [node.id, node]));
  assignLayers(nodes, edges, byId);
  const forward = edges.filter(edge => edge.note !== 'self' && isForward(edge, byId));
  fitPorts(nodes, forward);
  const { layers, chains } = slotLayers(nodes, forward, byId);
  orderLayers(layers, chains);
  placeSlots(layers);
  const bottom = Math.max(0, ...layers.flat().map(slot => slot.y + slot.height));
  const back = edges.filter(edge => edge.note !== 'self' && !isForward(edge, byId));
  const curves = routeForward(forward, chains, byId);
  for (const [edge, lane] of routeBack(back, bottom, byId)) curves.set(edge, [lane]);
  placeEdgeLabels(edges, curves, labelObstacles(nodes, tags));
  return bottom;
}

// A box with many edges on one side grows to give each its own port, GRAPH.port apart.
function fitPorts(nodes: GraphNode[], forward: GraphEdge[]) {
  for (const node of nodes) {
    const ins = forward.filter(edge => edge.to === node.id).length,
      outs = forward.filter(edge => edge.from === node.id).length;
    node.height = Math.max(node.height, (Math.max(ins, outs) + 1) * GRAPH.port);
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

// A few sweeps left to right and back, each layer sorted by the mean place of its slots'
// neighbours in the layer before (or after). A slot without neighbours there keeps its place;
// ties keep the order they had.
const SWEEPS = 4;
function orderLayers(layers: Slot[][], chains: ReadonlyMap<GraphEdge, Slot[]>) {
  const before = new Map<Slot, Slot[]>(),
    after = new Map<Slot, Slot[]>();
  for (const chain of chains.values())
    for (let i = 1; i < chain.length; i++) {
      // i and i - 1 are inside the chain.
      const left = chain[i - 1]!,
        right = chain[i]!;
      before.set(right, [...(before.get(right) ?? []), left]);
      after.set(left, [...(after.get(left) ?? []), right]);
    }
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
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    for (let i = 1; i < layers.length; i++) sortBy(layers[i]!, before, layers[i - 1]!);
    for (let i = layers.length - 2; i >= 0; i--) sortBy(layers[i]!, after, layers[i + 1]!);
  }
}

// Each layer stacked from the top, centred on the tallest layer, and its boxes placed.
function placeSlots(layers: Slot[][]) {
  const heightOf = (layer: Slot[]) =>
    layer.reduce((sum, slot) => sum + slot.height, 0) +
    Math.max(0, layer.length - 1) * GRAPH.rowGap;
  const tallest = Math.max(0, ...layers.map(heightOf));
  layers.forEach((layer, n) => {
    let y = GRAPH.pad + GRAPH.labelHeight / 2 + (tallest - heightOf(layer)) / 2;
    for (const slot of layer) {
      slot.y = y;
      y += slot.height + GRAPH.rowGap;
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
export const labelWidth = (edge: GraphEdge) =>
  Math.ceil(Math.max([...edge.item].length, [...edge.rateText].length) * GRAPH.char) + 8;

// Each drawn edge's label at rest (#1231), on one of `curves` (by edge, in the order it tries
// them): at the middle of its curve, slid along it where it would cover one of `obstacles` (the
// boxes and tags) or a label placed before it, and at the middle of its first curve where nothing
// is free (spreadLabels, top to bottom). The quiet edges' labels, hidden until lit, come after the
// others and make room for them, not for each other. Sets each edge's `label` and `curve`.
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
  const set = (spots: Map<string, { x: number; y: number; curve: GraphCurve } | null>) => {
    for (const [id, spot] of spots) {
      // spreadLabels answers for the edges it was given, and keepAll places each.
      const edge = byId.get(id)!;
      edge.label = { x: spot!.x, y: spot!.y, width: labelWidth(edge) };
      edge.curve = spot!.curve;
    }
  };
  const loud = edges.filter(edge => curves.has(edge) && !edge.quiet).map(toPlace);
  const spots = spreadLabels(loud, GRAPH.labelHeight, obstacles, true);
  set(spots);
  const taken: GraphBox[] = [...obstacles];
  for (const edge of edges)
    if (spots.has(edge.id) && edge.label) taken.push({ ...edge.label, height: GRAPH.labelHeight });
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
