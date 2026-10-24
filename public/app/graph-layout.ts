// A factory's flow graph as the user arranged it (#1224, slice 2 of #1201): production lines, and
// since #1240 inputs and outputs, moved by a drag or the arrow keys keep their spots, stored per
// factory group (groups[].layout, state version 22, with the zoom and scroll offsets), and the
// arrows follow them. Plain arithmetic, no session: the dialog (ui/detail/FlowGraphDialog.vue)
// passes the automatic graph (flowGraph in flow-graph.ts) and the stored spots, and saves what
// layoutToSave gives back.
//
// - Without a stored spot for any of its boxes the graph is drawn exactly as flowGraph lays it out.
// - The first move of a box stores the spots of all the graph's lines (heldSpots), so the others
//   stay where they were drawn. After that each line with a spot sits there, and a line without one
//   (new in the plan, or new in this phase) takes its automatic spot moved as far as the lines it is linked to were moved on
//   average, then down below any box it would cover. Places (what comes in, what leaves) keep
//   their automatic spots until one is moved too (#1240): a moved place's spot is stored by its
//   node id ('in:<place>', 'out:<place>'; groups[].layout.places, version 25). Every arrow then
//   runs from its source's right side to its target's left side as one curve, its label at the
//   curve's middle, slid along it where it would cover a box, a tag or another label
//   (placeEdgeLabels, #1231). Tags stay on their lines' boxes.
// - Saving keeps the spots of the lines the factory still has in some phase of the plan
//   (factoryLineRows), whole units, so a line the plan dropped loses its spot then.
// - Everything moved snaps to a 5-unit grid (GRAPH_GRID, #1240), while it is dragged, nudged and
//   as it is stored. Once the graph is arranged the boxes without a stored spot (places at their
//   automatic spots, lines new to it) are drawn on the grid too, and the first move stores the
//   other lines on it, so every box can be lined up with every other: that moves a box at most
//   2.5 units. A spot stored before the grid stays where it is until its box is moved.
// The boxes stay in the automatic order in the drawing (and so in the tab order) wherever they sit.
import {
  GRAPH,
  labelObstacles,
  placeEdgeLabels,
  tagsRight,
  type FlowGraph,
  type GraphEdge,
  type GraphNode,
} from './flow-graph.ts';
import type { GraphCurve } from './graph-labels.ts';
import { LINK_DUST, rowPlaces, type GroupsInput } from './group-order.ts';
import type { GraphView } from './graph-view.ts';
import type { CalcRow, GroupLayout } from '../types/index.ts';

// Where a moved box sits: its top-left corner in the drawing's units, by plan row id for a line and
// by node id for a place.
export type GraphSpots = Readonly<Record<string, readonly [number, number]>>;

// The grid (drawing units) every moved box snaps to (#1240).
export const GRAPH_GRID = 5;
// An arrow key moves a focused box by `step` units, with Shift by `big`: both on the grid.
export const GRAPH_NUDGE = { step: GRAPH_GRID, big: 10 * GRAPH_GRID } as const;

const LINE_PREFIX = 'line:';
// The plan row id of a line's box ('line:<row id>'), or null for a place's box.
export const lineRowOf = (nodeId: string): string | null =>
  nodeId.startsWith(LINE_PREFIX) ? nodeId.slice(LINE_PREFIX.length) : null;

// A corner as kept: whole units, never left of or above the drawing's edge.
export const spotUnit = (value: number): number => Math.max(0, Math.round(value));
// A corner on the grid (#1240): the nearest grid line, never left of or above the drawing's edge.
export const snapUnit = (value: number): number =>
  Math.max(0, Math.round(value / GRAPH_GRID) * GRAPH_GRID);
// A point on the grid, as a drag puts a box (#1240).
export const snapSpot = (x: number, y: number): [number, number] => [snapUnit(x), snapUnit(y)];
// Whether node `nodeId` is a place's box (an input or an output) rather than a line's.
export const isPlaceNode = (nodeId: string): boolean =>
  nodeId.startsWith('in:') || nodeId.startsWith('out:');

// `graph` with the stored spots applied (`spots` of lines by row id, `places` of inputs and
// outputs by node id) and its arrows drawn to them; `graph` itself when no box of it has a spot.
// A place without a spot sits at its automatic spot on the grid. Never changes `graph`.
export function placedGraph(
  graph: FlowGraph,
  spots: GraphSpots | undefined,
  places?: GraphSpots,
): FlowGraph {
  const spotOf = (node: GraphNode) => {
    const row = lineRowOf(node.id);
    return row === null ? places?.[node.id] : spots?.[row];
  };
  if (!graph.nodes.some(node => spotOf(node))) return graph;
  const nodes = graph.nodes.map(node => ({ ...node }));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const fresh: GraphNode[] = [];
  for (const node of nodes) {
    const spot = spotOf(node);
    if (spot) [node.x, node.y] = spot;
    else if (node.kind === 'line') fresh.push(node);
    else [node.x, node.y] = snapSpot(node.x, node.y);
  }
  const automatic = new Map(graph.nodes.map(node => [node.id, node]));
  placeFreshLines(fresh, nodes, graph.edges, automatic, spots ?? {});
  const { edges, curves } = routeArranged(graph.edges, byId);
  const labelCurves = new Map<GraphEdge, GraphCurve[]>();
  for (const edge of edges) {
    const curve = curves.get(edge.id);
    if (curve) labelCurves.set(edge, [curve]);
  }
  placeEdgeLabels(edges, labelCurves, labelObstacles(nodes, graph.tags));
  return { ...graph, nodes, edges, ...arrangedSize(graph, nodes, edges, curves) };
}

