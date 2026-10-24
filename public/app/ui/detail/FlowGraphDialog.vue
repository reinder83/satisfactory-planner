<!--
  A factory group's flow graph (#1192, part of #1079) in the shared #detail dialog, opened by
  "Flow graph ↗" on the group's heading on the Factories page (openFlowGraph in
  factory-detail.ts) for the phase shown. The model is flowGraph (flow-graph.ts) of the group's
  flow (shownGroupFlow, the flow page's own figures), so every arrow is one of the flow page's
  connections. Left to right: what comes in, the group's lines in layers, what leaves (other
  factories, storage, the AWESOME Sink), each arrow labelled with its item and rate per minute.
  The dialog takes the window's width and most of its height (#1223). The drawing scrolls inside
  its own box (focusable, so the keyboard scrolls it too) and never widens the dialog; the wheel
  over it zooms around the pointer, a drag on its background moves it, two fingers pinch, and
  − / + / Fit zoom it (useGraphPanZoom, graph-pan-zoom.ts). A press on a line's box without a
  drag opens that production line's dialog in this one's place.
  Rearranging (#1224): a drag of a line's box moves it and its arrows follow (placedGraph,
  graph-layout.ts); a line's box takes focus in the automatic order wherever it sits, Enter opens
  it and the arrow keys move it (Shift: bigger steps). Where the lines sit, the zoom and the
  scroll offsets are stored per factory (useGraphLayout, graph-layout-save.ts; groups[].layout,
  state version 22) and put back on the next opening; "Reset layout" goes back to the automatic
  layout at natural size, after a confirmation when a line was moved. "The graph as a table"
  lists every arrow again as text, which the drawing's accessible name points to. A group gone
  since the dialog opened says so.
  Storage and the sink (#1231): the arrows into Protected storage and the AWESOME Sink are quiet
  (thin, grey, behind the others, no label or arrowhead); pointing at one lights it up with its
  label. "Show storage and sink as tags", stored with the layout (`tags`, state version 23),
  draws them as tags on their lines instead and leaves out the two boxes. Pointing at a box or
  focusing it lights up its arrows (and tags) and fades the rest: a line's quiet arrows light up
  without labels, every arrow into storage or the sink with its label, and the lit labels are
  spread so none overlap (spreadLabels, graph-labels.ts); one with no room is left out, its value
  in its arrow's hover title and the table. Every box and tag takes focus and is named.
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { openCalculatedFactory } from '../../factory-detail.ts';
import { itemRate } from '../../flow.ts';
import {
  flowGraph,
  GRAPH,
  labelObstacles,
  shortText,
  tagBox,
  type GraphEdge,
  type GraphNode,
  type GraphTag,
} from '../../flow-graph.ts';
import { spreadLabels, type PlacedLabel } from '../../graph-labels.ts';
import type { FlowLine } from '../../group-flow.ts';
import { num } from '../../format.ts';
import { phase, phaseLabel } from '../../session.ts';
import { shownGroupFlow } from '../../shown-group-flow.ts';
import { factoryGroupsState, machineLine } from '../../views/factories.ts';
import { legacy } from '../bridge.ts';
import { confirmAction } from '../confirm.ts';
import DialogFrame from './DialogFrame.vue';
import { GRAPH_ZOOM, type GraphPoint } from '../../graph-view.ts';
import { heldSpots, lineRowOf, nudgedSpot, placedGraph } from '../../graph-layout.ts';
import { useGraphPanZoom } from './graph-pan-zoom.ts';
import { useGraphLayout } from './graph-layout-save.ts';

const props = defineProps<{ id: string }>();

// A line's machines as the flow page's table writes them: a split line its share first.
const machines = (line: FlowLine) =>
  (line.share < 1 - 1e-6 ? `≈ ${num(line.machinesHere)} of ` : '') +
  machineLine(line.machines, line.machine, line.lastClock);

// The scrolling box. The stored layout and the lines' spots while the dialog is open; the view
// on screen is the zoom and the box's scroll offsets.
const box = ref<HTMLElement | null>(null);
const layout = useGraphLayout(props.id, () =>
  box.value ? { zoom: zoom.value, left: box.value.scrollLeft, top: box.value.scrollTop } : null,
);

const view = computed(() =>
  legacy(() => {
    const name = factoryGroupsState().groups.find(group => group.id === props.id)?.name ?? null;
    const flow = name === null ? null : shownGroupFlow(props.id);
    const graph = flow?.lines.length
      ? flowGraph(flow, itemRate, machines, { tags: layout.tags.value })
      : null;
    // The tags switch is offered while something goes to storage or the sink.
    const quiet = !!graph?.edges.some(edge => edge.quiet);
    return { name, phase: phaseLabel(phase()), graph, quiet };
  }),
);

const count = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;
const summary = computed(() => {
  const graph = view.value.graph;
  if (!graph) return view.value.phase;
  const lines = graph.nodes.filter(node => node.kind === 'line').length;
  return `${view.value.phase} · ${count(lines, 'line', 'lines')} · ${count(graph.edges.length, 'flow', 'flows')}`;
});
const graphName = computed(
  () =>
    `Flow graph of ${view.value.name}, ${summary.value}. The graph as a table, below it, lists every flow.`,
);

// The words after an arrow's item in the table, as the flow page's table has them.
const NOTES: Record<GraphEdge['note'], string> = {
  '': '',
  loop: 'loop: seed a starter batch',
  self: 'back into the same line',
};
// The graph as drawn: the automatic one with the stored and dragged spots.
const placed = computed(
  () => view.value.graph && placedGraph(view.value.graph, layout.spots.value),
);
// The drawn arrows, the quiet ones (into storage and the sink, #1231) first, so every other arrow
// is drawn over them.
const drawn = computed(() => {
  const edges = placed.value?.edges.filter(edge => edge.path) ?? [];
  return [...edges.filter(edge => edge.quiet), ...edges.filter(edge => !edge.quiet)];
});

// The box under the pointer or with keyboard focus, and the arrow under the pointer (#1231).
const activeNode = ref<string | null>(null);
const hoveredEdge = ref<string | null>(null);
const leaveNode = (id: string) => {
  if (activeNode.value === id) activeNode.value = null;
};
const leaveEdge = (id: string) => {
  if (hoveredEdge.value === id) hoveredEdge.value = null;
};
// What the active box lights up: its arrows and tags, and where the lit labels go, spread so none
// overlap (null: no room, left out). A production line's quiet arrows light up without a label;
// on storage or the sink every arrow in has one.
const lit = computed(() => {
  const graph = placed.value,
    id = activeNode.value;
  if (!graph || !id || !graph.nodes.some(node => node.id === id)) return null;
  const edges = new Set(
    drawn.value.filter(edge => edge.from === id || edge.to === id).map(edge => edge.id),
  );
  const labelled = drawn.value.filter(
    edge => edges.has(edge.id) && edge.label && edge.curve && (!edge.quiet || edge.to === id),
  );
  const labels: Map<string, PlacedLabel | null> = spreadLabels(
    labelled.map(edge => ({ id: edge.id, width: edge.label!.width, curves: [edge.curve!] })),
    GRAPH.labelHeight,
    labelObstacles(graph.nodes, graph.tags),
    false,
  );
  const tags = new Set(graph.tags.filter(tag => tag.node === id).map(tag => tag.id));
  return { node: id, edges, labels, tags };
});

// Where a side of the arrow ends in the drawing: an item coming in, between lines, or leaving;
// quiet, and lit or faded by the active box, or under the pointer.
const edgeClass = (edge: GraphEdge) => {
  const on = lit.value;
  const shining = !!on?.edges.has(edge.id);
  return [
    'fgraph-edge',
    edge.from.startsWith('in:') ? 'from-place' : edge.to.startsWith('out:') ? 'to-place' : 'inside',
    edge.note,
    {
      quiet: edge.quiet,
      hl: shining,
      faded: !!on && !shining,
      hover: hoveredEdge.value === edge.id,
    },
  ];
};
// A quiet arrow has its arrowhead only while its box lights it up.
const arrowOf = (edge: GraphEdge) =>
  !edge.quiet || lit.value?.edges.has(edge.id) ? 'url(#fgraph-arrow)' : undefined;
// An arrow's hover title, which keeps its value where its label has no room.
const edgeTitle = (edge: GraphEdge) =>
  `${edge.item}: ${edge.rateText} from ${edge.fromText} to ${edge.toText}`;
// Where an arrow's label is drawn, and how: lit and spread, faded with its arrow, hidden (a quiet
// arrow's not lit or pointed at, or a lit label with no room), or as it is at rest.
function labelOf(edge: GraphEdge): { x: number; y: number; state: string } {
  // Every drawn arrow has its label (placeEdgeLabels).
  const rest = edge.label!;
  const on = lit.value;
  if (on?.edges.has(edge.id)) {
    const spot = on.labels.get(edge.id);
    return spot ? { x: spot.x, y: spot.y, state: 'lit' } : { ...rest, state: 'hidden' };
  }
  if (edge.quiet) return { ...rest, state: hoveredEdge.value === edge.id ? 'lit' : 'hidden' };
  return { ...rest, state: on ? 'faded' : '' };
}
// The tags of the line with box `node`, and where each sits (its top-left corner).
const tagsOf = (node: GraphNode): (GraphTag & { left: number; top: number })[] =>
  (placed.value?.tags ?? [])
    .filter(tag => tag.node === node.id)
    .map(tag => {
      const at = tagBox(tag, node);
      return { ...tag, left: at.x - at.width / 2, top: at.y - at.height / 2 };
    });
const tagClass = (tag: GraphTag) => {
  const on = lit.value;
  return ['fgraph-tag', { hl: !!on?.tags.has(tag.id), faded: !!on && !on.tags.has(tag.id) }];
};
// "Show storage and sink as tags": redrawn at once and saved with the layout.
function setTags(on: boolean) {
  layout.tags.value = on;
  activeNode.value = null;
  hoveredEdge.value = null;
  layout.now();
}

const nodeAt = (node: string): GraphPoint | null => {
  const shown = placed.value?.nodes.find(known => known.id === node);
  return shown ? { x: shown.x, y: shown.y } : null;
};
// Line `row` put at `to`, every other line of the graph kept where it is drawn now.
const putLine = (row: string, to: [number, number]) => {
  const graph = placed.value;
  if (graph) layout.spots.value = { ...heldSpots(graph, layout.spots.value), [row]: to };
};
const moveLine = (node: string, to: GraphPoint) => {
  const row = lineRowOf(node);
  if (row !== null) putLine(row, [to.x, to.y]);
};
const { zoom, panning, moving, show, zoomIn, zoomOut, fit, handlers, onClickCapture } =
  useGraphPanZoom(box, () => placed.value, {
    at: nodeAt,
    move: moveLine,
    drop: () => layout.now(),
  });
const zoomText = computed(() => `${Math.round(zoom.value * 100)}%`);

// The stored view back on opening; neither it nor the scroll it causes is a change to save.
onMounted(async () => {
  const stored = layout.storedView;
  if (stored.zoom !== 1 || stored.left || stored.top) await show(stored);
  layout.settled();
});
// A zoom or a scroll is saved once it has rested.
watch(zoom, () => layout.later());

// A press on a line's box without a drag (a drag or pinch swallows its click, onClickCapture).
const openNode = (id: string) => {
  const row = lineRowOf(id);
  if (row !== null) openCalculatedFactory(row);
};
// A line's box takes focus: its name, and what Enter and the arrow keys do.
const lineAttrs = (node: GraphNode) => ({
  tabindex: 0,
  role: 'button',
  'aria-label': `${node.label}, ${node.caption}. Enter opens it, the arrow keys move it.`,
});
// A place's box takes focus too (#1231), so the keyboard lights up its arrows: named with what
// comes in from it or goes out to it.
const flowList = (edges: GraphEdge[], end: (edge: GraphEdge) => string) =>
  edges.map(edge => `${edge.item} ${edge.rateText} ${end(edge)}`).join(', ');
function placeAttrs(node: GraphNode) {
  const edges = placed.value?.edges ?? [];
  const into = edges.filter(edge => edge.to === node.id),
    out = edges.filter(edge => edge.from === node.id);
  const parts = [
    ...(into.length ? [`In: ${flowList(into, edge => 'from ' + edge.fromText)}`] : []),
    ...(out.length ? [`Out: ${flowList(out, edge => 'to ' + edge.toText)}`] : []),
  ];
  return {
    tabindex: 0,
    role: 'img',
    'aria-label': [`${node.label}, ${node.caption}`, ...parts].join('. ') + '.',
  };
}
// Brings the box of `node` into view inside the scrolling box, as far as it is out of it.
async function keepInView(node: string) {
  await nextTick();
  const el = box.value;
  const shown = placed.value?.nodes.find(known => known.id === node);
  if (!el || !shown) return;
  const scale = zoom.value;
  const into = (start: number, end: number, offset: number, visible: number) =>
    start < offset ? start - 8 : end > offset + visible ? end - visible + 8 : offset;
  el.scrollLeft = into(
    shown.x * scale,
    (shown.x + shown.width) * scale,
    el.scrollLeft,
    el.clientWidth,
  );
  el.scrollTop = into(
    shown.y * scale,
    (shown.y + shown.height) * scale,
    el.scrollTop,
    el.clientHeight,
  );
}
// Enter or Space opens a focused line; an arrow key moves it, Shift by a bigger step.
function onNodeKey(e: KeyboardEvent, node: GraphNode) {
  const row = lineRowOf(node.id);
  if (row === null) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    return openNode(node.id);
  }
  // Where it is now: a key held down repeats before the drawing is redrawn.
  const at = nodeAt(node.id) ?? node;
  const to = nudgedSpot([at.x, at.y], e.key, e.shiftKey);
  if (!to) return;
  e.preventDefault();
  e.stopPropagation();
  putLine(row, to);
  layout.later();
  void keepInView(node.id);
}
// Back to the automatic layout at natural size, from the top-left corner; asked first when a line
// was moved, since that is work to redo.
async function resetLayout() {
  if (
    Object.keys(layout.spots.value).length &&
    !(await confirmAction({
      title: 'Reset the layout?',
      body: 'The production lines you moved go back to their automatic places, and the graph to 100%.',
      confirmLabel: 'Reset layout',
    }))
  )
    return;
  layout.spots.value = {};
  await show({ zoom: 1, left: 0, top: 0 });
  layout.now();
}
</script>

