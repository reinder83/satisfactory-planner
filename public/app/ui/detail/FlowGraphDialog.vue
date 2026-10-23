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
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { openCalculatedFactory } from '../../factory-detail.ts';
import { itemRate } from '../../flow.ts';
import { flowGraph, GRAPH, shortText, type GraphEdge, type GraphNode } from '../../flow-graph.ts';
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

const view = computed(() =>
  legacy(() => {
    const name = factoryGroupsState().groups.find(group => group.id === props.id)?.name ?? null;
    const flow = name === null ? null : shownGroupFlow(props.id);
    const graph = flow?.lines.length ? flowGraph(flow, itemRate, machines) : null;
    return { name, phase: phaseLabel(phase()), graph };
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
// Where a side of the arrow ends in the drawing: an item coming in, between lines, or leaving.
const edgeClass = (edge: GraphEdge) => [
  'fgraph-edge',
  edge.from.startsWith('in:') ? 'from-place' : edge.to.startsWith('out:') ? 'to-place' : 'inside',
  edge.note,
];

// The scrolling box. The stored layout and the lines' spots while the dialog is open; the view
// on screen is the zoom and the box's scroll offsets.
const box = ref<HTMLElement | null>(null);
const layout = useGraphLayout(props.id, () =>
  box.value ? { zoom: zoom.value, left: box.value.scrollLeft, top: box.value.scrollTop } : null,
);
// The graph as drawn: the automatic one with the stored and dragged spots.
const placed = computed(
  () => view.value.graph && placedGraph(view.value.graph, layout.spots.value),
);
const drawn = computed(() => placed.value?.edges.filter(edge => edge.path) ?? []);

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
          <path
            v-for="edge in drawn"
            :key="edge.id"
            :class="edgeClass(edge)"
            :d="edge.path!"
            :data-edge="edge.id"
            marker-end="url(#fgraph-arrow)"
            aria-hidden="true"
          />
          <g
            v-for="node in placed.nodes"
            :key="node.id"
            :class="['fgraph-node', node.kind]"
            :data-node="node.id"
            :transform="`translate(${node.x},${node.y})`"
            v-bind="node.kind === 'line' ? lineAttrs(node) : { 'aria-hidden': 'true' }"
            @click="openNode(node.id)"
            @keydown="onNodeKey($event, node)"
          >
            <rect :width="node.width" :height="node.height" />
            <text class="fgraph-name" x="10" y="19">{{ node.shortLabel }}</text>
            <text class="fgraph-caption" x="10" y="37">{{ node.shortCaption }}</text>
            <text v-if="node.selfNote" class="fgraph-caption" x="10" y="54">
              {{ shortText(node.selfNote, GRAPH.captionChars) }}
            </text>
          </g>
          <g
            v-for="edge in drawn"
            :key="'label-' + edge.id"
            class="fgraph-label"
            :data-edge-label="edge.id"
            :transform="`translate(${edge.label!.x},${edge.label!.y})`"
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