// Each line without a spot, in order: its automatic spot moved by the mean move of the lines it
// is linked to that have one, on the grid, then down a row at a time (a row on the grid) until it
// covers no box placed so far.
function placeFreshLines(
  fresh: GraphNode[],
  nodes: GraphNode[],
  edges: GraphEdge[],
  automatic: ReadonlyMap<string, GraphNode>,
  spots: GraphSpots,
) {
  if (!fresh.length) return;
  const isFresh = new Set(fresh.map(node => node.id));
  const settled = nodes.filter(node => !isFresh.has(node.id));
  for (const node of fresh) {
    let dx = 0,
      dy = 0,
      count = 0;
    for (const edge of edges) {
      const other = edge.from === node.id ? edge.to : edge.to === node.id ? edge.from : null;
      const row = other === null ? null : lineRowOf(other);
      const spot = row === null ? undefined : spots[row];
      // The other end's box where flowGraph put it, before its spot was applied.
      const before = other === null ? undefined : automatic.get(other);
      if (!spot || !before) continue;
      dx += spot[0] - before.x;
      dy += spot[1] - before.y;
      count++;
    }
    node.x = snapUnit(node.x + (count ? dx / count : 0));
    node.y = snapUnit(node.y + (count ? dy / count : 0));
    for (let tries = 0; tries < 200 && settled.some(box => boxesMeet(box, node)); tries++)
      node.y += FRESH_ROW;
    settled.push(node);
  }
}

// How far a line new to the graph moves down past a box on its spot: a row, on the grid.
const FRESH_ROW = Math.ceil((GRAPH.nodeHeight + GRAPH.rowGap) / GRAPH_GRID) * GRAPH_GRID;

// Whether two boxes overlap, with a row's gap kept between them.
const boxesMeet = (one: GraphNode, other: GraphNode): boolean =>
  one.x < other.x + other.width + GRAPH.rowGap &&
  other.x < one.x + one.width + GRAPH.rowGap &&
  one.y < other.y + other.height + GRAPH.rowGap &&
  other.y < one.y + one.height + GRAPH.rowGap;

const spotRound = (value: number) => Math.round(value * 10) / 10;

// Each drawn arrow as one curve: the arrows on one side of a box spread evenly down that side in
// the order of where their other ends are, so they do not cross there (as flowGraph does); the
// curve leaves and enters level, and one running back to the left bends out a gap's quarter at
// least, so it shows as a loop. A line's own output back into itself, and a flow drawn as a tag
// (#1231), stay undrawn.
function routeArranged(
  edges: GraphEdge[],
  byId: ReadonlyMap<string, GraphNode>,
): { edges: GraphEdge[]; curves: Map<string, GraphCurve> } {
  const curves = new Map<string, GraphCurve>();
  const drawn = edges.filter(edge => edge.note !== 'self' && !edge.asTag);
  // Every edge joins two boxes of the graph (flowGraph's ends), so byId has both.
  const middle = (id: string) => {
    const node = byId.get(id)!;
    return node.y + node.height / 2;
  };
  const portY = new Map<string, number>();
  for (const side of ['from', 'to'] as const) {
    const bySide = new Map<string, GraphEdge[]>();
    for (const edge of drawn) bySide.set(edge[side], [...(bySide.get(edge[side]) ?? []), edge]);
    for (const [id, list] of bySide) {
      // An edge's end, as above.
      const node = byId.get(id)!;
      const other = (edge: GraphEdge) => middle(side === 'from' ? edge.to : edge.from);
      const sorted = [...list].sort((a, b) => other(a) - other(b));
      const top = node.y + 10,
        span = Math.max(GRAPH.nodeHeight, node.height) - 20;
      sorted.forEach((edge, i) =>
        portY.set(side + edge.id, top + (span * (i + 1)) / (sorted.length + 1)),
      );
    }
  }
  const routed = edges.map(edge => {
    if (edge.note === 'self' || edge.asTag)
      return { ...edge, path: null, label: null, curve: null };
    // Every drawn edge joins two boxes of the graph, and both its ports were set above.
    const source = byId.get(edge.from)!,
      target = byId.get(edge.to)!;
    const from = { x: source.x + source.width, y: portY.get('from' + edge.id)! };
    const to = { x: target.x, y: portY.get('to' + edge.id)! };
    const reach = Math.max(GRAPH.gap / 4, Math.abs(to.x - from.x) / 2);
    const curve: GraphCurve = {
      from,
      c1: { x: from.x + reach, y: from.y },
      c2: { x: Math.max(0, to.x - reach), y: to.y },
      to,
    };
    const path =
      `M${spotRound(from.x)},${spotRound(from.y)} C${spotRound(curve.c1.x)},${spotRound(curve.c1.y)}` +
      ` ${spotRound(curve.c2.x)},${spotRound(curve.c2.y)} ${spotRound(to.x)},${spotRound(to.y)}`;
    curves.set(edge.id, curve);
    return { ...edge, path, label: null, curve: null };
  });
  return { edges: routed, curves };
}

