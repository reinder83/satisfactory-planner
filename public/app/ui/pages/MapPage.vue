<!--
  #map, the world map (#1283, slice 1 of 3): the owner's image of the whole map (WORLD_MAP in
  world-map.ts, with its calibration to the game's world coordinates) in a box that pans and zooms
  as a factory's flow graph does (useGraphPanZoom, graph-pan-zoom.ts): the wheel zooms around the
  pointer, a drag on the map moves it, two fingers pinch, and − / + / Fit zoom around the middle.
  The box takes focus, and then the arrow keys move the map (Shift: further) and + and − zoom it.
  It opens fitted to the box. Nothing is stored: the view is the tab's alone. Markers, factory
  places and the layer toggles come in the later slices.
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { GRAPH_ZOOM, panGraphBy } from '../../graph-view.ts';
import { WORLD_MAP } from '../../world-map.ts';
import { useGraphPanZoom } from '../detail/graph-pan-zoom.ts';
import PageHeader from '../PageHeader.vue';

// How far (px on screen) an arrow key moves the map, and with Shift.
const KEY_STEP = 80;
const KEY_STEP_SHIFT = 320;

const box = ref<HTMLElement | null>(null);
const natural = { width: WORLD_MAP.width, height: WORLD_MAP.height };
const { zoom, panning, show, zoomIn, zoomOut, fit, handlers, onClickCapture } = useGraphPanZoom(
  box,
  () => natural,
);
const zoomText = computed(() => `${Math.round(zoom.value * 100)}%`);

onMounted(async () => {
  await nextTick();
  await fit();
});

const ARROWS: Record<string, [x: number, y: number]> = {
  ArrowLeft: [1, 0],
  ArrowRight: [-1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};
// The arrow keys move the focused map, + and − zoom it. Only on the box itself, so a focused
// control inside it (a marker, in a later slice) keeps its own keys; Ctrl, ⌘ and Alt are the
// browser's (Ctrl + zooms the page).
function onKey(e: KeyboardEvent) {
  const el = box.value;
  if (!el || e.target !== el || e.ctrlKey || e.metaKey || e.altKey) return;
  const arrow = ARROWS[e.key];
  if (arrow) {
    e.preventDefault();
    const step = e.shiftKey ? KEY_STEP_SHIFT : KEY_STEP;
    const area = { width: el.clientWidth, height: el.clientHeight };
    const view = { zoom: zoom.value, left: el.scrollLeft, top: el.scrollTop };
    void show(panGraphBy(view, arrow[0] * step, arrow[1] * step, area, natural));
  } else if (e.key === '+' || e.key === '=') {
    e.preventDefault();
    void zoomIn();
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault();
    void zoomOut();
  }
}
</script>

<template>
  <PageHeader
    eyebrow="YOUR WORLD"
    title="World map"
    subtitle="The whole map of the game, north up."
  />
  <section class="panel world-map">
    <p class="small muted">
      Drag the map to move it, zoom with the mouse wheel, a pinch or the buttons. Once the map has
      focus, the arrow keys move it (Shift: further) and + and − zoom it.
    </p>
    <div class="fgraph-tools" data-map-tools>
      <button
        class="btn"
        type="button"
        aria-label="Zoom out"
        data-map-zoom="out"
        :disabled="zoom <= GRAPH_ZOOM.min"
        @click="zoomOut"
      >
        −
      </button>
      <span class="fgraph-zoom" data-map-zoom-level>{{ zoomText }}</span>
      <button
        class="btn"
        type="button"
        aria-label="Zoom in"
        data-map-zoom="in"
        :disabled="zoom >= GRAPH_ZOOM.max"
        @click="zoomIn"
      >
        +
      </button>
      <button
        class="btn"
        type="button"
        aria-label="Fit the whole map"
        data-map-zoom="fit"
        @click="fit"
      >
        Fit
      </button>
    </div>
    <div
      ref="box"
      :class="['map-scroll', { panning }]"
      tabindex="0"
      role="group"
      aria-label="World map. The arrow keys move it, + and − zoom it."
      data-world-map
      v-on="handlers"
      @click.capture="onClickCapture"
      @keydown="onKey"
    >
      <div
        class="map-layer"
        :style="{ width: natural.width * zoom + 'px', height: natural.height * zoom + 'px' }"
        data-map-layer
      >
        <img
          class="map-image"
          :src="WORLD_MAP.src"
          :width="natural.width"
          :height="natural.height"
          alt="The Satisfactory world map, north up"
          draggable="false"
          data-map-image
        />
      </div>
    </div>
    <p class="small muted map-credit" data-map-attribution>Map: © Coffee Stain Studios</p>
  </section>
</template>
