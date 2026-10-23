<!--
  A factory group's flow graph (#1192, part of #1079) in the shared #detail dialog, opened by
  "Flow graph ↗" on the group's heading on the Factories page (openFlowGraph in
  factory-detail.ts) for the phase shown. Read-only: the model is flowGraph (flow-graph.ts) of the
  group's flow (shownGroupFlow, the flow page's own figures), so every arrow is one of the flow
  page's connections. Left to right: what comes in, the group's lines in layers, what leaves (other
  factories, storage, the AWESOME Sink), each arrow labelled with its item and rate per minute.
  The dialog takes the window's width and most of its height (#1223). The drawing scrolls inside
  its own box (focusable, so the keyboard scrolls it too) and never widens the dialog; the wheel
  over it zooms around the pointer, a drag on its background moves it, two fingers pinch, and
  − / + / Fit zoom it (useGraphPanZoom, graph-pan-zoom.ts; nothing saved). A press on a line's box
  without a drag opens that production line's dialog in this one's place. "The graph as a table"
  lists every arrow again as text, which the drawing's accessible name points to. A group gone
  since the dialog opened says so.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { openCalculatedFactory } from '../../factory-detail.ts';
import { itemRate } from '../../flow.ts';
import { flowGraph, GRAPH, shortText, type GraphEdge } from '../../flow-graph.ts';
import type { FlowLine } from '../../group-flow.ts';
import { num } from '../../format.ts';
import { phase, phaseLabel } from '../../session.ts';
import { shownGroupFlow } from '../../shown-group-flow.ts';
import { factoryGroupsState, machineLine } from '../../views/factories.ts';
import { legacy } from '../bridge.ts';
import DialogFrame from './DialogFrame.vue';
import { GRAPH_ZOOM } from '../../graph-view.ts';
import { useGraphPanZoom } from './graph-pan-zoom.ts';

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
const drawn = computed(() => view.value.graph?.edges.filter(edge => edge.path) ?? []);
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

// The scrolling box, and the drawing's natural size the zoom scales.
const box = ref<HTMLElement | null>(null);
const { zoom, panning, zoomIn, zoomOut, fit, handlers, onClickCapture } = useGraphPanZoom(
  box,
  () => view.value.graph,
);
const zoomText = computed(() => `${Math.round(zoom.value * 100)}%`);
// A press on a line's box without a drag (a drag or pinch swallows its click, onClickCapture).
const openNode = (id: string) => {
  if (id.startsWith('line:')) openCalculatedFactory(id.slice('line:'.length));
};
</script>

<template>
  <DialogFrame :title="view.name ?? 'Factory'" subtitle="FACTORY · FLOW GRAPH" :summary="summary">
    <p v-if="view.name === null" class="notice warn" data-flow-graph-missing>
      This profile has no such factory any more. It may have been removed on the Factories page.
    </p>
    <p v-else-if="!view.graph" class="small muted" data-flow-graph-empty>
      No production lines of this factory produce anything in {{ view.phase }}.
    </p>
    <template v-else>
      <p class="small muted">
        What comes in on the left, this factory's production lines from left to right in the order
        they feed each other, and what leaves on the right. Each arrow is one item, per minute. Drag
        the background to move the graph, zoom with the mouse wheel, a pinch or the buttons, and
        press a production line to open it.
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
      </div>
      <div
        ref="box"
        :class="['fgraph-scroll', { panning }]"
        tabindex="0"
        role="group"
        :aria-label="graphName"
        data-flow-graph
        v-on="handlers"
        @click.capture="onClickCapture"
      >
        <svg
          class="fgraph"
          :width="view.graph.width * zoom"
          :height="view.graph.height * zoom"
          :viewBox="`0 0 ${view.graph.width} ${view.graph.height}`"
          aria-hidden="true"
        >
          <defs>
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
          />
          <g
            v-for="node in view.graph.nodes"
            :key="node.id"
            :class="['fgraph-node', node.kind]"
            :data-node="node.id"
            :transform="`translate(${node.x},${node.y})`"
            @click="openNode(node.id)"
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
              <tr v-for="edge in view.graph.edges" :key="edge.id" :data-flow-edge="edge.id">
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
