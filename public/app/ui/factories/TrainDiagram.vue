<!--
  The train network diagram (#1284, slice 4 of 4) on the Logistics page's Trains tab: every
  station of the profile as a box (its name, who it belongs to and a glyph per platform: ↑ load,
  ↓ unload, · empty), laid out automatically in columns along the lines, pick-ups on the left and
  drop-offs on the right (trainDiagram in app/train-diagram.ts, the flow graph's way), and every
  line as curves between its stops in its own colour, labelled with its name, direction (⇄ back
  and forth, → one-way loop, dashed) and cargo; lines between the same stations run side by side.
  Pointing at or focusing a station lights up its lines and fades the rest. The drawing pans and
  zooms as a factory's flow graph does (useGraphPanZoom: the wheel, a drag on the background, a
  pinch, − / + / Fit). A drag of a station moves it on a 5 px grid, and on a focused station the
  arrow keys move it (Shift: further); the spots, the zoom and the scroll are stored with the
  profile (trainLayout, state version 30, train-layout-save.ts) and "Reset layout" goes back to the
  automatic layout. A press on a station without a drag, or Enter on a focused one, opens its
  editor (ui/detail/StationDialog.vue). The list of lines under it says the same in words.
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { GRAPH_ZOOM, type GraphPoint } from '../../graph-view.ts';
import { nudgedSpot, snapSpot } from '../../graph-layout.ts';
import { state } from '../../session.ts';
import { DIAGRAM, trainDiagram, type DiagramStation } from '../../train-diagram.ts';
import { DIRECTION_TEXT, LINE_COLORS, lineCargo } from '../../train-lines.ts';
import { ownerText } from '../../train-stations.ts';
import { legacy } from '../bridge.ts';
import { confirmAction } from '../confirm.ts';
import { showDetail } from '../detail.ts';
import { useGraphPanZoom } from '../detail/graph-pan-zoom.ts';
import { useTrainLayout } from './train-layout-save.ts';

const box = ref<HTMLElement | null>(null);
const layout = useTrainLayout(() =>
  box.value ? { zoom: zoom.value, left: box.value.scrollLeft, top: box.value.scrollTop } : null,
);

const source = computed(() =>
  legacy(() => ({
    stations: state.trainStations ?? [],
    lines: state.trainLines ?? [],
    groups: state.factoryGroups?.groups ?? [],
  })),
);
const model = computed(() => {
  const { stations, lines, groups } = source.value;
  if (!stations.length) return null;
  return trainDiagram(
    stations,
    lines,
    layout.spots.value,
    line => lineCargo(line, stations),
    station => ownerText(station.owner, groups),
  );
});
// The lines in words, for the list under the drawing.
const legend = computed(() =>
  source.value.lines.map((line, i) => ({
    id: line.id,
    color: i % LINE_COLORS,
    name: line.name,
    mark: DIRECTION_TEXT[line.direction].mark,
    direction: DIRECTION_TEXT[line.direction].label,
    stops: line.stops
      .map(id => source.value.stations.find(station => station.id === id)?.name ?? id)
      .join(' → '),
    cargo: lineCargo(line, source.value.stations).join(', ') || 'no cargo yet',
  })),
);

// The station under the pointer or with keyboard focus lights up its lines.
const active = ref<string | null>(null);
const lit = computed(() => {
  const id = active.value;
  const station = id ? model.value?.stations.find(entry => entry.id === id) : undefined;
  return station ? new Set(station.lines) : null;
});
const segmentClass = (line: string, color: number, dashed: boolean) => [
  'tdiag-line',
  'line-color-' + color,
  { dashed, hl: !!lit.value?.has(line), faded: !!lit.value && !lit.value.has(line) },
];
// A station is faded while another one is lit that shares no line with it.
const stationFaded = (station: DiagramStation) =>
  !!lit.value && active.value !== station.id && !station.lines.some(line => lit.value!.has(line));
const leave = (id: string) => {
  if (active.value === id) active.value = null;
};

const NODE = 'station:';
const stationOf = (node: string) =>
  node.startsWith(NODE)
    ? model.value?.stations.find(entry => entry.id === node.slice(NODE.length))
    : undefined;
const at = (node: string): GraphPoint | null => {
  const station = stationOf(node);
  return station ? { x: station.x, y: station.y } : null;
};
// A station put at `to`; the first move holds every other station where it is drawn now, so none
// jumps when the automatic layout no longer counts it.
function put(id: string, to: [number, number]) {
  const held = Object.fromEntries(
    (model.value?.stations ?? []).map(station => [
      station.id,
      [station.x, station.y] as [number, number],
    ]),
  );
  layout.spots.value = { ...held, ...layout.spots.value, [id]: to };
}
const { zoom, panning, moving, show, zoomIn, zoomOut, fit, handlers, onClickCapture } =
  useGraphPanZoom(box, () => model.value, {
    at,
    move: (node, to) => put(node.slice(NODE.length), snapSpot(to.x, to.y)),
    drop: () => layout.now(),
  });
const zoomText = computed(() => `${Math.round(zoom.value * 100)}%`);
onMounted(async () => {
  const stored = layout.storedView;
  if (stored.zoom !== 1 || stored.left || stored.top) await show(stored);
  layout.settled();
});
watch(zoom, () => layout.later());

const open = (id: string) => showDetail({ kind: 'station', id });
const stationLabel = (station: DiagramStation) => {
  const names = station.lines
    .map(id => source.value.lines.find(line => line.id === id)?.name)
    .filter(Boolean);
  const lines = names.length ? `Lines: ${names.join(', ')}` : 'No line calls here';
  return `${station.name}, ${station.caption}. ${lines}. Enter opens it, the arrow keys move it.`;
};
// Brings station `id` into view inside the scrolling box, as far as it is out of it.
async function keepInView(id: string) {
  await nextTick();
  const el = box.value;
  const station = model.value?.stations.find(entry => entry.id === id);
  if (!el || !station) return;
  const scale = zoom.value;
  const into = (start: number, end: number, offset: number, visible: number) =>
    start < offset ? start - 8 : end > offset + visible ? end - visible + 8 : offset;
  el.scrollLeft = into(
    station.x * scale,
    (station.x + station.width) * scale,
    el.scrollLeft,
    el.clientWidth,
  );
  el.scrollTop = into(
    station.y * scale,
    (station.y + station.height) * scale,
    el.scrollTop,
    el.clientHeight,
  );
}
function onFocus(e: FocusEvent, station: DiagramStation) {
  active.value = station.id;
  if ((e.currentTarget as Element).matches(':focus-visible')) void keepInView(station.id);
}
// Enter or Space opens a focused station; an arrow key moves it a grid step, Shift further.
function onKey(e: KeyboardEvent, station: DiagramStation) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    return open(station.id);
  }
  // Where it is now: a key held down repeats before the drawing is redrawn.
  const now = at(NODE + station.id) ?? station;
  const to = nudgedSpot([now.x, now.y], e.key, e.shiftKey);
  if (!to) return;
  e.preventDefault();
  e.stopPropagation();
  put(station.id, to);
  layout.later();
  void keepInView(station.id);
}
async function resetLayout() {
  if (
    Object.keys(layout.spots.value).length &&
    !(await confirmAction({
      title: 'Reset the layout?',
      body: 'The stations you moved go back to their automatic places, and the diagram to 100%.',
      confirmLabel: 'Reset layout',
    }))
  )
    return;
  layout.spots.value = {};
  await show({ zoom: 1, left: 0, top: 0 });
  layout.now();
}
const GLYPH: Record<string, string> = { load: '↑', unload: '↓', empty: '·' };
const diagramName = computed(
  () =>
    `Train network: ${source.value.stations.length} stations, ${source.value.lines.length} lines. The list under it names every line.`,
);
</script>