<template>
  <DialogFrame :title="view.name ?? 'Factory'" subtitle="FACTORY · FLOW GRAPH" :summary="summary">
    <p v-if="view.name === null" class="notice warn" data-flow-graph-missing>
      This profile has no such factory any more. It may have been removed on the Factories page.
    </p>
    <p v-else-if="!placed" class="small muted" data-flow-graph-empty>
      No production lines of this factory produce anything in {{ view.phase }}.
    </p>
    <template v-else>
      <p class="small muted">
        What comes in on the left, this factory's production lines from left to right in the order
        they feed each other, and what leaves on the right. Each arrow is one item, per minute. Drag
        the background to move the graph, drag a production line to move it (or the arrow keys on a
        focused line), zoom with the mouse wheel, a pinch or the buttons, and press a production
        line to open it. The graph opens as you left it, until you reset the layout.
        <template v-if="view.quiet && !layout.tags.value">
          What goes to Protected storage and the AWESOME Sink is drawn as thin grey arrows.
        </template>
        <template v-else-if="view.quiet">
          What goes to Protected storage (▣) and the AWESOME Sink (♻) is shown as tags on each
          production line.
        </template>
        Point at a box or focus it to light up its arrows.
      </p>
      <div class="fgraph-tools" data-flow-graph-tools>
        <button
          class="btn"
          type="button"
          aria-label="Zoom out"
          data-flow-zoom="out"
          :disabled="zoom <= GRAPH_ZOOM.min"
          @click="zoomOut"
        >
          −
        </button>
        <span class="fgraph-zoom" data-flow-zoom-level>{{ zoomText }}</span>
        <button
          class="btn"
          type="button"
          aria-label="Zoom in"
          data-flow-zoom="in"
          :disabled="zoom >= GRAPH_ZOOM.max"
          @click="zoomIn"
        >
          +
        </button>
        <button
          class="btn"
          type="button"
          aria-label="Fit the whole graph"
          data-flow-zoom="fit"
          @click="fit"
        >
          Fit
        </button>
        <button class="btn" type="button" data-flow-layout-reset @click="resetLayout">
          Reset layout
        </button>
        <label v-if="view.quiet" class="fgraph-switch">
          <input
            type="checkbox"
            data-flow-tags
            :checked="layout.tags.value"
            @change="setTags(($event.target as HTMLInputElement).checked)"
          />
          Show storage and sink as tags
        </label>
      </div>
      <div
        ref="box"
        :class="['fgraph-scroll', { panning, moving }]"
        tabindex="0"
        role="group"
        :aria-label="graphName"
        data-flow-graph
        v-on="handlers"
        @click.capture="onClickCapture"
        @scroll="layout.later()"
      >
        <svg
          class="fgraph"
          :width="placed.width * zoom"
          :height="placed.height * zoom"
          :viewBox="`0 0 ${placed.width} ${placed.height}`"
          role="none"
        >
          <defs aria-hidden="true">
            <marker
              id="fgraph-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="8"
              markerHeight="8"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 Z" />
            </marker>
          </defs>
          <template v-for="edge in drawn" :key="edge.id">
            <path
              :class="edgeClass(edge)"
              :d="edge.path!"
              :data-edge="edge.id"
              :marker-end="arrowOf(edge)"
              aria-hidden="true"
            />
            <path
              class="fgraph-hit"
              :d="edge.path!"
              :data-edge-hit="edge.id"
              aria-hidden="true"
              @pointerenter="hoveredEdge = edge.id"
              @pointerleave="leaveEdge(edge.id)"
            >
              <title>{{ edgeTitle(edge) }}</title>
            </path>
          </template>
          <template v-for="node in placed.nodes" :key="node.id">
            <g
              :class="['fgraph-node', node.kind, { on: lit?.node === node.id }]"
              :data-node="node.id"
              :transform="`translate(${node.x},${node.y})`"
              v-bind="node.kind === 'line' ? lineAttrs(node) : placeAttrs(node)"
              @click="openNode(node.id)"
              @keydown="onNodeKey($event, node)"
              @pointerenter="activeNode = node.id"
              @pointerleave="leaveNode(node.id)"
              @focus="activeNode = node.id"
              @blur="leaveNode(node.id)"
            >
              <rect :width="node.width" :height="node.height" />
              <text class="fgraph-name" x="10" y="19">{{ node.shortLabel }}</text>
              <text class="fgraph-caption" x="10" y="37">{{ node.shortCaption }}</text>
              <text v-if="node.selfNote" class="fgraph-caption" x="10" y="54">
                {{ shortText(node.selfNote, GRAPH.captionChars) }}
              </text>
            </g>
            <g
              v-for="tag in tagsOf(node)"
              :key="tag.id"
              :class="tagClass(tag)"
              :data-tag="tag.id"
              :transform="`translate(${tag.left},${tag.top})`"
              tabindex="0"
              role="img"
              :aria-label="tag.name"
            >
              <title>{{ tag.name }}</title>
              <rect :width="tag.width" :height="GRAPH.tagHeight" rx="2" />
              <text x="6" y="12.5">{{ tag.text }}</text>
            </g>
          </template>
          <g
            v-for="edge in drawn"
            :key="'label-' + edge.id"
            :class="['fgraph-label', labelOf(edge).state, { quiet: edge.quiet }]"
            :data-edge-label="edge.id"
            :transform="`translate(${labelOf(edge).x},${labelOf(edge).y})`"
            aria-hidden="true"
          >
            <rect
              :x="-edge.label!.width / 2"
              :y="-GRAPH.labelHeight / 2"
              :width="edge.label!.width"
              :height="GRAPH.labelHeight"
            />
            <text text-anchor="middle" y="-2">{{ edge.item }}</text>
            <text text-anchor="middle" y="11">{{ edge.rateText }}</text>
          </g>
        </svg>
      </div>
      <details class="gf-text" data-flow-graph-table>
        <summary>The graph as a table</summary>
        <div class="table-wrap">
          <table>
            <caption class="small muted">
              Every flow of the graph, per minute
            </caption>
            <thead>
              <tr>
                <th scope="col">From</th>
                <th scope="col">Item</th>
                <th scope="col">Rate</th>
                <th scope="col">To</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="edge in placed.edges" :key="edge.id" :data-flow-edge="edge.id">
                <td class="gf-cell-name">{{ edge.fromText }}</td>
                <td>
                  {{ edge.item }}<template v-if="edge.note"> · {{ NOTES[edge.note] }}</template>
                </td>
                <td class="number">{{ edge.rateText }}</td>
                <td class="gf-cell-name">{{ edge.toText }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </template>
  </DialogFrame>
</template>