// The drawing's size: to the right and lowest of every box, tag, curve and label, and the padding.
function arrangedSize(
  graph: FlowGraph,
  nodes: GraphNode[],
  edges: GraphEdge[],
  curves: ReadonlyMap<string, GraphCurve>,
): { width: number; height: number } {
  let right = tagsRight(graph.tags, new Map(nodes.map(node => [node.id, node]))),
    bottom = 0;
  for (const node of nodes) {
    right = Math.max(right, node.x + node.width);
    bottom = Math.max(bottom, node.y + node.height);
  }
  for (const edge of edges) {
    const curve = curves.get(edge.id);
    if (curve) right = Math.max(right, curve.c1.x, curve.c2.x);
    if (edge.label) {
      right = Math.max(right, edge.label.x + edge.label.width / 2);
      bottom = Math.max(bottom, edge.label.y + GRAPH.labelHeight / 2);
    }
  }
  return { width: Math.ceil(right + GRAPH.pad), height: Math.ceil(bottom + GRAPH.pad) };
}

// `spots` with a spot for every line of `graph` as drawn (placedGraph) that has none yet, on the
// grid (#1240): the first move of a box (a line's or a place's) keeps where all the lines are, so
// they stay put when it moves, and a line without a spot is always one the arrangement has not seen
// (new in the plan or in this phase). Spots it has stay as they are, on the grid or not.
export function heldSpots(graph: FlowGraph, spots: GraphSpots): Record<string, [number, number]> {
  const held: Record<string, [number, number]> = {};
  for (const [row, [x, y]] of Object.entries(spots)) held[row] = [x, y];
  for (const node of graph.nodes) {
    const row = lineRowOf(node.id);
    if (row !== null && !held[row]) held[row] = snapSpot(node.x, node.y);
  }
  return held;
}

// The plan row ids of factory group `groupId`'s lines in any phase of the plan (`rowLists`, one
// list of rows per phase): the lines whose spots a save keeps.
export function factoryLineRows(
  rowLists: readonly (readonly CalcRow[])[],
  groups: GroupsInput,
  groupId: string,
): Set<string> {
  const rows = new Set<string>();
  for (const list of rowLists)
    for (const row of list)
      if ((rowPlaces(row, groups).get(groupId) ?? 0) > LINK_DUST) rows.add(row.id);
  return rows;
}

// What a save stores (groups[].layout): the spots of the lines in `keep`, whole units, the view,
// the zoom to two decimals and the scroll offsets in whole px, `tags: true` while storage and the
// sink are shown as tags (#1231), and the spots of the moved inputs and outputs (#1240), whole
// units: every one, also of a box the graph does not draw now (storage and the sink while they are
// tags, a place of another phase), so it is there when the box is back. Each is left out when it
// says nothing, and null when nothing is left.
export function layoutToSave(
  spots: GraphSpots,
  view: GraphView | null,
  keep: ReadonlySet<string>,
  tags = false,
  places: GraphSpots = {},
): GroupLayout | null {
  const layout: GroupLayout = tags ? { tags: true } : {};
  const whole = (list: [string, readonly [number, number]][]) =>
    Object.fromEntries(
      list.map(([key, [x, y]]) => [key, [spotUnit(x), spotUnit(y)] as [number, number]]),
    );
  const nodes = Object.entries(spots).filter(([row]) => keep.has(row));
  if (nodes.length) layout.nodes = whole(nodes);
  const moved = Object.entries(places).filter(([node]) => isPlaceNode(node));
  if (moved.length) layout.places = whole(moved);
  if (view) {
    const zoom = Math.round(view.zoom * 100) / 100;
    if (zoom !== 1) layout.zoom = zoom;
    const pan: [number, number] = [spotUnit(view.left), spotUnit(view.top)];
    if (pan[0] || pan[1]) layout.pan = pan;
  }
  return Object.keys(layout).length ? layout : null;
}

// A spot moved by an arrow key: by GRAPH_NUDGE's step, with Shift by its big step, onto the grid
// (#1240; a spot stored off it lands on the grid line nearest the step); null for any other key.
export function nudgedSpot(
  spot: readonly [number, number],
  key: string,
  big: boolean,
): [number, number] | null {
  const step = big ? GRAPH_NUDGE.big : GRAPH_NUDGE.step;
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const move = moves[key];
  return move ? snapSpot(spot[0] + move[0], spot[1] + move[1]) : null;
}