<template>
  <section class="panel train-diagram" data-train-diagram aria-labelledby="train-diagram-title">
    <h2 id="train-diagram-title">Network diagram</h2>
    <p v-if="!model" class="small" data-diagram-empty>
      The diagram draws your stations and the lines between them once you add a station.
    </p>
    <template v-else>
      <p class="small muted">
        Stations in columns along the lines, pick-ups on the left and drop-offs on the right; each
        line in its colour, solid ⇄ back and forth, dashed → one-way. Drag the background to move
        the diagram, drag a station to move it (or the arrow keys on a focused station), zoom with
        the mouse wheel, a pinch or the buttons, and press a station to edit it. Point at a station
        or focus it to light up its lines.
      </p>
      <div class="fgraph-tools" data-diagram-tools>
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
        <span class="fgraph-zoom" data-diagram-zoom-level>{{ zoomText }}</span>
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
          aria-label="Fit the whole diagram"
          data-diagram-fit
          @click="fit"
        >
          Fit
        </button>
        <button class="btn" type="button" data-diagram-reset @click="resetLayout">
          Reset layout
        </button>
      </div>
      <div
        ref="box"
        :class="['fgraph-scroll', 'tdiag-scroll', { panning, moving }]"
        tabindex="0"
        role="group"
        :aria-label="diagramName"
        data-diagram
        v-on="handlers"
        @click.capture="onClickCapture"
        @scroll="layout.later()"
      >
        <svg
          class="fgraph tdiag"
          :width="model.width * zoom"
          :height="model.height * zoom"
          :viewBox="`0 0 ${model.width} ${model.height}`"
          role="none"
        >
          <defs aria-hidden="true">
            <marker
              v-for="color in LINE_COLORS"
              :id="'tdiag-arrow-' + (color - 1)"
              :key="color"
              :class="'tdiag-arrow line-color-' + (color - 1)"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L8,4 L0,8 Z" />
            </marker>
          </defs>
          <path
            v-for="segment in model.segments"
            :key="segment.id"
            :class="segmentClass(segment.line, segment.color, segment.dashed)"
            :d="segment.path"
            :data-segment="segment.line"
            :marker-end="`url(#tdiag-arrow-${segment.color})`"
            :marker-start="segment.both ? `url(#tdiag-arrow-${segment.color})` : undefined"
            aria-hidden="true"
          />
          <text
            v-for="label in model.labels"
            :key="'label-' + label.line"
            :class="[
              'tdiag-label',
              'line-color-' + label.color,
              { faded: !!lit && !lit.has(label.line) },
            ]"
            :x="label.x"
            :y="label.y"
            text-anchor="middle"
            :data-line-label="label.line"
            aria-hidden="true"
          >
            {{ label.text }}
          </text>
          <g
            v-for="station in model.stations"
            :key="station.id"
            :class="[
              'fgraph-node',
              'line',
              'tdiag-station',
              { on: active === station.id, faded: stationFaded(station) },
            ]"
            :data-node="'station:' + station.id"
            :data-diagram-station="station.id"
            :transform="`translate(${station.x},${station.y})`"
            tabindex="0"
            role="button"
            :aria-label="stationLabel(station)"
            @click="open(station.id)"
            @keydown="onKey($event, station)"
            @pointerenter="active = station.id"
            @pointerleave="leave(station.id)"
            @focus="onFocus($event, station)"
            @blur="leave(station.id)"
          >
            <rect :width="station.width" :height="station.height" />
            <text class="fgraph-name" x="10" y="19">{{ station.shortName }}</text>
            <text class="fgraph-caption" x="10" y="35">{{ station.caption }}</text>
            <g aria-hidden="true">
              <g
                v-for="(kind, i) in station.platforms"
                :key="i"
                :class="['tdiag-platform', kind]"
                :transform="`translate(${10 + i * 22},42)`"
              >
                <rect width="18" height="14" />
                <text x="9" y="11" text-anchor="middle">{{ GLYPH[kind] }}</text>
              </g>
              <text
                v-if="station.more"
                class="fgraph-caption"
                :x="10 + DIAGRAM.platformGlyphs * 22"
                y="53"
              >
                +{{ station.more }}
              </text>
            </g>
          </g>
        </svg>
      </div>
      <ul v-if="legend.length" class="tdiag-legend" data-diagram-legend>
        <li
          v-for="item in legend"
          :key="item.id"
          :class="'line-color-' + item.color"
          :data-legend-line="item.id"
        >
          <span class="line-swatch" aria-hidden="true"></span>
          <b>{{ item.name }}</b> <span aria-hidden="true">{{ item.mark }}</span>
          {{ item.direction }}: {{ item.stops || 'no stops yet' }} · {{ item.cargo }}
        </li>
      </ul>
      <p v-else class="small muted" data-diagram-no-lines>No lines yet: add one above.</p>
    </template>
  </section>
</template>
